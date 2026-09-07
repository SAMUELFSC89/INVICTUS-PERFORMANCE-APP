import { applyTrainingMemoryToPlan, deriveTrainingMemory, recommendLoadFromMemory } from '../core/training/trainingMemory';
import type { WorkoutHealthRecord } from '../core/health/workoutHealthTypes';
import type { WorkoutPlanDraft } from '../types/workoutPlan';

function record(sessionId: string, endedAt: string, reps: number, loadKg: number, actualRir: number, status: 'completed' | 'interrupted' = 'completed'): WorkoutHealthRecord {
  const startedAt = new Date(Date.parse(endedAt) - 45 * 60_000).toISOString();
  return {
    version: 1,
    sessionId,
    startedAt,
    endedAt,
    sets: [1, 2].map(index => ({
      id: `${sessionId}_set_${index}`,
      exerciseId: 'barbell_bench_press',
      exerciseName: 'Supino reto com barra',
      equipment: 'barbell',
      startedAt,
      endedAt,
      status,
      timingSource: 'user_marked' as const,
      reps,
      loadKg,
      actualRir
    })),
    heartRate: { status: 'unavailable', source: null, sourceKey: null, samples: [], fetchedAt: null, truncated: false }
  };
}

function plan(): WorkoutPlanDraft {
  return {
    name: 'Plano RIR',
    source: 'ai',
    generationMode: 'training_engine',
    objective: 'massa',
    durationMinutes: 60,
    daysPerWeek: 1,
    workouts: [{
      id: 'workout_1',
      name: 'Peito A',
      focus: 'Peito',
      weekdays: [1],
      exercises: [{
        exerciseId: 'barbell_bench_press', order: 0, sets: 3,
        repsMin: 8, repsMax: 12, restSeconds: 90, targetRir: 2
      }]
    }]
  };
}

describe('RIR-aware private progression', () => {
  it('derives RIR only from completed user-marked execution', () => {
    const memory = deriveTrainingMemory([
      record('latest', '2026-09-06T20:00:00.000Z', 12, 100, 2),
      record('previous', '2026-09-03T20:00:00.000Z', 12, 100, 3),
      record('interrupted', '2026-09-01T20:00:00.000Z', 12, 100, 0, 'interrupted')
    ]);
    expect(memory.exercises.barbell_bench_press).toMatchObject({ sessions: 2, latestRir: 2, previousRir: 3 });
  });

  it('increases when top-range reps are repeated at or above target RIR', () => {
    const memory = deriveTrainingMemory([
      record('latest', '2026-09-06T20:00:00.000Z', 12, 100, 2),
      record('previous', '2026-09-03T20:00:00.000Z', 12, 100, 3)
    ]);
    expect(applyTrainingMemoryToPlan(plan(), memory).workouts[0].exercises[0].initialLoadKg).toBe(102.5);
  });

  it('maintains load when top-range reps required more effort than prescribed', () => {
    const memory = deriveTrainingMemory([
      record('latest', '2026-09-06T20:00:00.000Z', 12, 100, 1),
      record('previous', '2026-09-03T20:00:00.000Z', 12, 100, 1)
    ]);
    expect(recommendLoadFromMemory(memory.exercises.barbell_bench_press, 8, 12, 'peito', 2))
      .toEqual({ loadKg: 100, action: 'maintain', reason: 'effort_above_target' });
    expect(applyTrainingMemoryToPlan(plan(), memory).workouts[0].exercises[0].initialLoadKg).toBe(100);
  });
});