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
  'barbell_floor_press',
  'cable_fly_high_to_low',
  'cable_fly_low_to_high',
  'chest_press_machine',
  'decline_barbell_bench_press',
  'decline_chest_press_machine',
  'decline_dumbbell_bench_press',
  'deficit_push_up',
  'dumbbell_floor_press',
  'dumbbell_fly_incline',
  'assisted_chin_up',
  'barbell_pendlay_row',
  'bilateral_dumbbell_bent_over_row',
  'chest_supported_machine_row',
  'chin_up',
  'conventional_deadlift',
  'dumbbell_pullover_back',
  'inverted_row',
  'kneeling_single_arm_lat_pulldown',
  'landmine_row',
  'dumbbell_fly_flat',
  'dumbbell_hex_press',
  'dumbbell_pullover_chest',
  'dumbbell_squeeze_press',
  'incline_barbell_bench_press',
  'incline_chest_press_machine',
  'kneeling_cable_chest_press',
  'plate_svend_press',
  'resistance_band_chest_fly',
  'resistance_band_chest_press',
  'single_arm_cable_chest_press',
  'single_arm_dumbbell_floor_press',
  'smith_machine_bench_press',
  'smith_machine_incline_press',
  'standing_cable_chest_press',
  'weighted_push_up',
  'wide_grip_push_up',
  'cable_shrug',
  'chest_supported_dumbbell_shrug',
  'incline_dumbbell_shrug',
  'machine_high_row',
  'machine_pullover',
  'meadows_row',
  'neutral_grip_pull_up',
  'neutral_grip_seated_cable_row',
  'plate_loaded_row_machine',
  'rack_pull',
  'resistance_band_row',
  'rope_cable_pullover',
  'scapular_pull_up',
  'single_arm_lat_pulldown',
  'single_arm_seated_cable_row',
  'smith_machine_inverted_row',
  'underhand_barbell_row',
  'underhand_lat_pulldown',
  'wide_grip_lat_pulldown',
  'wide_grip_seated_cable_row',
  'band_hip_adduction',
  'banded_clamshell',
  'banded_lateral_walk',
  'belt_squat_machine',
  'bodyweight_glute_bridge',
  'cable_hip_abduction',
  'cable_hip_adduction',
  'copenhagen_adductor_plank',
  'donkey_calf_raise_machine',
  'dumbbell_goblet_squat',
  'frog_pump',
  'front_squat_barbell',
  'hack_squat_calf_raise',
  'hip_thrust_machine',
  'horizontal_leg_press',
  'kettlebell_goblet_squat',
  'kettlebell_romanian_deadlift',
  'machine_glute_kickback',
  'nordic_hamstring_curl',
  'romanian_deadlift_barbell',
  'romanian_deadlift_dumbbell',
  'seated_single_leg_calf_raise_machine',
  'single_leg_hip_thrust',
  'single_leg_leg_extension',
  'single_leg_leg_press',
  'single_leg_lying_leg_curl',
  'single_leg_romanian_deadlift',
  'single_leg_seated_leg_curl',
  'sissy_squat_bodyweight',
  'smith_split_squat',
  'standing_leg_curl_machine',
  'stiff_leg_deadlift_barbell',
  'sumo_deadlift_barbell',
]);

export function materializeExerciseDefinitions(definitions: readonly ExpansionDefinition[]): ExpansionOfficialExercise[] {
  return definitions.map(({ requirements: _requirements, focusArea: _focusArea, ...exercise }) => ({
    ...exercise,
    thumbUrl: `${ASSET_BASE}${exercise.id}/thumb.webp`,
    thumbStatus: APPROVED_EXPANSION_THUMB_IDS.has(exercise.id) ? 'ready' : 'waiting_for_thumb',
    demoStatus: 'waiting_for_demo',
  }));
}
