import { db } from './common.js';
import { UserWallet, IVCoinTransaction, IVCoinCategory, IVCoinTransactionOrigin } from '../../src/types.js';

export class WalletEngine {
  /**
   * Fetches user wallet balance or creates a clean initial wallet if missing.
   */
  static async getWallet(userId: string): Promise<UserWallet> {
    if (!db) throw new Error('Database not initialized');
    const walletRef = db.collection('wallets').doc(userId);
    const walletSnap = await walletRef.get();

    if (!walletSnap.exists) {
      // Check legacy user profile walletBalance for smooth migration
      const userSnap = await db.collection('users').doc(userId).get();
      let initialRedeemable = 0;
      if (userSnap.exists) {
        const userData = userSnap.data() || {};
        // Migrate legacy walletBalance (already in R$) directly into the redeemable balance
        if (userData.walletBalance && userData.walletBalance > 0) {
          initialRedeemable = Number(userData.walletBalance);
        }
      }

      const newWallet: UserWallet = {
        userId,
        totalBalance: initialRedeemable,
        redeemableBalance: initialRedeemable,
        ecosystemBalance: 0,
        promotionalBalance: 0,
        blockedBalance: 0,
        updatedAt: new Date().toISOString()
      };

      await walletRef.set(newWallet);
      return newWallet;
    }

    const data = walletSnap.data() || {};
    const redeemableBalance = Number(data.redeemableBalance) || 0;
    const ecosystemBalance = Number(data.ecosystemBalance) || 0;
    const promotionalBalance = Number(data.promotionalBalance) || 0;
    const blockedBalance = Number(data.blockedBalance) || 0;
    const totalBalance = redeemableBalance + ecosystemBalance + promotionalBalance;

    return {
      userId,
      totalBalance,
      redeemableBalance,
      ecosystemBalance,
      promotionalBalance,
      blockedBalance,
      updatedAt: data.updatedAt || new Date().toISOString()
    };
  }

