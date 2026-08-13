import { WalletEngine } from './wallet-engine.js';
import { IVCoinCategory, IVCoinTransactionOrigin } from '../../src/types.js';

export class RewardsEngine {
  /**
   * Reward for completing a valid workout (Musculação). Value in R$ (Reais).
   */
  static async rewardWorkout(userId: string, points: number = 10): Promise<number> {
    const amount = Number((Math.max(10, Math.floor(points * 2)) / 100).toFixed(2));
    await WalletEngine.creditCoins({
      userId,
      amount,
      category: 'ecosystem',
      origin: 'workout',
      description: 'Recompensa por treino verificado (+R$ ' + amount.toFixed(2) + ')'
    });
    return amount;
  }

  /**
   * Reward for completing a cardio session. Value in R$ (Reais).
   */
  static async rewardCardio(userId: string, durationMins: number, distanceKm: number = 0): Promise<number> {
    const baseUnits = Math.min(50, Math.floor(durationMins * 1.5) + Math.floor(distanceKm * 5));
    const amount = Number((Math.max(10, baseUnits) / 100).toFixed(2));

    await WalletEngine.creditCoins({
      userId,
      amount,
      category: 'ecosystem',
      origin: 'cardio',
      description: 'Recompensa por cardio registrado (' + durationMins + ' min) (+R$ ' + amount.toFixed(2) + ')'
    });
    return amount;
  }

  /**
   * Reward for maintaining/reaching a workout streak milestone (e.g. 7 days, 14 days, 30 days). Value in R$.
   */
  static async rewardStreakMilestone(userId: string, streakDays: number): Promise<number> {
    let units = 25;
    if (streakDays >= 30) units = 200;
    else if (streakDays >= 14) units = 100;
    else if (streakDays >= 7) units = 50;
    const amount = Number((units / 100).toFixed(2));

    await WalletEngine.creditCoins({
      userId,
      amount,
      category: 'ecosystem',
      origin: 'streak',
      description: 'Bônus por Off-Streak de ' + streakDays + ' dias seguidos! (+R$ ' + amount.toFixed(2) + ')'
    });
    return amount;
  }

  /**
   * Reward for League/Championship prizes. Category: REDEEMABLE (sacável via PIX). Value in R$.
   */
  static async rewardLeaguePrize(userId: string, leagueName: string, rank: number, prizeAmount: number): Promise<void> {
    if (prizeAmount <= 0) return;
    await WalletEngine.creditCoins({
      userId,
      amount: prizeAmount,
      category: 'redeemable',
      origin: 'league',
      description: 'Premiação da ' + leagueName + ' - Posição #' + rank + ' (+R$ ' + prizeAmount.toFixed(2) + ')'
    });
  }

  /**
   * Reward for completing a mission. 'legacyUnits' preserves the original economics from
   * when missions were denominated in IV Coins (100 units = R$ 1,00) — dividing by 100
   * converts it to the real R$ amount actually credited to the wallet, with no schema
   * migration required for already-seeded mission documents.
   */
  static async rewardMission(userId: string, missionTitle: string, legacyUnits: number, category: IVCoinCategory = 'ecosystem'): Promise<number> {
    if (legacyUnits <= 0) return 0;
    const amount = Number((legacyUnits / 100).toFixed(2));
    await WalletEngine.creditCoins({
      userId,
      amount,
      category,
      origin: 'mission',
      description: 'Conclusão da missão: ' + missionTitle + ' (+R$ ' + amount.toFixed(2) + ')'
    });
    return amount;
  }

  /**
   * Reward for referral (Indicação de amigo). Value in R$.
   */
  static async rewardReferral(referrerUserId: string, refereeName: string, amount: number = 0.50): Promise<void> {
    await WalletEngine.creditCoins({
      userId: referrerUserId,
      amount,
      category: 'ecosystem',
      origin: 'referral',
      description: 'Bônus por indicar o amigo ' + refereeName + ' (+R$ ' + amount.toFixed(2) + ')'
    });
  }
}
