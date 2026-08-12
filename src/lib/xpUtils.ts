/**
 * Centralized XP (Experience Points) Configuration & Utils
 * Invictus Progression Architecture
 */

export const XP_CONFIG = {
  /** Daily Check-in bonus (+10 XP) */
  CHECK_IN: 10,
  /** Completed Workout (+30 XP) */
  WORKOUT_COMPLETED: 30,
  /** Photo validated by AI (+10 XP) */
  PHOTO_VALIDATED: 10,
  /** Complete exercise registration (+10 XP) */
  COMPLETE_EXERCISES: 10,
  /** Validated Cardio (+10 XP) */
  CARDIO_VALIDATED: 10,
  /** Challenge completed (+20 XP) */
  CHALLENGE_COMPLETED: 20,
  /** Daily mission completed (+15 XP) */
  DAILY_MISSION: 15,
  /** Weekly mission completed (+50 XP) */
  WEEKLY_MISSION: 50,
  /** First workout of the week (+20 XP) */
  FIRST_WORKOUT_OF_WEEK: 20,
  /** Achievement unlocked default (+25 XP) */
  ACHIEVEMENT_UNLOCKED: 25,
};

export interface ActivityXPParams {
  type: 'workout' | 'cardio' | 'recovery' | 'diet';
  isFirstActionToday?: boolean;
  hasPhoto?: boolean;
  isPhotoValidated?: boolean;
  hasExercises?: boolean;
  isFirstWorkoutOfWeek?: boolean;
  isChallengeCompleted?: boolean;
  isDailyMissionCompleted?: boolean;
  isWeeklyMissionCompleted?: boolean;
  achievementPoints?: number;
}

/**
 * Calculates XP awarded for an activity based on centralized rules.
 */
export function calculateActivityXP(params: ActivityXPParams): number {
  let xp = 0;

  if (params.isFirstActionToday) {
    xp += XP_CONFIG.CHECK_IN;
  }

  if (params.type === 'workout') {
    xp += XP_CONFIG.WORKOUT_COMPLETED;
    if (params.hasExercises) {
      xp += XP_CONFIG.COMPLETE_EXERCISES;
    }
  } else if (params.type === 'cardio') {
    xp += XP_CONFIG.CARDIO_VALIDATED;
  } else if (params.type === 'recovery') {
    xp += XP_CONFIG.WORKOUT_COMPLETED;
  }

  if (params.hasPhoto && params.isPhotoValidated) {
    xp += XP_CONFIG.PHOTO_VALIDATED;
  }

  if (params.isFirstWorkoutOfWeek) {
    xp += XP_CONFIG.FIRST_WORKOUT_OF_WEEK;
  }

  if (params.isChallengeCompleted) {
    xp += XP_CONFIG.CHALLENGE_COMPLETED;
  }

  if (params.isDailyMissionCompleted) {
    xp += XP_CONFIG.DAILY_MISSION;
  }

  if (params.isWeeklyMissionCompleted) {
    xp += XP_CONFIG.WEEKLY_MISSION;
  }

  if (params.achievementPoints) {
    xp += params.achievementPoints || XP_CONFIG.ACHIEVEMENT_UNLOCKED;
  }

  return Math.max(0, xp);
}
