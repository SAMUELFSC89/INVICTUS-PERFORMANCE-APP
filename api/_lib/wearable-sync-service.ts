import { createHash } from 'node:crypto';
import { db, FieldValue } from './common.js';
import { encontrarAtividadeDuplicada } from './activity-dedup.js';
import { recalculateAllUserScores } from './igaService.js';
import { registrarAmostrasDeAtividade } from './health-data-layer.js';
import {
  ActivityCompetitionPolicy,
  persistActivityCompetitionEntries,
  resolveActivityCompetitionPolicy,
} from './activity-competition-policy.js';
import {
  submitActivityToActiveChampionships,
  syncReviewedActivityCompetitionScores,
} from './championship-scoring-service.js';
import {
  ACTIVITY_ECONOMY_VERSION,
  calculateCompletedActivityXP,
  isActivityEconomyEligible,
} from './activity-economy.js';
import { settleCompletedActivityRewards } from './activity-reward-service.js';
import {
  ActivityIdentityInput,
  ActivityIdentityReservation,
  commitActivityIdentityReservation,
  reserveActivityIdentity,
} from './activity-identity.js';
import { MissionEngine } from './mission-engine.js';
import {
  preserveMissionAccessSnapshot,
  resolveExternalMissionAccessSnapshot,
} from './mission-access.js';

export interface WearableActivityPayload {
  source: 'apple_health' | 'health_connect';
  sourceActivityId: string;
  activityType: string;
  isIndoorCardio?: boolean;
  startTime: string;
  durationSeconds: number;
  distanceMeters?: number;
  calories?: number;
  averageHeartRate?: number;
  maxHeartRate?: number;
  steps?: number;
  heartRateSamples?: { timestamp: string; bpm: number }[];
  checkpoints?: { latitude: number; longitude: number; timestamp?: string }[];
}

export interface ResultadoIngestaoAtividade {
  sourceActivityId: string;
  /** `approved` significa que o registro pessoal foi aceito. */
  status: 'approved' | 'duplicate' | 'blocked' | 'error';
  competitionReviewStatus?: 'not_required' | 'approved' | 'pending_review' | 'rejected' | 'ineligible';
  detalhe?: string;
}

type CompetitionOutcome = {
  status: 'not_required' | 'approved' | 'pending_review' | 'rejected' | 'ineligible';
  decision: string | null;
  riskScore?: number;
  reportId?: string | null;
  reason?: string | null;
  reviewApplied: boolean;
};

type WearableProcessOptions = { syncMissions?: boolean; profileAvailable?: boolean };
const RETRYABLE_COMPETITION_REASONS = new Set([
  'PROFILE_UNAVAILABLE',
  'SECURITY_PIPELINE_ERROR',
  'DEDUPLICATION_UNAVAILABLE',
]);

