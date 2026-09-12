import { createHash } from 'node:crypto';
import { ValidateActivityRequest, ValidateActivityResponse } from '../../_dto/activity-dto.js';
import { ActivityRepository } from '../../_repositories/activity-repository.js';
import { UserRepository } from '../../_repositories/user-repository.js';
import { AuditRepository } from '../../_repositories/audit-repository.js';
import { NotificationService } from '../notification-service.js';
import { AppError } from '../../_middleware/error.js';
import { SecurityPipeline } from '../../_lib/security-pipeline.js';
import { recalculateAllUserScores } from '../../_lib/igaService.js';
import { buscarHistoricoRecente } from '../../_lib/user-activity-history.js';
import { estimateCalories, formatPace } from '../../_lib/activity-metrics.js';
import { registrarAmostrasDeAtividade, HealthSampleSource } from '../../_lib/health-data-layer.js';
import { submitActivityToActiveChampionships } from '../../_lib/championship-scoring-service.js';
import { resolveModality } from '../../_lib/modality-config.js';
import { GpsEngine } from '../../_lib/gps-engine.js';
import { db } from '../../_lib/common.js';
import { sanitizeWorkoutHealthRecord } from '../../_lib/workout-health-record.js';
import { MissionEngine } from '../../_lib/mission-engine.js';
import { getLevelFromXP } from '../../_lib/xpConfig.js';
import {
  ACTIVITY_ECONOMY_VERSION,
  calculateCompletedActivityXP,
  isActivityEconomyEligible,
} from '../../_lib/activity-economy.js';
import { encontrarAtividadeDuplicada } from '../../_lib/activity-dedup.js';
import {
  ActivityIdentityInput,
  ActivityIdentityReservation,
  reserveActivityIdentity,
} from '../../_lib/activity-identity.js';
import { resolveMissionAccessSnapshot } from '../../_lib/mission-access.js';
import { promoteCanonicalCompetitionProjection } from '../../_lib/activity-competition-promotion.js';
import {
  ActivityCompetitionPolicy,
  loadActivityCompetitionPolicySnapshot,
  persistActivityCompetitionEntries,
} from '../../_lib/activity-competition-policy.js';

type CompetitionReviewStatus =
  | 'not_required'
  | 'approved'
  | 'pending_review'
  | 'ineligible'
  | 'rejected';

function normalizeTimestamp(value: Date | string | undefined | null): string {
  if (!value) return new Date().toISOString();
  return typeof value === 'string' ? value : value.toISOString();
}

function readDate(value: unknown, fallback = new Date()): Date {
  const parsed = value instanceof Date ? value : new Date(value as any);
  return Number.isFinite(parsed.getTime()) ? parsed : fallback;
}

function buildActivityId(userId: string, sessionId: unknown): string | undefined {
  const rawSessionId = String(sessionId || '').trim();
  if (!rawSessionId) return undefined;
  const digest = createHash('sha256').update(`${userId}\u0000${rawSessionId}`).digest('hex');
  return `activity_${digest}`;
}

async function validateCheckInOwnership(params: {
  userId: string;
  checkInId: string;
  policySnapshotId?: string;
  activitySessionId?: string;
  expectedGymIds?: string[];
  activityStart: Date;
}): Promise<{ valid: boolean; reason?: string }> {
  try {
    const snap = await db.collection('gym_checkins').doc(params.checkInId).get();
    const data = snap.data() || {};
    if (!snap.exists || data.userId !== params.userId || data.status !== 'confirmed') {
      return { valid: false, reason: 'Check-in presencial inválido ou pertencente a outra sessão.' };
    }
    if (params.policySnapshotId && data.activityPolicySnapshotId !== params.policySnapshotId) {
      return { valid: false, reason: 'O check-in não pertence a esta atividade competitiva.' };
    }
    if (params.activitySessionId && data.activitySessionId !== params.activitySessionId) {
      return { valid: false, reason: 'O check-in não pertence a esta sessão.' };
    }
    if (params.expectedGymIds?.length
      && params.expectedGymIds.some((gymId) => gymId !== String(data.gymId || ''))) {
      return { valid: false, reason: 'O check-in foi realizado em outra academia.' };
    }
    const confirmedAt = readDate(data.confirmedAt, new Date(0));
    const expiresAt = readDate(data.expiresAt, new Date(0));
    const distanceFromStart = Math.abs(params.activityStart.getTime() - confirmedAt.getTime());
    if (distanceFromStart > 20 * 60 * 1000 || params.activityStart > expiresAt) {
      return { valid: false, reason: 'O check-in deve ser realizado próximo ao início do treino.' };
    }
    return { valid: true };
  } catch (error: any) {
    return { valid: false, reason: error?.message || 'Não foi possível confirmar o check-in.' };
  }
}

export class ValidateActivityService {
  constructor(
    private activityRepository: ActivityRepository,
    private userRepository: UserRepository,
    private auditRepository: AuditRepository,
    private notificationService: NotificationService,
  ) {}

