import { SCORE_CONFIG } from '../score-config.js';

export class MultiplierCalculator {
  static calculate(streak: number, wonLastSeason: boolean, boost: number): { totalMultiplier: number; breakdown: any } {
    let streakMultiplier = 1.0;
    if (streak >= 8) streakMultiplier = SCORE_CONFIG.STREAK_X15;
    else if (streak >= 4) streakMultiplier = SCORE_CONFIG.STREAK_X12;

    const antiRepetitionMultiplier = wonLastSeason ? 0.90 : 1.00;
    const boostMultiplier = boost > 0 ? (1 + (boost / 100)) : 1.0;

    const totalMultiplier = streakMultiplier * antiRepetitionMultiplier * boostMultiplier;

    return {
      totalMultiplier,
      breakdown: {
        streakMultiplier,
        antiRepetitionMultiplier,
        boostMultiplier,
        totalMultiplier
      }
    };
  }
}
