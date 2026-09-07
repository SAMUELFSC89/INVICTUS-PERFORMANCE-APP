import { applyTrainingMemoryToPlan, deriveTrainingMemory, recommendLoadFromMemory } from '../core/training/trainingMemory';
import type { WorkoutHealthRecord } from '../core/health/workoutHealthTypes';
import type { WorkoutPlanDraft } from '../types/workoutPlan';

function record(
  sessionId: string,
  endedAt: string,
  reps: number,
  loadKg: number,
  status: 'completed' | 'interrupted' = 'completed'
): WorkoutHealthRecord {
  const startedAt = new Date(Date.parse(endedAt) - 45 * 60_000).toISOString();
  return {
    version: 1,
    sessionId,
    startedAt,
    endedAt,
    sets: [
      {
        id: `${sessionId}_set_1`,
        exerciseId: 'barbell_bench_press',
        exerciseName: 'Supino reto com barra',
        equipment: 'barbell',
        startedAt,
        endedAt,
        status,
        timingSource: 'user_marked',
        reps,
        loadKg
      },
      {
        id: `${sessionId}_set_2`,
        exerciseId: 'barbell_bench_press',
        exerciseName: 'Supino reto com barra',
        equipment: 'barbell',
        startedAt,
        endedAt,
        status,
        timingSource: 'user_marked',
        reps,
        loadKg
      }
    ],
    heartRate: {
      status: 'unavailable',
      source: null,
      sourceKey: null,
      samples: [],
      fetchedAt: null,
      truncated: false
    }
  };
}

function plan(): WorkoutPlanDraft {
  return {
    name: 'Plano teste',
    source: 'ai',
    generationMode: 'training_engine',
    objective: 'massa',
    durationMinutes: 60,
    daysPerWeek: 1,
    workouts: [
      {
        id: 'workout_1',
        name: 'Peito A',
        focus: 'Peito',
        weekdays: [1],
        exercises: [
          {
            exerciseId: 'barbell_bench_press',
            order: 0,
            sets: 3,
            repsMin: 8,
            repsMax: 12,
            restSeconds: 90,
            targetRir: 2
          }
        ]
      }
    ]
  };
}

describe('training memory progression', () => {
  it('derives memory only from completed user-marked execution and ignores interrupted sets', () => {
    const memory = deriveTrainingMemory([
      record('latest', '2026-09-06T20:00:00.000Z', 12, 100),
      record('previous', '2026-09-03T20:00:00.000Z', 12, 100),
      record('interrupted', '2026-09-01T20:00:00.000Z', 30, 200, 'interrupted')
    ]);

    expect(memory.exercises.barbell_bench_press).toMatchObject({
      sessions: 2,
      lastLoadKg: 100,
      latestMinReps: 12,
      previousLoadKg: 100,
      previousMinReps: 12
    });
  });

  it('uses two comparable upper-range sessions before increasing load', () => {
    const memory = deriveTrainingMemory([
      record('latest', '2026-09-06T20:00:00.000Z', 12, 100),
      record('previous', '2026-09-03T20:00:00.000Z', 12, 100)
    ]);

    const result = applyTrainingMemoryToPlan(plan(), memory);
    expect(result.workouts[0].exercises[0].initialLoadKg).toBe(102.5);
  });

  it('carries the latest executed load forward when only one comparable session exists', () => {
    const memory = deriveTrainingMemory([
      record('latest', '2026-09-06T20:00:00.000Z', 12, 100)
    ]);

    const result = applyTrainingMemoryToPlan(plan(), memory);
    expect(result.workouts[0].exercises[0].initialLoadKg).toBe(100);
  });

  it('reduces load only after two comparable sessions below the prescribed rep floor', () => {
    const memory = deriveTrainingMemory([
      record('latest', '2026-09-06T20:00:00.000Z', 6, 100),
      record('previous', '2026-09-03T20:00:00.000Z', 7, 100)
    ]);

    const recommendation = recommendLoadFromMemory(memory.exercises.barbell_bench_press, 8, 12, 'peito');
    expect(recommendation).toEqual({ loadKg: 95, action: 'decrease', reason: 'lower_range_repeated' });
  });

  it('does not invent a load for exercises without execution history', () => {
    const memory = deriveTrainingMemory([]);
    const original = plan();
    const result = applyTrainingMemoryToPlan(original, memory);

    expect(result).toBe(original);
    expect(result.workouts[0].exercises[0].initialLoadKg).toBeUndefined();
  });
});
