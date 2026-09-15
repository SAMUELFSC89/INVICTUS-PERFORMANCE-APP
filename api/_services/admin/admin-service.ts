import { AdminRepository } from '../../_repositories/admin-repository.js';
import { AppError } from '../../_middleware/error.js';
import { getOverallMetricsForDashboard, logEvent, memoryCache, getPipelineTrace } from '../../_lib/observability.js';
import { ReviewActivityRequest, ReviewActivityResponse } from '../../_dto/admin-dto.js';
import { WithdrawalEngine } from '../../_lib/withdrawal-engine.js';
import { updateWithdrawalStatusSafely } from '../../_lib/withdrawal-admin-status.js';
import { readCompetitionEvidenceMetrics } from '../../_lib/competition-evidence.js';

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

    if (!['valid', 'invalid'].includes(status)) {
      throw new AppError('Status inválido. Deve ser valid ou invalid.', 400);
    }

    const workout = await this.adminRepository.findWorkoutById(activityId);
    if (!workout) {
      throw new AppError('Atividade física não encontrada.', 404);
    }
    const isVersionedActivity = Number(workout.schemaVersion) >= 2;
    if (isVersionedActivity && workout.activityMode !== 'competitive') {
      throw new AppError('Atividades pessoais não possuem análise competitiva para revisar.', 409);
    }

    // Uma revisão humana pode decidir se a execução é válida, mas não cria
    // proveniência de sensor. Para atividades v2, a competição só pode voltar
    // a pontuar se o snapshot confiável já existir (ou se a fonte server-side
    // for normalizada pelo reader, como Strava OAuth direto).
    const trustedCompetitionMetrics = isVersionedActivity
      ? readCompetitionEvidenceMetrics(workout)
      : null;
    const competitionEligibleAfterReview = status === 'valid'
      && (!isVersionedActivity || Boolean(trustedCompetitionMetrics));
    const expectedCompetitionStatus = status === 'valid'
      ? competitionEligibleAfterReview ? 'approved' : 'ineligible'
      : 'rejected';

    const isProjectionRetry = isVersionedActivity
      && workout.competitionProjectionStatus === 'pending'
      && workout.adminReviewDecision === status
      && workout.competitionReviewStatus === expectedCompetitionStatus;
    if (isVersionedActivity
      && !isProjectionRetry
      && (workout.pendingReview !== true || workout.competitionReviewStatus !== 'pending_review')) {
      throw new AppError('Esta decisão competitiva já foi concluída e não está mais na fila de revisão.', 409);
    }

    const athleteId = workout.userId;
    const previousPoints = Number(workout.competitionPoints ?? workout.points) || 0;
    const type = workout.type || 'workout';
    const adjustedPoints = competitionEligibleAfterReview
      ? Number(workout.activityXpAwarded ?? workout.scoreAwarded) || (type === 'recovery' ? 100 : 80)
      : 0;
    const evidenceNote = status === 'valid' && isVersionedActivity && !trustedCompetitionMetrics
      ? ' Atividade validada manualmente, porém inelegível para competição por ausência de evidência competitiva confiável.'
      : '';
    const finalResolution = `${resolution || 'Revisado manualmente pelo administrador.'}${evidenceNote}`.trim();

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
      details: {
        activityId,
        originalStatus: workout.status,
        status,
        adjustedPoints,
        previousPoints,
        competitionEligibleAfterReview,
        expectedCompetitionStatus,
      }
    });

    return {
      success: true,
      activityId,
      status,
      adjustedPoints,
      message: status === 'valid'
        ? competitionEligibleAfterReview
          ? `Atividade aprovada com ${adjustedPoints} pontos competitivos.`
          : 'Atividade validada manualmente, mas mantida fora da pontuação competitiva por ausência de evidência confiável.'
        : 'Atividade rejeitada e mantida fora da pontuação competitiva.'
    };
  }

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
    const validStatuses = ['pending', 'under_review', 'approved', 'cancelled', 'rejected'];
    if (!validStatuses.includes(status)) {
      throw new AppError('Status de saque inválido.', 400);
    }

    const updated = await updateWithdrawalStatusSafely(withdrawalId, status as any, reviewerId, reason);

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

  async updateWithdrawalMinAmount(reviewerId: string, minWithdrawalAmount: number) {
    if (!minWithdrawalAmount || minWithdrawalAmount <= 0) {
      throw new AppError('minWithdrawalAmount deve ser maior que zero.', 400);
    }
    const updated = await WithdrawalEngine.updateConfig({ minWithdrawalAmount });
    await logEvent({
      severity: 'INFO',
      category: 'payment_logs',
      message: 'Config de saque atualizada: minWithdrawalAmount = R$ ' + minWithdrawalAmount.toFixed(2) + ' por Admin (' + reviewerId + ')',
      userId: reviewerId,
      route: '/api/admin',
      details: { minWithdrawalAmount, reviewerId }
    });
    return { success: true, message: 'Saque mínimo atualizado para R$ ' + minWithdrawalAmount.toFixed(2) + '.', config: updated };
  }

  async upsertEntity(type: 'mission' | 'store_item', id: string | undefined, data: Record<string, any>) {
    const collectionMap: Record<string, string> = {
      mission: 'missions',
      store_item: 'store_items'
    };

    const collectionName = collectionMap[type];
    if (!collectionName) {
      throw new AppError('Tipo de entidade inválido.', 400);
    }

    const docId = await this.adminRepository.upsertDocument(collectionName, id, data);
    return { success: true, id: docId, message: `${type} salvo com sucesso.` };
  }

  async getTrace(traceId: string) {
    if (!traceId) throw new AppError('traceId é obrigatório.', 400);
    const trace = await getPipelineTrace(traceId);
    if (!trace) throw new AppError('Trace não encontrado.', 404);
    return trace;
  }
}