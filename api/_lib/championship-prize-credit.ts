import { createHash } from 'node:crypto';
import { db } from './common.js';
import { isActiveAccountState } from './account-state.js';

export interface ChampionshipPrizeCreditInput {
  championshipId: string;
  championshipTitle: string;
  regulationVersion: string;
  regulationHash: string;
  userId: string;
  rank: number;
  amount: number;
}

export interface ChampionshipPrizeCreditResult {
  credited: boolean;
  alreadyCredited: boolean;
  ineligible: boolean;
  transactionId: string;
}

function settlementDigest(input: ChampionshipPrizeCreditInput): string {
  return createHash('sha256')
    .update(`${input.championshipId}|${input.userId}|${input.rank}|${input.regulationVersion}|${input.regulationHash}`)
    .digest('hex');
}

export function championshipPrizeTransactionId(input: ChampionshipPrizeCreditInput): string {
  return `tx_championship_prize_${settlementDigest(input)}`;
}

export function championshipPrizeSettlementId(input: ChampionshipPrizeCreditInput): string {
  return `championship_prize_${settlementDigest(input)}`;
}

export function championshipPrizeAwardId(championshipId: string, userId: string): string {
  return `${championshipId}_${userId}`;
}

function sameMoney(a: unknown, b: unknown): boolean {
  return Math.abs((Number(a) || 0) - (Number(b) || 0)) < 0.005;
}

function matchesSettlement(data: Record<string, any>, input: ChampionshipPrizeCreditInput): boolean {
  return data.championshipId === input.championshipId
    && data.userId === input.userId
    && Number(data.rank) === input.rank
    && sameMoney(data.amount, input.amount)
    && data.regulationVersion === input.regulationVersion
    && data.regulationHash === input.regulationHash;
}

function matchesAward(data: Record<string, any>, input: ChampionshipPrizeCreditInput, transactionId: string): boolean {
  return matchesSettlement(data, input)
    && data.transactionId === transactionId
    && data.status === 'CREDITED';
}

function awardDocument(input: ChampionshipPrizeCreditInput, transactionId: string, now: string) {
  return {
    id: championshipPrizeAwardId(input.championshipId, input.userId),
    championshipId: input.championshipId,
    championshipTitle: input.championshipTitle,
    userId: input.userId,
    rank: input.rank,
    amount: input.amount,
    regulationVersion: input.regulationVersion,
    regulationHash: input.regulationHash,
    transactionId,
    status: 'CREDITED',
    financialRiskStatus: 'CLEAR',
    creditedAt: now,
    updatedAt: now,
  };
}

/**
 * Credita premiação oficial em reais na carteira sacável.
 *
 * O settlement e o lançamento financeiro usam IDs determinísticos por
 * campeonato/atleta/posição/regulamento. Reexecuções do cron nunca duplicam
 * saldo; qualquer colisão com dados diferentes falha fechado.
 *
 * A elegibilidade é revalidada dentro da MESMA transação do crédito:
 * - conta precisa continuar ativa;
 * - inscrição precisa continuar paga e sem refund/chargeback/conciliação;
 * - regulamento aceito precisa continuar sendo exatamente o congelado.
 *
 * Um `championship_prize_awards/{championshipId}_{userId}` também é mantido
 * na mesma transação para que o motor de saque consiga cruzar, sem heurística,
 * uma disputa financeira posterior com um prêmio que foi realmente creditado.
 */
