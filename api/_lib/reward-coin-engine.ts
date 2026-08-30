import { db } from './common.js';
import { IVCoinTransactionOrigin, RewardCoinTransaction, RewardCoinWallet } from '../../src/types.js';

const EMPTY_WALLET = (userId: string): RewardCoinWallet => ({
  userId,
  balance: 0,
  lifetimeEarned: 0,
  lifetimeSpent: 0,
  updatedAt: new Date().toISOString(),
});

export class RewardCoinEngine {
  static async getWallet(userId: string): Promise<RewardCoinWallet> {
    if (!db) throw new Error('Database not initialized');
    const snap = await db.collection('reward_coin_wallets').doc(userId).get();
    if (!snap.exists) return EMPTY_WALLET(userId);
    const data = snap.data() || {};
    return {
      userId,
      balance: Math.max(0, Number(data.balance) || 0),
      lifetimeEarned: Math.max(0, Number(data.lifetimeEarned) || 0),
      lifetimeSpent: Math.max(0, Number(data.lifetimeSpent) || 0),
      updatedAt: data.updatedAt || new Date().toISOString(),
    };
  }

  static async credit(params: {
    userId: string;
    amount: number;
    origin: IVCoinTransactionOrigin;
    description: string;
    idempotencyKey: string;
  }): Promise<{ wallet: RewardCoinWallet; transaction: RewardCoinTransaction; duplicated: boolean }> {
    if (!db) throw new Error('Database not initialized');
    const amount = Math.floor(params.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('Quantidade de Invictus Coins inválida.');
    if (!params.idempotencyKey) throw new Error('Chave de idempotência obrigatória.');

    const safeKey = Buffer.from(params.idempotencyKey).toString('base64url').slice(0, 180);
    const transactionId = `coin_${params.userId}_${safeKey}`;
    const walletRef = db.collection('reward_coin_wallets').doc(params.userId);
    const transactionRef = db.collection('reward_coin_transactions').doc(transactionId);
    let duplicated = false;

    await db.runTransaction(async transaction => {
      const [walletSnap, existingTransaction] = await Promise.all([
        transaction.get(walletRef),
        transaction.get(transactionRef),
      ]);
      if (existingTransaction.exists) {
        duplicated = true;
        return;
      }
      const current = walletSnap.exists ? walletSnap.data() || {} : EMPTY_WALLET(params.userId);
      const createdAt = new Date().toISOString();
      const coinTransaction: RewardCoinTransaction = {
        id: transactionId,
        userId: params.userId,
        amount,
        type: 'credit',
        origin: params.origin,
        description: params.description,
        idempotencyKey: params.idempotencyKey,
        createdAt,
      };
      transaction.set(walletRef, {
        userId: params.userId,
        balance: Math.max(0, Number(current.balance) || 0) + amount,
        lifetimeEarned: Math.max(0, Number(current.lifetimeEarned) || 0) + amount,
        lifetimeSpent: Math.max(0, Number(current.lifetimeSpent) || 0),
        updatedAt: createdAt,
      }, { merge: true });
      transaction.set(transactionRef, coinTransaction);
    });

    const wallet = await this.getWallet(params.userId);
    const transactionSnap = await transactionRef.get();
    return { wallet, transaction: transactionSnap.data() as RewardCoinTransaction, duplicated };
  }

  static async getTransactions(userId: string, limit = 40): Promise<RewardCoinTransaction[]> {
    if (!db) throw new Error('Database not initialized');
    const snap = await db.collection('reward_coin_transactions').where('userId', '==', userId).get();
    return snap.docs
      .map(doc => doc.data() as RewardCoinTransaction)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, Math.max(1, Math.min(100, limit)));
  }
}
