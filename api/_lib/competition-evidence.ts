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

export function hasTrustedCompetitionEvidence(activity: Record<string, any>): boolean {
  return activity.competitionEvidenceStatus === 'trusted_server_source'
    || activity.competitionEvidenceStatus === 'trusted_native_attestation';
}

/** Fail-closed reader shared by every competitive consumer. */
export function readCompetitionEvidenceMetrics(
  activity: Record<string, any>,
): CompetitionEvidenceMetrics | null {
  if (!hasTrustedCompetitionEvidence(activity)) return null;
  const value = activity.competitionEvidenceMetrics;
  if (!value || typeof value !== 'object') return null;
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
