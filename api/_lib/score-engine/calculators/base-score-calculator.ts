import { scoreLogger } from '../../logger.js';
import { QualityEngine } from '../quality-engine.js';

export class BaseScoreCalculator {
  /**
   * Calcular o Quality Score real (0-100) baseado nos 5 critérios do Invictus
   * (Consistency, Intensity, Efficiency, TechnicalQuality, DataIntegrity)
   * ponderados pelo objetivo de treino do usuário.
   */
  static calculateQualityScore(activityData: any, userData: any) {
    const qualityResult = QualityEngine.calculate(activityData, userData);
    scoreLogger.debug({ qualityScore: qualityResult.score, goal: qualityResult.goal }, 'Quality score calculated via 5 criteria');
    return qualityResult;
  }

  /**
   * Calcular score base por atividade (com suporte a Quality Score e fallback)
   */
  static calculateBaseScore(activityType: string, duration: number = 0, distance: number = 0, userData?: any, activityData?: any): number {
    if (userData && activityData) {
      const qualityResult = this.calculateQualityScore(activityData, userData);
      return qualityResult.score;
    }

    let baseScore = 0;

    switch (activityType) {
      case 'run':
        // 1km = 10 points, max 100 points
        baseScore = Math.min((distance || 0) * 10, 100);
        break;

      case 'gym':
      case 'checkin':
        // 1 minuto = 1 ponto, max 120 points (2 horas)
        baseScore = Math.min(duration / 60, 120);
        if (baseScore === 0 && activityType === 'checkin') baseScore = 50;
        break;

      case 'custom':
        baseScore = Math.min((duration / 60) * 0.5, 50);
        break;

      case 'diet':
        baseScore = 20;
        break;

      default:
        baseScore = Math.min((distance || 0) * 10 || (duration / 60) || 10, 100);
    }

    scoreLogger.debug({ activityType, duration, distance, baseScore }, 'Base score fallback calculated');

    return Math.round(baseScore);
  }

  /**
   * Calcular bonus por dificuldade
   */
  static calculateDifficultyBonus(intensity: 'light' | 'moderate' | 'high' | string): number {
    const bonusMap: Record<string, number> = {
      light: 0,
      moderate: 10,
      high: 25
    };

    return bonusMap[intensity] || 0;
  }
}

