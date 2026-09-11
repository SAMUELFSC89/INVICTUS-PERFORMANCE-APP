import { createHash } from 'node:crypto';
import type { WorkoutHeartRateAudit, WorkoutHeartRateSyncEvent } from '../../src/core/health/workoutHealthTypes.js';

export const HEART_RATE_ARCHIVE_CHUNK_SIZE = 500;
export const HEART_RATE_SYNC_HISTORY_LIMIT = 10;

export function heartRateSeriesHash(samples: readonly { timestamp: string; bpm: number }[]): string {
  const normalized = samples.map(sample => `${sample.timestamp}|${Number(sample.bpm).toFixed(1)}`).join('\n');
  return `sha256:${createHash('sha256').update(normalized).digest('hex')}`;
}

export function appendHeartRateSyncHistory(
  previous: readonly WorkoutHeartRateSyncEvent[] | undefined,
  audit: WorkoutHeartRateAudit,
  fetchedAt: string | null,
): WorkoutHeartRateSyncEvent[] {
  if (!fetchedAt || !Number.isFinite(Date.parse(fetchedAt))) return [...(previous || [])].slice(-HEART_RATE_SYNC_HISTORY_LIMIT);
  const event: WorkoutHeartRateSyncEvent = {
    fetchedAt,
    validSampleCount: audit.validSampleCount,
    coveragePercent: audit.coveragePercent,
    ...(audit.seriesHash ? { seriesHash: audit.seriesHash } : {}),
  };
  const history = [...(previous || [])].filter(item => item.fetchedAt !== fetchedAt);
  history.push(event);
  return history.slice(-HEART_RATE_SYNC_HISTORY_LIMIT);
}

/** Deterministic chunks for a separate Firestore archive. No interpolation or downsampling. */
export function chunkHeartRateSamples(samples: readonly { timestamp: string; bpm: number }[]) {
  const chunks: Array<{ index: number; samples: Array<{ timestamp: string; bpm: number }> }> = [];
  for (let offset = 0; offset < samples.length; offset += HEART_RATE_ARCHIVE_CHUNK_SIZE) {
    chunks.push({ index: chunks.length, samples: samples.slice(offset, offset + HEART_RATE_ARCHIVE_CHUNK_SIZE) });
  }
  return chunks;
}
