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
  const safeXP = Math.max(0, Number(xp) || 0);
  if (safeXP <= 0) return 1;
  let level = 1;
  while (true) {
    const nextLevelXP = getXPRequiredForLevel(level + 1);
    if (safeXP >= nextLevelXP) {
      level++;
    } else {
      break;
    }
  }
  return level;
}
