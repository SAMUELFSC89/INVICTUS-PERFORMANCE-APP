/**
 * Centralized XP Configuration for Backend Engine
 */

export const XP_CONFIG = {
  CHECK_IN: 10,
  WORKOUT_COMPLETED: 30,
  PHOTO_VALIDATED: 10,
  COMPLETE_EXERCISES: 10,
  CARDIO_VALIDATED: 10,
  CHALLENGE_COMPLETED: 20,
  DAILY_MISSION: 15,
  WEEKLY_MISSION: 50,
  FIRST_WORKOUT_OF_WEEK: 20,
  ACHIEVEMENT_UNLOCKED: 25,
};

export function getXPRequiredForLevel(level: number): number {
  if (level <= 1) return 0;
  return 25 * (level - 1) * (level + 2);
}

export function getLevelFromXP(xp: number = 0): number {
  const numericXP = Number(xp);
  const safeXP = Number.isFinite(numericXP) ? Math.max(0, numericXP) : 0;
  if (safeXP <= 0) return 1;
  // Inverse of 25 * (level - 1) * (level + 2); avoids an unbounded loop if a
  // corrupt account ever contains an extremely large XP value.
  return Math.max(1, Math.floor((-1 + Math.sqrt(9 + (4 * safeXP) / 25)) / 2));
}
