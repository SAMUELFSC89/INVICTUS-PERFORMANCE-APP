import { db } from './common.js';
import { PIXWithdrawal, WithdrawalStatus, WithdrawalConfig } from '../../src/types.js';
import { AsaasClient } from './asaas-client.js';
import { notificationService } from '../_services/notification-service.js';
import { isProUser } from './entitlement.js';
import { isActiveAccountState } from './account-state.js';
import { updateWithdrawalStatusSafely } from './withdrawal-admin-status.js';
import { assertNoChampionshipPrizeFinancialRisk } from './championship-prize-financial-risk.js';

export const DEFAULT_WITHDRAWAL_CONFIG: WithdrawalConfig = {
  minWithdrawalAmount: 20,
  maxDailyWithdrawalAmount: 1000,
  enabled: true,
  updatedAt: new Date().toISOString()
};

function normalizeWithdrawalReference(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const reference = value.trim();
  if (!reference.startsWith('pix_req_') || reference.length > 500 || reference.includes('/')) return null;
  return reference;
}

export class WithdrawalEngine {
  static async getConfig(): Promise<WithdrawalConfig> {
    try {
      if (!db) return DEFAULT_WITHDRAWAL_CONFIG;
      const docRef = db.collection('system_config').doc('withdrawal');
      const docSnap = await docRef.get();
      if (docSnap.exists) {
        const data = docSnap.data() as Partial<WithdrawalConfig>;
        return {
          minWithdrawalAmount: Number(data.minWithdrawalAmount) || DEFAULT_WITHDRAWAL_CONFIG.minWithdrawalAmount,
          maxDailyWithdrawalAmount: Number(data.maxDailyWithdrawalAmount) || DEFAULT_WITHDRAWAL_CONFIG.maxDailyWithdrawalAmount,
          enabled: data.enabled !== undefined ? Boolean(data.enabled) : DEFAULT_WITHDRAWAL_CONFIG.enabled,
          updatedAt: data.updatedAt || new Date().toISOString()
        };
      }
    } catch (err) {
      console.warn('[WithdrawalEngine] Error fetching withdrawal config from DB, using fallback defaults:', err);
    }
    return DEFAULT_WITHDRAWAL_CONFIG;
  }

  static async updateConfig(newConfig: Partial<WithdrawalConfig>): Promise<WithdrawalConfig> {
    if (!db) throw new Error('Database not initialized');
    const current = await this.getConfig();
    const requestedMin = newConfig.minWithdrawalAmount !== undefined
      ? Number(newConfig.minWithdrawalAmount)
      : current.minWithdrawalAmount;
    const requestedMax = newConfig.maxDailyWithdrawalAmount !== undefined
      ? Number(newConfig.maxDailyWithdrawalAmount)
      : current.maxDailyWithdrawalAmount;

    if (!Number.isFinite(requestedMin) || requestedMin <= 0) {
      throw new Error('O valor mínimo de saque deve ser positivo.');
    }
    if (!Number.isFinite(requestedMax) || requestedMax < requestedMin) {
      throw new Error('O limite diário deve ser maior ou igual ao saque mínimo.');
    }

    const updated: WithdrawalConfig = {
      minWithdrawalAmount: requestedMin,
      maxDailyWithdrawalAmount: requestedMax,
      enabled: newConfig.enabled !== undefined ? Boolean(newConfig.enabled) : current.enabled,
      updatedAt: new Date().toISOString()
    };
    await db.collection('system_config').doc('withdrawal').set(updated, { merge: true });
    return updated;
  }

