import { IGAHeartRateSample, IntensityConfig } from './types.js';
import { DEFAULT_INTENSITY_CONFIG } from './normalizers.js';

export type IntensitySource = 'samples' | 'average' | 'estimated';

export interface IntensityEvaluation {
  factor: number;
  source: IntensitySource;
  sampleCount: number;
  averageHeartRate: number;
}

function lerp(a: number, b: number, ratio: number): number {
  const t = Math.min(1, Math.max(0, ratio));
  return a + (b - a) * t;
}

/**
 * Converte BPM em fator IGA com transição contínua de ±N bpm em TODAS as
 * fronteiras de zona. Fora dessas faixas, a zona recebe seu score cheio.
 */
export function heartRateToIntensityFactor(
  bpm: number,
  maxHeartRate: number,
  config?: Partial<IntensityConfig>,
): number {
  const cfg = { ...DEFAULT_INTENSITY_CONFIG, ...config };
  const hr = Number(bpm);
  const maxHR = Number(maxHeartRate);
  if (!Number.isFinite(hr) || !Number.isFinite(maxHR) || hr <= 0 || maxHR <= 0) return 0;

  const minScoringHR = cfg.minRelativeHR * maxHR;
  if (hr < minScoringHR) return 0;

  const boundaries = cfg.zoneBoundaries.map(v => v * maxHR);
  const scores = cfg.zoneScores.map(v => v / 100);
  const margin = Math.max(0, Number(cfg.transitionBpm) || 0);

  for (let i = 0; i < boundaries.length; i += 1) {
    const boundary = boundaries[i];
    const left = boundary - margin;
    const right = boundary + margin;
    if (hr < left) return scores[i];
    if (hr <= right) {
      if (margin <= 0) return hr < boundary ? scores[i] : scores[i + 1];
      return lerp(scores[i], scores[i + 1], (hr - left) / (right - left));
    }
  }

  return scores[scores.length - 1];
}

function parseSample(sample: IGAHeartRateSample): { ms: number; bpm: number } | null {
  const ms = Date.parse(String(sample?.timestamp || ''));
  const bpm = Number(sample?.bpm);
  if (!Number.isFinite(ms) || !Number.isFinite(bpm) || bpm < 30 || bpm > 260) return null;
  return { ms, bpm };
}

/** Média móvel temporal de cauda; reduz picos de 1 leitura antes de classificar zona. */
export function smoothHeartRateSamples(
  samples: IGAHeartRateSample[],
  windowSeconds = DEFAULT_INTENSITY_CONFIG.smoothingWindowSeconds,
): Array<{ ms: number; bpm: number }> {
  const clean = (samples || [])
    .map(parseSample)
    .filter((v): v is { ms: number; bpm: number } => Boolean(v))
    .sort((a, b) => a.ms - b.ms);
  if (!clean.length) return [];

  const windowMs = Math.max(1, Number(windowSeconds) || 30) * 1000;
  const queue: Array<{ ms: number; bpm: number }> = [];
  let sum = 0;
  return clean.map(point => {
    queue.push(point);
    sum += point.bpm;
    while (queue.length > 1 && point.ms - queue[0].ms > windowMs) {
      sum -= queue.shift()!.bpm;
    }
    return { ms: point.ms, bpm: sum / queue.length };
  });
}

/**
 * Calcula I pela série suavizada. A média é ponderada pelo tempo entre amostras
 * e gaps enormes são limitados a 60 s para um buraco de sensor não dominar a sessão.
 * Z4 satura naturalmente em 1.15 porque I é qualidade média, não soma de minutos.
 * Z5 fica abaixo de Z4 e portanto não existe incentivo para "farmar" FC máxima.
 */
export function evaluateIntensityFromSamples(
  samples: IGAHeartRateSample[],
  maxHeartRate: number,
  config?: Partial<IntensityConfig>,
): IntensityEvaluation | null {
  const cfg = { ...DEFAULT_INTENSITY_CONFIG, ...config };
  const smooth = smoothHeartRateSamples(samples, cfg.smoothingWindowSeconds);
  if (!smooth.length) return null;

  let weightedFactor = 0;
  let weightedHR = 0;
  let weightSum = 0;

  for (let i = 0; i < smooth.length; i += 1) {
    const current = smooth[i];
    const next = smooth[i + 1];
    const deltaSeconds = next
      ? Math.max(1, Math.min(60, (next.ms - current.ms) / 1000))
      : 1;
    weightedFactor += heartRateToIntensityFactor(current.bpm, maxHeartRate, cfg) * deltaSeconds;
    weightedHR += current.bpm * deltaSeconds;
    weightSum += deltaSeconds;
  }

  if (weightSum <= 0) return null;
  return {
    factor: weightedFactor / weightSum,
    source: 'samples',
    sampleCount: smooth.length,
    averageHeartRate: weightedHR / weightSum,
  };
}

export function evaluateSessionIntensity(params: {
  heartRateSamples?: IGAHeartRateSample[];
  avgHeartRate?: number;
  fallbackHeartRate: number;
  maxHeartRate: number;
  config?: Partial<IntensityConfig>;
}): IntensityEvaluation {
  const fromSamples = evaluateIntensityFromSamples(
    params.heartRateSamples || [],
    params.maxHeartRate,
    params.config,
  );
  if (fromSamples) return fromSamples;

  const avg = Number(params.avgHeartRate);
  const hasMeasuredAverage = Number.isFinite(avg) && avg > 0;
  const bpm = hasMeasuredAverage ? avg : params.fallbackHeartRate;
  return {
    factor: heartRateToIntensityFactor(bpm, params.maxHeartRate, params.config),
    source: hasMeasuredAverage ? 'average' : 'estimated',
    sampleCount: 0,
    averageHeartRate: bpm,
  };
}
