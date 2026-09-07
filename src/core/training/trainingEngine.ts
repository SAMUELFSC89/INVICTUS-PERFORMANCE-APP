import {
  OFFICIAL_EXERCISES_BATCH_01,
  OFFICIAL_EXERCISE_EQUIPMENT_REQUIREMENTS,
  OFFICIAL_MUSCLE_GROUP_LABELS,
  isOfficialExerciseCompatible,
  type OfficialExercise
} from '../../data/exerciseCatalog.js';
import type { MuscleGroup, WorkoutPlanAnswers, WorkoutPlanDraft } from '../../types/workoutPlan.js';
import {
  GOAL_PRESCRIPTION_RULES,
  TRAINING_ENGINE_VERSION,
  TRAINING_EVIDENCE_VERSION,
  normalizeTrainingGoal
} from './trainingEvidenceRegistry.js';
import { assertTrainingPlanDraft } from './trainingValidator.js';

type FocusToken = MuscleGroup | 'biceps' | 'triceps';
type ExperienceBand = 'beginner' | 'intermediate' | 'advanced';

type DayTemplate = {
  label: string;
  tokens: FocusToken[];
};

const COMPLEX_BEGINNER_IDS = new Set([
  'barbell_back_squat', 'barbell_bent_over_row', 'standing_barbell_overhead_press',
  'barbell_hip_thrust', 'pull_up', 'dumbbell_walking_lunge'
]);
const STABLE_MACHINE_IDS = new Set([
  'smith_machine_squat', 'leg_press_45', 'hack_squat', 'leg_extension', 'leg_curl', 'seated_leg_curl',
  'hip_adductor_machine', 'hip_abductor_machine', 'standing_calf_raise_machine', 'seated_calf_raise',
  'lat_pulldown', 'neutral_grip_lat_pulldown', 'assisted_pull_up', 'seated_cable_row', 'pec_deck_fly',
  'reverse_pec_deck_fly', 'cable_biceps_curl', 'cable_triceps_pushdown', 'rope_triceps_pushdown'
]);
const STRENGTH_PRIORITY_IDS = new Set([
  'barbell_bench_press', 'barbell_back_squat', 'barbell_bent_over_row', 'standing_barbell_overhead_press',
  'pull_up', 'barbell_hip_thrust', 'leg_press_45'
]);

const FULL_BODY: DayTemplate = { label: 'Corpo inteiro', tokens: ['pernas', 'peito', 'costas', 'ombros', 'biceps', 'triceps', 'core'] };
const UPPER: DayTemplate = { label: 'Superior', tokens: ['peito', 'costas', 'ombros', 'biceps', 'triceps'] };
const LOWER: DayTemplate = { label: 'Inferior + Core', tokens: ['pernas', 'pernas', 'core'] };
const PUSH: DayTemplate = { label: 'Push', tokens: ['peito', 'peito', 'ombros', 'triceps'] };
const PULL: DayTemplate = { label: 'Pull', tokens: ['costas', 'costas', 'biceps', 'core'] };
const LEGS: DayTemplate = { label: 'Pernas', tokens: ['pernas', 'pernas', 'pernas', 'core'] };

function experienceBand(value?: string): ExperienceBand {
  const normalized = String(value || '').toLowerCase();
  if (normalized.includes('avanc')) return 'advanced';
  if (normalized.includes('inter')) return 'intermediate';
  return 'beginner';
}

function normalizeWeekdays(values: readonly number[] | undefined): number[] {
  return [...new Set((values || [])
    .map(Number)
    .filter(value => Number.isInteger(value) && value >= 0 && value <= 6))]
    .sort((a, b) => a - b);
}

function fallbackWeekdays(days: number): number[] {
  const templates: Record<number, number[]> = {
    1: [1], 2: [2, 5], 3: [1, 3, 5], 4: [1, 2, 4, 5], 5: [1, 2, 3, 5, 6], 6: [1, 2, 3, 4, 5, 6]
  };
  return templates[Math.max(1, Math.min(6, days))] || templates[3];
}

function resolvedWeekdays(answers: WorkoutPlanAnswers): number[] {
  const selected = normalizeWeekdays(answers.availableWeekdays);
  const requested = Math.max(1, Math.min(6, Math.round(Number(answers.daysPerWeek) || selected.length || 3)));
  if (selected.length >= requested) return selected.slice(0, requested);
  if (selected.length > 0) {
    const fill = fallbackWeekdays(requested).filter(day => !selected.includes(day));
    return [...selected, ...fill].slice(0, requested).sort((a, b) => a - b);
  }
  return fallbackWeekdays(requested);
}

