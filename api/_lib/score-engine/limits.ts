import { SCORE_CONFIG } from '../score-config.js';

export class LimitCalculator {
  static apply(score: number, plan: 'open' | 'performance'): { finalScore: number; capped: boolean; maxPoints: number } {
    const maxPoints = plan === 'performance' ? SCORE_CONFIG.PERFORMANCE_MAX_POINTS : SCORE_CONFIG.OPEN_MAX_POINTS;
    if (score > maxPoints) {
      return { finalScore: maxPoints, capped: true, maxPoints };
    }
    return { finalScore: score, capped: false, maxPoints };
  }
}