  static async evaluateWithdrawalRisk(userId: string, amount: number, _pixKey: string, deviceId?: string): Promise<{
    score: number;
    passed: boolean;
    flags: string[];
    details: any;
  }> {
    const flags: string[] = [];
    let score = 100;

    if (!db) {
      return { score: 0, passed: false, flags: ['DB_UNAVAILABLE'], details: {} };
    }

    try {
      const userDoc = await db.collection('users').doc(userId).get();
      if (!userDoc.exists || !isActiveAccountState(userDoc.data())) {
        return { score: 0, passed: false, flags: ['ACCOUNT_INACTIVE'], details: { amount } };
      }
      const userData = userDoc.data() || {};

      const createdAt = userData.createdAt ? new Date(userData.createdAt).getTime() : Date.now();
      const accountAgeDays = (Date.now() - createdAt) / (1000 * 60 * 60 * 24);
      if (accountAgeDays < 3) {
        flags.push('ACCOUNT_TOO_NEW');
        score -= 40;
      }

      const infractions = Number(userData.infractions) || 0;
      if (infractions > 0) {
        flags.push('USER_INFRACTIONS_' + infractions);
        score -= Math.min(60, infractions * 20);
      }

      const totalWorkouts = Number(userData.totalWorkouts) || 0;
      if (totalWorkouts < 5) {
        flags.push('FEW_VERIFIED_WORKOUTS');
        score -= 20;
      }

      if (deviceId && userData.deviceFingerprint && userData.deviceFingerprint !== deviceId) {
        flags.push('DEVICE_FINGERPRINT_MISMATCH');
        score -= 30;
      }

      const isPremium = isProUser(userData);
      if (!isPremium) {
        flags.push('FREE_PLAN_WITHDRAWAL');
      } else {
        score = Math.min(100, score + 10);
      }

      if (amount >= 100) {
        flags.push('LARGE_AMOUNT_REVIEW');
        score -= 15;
      }

      const passed = score >= 50 && isActiveAccountState(userData);

      return {
        score,
        passed,
        flags,
        details: {
          accountAgeDays: Math.round(accountAgeDays),
          infractions,
          totalWorkouts,
          isPremium,
          amount
        }
      };
    } catch (err) {
      console.error('[WithdrawalEngine] Anti-fraud evaluation error:', err);
      return { score: 0, passed: false, flags: ['EVALUATION_ERROR'], details: {} };
    }
  }

  static async requestWithdrawal(params: {
    userId: string;
    amount: number;
    pixKey: string;
    pixKeyType: 'cpf' | 'email' | 'phone' | 'random';
    deviceId?: string;
    requestId?: string;
  }): Promise<PIXWithdrawal> {
    if (!db) throw new Error('Database not initialized');
    const { userId, amount, pixKey, pixKeyType, deviceId, requestId } = params;
    const normalizedAmount = Math.round(Number(amount) * 100) / 100;

    if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
      throw new Error('Valor do saque deve ser um número positivo.');
    }
    if (!pixKey || pixKey.trim().length === 0) {
      throw new Error('Chave PIX é obrigatória.');
    }
    if (!['cpf', 'email', 'phone', 'random'].includes(pixKeyType)) {
      throw new Error('Tipo de chave PIX inválido.');
    }

    const config = await this.getConfig();
    if (!config.enabled) {
      throw new Error('Solicitações de saque via PIX estão temporariamente desativadas pelo sistema.');
    }
    if (normalizedAmount < config.minWithdrawalAmount) {
      throw new Error('O saque mínimo é de R$ ' + config.minWithdrawalAmount.toFixed(2) + '.');
    }
    if (normalizedAmount > config.maxDailyWithdrawalAmount) {
      throw new Error('O valor solicitado excede o limite diário de R$ ' + config.maxDailyWithdrawalAmount.toFixed(2) + '.');
    }