function classificarTipo(activityType: string): {
  tipo: string;
  type: 'workout' | 'cardio';
  cardioType?: string;
  isRun: boolean;
  supported: boolean;
} {
  const raw = String(activityType || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const isRun = raw.includes('corrida') || raw.includes('run');
  const isWalk = raw.includes('caminhada') || raw.includes('walk') || raw.includes('hike') || raw.includes('trilha');
  const isBike = raw.includes('bike') || raw.includes('cycl') || raw.includes('pedalada') || raw.includes('ciclismo');
  const isSwim = raw.includes('nata') || raw.includes('swim');
  const isElliptical = raw.includes('ellipt') || raw.includes('elipt');
  const isRowing = raw.includes('rowing') || raw.includes('remo');
  const isStairs = raw.includes('stair') || raw.includes('escada');
  const isGenericCardio = raw.includes('cardio') || raw.includes('aerobic') || raw.includes('hiit');
  const isCardio = isRun || isWalk || isBike || isSwim || isElliptical || isRowing || isStairs || isGenericCardio;
  const isStrength = raw.includes('muscul') || raw.includes('strength') || raw.includes('weight')
    || raw.includes('resistance') || raw.includes('bodybuild') || raw.includes('crossfit')
    || raw.includes('functional') || raw.includes('forca');
  const cardioType = isRun ? 'corrida'
    : isWalk ? 'caminhada'
      : isBike ? 'ciclismo'
        : isSwim ? 'natacao'
          : isElliptical ? 'eliptico'
            : isRowing ? 'remo'
              : isStairs ? 'escada'
                : isCardio ? 'cardio' : undefined;
  return {
    tipo: activityType,
    type: isCardio ? 'cardio' : 'workout',
    cardioType,
    isRun,
    supported: isCardio || isStrength,
  };
}

function wearableDocumentId(userId: string, activity: WearableActivityPayload): string {
  const digest = createHash('sha256')
    .update(`${userId}\u0000${activity.source}\u0000${activity.sourceActivityId}`)
    .digest('hex');
  return `wearable_${digest}`;
}

function policyFromActivity(activity: Record<string, any>): ActivityCompetitionPolicy {
  const contexts = Array.isArray(activity.competitionContexts) ? activity.competitionContexts : [];
  return {
    version: 'activity-competition-v2',
    activityType: activity.type === 'cardio' ? 'cardio' : 'workout',
    cardioType: activity.cardioType,
    isIndoorCardio: activity.isIndoorCardio === true,
    resolvedAt: activity.competitionPolicyResolvedAt || activity.createdAt,
    effectiveAt: activity.competitionPolicyEffectiveAt || activity.startTime || activity.createdAt,
    contexts,
    requiresSecurityReview: contexts.length > 0,
    requiresGymCheckIn: contexts.some((context: any) => context?.requiresGymCheckIn === true),
    requiresContinuousGps: contexts.some((context: any) => context?.requiresContinuousGps === true),
    requiresMotionSensors: contexts.some((context: any) => context?.requiresMotionSensors === true),
  };
}

function healthEvidenceAccepted(activity: Record<string, any>): boolean {
  // Health confidence describes sanitized sensor provenance, not whether the
  // separate competition projection was approved. Duplicates are skipped by
  // the caller; every remaining sensor record keeps stable personal quality.
  void activity;
  return true;
}

async function enforceUnattestedWearableProjection(
  activityId: string,
  activity: Record<string, any>,
): Promise<boolean> {
  const source = String(activity.source || '').toLowerCase();
  const isClientWearable = source === 'apple_health' || source === 'health_connect';
  const trusted = activity.competitionEvidenceStatus === 'trusted_native_attestation'
    || activity.competitionEvidenceStatus === 'trusted_server_source';
  const wasScoring = activity.isScoringEligible === true
    || activity.competitionReviewStatus === 'approved'
    || Number(activity.competitionPoints) > 0;
  if (!isClientWearable || trusted || !wasScoring) return false;

  const patch = {
    validationStatus: 'not_eligible',
    competitionReviewStatus: 'ineligible',
    competitionStatus: 'ineligible',
    competitionEvidenceStatus: 'untrusted_client_import',
    securityReviewApplied: false,
    securityDecision: 'ATTESTATION_REQUIRED',
    pendingReview: false,
    isScoringEligible: false,
    nonScoringReason: 'UNVERIFIED_WEARABLE_SOURCE',
    competitionPoints: 0,
    rankingPointsEarned: 0,
    processingStatus: 'pending',
    updatedAt: new Date().toISOString(),
  };
  await db.collection('workouts').doc(activityId).set(patch, { merge: true });
  Object.assign(activity, patch);
  return true;
}

async function avaliarCompeticao(
  userId: string,
  activityId: string,
  activity: WearableActivityPayload,
  profile: Record<string, any>,
  policy: ActivityCompetitionPolicy,
): Promise<CompetitionOutcome> {
  if (!policy.requiresSecurityReview) {
    return { status: 'not_required', decision: null, reason: null, reviewApplied: false };
  }
  void userId;
  void activityId;
  void activity;
  void profile;
  // Apple Health/Health Connect chegam por um payload do cliente. Sem App
  // Attest/Play Integrity e uma prova assinada da origem, telemetria plausível
  // ainda pode ser fabricada. Ela vale para histórico, XP e missões casuais,
  // mas nunca se autoaprova para ranking/campeonato.
  return {
    status: 'ineligible',
    decision: 'ATTESTATION_REQUIRED',
    reason: 'UNVERIFIED_WEARABLE_SOURCE',
    reviewApplied: false,
  };
}

async function refreshRetryableCompetition(
  userId: string,
  activity: Record<string, any>,
  sourceActivity: WearableActivityPayload,
  profile: Record<string, any>,
  profileAvailable: boolean,
): Promise<boolean> {
  void profileAvailable;
  if (activity.dataQualityStatus === 'dedup_pending'
    || !RETRYABLE_COMPETITION_REASONS.has(String(activity.nonScoringReason || ''))) return false;
  const policy = policyFromActivity(activity);
  if (!policy.requiresSecurityReview) return false;
  const outcome = await avaliarCompeticao(userId, String(activity.id), sourceActivity, profile, policy);
  const competitionXP = calculateCompletedActivityXP({
    type: activity.type,
    durationMinutes: Number(activity.duration) || 0,
  });
  const approved = outcome.status === 'approved';
  const patch = {
    validationStatus: outcome.status === 'not_required' ? 'recorded'
      : approved ? 'validated'
        : outcome.status === 'ineligible' || outcome.status === 'rejected' ? 'not_eligible' : 'pending_review',
    competitionReviewStatus: outcome.status,
    competitionStatus: outcome.status,
    securityReviewApplied: outcome.reviewApplied,
    securityDecision: outcome.decision,
    securityRiskScore: Number.isFinite(outcome.riskScore) ? outcome.riskScore : null,
    securityReportId: outcome.reportId || null,
    pendingReview: outcome.status === 'pending_review',
    isScoringEligible: approved,
    nonScoringReason: outcome.reason || null,
    competitionPoints: approved ? competitionXP : 0,
    processingStatus: 'pending',
    updatedAt: new Date().toISOString(),
  };
  await db.collection('workouts').doc(String(activity.id)).set(patch, { merge: true });
  Object.assign(activity, patch);
  return true;
}

async function reconcileWearableActivity(
  userId: string,
  activity: Record<string, any>,
  options: WearableProcessOptions = {},
): Promise<'complete' | 'duplicate'> {
  const activityId = String(activity.id || '');
  if (!activityId || activity.userId !== userId) throw new Error('Atividade wearable inválida para conciliação.');
  if (activity.dataQualityStatus === 'dedup_pending') {
    try {
      const identityInput: ActivityIdentityInput = {
        userId,
        activityId,
        type: activity.type,
        cardioType: activity.cardioType,
        startTime: activity.startTime || activity.createdAt,
        endTime: activity.endTime,
        durationMinutes: Number(activity.duration) || 0,
        source: String(activity.source || 'wearable'),
      };
      const identity = await reserveActivityIdentity(identityInput);
      if (identity.status === 'pending') throw new Error('Outra origem ainda está reservando esta atividade.');
      const duplicate = identity.status === 'duplicate';
      const eligible = !duplicate && activity.activityTypeSupported !== false
        && activity.sourceRewardEligible !== false && isActivityEconomyEligible({
        type: activity.type,
        durationMinutes: Number(activity.duration) || 0,
      });
      const recoveredXP = eligible
        ? calculateCompletedActivityXP({ type: activity.type, durationMinutes: Number(activity.duration) || 0 })
        : 0;
      const restoredCompetitionStatus = !duplicate
        ? String(activity.competitionReviewStatusBeforeDedup || '')
        : '';
      const patch = {
        dataQualityStatus: duplicate ? 'duplicate' : 'accepted',
        canonicalActivityId: duplicate ? identity.canonicalActivityId : null,
        economyEligible: eligible,
        missionEligible: eligible,
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
              : restoredCompetitionStatus === 'ineligible' || restoredCompetitionStatus === 'rejected'
                ? 'not_eligible' : 'pending_review',
          pendingReview: restoredCompetitionStatus === 'pending_review',
          isScoringEligible: restoredCompetitionStatus === 'approved',
          competitionPoints: restoredCompetitionStatus === 'approved' ? recoveredXP : 0,
          securityReviewApplied: activity.securityReviewAppliedBeforeDedup === true,
          securityDecision: activity.securityDecisionBeforeDedup || null,
          securityRiskScore: activity.securityRiskScoreBeforeDedup ?? null,
          securityReportId: activity.securityReportIdBeforeDedup || null,
          nonScoringReason: activity.nonScoringReasonBeforeDedup ?? null,
        } : {}),
        ...(duplicate ? {
          competitionReviewStatus: 'ineligible',
          competitionStatus: 'ineligible',
          validationStatus: 'not_eligible',
          pendingReview: false,
          isScoringEligible: false,
          competitionPoints: 0,
          securityDecision: 'DUPLICATE',
          nonScoringReason: 'DUPLICATE_ACTIVITY',
        } : {}),
      };
      if (!duplicate && identity.status === 'claimed') {
        const committed = await commitActivityIdentityReservation({
          input: identityInput,
          reservation: identity,
          payload: patch,
          mode: 'merge',
        });
        if (committed.status === 'lost') throw new Error('A reserva econômica da atividade wearable expirou.');
      } else {
        await db.collection('workouts').doc(activityId).set(patch, { merge: true });
      }
      Object.assign(activity, patch);
    } catch {
      throw new Error('Atividade salva com deduplicação pendente; reenvio necessário.');
    }
  }
  const duplicate = activity.dataQualityStatus === 'duplicate'
    || activity.nonScoringReason === 'DUPLICATE_ACTIVITY';
  if (!duplicate && activity.economyEligible !== false) {
    const settlement = await settleCompletedActivityRewards({
      userId,
      activityId,
      type: activity.type === 'cardio' ? 'cardio' : 'workout',
      durationMinutes: Number(activity.duration) || 0,
      source: String(activity.source || 'wearable'),
      activityXP: Number(activity.activityXpAwarded) || 0,
      economyEligible: activity.economyEligible !== false,
      economyVersion: Number(activity.economyVersion) || ACTIVITY_ECONOMY_VERSION,
      syncMissions: options.syncMissions,
      occurredAt: activity.endTime || activity.startTime || activity.createdAt,
    });
    const rewardPatch = {
      economyEligible: settlement.economyEligible,
      missionEligible: settlement.economyEligible,
      activityXpAwarded: settlement.activityXP,
      points: settlement.activityXP,
      pointsEarned: settlement.activityXP,
      scoreAwarded: settlement.activityXP,
      economyVersion: settlement.economyVersion,
    };
    await db.collection('workouts').doc(activityId).set(rewardPatch, { merge: true });
    Object.assign(activity, rewardPatch);
  }

  const policy = policyFromActivity(activity);
  if (policy.contexts.length > 0) {
    const reviewStatus = activity.competitionReviewStatus === 'approved'
      ? 'approved'
      : activity.competitionReviewStatus === 'ineligible' ? 'ineligible'
        : activity.competitionReviewStatus === 'rejected' ? 'rejected' : 'pending_review';
    await persistActivityCompetitionEntries({
      activityId,
      userId,
      policy,
      reviewStatus,
      score: Number(activity.competitionPoints ?? activity.activityXpAwarded) || 0,
      riskScore: activity.securityRiskScore,
      securityDecision: activity.securityDecision,
      securityReportId: activity.securityReportId,
      reasonCode: activity.nonScoringReason,
    });
    if (reviewStatus === 'approved') {
      if (policy.contexts.some((context) => context.type === 'gym_ranking')) {
        const score = await recalculateAllUserScores(userId);
        await db.collection('workouts').doc(activityId).set({
          rankingPointsEarned: score.weekly.igaRanking,
        }, { merge: true });
      }
      const userSnap = await db.collection('users').doc(userId).get();
      const user = userSnap.data() || {};
      await submitActivityToActiveChampionships({
        userId,
        userName: user.name || user.displayName,
        userGymName: user.gymName,
        activityId,
        activityType: activity.type,
        isIndoorCardio: activity.isIndoorCardio === true,
        durationMinutes: Number(activity.duration) || 0,
        distanceKm: Number(activity.distance) || 0,
        score: Number(activity.competitionPoints ?? activity.activityXpAwarded) || 0,
        when: new Date(activity.startTime || activity.createdAt),
        riskScore: activity.securityRiskScore,
        securityDecision: activity.securityDecision,
        securityReportId: activity.securityReportId,
        contexts: policy.contexts,
      });
    }
  }
  await db.collection('workouts').doc(activityId).set({
    processingStatus: 'complete',
    processingCompletedAt: new Date().toISOString(),
  }, { merge: true });
  return duplicate ? 'duplicate' : 'complete';
}

