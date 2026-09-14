import { createHash } from 'node:crypto';
import { db } from './common.js';
import { IVCoinLedgerType, IVCoinTransactionOrigin, RewardCoinTransaction, RewardCoinWallet } from '../../src/types.js';
import { isActiveAccountState } from './account-state.js';

const MISSION_CAP_LEDGERS: IVCoinLedgerType[] = [
  'MISSION_REWARD',
  'CONSISTENCY_REWARD',
  'PRO_MISSION_REWARD',
];

function defaultLedger(origin: IVCoinTransactionOrigin): IVCoinLedgerType {
  if (origin === 'championship') return 'GYM_CHAMPIONSHIP_PODIUM';
  if (origin === 'admin_adjustment') return 'ADMIN_ADJUSTMENT';
  if (origin === 'campaign' || origin === 'sponsor' || origin === 'referral') return 'PROMOTIONAL_REWARD';
  return 'MISSION_REWARD';
}

const EMPTY_WALLET = (userId: string): RewardCoinWallet => ({
  userId,
  balance: 0,
  lifetimeEarned: 0,
  lifetimeSpent: 0,
  updatedAt: new Date().toISOString(),
});

function coinTransactionId(userId: string, idempotencyKey: string): string {
  const digest = createHash('sha256')
    .update(`${userId}\u0000${idempotencyKey}`)
    .digest('hex');
  return `coin_${digest}`;
}

function legacyCoinTransactionId(userId: string, idempotencyKey: string): string {
  const safeKey = Buffer.from(idempotencyKey).toString('base64url').slice(0, 180);
  return `coin_${userId}_${safeKey}`;
}

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
    ledgerType?: IVCoinLedgerType;
    description: string;
    idempotencyKey: string;
  }): Promise<{ wallet: RewardCoinWallet; transaction: RewardCoinTransaction; duplicated: boolean }> {
    if (!db) throw new Error('Database not initialized');
    const amount = Math.floor(params.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('Quantidade de Invictus Coins inválida.');
    if (!params.idempotencyKey) throw new Error('Chave de idempotência obrigatória.');

    const transactionId = coinTransactionId(params.userId, params.idempotencyKey);
    const legacyTransactionId = legacyCoinTransactionId(params.userId, params.idempotencyKey);
    const walletRef = db.collection('reward_coin_wallets').doc(params.userId);
    const userRef = db.collection('users').doc(params.userId);
    const transactionRef = db.collection('reward_coin_transactions').doc(transactionId);
    const legacyTransactionRef = db.collection('reward_coin_transactions').doc(legacyTransactionId);
    const policyRef = db.collection('reward_coin_economy').doc('global');
    const monthKey = new Date().toISOString().slice(0, 7);
    const monthlyCounterRef = db.collection('reward_coin_monthly_counters').doc(`${params.userId}_${monthKey}`);
    const ledgerType = params.ledgerType || defaultLedger(params.origin);
    const settlement = await db.runTransaction(async transaction => {
      const [userSnap, walletSnap, existingTransaction, legacyTransaction, policySnap, monthlyCounterSnap] = await Promise.all([
        transaction.get(userRef),
        transaction.get(walletRef),
        transaction.get(transactionRef),
        transaction.get(legacyTransactionRef),
        transaction.get(policyRef),
        transaction.get(monthlyCounterRef),
      ]);

      const matchesRequest = (value: Record<string, any>): boolean => (
        value.userId === params.userId
        && value.idempotencyKey === params.idempotencyKey
        && Number(value.amount) === amount
        && value.origin === params.origin
        && value.type === 'credit'
        && value.ledgerType === ledgerType
      );
      if (existingTransaction.exists) {
        const existing = existingTransaction.data() || {};
        if (!matchesRequest(existing)) {
          throw new Error('Conflito no ledger de Coins para a chave de idempotência informada.');
        }
        return { duplicated: true, storedTransactionId: transactionId };
      }
      const legacyValue = legacyTransaction.exists ? legacyTransaction.data() || {} : null;
      if (legacyValue?.idempotencyAlias === true) {
        if (legacyValue.canonicalTransactionId === transactionId) {
          throw new Error('Alias legado de Coins sem transação canônica válida.');
        }
      }
      if (legacyValue && matchesRequest(legacyValue)) {
        return { duplicated: true, storedTransactionId: legacyTransactionId };
      }

      // Gate 1 lifecycle: um ledger novo nunca pode ser criado para conta
      // bloqueada, banida, suspensa ou excluída. A leitura ocorre dentro da
      // mesma transação que o saldo para impedir TOCTOU no settlement.
      if (!userSnap.exists || !isActiveAccountState(userSnap.data())) {
        throw new Error('Conta inativa não pode receber Invictus Coins.');
      }

      const current = walletSnap.exists ? walletSnap.data() || {} : EMPTY_WALLET(params.userId);
      const policy = policySnap.data() || {};
      const monthlyCounter = monthlyCounterSnap.data() || {};
      const countsTowardMissionCap = MISSION_CAP_LEDGERS.includes(ledgerType);
      const missionMonthlyCap = Number(policy.missionMonthlyCap);
      const missionIssued = Math.max(0, Number(monthlyCounter.missionIssued) || 0);
      if (countsTowardMissionCap && Number.isFinite(missionMonthlyCap) && missionMonthlyCap > 0 && missionIssued + amount > missionMonthlyCap) {
        throw new Error('O limite mensal configurado para recompensas de missões foi atingido.');
      }
      const globalIssuanceBudget = Number(policy.globalIssuanceBudget);
      const globalIssued = Math.max(0, Number(policy.globalIssued) || 0);
      if (Boolean(policy.enforceGlobalBudget) && Number.isFinite(globalIssuanceBudget) && globalIssuanceBudget > 0 && globalIssued + amount > globalIssuanceBudget) {
        throw new Error('O orçamento global configurado de Invictus Coins foi atingido.');
      }
      const createdAt = new Date().toISOString();
      const coinTransaction: RewardCoinTransaction = {
        id: transactionId,
        userId: params.userId,
        amount,
        type: 'credit',
        origin: params.origin,
        ledgerType,
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
      if (!legacyTransaction.exists) {
        transaction.set(legacyTransactionRef, {
          id: legacyTransactionId,
          idempotencyAlias: true,
          canonicalTransactionId: transactionId,
          createdAt,
        });
      }
      transaction.set(monthlyCounterRef, {
        userId: params.userId,
        monthKey,
        missionIssued: missionIssued + (countsTowardMissionCap ? amount : 0),
        championshipPodiumIssued: Math.max(0, Number(monthlyCounter.championshipPodiumIssued) || 0) + (ledgerType === 'GYM_CHAMPIONSHIP_PODIUM' ? amount : 0),
        totalIssued: Math.max(0, Number(monthlyCounter.totalIssued) || 0) + amount,
        updatedAt: createdAt,
      }, { merge: true });
      transaction.set(policyRef, {
        globalIssued: globalIssued + amount,
        pilotUserLimit: Number(policy.pilotUserLimit) > 0 ? Number(policy.pilotUserLimit) : 1000,
        updatedAt: createdAt,
      }, { merge: true });
      return { duplicated: false, storedTransactionId: transactionId };
    });

    const wallet = await this.getWallet(params.userId);
    const transactionSnap = await db.collection('reward_coin_transactions')
      .doc(settlement.storedTransactionId).get();
    if (!transactionSnap.exists) throw new Error('Transação de Coins não encontrada após a conciliação.');
    return {
      wallet,
      transaction: transactionSnap.data() as RewardCoinTransaction,
      duplicated: settlement.duplicated,
    };
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
