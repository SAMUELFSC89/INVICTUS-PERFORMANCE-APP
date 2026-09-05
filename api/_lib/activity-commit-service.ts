import { ActivityRepository } from '../_repositories/activity-repository.js';
import { UserRepository } from '../_repositories/user-repository.js';
import { recalculateAllUserScores } from './igaService.js';
import { registrarAmostrasDeAtividade } from './health-data-layer.js';
import { submitActivityToActiveChampionships } from './championship-scoring-service.js';
import { estimateCalories, formatPace } from './activity-metrics.js';
import { sanitizeWorkoutHealthRecord, type SanitizedWorkoutHealth } from './workout-health-record.js';

/**
 * Commit de uma atividade que o SecurityPipeline marcou UNDER_REVIEW e que
 * teve a presenca confirmada por selfie (validate-presence.ts, actionType
 * 'activity_under_review'). Espelha o essencial do caminho de sucesso de
 * ValidateActivityService.execute() (persistir, XP, IGA, saude, campeonatos)
 * -- de proposito NAO reaproveita commitWorkoutSession/commitRunningSession
 * (legado): commitRunningSession grava em `running_stats`, uma colecao
 * paralela que nunca alimentou o IGA nem o historico unificado em
 * `workouts`, e reusa-la aqui reintroduziria exatamente o problema de
 * "5 formulas de pontuacao" que a auditoria de 2026-08 corrigiu.
 *
 * Roda como funcao standalone (nao um metodo de ValidateActivityService)
 * porque o commit acontece numa requisicao HTTP diferente -- o atleta tira a
 * selfie minutos depois, entao nao ha estado de memoria da requisicao
 * original pra reusar.
 */
export async function commitActivityAfterPresenceCheck(params: {
  userId: string;
  rawActivity: any;
  presenceOutcome: 'approved' | 'pending';
  presenceSelfieBase64?: string;
}): Promise<{ activityId: string; pointsAwarded: number; weeklyIgaScore: number } & SanitizedWorkoutHealth> {
  const activityRepository = new ActivityRepository();
  const userRepository = new UserRepository();
  const { userId, rawActivity, presenceOutcome } = params;
  const workoutHealth = sanitizeWorkoutHealthRecord(rawActivity.healthSession);

  const rawDuration = rawActivity.duration ?? rawActivity.durationMins;
  const durationForMetrics = rawDuration === undefined
    ? 30
    : Math.max(0, Number(rawDuration) || 0);
  const finalCalories = (rawActivity.healthTelemetry && typeof rawActivity.healthTelemetry.calories === 'number' && rawActivity.healthTelemetry.calories > 0)
    ? rawActivity.healthTelemetry.calories
    : estimateCalories({ type: rawActivity.type, durationMins: durationForMetrics });
  const estimatedPace = formatPace(rawActivity.distanceKm, durationForMetrics);

  // Pontuacao XP: mesma base do ValidateActivityService (2 pts/min), mas a
  // atividade so chegou aqui porque o antifraude automatico NAO confiou nela
  // de primeira -- a selfie confirma que existe uma pessoa real por tras,
  // mas nao apaga o sinal de risco original, entao 'pending' (identidade com
  // confianca media, nao alta) fica registrada sem XP ate revisao manual.
  const pointsAwarded = presenceOutcome === 'approved'
    ? Math.max(10, Math.round(durationForMetrics * 2))
    : 0;

  const savedActivity = await activityRepository.create({
    ...workoutHealth,
    userId,
    type: rawActivity.type,
    muscleGroup: rawActivity.muscleGroup,
    cardioType: rawActivity.cardioType,
    cardioTypeLabel: rawActivity.cardioTypeLabel,
    isIndoorCardio: rawActivity.isIndoorCardio,
    requiresGpsDistance: rawActivity.requiresGpsDistance,
    duration: durationForMetrics,
    distance: Number(rawActivity.distanceKm) || 0,
    trajectory: Array.isArray(rawActivity.checkpoints) ? rawActivity.checkpoints : undefined,
    avgHeartRate: rawActivity.avgHeartRate ?? rawActivity.healthTelemetry?.avgHeartRate ?? undefined,
    steps: rawActivity.pedometerSteps ?? rawActivity.healthTelemetry?.steps ?? undefined,
    calories: finalCalories,
    healthTelemetry: rawActivity.healthTelemetry ?? undefined,
    metricSources: rawActivity.metricSources ?? undefined,
    smartwatchData: rawActivity.smartwatchData ?? undefined,
    pace: estimatedPace ?? undefined,
    photoUrl: params.presenceSelfieBase64 ? `data:image/jpeg;base64,${params.presenceSelfieBase64}` : (rawActivity.photoBase64 || undefined),
    intensity: rawActivity.intensity || 'moderate',
    startTime: rawActivity.startTime || new Date().toISOString(),
    endTime: rawActivity.endTime || new Date().toISOString(),
    points: pointsAwarded,
    pointsEarned: pointsAwarded,
    scoreAwarded: pointsAwarded,
    rankingPointsEarned: 0,
    status: presenceOutcome === 'approved' ? 'completed' : 'pending_review',
    validationStatus: presenceOutcome === 'approved' ? 'validated' : 'pending',
    presenceVerified: true,
    presenceOutcome,
    evidence: rawActivity.evidence || {},
  } as any);

  try {
    await registrarAmostrasDeAtividade({
      userId,
      source: 'invictus_manual',
      sourceActivityId: savedActivity.id!,
      timestamp: typeof rawActivity.startTime === 'string' ? rawActivity.startTime : new Date().toISOString(),
      aprovadoPeloAntifraude: presenceOutcome === 'approved',
      pularDuplicata: false,
      avgHeartRate: rawActivity.avgHeartRate ?? rawActivity.healthTelemetry?.avgHeartRate,
      calories: finalCalories,
      distanceKm: Number(rawActivity.distanceKm) > 0 ? Number(rawActivity.distanceKm) : undefined,
      durationMin: durationForMetrics > 0 ? durationForMetrics : undefined,
    });
  } catch (healthErr) {
    console.error('[activity-commit-service] Health Data Layer falhou (nao-fatal):', healthErr);
  }

  let weeklyIgaScore = 0;
  if (presenceOutcome === 'approved') {
    try {
      await userRepository.addXP(userId, pointsAwarded);
      const recalculated = await recalculateAllUserScores(userId);
      weeklyIgaScore = recalculated.weekly.igaRanking;
    } catch (rankingErr) {
      console.error('[activity-commit-service] Falha ao atualizar XP/IGA (atividade permanece salva):', rankingErr);
    }

    try {
      await submitActivityToActiveChampionships({
        userId,
        activityId: savedActivity.id || '',
        activityType: rawActivity.type,
        isIndoorCardio: rawActivity.isIndoorCardio,
        durationMinutes: durationForMetrics,
        distanceKm: Number(rawActivity.distanceKm) || 0,
        score: pointsAwarded,
        when: new Date(rawActivity.endTime || rawActivity.startTime || Date.now()),
      });
    } catch (champErr) {
      console.error('[activity-commit-service] Falha ao submeter a campeonatos (nao-fatal):', champErr);
    }
  }

  return { activityId: savedActivity.id || '', pointsAwarded, weeklyIgaScore, ...workoutHealth };
}
