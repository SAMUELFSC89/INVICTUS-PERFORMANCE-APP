import { normalizeHeartRateSamples } from './heartRateSamples';
import type { WearableHeartRateSample, WearableSource } from './types';

export type HeartRateCoverageQuality = 'good' | 'partial' | 'insufficient';

export interface SessionHeartRateAudit {
  source: Extract<WearableSource, 'apple_health' | 'health_connect'>;
  workoutFound: boolean;
  receivedSampleCount: number;
  validSampleCount: number;
  discardedSampleCount: number;
  firstSampleAt?: string;
  lastSampleAt?: string;
  coverageSeconds: number;
  coverageRatio: number;
  largestGapSeconds: number;
  quality: HeartRateCoverageQuality;
  samples: WearableHeartRateSample[];
}

const MAX_CONTIGUOUS_GAP_SECONDS = 60;

/**
 * Audita somente observações reais entregues pela fonte para a janela do treino.
 * Não interpola lacunas e uma leitura isolada nunca significa cobertura.
 */
export function auditSessionHeartRate(
  rawSamples: unknown,
  startDate: Date,
  endDate: Date,
  source: SessionHeartRateAudit['source'],
  workoutFound: boolean,
): SessionHeartRateAudit {
  const received = Array.isArray(rawSamples) ? rawSamples.length : 0;
  const startMs = startDate.getTime();
  const endMs = endDate.getTime();
  const durationSeconds = Math.max(0, (endMs - startMs) / 1000);

  const normalized = normalizeHeartRateSamples(rawSamples);
  const samples = normalized.filter((sample) => {
    const ms = Date.parse(sample.timestamp);
    return Number.isFinite(ms) && ms >= startMs && ms <= endMs;
  });

  let coverageSeconds = 0;
  let largestGapSeconds = 0;
  for (let index = 0; index < samples.length - 1; index += 1) {
    const current = Date.parse(samples[index].timestamp);
    const next = Date.parse(samples[index + 1].timestamp);
    const gapSeconds = Math.max(0, (next - current) / 1000);
    largestGapSeconds = Math.max(largestGapSeconds, gapSeconds);
    if (gapSeconds > 0 && gapSeconds <= MAX_CONTIGUOUS_GAP_SECONDS) coverageSeconds += gapSeconds;
  }

  const coverageRatio = durationSeconds > 0 ? Math.min(1, coverageSeconds / durationSeconds) : 0;
  const quality: HeartRateCoverageQuality = samples.length < 3 || coverageSeconds < 60
    ? 'insufficient'
    : coverageRatio >= 0.8
      ? 'good'
      : 'partial';

  return {
    source,
    workoutFound,
    receivedSampleCount: received,
    validSampleCount: samples.length,
    discardedSampleCount: Math.max(0, received - samples.length),
    firstSampleAt: samples[0]?.timestamp,
    lastSampleAt: samples[samples.length - 1]?.timestamp,
    coverageSeconds: Number(coverageSeconds.toFixed(1)),
    coverageRatio: Number(coverageRatio.toFixed(4)),
    largestGapSeconds: Number(largestGapSeconds.toFixed(1)),
    quality,
    samples,
  };
}

export function collectHeartRateFromWorkouts(workouts: any[]): unknown[] {
  const raw: unknown[] = [];
  for (const workout of workouts || []) {
    if (Array.isArray(workout?.heartRate)) raw.push(...workout.heartRate);
  }
  return raw;
}
