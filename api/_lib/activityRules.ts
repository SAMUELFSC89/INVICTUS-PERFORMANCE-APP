export const ACTIVITY_RULES = {
  workout: {
    minMinutes: 30,
    maxMinutes: 90,
  },
  cardio: {
    minMinutes: 20,
    maxMinutes: 90,
  }
};

export function getEffectiveMinutes(type: string, durationMinutes: number): number {
  if (type !== 'workout' && type !== 'cardio') return durationMinutes;
  const max = ACTIVITY_RULES[type]?.maxMinutes || 90;
  return Math.min(durationMinutes, max);
}

export function isSessionDurationValid(type: string, durationMinutes: number): boolean {
  if (type !== 'workout' && type !== 'cardio') return true;
  const min = ACTIVITY_RULES[type]?.minMinutes || 15;
  return durationMinutes >= min;
}
