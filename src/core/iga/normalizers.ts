/**
 * IGA (Índice Global de Atividade) - Normalizers
 * 
 * Implementação parametrizada e isolada das funções de normalização (Fn, Tn, In).
 * Permite calibrações futuras dos limites sem impactar a fórmula central do IGA.
 */

import { FrequencyConfig, TimeConfig, IntensityConfig } from './types.js';

export const DEFAULT_FREQUENCY_CONFIG: FrequencyConfig = {
  maxSessions: 5,
  targetFrequency: 5,
};

export const DEFAULT_TIME_CONFIG: TimeConfig = {
  minWorkoutMinutes: 30,
  minCardioMinutes: 20,
  targetTimeMinutes: 250, // 5 sessões x 50 min
};

export const DEFAULT_INTENSITY_CONFIG: IntensityConfig = {
  targetRelativeHR: 0.85,          // 85% da FC Max = Intensidade Máxima Normalizada (1.0)
  minRelativeHR: 0.50,             // 50% da FC Max = Ponto de partida
  defaultWorkoutRelativeHR: 0.70,  // Estimativa segura para Musculação sem monitor cardíaco
  defaultCardioRelativeHR: 0.75,   // Estimativa segura para Cardio sem monitor cardíaco
  defaultOtherRelativeHR: 0.65,
};

/**
 * Normaliza a frequência semanal (Fn)
 * @param frequency Número de sessões válidas na semana (máximo 5)
 * @param config Configurações parametrizáveis de frequência
 * @returns Fn valor entre 0.0 e 1.0
 */
export function normalizeFrequency(
  frequency: number,
  config?: Partial<FrequencyConfig>
): number {
  const cfg = { ...DEFAULT_FREQUENCY_CONFIG, ...config };
  const safeFreq = Math.max(0, Number(frequency) || 0);
  const cappedFreq = Math.min(safeFreq, cfg.maxSessions);
  if (cfg.targetFrequency <= 0) return 0;
  
  const Fn = cappedFreq / cfg.targetFrequency;
  return Math.min(1.0, Math.max(0, Fn));
}

/**
 * Normaliza o tempo total elegível de exercício na semana (Tn)
 * @param totalMinutes Tempo total em minutos das melhores até 5 sessões válidas
 * @param config Configurações parametrizáveis de tempo
 * @returns Tn valor entre 0.0 e 1.0
 */
export function normalizeTime(
  totalMinutes: number,
  config?: Partial<TimeConfig>
): number {
  const cfg = { ...DEFAULT_TIME_CONFIG, ...config };
  const safeMinutes = Math.max(0, Number(totalMinutes) || 0);
  if (cfg.targetTimeMinutes <= 0) return 0;

  const Tn = safeMinutes / cfg.targetTimeMinutes;
  return Math.min(1.0, Math.max(0, Tn));
}

/**
 * Normaliza a intensidade cardiovascular relativa (In)
 * @param avgRelativeHR Frequência cardíaca relativa (FC Média / FC Máxima)
 * @param config Configurações parametrizáveis de intensidade
 * @returns In valor entre 0.0 e 1.0
 */
export function normalizeIntensity(
  avgRelativeHR: number,
  config?: Partial<IntensityConfig>
): number {
  const cfg = { ...DEFAULT_INTENSITY_CONFIG, ...config };
  const safeRelHR = Math.max(0, Number(avgRelativeHR) || 0);

  if (safeRelHR <= cfg.minRelativeHR) return 0;
  if (safeRelHR >= cfg.targetRelativeHR) return 1.0;

  const range = cfg.targetRelativeHR - cfg.minRelativeHR;
  if (range <= 0) return 1.0;

  const In = (safeRelHR - cfg.minRelativeHR) / range;
  return Math.min(1.0, Math.max(0, In));
}
