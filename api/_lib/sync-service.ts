import { db, FieldValue } from './common.js';
import { recalculateAllUserScores } from './igaService.js';
import { SecurityPipeline } from './security-pipeline.js';
import { buscarHistoricoRecente } from './user-activity-history.js';
import { encontrarAtividadeDuplicada } from './activity-dedup.js';
import { registrarAmostrasDeAtividade } from './health-data-layer.js';
import {
  ActivityCompetitionPolicy,
  persistActivityCompetitionEntries,
  resolveActivityCompetitionPolicy,
} from './activity-competition-policy.js';
import { submitActivityToActiveChampionships } from './championship-scoring-service.js';
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
import {
  preserveMissionAccessSnapshot,
  resolveExternalMissionAccessSnapshot,
} from './mission-access.js';
import { promoteCanonicalCompetitionProjection } from './activity-competition-promotion.js';

type StravaClassification = {
  raw: string;
  type: 'workout' | 'cardio';
  cardioType?: string;
  antiFraudType: 'RUNNING' | 'WALKING' | 'CYCLING' | 'SWIMMING' | 'INDOOR_CARDIO' | 'CARDIO' | 'WORKOUT';
  isRun: boolean;
  isIndoorCardio: boolean;
};

function classifyStravaActivity(activity: any): StravaClassification {
  const raw = String(activity?.sport_type || activity?.type || '').replace(/[^a-zA-Z]/g, '').toLowerCase();
  const isRun = raw.includes('run');
  const isWalk = raw.includes('walk') || raw === 'hike';
  const isRide = raw.includes('ride') || raw.includes('cycl') || raw === 'handcycle'
    || raw === 'velomobile';
  const isSwim = raw.includes('swim');
  const indoorKinds = ['virtualrun', 'virtualride', 'virtualrow', 'elliptical', 'stairstepper'];
  const isIndoorCardio = activity?.trainer === true || indoorKinds.includes(raw);
  const strengthKinds = [
    'weighttraining', 'workout', 'crossfit', 'pilates', 'yoga',
    'highintensityintervaltraining', 'rockclimbing',
  ];
  const cardioKinds = [
    'rowing', 'canoeing', 'kayaking', 'standuppaddling', 'surfing', 'windsurf',
    'kitesurf', 'nordicski', 'rollerski', 'alpineski', 'backcountryski',
    'iceskate', 'inlineskate', 'snowshoe', 'wheelchair', 'soccer',
    ...indoorKinds,
  ];
  const isCardio = isRun || isWalk || isRide || isSwim || cardioKinds.includes(raw);
  const type: 'workout' | 'cardio' = strengthKinds.includes(raw) ? 'workout' : isCardio ? 'cardio' : 'workout';
  const cardioType = type === 'cardio'
    ? isRun ? 'corrida' : isWalk ? 'caminhada' : isRide ? 'ciclismo' : isSwim ? 'natacao' : raw || 'cardio'
    : undefined;
  const antiFraudType = type === 'workout' ? 'WORKOUT'
    : isRun ? 'RUNNING'
      : isWalk ? 'WALKING'
        : isRide ? 'CYCLING'
          : isSwim ? 'SWIMMING'
            : isIndoorCardio ? 'INDOOR_CARDIO' : 'CARDIO';
  return { raw, type, cardioType, antiFraudType, isRun, isIndoorCardio };
}

type StravaProcessOptions = {
  syncMissions?: boolean;
  missionAccessProfile?: Record<string, any> | null;
  missionAccessProfileAvailable?: boolean;
};

