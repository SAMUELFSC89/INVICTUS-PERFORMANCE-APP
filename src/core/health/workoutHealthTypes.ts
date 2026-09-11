/** Private health observations. Never input to ranking, score or fraud rules. */
export interface RecordedExerciseSet {
  id: string;
  exerciseId: string;
  exerciseName: string;
  equipment: string | null;
  startedAt: string;
  endedAt: string;
  status: 'completed' | 'interrupted';
  timingSource: 'user_marked';
  /** Actual user-entered results; planned values must never populate these. */
  reps: number | null;
  loadKg: number | null;
  /** Subjective reps-in-reserve reported after the set. Optional and private. */
  actualRir?: number | null;
}

export interface WorkoutHeartRateAudit {
  receivedSampleCount: number;
  validSampleCount: number;
  discardedSampleCount: number;
  coverageSeconds: number;
  coveragePercent: number;
  largestGapSeconds: number;
  quality: 'good' | 'partial' | 'insufficient';
  /** Optional corroborating evidence from a workout record created by the watch. */
  workoutDetected?: boolean;
}

export interface WorkoutHeartRateEvidence {
  status: 'available' | 'pending' | 'partial' | 'unavailable';
  source: 'apple_health' | 'health_connect' | null;
  /** Technical device/origin identity, when returned by the source. */
  sourceKey: string | null;
  samples: Array<{ timestamp: string; bpm: number }>;
  fetchedAt: string | null;
  truncated: boolean;
  audit?: WorkoutHeartRateAudit;
  reason?: string;
}

export interface WorkoutHealthRecord {
  version: 1;
  sessionId: string;
  startedAt: string;
  endedAt: string;
  sets: RecordedExerciseSet[];
  heartRate: WorkoutHeartRateEvidence;
  integrity?: { status: 'complete' | 'partial'; discardedSets: number; discardedHeartRateSamples: number };
}

export interface WorkoutFeedbackInsight {
  id: string;
  kind: 'observation' | 'achievement' | 'attention' | 'insufficient';
  title: string;
  evidence: string;
  meaning: string;
  nextStep: string;
  exerciseId?: string;
}

export interface WorkoutFeedback {
  methodologyVersion: string;
  status: 'available' | 'partial' | 'insufficient';
  session: { averageBpm: number | null; maxBpm: number | null; sampleCount: number; coveragePercent: number };
  insights: WorkoutFeedbackInsight[];
  limitations: string[];
}

/** Validate the envelope before calling the deterministic engine with persisted data. */
export function readWorkoutHealthRecord(value: unknown): WorkoutHealthRecord | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as WorkoutHealthRecord;
  if (record.version !== 1 || typeof record.sessionId !== 'string' || !record.sessionId.trim()
    || typeof record.startedAt !== 'string' || typeof record.endedAt !== 'string'
    || !Array.isArray(record.sets) || record.sets.length > 200 || !record.heartRate
    || !['available', 'pending', 'partial', 'unavailable'].includes(record.heartRate.status)
    || ![null, 'apple_health', 'health_connect'].includes(record.heartRate.source)
    || !(record.heartRate.sourceKey === null || typeof record.heartRate.sourceKey === 'string')
    || !Array.isArray(record.heartRate.samples) || record.heartRate.samples.length > 5000
    || !(record.heartRate.fetchedAt === null || typeof record.heartRate.fetchedAt === 'string')
    || typeof record.heartRate.truncated !== 'boolean') return null;
  if (!record.sets.every(set => set && typeof set.id === 'string' && typeof set.exerciseId === 'string'
    && typeof set.exerciseName === 'string' && typeof set.startedAt === 'string' && typeof set.endedAt === 'string'
    && (set.equipment === null || typeof set.equipment === 'string')
    && ['completed', 'interrupted'].includes(set.status) && set.timingSource === 'user_marked'
    && (set.reps === null || typeof set.reps === 'number') && (set.loadKg === null || typeof set.loadKg === 'number')
    && (set.actualRir === undefined || set.actualRir === null || (typeof set.actualRir === 'number' && Number.isInteger(set.actualRir) && set.actualRir >= 0 && set.actualRir <= 5)))) return null;
  if (!record.heartRate.samples.every(sample => sample && typeof sample.timestamp === 'string' && typeof sample.bpm === 'number')) return null;
  if (record.heartRate.audit !== undefined) {
    const audit = record.heartRate.audit;
    if (!audit || !Number.isInteger(audit.receivedSampleCount) || audit.receivedSampleCount < 0
      || !Number.isInteger(audit.validSampleCount) || audit.validSampleCount < 0
      || !Number.isInteger(audit.discardedSampleCount) || audit.discardedSampleCount < 0
      || typeof audit.coverageSeconds !== 'number' || !Number.isFinite(audit.coverageSeconds) || audit.coverageSeconds < 0
      || typeof audit.coveragePercent !== 'number' || !Number.isFinite(audit.coveragePercent) || audit.coveragePercent < 0 || audit.coveragePercent > 100
      || typeof audit.largestGapSeconds !== 'number' || !Number.isFinite(audit.largestGapSeconds) || audit.largestGapSeconds < 0
      || !['good', 'partial', 'insufficient'].includes(audit.quality)
      || (audit.workoutDetected !== undefined && typeof audit.workoutDetected !== 'boolean')) return null;
  }
  return record;
}
