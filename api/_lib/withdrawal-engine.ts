import { db, FieldValue } from './common.js';
import { WalletEngine } from './wallet-engine.js';
import { ConversionEngine } from './conversion-engine.js';
import { PIXWithdrawal, WithdrawalStatus } from '../../src/types.js';

export class WithdrawalEngine {
  /**
   * Evaluates anti-fraud risk for a withdrawal request.
   */
  static async evaluateWithdrawalRisk(userId: string, coinsAmount: number, pixKey: string, deviceId?: string): Promise<{
    score: number; // 0 to 100 (100 = completely trustworthy, 0 = high risk)
    passed: boolean;
    flags: string[];
    details: any;
  }> {
    const flags: string[] = [];
    let score = 100;

    if (!db) {
      return { score: 100, passed: true, flags: ['DB_UNAVAILABLE_FALLBACK'], details: {} };
    }

    try {
      // 1. Fetch user profile
      const userDoc = await db.collection('users').doc(userId).get();
      const userData = userDoc.data() || {};

      // Check account age (minimum 3 days for PIX withdrawals)
      const createdAt = userData.createdAt ? new Date(userData.createdAt).getTime() : Date.now();
      const accountAgeDays = (Date.now() - createdAt) / (1000 * 60 * 60 * 24);
      if (accountAgeDays < 3) {
        flags.push('ACCOUNT_TOO_NEW');
        score -= 40;
      }

      // Check user infractions
      const infractions = Number(userData.infractions) || 0;
      if (infractions > 0) {
        flags.push(`USER_INFRACTIONS_${infractions}`);
        score -= Math.min(60, infractions * 20);
      }

      // Check verified workouts count
      const totalWorkouts = Number(userData.totalWorkouts) || 0;
      if (totalWorkouts < 5) {
        flags.push('FEW_VERIFIED_WORKOUTS');
        score -= 20;
      }

      // Check device fingerprint matching
      if (deviceId && userData.deviceFingerprint && userData.deviceFingerprint !== deviceId) {
        flags.push('DEVICE_FINGERPRINT_MISMATCH');
        score -= 30;
      }

      // Check premium status (Premium members have enhanced trust score)
      const isPremium = Boolean(userData.premium || userData.isSubscribed);
      if (!isPremium) {
        flags.push('FREE_PLAN_WITHDRAWAL');
      } else {
        score = Math.min(100, score + 10);
      }

      // Check large withdrawal amount
      if (coinsAmount >= 10000) { // e.g. >= R$ 100,00
        flags.push('LARGE_AMOUNT_REVIEW');
        score -= 15;
      }

      const passed = score >= 50 && !userData.isBlocked && !userData.isBanned;

      return {
        score,
        passed,
        flags,
        details: {
          accountAgeDays: Math.round(accountAgeDays),
          infractions,
          totalWorkouts,
          isPremium,
          coinsAmount
        }
      };
    } catch (err) {
      console.error('[WithdrawalEngine] Anti-fraud evaluation error:', err);
      return { score: 70, passed: true, flags: ['EVALUATION_ERROR_FALLBACK'], details: {} };
    }
  }

  /**
   * Requests a new PIX withdrawal.
   */
  static async requestWithdrawal(params: {
    userId: string;
    coinsAmount: number;
    pixKey: string;
    pixKeyType: 'cpf' | 'email' | 'phone' | 'random';
    deviceId?: string;
  }): Promise<PIXWithdrawal> {
    if (!db) throw new Error('Database not initialized');
    const { userId, coinsAmount, pixKey, pixKeyType, deviceId } = params;

    if (!coinsAmount || coinsAmount <= 0) {
      throw new Error('Quantidade de IV Coins para saque deve ser um valor positivo.');
    }

    if (!pixKey || pixKey.trim().length === 0) {
      throw new Error('Chave PIX é obrigatória.');
    }

    // 1. Fetch conversion config
    const config = await ConversionEngine.getConfig();
    if (!config.enabled) {
      throw new Error('Solicitações de saque via PIX estão temporariamente desativadas pelo sistema.');
    }

    if (coinsAmount < config.minWithdrawalCoins) {
      const minBrl = ConversionEngine.coinsToBrl(config.minWithdrawalCoins, config.coinsPerBrl);
      throw new Error(`O saque mínimo é de ${config.minWithdrawalCoins} IV Coins (R$ ${minBrl.toFixed(2)}).`);
    }

    // 2. Fetch user profile
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) throw new Error('Usuário não encontrado.');
    const userData = userDoc.data() || {};