    const now = new Date();
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    const dailyWithdrawals = await db.collection('withdrawals')
      .where('userId', '==', userId)
      .where('createdAt', '>=', dayStart.toISOString())
      .get();
    const dailyCommittedAmount = dailyWithdrawals.docs.reduce((total, doc) => {
      return total + (Number(doc.data()?.amount) || 0);
    }, 0);
    if (dailyCommittedAmount + normalizedAmount > config.maxDailyWithdrawalAmount + 0.0001) {
      throw new Error('Este saque ultrapassa o limite diário disponível de R$ ' + Math.max(0, config.maxDailyWithdrawalAmount - dailyCommittedAmount).toFixed(2) + '.');
    }

    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) throw new Error('Usuário não encontrado.');
    const userData = userDoc.data() || {};
    if (!isActiveAccountState(userData)) {
      throw new Error('Esta conta está suspensa para operações financeiras.');
    }

    const antiFraud = await this.evaluateWithdrawalRisk(userId, normalizedAmount, pixKey, deviceId);
    if (!antiFraud.passed) {
      throw new Error('A solicitação de saque foi recusada pelo sistema de segurança e integridade.');
    }

    const normalizedRequestId = requestId?.trim();
    if (normalizedRequestId && !/^[a-zA-Z0-9_-]{8,96}$/.test(normalizedRequestId)) {
      throw new Error('Identificador da requisição inválido.');
    }
    const withdrawalId = normalizedRequestId
      ? `pix_req_${userId}_${normalizedRequestId}`
      : 'pix_req_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
    const withdrawalRef = db.collection('withdrawals').doc(withdrawalId);
    const dailyLimitId = `${userId}_${dayStart.toISOString().slice(0, 10)}`;
    const dailyLimitRef = db.collection('withdrawal_daily_limits').doc(dailyLimitId);
    const status: WithdrawalStatus = antiFraud.score < 80 ? 'under_review' : 'pending';

    const withdrawal: PIXWithdrawal & Record<string, unknown> = {
      id: withdrawalId,
      userId,
      userDisplayName: userData.displayName || 'Atleta Invictus',
      userEmail: userData.email || '',
      amount: normalizedAmount,
      pixKey: pixKey.trim(),
      pixKeyType,
      status,
      antiFraudScore: antiFraud.score,
      antiFraudPassed: antiFraud.passed,
      antiFraudFlags: antiFraud.flags,
      antiFraudDetails: antiFraud.details,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    };

    const result = await db.runTransaction(async (transaction: any) => {
      const userRef = db.collection('users').doc(userId);
      const walletRef = db.collection('wallets').doc(userId);
      const holdTxRef = db.collection('iv_transactions').doc(`tx_hold_${withdrawalId}`);
      const [existingWithdrawal, walletSnap, existingHold, dailyLimitSnap, transactionUserSnap] = await Promise.all([
        transaction.get(withdrawalRef),
        transaction.get(walletRef),
        transaction.get(holdTxRef),
        transaction.get(dailyLimitRef),
        transaction.get(userRef)
      ]);

      if (existingWithdrawal.exists) {
        const existing = existingWithdrawal.data() as PIXWithdrawal;
        if (existing.userId !== userId) throw new Error('Chave de idempotência já está em uso.');
        return existing;
      }
      if (!transactionUserSnap.exists || !isActiveAccountState(transactionUserSnap.data())) {
        throw new Error('Conta deixou de estar ativa antes da reserva financeira.');
      }
      await assertNoChampionshipPrizeFinancialRisk(userId, transaction);
      if (existingHold.exists) {
        throw new Error('Solicitação financeira em conciliação. Aguarde o suporte.');
      }
      if (!walletSnap.exists) throw new Error('Carteira não encontrada. Atualize seu saldo e tente novamente.');

      const dailyData = dailyLimitSnap.exists ? dailyLimitSnap.data() || {} : {};
      const committedBefore = dailyLimitSnap.exists
        ? Number(dailyData.committedAmount) || 0
        : dailyCommittedAmount;
      if (committedBefore + normalizedAmount > config.maxDailyWithdrawalAmount + 0.0001) {
        throw new Error('Este saque ultrapassa o limite diário disponível de R$ ' + Math.max(0, config.maxDailyWithdrawalAmount - committedBefore).toFixed(2) + '.');
      }

      const wallet = walletSnap.data() || {};
      const redeemable = Number(wallet.redeemableBalance) || 0;
      const blocked = Number(wallet.blockedBalance) || 0;
      if (redeemable < normalizedAmount) {
        throw new Error(`Saldo disponível insuficiente para saque. Disponível: R$ ${redeemable.toFixed(2)}`);
      }

      const ecosystem = Number(wallet.ecosystemBalance) || 0;
      const promotional = Number(wallet.promotionalBalance) || 0;
      transaction.set(walletRef, {
        redeemableBalance: redeemable - normalizedAmount,
        blockedBalance: blocked + normalizedAmount,
        totalBalance: redeemable - normalizedAmount + ecosystem + promotional,
        updatedAt: new Date().toISOString()
      }, { merge: true });
      transaction.create(holdTxRef, {
        id: holdTxRef.id,
        userId,
        amount: normalizedAmount,
        category: 'redeemable',
        type: 'debit',
        origin: 'withdrawal_hold',
        destination: `Saque PIX (${withdrawalId})`,
        description: 'Bloqueio de saldo para análise de saque PIX',
        createdAt: new Date().toISOString()
      });
      transaction.create(withdrawalRef, withdrawal);
      transaction.set(dailyLimitRef, {
        userId,
        date: dayStart.toISOString().slice(0, 10),
        committedAmount: committedBefore + normalizedAmount,
        updatedAt: new Date().toISOString()
      }, { merge: true });
      return withdrawal;
    });

    return result as PIXWithdrawal;
  }

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

  static async updateWithdrawalStatus(
    withdrawalId: string,
    newStatus: WithdrawalStatus,
    reviewerId?: string,
    adminNote?: string
  ): Promise<PIXWithdrawal> {
    return updateWithdrawalStatusSafely(withdrawalId, newStatus, reviewerId, adminNote);
  }

  static async processPayment(withdrawalId: string, reviewerId: string): Promise<PIXWithdrawal> {
    if (!db) throw new Error('Database not initialized');
    const docRef = db.collection('withdrawals').doc(withdrawalId);

    await db.runTransaction(async (tx: any) => {
      const snap = await tx.get(docRef);
      if (!snap.exists) throw new Error('Solicitação de saque não encontrada.');
      const data = snap.data() as PIXWithdrawal & Record<string, any>;

      if (!data.userId) throw new Error('Saque sem usuário associado.');
      const userSnap = await tx.get(db.collection('users').doc(data.userId));
      if (!userSnap.exists || !isActiveAccountState(userSnap.data())) {
        throw new Error('Conta do titular não está ativa para operações financeiras. Rejeite o saque para liberar o saldo bloqueado.');
      }
      await assertNoChampionshipPrizeFinancialRisk(data.userId, tx);
      if (data.status === 'processing') {
        throw new Error('Este saque já está sendo processado agora. Aguarde a conciliação antes de tentar novamente.');
      }
      if (data.status === 'paid') {
        throw new Error('Este saque já foi pago anteriormente. Nenhuma nova transferência foi enviada ao Asaas.');
      }
      if (data.providerTransferId) {
        throw new Error('Este saque já está vinculado a uma transferência no Asaas. Aguarde a conciliação.');
      }
      if (data.providerExternalReference && data.providerExternalReference !== withdrawalId) {
        throw new Error('Referência externa inconsistente. Saque bloqueado para conciliação.');
      }
      if (data.status !== 'pending' && data.status !== 'under_review' && data.status !== 'approved') {
        throw new Error("Não é possível processar pagamento: saque está com status '" + data.status + "'.");
      }

      tx.set(docRef, {
        status: 'processing',
        paymentProvider: 'asaas',
        providerExternalReference: withdrawalId,
        providerSubmissionStartedAt: new Date().toISOString(),
        reconciliationRequired: false,
        updatedAt: new Date().toISOString()
      }, { merge: true });
    });

    const docSnap = await docRef.get();
    const withdrawal = docSnap.data() as PIXWithdrawal & Record<string, any>;

    try {
      const transfer = await AsaasClient.transferPix({
        value: withdrawal.amount,
        pixKey: withdrawal.pixKey,
        pixKeyType: withdrawal.pixKeyType,
        description: 'Saque Invictus Performance - ' + withdrawal.userDisplayName,
        externalReference: withdrawalId
      });

      const updated: any = {
        status: 'processing',
        updatedAt: new Date().toISOString(),
        reviewerId,
        paymentProvider: 'asaas',
        providerTransferId: transfer.id,
        providerExternalReference: withdrawalId,
        providerStatus: transfer.status,
        reconciliationRequired: false
      };

      const binding = await db.runTransaction(async (tx: any): Promise<{ conflict: boolean; terminal: boolean; reconciliation: boolean }> => {
        const freshSnap = await tx.get(docRef);
        if (!freshSnap.exists) throw new Error('Solicitação de saque desapareceu durante o processamento.');
        const fresh = freshSnap.data() as PIXWithdrawal & Record<string, any>;
        const now = new Date().toISOString();

        if (fresh.providerTransferId && fresh.providerTransferId !== transfer.id) {
          tx.set(docRef, {
            reconciliationRequired: true,
            reconciliationReason: 'PROVIDER_TRANSFER_ID_CONFLICT',
            conflictingProviderTransferId: transfer.id,
            updatedAt: now
          }, { merge: true });
          return { conflict: true, terminal: false, reconciliation: true };
        }

        if (fresh.status === 'paid' || fresh.status === 'rejected') {
          return { conflict: false, terminal: true, reconciliation: false };
        }

        if (fresh.reconciliationRequired === true) {
          return { conflict: false, terminal: false, reconciliation: true };
        }

        if (fresh.status !== 'processing') {
          tx.set(docRef, {
            reconciliationRequired: true,
            reconciliationReason: 'PROVIDER_RESPONSE_AFTER_UNEXPECTED_STATE',
            providerTransferId: fresh.providerTransferId || transfer.id,
            providerStatus: transfer.status,
            updatedAt: now
          }, { merge: true });
          return { conflict: false, terminal: false, reconciliation: true };
        }

        tx.set(docRef, updated, { merge: true });
        return { conflict: false, terminal: false, reconciliation: false };
      });

      if (binding.conflict) {
        throw new Error('Conflito de identificador da transferência Asaas. Saque exige conciliação.');
      }
      if (binding.reconciliation) {
        throw new Error('Transferência Asaas exige conciliação antes de alterar o estado do saque.');
      }
      if (binding.terminal) {
        const terminalSnap = await docRef.get();
        return terminalSnap.data() as PIXWithdrawal;
      }

      if (transfer.status === 'DONE') {
        await this.handleAsaasTransferWebhook(
          transfer.id,
          'TRANSFER_DONE',
          transfer.status,
          undefined,
          withdrawalId,
          transfer.value
        );
        const settledSnap = await docRef.get();
        return settledSnap.data() as PIXWithdrawal;
      }

      return { ...withdrawal, ...updated } as PIXWithdrawal;
    } catch (err: any) {
      // Nunca force status=processing aqui: o webhook pode ter concluído o
      // saque antes da resposta HTTP do POST /transfers retornar.
      await docRef.set({
        paymentProvider: 'asaas',
        providerExternalReference: withdrawalId,
        reconciliationRequired: true,
        updatedAt: new Date().toISOString()
      }, { merge: true }).catch((persistError) =>
        console.error('[WithdrawalEngine] Falha crítica ao marcar conciliação:', persistError)
      );
      throw err;
    }
  }

  static async handleAsaasTransferWebhook(
    transferId: string,
    event: string,
    providerStatus: string,
    failureReason?: string,
    externalReference?: unknown,
    providerValue?: unknown
  ): Promise<void> {
    if (!db) throw new Error('Database not initialized');
    if (!transferId?.trim()) throw new Error('Transferência Asaas sem identificador.');

    const canonicalTransferId = transferId.trim();
    const normalizedReference = normalizeWithdrawalReference(externalReference);
    const byTransferId = await db.collection('withdrawals')
      .where('providerTransferId', '==', canonicalTransferId)
      .limit(1)
      .get();

    let docRef: any = byTransferId.empty ? null : byTransferId.docs[0].ref;
    if (!docRef && normalizedReference) {
      const byReference = await db.collection('withdrawals').doc(normalizedReference).get();
      if (byReference.exists) docRef = byReference.ref;
    }

    if (!docRef) {
      console.warn('[WithdrawalEngine] Webhook do Asaas sem saque correspondente:', canonicalTransferId, normalizedReference || '(sem externalReference)');
      return;
    }

    const failed = event === 'TRANSFER_FAILED'
      || event === 'TRANSFER_CANCELLED'
      || providerStatus === 'FAILED'
      || providerStatus === 'CANCELLED';
    const succeeded = event === 'TRANSFER_DONE' || providerStatus === 'DONE';

    type WebhookOutcome = 'failed' | 'paid' | 'ignored' | 'reconciliation';
    const result = await db.runTransaction(async (transaction: any): Promise<{ outcome: WebhookOutcome; withdrawal: PIXWithdrawal | null }> => {
      const freshSnap = await transaction.get(docRef);
      if (!freshSnap.exists) return { outcome: 'ignored', withdrawal: null };
      const withdrawal = freshSnap.data() as PIXWithdrawal & Record<string, any>;
      const canonicalWithdrawalId = freshSnap.id;
      const now = new Date().toISOString();

      if (normalizedReference && normalizedReference !== canonicalWithdrawalId) {
        transaction.set(docRef, {
          reconciliationRequired: true,
          reconciliationReason: 'PROVIDER_EXTERNAL_REFERENCE_MISMATCH',
          conflictingExternalReference: normalizedReference,
          updatedAt: now
        }, { merge: true });
        return { outcome: 'reconciliation', withdrawal };
      }
      if (withdrawal.providerExternalReference && withdrawal.providerExternalReference !== canonicalWithdrawalId) {
        transaction.set(docRef, {
          reconciliationRequired: true,
          reconciliationReason: 'PERSISTED_EXTERNAL_REFERENCE_MISMATCH',
          updatedAt: now
        }, { merge: true });
        return { outcome: 'reconciliation', withdrawal };
      }
      if (withdrawal.providerTransferId && withdrawal.providerTransferId !== canonicalTransferId) {
        transaction.set(docRef, {
          reconciliationRequired: true,
          reconciliationReason: 'PROVIDER_TRANSFER_ID_CONFLICT',
          conflictingProviderTransferId: canonicalTransferId,
          updatedAt: now
        }, { merge: true });
        return { outcome: 'reconciliation', withdrawal };
      }

      const internalAmount = Number(withdrawal.amount);
      const numericProviderValue = typeof providerValue === 'number' ? providerValue : Number.NaN;
      if ((failed || succeeded) && (!Number.isFinite(numericProviderValue) || !Number.isFinite(internalAmount) || Math.abs(numericProviderValue - internalAmount) >= 0.01)) {
        transaction.set(docRef, {
          paymentProvider: 'asaas',
          providerTransferId: canonicalTransferId,
          providerExternalReference: normalizedReference || canonicalWithdrawalId,
          providerStatus: providerStatus || event,
          reconciliationRequired: true,
          reconciliationReason: 'PROVIDER_AMOUNT_MISMATCH_OR_MISSING',
          updatedAt: now
        }, { merge: true });
        return { outcome: 'reconciliation', withdrawal };
      }

      const providerBinding = {
        paymentProvider: 'asaas',
        providerTransferId: canonicalTransferId,
        providerExternalReference: normalizedReference || canonicalWithdrawalId,
        providerStatus: providerStatus || event,
        reconciliationRequired: false,
        updatedAt: now
      };

      if (!failed && !succeeded) {
        transaction.set(docRef, providerBinding, { merge: true });
        return { outcome: 'ignored', withdrawal };
      }

      const legacyPaidRefund = failed && withdrawal.status === 'paid' && !withdrawal.processedAt;
      if ((failed && withdrawal.status === 'paid' && !legacyPaidRefund)
        || (succeeded && withdrawal.status === 'rejected')) {
        transaction.set(docRef, {
          ...providerBinding,
          reconciliationRequired: true,
          reconciliationReason: 'PROVIDER_TERMINAL_STATE_CONFLICT'
        }, { merge: true });
        return { outcome: 'reconciliation', withdrawal };
      }

      const operation = failed ? 'refund' : 'pay';
      const settlementTxRef = db.collection('iv_transactions').doc(`tx_res_${operation}_${canonicalWithdrawalId}`);
      const walletRef = db.collection('wallets').doc(withdrawal.userId);
      const [existingSettlement, walletSnap] = await Promise.all([
        transaction.get(settlementTxRef),
        transaction.get(walletRef)
      ]);

      if (existingSettlement.exists || withdrawal.status === (failed ? 'rejected' : 'paid')) {
        transaction.set(docRef, providerBinding, { merge: true });
        return { outcome: 'ignored', withdrawal };
      }

      if (!walletSnap.exists) {
        transaction.set(docRef, {
          ...providerBinding,
          reconciliationRequired: true,
          reconciliationReason: 'WALLET_NOT_FOUND'
        }, { merge: true });
        return { outcome: 'reconciliation', withdrawal };
      }

      const wallet = walletSnap.data() || {};
      let redeemable = Number(wallet.redeemableBalance) || 0;
      let blocked = Number(wallet.blockedBalance) || 0;
      const ecosystem = Number(wallet.ecosystemBalance) || 0;
      const promotional = Number(wallet.promotionalBalance) || 0;
      const amount = internalAmount;

      if (legacyPaidRefund) {
        redeemable += amount;
      } else {
        if (blocked < amount) {
          transaction.set(docRef, {
            ...providerBinding,
            reconciliationRequired: true,
            reconciliationReason: 'BLOCKED_BALANCE_INCONSISTENT'
          }, { merge: true });
          return { outcome: 'reconciliation', withdrawal };
        }
        blocked -= amount;
        if (failed) redeemable += amount;
      }

      transaction.set(walletRef, {
        redeemableBalance: redeemable,
        blockedBalance: blocked,
        totalBalance: redeemable + ecosystem + promotional,
        updatedAt: new Date().toISOString()
      }, { merge: true });
      transaction.create(settlementTxRef, {
        id: settlementTxRef.id,
        userId: withdrawal.userId,
        amount,
        category: 'redeemable',
        type: failed ? 'credit' : 'debit',
        origin: failed ? 'withdrawal_refund' : 'conversion',
        destination: failed ? 'Carteira (Estorno)' : 'Pagamento PIX Realizado',
        description: failed
          ? 'Estorno automático: falha na transferência PIX via Asaas (' + (failureReason || 'motivo não informado') + ')'
          : 'Baixa de saldo por saque PIX concluído',
        createdAt: new Date().toISOString()
      });
      transaction.set(docRef, failed ? {
        ...providerBinding,
        status: 'rejected',
        adminNote: 'Transferência falhou no Asaas: ' + (failureReason || 'sem detalhes'),
        refundProcessedAt: new Date().toISOString(),
      } : {
        ...providerBinding,
        status: 'paid',
        processedAt: new Date().toISOString(),
      }, { merge: true });
      return { outcome: failed ? 'failed' : 'paid', withdrawal };
    });

    const outcome = result?.outcome;
    const withdrawalForNotification = result?.withdrawal;

    if (outcome === 'reconciliation') {
      console.warn('[WithdrawalEngine] Evento Asaas retido para conciliação:', canonicalTransferId, normalizedReference || '(sem externalReference)');
    } else if (outcome === 'failed' && withdrawalForNotification) {
      notificationService.notify({
        userId: withdrawalForNotification.userId,
        type: 'payment',
        title: 'Saque não concluído',
        message: 'Houve uma falha na transferência PIX de R$ ' + withdrawalForNotification.amount.toFixed(2) + '. O valor foi devolvido ao seu saldo.',
        actionUrl: '/wallet',
      }).catch((e) => console.error('[WithdrawalEngine] Falha ao notificar estorno de saque:', e));
    } else if (outcome === 'paid' && withdrawalForNotification) {
      notificationService.notify({
        userId: withdrawalForNotification.userId,
        type: 'payment',
        title: 'Saque pago! 💰',
        message: 'Seu saque de R$ ' + withdrawalForNotification.amount.toFixed(2) + ' foi concluído via PIX.',
        actionUrl: '/wallet',
      }).catch((e) => console.error('[WithdrawalEngine] Falha ao notificar saque pago:', e));
    }
  }
}
