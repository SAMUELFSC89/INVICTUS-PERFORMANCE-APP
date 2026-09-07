import { ARMS_EXPANSION } from './arms.js';
import { BACK_EXPANSION } from './back.js';
import { CHEST_EXPANSION } from './chest.js';
import { CORE_EXPANSION } from './core.js';
import { LEGS_EXPANSION } from './legs.js';
import { SHOULDERS_EXPANSION } from './shoulders.js';
import { materializeExerciseDefinitions, type ExpansionDefinition } from './shared.js';

export type { OfficialExerciseFocusArea } from './shared.js';

const DEFINITIONS: ExpansionDefinition[] = [
  ...CHEST_EXPANSION,
  ...BACK_EXPANSION,
  ...LEGS_EXPANSION,
  ...SHOULDERS_EXPANSION,
  ...ARMS_EXPANSION,
  ...CORE_EXPANSION,
];

const ids = DEFINITIONS.map((exercise) => exercise.id);
if (new Set(ids).size !== ids.length) throw new Error('Duplicate exercise ID inside catalogue expansion.');
if (DEFINITIONS.length !== 191) throw new Error(`Expected 191 catalogue additions; got ${DEFINITIONS.length}.`);

export const OFFICIAL_EXERCISES_BATCH_02 = materializeExerciseDefinitions(DEFINITIONS);

export const OFFICIAL_EXERCISE_EQUIPMENT_REQUIREMENTS_BATCH_02: Record<string, string[]> = Object.fromEntries(
  DEFINITIONS.map((exercise) => [exercise.id, exercise.requirements]),
);

export const OFFICIAL_EXERCISE_FOCUS_AREAS_BATCH_02 = Object.fromEntries(
  DEFINITIONS.map((exercise) => [exercise.id, exercise.focusArea]),
) as Record<string, ExpansionDefinition['focusArea']>;
