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

export interface WorkoutHeartRateAuditBucket {
  startedAt: string;
  endedAt: string;
  sampleCount: number;
  averageBpm: number | null;
  coveragePercent: number;
}

export interface WorkoutHeartRateSyncEvent {
  fetchedAt: string;
  validSampleCount: number;
  coveragePercent: number;
  seriesHash?: string;
}

export interface WorkoutHeartRateAudit {
  receivedSampleCount: number;
  validSampleCount: number;
  discardedSampleCount: number;
  coverageSeconds: number;
  coveragePercent: number;
  largestGapSeconds: number;
  quality: 'excellent' | 'good' | 'partial' | 'insufficient';
  fiveMinuteBuckets?: WorkoutHeartRateAuditBucket[];
  discardedReasons?: Record<string, number>;
  selectedSourceKey?: string | null;
  sourceCandidateCount?: number;
  /** SHA-256 over the normalized accepted series, computed server-side. */
  seriesHash?: string;
  /** Bounded history of initial/follow-up synchronization snapshots. */
  syncHistory?: WorkoutHeartRateSyncEvent[];
  /** Optional corroborating evidence from a workout record created by the watch. */
  workoutDetected?: boolean;
  /** Dense series may also be archived by chunks server-side. */
  archivedChunkCount?: number;
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
      || !['excellent', 'good', 'partial', 'insufficient'].includes(audit.quality)
      || (audit.workoutDetected !== undefined && typeof audit.workoutDetected !== 'boolean')
      || (audit.selectedSourceKey !== undefined && audit.selectedSourceKey !== null && typeof audit.selectedSourceKey !== 'string')
      || (audit.sourceCandidateCount !== undefined && (!Number.isInteger(audit.sourceCandidateCount) || audit.sourceCandidateCount < 0))
      || (audit.seriesHash !== undefined && !/^sha256:[a-f0-9]{64}$/.test(audit.seriesHash))
      || (audit.archivedChunkCount !== undefined && (!Number.isInteger(audit.archivedChunkCount) || audit.archivedChunkCount < 0))) return null;
    if (audit.discardedReasons !== undefined && (!audit.discardedReasons || typeof audit.discardedReasons !== 'object'
      || Array.isArray(audit.discardedReasons) || Object.values(audit.discardedReasons).some(count => !Number.isInteger(count) || count < 0))) return null;
    if (audit.fiveMinuteBuckets !== undefined && (!Array.isArray(audit.fiveMinuteBuckets) || audit.fiveMinuteBuckets.length > 150
      || !audit.fiveMinuteBuckets.every(bucket => bucket && typeof bucket.startedAt === 'string' && typeof bucket.endedAt === 'string'
        && Number.isInteger(bucket.sampleCount) && bucket.sampleCount >= 0
        && (bucket.averageBpm === null || (typeof bucket.averageBpm === 'number' && Number.isFinite(bucket.averageBpm) && bucket.averageBpm >= 30 && bucket.averageBpm <= 240))
        && typeof bucket.coveragePercent === 'number' && Number.isFinite(bucket.coveragePercent) && bucket.coveragePercent >= 0 && bucket.coveragePercent <= 100))) return null;
    if (audit.syncHistory !== undefined && (!Array.isArray(audit.syncHistory) || audit.syncHistory.length > 10
      || !audit.syncHistory.every(event => event && typeof event.fetchedAt === 'string'
        && Number.isInteger(event.validSampleCount) && event.validSampleCount >= 0
        && typeof event.coveragePercent === 'number' && event.coveragePercent >= 0 && event.coveragePercent <= 100
        && (event.seriesHash === undefined || /^sha256:[a-f0-9]{64}$/.test(event.seriesHash))))) return null;
  }
  return record;
}
