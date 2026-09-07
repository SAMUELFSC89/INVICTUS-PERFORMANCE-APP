import { buildTrainingEnginePlan } from '../core/training/trainingEngine';
import { validateTrainingPlanDraft } from '../core/training/trainingValidator';
import type { WorkoutPlanAnswers } from '../types/workoutPlan';

const baseAnswers = (overrides: Partial<WorkoutPlanAnswers> = {}): WorkoutPlanAnswers => ({
  primaryGoal: 'massa',
  experienceLevel: 'intermediario',
  experienceTime: '1 a 3 anos',
  daysPerWeek: 3,
  availableWeekdays: [1, 3, 5],
  durationMinutes: 60,
  preferredPeriod: 'Manhã',
  equipment: ['maquinas', 'halteres', 'banco', 'crossover', 'barra_anilhas'],
  preferredTraining: 'forca',
  preferredSplit: 'Outro',
  preferences: [],
  restrictions: [],
  athleteProfile: { age: 34, weightKg: 82, heightCm: 178, sex: 'male' },
  ...overrides
});

describe('Training Engine', () => {
  it('uses the exact weekdays chosen by the athlete instead of a Sunday-first sequence', () => {
    const answers = baseAnswers({ availableWeekdays: [2, 4, 6], daysPerWeek: 3 });
    const plan = buildTrainingEnginePlan(answers);
    expect(plan.workouts.map(workout => workout.weekdays[0])).toEqual([2, 4, 6]);
    expect(plan.daysPerWeek).toBe(3);
  });

  it('creates an evidence-versioned plan and does not invent an initial load from body data', () => {
    const plan = buildTrainingEnginePlan(baseAnswers());
    expect(plan.trainingEngineVersion).toBeTruthy();
    expect(plan.evidenceVersion).toBeTruthy();
    for (const workout of plan.workouts) {
      for (const exercise of workout.exercises) {
        expect(exercise.initialLoadKg).toBeUndefined();
        expect(exercise.targetRir).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('starts more conservatively for an older beginner returning to training', () => {
    const answers = baseAnswers({
      primaryGoal: 'retorno',
      experienceLevel: 'iniciante',
      preferredTraining: 'funcional',
      athleteProfile: { age: 67, weightKg: 88, heightCm: 170, sex: 'female' }
    });
    const plan = buildTrainingEnginePlan(answers);
    const allExercises = plan.workouts.flatMap(workout => workout.exercises);
    expect(allExercises.every(exercise => (exercise.targetRir ?? 0) >= 4)).toBe(true);
    expect(Math.max(...allExercises.map(exercise => exercise.sets))).toBeLessThanOrEqual(3);
  });

  it('passes the same hard validator used for AI refinements', () => {
    const answers = baseAnswers({ daysPerWeek: 4, availableWeekdays: [1, 2, 4, 6], preferredSplit: 'Upper / Lower' });
    const plan = buildTrainingEnginePlan(answers);
    const validation = validateTrainingPlanDraft(plan, answers);
    expect(validation.valid).toBe(true);
    expect(validation.issues).toEqual([]);
    expect(validation.weeklySetsByMuscle.peito).toBeGreaterThan(0);
    expect(validation.weeklySetsByMuscle.costas).toBeGreaterThan(0);
    expect(validation.weeklySetsByMuscle.pernas).toBeGreaterThan(0);
  });
});
