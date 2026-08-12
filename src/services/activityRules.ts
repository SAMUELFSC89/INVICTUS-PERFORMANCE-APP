export const ACTIVITY_RULES = {
  workout: {
    minMinutes: 30,
    maxMinutes: 90,
    maxPoints: 150,
  },
  cardio: {
    minMinutes: 20,
    maxMinutes: 90,
    maxPoints: 120,
  }
};

export function getEffectiveMinutes(type: 'workout' | 'cardio', durationMinutes: number): number {
  const max = ACTIVITY_RULES[type]?.maxMinutes || 90;
  return Math.min(durationMinutes, max);
}

export function isSessionDurationValid(type: 'workout' | 'cardio', durationMinutes: number): boolean {
  const min = ACTIVITY_RULES[type]?.minMinutes || 15;
  return durationMinutes >= min;
}