function autoTemplates(days: number, band: ExperienceBand, goal: string): DayTemplate[] {
  if (days <= 2) return Array.from({ length: days }, () => FULL_BODY);
  if (days === 3) {
    if (band === 'beginner' || goal === 'retorno' || goal === 'saude') return [FULL_BODY, FULL_BODY, FULL_BODY];
    return [PUSH, PULL, LEGS];
  }
  if (days === 4) return [UPPER, LOWER, UPPER, LOWER];
  if (days === 5) return [PUSH, PULL, LEGS, UPPER, LOWER];
  return [PUSH, PULL, LEGS, PUSH, PULL, LEGS].slice(0, days);
}

function preferredTemplates(preferredSplit: string | undefined, days: number, band: ExperienceBand, goal: string): DayTemplate[] {
  const split = String(preferredSplit || '');
  if (split === 'Full body') return Array.from({ length: days }, () => FULL_BODY);
  if (split === 'Upper / Lower') return Array.from({ length: days }, (_, index) => index % 2 === 0 ? UPPER : LOWER);
  if (split === 'PPL' || split === 'ABC (3x por semana)') {
    const cycle = [PUSH, PULL, LEGS];
    return Array.from({ length: days }, (_, index) => cycle[index % cycle.length]);
  }
  if (split === 'Bro split' && days >= 5) {
    const bro: DayTemplate[] = [
      { label: 'Peito', tokens: ['peito', 'peito', 'peito', 'triceps'] },
      { label: 'Costas', tokens: ['costas', 'costas', 'costas', 'biceps'] },
      { label: 'Pernas', tokens: ['pernas', 'pernas', 'pernas', 'core'] },
      { label: 'Ombros', tokens: ['ombros', 'ombros', 'ombros', 'triceps'] },
      { label: 'Braços + Core', tokens: ['biceps', 'biceps', 'triceps', 'triceps', 'core'] },
      FULL_BODY
    ];
    return Array.from({ length: days }, (_, index) => bro[index % bro.length]);
  }
  return autoTemplates(days, band, goal);
}

function matchesToken(exercise: OfficialExercise, token: FocusToken): boolean {
  if (token === 'biceps' || token === 'triceps') return exercise.muscleSubgroup === token;
  return exercise.muscleGroup === token;
}

function bodyweightMechanicallyDemanding(exercise: OfficialExercise): boolean {
  return ['classic_push_up', 'decline_push_up', 'pull_up'].includes(exercise.id);
}

function exerciseScore(
  exercise: OfficialExercise,
  answers: WorkoutPlanAnswers,
  band: ExperienceBand,
  usage: ReadonlyMap<string, number>,
  slot: number
): number {
  let score = 100;
  const used = usage.get(exercise.id) || 0;
  score -= used * (answers.primaryGoal === 'forca' ? 8 : 22);

  const age = Number(answers.athleteProfile?.age);
  const weight = Number(answers.athleteProfile?.weightKg);
  const heightCm = Number(answers.athleteProfile?.heightCm);
  const bmi = Number.isFinite(weight) && Number.isFinite(heightCm) && weight > 0 && heightCm >= 120
    ? weight / ((heightCm / 100) ** 2)
    : null;
  const recoverySensitive = answers.primaryGoal === 'retorno' || (Number.isFinite(age) && age >= 60 && band === 'beginner');

  if (band === 'beginner' && COMPLEX_BEGINNER_IDS.has(exercise.id)) score -= 18;
  if (recoverySensitive && STABLE_MACHINE_IDS.has(exercise.id)) score += 18;
  if (recoverySensitive && COMPLEX_BEGINNER_IDS.has(exercise.id)) score -= 12;
  if (bmi !== null && bmi >= 30 && band === 'beginner' && bodyweightMechanicallyDemanding(exercise)) score -= 10;
  if ((answers.primaryGoal === 'forca' || answers.preferredTraining === 'forca') && STRENGTH_PRIORITY_IDS.has(exercise.id)) score += 14;
  if (answers.preferences?.includes('Prefiro treinos sem impacto') && STABLE_MACHINE_IDS.has(exercise.id)) score += 8;
  if (slot === 0 && STRENGTH_PRIORITY_IDS.has(exercise.id)) score += 5;

  return score;
}

