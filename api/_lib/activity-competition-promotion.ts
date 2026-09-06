import { db } from './common.js';
import {
  ActivityCompetitionPolicy,
  persistActivityCompetitionEntries,
} from './activity-competition-policy.js';
import {
  submitActivityToActiveChampionships,
  syncReviewedActivityCompetitionScores,
} from './championship-scoring-service.js';
import { recalculateAllUserScores } from './igaService.js';

export type TrustedCompetitionOutcome = {
  status: 'approved' | 'pending_review' | 'rejected' | 'ineligible';
  decision: string | null;
  reason?: string | null;
  riskScore?: number;
  reportId?: string | null;
  reviewApplied?: boolean;
};

function readDate(value: unknown): Date | null {
  const parsed = value instanceof Date ? value : new Date(value as any);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function evidencePriority(source: unknown): number {
  if (source === 'invictus_native') return 2;
  if (source === 'strava_oauth') return 1;
  return 0;
}

function finiteMetric(value: unknown, min: number, max: number): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

/**
 * Mantém uma única atividade/um único XP, mas permite que evidência confiável
 * posterior (Strava OAuth ou sessão nativa) promova a projeção competitiva do
 * canônico criado antes por Apple Health/Health Connect.
 */
export async function promoteCanonicalCompetitionProjection(params: {
  userId: string;
  canonicalActivityId: string;
  evidenceActivityId: string;
  evidenceSource: 'strava_oauth' | 'invictus_native';
  startTime: Date | string;
  endTime: Date | string;
  durationMinutes: number;
  distanceKm?: number;
  activityType: 'workout' | 'cardio';
  cardioType?: string;
  isIndoorCardio?: boolean;
  calories?: number;
  avgHeartRate?: number;
  maxHeartRate?: number;
  policy: ActivityCompetitionPolicy;
  outcome: TrustedCompetitionOutcome;
  score: number;
}): Promise<{ promoted: boolean; activityId: string }> {
  if (!params.policy.contexts.length) return { promoted: false, activityId: params.canonicalActivityId };
  const canonicalRef = db.collection('workouts').doc(params.canonicalActivityId);
  const transactionResult = await db.runTransaction(async (transaction: any) => {
    const snap = await transaction.get(canonicalRef);
    if (!snap.exists) return { promoted: false };
    const canonical = snap.data() || {};
    if (canonical.userId !== params.userId) throw new Error('Atividade canônica pertence a outro usuário.');
    if (!['apple_health', 'health_connect'].includes(String(canonical.source || '').toLowerCase())) {
      return { promoted: false };
    }

    const sameEvidence = canonical.competitionEvidenceActivityId === params.evidenceActivityId
      && canonical.competitionEvidenceSource === params.evidenceSource;
    const alreadyTrusted = canonical.competitionEvidenceStatus === 'trusted_server_source'
      || canonical.competitionEvidenceStatus === 'trusted_native_attestation';
    const incomingPriority = evidencePriority(params.evidenceSource);
    const currentPriority = Number(canonical.competitionEvidencePriority)
      || (canonical.competitionEvidenceStatus === 'trusted_native_attestation'
        ? 3 : evidencePriority(canonical.competitionEvidenceSource));
    const incomingApproved = params.outcome.status === 'approved';
    const currentApproved = canonical.competitionReviewStatus === 'approved'
      && canonical.isScoringEligible === true;
    if (alreadyTrusted && !sameEvidence) {
      // Uma aprovação nunca é rebaixada. Evidência superior pode substituir
      // métricas/status anteriores; uma aprovação também pode sanar uma
      // decisão não aprovada de prioridade igual.
      const mayReplace = currentApproved
        ? incomingApproved && incomingPriority > currentPriority
        : incomingPriority > currentPriority
          || (incomingApproved && incomingPriority >= currentPriority);
      if (!mayReplace) return { promoted: false };
    }
    if (alreadyTrusted && sameEvidence && canonical.processingStatus === 'complete') {
      return { promoted: false };
    }

    const canonicalStart = readDate(canonical.startTime || canonical.timestamp || canonical.createdAt);
    const incomingStart = readDate(params.startTime);
    const incomingEnd = readDate(params.endTime);
    if (!canonicalStart || !incomingStart || !incomingEnd || incomingEnd <= incomingStart) {
      return { promoted: false };
    }
    const canonicalDuration = Math.max(0, Number(canonical.duration ?? canonical.durationMins) || 0);
    const canonicalEnd = readDate(canonical.endTime)
      || new Date(canonicalStart.getTime() + canonicalDuration * 60_000);
    const overlapMs = Math.min(canonicalEnd.getTime(), incomingEnd.getTime())
      - Math.max(canonicalStart.getTime(), incomingStart.getTime());
    const minimumOverlap = Math.min(
      5 * 60_000,
      Math.min(canonicalEnd.getTime() - canonicalStart.getTime(), incomingEnd.getTime() - incomingStart.getTime()) * 0.25,
    );
    if (overlapMs < minimumOverlap) return { promoted: false };

    // A identidade wearable limita somente a economia (um XP/missão). A
    // projeção competitiva pertence integralmente à policy resolvida pelo
    // servidor para a fonte confiável no instante real da atividade; exigir
    // contexts do wearable permitiria ao payload cliente bloquear a promoção.
    const contexts = params.policy.contexts;
    if (!contexts.length) return { promoted: false };

    const approved = params.outcome.status === 'approved';
    const competitionPoints = approved ? Math.max(0, Math.round(params.score)) : 0;
    const competitionEvidenceMetrics = {
      activityType: params.activityType,
      cardioType: params.cardioType || null,
      isIndoorCardio: params.isIndoorCardio === true,
      startTime: incomingStart.toISOString(),
      endTime: incomingEnd.toISOString(),
      durationMinutes: finiteMetric(params.durationMinutes, 0.01, 360),
      distanceKm: finiteMetric(params.distanceKm, 0, 1000),
      avgHeartRate: finiteMetric(params.avgHeartRate, 30, 240),
      maxHeartRate: finiteMetric(params.maxHeartRate, 30, 260),
      calories: finiteMetric(params.calories, 0, 10_000),
    };
    if (competitionEvidenceMetrics.durationMinutes === null) return { promoted: false };
    transaction.set(canonicalRef, {
      activityMode: 'competitive',
      validationStatus: approved ? 'validated'
        : ['ineligible', 'rejected'].includes(params.outcome.status) ? 'not_eligible' : 'pending_review',
      competitionReviewStatus: params.outcome.status,
      competitionStatus: params.outcome.status,
      competitionContexts: contexts,
      competitionPolicyVersion: params.policy.version,
      competitionPolicySnapshotId: params.policy.snapshotId || null,
      competitionPolicyResolvedAt: params.policy.resolvedAt,
      competitionPolicyEffectiveAt: params.policy.effectiveAt,
      competitionEvidenceStatus: 'trusted_server_source',
      competitionEvidenceSource: params.evidenceSource,
      competitionEvidenceActivityId: params.evidenceActivityId,
      competitionEvidencePriority: incomingPriority,
      competitionEvidenceMetrics,
      securityReviewApplied: params.outcome.reviewApplied !== false,
      securityDecision: params.outcome.decision,
      securityRiskScore: Number.isFinite(params.outcome.riskScore) ? params.outcome.riskScore : null,
      securityReportId: params.outcome.reportId || null,
      pendingReview: params.outcome.status === 'pending_review',
      isScoringEligible: approved,
      nonScoringReason: params.outcome.reason || null,
      competitionPoints,
      processingStatus: 'pending',
      updatedAt: new Date().toISOString(),
    }, { merge: true });
    return {
      promoted: true,
      contexts,
      competitionPoints,
      wasScoring: canonical.isScoringEligible === true || Number(canonical.competitionPoints) > 0,
    };
  });

  if (!transactionResult.promoted || !transactionResult.contexts) {
    return { promoted: false, activityId: params.canonicalActivityId };
  }
  const effectivePolicy: ActivityCompetitionPolicy = {
    ...params.policy,
    contexts: transactionResult.contexts,
    requiresSecurityReview: true,
    requiresGymCheckIn: transactionResult.contexts.some((context: any) => context.requiresGymCheckIn === true),
    requiresContinuousGps: transactionResult.contexts.some((context: any) => context.requiresContinuousGps === true),
    requiresMotionSensors: transactionResult.contexts.some((context: any) => context.requiresMotionSensors === true),
  };
  await persistActivityCompetitionEntries({
    activityId: params.canonicalActivityId,
    userId: params.userId,
    policy: effectivePolicy,
    reviewStatus: params.outcome.status,
    score: transactionResult.competitionPoints,
    riskScore: params.outcome.riskScore,
    securityDecision: params.outcome.decision,
    securityReportId: params.outcome.reportId,
    reasonCode: params.outcome.reason,
  });

  let rankingPointsEarned = 0;
  if (params.outcome.status === 'approved') {
    if (effectivePolicy.contexts.some(context => context.type === 'gym_ranking')) {
      const recalculated = await recalculateAllUserScores(params.userId);
      rankingPointsEarned = recalculated.weekly.igaRanking;
    }
    const userSnap = await db.collection('users').doc(params.userId).get();
    const user = userSnap.data() || {};
    await submitActivityToActiveChampionships({
      userId: params.userId,
      userName: user.name || user.displayName,
      userGymName: user.gymName,
      activityId: params.canonicalActivityId,
      activityType: params.activityType,
      isIndoorCardio: params.isIndoorCardio,
      durationMinutes: params.durationMinutes,
      distanceKm: params.distanceKm,
      score: transactionResult.competitionPoints,
      when: readDate(params.endTime) || new Date(),
      riskScore: params.outcome.riskScore,
      securityDecision: params.outcome.decision,
      securityReportId: params.outcome.reportId,
      contexts: effectivePolicy.contexts,
    });
  } else if (transactionResult.wasScoring) {
    await syncReviewedActivityCompetitionScores(params.canonicalActivityId);
    await recalculateAllUserScores(params.userId);
  }
  await canonicalRef.set({
    processingStatus: 'complete',
    processingCompletedAt: new Date().toISOString(),
    rankingPointsEarned,
    updatedAt: new Date().toISOString(),
  }, { merge: true });
  return { promoted: true, activityId: params.canonicalActivityId };
}
