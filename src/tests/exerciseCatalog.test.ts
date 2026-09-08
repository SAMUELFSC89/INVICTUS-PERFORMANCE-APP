import fs from 'node:fs';
import path from 'node:path';
import {
  OFFICIAL_EXERCISES_BATCH_01 as exercises,
  OFFICIAL_EXERCISE_BY_ID,
  OFFICIAL_EXERCISE_EQUIPMENT_REQUIREMENTS as requirements,
  getOfficialExerciseFocusArea,
  isOfficialExerciseCompatible,
} from '../data/exerciseCatalog';

const root = process.cwd();
const legacy = JSON.parse(fs.readFileSync(path.join(root, 'design/exercise-library/rebuild-2026-09-05/legacy-catalog-snapshot.json'), 'utf8'));

describe('catálogo oficial de exercícios', () => {
  test('250 IDs únicos cobrem os seis grupos com distribuição ampla', () => {
    expect(exercises).toHaveLength(250);
    expect(OFFICIAL_EXERCISE_BY_ID.size).toBe(250);
    for (const [group, count] of Object.entries({ peito: 35, costas: 45, pernas: 65, ombros: 35, bracos: 45, core: 25 })) {
      expect(exercises.filter(exercise => exercise.muscleGroup === group)).toHaveLength(count);
    }
    expect(exercises.filter(exercise => exercise.muscleSubgroup === 'biceps')).toHaveLength(16);
    expect(exercises.filter(exercise => exercise.muscleSubgroup === 'triceps')).toHaveLength(16);
  });

  test('regiões frequentemente esquecidas têm variedade própria no catálogo', () => {
    const counts = exercises.reduce<Record<string, number>>((acc, exercise) => {
      const focus = getOfficialExerciseFocusArea(exercise);
      acc[focus] = (acc[focus] || 0) + 1;
      return acc;
    }, {});

    expect(counts.panturrilhas).toBe(12);
    expect(counts.antebracos).toBe(13);
    expect(counts.trapezio).toBe(8);
    expect(counts.tibial_anterior).toBe(2);
    expect(counts.adutores).toBe(4);
    expect(counts.abdutores).toBe(4);
    expect(counts.gluteos).toBe(9);
    expect(counts.posteriores).toBe(13);
    expect(counts.deltoide_posterior).toBe(9);
    expect(counts.manguito_rotador).toBe(6);
  });

  test('os 27 IDs, nomes, grupos e equipamentos legados permanecem compatíveis', () => {
    expect(legacy.exercises).toHaveLength(27);
    for (const old of legacy.exercises) {
      const current = OFFICIAL_EXERCISE_BY_ID.get(old.id);
      expect(current).toMatchObject({ id: old.id, name: old.name, muscleGroup: old.muscleGroup, equipment: old.equipment });
    }
  });

  test('o ID histórico do stiff continua ligado a halteres', () => {
    expect(OFFICIAL_EXERCISE_BY_ID.get('barbell_stiff_deadlift')?.equipment).toBe('halteres');
    expect(requirements.barbell_stiff_deadlift).toEqual(['halteres']);
    expect(isOfficialExerciseCompatible('barbell_stiff_deadlift', ['barra_anilhas'])).toBe(false);
  });

  test('cada exercício possui requisitos explícitos usando as categorias reais do questionário', () => {
    const known = new Set(['barra_anilhas', 'halteres', 'maquinas', 'kettlebell', 'barra_fixa', 'elasticos', 'banco', 'crossover']);
    expect(Object.keys(requirements).sort()).toEqual(exercises.map(exercise => exercise.id).sort());
    for (const exercise of exercises) {
      expect(Array.isArray(requirements[exercise.id])).toBe(true);
      expect(requirements[exercise.id].every(equipment => known.has(equipment))).toBe(true);
    }
  });

  test('equipamento ausente e IDs desconhecidos falham sem virar peso corporal', () => {
    expect(isOfficialExerciseCompatible('invented_exercise', [])).toBe(false);
    expect(isOfficialExerciseCompatible('dumbbell_bench_press', ['halteres'])).toBe(false);
    expect(isOfficialExerciseCompatible('dumbbell_bench_press', ['halteres', 'banco'])).toBe(true);
    expect(isOfficialExerciseCompatible('classic_push_up', [])).toBe(true);
    expect(isOfficialExerciseCompatible('pull_up', ['maquinas'])).toBe(false);
    expect(isOfficialExerciseCompatible('pull_up', ['barra_fixa'])).toBe(true);
  });

  test.each([
    'barbell_shrug', 'dumbbell_shrug', 'smith_machine_shrug',
    'tibialis_raise_bodyweight', 'barbell_wrist_curl', 'barbell_reverse_wrist_curl',
    'reverse_ez_bar_curl', 'cable_external_rotation', 'cable_internal_rotation', 'cable_glute_kickback',
    'trap_bar_shrug', 'smith_machine_calf_raise', 'standing_barbell_calf_raise',
    'standing_dumbbell_calf_raise', 'single_leg_calf_raise_bodyweight', 'prone_y_raise_lower_trap',
    'plate_pinch_hold', 'dumbbell_farmer_carry', 'dead_hang', 'single_leg_leg_press_calf_raise',
    'dumbbell_step_up', 'dumbbell_glute_bridge', 'bilateral_cable_lateral_raise',
    'cable_pull_through', 'hanging_knee_raise', 'seated_dumbbell_calf_raise',
    'dumbbell_lateral_lunge', 'reverse_lunge_dumbbell', 'hanging_leg_raise', 'pendulum_squat_machine',
    'arnold_press', 'barbell_front_raise', 'barbell_push_press', 'cable_front_raise',
    'cable_rear_delt_row', 'chest_supported_reverse_dumbbell_fly', 'dumbbell_cuban_rotation',
    'dumbbell_scaption', 'high_cable_reverse_fly', 'machine_lateral_raise',
    'barbell_floor_press', 'cable_fly_high_to_low', 'cable_fly_low_to_high',
    'chest_press_machine', 'decline_barbell_bench_press', 'decline_chest_press_machine',
    'decline_dumbbell_bench_press', 'deficit_push_up', 'dumbbell_floor_press', 'dumbbell_fly_incline',
    'assisted_chin_up', 'barbell_pendlay_row', 'bilateral_dumbbell_bent_over_row',
    'chest_supported_machine_row', 'chin_up', 'conventional_deadlift', 'dumbbell_pullover_back',
    'inverted_row', 'kneeling_single_arm_lat_pulldown', 'landmine_row',
    'dumbbell_fly_flat', 'dumbbell_hex_press', 'dumbbell_pullover_chest',
    'dumbbell_squeeze_press', 'incline_barbell_bench_press', 'incline_chest_press_machine',
    'kneeling_cable_chest_press', 'plate_svend_press', 'resistance_band_chest_fly',
    'resistance_band_chest_press', 'single_arm_cable_chest_press', 'single_arm_dumbbell_floor_press',
    'smith_machine_bench_press', 'smith_machine_incline_press', 'standing_cable_chest_press',
    'weighted_push_up', 'wide_grip_push_up', 'cable_shrug', 'chest_supported_dumbbell_shrug',
    'incline_dumbbell_shrug', 'machine_high_row', 'machine_pullover', 'meadows_row',
    'neutral_grip_pull_up', 'neutral_grip_seated_cable_row', 'plate_loaded_row_machine',
    'rack_pull', 'resistance_band_row', 'rope_cable_pullover', 'scapular_pull_up',
    'single_arm_lat_pulldown', 'single_arm_seated_cable_row', 'smith_machine_inverted_row',
    'underhand_barbell_row', 'underhand_lat_pulldown', 'wide_grip_lat_pulldown',
    'wide_grip_seated_cable_row', 'band_hip_adduction', 'banded_clamshell',
    'banded_lateral_walk', 'belt_squat_machine', 'bodyweight_glute_bridge',
    'cable_hip_abduction', 'cable_hip_adduction', 'copenhagen_adductor_plank',
    'donkey_calf_raise_machine', 'dumbbell_goblet_squat', 'frog_pump', 'front_squat_barbell',
    'hack_squat_calf_raise', 'hip_thrust_machine', 'horizontal_leg_press',
    'kettlebell_goblet_squat', 'kettlebell_romanian_deadlift', 'machine_glute_kickback',
    'nordic_hamstring_curl', 'romanian_deadlift_barbell', 'romanian_deadlift_dumbbell',
    'seated_single_leg_calf_raise_machine', 'single_leg_hip_thrust', 'single_leg_leg_extension',
    'single_leg_leg_press', 'single_leg_lying_leg_curl', 'single_leg_romanian_deadlift',
    'single_leg_seated_leg_curl', 'sissy_squat_bodyweight', 'smith_split_squat',
    'standing_leg_curl_machine', 'stiff_leg_deadlift_barbell', 'sumo_deadlift_barbell',
  ])('thumbnail aprovado libera %s somente com o equipamento correto', (id) => {
    expect(OFFICIAL_EXERCISE_BY_ID.get(id)?.thumbStatus).toBe('ready');
    expect(isOfficialExerciseCompatible(id, requirements[id])).toBe(true);
    for (const missing of requirements[id]) {
      expect(isOfficialExerciseCompatible(id, requirements[id].filter(item => item !== missing))).toBe(false);
    }
  });

  test('exercícios sem thumbnail aprovado continuam fora da geração automática', () => {
    expect(exercises.filter(exercise => exercise.thumbStatus === 'ready')).toHaveLength(189);
    expect(exercises.filter(exercise => exercise.thumbStatus === 'waiting_for_thumb')).toHaveLength(61);
    expect(OFFICIAL_EXERCISE_BY_ID.get('close_grip_bench_press')?.thumbStatus).toBe('waiting_for_thumb');
    expect(isOfficialExerciseCompatible('close_grip_bench_press', requirements.close_grip_bench_press)).toBe(false);
  });

  test('nenhuma imagem ausente recebe estado pronto e nenhum vídeo é inventado', () => {
    for (const exercise of exercises) {
      expect(exercise.thumbUrl).toBe(`/assets/exercise-library/rebuild-2026-09-05/${exercise.id}/thumb.webp`);
      if (exercise.thumbStatus === 'ready') {
        const filename = path.join(root, 'public', exercise.thumbUrl);
        expect(fs.existsSync(filename)).toBe(true);
        expect(fs.statSync(filename).size).toBeGreaterThan(0);
        const image = fs.readFileSync(filename);
        expect(image.toString('ascii', 0, 4)).toBe('RIFF');
        expect(image.toString('ascii', 8, 12)).toBe('WEBP');
        expect(image.readUInt32LE(4) + 8).toBe(image.length);
        expect(['VP8 ', 'VP8L', 'VP8X']).toContain(image.toString('ascii', 12, 16));
      }
      if (exercise.thumbFallbackUrl) expect(fs.existsSync(path.join(root, 'public', exercise.thumbFallbackUrl))).toBe(true);
      expect(exercise.demoStatus).toBe('waiting_for_demo');
      expect(exercise.demoUrl).toBeUndefined();
      expect(exercise.demoLoop).not.toBe(true);
    }
  });
});
