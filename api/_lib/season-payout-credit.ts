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

function transactionIdFor(input: SeasonPrizeCreditInput): string {
  const digest = createHash('sha256')
    .update(`${input.seasonId}|${input.userId}|${input.gymId || ''}|${input.rank}`)
    .digest('hex');
  return `tx_season_prize_${digest}`;
}

/**
 * Credita premio sacavel com chave deterministica por temporada/atleta/academia/posicao.
 * A transacao le o perfil, o ledger e a carteira juntos: retry, concorrencia ou conta
 * desqualificada nunca podem gerar um segundo credito nem pagar usuario inativo.
 */
export async function creditSeasonPrize(input: SeasonPrizeCreditInput): Promise<SeasonPrizeCreditResult> {
  if (!input.seasonId || !input.userId || !Number.isInteger(input.rank) || input.rank <= 0) {
    throw new Error('Identidade de premiacao de temporada invalida.');
  }
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new Error('Valor de premiacao invalido.');
  }

  const txId = transactionIdFor(input);
  const txRef = db.collection('iv_transactions').doc(txId);
  const walletRef = db.collection('wallets').doc(input.userId);
  const userRef = db.collection('users').doc(input.userId);
  const now = new Date().toISOString();

  return db.runTransaction(async (transaction: any) => {
    const [existingTx, walletSnap, userSnap] = await Promise.all([
      transaction.get(txRef),
      transaction.get(walletRef),
      transaction.get(userRef),
    ]);

    if (existingTx.exists) {
      return { credited: false, alreadyCredited: true, ineligible: false, transactionId: txId };
    }

    if (!userSnap.exists || !isActiveAccountState(userSnap.data())) {
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

    return { credited: true, alreadyCredited: false, ineligible: false, transactionId: txId };
  });
}