export class SyncService {
  static async processStravaActivity(userId: string, stravaActivity: any, options: StravaProcessOptions = {}) {
    console.log(`[SyncService] Processing activity ${stravaActivity?.id} for user ${userId}`);
    if (!stravaActivity?.id) return false;

    const sourceActivityId = String(stravaActivity.id);
    const docId = `strava_${sourceActivityId}`;
    const classification = classifyStravaActivity(stravaActivity);
    const normalizedActivityType = classification.raw;
    const isRunType = classification.isRun;
    const activityType = classification.type;
    const cardioType = classification.cardioType;
    const rawDurationSeconds = Number(stravaActivity.moving_time || stravaActivity.elapsed_time) || 0;
    const durationMins = rawDurationSeconds > 0 ? rawDurationSeconds / 60 : 0;
    const rawDistance = Number(stravaActivity.distance) || 0;
    // A API Strava sempre expressa `distance` em metros, inclusive abaixo de 100.
    const distanceKm = rawDistance / 1000;
    const rawDate = stravaActivity.start_date || stravaActivity.start_date_local || stravaActivity.created_at;
    const parsedDate = rawDate ? new Date(rawDate) : new Date(NaN);
    if (!Number.isFinite(parsedDate.getTime()) || rawDurationSeconds <= 0 || rawDurationSeconds > 6 * 60 * 60) {
      console.warn(`[SyncService] Atividade Strava ${sourceActivityId} ignorada por horário/duração inválido.`);
      return false;
    }
    const activityStart = parsedDate;
    const activityDate = activityStart.toISOString();
    const activityEnd = new Date(activityStart.getTime() + Math.max(0, rawDurationSeconds) * 1000);
    if (activityEnd.getTime() > Date.now() + 5 * 60 * 1000) {
      console.warn(`[SyncService] Atividade Strava ${sourceActivityId} termina no futuro.`);
      return false;
    }
    const workoutRef = db.collection('workouts').doc(docId);

    const alreadySaved = await workoutRef.get();
    const previous = alreadySaved.exists ? alreadySaved.data() || {} : null;
    if (previous && previous.userId !== userId) {
      throw new Error('Identificador Strava já pertence a outro usuário.');
    }
    const retryingTrustedPromotion = previous && Number(previous.schemaVersion) >= 2
      && previous.dataQualityStatus === 'duplicate'
      && Boolean(previous.canonicalActivityId)
      && stravaActivity.manual !== true;
    if (previous && Number(previous.schemaVersion) >= 2 && !retryingTrustedPromotion) {
      const duplicate = previous.dataQualityStatus === 'duplicate';
      const reconciliation = previous.processingStatus !== 'complete'
        ? await this.reconcileStravaActivity(userId, { id: docId, ...previous }, options)
        : duplicate ? 'duplicate' : 'complete';
      await this.persistStravaHealth(userId, docId, stravaActivity, {
        activityDate,
        durationMins,
        distanceKm,
        approvedForHealth: true,
        duplicate: reconciliation === 'duplicate',
      });
      await this.logStravaActivity(
        userId,
        stravaActivity,
        'completed',
        previous.competitionReviewStatus || 'not_required',
      ).catch(() => undefined);
      if (isRunType && distanceKm > 0 && reconciliation !== 'duplicate' && previous.economyEligible !== false
        && stravaActivity.manual !== true) {
        await this.updateRunningStatsAndSession(userId, {
          km: distanceKm,
          timeSeconds: rawDurationSeconds,
          elevationGain: Number(stravaActivity.total_elevation_gain) || 0,
          date: activityDate,
          stravaActivityId: sourceActivityId,
        }).catch(() => undefined);
      }
      return false;
    }

    const duplicateLookup = await encontrarAtividadeDuplicada(userId, {
      inicio: activityStart,
      duracaoMin: durationMins,
      distanciaKm: distanceKm > 0 ? distanceKm : undefined,
      tipo: normalizedActivityType,
      fonte: 'strava',
      sourceActivityId,
    });
    const legacyWasDuplicate = previous?.dataQualityStatus === 'duplicate'
      || previous?.nonScoringReason === 'DUPLICATE_ACTIVITY'
      || Boolean(previous?.canonicalActivityId);
    const loadPromotionCanonical = async (candidateId: string | null | undefined) => {
      if (!candidateId || stravaActivity.manual === true) return null;
      const candidateSnap = await db.collection('workouts').doc(candidateId).get();
      const candidate = candidateSnap.data() || {};
      if (candidateSnap.exists && candidate.userId === userId
        && ['apple_health', 'health_connect'].includes(String(candidate.source || '').toLowerCase())) {
        return { id: candidateId, ...candidate };
      }
      return null;
    };
    let promotionCanonical: Record<string, any> | null = await loadPromotionCanonical(
      previous?.canonicalActivityId,
    );
    if (!promotionCanonical && duplicateLookup?.motivo === 'MESMA_JANELA_E_METRICAS') {
      promotionCanonical = await loadPromotionCanonical(duplicateLookup.id);
    }
    let dataQualityStatus: 'accepted' | 'duplicate' | 'dedup_pending' | 'unverified_manual'
      = stravaActivity.manual === true ? 'unverified_manual'
        : legacyWasDuplicate || (duplicateLookup && duplicateLookup.motivo !== 'MESMO_ID_DE_ORIGEM')
          ? 'duplicate' : 'accepted';
    let canonicalActivityId: string | null = dataQualityStatus === 'duplicate'
      ? String(previous?.canonicalActivityId || duplicateLookup?.id || '') || null
      : null;
    let identityInput: ActivityIdentityInput | null = null;
    let identityReservation: Extract<ActivityIdentityReservation, { status: 'claimed' }> | null = null;
    if (dataQualityStatus === 'accepted' && isActivityEconomyEligible({
      type: activityType,
      durationMinutes: durationMins,
    })) {
      try {
        const reservationInput: ActivityIdentityInput = {
          userId,
          activityId: docId,
          type: activityType,
          cardioType,
          startTime: activityStart,
          endTime: activityEnd,
          durationMinutes: durationMins,
          source: 'strava',
        };
        const identity = await reserveActivityIdentity(reservationInput);
        if (identity.status === 'duplicate') {
          dataQualityStatus = 'duplicate';
          canonicalActivityId = identity.canonicalActivityId;
          promotionCanonical ||= await loadPromotionCanonical(identity.canonicalActivityId);
        } else if (identity.status === 'pending') {
          dataQualityStatus = 'dedup_pending';
          canonicalActivityId = identity.canonicalActivityId;
        } else {
          identityInput = reservationInput;
          identityReservation = identity;
        }
      } catch (error) {
        console.warn(`[SyncService] Reserva de identidade pendente para ${docId}:`, error);
        dataQualityStatus = 'dedup_pending';
      }
    }
    const policy = await resolveActivityCompetitionPolicy({
      userId,
      activityType,
      cardioType,
      isIndoorCardio: classification.isIndoorCardio,
      when: activityStart,
    });
    const lateForCompetition = policy.requiresSecurityReview
      && activityEnd.getTime() < Date.now() - 7 * 86400000;
    // A projeção usa integralmente esta policy confiável do Strava; o canônico
    // wearable limita apenas a recompensa econômica duplicada.
    const promotionPolicy: ActivityCompetitionPolicy | null = promotionCanonical
      && policy.contexts.length ? policy : null;
    const promotionOutcome = promotionPolicy
      ? activityEnd.getTime() < Date.now() - 7 * 86400000
        ? { status: 'ineligible' as const, decision: 'LATE_IMPORT', reason: 'LATE_EXTERNAL_IMPORT', reviewApplied: false }
        : promotionPolicy.requiresGymCheckIn
          ? { status: 'pending_review' as const, decision: 'UNDER_REVIEW', reason: 'GEOFENCE_CHECKIN_REQUIRED', reviewApplied: false }
          : { ...await this.avaliarSegurancaStrava(userId, stravaActivity, classification, promotionPolicy), reviewApplied: true }
      : null;
    const securityBeforeDedup = policy.requiresSecurityReview && dataQualityStatus === 'dedup_pending'
      ? policy.requiresGymCheckIn
        ? {
            status: 'pending_review' as const,
            decision: 'UNDER_REVIEW',
            reason: 'GEOFENCE_CHECKIN_REQUIRED',
          }
        : await this.avaliarSegurancaStrava(userId, stravaActivity, classification, policy)
      : null;
    const security: {
      status: 'not_required' | 'approved' | 'pending_review' | 'rejected' | 'ineligible';
      decision: string | null;
      reason?: string | null;
      riskScore?: number;
      reportId?: string | null;
    } = !policy.requiresSecurityReview
      ? { status: 'not_required' as const, decision: null, reason: null }
      : lateForCompetition
        ? { status: 'ineligible' as const, decision: 'LATE_IMPORT', reason: 'LATE_EXTERNAL_IMPORT' }
      : dataQualityStatus === 'duplicate'
        ? { status: 'ineligible' as const, decision: 'DUPLICATE', reason: 'DUPLICATE_ACTIVITY' }
        : dataQualityStatus === 'unverified_manual'
          ? { status: 'ineligible' as const, decision: 'MANUAL_IMPORT', reason: 'UNVERIFIED_MANUAL_IMPORT' }
          : dataQualityStatus === 'dedup_pending'
            ? { status: 'pending_review' as const, decision: 'ERROR', reason: 'DEDUPLICATION_UNAVAILABLE' }
            : previous && ['approved', 'rejected', 'ineligible'].includes(String(previous.competitionReviewStatus))
              ? {
                  status: previous.competitionReviewStatus,
                  decision: previous.securityDecision || null,
                  reason: previous.nonScoringReason || null,
                  riskScore: previous.securityRiskScore,
                  reportId: previous.securityReportId,
                }
              : policy.requiresGymCheckIn
                ? {
                    status: 'pending_review' as const,
                    decision: 'UNDER_REVIEW',
                    reason: 'GEOFENCE_CHECKIN_REQUIRED',
                  }
                : await this.avaliarSegurancaStrava(userId, stravaActivity, classification, policy);
    const competitionRetrySnapshot = promotionOutcome
      ? promotionOutcome
      : securityBeforeDedup
        ? { ...securityBeforeDedup, reviewApplied: !policy.requiresGymCheckIn }
        : null;
    const economyEligible = isActivityEconomyEligible({
      type: activityType,
      durationMinutes: durationMins,
      duplicate: dataQualityStatus !== 'accepted',
    }) && stravaActivity.manual !== true;
    const frozenPreviousXP = Number(previous?.activityXpAwarded ?? previous?.points ?? previous?.scoreAwarded);
    const activityXP = economyEligible
      ? Number(previous?.economyVersion) === ACTIVITY_ECONOMY_VERSION
        && Number.isFinite(frozenPreviousXP) && frozenPreviousXP > 0
        ? frozenPreviousXP
        : calculateCompletedActivityXP({ type: activityType, durationMinutes: durationMins })
      : 0;
    let missionAccessProfile = options.missionAccessProfile;
    let missionAccessProfileAvailable = options.missionAccessProfileAvailable;
    if (missionAccessProfile === undefined && missionAccessProfileAvailable === undefined) {
      try {
        const userSnap = await db.collection('users').doc(userId).get();
        missionAccessProfileAvailable = userSnap.exists;
        missionAccessProfile = userSnap.exists ? userSnap.data() || {} : null;
      } catch {
        missionAccessProfileAvailable = false;
        missionAccessProfile = null;
      }
    }
    const missionAccessFallback = resolveExternalMissionAccessSnapshot(
      missionAccessProfile || null,
      missionAccessProfileAvailable !== false,
      activityEnd,
    );
    const missionAccess = previous
      ? preserveMissionAccessSnapshot(previous, missionAccessFallback)
      : missionAccessFallback;
    const competitionApproved = security.status === 'approved';
    const activityPayload = {
      ...missionAccess,
      id: docId,
      schemaVersion: 2,
      userId,
      type: activityType,
      cardioType,
      isIndoorCardio: classification.isIndoorCardio,
      source: 'strava',
      sourceActivityId,
      stravaActivityId: sourceActivityId,
      manual: stravaActivity.manual === true,
      timestamp: activityDate,
      startTime: activityDate,
      endTime: activityEnd.toISOString(),
      duration: durationMins,
      distance: distanceKm,
      calories: stravaActivity.calories ?? undefined,
      avgHeartRate: stravaActivity.average_heartrate ?? undefined,
      activityMode: policy.requiresSecurityReview ? 'competitive' : 'personal',
      recordStatus: 'completed',
      status: 'completed',
      validationStatus: security.status === 'not_required' ? 'recorded'
        : competitionApproved ? 'validated'
          : security.status === 'ineligible' || security.status === 'rejected' ? 'not_eligible' : 'pending_review',
      competitionReviewStatus: security.status,
      competitionStatus: security.status,
      competitionContexts: policy.contexts,
      competitionPolicyVersion: policy.version,
      competitionPolicyResolvedAt: policy.resolvedAt,
      competitionPolicyEffectiveAt: policy.effectiveAt,
      securityReviewApplied: policy.requiresSecurityReview && dataQualityStatus === 'accepted' && !policy.requiresGymCheckIn,
      securityDecision: security.decision,
      securityRiskScore: security.riskScore ?? null,
      securityReportId: security.reportId ?? null,
      ...(competitionRetrySnapshot ? {
        competitionReviewStatusBeforeDedup: competitionRetrySnapshot.status,
        securityReviewAppliedBeforeDedup: competitionRetrySnapshot.reviewApplied !== false,
        securityDecisionBeforeDedup: competitionRetrySnapshot.decision,
        securityRiskScoreBeforeDedup: competitionRetrySnapshot.riskScore ?? null,
        securityReportIdBeforeDedup: competitionRetrySnapshot.reportId ?? null,
        nonScoringReasonBeforeDedup: competitionRetrySnapshot.reason ?? null,
      } : {}),
      pendingReview: security.status === 'pending_review',
      isScoringEligible: competitionApproved,
      nonScoringReason: security.reason,
      dataQualityStatus,
      canonicalActivityId,
      economyEligible,
      missionEligible: economyEligible,
      economyVersion: ACTIVITY_ECONOMY_VERSION,
      activityXpAwarded: activityXP,
      points: activityXP,
      pointsEarned: activityXP,
      scoreAwarded: activityXP,
      competitionPoints: competitionApproved ? activityXP : 0,
      rankingPointsEarned: 0,
      processingStatus: 'pending',
      userMessage: dataQualityStatus === 'duplicate' ? duplicateLookup?.detalhe || 'Atividade equivalente já registrada; a cópia não gera nova recompensa.'
        : dataQualityStatus === 'unverified_manual' ? 'Atividade manual do Strava salva no histórico, sem XP ou progresso de desafio.'
          : (security.status === 'pending_review'
        ? 'Atividade salva; somente a pontuação competitiva está em análise.'
        : undefined),
      createdAt: activityDate,
      updatedAt: new Date().toISOString(),
    };

    if (stravaActivity.manual !== true && promotionCanonical && promotionPolicy && promotionOutcome) {
      await promoteCanonicalCompetitionProjection({
        userId,
        canonicalActivityId: String(promotionCanonical.id),
        evidenceActivityId: docId,
        evidenceSource: 'strava_oauth',
        startTime: activityStart,
        endTime: activityEnd,
        durationMinutes: durationMins,
        distanceKm,
        activityType,
        cardioType,
        isIndoorCardio: classification.isIndoorCardio,
        calories: Number(stravaActivity.calories) || undefined,
        avgHeartRate: Number(stravaActivity.average_heartrate) || undefined,
        maxHeartRate: Number(stravaActivity.max_heartrate) || undefined,
        policy: promotionPolicy,
        outcome: promotionOutcome,
        score: calculateCompletedActivityXP({ type: activityType, durationMinutes: durationMins }),
      });
    }

    if (previous) {
      if (identityInput && identityReservation && dataQualityStatus === 'accepted') {
        const committed = await commitActivityIdentityReservation({
          input: identityInput,
          reservation: identityReservation,
          payload: activityPayload,
          mode: 'merge',
        });
        if (committed.status === 'lost') throw new Error('A reserva econômica da atividade Strava expirou.');
      } else {
        await workoutRef.set(activityPayload, { merge: true });
      }
    } else try {
      if (identityInput && identityReservation && dataQualityStatus === 'accepted') {
        const committed = await commitActivityIdentityReservation({
          input: identityInput,
          reservation: identityReservation,
          payload: activityPayload,
          mode: 'create',
        });
        if (committed.status === 'lost') throw new Error('A reserva econômica da atividade Strava expirou.');
        if (committed.status === 'existing') throw new Error('Atividade Strava já criada por outra requisição.');
      } else {
        await workoutRef.create(activityPayload);
      }
    } catch (createError) {
      const raced = await workoutRef.get();
      if (!raced.exists || raced.data()?.userId !== userId) throw createError;
      const racedData = raced.data() || {};
      const reconciliation = racedData.processingStatus !== 'complete'
        ? await this.reconcileStravaActivity(userId, { id: docId, ...racedData }, options)
        : racedData.dataQualityStatus === 'duplicate' ? 'duplicate' : 'complete';
      await this.persistStravaHealth(userId, docId, stravaActivity, {
        activityDate,
        durationMins,
        distanceKm,
        approvedForHealth: true,
        duplicate: reconciliation === 'duplicate',
      });
      await this.logStravaActivity(userId, stravaActivity, 'completed', racedData.competitionReviewStatus || 'not_required').catch(() => undefined);
      if (isRunType && distanceKm > 0 && raced.data()?.dataQualityStatus === 'accepted'
        && raced.data()?.economyEligible !== false && stravaActivity.manual !== true) {
        await this.updateRunningStatsAndSession(userId, {
          km: distanceKm,
          timeSeconds: rawDurationSeconds,
          elevationGain: Number(stravaActivity.total_elevation_gain) || 0,
          date: activityDate,
          stravaActivityId: sourceActivityId,
        }).catch(() => undefined);
      }
      return false;
    }

    await this.logStravaActivity(userId, stravaActivity, 'completed', security.status).catch(() => undefined);
    const reconciliation = await this.reconcileStravaActivity(userId, activityPayload, options);
    await this.persistStravaHealth(userId, docId, stravaActivity, {
      activityDate,
      durationMins,
      distanceKm,
      approvedForHealth: true,
      duplicate: reconciliation === 'duplicate',
    });
    if (isRunType && distanceKm > 0 && reconciliation !== 'duplicate' && dataQualityStatus === 'accepted' && economyEligible) {
      await this.updateRunningStatsAndSession(userId, {
        km: distanceKm,
        timeSeconds: rawDurationSeconds,
        elevationGain: Number(stravaActivity.total_elevation_gain) || 0,
        date: activityDate,
        stravaActivityId: sourceActivityId,
      }).catch((error) => console.error(`[SyncService] Falha ao atualizar histórico de corrida ${docId}:`, error));
    }
    return reconciliation !== 'duplicate';
  }

