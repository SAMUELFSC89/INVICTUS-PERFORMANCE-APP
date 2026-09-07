import type { WorkoutHealthRecord } from '../health/workoutHealthTypes';
import type { MuscleGroup } from '../../types/workoutPlan';

export const TRAINING_MEMORY_VERSION = 'training-memory-v1';

export interface ExerciseTrainingMemory {
  exerciseId: string;
  sessions: number;
  lastPerformedAt: string;
  /** Representative load from the latest session's actual user-entered working sets. */
  lastLoadKg?: number;
  /** Minimum reps completed across the latest session's working sets. */
  latestMinReps?: number;
  /** Same measure for the preceding comparable session, when available. */
  previousMinReps?: number;
  previousLoadKg?: number;
}

export interface TrainingMemorySnapshot {
  version: typeof TRAINING_MEMORY_VERSION;
  sessionsReviewed: number;
  latestSessionAt?: string;
  exercises: Record<string, ExerciseTrainingMemory>;
}

export interface LoadRecommendation {
  loadKg: number;
  action: 'maintain' | 'increase' | 'decrease';
  reason: 'recent_execution' | 'upper_range_repeated' | 'lower_range_repeated';
}

type SessionPerformance = {
  endedAt: string;
  loadKg?: number;
  minReps?: number;
};

function median(values: number[]): number | undefined {
  if (!values.length) return undefined;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

function roundedPlateLoad(value: number): number {
  return Math.max(0, Math.round(value * 2) / 2);
}

function comparableLoads(a?: number, b?: number): boolean {
  if (!(typeof a === 'number' && a > 0 && typeof b === 'number' && b > 0)) return false;
  return Math.abs(a - b) / Math.max(a, b) <= 0.075;
}

function summarizeExerciseInSession(record: WorkoutHealthRecord, exerciseId: string): SessionPerformance | null {
  const completed = record.sets.filter(set =>
    set.exerciseId === exerciseId && set.status === 'completed' && set.timingSource === 'user_marked'
  );
  if (!completed.length) return null;

  const loaded = completed.filter(set =>
    typeof set.loadKg === 'number' && Number.isFinite(set.loadKg) && set.loadKg > 0
    && typeof set.reps === 'number' && Number.isFinite(set.reps) && set.reps > 0
  );
  if (!loaded.length) return { endedAt: record.endedAt };

  // Warm-up sets are not explicitly tagged in the journal. Restricting the
  // summary to >=90% of the session's highest load is a conservative way to
  // avoid treating ramp-up sets as the athlete's working prescription.
  const maxLoad = Math.max(...loaded.map(set => set.loadKg as number));
  const working = loaded.filter(set => (set.loadKg as number) >= maxLoad * 0.9);
  const loadKg = median(working.map(set => set.loadKg as number));
  const reps = working.map(set => set.reps as number);
  return {
    endedAt: record.endedAt,
    ...(loadKg !== undefined ? { loadKg: roundedPlateLoad(loadKg) } : {}),
    ...(reps.length ? { minReps: Math.min(...reps) } : {})
  };
}

/**
 * Builds an aggregate, private training memory. It contains no heart-rate data
 * and no raw health samples; only actual user-entered exercise execution is
 * retained. Planned reps/load never enter this function as observed results.
 */
export function deriveTrainingMemory(records: readonly WorkoutHealthRecord[]): TrainingMemorySnapshot {
  const validRecords = records
    .filter(record => record && Array.isArray(record.sets) && Number.isFinite(Date.parse(record.endedAt)))
    .sort((a, b) => Date.parse(b.endedAt) - Date.parse(a.endedAt))
    .slice(0, 30);
  const exerciseIds = new Set(validRecords.flatMap(record => record.sets
    .filter(set => set.status === 'completed' && set.timingSource === 'user_marked' && Boolean(set.exerciseId))
    .map(set => set.exerciseId)));
  const exercises: Record<string, ExerciseTrainingMemory> = {};

  for (const exerciseId of exerciseIds) {
    const performances = validRecords
      .map(record => summarizeExerciseInSession(record, exerciseId))
      .filter((value): value is SessionPerformance => value !== null);
    if (!performances.length) continue;
    const latest = performances[0];
    const previousComparable = performances.slice(1).find(performance =>
      latest.loadKg === undefined || performance.loadKg === undefined || comparableLoads(latest.loadKg, performance.loadKg)
    );
    exercises[exerciseId] = {
      exerciseId,
      sessions: performances.length,
      lastPerformedAt: latest.endedAt,
      ...(latest.loadKg !== undefined ? { lastLoadKg: latest.loadKg } : {}),
      ...(latest.minReps !== undefined ? { latestMinReps: latest.minReps } : {}),
      ...(previousComparable?.loadKg !== undefined ? { previousLoadKg: previousComparable.loadKg } : {}),
      ...(previousComparable?.minReps !== undefined ? { previousMinReps: previousComparable.minReps } : {})
    };
  }

  return {
    version: TRAINING_MEMORY_VERSION,
    sessionsReviewed: validRecords.length,
    ...(validRecords[0]?.endedAt ? { latestSessionAt: validRecords[0].endedAt } : {}),
    exercises
  };
}

/**
 * Double-progression heuristic. An increase/decrease requires two comparable
 * sessions at the same working-load band; one session alone only carries the
 * most recently executed load forward. Percent changes are intentionally
 * small and are not derived from age, sex or body mass.
 */
export function recommendLoadFromMemory(
  memory: ExerciseTrainingMemory | undefined,
  repsMin: number,
  repsMax: number,
  muscleGroup: MuscleGroup
): LoadRecommendation | null {
  if (!memory || !(typeof memory.lastLoadKg === 'number' && memory.lastLoadKg > 0)) return null;
  const current = memory.lastLoadKg;
  const comparable = comparableLoads(current, memory.previousLoadKg);
  const latest = memory.latestMinReps;
  const previous = memory.previousMinReps;

  if (comparable && typeof latest === 'number' && typeof previous === 'number' && latest >= repsMax && previous >= repsMax) {
    const increase = muscleGroup === 'pernas' ? 1.05 : 1.025;
    return { loadKg: roundedPlateLoad(current * increase), action: 'increase', reason: 'upper_range_repeated' };
  }
  if (comparable && typeof latest === 'number' && typeof previous === 'number' && latest < repsMin && previous < repsMin) {
    return { loadKg: roundedPlateLoad(current * 0.95), action: 'decrease', reason: 'lower_range_repeated' };
  }
  return { loadKg: roundedPlateLoad(current), action: 'maintain', reason: 'recent_execution' };
}