function chooseExercise(
  pool: OfficialExercise[],
  token: FocusToken,
  answers: WorkoutPlanAnswers,
  band: ExperienceBand,
  usage: Map<string, number>,
  slot: number,
  alreadyInWorkout: Set<string>
): OfficialExercise | null {
  const eligible = pool.filter(exercise => matchesToken(exercise, token) && !alreadyInWorkout.has(exercise.id));
  const fallback = pool.filter(exercise => !alreadyInWorkout.has(exercise.id));
  const candidates = eligible.length ? eligible : fallback;
  if (!candidates.length) return null;
  return [...candidates].sort((a, b) => {
    const delta = exerciseScore(b, answers, band, usage, slot) - exerciseScore(a, answers, band, usage, slot);
    return delta || a.id.localeCompare(b.id);
  })[0];
}

function desiredExerciseCount(durationMinutes: number, template: DayTemplate): number {
  const byTime = durationMinutes <= 45 ? 5 : durationMinutes <= 65 ? 6 : durationMinutes <= 95 ? 7 : 8;
  return Math.max(Math.min(template.tokens.length, 6), Math.min(8, byTime));
}

function expandedTokens(template: DayTemplate, count: number): FocusToken[] {
  const tokens: FocusToken[] = [];
  for (let index = 0; index < count; index += 1) tokens.push(template.tokens[index % template.tokens.length]);
  return tokens;
}

function groupLabel(exercises: OfficialExercise[]): string {
  const unique = [...new Set(exercises.map(exercise => exercise.muscleGroup))];
  return unique.map(group => OFFICIAL_MUSCLE_GROUP_LABELS[group]).join(' + ');
}

function weeklyTargetForGroup(
  group: MuscleGroup,
  answers: WorkoutPlanAnswers,
  band: ExperienceBand
): number {
  const goal = normalizeTrainingGoal(answers.primaryGoal);
  const rule = GOAL_PRESCRIPTION_RULES[goal];
  let target = rule.weeklyDirectSets[band];
  const age = Number(answers.athleteProfile?.age);
  const conservativeStart = goal === 'retorno' || (Number.isFinite(age) && age >= 60 && band === 'beginner');
  if (conservativeStart) target = Math.max(4, Math.round(target * 0.8));
  // Arms/core receive substantial indirect work in compound patterns; keep
  // direct starting volume modest until execution history is available.
  if (group === 'bracos' || group === 'core') target = Math.max(4, Math.round(target * 0.7));
  return target;
}

function applySetPrescription(
  workouts: Array<{ selected: OfficialExercise[]; workout: WorkoutPlanDraft['workouts'][number] }>,
  answers: WorkoutPlanAnswers,
  band: ExperienceBand
) {
  const occurrences = new Map<MuscleGroup, number>();
  for (const item of workouts) {
    for (const exercise of item.selected) occurrences.set(exercise.muscleGroup, (occurrences.get(exercise.muscleGroup) || 0) + 1);
  }

  const goal = normalizeTrainingGoal(answers.primaryGoal);
  const rule = GOAL_PRESCRIPTION_RULES[goal];
  const age = Number(answers.athleteProfile?.age);
  const rir = Math.min(5, rule.targetRir + (goal === 'retorno' || (Number.isFinite(age) && age >= 60 && band === 'beginner') ? 1 : 0));

  for (const item of workouts) {
    item.workout.exercises = item.selected.map((exercise, index) => {
      const groupOccurrences = Math.max(1, occurrences.get(exercise.muscleGroup) || 1);
      const weeklyTarget = weeklyTargetForGroup(exercise.muscleGroup, answers, band);
      const sets = Math.max(2, Math.min(4, Math.round(weeklyTarget / groupOccurrences)));
      return {
        exerciseId: exercise.id,
        order: index,
        sets,
        repsMin: rule.repsMin,
        repsMax: rule.repsMax,
        restSeconds: rule.restSeconds,
        targetRir: rir
      };
    });
  }
}

function objectiveLabel(goal: string): string {
  const labels: Record<string, string> = {
    massa: 'ganho de massa muscular', forca: 'ganho de força', gordura: 'redução de gordura preservando o estímulo de força',
    condicionamento: 'condicionamento', definicao: 'definição preservando massa muscular', retorno: 'retorno gradual aos treinos',
    saude: 'saúde e qualidade de vida'
  };
  return labels[goal] || 'evolução física';
}

