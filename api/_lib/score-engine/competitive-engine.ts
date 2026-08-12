import { CompetitiveScoreResult } from './types.js';
import { MultiplierCalculator } from './multipliers.js';
import { PenaltyCalculator } from './penalties.js';
import { LimitCalculator } from './limits.js';
import { BonusCalculator } from './bonuses.js';

export class CompetitiveEngine {
  static calculate(
    baseQualityScore: number,
    activityData: any,
    userData: any
  ): CompetitiveScoreResult {
    const plan: 'open' | 'performance' = userData.subscriptionTier === 'performance' ? 'performance' : 'open';
    const streak = userData.streak || 0;
    const boost = userData.activeBoost || 0;

    const bonuses = BonusCalculator.calculate(activityData);
    const multipliers = MultiplierCalculator.calculate(streak, userData.wonLastSeason || false, boost);
    const penalties = PenaltyCalculator.calculate(activityData, userData);

    const appliedMultipliers: Array<{ label: string; value: number }> = [];
    if (multipliers.breakdown.streakMultiplier > 1) {
      appliedMultipliers.push({ label: `Sequência (${streak} dias)`, value: multipliers.breakdown.streakMultiplier });
    }
    if (multipliers.breakdown.boostMultiplier > 1) {
      appliedMultipliers.push({ label: 'Boost Ativo', value: multipliers.breakdown.boostMultiplier });
    }
    if (multipliers.breakdown.antiRepetitionMultiplier !== 1) {
      appliedMultipliers.push({ label: 'Ajuste do Campeão da Temporada', value: multipliers.breakdown.antiRepetitionMultiplier });
    }

    // Formula: QualityScore * Multipliers + FlatBonuses - Penalties
    let rawCompetitive = Math.round((baseQualityScore * (1 + bonuses.multiplierBonus) + bonuses.flatBonus) * multipliers.totalMultiplier) - penalties.penalties;
    if (rawCompetitive < 0) rawCompetitive = 0;

    const limitResult = LimitCalculator.apply(rawCompetitive, plan);

    return {
      finalScore: limitResult.finalScore,
      capped: limitResult.capped,
      baseQualityScore,
      streakMultiplier: multipliers.breakdown.streakMultiplier,
      activeBoost: boost,
      flatBonuses: bonuses.flatBonus,
      penalties: penalties.penalties,
      plan,
      appliedMultipliers
    };
  }
}
