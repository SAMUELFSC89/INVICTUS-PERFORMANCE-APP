import { createHash } from 'node:crypto';
import { db } from './common.js';
import { isActiveAccountState } from './account-state.js';

export interface SeasonPrizeCreditInput {
  seasonId: string;
  userId: string;
  gymId?: string;
  rank: number;
  amount: number;
  leagueName: string;
}

export interface SeasonPrizeCreditResult {
  credited: boolean;
  alreadyCredited: boolean;
  ineligible: boolean;
  transactionId: string;
}

function settlementDigest(input: SeasonPrizeCreditInput): string {
  return createHash('sha256')
    .update(`${input.seasonId}|${input.userId}|${input.gymId || ''}|${input.rank}`)
    .digest('hex');
}

function transactionIdFor(input: SeasonPrizeCreditInput): string {
  return `tx_season_prize_${settlementDigest(input)}`;
}

function settlementIdFor(input: SeasonPrizeCreditInput): string {
  return `season_prize_${settlementDigest(input)}`;
}

function matchesSettlement(data: Record<string, any>, input: SeasonPrizeCreditInput): boolean {
  return data.seasonId === input.seasonId
    && data.userId === input.userId
    && String(data.gymId || '') === String(input.gymId || '')
    && Number(data.rank) === input.rank
    && Number(data.amount) === input.amount;
}

/**
 * Credita premio sacavel com chave deterministica por temporada/atleta/academia/posicao.
 * A transacao le perfil, settlement, ledger e carteira juntos. Um retry nunca duplica
 * saldo; um conflito de identidade/valor falha fechado; e uma conta que ficar inativa
 * durante o fechamento recebe um settlement INELIGIBLE deterministico, impedindo que
 * uma reativacao posterior transforme um retry antigo em pagamento novo.
 */
export async function creditSeasonPrize(input: SeasonPrizeCreditInput): Promise<SeasonPrizeCreditResult> {
  if (!input.seasonId || !input.userId || !Number.isInteger(input.rank) || input.rank <= 0) {
    throw new Error('Identidade de premiacao de temporada invalida.');
  }
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new Error('Valor de premiacao invalido.');
  }

  const txId = transactionIdFor(input);
  const settlementId = settlementIdFor(input);
  const txRef = db.collection('iv_transactions').doc(txId);
  const settlementRef = db.collection('season_prize_settlements').doc(settlementId);
  const walletRef = db.collection('wallets').doc(input.userId);
  const userRef = db.collection('users').doc(input.userId);
  const now = new Date().toISOString();

  return db.runTransaction(async (transaction: any) => {
    const [existingSettlement, existingTx, walletSnap, userSnap] = await Promise.all([
      transaction.get(settlementRef),
      transaction.get(txRef),
      transaction.get(walletRef),
      transaction.get(userRef),
    ]);

    if (existingSettlement.exists) {
      const stored = existingSettlement.data() || {};
      if (!matchesSettlement(stored, input)) {
        throw new Error('Conflito no settlement de premio da temporada. Operacao interrompida.');
      }
      const status = String(stored.status || '');
      if (status !== 'CREDITED' && status !== 'INELIGIBLE') {
        throw new Error('Settlement de premio em estado invalido. Operacao interrompida.');
      }
      return {
        credited: false,
        alreadyCredited: status === 'CREDITED',
        ineligible: status === 'INELIGIBLE',
        transactionId: txId,
      };
    }

    // Compatibilidade defensiva: se um ledger deterministico existir sem o
    // marker de settlement, só o reconhecemos quando todo o contrato coincide.
    if (existingTx.exists) {
      const stored = existingTx.data() || {};
      if (!matchesSettlement(stored, input)
        || stored.type !== 'credit'
        || stored.category !== 'redeemable'
        || stored.origin !== 'league') {
        throw new Error('Conflito no ledger de premio da temporada. Operacao interrompida.');
      }
      transaction.create(settlementRef, {
        id: settlementId,
        seasonId: input.seasonId,
        userId: input.userId,
        gymId: input.gymId || null,
        rank: input.rank,
        amount: input.amount,
        status: 'CREDITED',
        transactionId: txId,
        settledAt: now,
      });
      return { credited: false, alreadyCredited: true, ineligible: false, transactionId: txId };
    }

    if (!userSnap.exists || !isActiveAccountState(userSnap.data())) {
      transaction.create(settlementRef, {
        id: settlementId,
        seasonId: input.seasonId,
        userId: input.userId,
        gymId: input.gymId || null,
        rank: input.rank,
        amount: input.amount,
        status: 'INELIGIBLE',
        reason: 'ACCOUNT_INACTIVE_AT_SETTLEMENT',
        transactionId: null,
        settledAt: now,
      });
      return { credited: false, alreadyCredited: false, ineligible: true, transactionId: txId };
    }

    const wallet = walletSnap.exists ? walletSnap.data() || {} : {};
    const redeemableBalance = (Number(wallet.redeemableBalance) || 0) + input.amount;
    const ecosystemBalance = Number(wallet.ecosystemBalance) || 0;
    const promotionalBalance = Number(wallet.promotionalBalance) || 0;
    const blockedBalance = Number(wallet.blockedBalance) || 0;
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

    transaction.create(txRef, {
      id: txId,
      userId: input.userId,
      amount: input.amount,
      category: 'redeemable',
      type: 'credit',
      origin: 'league',
      destination: 'Wallet Invictus',
      description: `Premiacao da ${input.leagueName} - Posicao #${input.rank} (+R$ ${input.amount.toFixed(2)})`,
      seasonId: input.seasonId,
      gymId: input.gymId || null,
      rank: input.rank,
      idempotencyKey: `${input.seasonId}:${input.userId}:${input.gymId || 'none'}:${input.rank}`,
      createdAt: now,
    });

    transaction.create(settlementRef, {
      id: settlementId,
      seasonId: input.seasonId,
      userId: input.userId,
      gymId: input.gymId || null,
      rank: input.rank,
      amount: input.amount,
      status: 'CREDITED',
      transactionId: txId,
      settledAt: now,
    });

    return { credited: true, alreadyCredited: false, ineligible: false, transactionId: txId };
  });
}
