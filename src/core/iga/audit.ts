/**
 * IGA (Índice Global de Atividade) - Audit & Explanation Formatter
 */

import { IGACalculationResult } from './types.js';

export function formatIGAAuditText(result: IGACalculationResult): string {
  if (!result) return 'Nenhum dado de auditoria disponível.';

  const lines: string[] = [
    '============== AUDITORIA DE PONTUAÇÃO IGA ==============',
    `• Data do Cálculo: ${new Date(result.calculatedAt).toLocaleString('pt-BR')}`,
    `• Frequência (F): ${result.frequency}/5 sessões válidas (Fn = ${(result.Fn * 100).toFixed(0)}%)`,
    `• Tempo Total (T): ${result.totalTimeMinutes} minutos elegíveis (Tn = ${(result.Tn * 100).toFixed(0)}%)`,
    `• FC Média (I): ${result.avgHeartRate} bpm / FC Max: ${result.maxHeartRate} bpm (${(result.avgRelativeHR * 100).toFixed(1)}% FC Max -> In = ${(result.In * 100).toFixed(0)}%)`,
    '--------------------------------------------------------',
    `• Fórmula Mestra: IGA Base = 100 × (Fn × Tn × In)^(1/3)`,
    `• Cálculo Base: 100 × (${result.Fn} × ${result.Tn} × ${result.In})^(1/3) = ${result.igaBase} PTS`,
    '--------------------------------------------------------',
    `• Gate de Coerência Calorias: ${result.overallGate === 1.0 ? '1.00 (Aprovado)' : result.overallGate.toFixed(2) + ' (Aviso de Incoerência)'}`,
    `  - Calorias Esperadas (MET): ${result.expectedCaloriesTotal} kcal`,
    `  - Calorias Informadas: ${result.informedCaloriesTotal} kcal`,
    `  - Razão (r): ${result.overallCalorieRatio.toFixed(2)} (Aprovado se 0.70 ≤ r ≤ 1.40)`,
    '--------------------------------------------------------',
    `• IGA Final (Semanal): ${result.igaFinal} PTS`,
    `• Handicap Idade: ${result.ageHandicapMultiplier === 1.0 ? 'Desabilitado (x1.00)' : `x${result.ageHandicapMultiplier}`}`,
    `• PONTUAÇÃO FINAL DE RANKING: ${result.igaRanking} PTS`,
    '========================================================'
  ];

  return lines.join('\n');
}
