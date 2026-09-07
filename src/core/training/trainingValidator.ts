import { OFFICIAL_EXERCISE_BY_ID, isOfficialExerciseCompatible } from '../../data/exerciseCatalog.js';
import type { MuscleGroup, WorkoutPlanAnswers, WorkoutPlanDraft } from '../../types/workoutPlan.js';

export interface TrainingValidationIssue {
  code: string;
  message: string;
  workoutId?: string;
}

export interface TrainingValidationResult {
  valid: boolean;
  issues: TrainingValidationIssue[];
  weeklySetsByMuscle: Record<MuscleGroup, number>;
}

const groups: MuscleGroup[] = ['peito', 'costas', 'pernas', 'ombros', 'bracos', 'core'];

function uniqueWeekdays(values: readonly number[] | undefined): number[] {
  return [...new Set((values || []).filter(value => Number.isInteger(value) && value >= 0 && value <= 6))];
}

/**
 * Hard fail-safe for plans created by either the local Training Engine or
 * Gemini. The AI is never allowed to bypass catalogue/equipment/day rules.
 */
export function validateTrainingPlanDraft(plan: WorkoutPlanDraft, answers: WorkoutPlanAnswers): TrainingValidationResult {
  const issues: TrainingValidationIssue[] = [];
  const weeklySetsByMuscle = Object.fromEntries(groups.map(group => [group, 0])) as Record<MuscleGroup, number>;
  const equipment = Array.isArray(answers.equipment) ? answers.equipment : [];
  const availableWeekdays = uniqueWeekdays(answers.availableWeekdays);
  const scheduledWeekdays: number[] = [];

  if (!Array.isArray(plan.workouts) || plan.workouts.length === 0) {
    issues.push({ code: 'NO_WORKOUTS', message: 'O plano não contém sessões de treino.' });
    return { valid: false, issues, weeklySetsByMuscle };
  }

  for (const workout of plan.workouts) {
    const days = uniqueWeekdays(workout.weekdays);
    if (days.length !== 1) {
      issues.push({ code: 'INVALID_WEEKDAY_ASSIGNMENT', workoutId: workout.id, message: 'Cada sessão gerada deve estar ligada a um único dia real da semana.' });
    }
    for (const day of days) {
      if (scheduledWeekdays.includes(day)) {
        issues.push({ code: 'DUPLICATE_WEEKDAY', workoutId: workout.id, message: 'Há mais de um treino programado para o mesmo dia.' });
      }
      scheduledWeekdays.push(day);
      if (availableWeekdays.length > 0 && !availableWeekdays.includes(day)) {
        issues.push({ code: 'UNAVAILABLE_WEEKDAY', workoutId: workout.id, message: 'O plano usou um dia que o atleta não marcou como disponível.' });
      }
    }

    if (!Array.isArray(workout.exercises) || workout.exercises.length < 3) {
      issues.push({ code: 'TOO_FEW_EXERCISES', workoutId: workout.id, message: 'A sessão precisa de pelo menos três exercícios compatíveis.' });
      continue;
    }
    if (workout.exercises.length > 9) {
      issues.push({ code: 'TOO_MANY_EXERCISES', workoutId: workout.id, message: 'A sessão excedeu o limite de nove exercícios.' });
    }

    const ids = new Set<string>();
    let estimatedSeconds = 0;
    for (const exercise of workout.exercises) {
      const official = OFFICIAL_EXERCISE_BY_ID.get(exercise.exerciseId);
      if (!official) {
        issues.push({ code: 'UNKNOWN_EXERCISE', workoutId: workout.id, message: `Exercício fora da biblioteca oficial: ${exercise.exerciseId}.` });
        continue;
      }
      if (!isOfficialExerciseCompatible(exercise.exerciseId, equipment)) {
        issues.push({ code: 'EQUIPMENT_MISMATCH', workoutId: workout.id, message: `${official.name} exige equipamento não selecionado.` });
      }
      if (ids.has(exercise.exerciseId)) {
        issues.push({ code: 'DUPLICATE_EXERCISE', workoutId: workout.id, message: `${official.name} foi repetido na mesma sessão.` });
      }
      ids.add(exercise.exerciseId);

      if (!Number.isFinite(exercise.sets) || exercise.sets < 1 || exercise.sets > 6) {
        issues.push({ code: 'INVALID_SETS', workoutId: workout.id, message: `Número de séries inválido em ${official.name}.` });
      }
      if (!Number.isFinite(exercise.repsMin) || !Number.isFinite(exercise.repsMax) || exercise.repsMin < 1 || exercise.repsMax < exercise.repsMin || exercise.repsMax > 30) {
        issues.push({ code: 'INVALID_REPS', workoutId: workout.id, message: `Faixa de repetições inválida em ${official.name}.` });
      }
      if (!Number.isFinite(exercise.restSeconds) || exercise.restSeconds < 30 || exercise.restSeconds > 300) {
        issues.push({ code: 'INVALID_REST', workoutId: workout.id, message: `Descanso inválido em ${official.name}.` });
      }
      if (exercise.targetRir !== undefined && (!Number.isFinite(exercise.targetRir) || exercise.targetRir < 0 || exercise.targetRir > 5)) {
        issues.push({ code: 'INVALID_RIR', workoutId: workout.id, message: `RIR inválido em ${official.name}.` });
      }

      weeklySetsByMuscle[official.muscleGroup] += Math.max(0, Number(exercise.sets) || 0);
      // Conservative session estimate: ~35 s per work set + prescribed rest.
      estimatedSeconds += Math.max(1, Number(exercise.sets) || 1) * (35 + Math.max(30, Number(exercise.restSeconds) || 90));
    }

    const allowedSeconds = Math.max(20, Number(plan.durationMinutes) || 60) * 60 * 1.35;
    if (estimatedSeconds > allowedSeconds) {
      issues.push({ code: 'SESSION_TOO_LONG', workoutId: workout.id, message: 'O volume estimado excede o tempo que o atleta informou ter disponível.' });
    }
  }

  if (scheduledWeekdays.length !== plan.workouts.length) {
    issues.push({ code: 'WEEKDAY_COUNT_MISMATCH', message: 'A programação semanal contém dias inválidos ou duplicados.' });
  }

  // Broad coverage for a general resistance plan. Specialized plans may add
  // more work, but chest/pull/legs cannot silently disappear from the week.
  for (const required of ['peito', 'costas', 'pernas'] as MuscleGroup[]) {
    if (weeklySetsByMuscle[required] === 0) {
      issues.push({ code: 'MISSING_CORE_PATTERN', message: `O plano não contém trabalho para ${required}.` });
    }
  }

  for (const group of groups) {
    if (weeklySetsByMuscle[group] > 24) {
      issues.push({ code: 'EXCESSIVE_WEEKLY_VOLUME', message: `Volume semanal excessivo para ${group}.` });
    }
  }

  return { valid: issues.length === 0, issues, weeklySetsByMuscle };
}

export function assertTrainingPlanDraft(plan: WorkoutPlanDraft, answers: WorkoutPlanAnswers): WorkoutPlanDraft {
  const result = validateTrainingPlanDraft(plan, answers);
  if (!result.valid) {
    const summary = result.issues.slice(0, 4).map(issue => issue.message).join(' ');
    throw new Error(`TRAINING_ENGINE_INVALID_PLAN: ${summary}`);
  }
  return plan;
}