export async function creditChampionshipPrize(
  input: ChampionshipPrizeCreditInput,
): Promise<ChampionshipPrizeCreditResult> {
  if (!input.championshipId || !input.userId || !Number.isInteger(input.rank) || input.rank <= 0) {
    throw new Error('Identidade de premiação do campeonato inválida.');
  }
  if (!input.regulationVersion || !input.regulationHash) {
    throw new Error('Regulamento congelado é obrigatório no settlement.');
  }
  const amount = Math.round(Number(input.amount) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Valor de premiação inválido.');

  const normalizedInput = { ...input, amount };
  const transactionId = championshipPrizeTransactionId(normalizedInput);
  const settlementId = championshipPrizeSettlementId(normalizedInput);
  const transactionRef = db.collection('iv_transactions').doc(transactionId);
  const settlementRef = db.collection('championship_prize_settlements').doc(settlementId);
  const awardRef = db.collection('championship_prize_awards').doc(championshipPrizeAwardId(input.championshipId, input.userId));
  const walletRef = db.collection('wallets').doc(input.userId);
  const userRef = db.collection('users').doc(input.userId);
  const registrationRef = db.collection('championship_registrations').doc(`${input.userId}_${input.championshipId}`);
  const now = new Date().toISOString();

  return db.runTransaction(async (transaction: any) => {
    const [existingSettlement, existingTransaction, existingAward, walletSnap, userSnap, registrationSnap] = await Promise.all([
      transaction.get(settlementRef),
      transaction.get(transactionRef),
      transaction.get(awardRef),
      transaction.get(walletRef),
      transaction.get(userRef),
      transaction.get(registrationRef),
    ]);

    if (existingAward.exists && !matchesAward(existingAward.data() || {}, normalizedInput, transactionId)) {
      throw new Error('Conflito no award de prêmio do campeonato. Operação interrompida.');
    }

    if (existingSettlement.exists) {
      const stored = existingSettlement.data() || {};
      if (!matchesSettlement(stored, normalizedInput)) {
        throw new Error('Conflito no settlement de prêmio do campeonato. Operação interrompida.');
      }
      const status = String(stored.status || '');
      if (status !== 'CREDITED' && status !== 'INELIGIBLE') {
        throw new Error('Settlement de prêmio em estado inválido. Operação interrompida.');
      }
      if (status === 'CREDITED' && !existingAward.exists) {
        transaction.create(awardRef, awardDocument(normalizedInput, transactionId, now));
      }
      return {
        credited: false,
        alreadyCredited: status === 'CREDITED',
        ineligible: status === 'INELIGIBLE',
        transactionId,
      };
    }

    // Compatibilidade defensiva: ledger determinístico sem marker só é aceito
    // quando o contrato inteiro coincide com esta premiação.
    if (existingTransaction.exists) {
      const stored = existingTransaction.data() || {};
      if (!matchesSettlement(stored, normalizedInput)
        || stored.type !== 'credit'
        || stored.category !== 'redeemable'
        || stored.origin !== 'championship') {
        throw new Error('Conflito no ledger de prêmio do campeonato. Operação interrompida.');
      }
      transaction.create(settlementRef, {
        id: settlementId,
        ...normalizedInput,
        status: 'CREDITED',
        transactionId,
        settledAt: now,
      });
      if (!existingAward.exists) transaction.create(awardRef, awardDocument(normalizedInput, transactionId, now));
      return { credited: false, alreadyCredited: true, ineligible: false, transactionId };
    }

    const userData = userSnap.exists ? userSnap.data() || {} : {};
    const registration = registrationSnap.exists ? registrationSnap.data() || {} : {};
    const activeAccount = userSnap.exists && isActiveAccountState(userData);
    const activeRegistration = registrationSnap.exists
      && registration.status === 'paga'
      && registration.paymentStatus === 'PAID'
      && registration.regulationVersion === input.regulationVersion
      && registration.regulationHash === input.regulationHash;

    if (!activeAccount || !activeRegistration) {
      transaction.create(settlementRef, {
        id: settlementId,
        ...normalizedInput,
        status: 'INELIGIBLE',
        reason: !activeAccount ? 'ACCOUNT_INACTIVE_AT_SETTLEMENT' : 'REGISTRATION_NOT_FINANCIALLY_ELIGIBLE',
        transactionId: null,
        settledAt: now,
      });
      return { credited: false, alreadyCredited: false, ineligible: true, transactionId };
    }

    const wallet = walletSnap.exists ? walletSnap.data() || {} : {};
    // Se a carteira moderna ainda não existe, preserva eventual saldo legado em
    // users.walletBalance antes de criar o primeiro documento da wallet.
    const previousRedeemable = walletSnap.exists
      ? Math.max(0, Number(wallet.redeemableBalance) || 0)
      : Math.max(0, Number(userData.walletBalance) || 0);
    const redeemableBalance = previousRedeemable + amount;
    const ecosystemBalance = Math.max(0, Number(wallet.ecosystemBalance) || 0);
    const promotionalBalance = Math.max(0, Number(wallet.promotionalBalance) || 0);
    const blockedBalance = Math.max(0, Number(wallet.blockedBalance) || 0);
    const totalBalance = redeemableBalance + ecosystemBalance + promotionalBalance;

    transaction.set(walletRef, {
      userId: input.userId,
      totalBalance,
      redeemableBalance,
      ecosystemBalance,
      promotionalBalance,
      blockedBalance,
      updatedAt: now,
    }, { merge: true });

    transaction.create(transactionRef, {
      id: transactionId,
      userId: input.userId,
      amount,
      category: 'redeemable',
      type: 'credit',
      origin: 'championship',
      destination: 'Wallet Invictus',
      description: `${input.rank}º lugar — ${input.championshipTitle} (+R$ ${amount.toFixed(2)})`,
      championshipId: input.championshipId,
      regulationVersion: input.regulationVersion,
      regulationHash: input.regulationHash,
      rank: input.rank,
      idempotencyKey: settlementId,
      createdAt: now,
    });

    transaction.create(settlementRef, {
      id: settlementId,
      ...normalizedInput,
      status: 'CREDITED',
      transactionId,
      balanceBefore: previousRedeemable,
      balanceAfter: redeemableBalance,
      settledAt: now,
    });
    transaction.create(awardRef, awardDocument(normalizedInput, transactionId, now));

    return { credited: true, alreadyCredited: false, ineligible: false, transactionId };
  });
}