  // Grava uma atividade do Strava ja aprovada pelo ScoreEngine em `workouts`,
  // no mesmo formato que api/_lib/igaService.ts espera (status/type/duration/
  // calories/avgHeartRate/createdAt) -- ver comentario acima em
  // processStravaActivity. Idempotencia: usa o id da atividade do Strava como
  // ID do documento, entao um re-sync/webhook duplicado sobrescreve o mesmo
  // documento em vez de criar um segundo (nao duplica contribuicao ao IGA).
  /**
   * Roda o SecurityPipeline completo sobre uma atividade do Strava.
   *
   * Normaliza o payload do Strava para o formato que os motores esperam. Um
   * ponto importante: o Strava nao envia a lista de checkpoints, mas envia
   * `start_latlng`. Sem mapear isso, o ValidationEngine trataria toda corrida
   * como "sem GPS" e reprovaria atletas legitimos em massa -- por isso a
   * coordenada inicial e repassada como latitude/longitude.
   *
   * Fail-closed, igual aos outros tres caminhos: se o pipeline falhar
   * tecnicamente, a atividade NAO e aprovada para a competicao (ela continua
   * salva no historico, apenas sem alimentar o IGA).
   */
  private static async avaliarSegurancaStrava(
    userId: string,
    stravaActivity: any,
    classification: StravaClassification,
    policy: ActivityCompetitionPolicy,
  ): Promise<{
    status: 'approved' | 'pending_review' | 'ineligible';
    decision: string | null;
    riskScore?: number;
    reportId?: string | null;
    reason?: string | null;
  }> {
    const rawDistance = Number(stravaActivity?.distance) || 0;
    const distanceKm = rawDistance / 1000;
    const rawDurationSeconds = stravaActivity?.moving_time || stravaActivity?.elapsed_time || 0;
    const inicio = Array.isArray(stravaActivity?.start_latlng) ? stravaActivity.start_latlng : null;

    const tipo = classification.antiFraudType;

    let perfil: any = {};
    try {
      if (db) {
        const snap = await db.collection('users').doc(userId).get();
        if (snap.exists) perfil = snap.data() || {};
      }
    } catch (err) {
      console.warn('[SyncService] Falha ao carregar perfil para o SecurityPipeline:', err);
    }

    try {
      const resultado = await SecurityPipeline.runPipeline(
        {
          id: `strava_${stravaActivity?.id}`,
          activityType: tipo,
          type: tipo,
          durationMins: rawDurationSeconds > 0 ? rawDurationSeconds / 60 : 0,
          distanceKm,
          timestamp: stravaActivity?.start_date || stravaActivity?.start_date_local || new Date().toISOString(),
          source: 'STRAVA',
          dataSource: 'STRAVA',
          latitude: inicio ? inicio[0] : undefined,
          longitude: inicio ? inicio[1] : undefined,
          avgHeartRate: stravaActivity?.average_heartrate,
          maxHeartRate: stravaActivity?.max_heartrate,
          calories: stravaActivity?.calories,
          requiresMotionEvidence: policy.requiresMotionSensors,
          // O Strava e uma fonte de terceiros ja consolidada: nao ha telemetria
          // de sensor/dispositivo do nosso app para enviar. Nao inventamos esses
          // campos -- ausencia de dado nao pode virar dado valido.
          manual: stravaActivity?.manual === true,
          // Alimenta a evidencia REPLAY_DUPLICATE_ACTIVITY que ja existia no
          // FraudEngine mas que nenhum chamador setava -- o sinal nunca chegava
          // a disparar. Aproveitamos o motor existente em vez de criar outro.
          isDuplicateActivity: false
        },
        userId,
        perfil,
        await buscarHistoricoRecente(userId)
      );

      if (!resultado.shouldScore) {
        console.warn(`[SyncService] SecurityPipeline recusou a atividade Strava ${stravaActivity?.id} de ${userId}: ${resultado.decision}`);
        return {
          status: 'pending_review',
          decision: resultado.decision || 'UNDER_REVIEW',
          riskScore: Number(resultado.report?.risk?.riskScore),
          reportId: resultado.report?.activityId || `strava_${stravaActivity?.id}`,
          reason: `SECURITY_PIPELINE_${resultado.decision || 'UNDER_REVIEW'}`,
        };
      }
      if (resultado.report?.validation?.competitivelyEligible === false) {
        return {
          status: 'ineligible',
          decision: resultado.decision || 'APPROVED',
          riskScore: Number(resultado.report?.risk?.riskScore),
          reportId: resultado.report?.activityId || `strava_${stravaActivity?.id}`,
          reason: resultado.report.validation.ineligibleReason || 'COMPETITION_RULE_NOT_MET',
        };
      }
      return {
        status: 'approved',
        decision: resultado.decision || 'APPROVED',
        riskScore: Number(resultado.report?.risk?.riskScore),
        reportId: resultado.report?.activityId || `strava_${stravaActivity?.id}`,
        reason: null,
      };
    } catch (err) {
      console.error(`[SyncService] SecurityPipeline falhou na atividade Strava ${stravaActivity?.id}; somente a projeção ficará pendente:`, err);
      return {
        status: 'pending_review',
        decision: 'ERROR',
        reportId: `strava_${stravaActivity?.id}`,
        reason: 'SECURITY_PIPELINE_ERROR',
      };
    }
  }

