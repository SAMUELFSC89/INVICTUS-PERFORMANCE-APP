export const MIN_REWARDABLE_ACTIVITY_MINUTES = 1;
/** Bump only when the persisted activity-XP formula changes. */
export const ACTIVITY_ECONOMY_VERSION = 1;
export const SUPPORTED_ACTIVITY_ECONOMY_VERSIONS = new Set([1]);

export function isActivityEconomyEligible(input: {
  type?: unknown;
  durationMinutes?: unknown;
  duplicate?: boolean;
}): boolean {
  const type = String(input.type || '').toLowerCase();
  const duration = Number(input.durationMinutes);
  return input.duplicate !== true
    && (type === 'workout' || type === 'cardio')
    && Number.isFinite(duration)
    && duration >= MIN_REWARDABLE_ACTIVITY_MINUTES;
}

export function calculateCompletedActivityXP(input: {
  type?: unknown;
  durationMinutes?: unknown;
  intensity?: unknown;
}): number {
  return calculateCompletedActivityXPForVersion(input, ACTIVITY_ECONOMY_VERSION);
}

/** Historical formulas stay available so a retry always honors the version
 * frozen on the activity instead of silently paying a newer formula. */
export function calculateCompletedActivityXPForVersion(input: {
  type?: unknown;
  durationMinutes?: unknown;
  intensity?: unknown;
}, economyVersion: number): number {
  // Keep an explicit branch per persisted version. Adding a number only to the
  // supported Set is intentionally insufficient: a historical formula must be
  // retained here before a new version can be paid.
  if (economyVersion !== 1) throw new Error(`Versão econômica de atividade não suportada: ${economyVersion}.`);
  const type = String(input.type || '').toLowerCase();
  const duration = Number(input.durationMinutes);
  if (!isActivityEconomyEligible({ type, durationMinutes: duration })) return 0;
  const cappedDuration = Math.min(duration, type === 'workout' ? 240 : 360);
  const intensity = String(input.intensity || '').toLowerCase();
  const multiplier = intensity === 'high' ? 1.5 : intensity === 'moderate' ? 1.2 : 1;
  return Math.max(10, Math.round(cappedDuration * 2 * multiplier));
}
