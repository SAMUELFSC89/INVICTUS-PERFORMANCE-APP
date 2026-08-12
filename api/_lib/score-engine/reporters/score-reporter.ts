import { ScoreCalculationResult } from '../types.js';
import { scoreLogger } from '../../logger.js';

export class ScoreReporter {
  /**
   * Gerar relatório de score
   */
  static generateReport(
    activityId: string,
    baseScore: number,
    bonusScore: number,
    totalScore: number,
    multipliers: Record<string, number>,
    processingTimeMs: number
  ): ScoreCalculationResult['report'] {
    const report = {
      activityId,
      baseScore,
      bonusScore,
      totalEarned: totalScore,
      finalScore: totalScore,
      multipliers,
      processingTimeMs,
      timestamp: new Date()
    };

    scoreLogger.info({ report }, 'Score report generated');

    return report;
  }

  /**
   * Formatar para resposta API
   */
  static formatApiResponse(earned: number, report: ScoreCalculationResult['report']): ScoreCalculationResult {
    return {
      earned,
      report
    };
  }
}
