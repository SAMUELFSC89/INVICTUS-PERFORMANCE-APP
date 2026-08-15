import { db, FieldValue } from './common.js';
import { WalletEngine } from './wallet-engine.js';
import { PIXWithdrawal, WithdrawalStatus, WithdrawalConfig } from '../../src/types.js';
import { AsaasClient } from './asaas-client.js';

export const DEFAULT_WITHDRAWAL_CONFIG: WithdrawalConfig = {
  minWithdrawalAmount: 20, // R$ 20,00
  maxDailyWithdrawalAmount: 1000, // R$ 1.000,00
  enabled: true,
  updatedAt: new Date().toISOString()
};

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
    const updated: WithdrawalConfig = {
      minWithdrawalAmount: newConfig.minWithdrawalAmount ? Number(newConfig.minWithdrawalAmount) : current.minWithdrawalAmount,
      maxDailyWithdrawalAmount: newConfig.maxDailyWithdrawalAmount ? Number(newConfig.maxDailyWithdrawalAmount) : current.maxDailyWithdrawalAmount,
      enabled: newConfig.enabled !== undefined ? Boolean(newConfig.enabled) : current.enabled,
      updatedAt: new Date().toISOString()
    };
    await db.collection('system_config').doc('withdrawal').set(updated, { merge: true });
    return updated;
  }

  static async evaluateWithdrawalRisk(userId: string, amount: number, pixKey: string, deviceId?: string): Promise<{
    score: number;
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
      const userDoc = await db.collection('users').doc(userId).get();
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

      const isPremium = Boolean(userData.premium || userData.isSubscribed);
      if (!isPremium) {
        flags.push('FREE_PLAN_WITHDRAWAL');
      } else {
        score = Math.min(100, score + 10);
      }

      if (amount >= 100) {
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
          amount
        }
      };
    } catch (err) {
      console.error('[WithdrawalEngine] Anti-fraud evaluation error:', err);
      return { score: 70, passed: true, flags: ['EVALUATION_ERROR_FALLBACK'], details: {} };
    }
  }

  static async requestWithdrawal(params: {
    userId: string;
    amount: number;
    pixKey: string;
    pixKeyType: 'cpf' | 'email' | 'phone' | 'random';
    deviceId?: string;
  }): Promise<PIXWithdrawal> {
    if (!db) throw new Error('Database not initialized');
    const { userId, amount, pixKey, pixKeyType, deviceId } = params;

    if (!amount || amount <= 0) {
      throw new Error('Valor do saque deve ser um número positivo.');
    }

    if (!pixKey || pixKey.trim().length === 0) {
      throw new Error('Chave PIX é obrigatória.');
    }

    const config = await this.getConfig();
    if (!config.enabled) {
      throw new Error('Solicitações de saque via PIX estão temporariamente desativadas pelo sistema.');
    }

    if (amount < config.minWithdrawalAmount) {
      throw new Error('O saque mínimo é de R$ ' + config.minWithdrawalAmount.toFixed(2) + '.');
    }

    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) throw new Error('Usuário não encontrado.');
    const userData = userDoc.data() || {};

    if (userData.isBlocked || userData.isBanned) {
      throw new Error('Esta conta está suspensa para operações financeiras.');
    }

    const antiFraud = await this.evaluateWithdrawalRisk(userId, amount, pixKey, deviceId);
    if (!antiFraud.passed) {
      throw new Error('A solicitação de saque foi recusada pelo sistema de segurança e integridade.');
    }

    const withdrawalId = 'pix_req_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
    const status: WithdrawalStatus = antiFraud.score < 80 ? 'under_review' : 'pending';

    const withdrawal: PIXWithdrawal = {
      id: withdrawalId,
      userId,
      userDisplayName: userData.displayName || 'Atleta Invictus',
      userEmail: userData.email || '',
      amount,
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

    await WalletEngine.holdForWithdrawal(userId, amount, withdrawalId);
    await db.collection('withdrawals').doc(withdrawalId).set(withdrawal);

    return withdrawal;
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
    if (!db) throw new Error('Database not initialized');
    const docRef = db.collection('withdrawals').doc(withdrawalId);
    const docSnap = await docRef.get();

    if (!docSnap.exists) throw new Error('Solicitação de saque não encontrada.');
    const withdrawal = docSnap.data() as PIXWithdrawal;

    const previousStatus = withdrawal.status;
    if (previousStatus === newStatus) return withdrawal;

    if (newStatus === 'paid' || newStatus === 'approved') {
      if (previousStatus === 'pending' || previousStatus === 'under_review') {
        await WalletEngine.resolveWithdrawalHold(withdrawal.userId, withdrawal.amount, withdrawalId, 'pay');
      }
    } else if (newStatus === 'cancelled' || newStatus === 'rejected') {
      if (previousStatus === 'pending' || previousStatus === 'under_review' || previousStatus === 'approved') {
        await WalletEngine.resolveWithdrawalHold(withdrawal.userId, withdrawal.amount, withdrawalId, 'refund');
      }
    }

    const updated: any = {
      status: newStatus,
      updatedAt: new Date().toISOString(),
      ...(newStatus === 'paid' ? { processedAt: new Date().toISOString() } : {}),
      ...(adminNote ? { adminNote } : {}),
      ...(reviewerId ? { reviewerId } : {})
    };

    await docRef.set(updated, { merge: true });
    return { ...withdrawal, ...updated };
  }

  static async processPayment(withdrawalId: string, reviewerId: string): Promise<PIXWithdrawal> {
    if (!db) throw new Error('Database not initialized');
    const docRef = db.collection('withdrawals').doc(withdrawalId);

    // 1. Trava atomica contra duplo clique / requisicoes concorrentes: le o
    // saque e ja marca como 'processing' dentro de UMA transacao do Firestore.
    // Se um segundo clique chegar enquanto o primeiro ainda esta em andamento,
    // ele ve o status 'processing' e falha aqui mesmo, ANTES de chamar o
    // Asaas de novo (o que antes gerava erro de transferencia duplicada
    // direto na API do Asaas, com uma mensagem confusa pro admin).
    const originalStatus = await db.runTransaction(async (tx: any) => {
      const snap = await tx.get(docRef);
      if (!snap.exists) throw new Error('Solicitação de saque não encontrada.');
      const data = snap.data() as PIXWithdrawal;

      if (data.status === 'processing') {
        throw new Error('Este saque já está sendo processado agora (provável duplo clique). Aguarde alguns segundos, atualize a lista e confira o status antes de tentar de novo.');
      }
      if (data.status === 'paid') {
        throw new Error('Este saque já foi pago anteriormente. Nenhuma nova transferência foi enviada ao Asaas.');
      }
      if (data.status !== 'pending' && data.status !== 'under_review' && data.status !== 'approved') {
        throw new Error("Não é possível processar pagamento: saque está com status '" + data.status + "'.");
      }

      tx.set(docRef, { status: 'processing', updatedAt: new Date().toISOString() }, { merge: true });
      return data.status;
    });

    const docSnap = await docRef.get();
    const withdrawal = docSnap.data() as PIXWithdrawal;

    try {
      // 2. Dispara a transferência PIX real via Asaas ANTES de mexer no saldo.
      // Se isso falhar, nada foi debitado e o admin pode tentar novamente
      // (o status volta para o valor original no catch abaixo).
      const transfer = await AsaasClient.transferPix({
        value: withdrawal.amount,
        pixKey: withdrawal.pixKey,
        pixKeyType: withdrawal.pixKeyType,
        description: 'Saque Invictus Performance - ' + withdrawal.userDisplayName
      });

      // 3. Só depois do Asaas aceitar a transferência, finaliza o bloqueio
      // (remove definitivamente do blockedBalance).
      await WalletEngine.resolveWithdrawalHold(withdrawal.userId, withdrawal.amount, withdrawalId, 'pay');

      const updated: any = {
        status: 'paid',
        updatedAt: new Date().toISOString(),
        processedAt: new Date().toISOString(),
        reviewerId,
        paymentProvider: 'asaas',
        providerTransferId: transfer.id,
        providerStatus: transfer.status
      };

      await docRef.set(updated, { merge: true });
      return { ...withdrawal, ...updated };
    } catch (err) {
      // 4. O Asaas recusou ou falhou: devolve o saque para o status anterior
      // (nunca deixa preso em 'processing') para o admin poder tentar de novo
      // com segurança, sabendo que nada foi transferido nesta tentativa.
      await docRef.set({ status: originalStatus, updatedAt: new Date().toISOString() }, { merge: true });
      throw err;
    }
  }

  static async handleAsaasTransferWebhook(
    transferId: string,
    event: string,
    providerStatus: string,
    failureReason?: string
  ): Promise<void> {
    if (!db) throw new Error('Database not initialized');
    const snap = await db.collection('withdrawals').where('providerTransferId', '==', transferId).limit(1).get();

    if (snap.empty) {
      console.warn('[WithdrawalEngine] Webhook do Asaas recebido para transferId desconhecido:', transferId);
      return;
    }

    const doc = snap.docs[0];
    const withdrawal = doc.data() as PIXWithdrawal;
    const failed = event === 'TRANSFER_FAILED' || providerStatus === 'FAILED' || providerStatus === 'CANCELLED';

    if (failed) {
      // A transferência não foi concluída de fato: estorna o valor para o saldo
      // disponível do atleta, já que ele nunca recebeu o dinheiro.
      await WalletEngine.creditCoins({
        userId: withdrawal.userId,
        amount: withdrawal.amount,
        category: 'redeemable',
        origin: 'withdrawal_refund',
        description: 'Estorno automático: falha na transferência PIX via Asaas (' + (failureReason || 'motivo não informado') + ')',
        destination: 'Carteira (Estorno)'
      });

      await doc.ref.set({
        status: 'rejected',
        providerStatus: providerStatus || 'FAILED',
        adminNote: 'Transferência falhou no Asaas: ' + (failureReason || 'sem detalhes'),
        updatedAt: new Date().toISOString()
      }, { merge: true });
    } else {
      await doc.ref.set({
        providerStatus: providerStatus || event,
        updatedAt: new Date().toISOString()
      }, { merge: true });
    }
  }
}