  private static async persistStravaHealth(
    userId: string,
    docId: string,
    stravaActivity: any,
    input: {
      activityDate: string;
      durationMins: number;
      distanceKm: number;
      approvedForHealth: boolean;
      duplicate: boolean;
    },
  ) {
    try {
      await registrarAmostrasDeAtividade({
        userId,
        source: 'strava',
        sourceActivityId: docId,
        timestamp: input.activityDate,
        aprovadoPeloAntifraude: input.approvedForHealth,
        pularDuplicata: input.duplicate,
        avgHeartRate: stravaActivity?.average_heartrate,
        calories: stravaActivity?.calories,
        distanceKm: input.distanceKm > 0 ? input.distanceKm : undefined,
        durationMin: input.durationMins > 0 ? input.durationMins : undefined
      });
    } catch (healthLayerErr) {
      console.error('[SyncService] Health Data Layer falhou (nao-fatal):', healthLayerErr);
    }
  }

  private static async reconcileStravaActivity(
    userId: string,
    activity: Record<string, any>,
    options: StravaProcessOptions = {},
  ): Promise<'complete' | 'duplicate'> {
    const activityId = String(activity.id || '');
    if (!activityId || activity.userId !== userId) throw new Error('Atividade Strava inválida para conciliação.');
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
          source: 'strava',
        };
        const identity = await reserveActivityIdentity(identityInput);
        if (identity.status === 'pending') throw new Error('Outra origem ainda está reservando esta atividade.');
        const duplicate = identity.status === 'duplicate';
        const eligible = !duplicate && activity.manual !== true && isActivityEconomyEligible({
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
          if (committed.status === 'lost') throw new Error('A reserva econômica da atividade Strava expirou.');
        } else {
          await db.collection('workouts').doc(activityId).set(patch, { merge: true });
        }
        Object.assign(activity, patch);
        const beforeStatus = String(activity.competitionReviewStatusBeforeDedup || '');
        const contexts = Array.isArray(activity.competitionContexts) ? activity.competitionContexts : [];
        if (duplicate && activity.manual !== true && contexts.length > 0
          && ['approved', 'pending_review', 'rejected', 'ineligible'].includes(beforeStatus)) {
          const policy: ActivityCompetitionPolicy = {
            version: 'activity-competition-v2',
            activityType: activity.type === 'cardio' ? 'cardio' : 'workout',
            ...(activity.cardioType ? { cardioType: activity.cardioType } : {}),
            isIndoorCardio: activity.isIndoorCardio === true,
            resolvedAt: activity.competitionPolicyResolvedAt || activity.createdAt,
            effectiveAt: activity.competitionPolicyEffectiveAt || activity.startTime || activity.createdAt,
            contexts,
            requiresSecurityReview: true,
            requiresGymCheckIn: contexts.some((context: any) => context?.requiresGymCheckIn === true),
            requiresContinuousGps: contexts.some((context: any) => context?.requiresContinuousGps === true),
            requiresMotionSensors: contexts.some((context: any) => context?.requiresMotionSensors === true),
          };
          await promoteCanonicalCompetitionProjection({
            userId,
            canonicalActivityId: identity.canonicalActivityId,
            evidenceActivityId: activityId,
            evidenceSource: 'strava_oauth',
            startTime: activity.startTime || activity.createdAt,
            endTime: activity.endTime,
            durationMinutes: Number(activity.duration) || 0,
            distanceKm: Number(activity.distance) || 0,
            activityType: policy.activityType,
            cardioType: policy.cardioType,
            isIndoorCardio: policy.isIndoorCardio,
            calories: Number(activity.calories) || undefined,
            avgHeartRate: Number(activity.avgHeartRate) || undefined,
            maxHeartRate: Number(activity.maxHeartRate) || undefined,
            policy,
            outcome: {
              status: beforeStatus as 'approved' | 'pending_review' | 'rejected' | 'ineligible',
              decision: activity.securityDecisionBeforeDedup || null,
              reason: activity.nonScoringReasonBeforeDedup || null,
              riskScore: activity.securityRiskScoreBeforeDedup,
              reportId: activity.securityReportIdBeforeDedup || null,
              reviewApplied: activity.securityReviewAppliedBeforeDedup === true,
            },
            score: calculateCompletedActivityXP({
              type: policy.activityType,
              durationMinutes: Number(activity.duration) || 0,
            }),
          });
        }
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
        source: 'strava',
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

    const contexts = Array.isArray(activity.competitionContexts) ? activity.competitionContexts : [];
    if (contexts.length > 0) {
      const reviewStatus = activity.competitionReviewStatus === 'approved'
        ? 'approved'
        : activity.competitionReviewStatus === 'ineligible' ? 'ineligible'
          : activity.competitionReviewStatus === 'rejected' ? 'rejected' : 'pending_review';
      const policy: ActivityCompetitionPolicy = {
        version: 'activity-competition-v2',
        activityType: activity.type === 'cardio' ? 'cardio' : 'workout',
        cardioType: activity.cardioType,
        isIndoorCardio: activity.isIndoorCardio === true,
        resolvedAt: activity.competitionPolicyResolvedAt || activity.createdAt,
        effectiveAt: activity.competitionPolicyEffectiveAt || activity.startTime || activity.createdAt,
        contexts,
        requiresSecurityReview: true,
        requiresGymCheckIn: contexts.some((context: any) => context?.requiresGymCheckIn === true),
        requiresContinuousGps: contexts.some((context: any) => context?.requiresContinuousGps === true),
        requiresMotionSensors: contexts.some((context: any) => context?.requiresMotionSensors === true),
      };
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
        if (contexts.some((context: any) => context?.type === 'gym_ranking')) {
          const recalculated = await recalculateAllUserScores(userId);
          await db.collection('workouts').doc(activityId).set({
            rankingPointsEarned: recalculated.weekly.igaRanking,
            processingStatus: 'complete',
            processingCompletedAt: new Date().toISOString(),
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
          contexts,
        });
      }
    }
    await db.collection('workouts').doc(activityId).set({
      processingStatus: 'complete',
      processingCompletedAt: new Date().toISOString(),
    }, { merge: true });
    return duplicate ? 'duplicate' : 'complete';
  }

