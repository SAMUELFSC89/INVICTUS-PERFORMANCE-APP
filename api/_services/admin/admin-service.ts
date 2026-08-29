import { AdminRepository } from '../../_repositories/admin-repository.js';
import { AppError } from '../../_middleware/error.js';
import { getOverallMetricsForDashboard, logEvent, memoryCache, getPipelineTrace } from '../../_lib/observability.js';
import { runProductionReadinessAudit } from '../../_lib/production-audit-engine.js';
import { ReviewActivityRequest, ReviewActivityResponse } from '../../_dto/admin-dto.js';
import { db } from '../../_lib/common.js';
import { WithdrawalEngine } from '../../_lib/withdrawal-engine.js';
import { WalletEngine } from '../../_lib/wallet-engine.js';
import { WithdrawalEngine as WithdrawalEngineConfig } from '../../_lib/withdrawal-engine.js';

export class AdminService {
  constructor(private adminRepository: AdminRepository) {}

  async getMetrics() {
    const metrics = await getOverallMetricsForDashboard();
    const alerts = await this.adminRepository.getSystemAlerts(10);
    return {
      metrics,
      alerts,
      timestamp: new Date().toISOString()
    };
  }

  async getLogs(category = 'system_logs', limit = 20) {
    const limitNum = Math.min(100, Math.max(1, limit));
    const cacheKey = `admin_logs_${category}_${limitNum}`;
    const cachedData = memoryCache.get(cacheKey);

    if (cachedData) {
      return { logs: cachedData, cached: true };
    }

    const logs = await this.adminRepository.getLogs(category, limitNum);
    memoryCache.set(cacheKey, logs, 10);
    return { logs, cached: false };
  }

  async reviewActivity(reviewerId: string, payload: ReviewActivityRequest): Promise<ReviewActivityResponse> {
    const { activityId, status, resolution } = payload;

    if (!activityId || !status) {
      throw new AppError('Parâmetros activityId e status são obrigatórios.', 400);
    }

    if (!['valid', 'invalid', 'suspicious'].includes(status)) {
      throw new AppError('Status inválido. Deve ser valid, invalid ou suspicious.', 400);
    }

    const workout = await this.adminRepository.findWorkoutById(activityId);
    if (!workout) {
      throw new AppError('Atividade física não encontrada.', 404);
    }

    const athleteId = workout.userId;
    const previousPoints = Number(workout.points || 0);
    const type = workout.type || 'workout';

    let adjustedPoints = 0;
    if (status === 'valid') {
      adjustedPoints = type === 'recovery' ? 100 : 80;
    } else if (status === 'suspicious') {
      adjustedPoints = 20;
    } else {
      adjustedPoints = 0;
    }

    const finalResolution = resolution || 'Revisado manualmente pelo administrador.';

    await this.adminRepository.reviewWorkoutTransaction(
      activityId,
      athleteId,
      status,
      adjustedPoints,
      previousPoints,
      reviewerId,
      finalResolution
    );

    await logEvent({
      severity: 'INFO',
      category: 'admin_reviews',
      message: `Atividade #${activityId} revisada manualmente para status '${status}' por Admin (${reviewerId})`,
      userId: athleteId,
      route: '/api/admin',
      details: { activityId, originalStatus: workout.status, status, adjustedPoints, previousPoints }
    });

    return {
      success: true,
      activityId,
      status,
      adjustedPoints,
      message: `Atividade atualizada para '${status}' com ${adjustedPoints} pontos.`
    };
  }

  // #325: fila de revisao manual -- lista atividades que o cliente ja
  // finalizou automaticamente como "pendente" (antifraude/geofence/falha
  // tecnica) e que ainda nao tiveram o status alterado por um admin. Usa o
  // mesmo `reviewActivity` acima (action 'review-activity') pra decidir o
  // status final -- essa listagem so resolve o "como o admin encontra o
  // ID pra revisar", que antes nao existia.
  async listFlaggedActivities(limit = 50) {
    const activities = await this.adminRepository.listFlaggedActivities(limit);
    return { activities, count: activities.length };
  }

  async listWithdrawals(status?: string) {
    return await this.adminRepository.getWithdrawals(status);
  }

