import fs from 'node:fs';
import path from 'node:path';
import {
  OFFICIAL_EXERCISES_BATCH_01 as exercises,
  OFFICIAL_EXERCISE_BY_ID,
  OFFICIAL_EXERCISE_EQUIPMENT_REQUIREMENTS as requirements,
  isOfficialExerciseCompatible,
} from '../data/exerciseCatalog';

const root = process.cwd();
const legacy = JSON.parse(fs.readFileSync(path.join(root, 'design/exercise-library/rebuild-2026-09-05/legacy-catalog-snapshot.json'), 'utf8'));

describe('catálogo oficial de exercícios', () => {
  test('59 IDs únicos cobrem os seis grupos e os dois subgrupos de braços', () => {
    expect(exercises).toHaveLength(59);
    expect(OFFICIAL_EXERCISE_BY_ID.size).toBe(59);
    for (const [group, count] of Object.entries({ peito: 8, costas: 10, pernas: 17, ombros: 7, bracos: 10, core: 7 })) {
      expect(exercises.filter(exercise => exercise.muscleGroup === group)).toHaveLength(count);
    }
    expect(exercises.filter(exercise => exercise.muscleSubgroup === 'biceps')).toHaveLength(5);
    expect(exercises.filter(exercise => exercise.muscleSubgroup === 'triceps')).toHaveLength(5);
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

  test('nenhuma imagem ausente recebe estado pronto e nenhum vídeo é inventado', () => {
    for (const exercise of exercises) {
      expect(exercise.thumbUrl).toBe(`/assets/exercise-library/rebuild-2026-09-05/${exercise.id}/thumb.webp`);
      if (exercise.thumbStatus === 'ready') {
        const filename = path.join(root, 'public', exercise.thumbUrl);
        expect(fs.existsSync(filename)).toBe(true);
        expect(fs.statSync(filename).size).toBeGreaterThan(0);
      }
      if (exercise.thumbFallbackUrl) expect(fs.existsSync(path.join(root, 'public', exercise.thumbFallbackUrl))).toBe(true);
      expect(exercise.demoStatus).toBe('waiting_for_demo');
      expect(exercise.demoUrl).toBeUndefined();
      expect(exercise.demoLoop).not.toBe(true);
    }
  });
});