async function persistHealth(
  userId: string,
  activityId: string,
  activity: WearableActivityPayload,
  approvedForHealth: boolean,
  duplicate: boolean,
): Promise<void> {
  try {
    await registrarAmostrasDeAtividade({
      userId,
      source: activity.source,
      sourceActivityId: activityId,
      timestamp: activity.startTime,
      aprovadoPeloAntifraude: approvedForHealth,
      pularDuplicata: duplicate,
      avgHeartRate: activity.averageHeartRate,
      maxHeartRate: activity.maxHeartRate,
      steps: activity.steps,
      calories: activity.calories,
      distanceKm: activity.distanceMeters ? activity.distanceMeters / 1000 : undefined,
      durationMin: activity.durationSeconds / 60,
    });
  } catch (error) {
    console.error(`[WearableSync] Health Data Layer falhou para ${activityId} (não fatal):`, error);
  }
}

async function mergeTelemetry(activityId: string, activity: WearableActivityPayload): Promise<void> {
  const hasGpsRoute = Array.isArray(activity.checkpoints) && activity.checkpoints.length > 0;
  await db.collection('workouts').doc(activityId).set({
    ...(typeof activity.calories === 'number' ? { calories: activity.calories } : {}),
    ...(typeof activity.averageHeartRate === 'number' ? { avgHeartRate: activity.averageHeartRate } : {}),
    ...(typeof activity.maxHeartRate === 'number' ? { maxHeartRate: activity.maxHeartRate } : {}),
    ...(typeof activity.steps === 'number' ? { steps: activity.steps } : {}),
    ...(activity.heartRateSamples?.length ? {
      heartRateSamples: activity.heartRateSamples,
      heartRateSampleCount: activity.heartRateSamples.length,
      hasHeartRateSeries: true,
    } : {}),
    ...(hasGpsRoute ? { hasGpsRoute: true, trajectory: activity.checkpoints } : {}),
    updatedAt: new Date().toISOString(),
  }, { merge: true });
}

