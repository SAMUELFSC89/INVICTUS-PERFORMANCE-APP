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
  ])('thumbnail aprovado libera %s somente com o equipamento correto', (id) => {
    expect(OFFICIAL_EXERCISE_BY_ID.get(id)?.thumbStatus).toBe('ready');
    expect(isOfficialExerciseCompatible(id, requirements[id])).toBe(true);
    for (const missing of requirements[id]) {
      expect(isOfficialExerciseCompatible(id, requirements[id].filter(item => item !== missing))).toBe(false);
    }
  });

  test('exercícios sem thumbnail aprovado continuam fora da geração automática', () => {
    expect(exercises.filter(exercise => exercise.thumbStatus === 'ready')).toHaveLength(69);
    expect(exercises.filter(exercise => exercise.thumbStatus === 'waiting_for_thumb')).toHaveLength(181);
    expect(OFFICIAL_EXERCISE_BY_ID.get('standing_dumbbell_calf_raise')?.thumbStatus).toBe('waiting_for_thumb');
    expect(isOfficialExerciseCompatible('standing_dumbbell_calf_raise', ['halteres'])).toBe(false);
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
