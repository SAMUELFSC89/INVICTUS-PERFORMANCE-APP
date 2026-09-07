export type ExpansionMuscleGroup = 'peito' | 'costas' | 'pernas' | 'ombros' | 'bracos' | 'core';
export type ExpansionMuscleSubgroup = 'biceps' | 'triceps';

export type OfficialExerciseFocusArea =
  | 'abdutores'
  | 'adutores'
  | 'antebracos'
  | 'biceps'
  | 'core'
  | 'costas'
  | 'deltoide_posterior'
  | 'gluteos'
  | 'manguito_rotador'
  | 'ombros'
  | 'panturrilhas'
  | 'peito'
  | 'posteriores'
  | 'quadriceps'
  | 'tibial_anterior'
  | 'trapezio'
  | 'triceps';

export type ExpansionDefinition = {
  id: string;
  name: string;
  muscleGroup: ExpansionMuscleGroup;
  muscleSubgroup?: ExpansionMuscleSubgroup;
  equipment: string;
  requirements: string[];
  focusArea: OfficialExerciseFocusArea;
};

export type ExpansionOfficialExercise = {
  id: string;
  name: string;
  muscleGroup: ExpansionMuscleGroup;
  muscleSubgroup?: ExpansionMuscleSubgroup;
  equipment: string;
  thumbUrl: string;
  thumbStatus: 'ready' | 'waiting_for_thumb';
  demoStatus: 'waiting_for_demo';
};

export const e = (
  id: string,
  name: string,
  muscleGroup: ExpansionMuscleGroup,
  equipment: string,
  requirements: string[],
  focusArea: OfficialExerciseFocusArea,
  muscleSubgroup?: ExpansionMuscleSubgroup,
): ExpansionDefinition => ({
  id,
  name,
  muscleGroup,
  equipment,
  requirements,
  focusArea,
  ...(muscleSubgroup ? { muscleSubgroup } : {}),
});

const ASSET_BASE = '/assets/exercise-library/rebuild-2026-09-05/';

/**
 * Expansion thumbnails that were visually reviewed and approved for production.
 * Keep this list explicit so adding a file alone never activates an exercise by accident.
 */
export const APPROVED_EXPANSION_THUMB_IDS = new Set([
  'barbell_reverse_wrist_curl',
  'barbell_shrug',
  'barbell_wrist_curl',
  'cable_external_rotation',
  'cable_glute_kickback',
  'cable_internal_rotation',
  'dumbbell_shrug',
  'reverse_ez_bar_curl',
  'smith_machine_shrug',
  'tibialis_raise_bodyweight',
]);

export function materializeExerciseDefinitions(definitions: readonly ExpansionDefinition[]): ExpansionOfficialExercise[] {
  return definitions.map(({ requirements: _requirements, focusArea: _focusArea, ...exercise }) => ({
    ...exercise,
    thumbUrl: `${ASSET_BASE}${exercise.id}/thumb.webp`,
    thumbStatus: APPROVED_EXPANSION_THUMB_IDS.has(exercise.id) ? 'ready' : 'waiting_for_thumb',
    demoStatus: 'waiting_for_demo',
  }));
}