/**
 * Registra uma atividade do Apple Health/Health Connect. O status pessoal e o
 * status competitivo nunca são misturados: casual pula o antifraude; competição
 * pode ficar pendente sem perder histórico, XP ou missões.
 */
export async function processarAtividadeWearable(
  userId: string,
  activity: WearableActivityPayload,
  perfilUsuario: Record<string, any>,
  options: WearableProcessOptions = {},
): Promise<ResultadoIngestaoAtividade> {
  const preferredDocId = wearableDocumentId(userId, activity);
  try {
    const classification = classificarTipo(activity.activityType);
    const durationMins = activity.durationSeconds / 60;
    const distanceKm = (activity.distanceMeters || 0) / 1000;
    const activityStart = new Date(activity.startTime);
    if (!Number.isFinite(activityStart.getTime()) || durationMins <= 0 || durationMins > 360) {
      return { sourceActivityId: activity.sourceActivityId, status: 'blocked', detalhe: 'Duração ou horário inválido.' };
    }
    const activityEnd = new Date(activityStart.getTime() + activity.durationSeconds * 1000);
    if (activityEnd.getTime() > Date.now() + 5 * 60 * 1000) {
      return { sourceActivityId: activity.sourceActivityId, status: 'blocked', detalhe: 'A atividade termina no futuro.' };
    }
    const sourceRewardEligible = activityStart.getTime() >= Date.now() - 31 * 86400000;

    const preferredRef = db.collection('workouts').doc(preferredDocId);
    const preferredExisting = await preferredRef.get();
    if (preferredExisting.exists) {
      const existing = preferredExisting.data() || {};
      if (existing.userId !== userId) throw new Error('Atividade wearable pertence a outro usuário.');
      const duplicate = existing.dataQualityStatus === 'duplicate'
        || existing.nonScoringReason === 'DUPLICATE_ACTIVITY';
      await mergeTelemetry(preferredDocId, activity);
      const existingActivity: Record<string, any> = { id: preferredDocId, ...existing };
      const downgradedProjection = await enforceUnattestedWearableProjection(
        preferredDocId,
        existingActivity,
      );
      let reconciliation = existing.processingStatus !== 'complete'
        || downgradedProjection
        ? await reconcileWearableActivity(userId, existingActivity, options)
        : duplicate ? 'duplicate' : 'complete';
      if (reconciliation !== 'duplicate' && await refreshRetryableCompetition(
        userId, existingActivity, activity, perfilUsuario, options.profileAvailable !== false,
      )) {
        reconciliation = await reconcileWearableActivity(userId, existingActivity, options);
      }
      await persistHealth(
        userId,
        preferredDocId,
        activity,
        healthEvidenceAccepted(existingActivity),
        reconciliation === 'duplicate',
      );
      if (downgradedProjection) {
        await syncReviewedActivityCompetitionScores(preferredDocId);
        await recalculateAllUserScores(userId);
      }
      return {
        sourceActivityId: activity.sourceActivityId,
        status: reconciliation === 'duplicate' ? 'duplicate'
          : RETRYABLE_COMPETITION_REASONS.has(String(existingActivity.nonScoringReason || '')) ? 'error' : 'approved',
        competitionReviewStatus: existingActivity.competitionReviewStatus || 'not_required',
        detalhe: duplicate ? existing.userMessage || 'Atividade equivalente já registrada.' : undefined,
      };
    }

    const duplicate = await encontrarAtividadeDuplicada(userId, {
      inicio: activityStart,
      duracaoMin: durationMins,
      distanciaKm: distanceKm > 0 ? distanceKm : undefined,
      tipo: classification.tipo,
      fonte: activity.source,
      sourceActivityId: activity.sourceActivityId,
    });

    let sameSourceLegacy: Record<string, any> | null = null;
    // Migra o ID legado da mesma origem no lugar, evitando criar uma cópia.
    if (duplicate?.motivo === 'MESMO_ID_DE_ORIGEM') {
      const legacyRef = db.collection('workouts').doc(duplicate.id);
      const legacySnap = await legacyRef.get();
      const legacy = legacySnap.data() || {};
      sameSourceLegacy = legacy;
      if (!legacySnap.exists || legacy.userId !== userId) throw new Error('Atividade wearable legada inválida.');
      if (Number(legacy.schemaVersion) >= 2) {
        const legacyDuplicate = legacy.dataQualityStatus === 'duplicate'
          || legacy.nonScoringReason === 'DUPLICATE_ACTIVITY';
        await mergeTelemetry(duplicate.id, activity);
        const legacyActivity: Record<string, any> = { id: duplicate.id, ...legacy };
        const downgradedProjection = await enforceUnattestedWearableProjection(
          duplicate.id,
          legacyActivity,
        );
        let reconciliation = legacy.processingStatus !== 'complete'
          || downgradedProjection
          ? await reconcileWearableActivity(userId, legacyActivity, options)
          : legacyDuplicate ? 'duplicate' : 'complete';
        if (reconciliation !== 'duplicate' && await refreshRetryableCompetition(
          userId, legacyActivity, activity, perfilUsuario, options.profileAvailable !== false,
        )) {
          reconciliation = await reconcileWearableActivity(userId, legacyActivity, options);
        }
        await persistHealth(
          userId,
          duplicate.id,
          activity,
          healthEvidenceAccepted(legacyActivity),
          reconciliation === 'duplicate',
        );
        if (downgradedProjection) {
          await syncReviewedActivityCompetitionScores(duplicate.id);
          await recalculateAllUserScores(userId);
        }
        return {
          sourceActivityId: activity.sourceActivityId,
          status: reconciliation === 'duplicate' ? 'duplicate'
            : RETRYABLE_COMPETITION_REASONS.has(String(legacyActivity.nonScoringReason || '')) ? 'error' : 'approved',
          competitionReviewStatus: legacyActivity.competitionReviewStatus || 'not_required',
          detalhe: legacyDuplicate ? legacy.userMessage || 'Atividade equivalente já registrada.' : undefined,
        };
      }
    }

    const policy = await resolveActivityCompetitionPolicy({
      userId,
      activityType: classification.type,
      cardioType: classification.cardioType,
      isIndoorCardio: activity.isIndoorCardio === true,
      when: activityStart,
    });
    const lateForCompetition = policy.requiresSecurityReview
      && activityEnd.getTime() < Date.now() - 7 * 86400000;
    const legacyWasDuplicate = sameSourceLegacy?.dataQualityStatus === 'duplicate'
      || sameSourceLegacy?.nonScoringReason === 'DUPLICATE_ACTIVITY'
      || Boolean(sameSourceLegacy?.canonicalActivityId);
    const activityId = duplicate?.motivo === 'MESMO_ID_DE_ORIGEM' ? duplicate.id : preferredDocId;
    let crossSourceDuplicate = Boolean(duplicate && duplicate.motivo !== 'MESMO_ID_DE_ORIGEM') || Boolean(legacyWasDuplicate);
    let dedupPending = false;
    let canonicalActivityId = crossSourceDuplicate ? duplicate?.id || null : null;
    let identityInput: ActivityIdentityInput | null = null;
    let identityReservation: Extract<ActivityIdentityReservation, { status: 'claimed' }> | null = null;
    if (!crossSourceDuplicate && classification.supported && sourceRewardEligible && isActivityEconomyEligible({
      type: classification.type,
      durationMinutes: durationMins,
    })) {
      try {
        const reservationInput: ActivityIdentityInput = {
          userId,
          activityId,
          type: classification.type,
          cardioType: classification.cardioType,
          startTime: activityStart,
          endTime: activityEnd,
          durationMinutes: durationMins,
          source: activity.source,
        };
        const identity = await reserveActivityIdentity(reservationInput);
        if (identity.status === 'duplicate') {
          crossSourceDuplicate = true;
          canonicalActivityId = identity.canonicalActivityId;
        } else if (identity.status === 'pending') {
          dedupPending = true;
          canonicalActivityId = identity.canonicalActivityId;
        } else {
          identityInput = reservationInput;
          identityReservation = identity;
        }
      } catch (error) {
        console.warn(`[WearableSync] Reserva de identidade pendente para ${activityId}:`, error);
        dedupPending = true;
      }
    }
    const outcomeBeforeDedup = dedupPending && policy.requiresSecurityReview
      && classification.supported && !lateForCompetition && options.profileAvailable !== false
      ? await avaliarCompeticao(userId, activityId, activity, perfilUsuario, policy)
      : null;
    let outcome: CompetitionOutcome = !classification.supported && policy.requiresSecurityReview
      ? {
          status: 'ineligible',
          decision: 'UNSUPPORTED_ACTIVITY_TYPE',
          reason: 'UNSUPPORTED_ACTIVITY_TYPE',
          reviewApplied: false,
        }
      : lateForCompetition
      ? {
          status: 'ineligible',
          decision: 'LATE_IMPORT',
          reason: 'LATE_EXTERNAL_IMPORT',
          reviewApplied: false,
        }
      : crossSourceDuplicate
      ? {
          status: 'ineligible' as const,
          decision: 'DUPLICATE',
          reason: 'DUPLICATE_ACTIVITY',
          reviewApplied: false,
        }
      : dedupPending && policy.requiresSecurityReview
        ? {
            status: 'pending_review' as const,
            decision: 'ERROR',
            reason: 'DEDUPLICATION_UNAVAILABLE',
            reviewApplied: false,
          }
      : await avaliarCompeticao(userId, activityId, activity, perfilUsuario, policy);
    if (policy.requiresSecurityReview && !crossSourceDuplicate && !dedupPending && !lateForCompetition && sameSourceLegacy
      && ['approved', 'rejected', 'ineligible'].includes(String(sameSourceLegacy.competitionReviewStatus))) {
      outcome = {
        status: sameSourceLegacy.competitionReviewStatus,
        decision: sameSourceLegacy.securityDecision || null,
        riskScore: sameSourceLegacy.securityRiskScore,
        reportId: sameSourceLegacy.securityReportId || null,
        reason: sameSourceLegacy.nonScoringReason || null,
        reviewApplied: sameSourceLegacy.securityReviewApplied === true,
      };
    }
    const economyEligible = classification.supported && sourceRewardEligible && isActivityEconomyEligible({
      type: classification.type,
      durationMinutes: durationMins,
      duplicate: crossSourceDuplicate || dedupPending,
    });
    const activityXP = economyEligible
      ? calculateCompletedActivityXP({ type: classification.type, durationMinutes: durationMins })
      : 0;
    const competitionApproved = outcome.status === 'approved';
    const hasGpsRoute = Array.isArray(activity.checkpoints) && activity.checkpoints.length > 0;
    const now = new Date().toISOString();
    const missionAccessFallback = resolveExternalMissionAccessSnapshot(
      perfilUsuario,
      options.profileAvailable !== false,
      activityEnd,
    );
    const missionAccess = sameSourceLegacy
      ? preserveMissionAccessSnapshot(sameSourceLegacy, missionAccessFallback)
      : missionAccessFallback;
    const payload = {
      ...missionAccess,
      id: activityId,
      schemaVersion: 2,
      userId,
      type: classification.type,
      cardioType: classification.cardioType,
      activityTypeSupported: classification.supported,
      isIndoorCardio: activity.isIndoorCardio === true,
      source: activity.source,
      sourceActivityId: activity.sourceActivityId,
      timestamp: activityStart.toISOString(),
      startTime: activityStart.toISOString(),
      endTime: activityEnd.toISOString(),
      duration: durationMins,
      ...(distanceKm > 0 ? { distance: distanceKm } : {}),
      ...(typeof activity.calories === 'number' ? { calories: activity.calories } : {}),
      ...(typeof activity.averageHeartRate === 'number' ? { avgHeartRate: activity.averageHeartRate } : {}),
      ...(typeof activity.maxHeartRate === 'number' ? { maxHeartRate: activity.maxHeartRate } : {}),
      ...(typeof activity.steps === 'number' ? { steps: activity.steps } : {}),
      ...(activity.heartRateSamples?.length ? {
        heartRateSamples: activity.heartRateSamples,
        heartRateSampleCount: activity.heartRateSamples.length,
        hasHeartRateSeries: true,
      } : {}),
      hasGpsRoute,
      ...(hasGpsRoute ? { trajectory: activity.checkpoints } : {}),
      recordStatus: 'completed',
      status: 'completed',
      activityMode: policy.requiresSecurityReview ? 'competitive' : 'personal',
      validationStatus: outcome.status === 'not_required' ? 'recorded'
        : competitionApproved ? 'validated'
          : outcome.status === 'ineligible' || outcome.status === 'rejected' ? 'not_eligible' : 'pending_review',
      competitionReviewStatus: outcome.status,
      competitionStatus: outcome.status,
      competitionContexts: policy.contexts,
      competitionPolicyVersion: policy.version,
      competitionPolicyResolvedAt: policy.resolvedAt,
      competitionPolicyEffectiveAt: policy.effectiveAt,
      competitionEvidenceStatus: policy.requiresSecurityReview
        ? 'untrusted_client_import' : 'not_required',
      securityReviewApplied: outcome.reviewApplied,
      securityDecision: outcome.decision,
      securityRiskScore: Number.isFinite(outcome.riskScore) ? outcome.riskScore : null,
      securityReportId: outcome.reportId || null,
      ...(outcomeBeforeDedup ? {
        competitionReviewStatusBeforeDedup: outcomeBeforeDedup.status,
        securityReviewAppliedBeforeDedup: outcomeBeforeDedup.reviewApplied,
        securityDecisionBeforeDedup: outcomeBeforeDedup.decision,
        securityRiskScoreBeforeDedup: Number.isFinite(outcomeBeforeDedup.riskScore)
          ? outcomeBeforeDedup.riskScore : null,
        securityReportIdBeforeDedup: outcomeBeforeDedup.reportId || null,
        nonScoringReasonBeforeDedup: outcomeBeforeDedup.reason || null,
      } : {}),
      pendingReview: outcome.status === 'pending_review',
      isScoringEligible: competitionApproved,
      nonScoringReason: outcome.reason || null,
      dataQualityStatus: crossSourceDuplicate ? 'duplicate'
        : dedupPending ? 'dedup_pending'
          : classification.supported ? 'accepted' : 'unverified_type',
      canonicalActivityId,
      economyEligible,
      missionEligible: economyEligible,
      sourceRewardEligible,
      economyVersion: ACTIVITY_ECONOMY_VERSION,
      activityXpAwarded: activityXP,
      points: activityXP,
      pointsEarned: activityXP,
      scoreAwarded: activityXP,
      competitionPoints: competitionApproved ? activityXP : 0,
      rankingPointsEarned: 0,
      processingStatus: 'pending',
      userMessage: crossSourceDuplicate ? duplicate?.detalhe : !classification.supported
        ? 'Atividade salva no histórico; a modalidade não identificada não gera XP, desafio ou ranking.'
        : outcome.reason === 'UNVERIFIED_WEARABLE_SOURCE'
          ? 'Atividade salva com XP e desafios; esta integração ainda não possui atestação para pontuar em rankings.'
        : outcome.status === 'pending_review'
        ? 'Atividade sincronizada; somente a pontuação competitiva está em análise.'
          : !sourceRewardEligible ? 'Atividade histórica salva; importações com mais de 31 dias não geram nova recompensa.' : undefined,
      createdAt: activityStart.toISOString(),
      updatedAt: now,
      // Remove flags antigos ao migrar uma atividade casual que havia sido
      // tratada como fraude pelo contrato anterior.
      ...(duplicate?.motivo === 'MESMO_ID_DE_ORIGEM' && !policy.requiresSecurityReview ? {
        securityBlocked: FieldValue.delete(),
        rejectionReason: FieldValue.delete(),
      } : {}),
    };

    const ref = db.collection('workouts').doc(activityId);
    if (duplicate?.motivo === 'MESMO_ID_DE_ORIGEM') {
      if (identityInput && identityReservation && !crossSourceDuplicate && !dedupPending) {
        const committed = await commitActivityIdentityReservation({
          input: identityInput,
          reservation: identityReservation,
          payload,
          mode: 'merge',
        });
        if (committed.status === 'lost') throw new Error('A reserva econômica da atividade wearable expirou.');
      } else {
        await ref.set(payload, { merge: true });
      }
    } else {
      try {
        if (identityInput && identityReservation && !crossSourceDuplicate && !dedupPending) {
          const committed = await commitActivityIdentityReservation({
            input: identityInput,
            reservation: identityReservation,
            payload,
            mode: 'create',
          });
          if (committed.status === 'lost') throw new Error('A reserva econômica da atividade wearable expirou.');
          if (committed.status === 'existing') throw new Error('Atividade wearable já criada por outra requisição.');
        } else {
          await ref.create(payload);
        }
      } catch (createError) {
        const raced = await ref.get();
        if (!raced.exists || raced.data()?.userId !== userId) throw createError;
        const racedData = raced.data() || {};
        const racedActivity: Record<string, any> = { id: activityId, ...racedData };
        let reconciliation = racedData.processingStatus !== 'complete'
          ? await reconcileWearableActivity(userId, racedActivity, options)
          : racedData.dataQualityStatus === 'duplicate' ? 'duplicate' : 'complete';
        if (reconciliation !== 'duplicate' && await refreshRetryableCompetition(
          userId, racedActivity, activity, perfilUsuario, options.profileAvailable !== false,
        )) {
          reconciliation = await reconcileWearableActivity(userId, racedActivity, options);
        }
        await persistHealth(
          userId,
          activityId,
          activity,
          healthEvidenceAccepted(racedActivity),
          reconciliation === 'duplicate',
        );
        return {
          sourceActivityId: activity.sourceActivityId,
          status: reconciliation === 'duplicate' ? 'duplicate'
            : RETRYABLE_COMPETITION_REASONS.has(String(racedActivity.nonScoringReason || '')) ? 'error' : 'approved',
          competitionReviewStatus: racedActivity.competitionReviewStatus || 'not_required',
        };
      }
    }

    let reconciliation = await reconcileWearableActivity(userId, payload, options);
    if (reconciliation !== 'duplicate' && await refreshRetryableCompetition(
      userId, payload, activity, perfilUsuario, options.profileAvailable !== false,
    )) {
      reconciliation = await reconcileWearableActivity(userId, payload, options);
    }
    await persistHealth(
      userId,
      activityId,
      activity,
      healthEvidenceAccepted(payload),
      reconciliation === 'duplicate',
    );
    return {
      sourceActivityId: activity.sourceActivityId,
      status: reconciliation === 'duplicate' ? 'duplicate'
        : RETRYABLE_COMPETITION_REASONS.has(String(payload.nonScoringReason || '')) ? 'error' : 'approved',
      competitionReviewStatus: payload.competitionReviewStatus,
      detalhe: crossSourceDuplicate ? duplicate?.detalhe : outcome.status === 'pending_review'
        ? 'Registro concluído; pontuação competitiva pendente.' : undefined,
    };
  } catch (error: any) {
    console.error(`[WearableSync] Falha processando ${preferredDocId}:`, error);
    return {
      sourceActivityId: activity.sourceActivityId,
      status: 'error',
      detalhe: error?.message || 'Falha inesperada na sincronização.',
    };
  }
}