  async updateWithdrawalStatus(reviewerId: string, withdrawalId: string, status: string, reason?: string) {
    if (!withdrawalId || !status) {
      throw new AppError('withdrawalId e status são obrigatórios.', 400);
    }
    // "paid" é um estado terminal confirmado exclusivamente pelo webhook do
    // provedor. Não permita que um clique administrativo baixe o saldo antes
    // de o PIX estar efetivamente concluído.
    const validStatuses = ['pending', 'under_review', 'approved', 'cancelled', 'rejected'];
    if (!validStatuses.includes(status)) {
      throw new AppError('Status de saque inválido.', 400);
    }

    const updated = await WithdrawalEngine.updateWithdrawalStatus(withdrawalId, status as any, reviewerId, reason);

    await logEvent({
      severity: 'INFO',
      category: 'payment_logs',
      message: `Saque PIX ${withdrawalId} atualizado para '${status}' por Admin (${reviewerId})`,
      userId: updated.userId,
      route: '/api/admin',
      details: { withdrawalId, status, amount: updated.amount, reason }
    });

    return { success: true, message: `Saque ${withdrawalId} atualizado para ${status}.`, withdrawal: updated };
  }

  async processWithdrawalPayment(reviewerId: string, withdrawalId: string) {
    if (!withdrawalId) {
      throw new AppError('withdrawalId é obrigatório.', 400);
    }

    const updated: any = await WithdrawalEngine.processPayment(withdrawalId, reviewerId);

    await logEvent({
      severity: 'INFO',
      category: 'payment_logs',
      message: 'Saque PIX ' + withdrawalId + ' processado via Asaas (transferId: ' + updated.providerTransferId + ') por Admin (' + reviewerId + ')',
      userId: updated.userId,
      route: '/api/admin',
      details: { withdrawalId, amount: updated.amount, providerTransferId: updated.providerTransferId, providerStatus: updated.providerStatus }
    });

    return { success: true, message: 'Pagamento PIX de R$ ' + updated.amount.toFixed(2) + ' enviado via Asaas.', withdrawal: updated };
  }

  async creditTestBalance(reviewerId: string, userId: string, amount: number, description?: string) {
    if (!userId || !amount || amount <= 0) {
      throw new AppError('userId e amount (maior que zero) são obrigatórios.', 400);
    }

    const finalDescription = description || 'Crédito de teste aplicado por Admin (' + reviewerId + ')';

    const result = await WalletEngine.creditCoins({
      userId,
      amount,
      category: 'redeemable',
      origin: 'admin_adjustment',
      description: finalDescription
    });

    await logEvent({
      severity: 'INFO',
      category: 'payment_logs',
      message: 'Crédito de TESTE de R$ ' + amount.toFixed(2) + ' aplicado na carteira de ' + userId + ' por Admin (' + reviewerId + ')',
      userId,
      route: '/api/admin',
      details: { amount, reviewerId, description: finalDescription }
    });

    return { success: true, message: 'R$ ' + amount.toFixed(2) + ' de saldo de teste creditado com sucesso.', wallet: result.wallet };
  }

    async updateWithdrawalMinAmount(reviewerId: string, minWithdrawalAmount: number) {
    if (!minWithdrawalAmount || minWithdrawalAmount <= 0) {
      throw new AppError('minWithdrawalAmount deve ser maior que zero.', 400);
    }
    const updated = await WithdrawalEngineConfig.updateConfig({ minWithdrawalAmount });
    await logEvent({
      severity: 'INFO',
      category: 'payment_logs',
      message: 'Config de saque atualizada: minWithdrawalAmount = R$ ' + minWithdrawalAmount.toFixed(2) + ' por Admin (' + reviewerId + ')',
      userId: reviewerId,
      route: '/api/admin',
      details: { minWithdrawalAmount, reviewerId }
    });
    return { success: true, message: 'Saque minimo atualizado para R$ ' + minWithdrawalAmount.toFixed(2) + '.', config: updated };
  }

  async upsertEntity(type: 'mission' | 'sponsor_challenge' | 'store_item', id: string | undefined, data: Record<string, any>) {
    const collectionMap: Record<string, string> = {
      mission: 'missions',
      sponsor_challenge: 'sponsor_challenges',
      store_item: 'store_items'
    };

    const collectionName = collectionMap[type];
    if (!collectionName) {
      throw new AppError('Tipo de entidade inválido.', 400);
    }

    const docId = await this.adminRepository.upsertDocument(collectionName, id, data);
    return { success: true, id: docId, message: `${type} salvo com sucesso.` };
  }

  async getProductionAudit() {
    return await runProductionReadinessAudit(db);
  }

  async getTrace(traceId: string) {
    if (!traceId) throw new AppError('traceId é obrigatório.', 400);
    return await getPipelineTrace(traceId);
  }
}