    if (userData.isBlocked || userData.isBanned) {
      throw new Error('Esta conta está suspensa para operações financeiras.');
    }

    // 3. Evaluate Anti-Fraud risk
    const antiFraud = await this.evaluateWithdrawalRisk(userId, coinsAmount, pixKey, deviceId);
    if (!antiFraud.passed) {
      throw new Error('A solicitação de saque foi recusada pelo sistema de segurança e integridade.');
    }

    // 4. Calculate BRL value dynamically using ConversionEngine
    const brlAmount = ConversionEngine.coinsToBrl(coinsAmount, config.coinsPerBrl);

    const withdrawalId = `pix_req_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const status: WithdrawalStatus = antiFraud.score < 80 ? 'under_review' : 'pending';

    const withdrawal: PIXWithdrawal = {
      id: withdrawalId,
      userId,
      userDisplayName: userData.displayName || 'Atleta Invictus',
      userEmail: userData.email || '',
      coinsAmount,
      brlAmount,
      pixKey: pixKey.trim(),
      pixKeyType,
      status,
      antiFraudScore: antiFraud.score,
      antiFraudPassed: antiFraud.passed,
      antiFraudFlags: antiFraud.flags,
      antiFraudDetails: antiFraud.details,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // 5. Hold coins in wallet (moves redeemable balance -> blocked balance)
    await WalletEngine.holdForWithdrawal(userId, coinsAmount, withdrawalId);

    // 6. Save withdrawal record
    await db.collection('withdrawals').doc(withdrawalId).set(withdrawal);

    return withdrawal;
  }

  /**
   * Gets all withdrawals for a user.
   */
  static async getUserWithdrawals(userId: string): Promise<PIXWithdrawal[]> {
    if (!db) return [];
    try {
      const snap = await db.collection('withdrawals')
        .where('userId', '==', userId)
        .orderBy('createdAt', 'desc')
        .get();

      return snap.docs.map(doc => doc.data() as PIXWithdrawal);
    } catch (err) {
      console.warn('[WithdrawalEngine] Fallback ordering for withdrawals:', err);
      const snap = await db.collection('withdrawals')
        .where('userId', '==', userId)
        .get();

      const list = snap.docs.map(doc => doc.data() as PIXWithdrawal);
      return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }
  }

  /**
   * Updates withdrawal status (for Admin Dashboard).
   */
  static async updateWithdrawalStatus(
    withdrawalId: string,
    newStatus: WithdrawalStatus,
    adminNote?: string
  ): Promise<PIXWithdrawal> {
    if (!db) throw new Error('Database not initialized');
    const docRef = db.collection('withdrawals').doc(withdrawalId);
    const docSnap = await docRef.get();

    if (!docSnap.exists) throw new Error('Solicitação de saque não encontrada.');
    const withdrawal = docSnap.data() as PIXWithdrawal;

    const previousStatus = withdrawal.status;
    if (previousStatus === newStatus) return withdrawal;

    // Handle wallet hold updates based on target status
    if (newStatus === 'paid' || newStatus === 'approved') {
      // On paid/approved, release the hold by permanently consuming blocked coins
      if (previousStatus === 'pending' || previousStatus === 'under_review') {
        await WalletEngine.resolveWithdrawalHold(withdrawal.userId, withdrawal.coinsAmount, withdrawalId, 'pay');
      }
    } else if (newStatus === 'cancelled' || newStatus === 'rejected') {
      // On cancel/reject, refund blocked coins back to redeemable balance
      if (previousStatus === 'pending' || previousStatus === 'under_review' || previousStatus === 'approved') {
        await WalletEngine.resolveWithdrawalHold(withdrawal.userId, withdrawal.coinsAmount, withdrawalId, 'refund');
      }
    }

    const updated: Partial<PIXWithdrawal> = {
      status: newStatus,
      updatedAt: new Date().toISOString(),
      ...(newStatus === 'paid' ? { processedAt: new Date().toISOString() } : {}),
      ...(adminNote ? { adminNote } : {})
    };

    await docRef.set(updated, { merge: true });
    return { ...withdrawal, ...updated };
  }
}