export function buildTrainingEnginePlan(answers: WorkoutPlanAnswers): WorkoutPlanDraft {
  const equipment = Array.isArray(answers.equipment) ? answers.equipment : [];
  const compatible = OFFICIAL_EXERCISES_BATCH_01.filter(exercise => isOfficialExerciseCompatible(exercise.id, equipment));
  if (compatible.length < 3) {
    throw new Error('Selecione equipamentos suficientes para montar um plano seguro com a biblioteca disponível.');
  }

  const weekdays = resolvedWeekdays(answers);
  const days = weekdays.length;
  const durationMinutes = Math.max(30, Math.min(120, Math.round(Number(answers.durationMinutes) || 60)));
  const band = experienceBand(answers.experienceLevel);
  const goal = normalizeTrainingGoal(answers.primaryGoal);
  const templates = preferredTemplates(answers.preferredSplit, days, band, goal);
  const usage = new Map<string, number>();

  const built = weekdays.map((weekday, dayIndex) => {
    const template = templates[dayIndex % templates.length];
    const count = Math.min(compatible.length, desiredExerciseCount(durationMinutes, template));
    const tokens = expandedTokens(template, count);
    const selected: OfficialExercise[] = [];
    const ids = new Set<string>();

    for (let slot = 0; slot < tokens.length; slot += 1) {
      const exercise = chooseExercise(compatible, tokens[slot], answers, band, usage, slot, ids);
      if (!exercise) continue;
      selected.push(exercise);
      ids.add(exercise.id);
      usage.set(exercise.id, (usage.get(exercise.id) || 0) + 1);
    }

    return {
      selected,
      workout: {
        id: `workout_${dayIndex + 1}`,
        name: `${template.label} ${String.fromCharCode(65 + dayIndex)}`,
        focus: groupLabel(selected),
        weekdays: [weekday],
        exercises: []
      }
    };
  });

  applySetPrescription(built, answers, band);

  const actualAnswers: WorkoutPlanAnswers = {
    ...answers,
    daysPerWeek: days,
    availableWeekdays: normalizeWeekdays(answers.availableWeekdays).length ? normalizeWeekdays(answers.availableWeekdays) : weekdays
  };
  const rule = GOAL_PRESCRIPTION_RULES[goal];
  const ageText = Number.isFinite(Number(answers.athleteProfile?.age)) ? ` idade ${Math.round(Number(answers.athleteProfile?.age))}` : '';
  const rationale = `Training Engine ${TRAINING_ENGINE_VERSION}: ${days} sessões nos dias escolhidos, com ${rule.repsMin}–${rule.repsMax} repetições, RIR alvo ${rule.targetRir} e descanso-base de ${rule.restSeconds}s para ${objectiveLabel(goal)}. Nível ${band}${ageText}; peso/altura não são usados para inventar carga inicial, e a progressão deve vir do histórico executado.`;

  const plan: WorkoutPlanDraft = {
    name: 'Plano Invictus Personalizado',
    description: 'Prescrição estruturada pelo Training Engine com biblioteca oficial, dias reais disponíveis e regras de evidência versionadas.',
    rationale,
    source: 'ai',
    generationMode: 'training_engine',
    trainingEngineVersion: TRAINING_ENGINE_VERSION,
    evidenceVersion: TRAINING_EVIDENCE_VERSION,
    objective: answers.primaryGoal || 'Evolução física',
    experienceLevel: answers.experienceLevel,
    durationMinutes,
    daysPerWeek: days,
    answers: actualAnswers,
    workouts: built.map(item => item.workout)
  };

  return assertTrainingPlanDraft(plan, actualAnswers);
}

export function allowedExerciseIdsForAnswers(answers: WorkoutPlanAnswers): Set<string> {
  const equipment = Array.isArray(answers.equipment) ? answers.equipment : [];
  return new Set(OFFICIAL_EXERCISES_BATCH_01.filter(exercise => isOfficialExerciseCompatible(exercise.id, equipment)).map(exercise => exercise.id));
}

export function selectedEquipmentRequirements(exerciseId: string): readonly string[] {
  return OFFICIAL_EXERCISE_EQUIPMENT_REQUIREMENTS[exerciseId] || [];
}