/** Processamento sequencial mantém a deduplicação correta dentro do lote. */
export async function processarLoteWearable(
  userId: string,
  activities: WearableActivityPayload[],
): Promise<{
  resultados: ResultadoIngestaoAtividade[];
  syncedCount: number;
  duplicatesSkipped: number;
  blockedCount: number;
}> {
  let profile: Record<string, any> = {};
  let profileAvailable = true;
  try {
    const snap = await db.collection('users').doc(userId).get();
    profileAvailable = snap.exists;
    if (snap.exists) profile = snap.data() || {};
  } catch (error) {
    profileAvailable = false;
    console.warn('[WearableSync] Falha ao carregar perfil do usuário:', error);
  }

  const resultados: ResultadoIngestaoAtividade[] = [];
  for (const activity of activities) {
    resultados.push(await processarAtividadeWearable(userId, activity, profile, {
      syncMissions: false,
      profileAvailable,
    }));
  }
  if (resultados.some((result) => result.status === 'approved')) {
    // Um único rebuild por lote evita N varreduras integrais do histórico.
    const affectedAt = resultados.flatMap((result, index) => {
      const source = activities[index];
      if (result.status !== 'approved' || !source?.startTime) return [];
      const startMs = Date.parse(source.startTime);
      const endMs = startMs + Number(source.durationSeconds || 0) * 1000;
      return Number.isFinite(endMs) ? [new Date(endMs).toISOString()] : [];
    });
    await MissionEngine.syncUserProgressFromCompletedActivities(userId, affectedAt);
  }
  return {
    resultados,
    syncedCount: resultados.filter((result) => result.status === 'approved').length,
    duplicatesSkipped: resultados.filter((result) => result.status === 'duplicate').length,
    blockedCount: resultados.filter((result) => result.status === 'blocked' || result.status === 'error').length,
  };
}
