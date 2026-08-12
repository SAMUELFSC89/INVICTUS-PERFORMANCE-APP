import { scoreLogger } from '../../logger.js';
import { SCORE_CONFIG } from '../../score-config.js';

export class MultiplierCalculator {
  /**
   * Calcular multiplicador de streak (regras reais Invictus):
   * 1-6 dias: 1.0
   * 7-13 dias: 1.2 (SCORE_CONFIG.STREAK_X12)
   * 14+ dias: 1.5 (SCORE_CONFIG.STREAK_X15)
   */
  static calculateStreakMultiplier(currentStreak: number): number {
    if (currentStreak >= 14) return SCORE_CONFIG.STREAK_X15; // 1.5
    if (currentStreak >= 7) return SCORE_CONFIG.STREAK_X12;  // 1.2
    return 1.0;
  }

  /**
   * Calcular multiplicador de consistência (atividades regulares)
   */
  static calculateConsistencyMultiplier(activitiesLastWeek: number): number {
    if (activitiesLastWeek < 3) return 1.0;
    if (activitiesLastWeek <= 5) return 1.05;
    if (activitiesLastWeek <= 7) return 1.1;
    return 1.15; // 8+ atividades/semana
  }

  /**
   * Calcular multiplicador de fraude
   */
  static calculateFraudMultiplier(fraudScore: number): number {
    if (fraudScore < 20) return 1.0; // Normal
    if (fraudScore < 40) return 0.75; // -25% pontos
    if (fraudScore < 70) return 0.5; // -50% pontos
    return 0; // Bloqueado
  }

  /**
   * Aplicar multiplicadores e limitar pelo teto do plano (OPEN = 100, PERFORMANCE = 100)
   */
  static applyMultipliers(
    baseScore: number,
    multipliers: {
      streak?: number;
      consistency?: number;
      fraud?: number;
      difficulty?: number;
    },
    maxPoints: number = SCORE_CONFIG.OPEN_MAX_POINTS
  ): { totalScore: number; appliedMultipliers: Record<string, number> } {
    let totalScore = baseScore;
    const applied: Record<string, number> = {};

    if (multipliers.fraud !== undefined) {
      totalScore *= multipliers.fraud;
      applied.fraud = multipliers.fraud;
    }

    if (multipliers.streak !== undefined) {
      totalScore *= multipliers.streak;
      applied.streak = multipliers.streak;
    }

    if (multipliers.consistency !== undefined) {
      totalScore *= multipliers.consistency;
      applied.consistency = multipliers.consistency;
    }

    if (multipliers.difficulty !== undefined) {
      totalScore *= multipliers.difficulty;
      applied.difficulty = multipliers.difficulty;
    }

    const cappedScore = Math.min(maxPoints, Math.round(totalScore));

    scoreLogger.debug({ baseScore, totalScore, cappedScore, maxPoints, applied }, 'Multipliers applied');

    return {
      totalScore: cappedScore,
      appliedMultipliers: applied
    };
  }
}