  /**
   * Credits funds to user wallet (in R$) and writes to transaction ledger.
   */
  static async creditCoins(params: {
    userId: string;
    amount: number;
    category: IVCoinCategory;
    origin: IVCoinTransactionOrigin;
    description: string;
    destination?: string;
  }): Promise<{ wallet: UserWallet; transaction: IVCoinTransaction }> {
    if (!db) throw new Error('Database not initialized');
    const { userId, amount, category, origin, description, destination = 'Wallet Invictus' } = params;

    if (amount <= 0) throw new Error('Valor a creditar deve ser maior que zero');

    const walletRef = db.collection('wallets').doc(userId);

    const txId = `tx_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const txRef = db.collection('iv_transactions').doc(txId);

    const transactionData: IVCoinTransaction = {
      id: txId,
      userId,
      amount,
      category,
      type: 'credit',
      origin,
      destination,
      description,
      createdAt: new Date().toISOString()
    };

    await db.runTransaction(async (t) => {
      const snap = await t.get(walletRef);
      let redeemable = 0;
      let ecosystem = 0;
      let promotional = 0;
      let blocked = 0;

      if (snap.exists) {
        const d = snap.data() || {};
        redeemable = Number(d.redeemableBalance) || 0;
        ecosystem = Number(d.ecosystemBalance) || 0;
        promotional = Number(d.promotionalBalance) || 0;
        blocked = Number(d.blockedBalance) || 0;
      }

      if (category === 'redeemable') redeemable += amount;
      else if (category === 'ecosystem') ecosystem += amount;
      else if (category === 'promotional') promotional += amount;

      const total = redeemable + ecosystem + promotional;

      t.set(walletRef, {
        userId,
        totalBalance: total,
        redeemableBalance: redeemable,
        ecosystemBalance: ecosystem,
        promotionalBalance: promotional,
        blockedBalance: blocked,
        updatedAt: new Date().toISOString()
      }, { merge: true });

      t.set(txRef, transactionData);
    });

    const updatedWallet = await this.getWallet(userId);
    return { wallet: updatedWallet, transaction: transactionData };
  }

  /**
   * Debits funds from user wallet (in R$).
   */
  static async debitCoins(params: {
    userId: string;
    amount: number;
    category: IVCoinCategory | 'any';
    origin: IVCoinTransactionOrigin;
    description: string;
    destination?: string;
  }): Promise<{ wallet: UserWallet; transaction: IVCoinTransaction }> {
    if (!db) throw new Error('Database not initialized');
    const { userId, amount, category, origin, description, destination = 'Loja Invictus' } = params;

    if (amount <= 0) throw new Error('Valor a debitar deve ser maior que zero');

    const walletRef = db.collection('wallets').doc(userId);
    const txId = `tx_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const txRef = db.collection('iv_transactions').doc(txId);

    let usedCategory: IVCoinCategory = category === 'any' ? 'ecosystem' : category;

    const transactionData: IVCoinTransaction = {
      id: txId,
      userId,
      amount,
      category: usedCategory,
      type: 'debit',
      origin,
      destination,
      description,
      createdAt: new Date().toISOString()
    };

    await db.runTransaction(async (t) => {
      const snap = await t.get(walletRef);
      if (!snap.exists) throw new Error('Carteira não encontrada.');

      const d = snap.data() || {};
      let redeemable = Number(d.redeemableBalance) || 0;
      let ecosystem = Number(d.ecosystemBalance) || 0;
      let promotional = Number(d.promotionalBalance) || 0;
      let blocked = Number(d.blockedBalance) || 0;

      if (category === 'redeemable') {
        if (redeemable < amount) throw new Error(`Saldo disponível insuficiente (R$ ${redeemable.toFixed(2)} disponíveis)`);
        redeemable -= amount;
      } else if (category === 'ecosystem') {
        if (ecosystem < amount) throw new Error(`Saldo de prêmios insuficiente (R$ ${ecosystem.toFixed(2)} disponíveis)`);
        ecosystem -= amount;
      } else if (category === 'promotional') {
        if (promotional < amount) throw new Error(`Saldo promocional insuficiente (R$ ${promotional.toFixed(2)} disponíveis)`);
        promotional -= amount;
      } else {
        // category === 'any': use promotional first, then ecosystem, then redeemable
        let remainingToDebit = amount;
        if (promotional >= remainingToDebit) {
          promotional -= remainingToDebit;
          usedCategory = 'promotional';
          remainingToDebit = 0;
        } else {
          remainingToDebit -= promotional;
          promotional = 0;
          if (ecosystem >= remainingToDebit) {
            ecosystem -= remainingToDebit;
            usedCategory = 'ecosystem';
            remainingToDebit = 0;
          } else {
            remainingToDebit -= ecosystem;
            ecosystem = 0;
            if (redeemable >= remainingToDebit) {
              redeemable -= remainingToDebit;
              usedCategory = 'redeemable';
              remainingToDebit = 0;
            } else {
              throw new Error(`Saldo total insuficiente. Necessário R$ ${amount.toFixed(2)}`);
            }
          }
        }
      }

      transactionData.category = usedCategory;
      const total = redeemable + ecosystem + promotional;

      t.set(walletRef, {
        userId,
        totalBalance: total,
        redeemableBalance: redeemable,
        ecosystemBalance: ecosystem,
        promotionalBalance: promotional,
        blockedBalance: blocked,
        updatedAt: new Date().toISOString()
      }, { merge: true });

      t.set(txRef, transactionData);
    });

    const updatedWallet = await this.getWallet(userId);
    return { wallet: updatedWallet, transaction: transactionData };
  }

