/**
 * IGA (Índice Global de Atividade) - Audit & Explanation Formatter
 */

import { IGACalculationResult } from './types.js';

export function formatIGAAuditText(result: IGACalculationResult): string {
  if (!result) return 'Nenhum dado de auditoria disponível.';

  const lines: string[] = [
    '============== AUDITORIA DE PONTUAÇÃO IGA 2.0 ==============',
    `• Data do Cálculo: ${new Date(result.calculatedAt).toLocaleString('pt-BR')}`,
    `• Frequência (F): ${result.frequency} sessões consideradas (F = ${(result.Fn * 100).toFixed(0)})`,
    `• Tempo (T): ${(result.Tn * 100).toFixed(1)} — média da curva de duração por sessão`,
    `• Intensidade (I): ${(result.In * 100).toFixed(1)} — qualidade cardiovascular por zonas`,
    `• FC Média (auditoria): ${result.avgHeartRate} bpm / FCmáx: ${result.maxHeartRate} bpm`,
    '------------------------------------------------------------',
    '• Fórmula: IGA = ∛(F × T × I)',
    `• Cálculo equivalente: 100 × ∛(${result.Fn} × ${result.Tn} × ${result.In}) = ${result.igaBase} PTS`,
    '------------------------------------------------------------',
    '• Tempo: 60 min = referência 100; depois disso o ganho é residual (90 min = 104).',
    '• Intensidade: FC suavizada, zonas com transição contínua de ±5 bpm; Z4 é o maior bônus e Z5 não supera Z4.',
    '• Calorias: não somam, não reduzem e não alteram elegibilidade ou ranking.',
    '• IGA: não existe teto artificial de 100 pontos.',
    '------------------------------------------------------------',
    `• IGA Final (Semanal): ${result.igaFinal} PTS`,
    `• Handicap Idade: ${result.ageHandicapMultiplier === 1.0 ? 'Desabilitado (x1.00)' : `x${result.ageHandicapMultiplier}`}`,
    `• PONTUAÇÃO FINAL DE RANKING: ${result.igaRanking} PTS`,
    '============================================================'
  ];

  return lines.join('\n');
}