  private generateTraceId(): string {
    return `trace_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  }

  private validateInput(data: ValidateActivityRequest['activityData']): void {
    if (!data) throw new AppError('Dados da atividade são obrigatórios', 400);
    if (!data.type || typeof data.type !== 'string') throw new AppError('Tipo da atividade é obrigatório', 400);
    const duration = Number((data as any).duration ?? (data as any).durationMins);
    if (!Number.isFinite(duration) || duration < 0) {
      throw new AppError('Duração da atividade deve ser um número válido de minutos', 400);
    }
    if (duration > 360) throw new AppError('Duração excessiva (> 6 horas contínuas)', 422);
    if (data.intensity && !['low', 'moderate', 'high'].includes(data.intensity)) {
      throw new AppError('Intensidade inválida. Opções aceitas: low, moderate, high', 400);
    }
  }

  private calculateActivityXP(data: ValidateActivityRequest['activityData']): number {
    const duration = Number((data as any).duration ?? (data as any).durationMins) || 0;
    return calculateCompletedActivityXP({
      type: data.type,
      durationMinutes: duration,
      intensity: data.intensity,
    });
  }

  private async promoteStoredNativeDuplicate(existing: any): Promise<void> {
    const activityId = String(existing?.id || '').trim();
    const canonicalActivityId = String(existing?.canonicalActivityId || '').trim();
    const beforeStatus = String(existing?.competitionReviewStatusBeforeDedup || '');
    if (existing?.dataQualityStatus !== 'duplicate' || !activityId || !canonicalActivityId
      || !['approved', 'pending_review', 'rejected', 'ineligible'].includes(beforeStatus)
      || !existing.competitionPolicySnapshotId || !existing.sessionId) return;

    const policy = await loadActivityCompetitionPolicySnapshot({
      snapshotId: existing.competitionPolicySnapshotId,
      userId: existing.userId,
      activityType: existing.type,
      cardioType: existing.cardioType,
      isIndoorCardio: existing.isIndoorCardio,
      sessionId: existing.sessionId,
    });
    if (!policy?.contexts.length) return;
    await promoteCanonicalCompetitionProjection({
      userId: existing.userId,
      canonicalActivityId,
      evidenceActivityId: activityId,
      evidenceSource: 'invictus_native',
      startTime: existing.startTime || existing.createdAt,
      endTime: existing.endTime,
      durationMinutes: Number(existing.duration ?? existing.durationMins) || 0,
      distanceKm: Number(existing.distance ?? existing.distanceKm) || 0,
      activityType: policy.activityType,
      cardioType: policy.cardioType,
      isIndoorCardio: policy.isIndoorCardio,
      calories: Number(existing.calories) || undefined,
      avgHeartRate: Number(existing.avgHeartRate) || undefined,
      maxHeartRate: Number(existing.maxHeartRate) || undefined,
      policy,
      outcome: {
        status: beforeStatus as 'approved' | 'pending_review' | 'rejected' | 'ineligible',
        decision: existing.securityDecisionBeforeDedup || existing.securityDecision || null,
        reason: existing.nonScoringReasonBeforeDedup || null,
        riskScore: existing.securityRiskScoreBeforeDedup ?? existing.securityRiskScore,
        reportId: existing.securityReportIdBeforeDedup || existing.securityReportId || null,
        reviewApplied: existing.securityReviewAppliedBeforeDedup === true,
      },
      score: calculateCompletedActivityXP({
        type: policy.activityType,
        durationMinutes: Number(existing.duration ?? existing.durationMins) || 0,
        intensity: existing.intensity,
      }),
    });
  }

  private detectCompetitiveFraud(data: ValidateActivityRequest['activityData']): string | null {
    const duration = Number((data as any).duration ?? (data as any).durationMins);
    const steps = Number(data.evidence?.steps ?? (data as any).pedometerSteps);
    if (steps > 0 && duration > 0 && steps / duration > 300) {
      return 'Cadência de passos incompatível com atividade humana (> 300 spm).';
    }
    return null;
  }

  private async awardActivityXP(
    userId: string,
    activityId: string,
    amount: number,
  ): Promise<{ newXP: number; newLevel: number; credited: boolean }> {
    if (amount <= 0) {
      const user = await this.userRepository.findById(userId);
      const currentXP = Number((user as any)?.xp ?? (user as any)?.totalXp) || 0;
      return {
        newXP: currentXP,
        newLevel: Number((user as any)?.level) || getLevelFromXP(currentXP),
        credited: false,
      };
    }

    if (typeof (db as any).runTransaction === 'function') {
      return db.runTransaction(async (transaction: any) => {
        const ledgerRef = db.collection('activity_reward_ledger').doc(activityId);
        const userRef = db.collection('users').doc(userId);
        const [ledgerSnap, userSnap] = await Promise.all([
          transaction.get(ledgerRef),
          transaction.get(userRef),
        ]);
        const userData = userSnap.data() || {};
        const currentXP = Number(userData.xp ?? userData.totalXp) || 0;
        if (ledgerSnap.exists) {
          const ledger = ledgerSnap.data() || {};
          if (ledger.userId !== userId || ledger.origin !== 'completed_activity') {
            throw new Error('Ledger de atividade pertence a outro usuário ou origem.');
          }
          return {
            newXP: currentXP,
            newLevel: Number(userData.level) || getLevelFromXP(currentXP),
            credited: false,
          };
        }
        const newXP = currentXP + amount;
        const newLevel = getLevelFromXP(newXP);
        transaction.set(userRef, {
          xp: newXP,
          totalXp: newXP,
          level: newLevel,
          updatedAt: new Date().toISOString(),
        }, { merge: true });
        transaction.create(ledgerRef, {
          activityId,
          userId,
          xp: amount,
          origin: 'completed_activity',
          economyVersion: ACTIVITY_ECONOMY_VERSION,
          createdAt: new Date().toISOString(),
        });
        return { newXP, newLevel, credited: true };
      });
    }

    const result = await this.userRepository.addXP(userId, amount);
    return { ...result, credited: true };
  }

  private async reconcileCompletedActivity(
    existing: any,
    user: any,
  ): Promise<{
    xpResult: { newXP: number; newLevel: number; credited: boolean };
    recalculated: Awaited<ReturnType<typeof recalculateAllUserScores>> | null;
  }> {
    const activityId = String(existing?.id || '').trim();
    if (!activityId) throw new AppError('Atividade salva sem identificador para conciliação.', 500);

    const rawType = String(existing.type || '').toLowerCase();
    const activityType: 'workout' | 'cardio' = rawType === 'cardio' ? 'cardio' : 'workout';
    const contexts = Array.isArray(existing.competitionContexts) ? existing.competitionContexts : [];
    let competitionStatus = String(existing.competitionReviewStatus || existing.competitionStatus || 'not_required');
    const policy: ActivityCompetitionPolicy = {
      version: 'activity-competition-v2',
      activityType,
      ...(existing.cardioType ? { cardioType: String(existing.cardioType) } : {}),
      isIndoorCardio: existing.isIndoorCardio === true,
      resolvedAt: normalizeTimestamp(existing.competitionPolicyResolvedAt || existing.startTime || existing.createdAt),
      effectiveAt: normalizeTimestamp(existing.competitionPolicyEffectiveAt || existing.startTime || existing.createdAt),
      contexts,
      requiresSecurityReview: contexts.length > 0,
      requiresGymCheckIn: contexts.some((context: any) => context?.requiresGymCheckIn === true),
      requiresContinuousGps: contexts.some((context: any) => context?.requiresContinuousGps === true),
      requiresMotionSensors: contexts.some((context: any) => context?.requiresMotionSensors === true),
      snapshotId: existing.competitionPolicySnapshotId || undefined,
      sessionId: existing.sessionId || existing.activitySessionId || undefined,
    };
    if (existing.dataQualityStatus === 'dedup_pending') {
      try {
        const identityInput: ActivityIdentityInput = {
          userId: existing.userId,
          activityId,
          type: existing.type,
          cardioType: existing.cardioType,
          startTime: existing.startTime || existing.createdAt,
          endTime: existing.endTime,
          durationMinutes: Number(existing.duration ?? existing.durationMins) || 0,
          source: String(existing.source || 'invictus'),
        };
        const identity = await reserveActivityIdentity(identityInput);
        if (identity.status === 'pending') throw new Error('Outra origem ainda está reservando esta atividade.');
        const duplicate = identity.status === 'duplicate';
        const eligible = !duplicate && isActivityEconomyEligible({
          type: activityType,
          durationMinutes: Number(existing.duration ?? existing.durationMins) || 0,
        });
        const recoveredXP = eligible
          ? calculateCompletedActivityXP({
              type: activityType,
              durationMinutes: Number(existing.duration ?? existing.durationMins) || 0,
              intensity: existing.intensity,
            })
          : 0;
        const restoredCompetitionStatus = !duplicate
          ? String(existing.competitionReviewStatusBeforeDedup || '')
          : '';
        const restoredCompetitionReason = existing.nonScoringReasonBeforeDedup ?? null;
        const restoredMissionEligible = eligible
          && !['rejected', 'pending_review'].includes(restoredCompetitionStatus);
        const patch = {
          dataQualityStatus: duplicate ? 'duplicate' : 'accepted',
          canonicalActivityId: duplicate ? identity.canonicalActivityId : null,
          economyEligible: eligible,
          missionEligible: restoredMissionEligible,
          activityXpAwarded: recoveredXP,
          points: recoveredXP,
          pointsEarned: recoveredXP,
          scoreAwarded: recoveredXP,
          economyVersion: ACTIVITY_ECONOMY_VERSION,
          ...(restoredCompetitionStatus ? {
            competitionReviewStatus: restoredCompetitionStatus,
            competitionStatus: restoredCompetitionStatus,
            validationStatus: restoredCompetitionStatus === 'approved' ? 'validated'
              : restoredCompetitionStatus === 'not_required' ? 'recorded'
                : restoredCompetitionStatus === 'ineligible'
                  ? 'not_eligible'
                  : restoredCompetitionStatus === 'rejected' ? 'rejected' : 'pending_review',
            pendingReview: restoredCompetitionStatus === 'pending_review',
            isScoringEligible: restoredCompetitionStatus === 'approved',
            competitionPoints: restoredCompetitionStatus === 'approved' ? recoveredXP : 0,
            nonScoringReason: restoredCompetitionReason,
            rejectionReason: restoredCompetitionReason,
          } : {}),
          ...(duplicate ? {
            competitionReviewStatus: 'ineligible',
            competitionStatus: 'ineligible',
            validationStatus: 'not_eligible',
            pendingReview: false,
            isScoringEligible: false,
            competitionPoints: 0,
            securityDecision: 'DUPLICATE',
            missionEligible: false,
            nonScoringReason: 'DUPLICATE_ACTIVITY',
          } : {}),
        };
        if (!duplicate && identity.status === 'claimed'
          && typeof (this.activityRepository as any).updateWithIdentity === 'function') {
          const committed = await (this.activityRepository as any).updateWithIdentity(
            activityId,
            patch,
            { input: identityInput, reservation: identity },
          );
          if (!committed) throw new Error('A reserva econômica foi assumida por outra origem.');
        } else if (typeof (this.activityRepository as any).update === 'function') {
          await this.activityRepository.update(activityId, patch as any);
        }
        Object.assign(existing, patch);
        const beforeStatus = String(existing.competitionReviewStatusBeforeDedup || '');
        if (duplicate && contexts.length > 0
          && ['approved', 'pending_review', 'rejected', 'ineligible'].includes(beforeStatus)) {
          await promoteCanonicalCompetitionProjection({
            userId: existing.userId,
            canonicalActivityId: identity.canonicalActivityId,
            evidenceActivityId: activityId,
            evidenceSource: 'invictus_native',
            startTime: existing.startTime || existing.createdAt,
            endTime: existing.endTime,
            durationMinutes: Number(existing.duration ?? existing.durationMins) || 0,
            distanceKm: Number(existing.distance ?? existing.distanceKm) || 0,
            activityType,
            cardioType: existing.cardioType,
            isIndoorCardio: existing.isIndoorCardio === true,
            calories: Number(existing.calories) || undefined,
            avgHeartRate: Number(existing.avgHeartRate) || undefined,
            maxHeartRate: Number(existing.maxHeartRate) || undefined,
            policy,
            outcome: {
              status: beforeStatus as 'approved' | 'pending_review' | 'rejected' | 'ineligible',
              decision: existing.securityDecisionBeforeDedup || existing.securityDecision || null,
              reason: existing.nonScoringReasonBeforeDedup || null,
              riskScore: existing.securityRiskScoreBeforeDedup ?? existing.securityRiskScore,
              reportId: existing.securityReportIdBeforeDedup || existing.securityReportId || null,
              reviewApplied: existing.securityReviewAppliedBeforeDedup === true,
            },
            score: calculateCompletedActivityXP({
              type: activityType,
              durationMinutes: Number(existing.duration ?? existing.durationMins) || 0,
              intensity: existing.intensity,
            }),
          });
        }
        competitionStatus = String(existing.competitionReviewStatus || existing.competitionStatus || 'not_required');
      } catch {
        throw new AppError('Atividade salva; não foi possível conciliar XP e desafios agora. Tente finalizar novamente.', 503);
      }
    }
    const activityXP = existing.economyEligible === false
      ? 0
      : Math.max(0, Number(existing.activityXpAwarded ?? existing.points ?? existing.scoreAwarded) || 0);
    const approved = competitionStatus === 'approved';

    const xpPromise = this.awardActivityXP(existing.userId, activityId, activityXP);
    const missionOccurredAt = existing.endTime ?? existing.startTime ?? existing.timestamp ?? existing.createdAt;
    const missionPromise = MissionEngine.syncUserProgressFromCompletedActivities(
      existing.userId,
      missionOccurredAt ? [missionOccurredAt] : [],
    );
    const entryPromise = contexts.length > 0
      ? persistActivityCompetitionEntries({
          activityId,
          userId: existing.userId,
          policy,
          reviewStatus: approved
            ? 'approved'
            : competitionStatus === 'ineligible'
              ? 'ineligible'
              : competitionStatus === 'rejected'
                ? 'rejected'
                : 'pending_review',
          score: Number(existing.competitionPoints ?? activityXP) || 0,
          riskScore: existing.securityRiskScore,
          securityDecision: existing.securityDecision,
          securityReportId: existing.securityReportId,
          reasonCode: existing.nonScoringReason || existing.rejectionReason || null,
        })
      : Promise.resolve();
    const hasGymRanking = contexts.some((context: any) => context?.type === 'gym_ranking');
    const rankingPromise = approved && hasGymRanking
      ? recalculateAllUserScores(existing.userId)
      : Promise.resolve(null);
    const championshipPromise = approved
      ? submitActivityToActiveChampionships({
          userId: existing.userId,
          userName: user?.name || user?.displayName,
          userGymName: user?.gymName,
          activityId,
          activityType,
          isIndoorCardio: existing.isIndoorCardio,
          durationMinutes: Number(existing.duration ?? existing.durationMins) || 0,
          distanceKm: Number(existing.distance ?? existing.distanceKm) || 0,
          score: Number(existing.competitionPoints ?? activityXP) || 0,
          when: readDate(existing.endTime || existing.startTime || existing.createdAt),
          riskScore: existing.securityRiskScore,
          securityDecision: existing.securityDecision,
          securityReportId: existing.securityReportId,
          contexts,
        })
      : Promise.resolve();

    const [xpResult, recalculated] = await Promise.all([
      xpPromise,
      rankingPromise,
      championshipPromise,
      entryPromise,
      missionPromise,
    ]);
    const previousRankingPoints = Number(existing.rankingPointsEarned);
    const rankingPointsEarned = recalculated?.weekly.igaRanking
      ?? (Number.isFinite(previousRankingPoints) ? previousRankingPoints : 0);
    const completionPatch = {
      processingStatus: 'complete',
      processingCompletedAt: new Date().toISOString(),
      level: xpResult.newLevel,
      rankingPointsEarned,
    };
    if (typeof (this.activityRepository as any).update === 'function') {
      await this.activityRepository.update(activityId, completionPatch as any);
    }
    Object.assign(existing, completionPatch);
    return { xpResult, recalculated };
  }

  private responseFromExisting(existing: any, traceId: string): ValidateActivityResponse {
    const competitionStatus = String(existing.competitionReviewStatus || existing.competitionStatus || 'not_required');
    const message = existing.userMessage || (competitionStatus === 'pending_review'
      ? 'Atividade concluída e salva. A validação automática teve uma falha técnica e será tentada novamente.'
      : competitionStatus === 'rejected'
        ? 'Atividade concluída e salva. O antifraude não liberou esta atividade para a pontuação competitiva.'
        : 'Atividade já registrada e disponível no seu histórico.');
    return {
      success: true,
      activityId: existing.id,
      scoreAwarded: Number(existing.activityXpAwarded ?? existing.scoreAwarded) || 0,
      rankingPointsEarned: Number(existing.rankingPointsEarned) || 0,
      level: Number(existing.level) || 1,
      message,
      traceId,
      status: existing.validationStatus || 'recorded',
      recordStatus: existing.recordStatus || 'completed',
      activityMode: existing.activityMode || 'personal',
      competitionReviewStatus: competitionStatus,
      workout: {
        ...existing,
        timestamp: existing.createdAt || existing.endTime || new Date().toISOString(),
      },
      validation: {
        success: true,
        status: existing.validationStatus || 'recorded',
        score: competitionStatus === 'approved' ? 100 : 0,
        reasonCode: existing.nonScoringReason || null,
      },
      isScoringEligible: competitionStatus === 'approved',
    } as any;
  }

  async execute(request: ValidateActivityRequest): Promise<ValidateActivityResponse> {
    const traceId = this.generateTraceId();
    this.validateInput(request.activityData);

    const user = await this.userRepository.findById(request.userId);
    if (!user) throw new AppError('Usuário não encontrado no sistema', 404);

    const rawActivity: any = request.activityData || {};
    const workoutHealth = sanitizeWorkoutHealthRecord(rawActivity.healthSession);
    const { healthSession: _privateHealthSession, ...activityDataForAudit } = rawActivity;
    const duration = Number(rawActivity.duration ?? rawActivity.durationMins) || 0;
    const activityStart = readDate(rawActivity.startTime);
    const activityEnd = readDate(rawActivity.endTime, new Date());
    const activityId = buildActivityId(request.userId, rawActivity.sessionId || rawActivity.activitySessionId);

    if (activityId && typeof (this.activityRepository as any).findById === 'function') {
      const existing = await this.activityRepository.findById(activityId);
      if (existing) {
        await this.promoteStoredNativeDuplicate(existing).catch((error) => {
          console.error(`[ValidateActivityService] [${traceId}] Promoção competitiva pendente no retry:`, error);
        });
        if (existing.processingStatus === 'complete') {
          return this.responseFromExisting(existing, traceId);
        }
        const reconciliation = await this.reconcileCompletedActivity(existing, user);
        return this.responseFromExisting({
          ...existing,
          level: reconciliation.xpResult.newLevel,
          rankingPointsEarned: reconciliation.recalculated?.weekly.igaRanking
            ?? existing.rankingPointsEarned,
        }, traceId);
      }
    }

    if (!activityId) {
      const recent = await this.activityRepository.findRecentByUser(request.userId, 0.1);
      const duplicate = recent.some((item) => {
        const createdAt = item.createdAt ? new Date(item.createdAt).getTime() : 0;
        return createdAt >= Date.now() - 10_000
          && item.type === rawActivity.type
          && Number((item as any).duration ?? (item as any).durationMins) === duration;
      });
      if (duplicate) throw new AppError('Esta atividade já foi registrada.', 409);
    }

    const requiresSessionPolicy = ['workout', 'cardio'].includes(String(rawActivity.type).toLowerCase());
    let policy: ActivityCompetitionPolicy;
    if (requiresSessionPolicy) {
      if (!rawActivity.competitionPolicySnapshotId || !rawActivity.sessionId) {
        throw new AppError('A autorização desta sessão está ausente. A atividade continua no aparelho; atualize o app e tente finalizar novamente.', 409);
      }
      const frozenPolicy = await loadActivityCompetitionPolicySnapshot({
        snapshotId: rawActivity.competitionPolicySnapshotId,
        userId: request.userId,
        activityType: rawActivity.type,
        cardioType: rawActivity.cardioType,
        isIndoorCardio: rawActivity.isIndoorCardio,
        sessionId: rawActivity.sessionId,
      });
      if (!frozenPolicy) {
        throw new AppError('A autorização desta sessão é inválida ou expirou. A atividade não foi descartada; contate o suporte para recuperar o envio.', 409);
      }
      policy = frozenPolicy;

      const resolvedAt = readDate(policy.resolvedAt, new Date(0));
      const startBy = readDate(policy.startBy, new Date(0));
      const expiresAt = readDate(policy.expiresAt, new Date(0));
      const now = new Date();
      const hasValidActivityTimestamps = Number.isFinite(new Date(rawActivity.startTime).getTime())
        && Number.isFinite(new Date(rawActivity.endTime).getTime());
      if (!hasValidActivityTimestamps
        || activityEnd < activityStart
        || activityStart < new Date(resolvedAt.getTime() - 60_000)
        || activityStart > startBy
        || activityEnd > expiresAt
        || activityEnd > new Date(now.getTime() + 2 * 60_000)) {
        throw new AppError('Os horários desta sessão não correspondem à autorização emitida no início.', 422);
      }
      const wallClockMinutes = Math.max(0, (activityEnd.getTime() - activityStart.getTime()) / 60_000);
      if (duration > wallClockMinutes + 2) {
        throw new AppError('A duração informada é maior que o tempo real desta sessão.', 422);
      }
    } else {
      const now = new Date().toISOString();
      policy = {
        version: 'activity-competition-v2',
        activityType: 'workout',
        isIndoorCardio: false,
        resolvedAt: now,
        effectiveAt: now,
        contexts: [],
        requiresSecurityReview: false,
        requiresGymCheckIn: false,
        requiresContinuousGps: false,
        requiresMotionSensors: false,
      };
    }

    if (requiresSessionPolicy) {
      rawActivity.type = policy.activityType;
      rawActivity.cardioType = policy.cardioType;
      rawActivity.isIndoorCardio = policy.isIndoorCardio;
    }

    const modality = resolveModality(rawActivity);
    const routeReport = policy.requiresSecurityReview && policy.requiresContinuousGps
      ? GpsEngine.evaluate(rawActivity)
      : null;
    const distanceKm = routeReport ? routeReport.verifiedDistanceKm : Number(rawActivity.distanceKm) || 0;
    const calories = rawActivity.healthTelemetry?.calories > 0
      ? Number(rawActivity.healthTelemetry.calories)
      : estimateCalories({
          type: rawActivity.type,
          cardioType: rawActivity.cardioType,
          durationMins: duration,
          weightKg: (user as any).weight || (user as any).weightKg,
        });
    const pace = formatPace(distanceKm, duration);
    const healthSampleSource: HealthSampleSource = distanceKm > 0
      || (Array.isArray(rawActivity.checkpoints) && rawActivity.checkpoints.length > 0)
      ? 'invictus_gps'
      : 'invictus_manual';

    let competitionReviewStatus: CompetitionReviewStatus = policy.requiresSecurityReview ? 'approved' : 'not_required';
    let competitionReason: string | null = null;
    let securityDecision: string | null = null;
    let securityRiskScore: number | undefined;
    let securityReportId: string | null = null;
    let securityReviewApplied = false;
    let securityPassed = !policy.requiresSecurityReview;

    if (policy.requiresSecurityReview) {
      const simpleFraudReason = this.detectCompetitiveFraud(request.activityData);
      if (simpleFraudReason) {
        competitionReviewStatus = 'rejected';
        competitionReason = 'COMPETITIVE_SANITY_CHECK';
        securityDecision = 'UNDER_REVIEW';
      }

      if (competitionReviewStatus !== 'rejected' && policy.requiresGymCheckIn) {
        if (!rawActivity.checkInId) {
          competitionReviewStatus = 'ineligible';
          competitionReason = 'GEOFENCE_CHECKIN_REQUIRED';
        } else {
          const checkIn = await validateCheckInOwnership({
            userId: request.userId,
            checkInId: rawActivity.checkInId,
            policySnapshotId: rawActivity.competitionPolicySnapshotId,
            activitySessionId: rawActivity.sessionId,
            expectedGymIds: policy.contexts
              .filter((context) => context.requiresGymCheckIn && context.gymId)
              .map((context) => String(context.gymId)),
            activityStart,
          });
          if (!checkIn.valid) {
            competitionReviewStatus = 'ineligible';
            competitionReason = 'GEOFENCE_CHECKIN_INVALID';
          }
        }
      }

      // Mesmo quando uma regra objetiva torna a sessão inelegível para a
      // competição (ex.: check-in ausente), o antifraude ainda roda para que
      // uma atividade fraudada não possa alimentar missões/recompensas casuais.
      if (competitionReviewStatus !== 'rejected') {
        securityReviewApplied = true;
        try {
          const userHistory = await buscarHistoricoRecente(request.userId);
          const securityResult = await SecurityPipeline.runPipeline({
            id: activityId,
            activityType: modality?.antiFraudProfile || String(rawActivity.type || 'WORKOUT').toUpperCase(),
            type: String(rawActivity.type || 'WORKOUT').toUpperCase(),
            muscleGroup: rawActivity.muscleGroup,
            cardioType: rawActivity.cardioType,
            durationMins: duration,
            activeTimeMins: rawActivity.activeTimeMins,
            distanceKm,
            checkpoints: rawActivity.checkpoints,
            timestamp: rawActivity.startTime || new Date().toISOString(),
            source: 'UNIFIED_ACTIVITY_ENGINE',
            dataSource: rawActivity.dataSource ?? rawActivity.healthTelemetry?.source,
            avgHeartRate: rawActivity.avgHeartRate ?? rawActivity.healthTelemetry?.avgHeartRate,
            maxHeartRate: rawActivity.maxHeartRate ?? rawActivity.healthTelemetry?.maxHeartRate,
            steps: rawActivity.pedometerSteps ?? rawActivity.healthTelemetry?.steps ?? rawActivity.evidence?.steps,
            calories,
            cadence: rawActivity.cadence ?? rawActivity.smartwatchData?.cadence,
            powerWatts: rawActivity.powerWatts ?? rawActivity.smartwatchData?.powerWatts,
            maxObservedSpeedKmH: rawActivity.maxObservedSpeedKmH,
            gpsSpeedSampleCount: rawActivity.gpsSpeedSampleCount,
            smartwatchData: rawActivity.smartwatchData,
            healthTelemetry: rawActivity.healthTelemetry,
            metricSources: rawActivity.metricSources,
            sensorTelemetry: rawActivity.sensorTelemetry,
            requiresMotionEvidence: policy.requiresMotionSensors,
            isMockLocation: rawActivity.isMockLocation,
            isEmulator: rawActivity.isEmulator,
            isRooted: rawActivity.isRooted,
            isDeveloperMode: rawActivity.isDeveloperMode,
          }, request.userId, user || {}, userHistory);

          securityDecision = securityResult.decision;
          securityRiskScore = Number(securityResult.report?.risk?.riskScore);
          securityReportId = securityResult.report?.activityId || activityId || null;
          securityPassed = securityResult.shouldScore;

          if (['BLOCKED', 'UNDER_REVIEW', 'PARTIALLY_APPROVED'].includes(securityResult.decision)) {
            competitionReviewStatus = 'rejected';
            competitionReason = `SECURITY_PIPELINE_${securityResult.decision}`;
          } else if (!securityResult.report.validation.competitivelyEligible) {
            competitionReviewStatus = 'ineligible';
            competitionReason = securityResult.report.validation.ineligibleReason || 'COMPETITION_RULE_NOT_MET';
          } else if (competitionReviewStatus !== 'ineligible') {
            competitionReviewStatus = 'approved';
            competitionReason = null;
          }
        } catch (error: any) {
          competitionReviewStatus = 'pending_review';
          competitionReason = 'SECURITY_PIPELINE_ERROR';
          securityDecision = 'ERROR';
          securityPassed = false;
          console.error(`[ValidateActivityService] [${traceId}] Falha no pipeline competitivo:`, error);
        }
      }
    }

    const competitionReviewStatusBeforeDedup = competitionReviewStatus;
    const nonScoringReasonBeforeDedup = competitionReason;

    let economyEligible = isActivityEconomyEligible({
      type: rawActivity.type,
      durationMinutes: duration,
    });
    let activityXP = economyEligible ? this.calculateActivityXP(request.activityData) : 0;
    let dataQualityStatus: 'accepted' | 'duplicate' | 'dedup_pending' = 'accepted';
    let canonicalActivityId: string | null = null;
    let identityInput: ActivityIdentityInput | null = null;
    let identityReservation: Extract<ActivityIdentityReservation, { status: 'claimed' }> | null = null;
    if (economyEligible && activityId) {
      const knownDuplicate = await encontrarAtividadeDuplicada(request.userId, {
        inicio: activityStart,
        duracaoMin: duration,
        distanciaKm: distanceKm > 0 ? distanceKm : undefined,
        tipo: rawActivity.type,
        fonte: 'invictus',
        sourceActivityId: rawActivity.sessionId || rawActivity.activitySessionId,
      });
      if (knownDuplicate && knownDuplicate.id !== activityId) {
        dataQualityStatus = 'duplicate';
        canonicalActivityId = knownDuplicate.id;
      } else {
        try {
          const reservationInput: ActivityIdentityInput = {
            userId: request.userId,
            activityId,
            type: rawActivity.type,
            cardioType: rawActivity.cardioType,
            startTime: activityStart,
            endTime: activityEnd,
            durationMinutes: duration,
            source: 'invictus',
          };
          const identity = await reserveActivityIdentity(reservationInput);
          if (identity.status === 'duplicate') {
            dataQualityStatus = 'duplicate';
            canonicalActivityId = identity.canonicalActivityId;
          } else if (identity.status === 'pending') {
            dataQualityStatus = 'dedup_pending';
            canonicalActivityId = identity.canonicalActivityId;
          } else {
            identityInput = reservationInput;
            identityReservation = identity;
          }
        } catch (error) {
          console.warn(`[ValidateActivityService] [${traceId}] Reserva de identidade pendente:`, error);
          dataQualityStatus = 'dedup_pending';
        }
      }
      if (dataQualityStatus !== 'accepted') {
        economyEligible = false;
        activityXP = 0;
        if (policy.requiresSecurityReview) {
          competitionReviewStatus = dataQualityStatus === 'duplicate' ? 'ineligible' : 'pending_review';
          competitionReason = dataQualityStatus === 'duplicate' ? 'DUPLICATE_ACTIVITY' : 'DEDUPLICATION_UNAVAILABLE';
        }
      }
    }
    const competitionApproved = competitionReviewStatus === 'approved';
    const missionEligible = economyEligible
      && dataQualityStatus === 'accepted'
      && securityPassed
      && competitionReviewStatus !== 'rejected'
      && competitionReviewStatus !== 'pending_review';
    const validationStatus = competitionReviewStatus === 'not_required'
      ? 'recorded'
      : competitionReviewStatus === 'approved'
        ? 'validated'
        : competitionReviewStatus === 'ineligible'
          ? 'not_eligible'
          : competitionReviewStatus === 'rejected'
            ? 'rejected'
            : 'pending_review';
    const activityMode = policy.requiresSecurityReview ? 'competitive' : 'personal';

    const activityPayload = {
      ...workoutHealth,
      ...resolveMissionAccessSnapshot(user as any),
      schemaVersion: 2,
      userId: request.userId,
      type: rawActivity.type,
      muscleGroup: rawActivity.muscleGroup,
      cardioType: rawActivity.cardioType,
      cardioTypeLabel: rawActivity.cardioTypeLabel,
      isIndoorCardio: rawActivity.isIndoorCardio,
      requiresGpsDistance: rawActivity.requiresGpsDistance,
      duration,
      distance: distanceKm,
      trajectory: Array.isArray(rawActivity.checkpoints) ? rawActivity.checkpoints : undefined,
      avgHeartRate: rawActivity.avgHeartRate ?? rawActivity.healthTelemetry?.avgHeartRate ?? undefined,
      steps: rawActivity.pedometerSteps ?? rawActivity.healthTelemetry?.steps ?? rawActivity.evidence?.steps ?? undefined,
      calories,
      healthTelemetry: rawActivity.healthTelemetry ?? undefined,
      metricSources: rawActivity.metricSources ?? undefined,
      smartwatchData: rawActivity.smartwatchData ?? undefined,
      pace: pace ?? undefined,
      photoUrl: rawActivity.photoBase64 || undefined,
      intensity: rawActivity.intensity || 'moderate',
      startTime: rawActivity.startTime || activityStart.toISOString(),
      endTime: rawActivity.endTime || activityEnd.toISOString(),
      sessionId: rawActivity.sessionId || rawActivity.activitySessionId || null,
      competitionPolicySnapshotId: rawActivity.competitionPolicySnapshotId || policy.snapshotId || null,
      competitionPolicyVersion: policy.version,
      competitionPolicyResolvedAt: policy.resolvedAt,
      competitionPolicyEffectiveAt: policy.effectiveAt,
      competitionContexts: policy.contexts,
      activityMode,
      recordStatus: 'completed',
      competitionReviewStatus,
      competitionStatus: competitionReviewStatus,
      securityReviewApplied,
      securityDecision,
      securityRiskScore: Number.isFinite(securityRiskScore) ? securityRiskScore : null,
      securityReportId,
      economyEligible,
      missionEligible,
      economyVersion: ACTIVITY_ECONOMY_VERSION,
      dataQualityStatus,
      canonicalActivityId,
      processingStatus: 'pending',
      activityXpAwarded: activityXP,
      points: activityXP,
      pointsEarned: activityXP,
      scoreAwarded: activityXP,
      competitionPoints: competitionApproved ? activityXP : 0,
      rankingPointsEarned: 0,
      status: 'completed',
      validationStatus,
      pendingReview: competitionReviewStatus === 'pending_review',
      isScoringEligible: competitionApproved,
      nonScoringReason: competitionReason,
      rejectionReason: competitionReason,
      ...(dataQualityStatus !== 'accepted' && policy.requiresSecurityReview ? {
        competitionReviewStatusBeforeDedup,
        nonScoringReasonBeforeDedup,
        securityReviewAppliedBeforeDedup: securityReviewApplied,
        securityDecisionBeforeDedup: securityDecision,
        securityRiskScoreBeforeDedup: Number.isFinite(securityRiskScore) ? securityRiskScore : null,
        securityReportIdBeforeDedup: securityReportId,
      } : {}),
      evidence: rawActivity.evidence || {},
      traceId,
    };

    if (activityId && dataQualityStatus === 'duplicate' && canonicalActivityId
      && policy.contexts.length > 0 && competitionReviewStatusBeforeDedup !== 'not_required') {
      await promoteCanonicalCompetitionProjection({
        userId: request.userId,
        canonicalActivityId,
        evidenceActivityId: activityId,
        evidenceSource: 'invictus_native',
        startTime: activityStart,
        endTime: activityEnd,
        durationMinutes: duration,
        distanceKm,
        activityType: rawActivity.type === 'cardio' ? 'cardio' : 'workout',
        cardioType: rawActivity.cardioType,
        isIndoorCardio: rawActivity.isIndoorCardio === true,
        calories,
        avgHeartRate: rawActivity.avgHeartRate ?? rawActivity.healthTelemetry?.avgHeartRate,
        maxHeartRate: rawActivity.maxHeartRate ?? rawActivity.healthTelemetry?.maxHeartRate,
        policy,
        outcome: {
          status: competitionReviewStatusBeforeDedup,
          decision: securityDecision,
          reason: nonScoringReasonBeforeDedup,
          riskScore: securityRiskScore,
          reportId: securityReportId,
          reviewApplied: securityReviewApplied,
        },
        score: this.calculateActivityXP(request.activityData),
      });
    }

    let savedActivity: any;
    if (activityId && typeof (this.activityRepository as any).createIfAbsent === 'function') {
      const result = await (this.activityRepository as any).createIfAbsent(
        activityPayload,
        activityId,
        identityInput && identityReservation
          ? { input: identityInput, reservation: identityReservation }
          : undefined,
      );
      if (!result.created) {
        if (result.activity.processingStatus === 'complete') {
          return this.responseFromExisting(result.activity, traceId);
        }
        const reconciliation = await this.reconcileCompletedActivity(result.activity, user);
        return this.responseFromExisting({
          ...result.activity,
          level: reconciliation.xpResult.newLevel,
          rankingPointsEarned: reconciliation.recalculated?.weekly.igaRanking
            ?? result.activity.rankingPointsEarned,
        }, traceId);
      }
      savedActivity = result.activity;
    } else {
      savedActivity = await this.activityRepository.create(activityPayload, activityId);
    }

    const reconciliation = await this.reconcileCompletedActivity(savedActivity, user);
    await registrarAmostrasDeAtividade({
      userId: request.userId,
      source: healthSampleSource,
      sourceActivityId: savedActivity.id!,
      timestamp: normalizeTimestamp(rawActivity.startTime),
      aprovadoPeloAntifraude: securityPassed,
      pularDuplicata: savedActivity.dataQualityStatus !== 'accepted',
      avgHeartRate: rawActivity.avgHeartRate ?? rawActivity.healthTelemetry?.avgHeartRate,
      calories,
      distanceKm: distanceKm > 0 ? distanceKm : undefined,
      durationMin: duration > 0 ? duration : undefined,
    }).catch((error) => console.error(`[ValidateActivityService] [${traceId}] Saúde não persistida (não fatal):`, error));
    const { xpResult, recalculated } = reconciliation;
    const weeklyIgaScore = recalculated?.weekly.igaRanking || 0;

    const rewardMessage = missionEligible
      ? `Você ganhou +${activityXP} XP e a atividade conta para seus desafios.`
      : economyEligible
        ? `Você ganhou +${activityXP} XP, mas esta atividade não conta para missões enquanto não estiver validada.`
        : 'Sessões com menos de 1 minuto ficam no histórico, mas não geram XP, missão ou Coins.';
    const message = competitionReviewStatus === 'not_required'
      ? `Atividade concluída e salva! ${rewardMessage}`
      : competitionReviewStatus === 'approved'
        ? `Atividade concluída! ${rewardMessage} Sua pontuação competitiva foi validada.`
        : competitionReviewStatus === 'ineligible'
          ? `Atividade concluída e salva! ${rewardMessage} Ela não entrou na pontuação desta competição.`
          : competitionReviewStatus === 'rejected'
            ? `Atividade concluída e salva! ${rewardMessage} O antifraude não liberou esta atividade para a pontuação competitiva.`
            : `Atividade concluída e salva! ${rewardMessage} A validação automática teve uma falha técnica e será tentada novamente.`;

    await Promise.all([
      this.auditRepository.log({
        traceId,
        userId: request.userId,
        action: policy.requiresSecurityReview ? 'REGISTER_COMPETITIVE_ACTIVITY' : 'REGISTER_PERSONAL_ACTIVITY',
        details: {
          activityId: savedActivity.id,
          activityData: activityDataForAudit,
          activityXP,
          activityMode,
          competitionReviewStatus,
          competitionContexts: policy.contexts.map((context) => ({ type: context.type, id: context.id })),
        },
        result: ['pending_review', 'rejected'].includes(competitionReviewStatus) ? 'FLAGGED' : 'SUCCESS',
      }).catch((error) => {
        console.error(`[ValidateActivityService] [${traceId}] Log de auditoria não persistido (não fatal):`, error);
      }),
      this.notificationService.send({
        userId: request.userId,
        title: competitionReviewStatus === 'pending_review'
          ? 'Atividade salva'
          : competitionReviewStatus === 'rejected'
            ? 'Atividade não validada'
            : 'Atividade concluída!',
        body: message,
        type: 'activity_validated',
        data: { activityId: savedActivity.id, activityXP, competitionReviewStatus, traceId },
      }).catch(() => undefined),
    ]);

    return {
      success: true,
      ...workoutHealth,
      activityId: savedActivity.id || '',
      scoreAwarded: activityXP,
      rankingPointsEarned: weeklyIgaScore,
      newRankingScore: recalculated?.season.average,
      level: xpResult.newLevel,
      message,
      userMessage: message,
      traceId,
      recordStatus: 'completed',
      activityMode,
      competitionReviewStatus,
      competitionContexts: policy.contexts,
      pending: competitionReviewStatus === 'pending_review',
      workout: {
        ...workoutHealth,
        id: savedActivity.id,
        points: activityXP,
        activityXpAwarded: activityXP,
        competitionPoints: competitionApproved ? activityXP : 0,
        rankingPointsEarned: weeklyIgaScore,
        level: xpResult.newLevel,
        status: 'completed',
        recordStatus: 'completed',
        validationStatus,
        activityMode,
        competitionReviewStatus,
        competitionContexts: policy.contexts,
        type: rawActivity.type,
        muscleGroup: rawActivity.muscleGroup,
        cardioType: rawActivity.cardioType,
        cardioTypeLabel: rawActivity.cardioTypeLabel,
        distance: distanceKm,
        duration,
        calories,
        avgHeartRate: rawActivity.avgHeartRate ?? rawActivity.healthTelemetry?.avgHeartRate,
        steps: rawActivity.pedometerSteps ?? rawActivity.healthTelemetry?.steps,
        timestamp: savedActivity.createdAt || activityEnd.toISOString(),
      },
      validation: {
        success: true,
        status: validationStatus,
        competitionStatus: competitionReviewStatus,
        score: competitionApproved ? 100 : 0,
        reasonCode: competitionReason,
      },
      isScoringEligible: competitionApproved,
      nonScoringReason: competitionReason,
      reasonCode: competitionReason,
      canRetry: competitionReviewStatus === 'pending_review',
    } as any;
  }
}
