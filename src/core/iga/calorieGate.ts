/**
 * IGA (Índice Global de Atividade) - Calorie Gate Validation
 * 
 * As calorias NÃO somam pontos e NÃO aumentam a pontuação IGA.
 * Servem exclusivamente para verificação de coerência e antifraude.
 */

import { CalorieGateConfig } from './types.js';

export const DEFAULT_CALORIE_GATE_CONFIG: CalorieGateConfig = {
  minRatio: 0.70,
  maxRatio: 1.40,
  workoutMET: 5.0,     // Musculação
  cardioMET: 8.0,      // Cardio / Corrida
  defaultMET: 6.0,     // Geral
  suspiciousPenaltyGate: 0.80, // Redução de gate para atividades fora do intervalo de coerência
};

/**
 * Calcula as calorias esperadas fisiologicamente baseadas em MET, Peso e Tempo.
 * Formula: Calorias Esperadas = MET * 3.5 * Peso (kg) * Tempo (min) / 200
 */
export function calculateExpectedCalories(
  durationMinutes: number,
  type: string,
  weightKg: number = 70,
  config?: Partial<CalorieGateConfig>
): number {
  const cfg = { ...DEFAULT_CALORIE_GATE_CONFIG, ...config };
  const safeDuration = Math.max(0, Number(durationMinutes) || 0);
  const safeWeight = Math.max(30, Number(weightKg) || 70);

  let met = cfg.defaultMET;
  const lowerType = (type || '').toLowerCase();
  
  if (lowerType.includes('workout') || lowerType.includes('muscul') || lowerType.includes('forca')) {
    met = cfg.workoutMET;
  } else if (lowerType.includes('cardio') || lowerType.includes('corrid') || lowerType.includes('run') || lowerType.includes('bike')) {
    met = cfg.cardioMET;
  }

  const expected = (met * 3.5 * safeWeight * safeDuration) / 200;
  return Math.round(expected);
}

/**
 * Avalia o Gate de Calorias para verificar coerência fisiológica.
 * Se 0.70 <= r <= 1.40, Gate = 1.00 (Válida)
 * Caso contrário, Gate = 0.80 (Suspeita - Atividade sinalizada para auditoria)
 */
export function evaluateCalorieGate(
  informedCalories: number,
  expectedCalories: number,
  config?: Partial<CalorieGateConfig>
): {
  ratio: number;
  gate: number;
  status: 'valid' | 'suspicious';
  isCoherent: boolean;
} {
  const cfg = { ...DEFAULT_CALORIE_GATE_CONFIG, ...config };
  const safeInformed = Math.max(0, Number(informedCalories) || 0);
  const safeExpected = Math.max(1, Number(expectedCalories) || 1);

  // Se o usuário não informou calorias (ex: treino manual sem smartwatch/monitor),
  // assume-se a estimativa esperada sem penalizar a atividade.
  if (safeInformed <= 0) {
    return {
      ratio: 1.00,
      gate: 1.00,
      status: 'valid',
      isCoherent: true
    };
  }

  const ratio = safeInformed / safeExpected;
  const roundedRatio = Math.round(ratio * 100) / 100;

  if (ratio >= cfg.minRatio && ratio <= cfg.maxRatio) {
    return {
      ratio: roundedRatio,
      gate: 1.00,
      status: 'valid',
      isCoherent: true
    };
  }

  // Fora do intervalo de coerência (0.70 a 1.40)
  return {
    ratio: roundedRatio,
    gate: cfg.suspiciousPenaltyGate,
    status: 'suspicious',
    isCoherent: false
  };
}
