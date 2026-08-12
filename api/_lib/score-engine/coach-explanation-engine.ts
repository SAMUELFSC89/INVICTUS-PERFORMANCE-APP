import { CoachExplanation, MainImpacts, QualityBreakdown } from './types.js';

export class CoachExplanationEngine {
  static generate(
    qualityScore: number,
    goal: string,
    breakdown: QualityBreakdown,
    mainImpacts: MainImpacts,
    simulationTargetScore?: number,
    simulatedGains?: number
  ): CoachExplanation {
    const sub = breakdown.subScores;
    const losses = breakdown.losses;

    let headline = '';
    if (qualityScore >= 90) {
      headline = 'Treino de Nível Elite! Execução Impecável.';
    } else if (qualityScore >= 75) {
      headline = 'Excelente Sessão com Ótimo Aproveitamento Metabólico.';
    } else if (qualityScore >= 60) {
      headline = 'Treino Concluído com Bons Prazos de Ajuste.';
    } else {
      headline = 'Sessão Registrada — Foco na Regularidade e Menos Pausas.';
    }

    let detailedSummary = `Hoje seu treino apresentou `;
    if (sub.consistency >= 85) {
      detailedSummary += `excelente consistência semanal (${sub.consistency} pts) `;
    } else {
      detailedSummary += `frequência em adaptação `;
    }

    if (sub.intensity >= 85) {
      detailedSummary += `e elevada intensidade mantida na zona-alvo. `;
    } else if (sub.intensity >= 70) {
      detailedSummary += `e boa resposta de frequência cardíaca. `;
    } else {
      detailedSummary += `com intensidade abaixo do ideal em trecho da sessão. `;
    }

    let mainDragFactorText = 'Nenhum fator significativo reduziu seu aproveitamento hoje.';
    if (losses.length > 0) {
      const mainLoss = losses[0];
      mainDragFactorText = `O principal fator que reduziu sua nota foi ${mainLoss.label.toLowerCase()} (${mainLoss.reason}).`;
      detailedSummary += ` ${mainDragFactorText}`;
    }

    let nextStepsAdvice = 'Mantenha a regularidade nos próximos dias para consolidar os ganhos de adaptação.';
    if (simulatedGains && simulatedGains > 0) {
      const possibleTarget = Math.min(100, qualityScore + simulatedGains);
      nextStepsAdvice = `Mantendo o ritmo e aplicando os pequenos ajustes de tempo ativo e comprovação, você alcançaria cerca de ${possibleTarget} pontos no próximo treino.`;
    } else if (losses.length > 0) {
      nextStepsAdvice = losses[0].fixSuggestion || 'Aplique descansos ativos menores entre séries para elevar a densidade.';
    }

    return {
      headline,
      detailedSummary,
      mainDragFactorText,
      nextStepsAdvice
    };
  }
}
