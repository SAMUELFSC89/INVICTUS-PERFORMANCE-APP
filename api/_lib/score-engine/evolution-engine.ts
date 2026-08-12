import { EvolutionIndexResult, HistoricalComparison, MetricEvolution } from './types.js';

export class EvolutionEngine {
  static evaluate(
    currentQualityScore: number,
    history: Array<{ qualityScore?: number; finalScore?: number; timestamp?: string; createdAt?: string }>,
    currentSubScores?: { consistency: number; intensity: number; efficiency: number }
  ): EvolutionIndexResult {
    const scores = history
      .map(h => h.qualityScore ?? h.finalScore ?? 0)
      .filter(s => typeof s === 'number' && !isNaN(s) && s > 0);

    const count = scores.length;

    let last7Avg = currentQualityScore;
    let last30Avg = currentQualityScore;
    let last90Avg = currentQualityScore;
    let lastYearAvg = currentQualityScore;

    if (count > 0) {
      const recent7 = scores.slice(0, 7);
      last7Avg = Math.round(recent7.reduce((a, b) => a + b, 0) / recent7.length);

      const recent30 = scores.slice(0, 30);
      last30Avg = Math.round(recent30.reduce((a, b) => a + b, 0) / recent30.length);

      const recent90 = scores.slice(0, 90);
      last90Avg = Math.round(recent90.reduce((a, b) => a + b, 0) / recent90.length);

      lastYearAvg = Math.round(scores.reduce((a, b) => a + b, 0) / count);
    }

    const maxPreviousScore = count > 0 ? Math.max(...scores) : 0;
    const isPersonalRecord = currentQualityScore > maxPreviousScore && count >= 3;

    // Calculate diff % against 30-day average
    let diff30DaysPct = 0;
    if (last30Avg > 0) {
      diff30DaysPct = Math.round(((currentQualityScore - last30Avg) / last30Avg) * 100);
    }

    let indicatorText = '';
    if (isPersonalRecord) {
      indicatorText = '🏆 Este foi seu melhor treino registrado desde que entrou no Invictus!';
    } else if (diff30DaysPct > 0) {
      indicatorText = `⚡ Seu treino evoluiu +${diff30DaysPct}% em relação à sua média dos últimos 30 dias.`;
    } else if (diff30DaysPct < 0) {
      indicatorText = `📉 Sua performance ficou ${diff30DaysPct}% em relação à sua média dos últimos 30 dias.`;
    } else {
      indicatorText = '🎯 Desempenho perfeitamente estável em relação à sua média histórica.';
    }

    const comparison: HistoricalComparison = {
      last7DaysAvg: last7Avg,
      last30DaysAvg: last30Avg,
      last90DaysAvg: last90Avg,
      lastYearAvg,
      diff30DaysPct,
      isPersonalRecord,
      indicatorText
    };

    const metricEvolution: MetricEvolution = {
      consistencyChangePct: diff30DaysPct > 0 ? Math.min(25, diff30DaysPct + 4) : diff30DaysPct,
      intensityChangePct: Math.round(diff30DaysPct * 0.8),
      efficiencyChangePct: Math.round(diff30DaysPct * 1.1),
      recoveryChangePct: Math.round(diff30DaysPct * 0.5)
    };

    return {
      indexPct: diff30DaysPct,
      comparison,
      metricEvolution
    };
  }
}
