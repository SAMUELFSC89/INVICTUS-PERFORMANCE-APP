import { appendHeartRateSyncHistory, chunkHeartRateSamples, heartRateSeriesHash } from '../_lib/heart-rate-audit-server';
import type { WorkoutHeartRateAudit } from '../../src/core/health/workoutHealthTypes';

const sample = (index: number) => ({ timestamp: new Date(Date.UTC(2026, 8, 5, 10, 0, index)).toISOString(), bpm: 100 + index % 20 });
const audit = (overrides: Partial<WorkoutHeartRateAudit> = {}): WorkoutHeartRateAudit => ({
  receivedSampleCount: 2, validSampleCount: 2, discardedSampleCount: 0,
  coverageSeconds: 1, coveragePercent: 50, largestGapSeconds: 1, quality: 'partial',
  fiveMinuteBuckets: [], discardedReasons: {}, selectedSourceKey: 'apple:watch', sourceCandidateCount: 1,
  ...overrides,
});

test('series hash is deterministic and changes when a sample changes', () => {
  const samples = [sample(0), sample(1)];
  const first = heartRateSeriesHash(samples);
  expect(first).toMatch(/^sha256:[a-f0-9]{64}$/);
  expect(heartRateSeriesHash(samples)).toBe(first);
  expect(heartRateSeriesHash([samples[0], { ...samples[1], bpm: 180 }])).not.toBe(first);
});

test('sync history is bounded and de-duplicates the same fetchedAt', () => {
  let history: ReturnType<typeof appendHeartRateSyncHistory> = [];
  for (let index = 0; index < 12; index += 1) {
    history = appendHeartRateSyncHistory(history, audit({ validSampleCount: index, seriesHash: heartRateSeriesHash([sample(index)]) }), new Date(Date.UTC(2026, 8, 5, 10, index)).toISOString());
  }
  expect(history).toHaveLength(10);
  const last = history.at(-1)!;
  const repeated = appendHeartRateSyncHistory(history, audit({ validSampleCount: 99 }), last.fetchedAt);
  expect(repeated).toHaveLength(10);
  expect(repeated.at(-1)?.validSampleCount).toBe(99);
});

test('dense series is split into deterministic 500-point chunks without downsampling', () => {
  const samples = Array.from({ length: 1201 }, (_, index) => sample(index % 60));
  const chunks = chunkHeartRateSamples(samples);
  expect(chunks.map(chunk => chunk.samples.length)).toEqual([500, 500, 201]);
  expect(chunks.flatMap(chunk => chunk.samples)).toEqual(samples);
});
