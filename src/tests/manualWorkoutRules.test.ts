import type { PlannedWorkout } from '../types/workoutPlan';
import {
  MAX_MANUAL_EXERCISES_PER_WORKOUT,
  areAllManualWorkoutsConfigured,
  isManualWorkoutConfigured,
  manualExerciseAddDecision,
  manualPlanExceedsExerciseLimit,
} from '../core/training/manualWorkoutRules';

const workout = (count: number): PlannedWorkout => ({
  id: 'workout_a',
  name: 'Treino A',
  focus: '',
  weekdays: [1],
  exercises: Array.from({ length: count }, (_, index) => ({
    exerciseId: `exercise_${index}`,
    order: index,
    sets: 3,
    repsMin: 8,
    repsMax: 12,
    restSeconds: 90,
  })),
});

describe('regras da criação manual de treino', () => {
  test('permite adicionar um exercício novo antes do limite', () => {
    expect(manualExerciseAddDecision(workout(3), 'novo_exercicio')).toBe('allowed');
  });

  test('não adiciona o mesmo exercício duas vezes no mesmo treino', () => {
    expect(manualExerciseAddDecision(workout(3), 'exercise_1')).toBe('duplicate');
  });

  test('bloqueia novas adições ao atingir o limite por treino', () => {
    expect(manualExerciseAddDecision(workout(MAX_MANUAL_EXERCISES_PER_WORKOUT), 'novo_exercicio')).toBe('limit_reached');
  });

  test('considera o treino configurado quando existe ao menos um exercício', () => {
    expect(isManualWorkoutConfigured(workout(0))).toBe(false);
    expect(isManualWorkoutConfigured(workout(1))).toBe(true);
    expect(areAllManualWorkoutsConfigured([workout(1), workout(2)])).toBe(true);
    expect(areAllManualWorkoutsConfigured([workout(1), workout(0)])).toBe(false);
  });

  test('detecta drafts antigos que ultrapassam o novo limite', () => {
    expect(manualPlanExceedsExerciseLimit([workout(MAX_MANUAL_EXERCISES_PER_WORKOUT)])).toBe(false);
    expect(manualPlanExceedsExerciseLimit([workout(MAX_MANUAL_EXERCISES_PER_WORKOUT + 1)])).toBe(true);
  });
});
