/**
 * IGA (Índice Global de Atividade) - Age Handicap Module
 * 
 * Estrutura para compensação de idade no ranking competitivo.
 * IMPORTANTE: Permanece DESABILITADO por padrão através de configuração (enabled = false).
 */

import { AgeHandicapConfig } from './types.js';

export const DEFAULT_AGE_HANDICAP_CONFIG: AgeHandicapConfig = {
  enabled: false,       // OBRIGATÓRIO: Desabilitado por configuração inicial
  baselineAge: 30,     // Idade base sem ajuste
  factorPerYear: 0.005, // +0.5% por ano acima dos 30 anos
};

/**
 * Calcula o fator de Handicap por Idade
 * @param age Idade do atleta
 * @param config Configurações de handicap
 * @returns Multiplicador de idade (1.00 quando desabilitado)
 */
export function calculateAgeHandicap(
  age?: number,
  config?: Partial<AgeHandicapConfig>
): number {
  const cfg = { ...DEFAULT_AGE_HANDICAP_CONFIG, ...config };

  // Se desabilitado na configuração, retorna rigorosamente 1.00
  if (!cfg.enabled) {
    return 1.00;
  }

  const safeAge = Math.max(12, Number(age) || cfg.baselineAge);

  if (safeAge <= cfg.baselineAge) {
    return 1.00;
  }

  const yearsAbove = safeAge - cfg.baselineAge;
  const handicap = 1.00 + (yearsAbove * cfg.factorPerYear);
  return Math.round(handicap * 1000) / 1000;
}
