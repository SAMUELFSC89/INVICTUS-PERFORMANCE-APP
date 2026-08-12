import { PerformanceInsight, AthleteDnaProfile, QualityBreakdown } from './types.js';

export class InsightsEngine {
  static generate(
    dna: AthleteDnaProfile,
    currentBreakdown?: QualityBreakdown,
    currentDurationMins: number = 45
  ): PerformanceInsight[] {
    const insights: PerformanceInsight[] = [];

    // 1. Time Window Insight
    insights.push({
      id: 'ins_time_window',
      type: 'POSITIVE',
      title: 'Janela de Desempenho Ideal',
      description: `Você costuma apresentar melhor desempenho fisiológico no período da ${dna.bestWorkoutTimeLabel.toLowerCase()}.`,
      basedOnData: `Baseado em ${dna.totalWorkoutsAnalyzed} treinos analisados no seu DNA Invictus.`
    });

    // 2. Volume & Duration Threshold Insight
    if (currentDurationMins > 60) {
      insights.push({
        id: 'ins_duration_fatigue',
        type: 'WARNING',
        title: 'Ponto de Inflexão de Rendimento',
        description: 'Treinos acima de 60 minutos tendem a apresentar ligeira queda na frequência cardíaca na zona-alvo.',
        basedOnData: `Duração atual: ${currentDurationMins} minutos.`
      });
    } else {
      insights.push({
        id: 'ins_frequency_boost',
        type: 'POSITIVE',
        title: 'Sinergia de Frequência',
        description: 'Sua intensidade e tempo ativo aumentam significativamente quando você treina 4 ou mais vezes na semana.',
        basedOnData: `Frequência semanal mantida com constância elevada.`
      });
    }

    // 3. Pause & Idle Time Insight
    const sub = currentBreakdown?.subScores;
    if (sub && sub.efficiency < 80) {
      insights.push({
        id: 'ins_idle_reduction',
        type: 'TIP',
        title: 'Oportunidade de Densidade',
        description: 'Reduzir pausas para no máximo 90 segundos entre séries manterá a FC na zona Z3 e acelerará a queima calórica.',
        basedOnData: `Sua eficiência do treino atual registrou ${sub.efficiency} pts.`
      });
    } else {
      insights.push({
        id: 'ins_recovery_trend',
        type: 'POSITIVE',
        title: 'Evolução de Recuperação',
        description: 'Sua estabilidade de pulso e capacidade de regeneração muscular apresentaram ganho contínuo.',
        basedOnData: `Tendência da Zona de FC: ${dna.hrZoneEvolutionTrend}.`
      });
    }

    return insights;
  }
}
