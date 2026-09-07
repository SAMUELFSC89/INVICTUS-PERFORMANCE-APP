import {
  OFFICIAL_EXERCISES_BATCH_01 as LEGACY_EXERCISES,
  OFFICIAL_EXERCISE_EQUIPMENT_REQUIREMENTS as LEGACY_EQUIPMENT_REQUIREMENTS,
  OFFICIAL_MUSCLE_GROUP_LABELS as LEGACY_MUSCLE_GROUP_LABELS,
  type ExerciseAssetStatus,
  type OfficialExercise,
  type OfficialMuscleGroup,
  type OfficialMuscleSubgroup,
} from './exerciseCatalogLegacy';
import {
  OFFICIAL_EXERCISES_BATCH_02,
  OFFICIAL_EXERCISE_EQUIPMENT_REQUIREMENTS_BATCH_02,
  OFFICIAL_EXERCISE_FOCUS_AREAS_BATCH_02,
  type OfficialExerciseFocusArea,
} from './exerciseCatalogExpansion';

export type { ExerciseAssetStatus, OfficialExercise, OfficialMuscleGroup, OfficialMuscleSubgroup } from './exerciseCatalogLegacy';
export type { OfficialExerciseFocusArea } from './exerciseCatalogExpansion';

/**
 * Single source consumed by manual plans, deterministic generation, API validation and media.
 * The export name BATCH_01 is kept for saved-plan and code compatibility, but now represents
 * the full official catalogue: 59 verified legacy/current entries + 191 new entries = 250.
 */
export const OFFICIAL_EXERCISES_BATCH_01: OfficialExercise[] = [
  ...LEGACY_EXERCISES,
  ...OFFICIAL_EXERCISES_BATCH_02,
];

export const OFFICIAL_EXERCISE_BY_ID = new Map(OFFICIAL_EXERCISES_BATCH_01.map((exercise) => [exercise.id, exercise]));

if (OFFICIAL_EXERCISES_BATCH_01.length !== 250 || OFFICIAL_EXERCISE_BY_ID.size !== 250) {
  throw new Error(`Official exercise catalogue must contain 250 unique IDs; got ${OFFICIAL_EXERCISES_BATCH_01.length}/${OFFICIAL_EXERCISE_BY_ID.size}.`);
}

export const OFFICIAL_MUSCLE_GROUP_LABELS: Record<OfficialMuscleGroup, string> = LEGACY_MUSCLE_GROUP_LABELS;

/** All requirement values use only categories already collected by the equipment questionnaire. */
export const OFFICIAL_EXERCISE_EQUIPMENT_REQUIREMENTS: Record<string, string[]> = {
  ...LEGACY_EQUIPMENT_REQUIREMENTS,
  ...OFFICIAL_EXERCISE_EQUIPMENT_REQUIREMENTS_BATCH_02,
};

const LEGACY_FOCUS_AREAS: Record<string, OfficialExerciseFocusArea> = {
  barbell_back_squat: 'quadriceps',
  smith_machine_squat: 'quadriceps',
  leg_press_45: 'quadriceps',
  hack_squat: 'quadriceps',
  leg_extension: 'quadriceps',
  dumbbell_lunge: 'quadriceps',
  bulgarian_split_squat: 'quadriceps',
  dumbbell_walking_lunge: 'quadriceps',
  leg_curl: 'posteriores',
  seated_leg_curl: 'posteriores',
  barbell_stiff_deadlift: 'posteriores',
  hip_adductor_machine: 'adutores',
  hip_abductor_machine: 'abdutores',
  barbell_hip_thrust: 'gluteos',
  standing_calf_raise_machine: 'panturrilhas',
  seated_calf_raise: 'panturrilhas',
  leg_press_calf_raise: 'panturrilhas',
  bent_over_dumbbell_reverse_fly: 'deltoide_posterior',
  cable_face_pull: 'deltoide_posterior',
  reverse_pec_deck_fly: 'deltoide_posterior',
};

export const OFFICIAL_EXERCISE_FOCUS_AREAS: Record<string, OfficialExerciseFocusArea> = {
  ...LEGACY_FOCUS_AREAS,
  ...OFFICIAL_EXERCISE_FOCUS_AREAS_BATCH_02,
};

export function getOfficialExerciseFocusArea(exercise: OfficialExercise): OfficialExerciseFocusArea | OfficialMuscleGroup {
  return OFFICIAL_EXERCISE_FOCUS_AREAS[exercise.id] ?? exercise.muscleSubgroup ?? exercise.muscleGroup;
}

/**
 * Automatic plans only use exercises whose official thumbnail has been reviewed and activated.
 * The 191 new catalogue entries stay dormant while their media is being produced, preventing
 * blank exercise cards and preventing a large unreviewed batch from changing plan selection.
 */
export function isOfficialExerciseCompatible(exerciseId: string, availableEquipment: readonly string[]): boolean {
  const exercise = OFFICIAL_EXERCISE_BY_ID.get(exerciseId);
  if (!exercise || exercise.thumbStatus !== 'ready') return false;
  const required = OFFICIAL_EXERCISE_EQUIPMENT_REQUIREMENTS[exerciseId];
  return Array.isArray(required) && required.every((item) => availableEquipment.includes(item));
}
