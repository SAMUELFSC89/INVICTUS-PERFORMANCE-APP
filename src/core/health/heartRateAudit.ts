import type { WorkoutHeartRateAudit, WorkoutHeartRateAuditBucket } from './workoutHealthTypes';

const MAX_COVERED_GAP_MS = 60_000;
const BUCKET_MS = 5 * 60_000;

function buildBuckets(
  accepted: Array<{ timestamp: string; bpm: number; at: number }>,
  start: number,
  end: number,
): WorkoutHeartRateAuditBucket[] {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
  const buckets: WorkoutHeartRateAuditBucket[] = [];
  for (let cursor = start; cursor < end; cursor += BUCKET_MS) {
    const bucketEnd = Math.min(end, cursor + BUCKET_MS);
    const points = accepted.filter((sample) => sample.at >= cursor && (bucketEnd === end ? sample.at <= bucketEnd : sample.at < bucketEnd));
    let coveredMs = 0;
    for (let index = 1; index < points.length; index += 1) {
      const gap = points[index].at - points[index - 1].at;
      if (gap > 0 && gap <= MAX_COVERED_GAP_MS) coveredMs += gap;
    }
    const bucketDuration = Math.max(1, bucketEnd - cursor);
    const averageBpm = points.length
      ? Math.round((points.reduce((sum, sample) => sum + sample.bpm, 0) / points.length) * 10) / 10
      : null;
    buckets.push({
      startedAt: new Date(cursor).toISOString(),
      endedAt: new Date(bucketEnd).toISOString(),
      sampleCount: points.length,
      averageBpm,
      coveragePercent: Math.floor(Math.min(1, coveredMs / bucketDuration) * 100),
    });
  }
  return buckets;
}

export function buildHeartRateAudit(params: {
  samples: readonly { timestamp: string; bpm: number }[];
  startedAt: string;
  endedAt: string;
  receivedSampleCount?: number;
  workoutDetected?: boolean;
  discardedReasons?: Record<string, number>;
  selectedSourceKey?: string | null;
  sourceCandidateCount?: number;
}): WorkoutHeartRateAudit {
  const start = Date.parse(params.startedAt);
  const end = Date.parse(params.endedAt);
  const durationMs = Number.isFinite(start) && Number.isFinite(end) && end > start ? end - start : 0;
  const accepted = params.samples
    .map((sample) => ({ ...sample, at: Date.parse(sample.timestamp) }))
    .filter((sample) => Number.isFinite(sample.at) && sample.at >= start && sample.at <= end
      && Number.isFinite(sample.bpm) && sample.bpm >= 30 && sample.bpm <= 240)
    .sort((a, b) => a.at - b.at);

  let coveredMs = 0;
  let largestGapMs = accepted.length
    ? Math.max(accepted[0].at - start, end - accepted[accepted.length - 1].at)
    : durationMs;
  for (let index = 1; index < accepted.length; index += 1) {
    const gap = accepted[index].at - accepted[index - 1].at;
    largestGapMs = Math.max(largestGapMs, gap);
    if (gap > 0 && gap <= MAX_COVERED_GAP_MS) coveredMs += gap;
  }

  const coverageRatio = durationMs > 0 ? Math.min(1, coveredMs / durationMs) : 0;
  const receivedSampleCount = Math.max(accepted.length, Math.floor(params.receivedSampleCount ?? accepted.length));
  const quality: WorkoutHeartRateAudit['quality'] = accepted.length < 5 || coveredMs < 60_000
    ? 'insufficient'
    : coverageRatio >= 0.95 && largestGapMs <= 30_000
      ? 'excellent'
      : coverageRatio >= 0.8 && largestGapMs <= MAX_COVERED_GAP_MS
        ? 'good'
        : 'partial';

  const discardedReasons = Object.fromEntries(
    Object.entries(params.discardedReasons || {})
      .filter(([, count]) => Number.isInteger(count) && count > 0)
      .map(([reason, count]) => [reason, count]),
  );

  return {
    receivedSampleCount,
    validSampleCount: accepted.length,
    discardedSampleCount: Math.max(0, receivedSampleCount - accepted.length),
    coverageSeconds: Math.round(coveredMs / 100) / 10,
    coveragePercent: Math.floor(coverageRatio * 100),
    largestGapSeconds: Math.round(largestGapMs / 100) / 10,
    quality,
    fiveMinuteBuckets: buildBuckets(accepted, start, end),
    discardedReasons,
    selectedSourceKey: params.selectedSourceKey ?? null,
    sourceCandidateCount: Math.max(accepted.length ? 1 : 0, Math.floor(params.sourceCandidateCount ?? (accepted.length ? 1 : 0))),
    ...(typeof params.workoutDetected === 'boolean' ? { workoutDetected: params.workoutDetected } : {}),
  };
}
