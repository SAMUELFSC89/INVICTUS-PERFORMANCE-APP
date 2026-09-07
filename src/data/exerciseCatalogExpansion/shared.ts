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

const APPROVED_EXPANSION_THUMB_IDS: ReadonlySet<string> = new Set([
  'barbell_shrug',
  'dumbbell_shrug',
  'smith_machine_shrug',
  'tibialis_raise_bodyweight',
  'barbell_wrist_curl',
  'barbell_reverse_wrist_curl',
  'reverse_ez_bar_curl',
  'cable_external_rotation',
  'cable_internal_rotation',
  'cable_glute_kickback',
  'trap_bar_shrug',
  'smith_machine_calf_raise',
  'standing_barbell_calf_raise',
  'standing_dumbbell_calf_raise',
  'single_leg_calf_raise_bodyweight',
  'prone_y_raise_lower_trap',
  'plate_pinch_hold',
  'dumbbell_farmer_carry',
  'dead_hang',
  'single_leg_leg_press_calf_raise',
  'dumbbell_step_up',
  'dumbbell_glute_bridge',
  'bilateral_cable_lateral_raise',
  'cable_pull_through',
  'hanging_knee_raise',
  'seated_dumbbell_calf_raise',
  'dumbbell_lateral_lunge',
  'reverse_lunge_dumbbell',
  'hanging_leg_raise',
  'pendulum_squat_machine',
  'arnold_press',
  'barbell_front_raise',
  'barbell_push_press',
  'cable_front_raise',
  'cable_rear_delt_row',
  'chest_supported_reverse_dumbbell_fly',
  'dumbbell_cuban_rotation',
  'dumbbell_scaption',
  'high_cable_reverse_fly',
  'machine_lateral_raise',
]);

export function materializeExerciseDefinitions(definitions: readonly ExpansionDefinition[]): ExpansionOfficialExercise[] {
  return definitions.map(({ requirements: _requirements, focusArea: _focusArea, ...exercise }) => ({
    ...exercise,
    thumbUrl: `${ASSET_BASE}${exercise.id}/thumb.webp`,
    thumbStatus: APPROVED_EXPANSION_THUMB_IDS.has(exercise.id) ? 'ready' : 'waiting_for_thumb',
    demoStatus: 'waiting_for_demo',
  }));
}