  private static async logStravaActivity(userId: string, stravaActivity: any, status: string, reason: string) {
    console.log("Firestore Operation:", {
      collection: "strava_activities",
      document: stravaActivity.id.toString(),
      operation: "set"
    });
    await db.collection('strava_activities').doc(stravaActivity.id.toString()).set({
      userId,
      stravaActivityId: stravaActivity.id,
      status,
      fraudReason: reason,
      createdAt: FieldValue.serverTimestamp()
    });
    console.log("Firestore Success");
  }

  // Atualiza running_stats (melhor km da semana/mes, ultima corrida) e cria um
  // registro em run_sessions para uma corrida sincronizada do Strava. Espelha
  // o que RunningService.addRun() faz para corridas nativas, para que
  // corridas do Strava tambem contem para o ranking de corrida
  // (running-repository.ts getRanking) e para o historico (getRunHistory).
  private static async updateRunningStatsAndSession(userId: string, activity: { km: number, timeSeconds: number, elevationGain: number, date: string, stravaActivityId?: string }) {
    const km = activity.km;
    const normalizedActivityDate = activity.date;
    const statsRef = db.collection('running_stats').doc(userId);

    console.log("Firestore Operation:", { collection: "running_stats", document: userId, operation: "get" });
    const statsSnap = await statsRef.get();
    console.log("Firestore Success");

    const statsData = statsSnap.exists ? statsSnap.data() : {
      userId, best_run_km_month: 0, best_run_km_week: 0, last_run_date: normalizedActivityDate
    };

    const updates: any = {
      userId,
      updatedAt: FieldValue.serverTimestamp()
    };

    const previousLastMs = Date.parse(String(statsData?.last_run_date || ''));
    if (!Number.isFinite(previousLastMs) || Date.parse(normalizedActivityDate) >= previousLastMs) {
      updates.last_run_date = normalizedActivityDate;
      updates.last_run_stats = {
        km,
        timeSeconds: activity.timeSeconds,
        elevationGain: activity.elevationGain,
        date: normalizedActivityDate,
        source: 'strava',
        stravaActivityId: activity.stravaActivityId
      };
    }

    if (km > (statsData?.best_run_km_month || 0)) updates.best_run_km_month = km;
    if (km > (statsData?.best_run_km_week || 0)) updates.best_run_km_week = km;

    console.log("Firestore Operation:", { collection: "running_stats", document: userId, operation: "set" });
    await statsRef.set(updates, { merge: true });
    console.log("Firestore Success");

    const runSessionId = `strava_${String(activity.stravaActivityId || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 400)}`;
    console.log("Firestore Operation:", { collection: "run_sessions", document: runSessionId, operation: "set" });
    await db.collection('run_sessions').doc(runSessionId).set({
      id: runSessionId,
      userId,
      km,
      duration: activity.timeSeconds,
      source: 'strava',
      stravaActivityId: activity.stravaActivityId,
      createdAt: FieldValue.serverTimestamp(),
      date: normalizedActivityDate
    }, { merge: true });
    console.log("Firestore Success");
  }
}
