import type { WorkoutHeartRateAudit } from './workoutHealthTypes';

const MAX_COVERED_GAP_MS = 60_000;

export function buildHeartRateAudit(params: {
  samples: readonly { timestamp: string; bpm: number }[];
  startedAt: string;
  endedAt: string;
  receivedSampleCount?: number;
  workoutDetected?: boolean;
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
    : coverageRatio >= 0.8 && largestGapMs <= MAX_COVERED_GAP_MS
      ? 'good'
      : 'partial';

  return {
    receivedSampleCount,
    validSampleCount: accepted.length,
    discardedSampleCount: Math.max(0, receivedSampleCount - accepted.length),
    coverageSeconds: Math.round(coveredMs / 100) / 10,
    coveragePercent: Math.floor(coverageRatio * 100),
    largestGapSeconds: Math.round(largestGapMs / 100) / 10,
    quality,
    ...(typeof params.workoutDetected === 'boolean' ? { workoutDetected: params.workoutDetected } : {}),
  };
}
