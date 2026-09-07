import type { PlannedWorkout } from '../../types/workoutPlan';

export const MAX_MANUAL_EXERCISES_PER_WORKOUT = 12;

export type ManualExerciseAddDecision = 'allowed' | 'duplicate' | 'limit_reached';

export function manualExerciseAddDecision(workout: PlannedWorkout, exerciseId: string): ManualExerciseAddDecision {
  if (workout.exercises.some((exercise) => exercise.exerciseId === exerciseId)) return 'duplicate';
  if (workout.exercises.length >= MAX_MANUAL_EXERCISES_PER_WORKOUT) return 'limit_reached';
  return 'allowed';
}

export function isManualWorkoutConfigured(workout: PlannedWorkout): boolean {
  return workout.exercises.length > 0;
}

export function areAllManualWorkoutsConfigured(workouts: readonly PlannedWorkout[]): boolean {
  return workouts.length > 0 && workouts.every(isManualWorkoutConfigured);
}

export function manualPlanExceedsExerciseLimit(workouts: readonly PlannedWorkout[]): boolean {
  return workouts.some((workout) => workout.exercises.length > MAX_MANUAL_EXERCISES_PER_WORKOUT);
}
