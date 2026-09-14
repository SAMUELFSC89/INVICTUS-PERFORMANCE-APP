/**
 * IGA (Índice Global de Atividade) - Normalizers
 *
 * IGA 2.0 usa fatores relativos em torno de 1.00, mas NÃO os limita a 1.00.
 * Isso permite diferenciar desempenho acima da referência sem criar teto
 * artificial de 100 pontos no IGA final.
 */

import { FrequencyConfig, TimeConfig, IntensityConfig } from './types.js';

export const DEFAULT_FREQUENCY_CONFIG: FrequencyConfig = {
  maxSessions: 5,
  targetFrequency: 5,
  // 0, 1, 2, 3, 4, 5 sessões válidas. Sessões adicionais não aumentam F.
  scoreBySessions: [0, 15, 30, 55, 80, 100],
};

export const DEFAULT_TIME_CONFIG: TimeConfig = {
  minWorkoutMinutes: 30,
  minCardioMinutes: 20,
  targetTimeMinutes: 300,
  maxCountedMinutesPerSession: 90,
  // Retorno decrescente: depois de 60 min o ganho é residual.
  scoreCurve: [
    { minutes: 0, score: 0 },
    { minutes: 20, score: 70 },
    { minutes: 30, score: 85 },
    { minutes: 45, score: 95 },
    { minutes: 60, score: 100 },
    { minutes: 75, score: 102 },
    { minutes: 90, score: 104 },
  ],
};

export const DEFAULT_INTENSITY_CONFIG: IntensityConfig = {
  targetRelativeHR: 0.85,
  minRelativeHR: 0.50,
  // Fronteiras: Z1/Z2 em 60%, Z2/Z3 em 70%, Z3/Z4 em 80%, Z4/Z5 em 90%.
  zoneBoundaries: [0.60, 0.70, 0.80, 0.90],
  // Z4 é o maior bônus. Z5 continua alta, mas não recompensa FC extrema acima de Z4.
  zoneScores: [40, 75, 100, 115, 110],
  transitionBpm: 5,
  smoothingWindowSeconds: 30,
};

/**
 * Frequência semanal do IGA 2.0.
 * 1=15, 2=30, 3=55, 4=80, 5+=100.
 * @returns fator relativo (ex.: 100 -> 1.00)
 */
export function normalizeFrequency(
  frequency: number,
  config?: Partial<FrequencyConfig>
): number {
  const cfg = { ...DEFAULT_FREQUENCY_CONFIG, ...config };
  const safeFreq = Math.max(0, Math.floor(Number(frequency) || 0));
  const capped = Math.min(safeFreq, cfg.maxSessions);
  const table = cfg.scoreBySessions?.length ? cfg.scoreBySessions : DEFAULT_FREQUENCY_CONFIG.scoreBySessions;
  const tableIndex = Math.min(capped, table.length - 1);
  return Math.max(0, Number(table[tableIndex]) || 0) / 100;
}

/** Interpolação linear entre os pontos da curva de tempo. */
function interpolateTimeScore(minutes: number, curve: Array<{ minutes: number; score: number }>): number {
  const sorted = [...curve]
    .filter(p => Number.isFinite(p.minutes) && Number.isFinite(p.score))
    .sort((a, b) => a.minutes - b.minutes);
  if (!sorted.length) return 0;
  if (minutes <= sorted[0].minutes) return sorted[0].score;
  if (minutes >= sorted[sorted.length - 1].minutes) return sorted[sorted.length - 1].score;

  for (let i = 1; i < sorted.length; i += 1) {
    const right = sorted[i];
    const left = sorted[i - 1];
    if (minutes <= right.minutes) {
      const span = right.minutes - left.minutes;
      if (span <= 0) return right.score;
      const ratio = (minutes - left.minutes) / span;
      return left.score + (right.score - left.score) * ratio;
    }
  }
  return sorted[sorted.length - 1].score;
}

/**
 * Fator de tempo de UMA sessão válida.
 * A curva reconhece duração suficiente sem transformar disponibilidade de tempo
 * em vantagem dominante. 60 min = 1.00; 90 min = 1.04.
 */
export function normalizeTime(
  sessionMinutes: number,
  config?: Partial<TimeConfig>
): number {
  const cfg = { ...DEFAULT_TIME_CONFIG, ...config };
  const capped = Math.min(
    Math.max(0, Number(sessionMinutes) || 0),
    Math.max(0, cfg.maxCountedMinutesPerSession || 90),
  );
  const curve = cfg.scoreCurve?.length ? cfg.scoreCurve : DEFAULT_TIME_CONFIG.scoreCurve;
  return Math.max(0, interpolateTimeScore(capped, curve)) / 100;
}

/**
 * Compatibilidade com chamadas antigas que calculam intensidade a partir de
 * uma FC relativa já medida. Esta função não inventa FC quando o dado está ausente.
 */
export function normalizeIntensity(
  avgRelativeHR: number,
  config?: Partial<IntensityConfig>
): number {
  const cfg = { ...DEFAULT_INTENSITY_CONFIG, ...config };
  const safeRelHR = Math.max(0, Number(avgRelativeHR) || 0);
  if (safeRelHR < cfg.minRelativeHR) return 0;

  const [b1, b2, b3, b4] = cfg.zoneBoundaries;
  const [z1, z2, z3, z4, z5] = cfg.zoneScores;
  const points: Array<[number, number]> = [
    [cfg.minRelativeHR, z1],
    [b1, (z1 + z2) / 2],
    [b2, (z2 + z3) / 2],
    [b3, (z3 + z4) / 2],
    [b4, (z4 + z5) / 2],
    [1.0, z5],
  ];

  if (safeRelHR >= 1) return z5 / 100;
  for (let i = 1; i < points.length; i += 1) {
    const [rx, ry] = points[i];
    const [lx, ly] = points[i - 1];
    if (safeRelHR <= rx) {
      const ratio = rx === lx ? 1 : (safeRelHR - lx) / (rx - lx);
      return Math.max(0, ly + (ry - ly) * ratio) / 100;
    }
  }
  return z5 / 100;
}
