export type CompetitionEvidenceMetrics = {
  activityType: 'workout' | 'cardio';
  cardioType: string | null;
  isIndoorCardio: boolean;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  distanceKm: number | null;
  avgHeartRate: number | null;
  maxHeartRate: number | null;
  calories: number | null;
};

function isDirectTrustedStrava(activity: Record<string, any>): boolean {
  const source = String(activity.source || '').trim().toLowerCase();
  const sourceActivityId = String(activity.sourceActivityId || '').trim();
  const stravaActivityId = String(activity.stravaActivityId || '').trim();
  return Number(activity.schemaVersion) >= 2
    && source === 'strava'
    && activity.manual !== true
    && Boolean(sourceActivityId)
    && Boolean(stravaActivityId)
    && sourceActivityId === stravaActivityId;
}

function usesTrustedEvidenceContract(activity: Record<string, any>): boolean {
  return Number(activity.schemaVersion) >= 2 || Boolean(activity.competitionPolicyVersion);
}

/**
 * Nome legado: este helper indica que a atividade está sob o contrato de
 * evidência competitiva confiável. Para v2 isso também inclui o caso em que
 * a evidência obrigatória está ausente/adulterada — os consumidores então
 * recebem `null` de `readCompetitionEvidenceMetrics` e falham fechados.
 *
 * Strava OAuth direto é uma exceção legítima: o documento é escrito pelo
 * backend a partir da API do provedor, não pelo cliente, e por isso pode ser
 * normalizado para o mesmo snapshot competitivo mesmo sem os campos de
 * promoção usados por Apple Health/Health Connect.
 */
export function hasTrustedCompetitionEvidence(activity: Record<string, any>): boolean {
  return activity.competitionEvidenceStatus === 'trusted_server_source'
    || activity.competitionEvidenceStatus === 'trusted_native_attestation'
    || isDirectTrustedStrava(activity)
    || usesTrustedEvidenceContract(activity);
}

function normalizedEvidenceValue(activity: Record<string, any>): Record<string, any> | null {
  if (isDirectTrustedStrava(activity)
    && activity.competitionEvidenceStatus !== 'trusted_server_source'
    && activity.competitionEvidenceStatus !== 'trusted_native_attestation') {
    return {
      activityType: activity.type,
      cardioType: activity.cardioType ?? null,
      isIndoorCardio: activity.isIndoorCardio === true,
      startTime: activity.startTime ?? activity.timestamp ?? activity.createdAt,
      endTime: activity.endTime,
      durationMinutes: activity.duration ?? activity.durationMinutes,
      distanceKm: activity.distance ?? activity.distanceKm ?? null,
      avgHeartRate: activity.avgHeartRate ?? activity.avgHr ?? null,
      maxHeartRate: activity.maxHeartRate ?? null,
      calories: activity.calories ?? activity.caloriesBurned ?? null,
    };
  }

  const value = activity.competitionEvidenceMetrics;
  return value && typeof value === 'object' ? value : null;
}

/** Fail-closed reader shared by every competitive consumer. */
export function readCompetitionEvidenceMetrics(
  activity: Record<string, any>,
): CompetitionEvidenceMetrics | null {
  if (!hasTrustedCompetitionEvidence(activity)) return null;
  const value = normalizedEvidenceValue(activity);
  if (!value) return null;
  const activityType = value.activityType;
  const durationMinutes = Number(value.durationMinutes);
  const startMs = Date.parse(String(value.startTime || ''));
  const endMs = Date.parse(String(value.endTime || ''));
  if (!['workout', 'cardio'].includes(activityType)
    || typeof value.isIndoorCardio !== 'boolean'
    || !Number.isFinite(durationMinutes) || durationMinutes <= 0 || durationMinutes > 360
    || !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs
    || durationMinutes > (endMs - startMs) / 60_000 + 2) return null;

  const optional = (input: unknown, min: number, max: number): number | null | undefined => {
    if (input === null || input === undefined) return null;
    const parsed = Number(input);
    return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : undefined;
  };
  const distanceKm = optional(value.distanceKm, 0, 1000);
  const avgHeartRate = optional(value.avgHeartRate, 30, 240);
  const maxHeartRate = optional(value.maxHeartRate, 30, 260);
  const calories = optional(value.calories, 0, 10_000);
  if (distanceKm === undefined || avgHeartRate === undefined
    || maxHeartRate === undefined || calories === undefined) return null;
  const cardioType = value.cardioType === null || value.cardioType === undefined
    ? null : typeof value.cardioType === 'string' ? value.cardioType : undefined;
  if (cardioType === undefined || (activityType === 'cardio' && !cardioType)) return null;

  return {
    activityType,
    cardioType,
    isIndoorCardio: value.isIndoorCardio,
    startTime: new Date(startMs).toISOString(),
    endTime: new Date(endMs).toISOString(),
    durationMinutes,
    distanceKm,
    avgHeartRate,
    maxHeartRate,
    calories,
  };
}
