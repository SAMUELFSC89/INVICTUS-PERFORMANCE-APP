import { db } from './common.js';
import { SecurityPipeline } from './security-pipeline.js';
import { buscarHistoricoRecente } from './user-activity-history.js';
import { resolveModality } from './modality-config.js';
import { recalculateAllUserScores } from './igaService.js';
import { syncReviewedActivityCompetitionScores } from './championship-scoring-service.js';
import { classifyPendingReview, resolveSecurityRetryResult } from './pending-review-policy.js';
import { MissionEngine } from './mission-engine.js';
import { reconcileCardioObjectiveActivity } from './cardio-objective-activity-sync.js';

export interface PendingReviewReconcileStats {
  checked: number;
  resolved: number;
  resolvedIds: string[];
  securityRetried: number;
  manualReview: number;
  technicalPending: number;
}

function numberOrZero(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function reviewReason(workout: Record<string, any>): string {
  return String(workout.nonScoringReason || workout.rejectionReason || 'AUTO_REVIEW_RESOLVED');
}

async function finalizeCompetitionReview(params: {
  doc: FirebaseFirestore.QueryDocumentSnapshot;
  workout: Record<string, any>;
  status: 'approved' | 'rejected' | 'ineligible';
  reason?: string | null;
  security?: {
    decision?: string | null;
    riskScore?: number | null;
    reportId?: string | null;
  };
}) {
  const { doc, workout, status, security } = params;
  const approved = status === 'approved';
  const competitionPoints = approved
    ? Math.max(0, numberOrZero(workout.activityXpAwarded ?? workout.scoreAwarded ?? workout.points))
    : 0;
  const reason = approved ? null : (params.reason || reviewReason(workout));
  const now = new Date().toISOString();
  const userId = String(workout.userId || '');
  const entriesSnap = await db.collection('activity_competition_entries')
    .where('activityId', '==', doc.id)
    .get();

  const batch = db.batch();
  batch.set(doc.ref, {
    status: 'completed',
    validationStatus: approved ? 'validated' : status === 'ineligible' ? 'not_eligible' : 'rejected',
    competitionReviewStatus: status,
    competitionStatus: status,
    competitionPoints,
    isScoringEligible: approved,
    pendingReview: false,
    // Fraude terminal nunca pode continuar marcada como elegível a missão.
    // Inelegibilidade exclusivamente competitiva preserva a validade casual.
    ...(status === 'rejected' ? { missionEligible: false } : {}),
    nonScoringReason: reason,
    rejectionReason: reason,
    processingStatus: 'complete',
    autoReviewResolvedAt: now,
    autoReviewResolution: status,
    ...(security ? {
      securityReviewApplied: true,
      securityDecision: security.decision ?? workout.securityDecision ?? null,
      securityRiskScore: Number.isFinite(Number(security.riskScore)) ? Number(security.riskScore) : null,
      securityReportId: security.reportId ?? workout.securityReportId ?? null,
    } : {}),
    updatedAt: now,
  }, { merge: true });

  entriesSnap.docs.forEach((entry) => {
    batch.set(entry.ref, {
      reviewStatus: status,
      competitionPoints,
      reasonCode: reason,
      autoReviewedAt: now,
      updatedAt: now,
    }, { merge: true });
  });
  await batch.commit();

  if (!userId) return;
  const affectedAt = workout.endTime ?? workout.startTime ?? workout.timestamp ?? workout.createdAt;
  await Promise.all([
    syncReviewedActivityCompetitionScores(doc.id),
    recalculateAllUserScores(userId),
    MissionEngine.syncUserProgressFromCompletedActivities(userId, affectedAt ? [affectedAt] : []),
    ...(approved && String(workout.type || '').toLowerCase() === 'cardio'
      ? [reconcileCardioObjectiveActivity(userId, doc.id)] : []),
  ]);
}

async function retrySecurityPipeline(doc: FirebaseFirestore.QueryDocumentSnapshot, workout: Record<string, any>) {
  const userId = String(workout.userId || '');
  if (!userId) throw new Error('Atividade pendente sem userId.');
  const [userSnap, history] = await Promise.all([
    db.collection('users').doc(userId).get(),
    buscarHistoricoRecente(userId),
  ]);
  const user = userSnap.data() || {};
  const modality = resolveModality(workout);
  const contexts = Array.isArray(workout.competitionContexts) ? workout.competitionContexts : [];
  const requiresMotionEvidence = contexts.some((context: any) => context?.requiresMotionSensors === true);
  const checkpoints = Array.isArray(workout.trajectory)
    ? workout.trajectory
    : Array.isArray(workout.checkpoints) ? workout.checkpoints : [];

  const result = await SecurityPipeline.runPipeline({
    id: doc.id,
    activityType: modality?.antiFraudProfile || String(workout.type || 'WORKOUT').toUpperCase(),
    type: String(workout.type || 'WORKOUT').toUpperCase(),
    muscleGroup: workout.muscleGroup,
    cardioType: workout.cardioType,
    durationMins: numberOrZero(workout.duration ?? workout.durationMins),
    distanceKm: numberOrZero(workout.distance ?? workout.distanceKm),
    checkpoints,
    timestamp: workout.startTime || workout.createdAt || new Date().toISOString(),
    source: 'UNIFIED_ACTIVITY_ENGINE',
    avgHeartRate: workout.avgHeartRate ?? workout.healthTelemetry?.avgHeartRate,
    steps: workout.steps ?? workout.pedometerSteps ?? workout.healthTelemetry?.steps ?? workout.evidence?.steps,
    calories: workout.calories,
    smartwatchData: workout.smartwatchData,
    healthTelemetry: workout.healthTelemetry,
    metricSources: workout.metricSources,
    sensorTelemetry: workout.sensorTelemetry,
    requiresMotionEvidence,
    isMockLocation: workout.isMockLocation,
    isEmulator: workout.isEmulator,
    isRooted: workout.isRooted,
    isDeveloperMode: workout.isDeveloperMode,
  }, userId, user, history);

  const resolution = resolveSecurityRetryResult({
    decision: result.decision,
    competitivelyEligible: result.report.validation.competitivelyEligible !== false,
  });
  const security = {
    decision: result.decision,
    riskScore: numberOrZero(result.report.risk?.riskScore),
    reportId: result.report.activityId || doc.id,
  };

  if (resolution === 'pending_review') {
    const now = new Date().toISOString();
    await doc.ref.set({
      securityReviewApplied: true,
      securityDecision: result.decision,
      securityRiskScore: security.riskScore,
      securityReportId: security.reportId,
      nonScoringReason: `SECURITY_PIPELINE_${result.decision}`,
      rejectionReason: `SECURITY_PIPELINE_${result.decision}`,
      pendingReview: true,
      technicalRetryCount: numberOrZero(workout.technicalRetryCount) + 1,
      technicalRetryAt: now,
      updatedAt: now,
    }, { merge: true });
    return { resolved: false, becameManual: true };
  }

  await finalizeCompetitionReview({
    doc,
    workout,
    status: resolution,
    reason: resolution === 'approved'
      ? null
      : result.report.validation.ineligibleReason || `SECURITY_PIPELINE_${result.decision}`,
    security,
  });
  return { resolved: true, becameManual: false };
}

export async function reconcilePendingActivityReviews(params: {
  userId?: string;
  limit?: number;
} = {}): Promise<PendingReviewReconcileStats> {
  const limit = Math.min(100, Math.max(1, Number(params.limit) || 100));
  let pendingQuery: FirebaseFirestore.Query = db.collection('workouts')
    .where('pendingReview', '==', true);
  if (params.userId) pendingQuery = pendingQuery.where('userId', '==', params.userId);
  const pendingSnap = await pendingQuery.limit(limit).get();

  const stats: PendingReviewReconcileStats = {
    checked: 0,
    resolved: 0,
    resolvedIds: [],
    securityRetried: 0,
    manualReview: 0,
    technicalPending: 0,
  };

  for (const doc of pendingSnap.docs) {
    stats.checked++;
    const workout: any = { id: doc.id, ...doc.data() };
    const action = classifyPendingReview(workout);
    try {
      if (action === 'reject' || action === 'ineligible') {
        await finalizeCompetitionReview({
          doc,
          workout,
          status: action === 'reject' ? 'rejected' : 'ineligible',
          reason: reviewReason(workout),
        });
        stats.resolved++;
        stats.resolvedIds.push(doc.id);
        continue;
      }
      if (action === 'retry_security') {
        stats.securityRetried++;
        const result = await retrySecurityPipeline(doc, workout);
        if (result.resolved) {
          stats.resolved++;
          stats.resolvedIds.push(doc.id);
        } else if (result.becameManual) {
          stats.manualReview++;
        }
        continue;
      }
      if (action === 'technical_pending') {
        stats.technicalPending++;
        continue;
      }
      stats.manualReview++;
    } catch (error: any) {
      stats.technicalPending++;
      const now = new Date().toISOString();
      await doc.ref.set({
        technicalRetryCount: numberOrZero(workout.technicalRetryCount) + 1,
        technicalRetryAt: now,
        technicalRetryLastError: String(error?.message || 'Falha técnica na reconciliação').slice(0, 300),
        updatedAt: now,
      }, { merge: true }).catch(() => undefined);
      console.error(`[PendingReviewReconciler] Falha ao reconciliar ${doc.id}:`, error);
    }
  }

  return stats;
}