  /**
   * Holds redeemable funds (R$) in blockedBalance during withdrawal review.
   */
  static async holdForWithdrawal(userId: string, coinsAmount: number, withdrawalId: string): Promise<UserWallet> {
    if (!db) throw new Error('Database not initialized');
    const walletRef = db.collection('wallets').doc(userId);
    const holdTxRef = db.collection('iv_transactions').doc(`tx_hold_${withdrawalId}`);

    await db.runTransaction(async (t) => {
      const [snap, existingHold] = await Promise.all([
        t.get(walletRef),
        t.get(holdTxRef)
      ]);

      // Requisições repetidas para o mesmo saque não podem bloquear o saldo
      // duas vezes. O lançamento determinístico é a chave de idempotência.
      if (existingHold.exists) return;
      if (!snap.exists) throw new Error('Carteira não encontrada.');

      const d = snap.data() || {};
      let redeemable = Number(d.redeemableBalance) || 0;
      let blocked = Number(d.blockedBalance) || 0;

      if (redeemable < coinsAmount) {
        throw new Error(`Saldo disponível insuficiente para saque. Disponível: R$ ${redeemable.toFixed(2)}`);
      }

      redeemable -= coinsAmount;
      blocked += coinsAmount;

      const total = redeemable + (Number(d.ecosystemBalance) || 0) + (Number(d.promotionalBalance) || 0);

      t.set(walletRef, {
        redeemableBalance: redeemable,
        blockedBalance: blocked,
        totalBalance: total,
        updatedAt: new Date().toISOString()
      }, { merge: true });

      const txId = holdTxRef.id;
      t.create(holdTxRef, {
        id: txId,
        userId,
        amount: coinsAmount,
        category: 'redeemable',
        type: 'debit',
        origin: 'withdrawal_hold',
        destination: `Saque PIX (${withdrawalId})`,
        description: `Bloqueio de saldo para análise de saque PIX`,
        createdAt: new Date().toISOString()
      });
    });

    return await this.getWallet(userId);
  }

  /**
   * Resolves a withdrawal hold: either consumes blocked coins (on payout) or refunds to redeemable (on rejection/cancel).
   */
  static async resolveWithdrawalHold(userId: string, coinsAmount: number, withdrawalId: string, action: 'pay' | 'refund'): Promise<UserWallet> {
    if (!db) throw new Error('Database not initialized');
    const walletRef = db.collection('wallets').doc(userId);
    const resolutionTxRef = db.collection('iv_transactions').doc(`tx_res_${action}_${withdrawalId}`);

    await db.runTransaction(async (t) => {
      const [snap, existingResolution] = await Promise.all([
        t.get(walletRef),
        t.get(resolutionTxRef)
      ]);

      // O mesmo evento/webhook pode ser reenviado. Se a resolução já foi
      // lançada, não alteramos novamente nenhum saldo.
      if (existingResolution.exists) return;
      if (!snap.exists) throw new Error('Carteira não encontrada.');

      const d = snap.data() || {};
      let blocked = Number(d.blockedBalance) || 0;
      let redeemable = Number(d.redeemableBalance) || 0;

      if (blocked < coinsAmount) {
        throw new Error('Saldo bloqueado inconsistente para resolver este saque. A operação foi interrompida para evitar duplicidade financeira.');
      }
      blocked -= coinsAmount;

      if (action === 'refund') {
        redeemable += coinsAmount;
      }

      const total = redeemable + (Number(d.ecosystemBalance) || 0) + (Number(d.promotionalBalance) || 0);

      t.set(walletRef, {
        blockedBalance: blocked,
        redeemableBalance: redeemable,
        totalBalance: total,
        updatedAt: new Date().toISOString()
      }, { merge: true });

      const txId = resolutionTxRef.id;
      t.create(resolutionTxRef, {
        id: txId,
        userId,
        amount: coinsAmount,
        category: 'redeemable',
        type: action === 'refund' ? 'credit' : 'debit',
        origin: action === 'refund' ? 'withdrawal_refund' : 'conversion',
        destination: action === 'refund' ? 'Carteira (Estorno)' : 'Pagamento PIX Realizado',
        description: action === 'refund' ? `Estorno de saque PIX cancelado/recusado` : `Baixa de saldo por saque PIX concluído`,
        createdAt: new Date().toISOString()
      });
    });

    return await this.getWallet(userId);
  }

  /**
   * Gets user transactions with pagination & filters.
   */
  static async getTransactions(userId: string, limitCount: number = 50): Promise<IVCoinTransaction[]> {
    if (!db) return [];
    try {
      const snap = await db.collection('iv_transactions')
        .where('userId', '==', userId)
        .orderBy('createdAt', 'desc')
        .limit(limitCount)
        .get();

      return snap.docs.map(doc => doc.data() as IVCoinTransaction);
    } catch (err) {
      console.warn('[WalletEngine] Error querying transactions by index, falling back to simple query:', err);
      // Fallback
      const snap = await db.collection('iv_transactions')
        .where('userId', '==', userId)
        .limit(limitCount)
        .get();

      const list = snap.docs.map(doc => doc.data() as IVCoinTransaction);
      return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }
  }
}
