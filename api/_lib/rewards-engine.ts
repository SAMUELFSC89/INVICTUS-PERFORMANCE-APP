import { WalletEngine } from './wallet-engine.js';
import { IVCoinCategory, IVCoinTransactionOrigin } from '../../src/types.js';

export class RewardsEngine {
  /**
   * Reward for completing a valid workout (Musculação).
   */
  static async rewardWorkout(userId: string, points: number = 10): Promise<number> {
    // Default: 20 IV Coins per verified workout (ecosystem/redeemable depending on logic)
    const coins = Math.max(10, Math.floor(points * 2));
    await WalletEngine.creditCoins({
      userId,
      amount: coins,
      category: 'ecosystem',
      origin: 'workout',
      description: `Recompensa por treino verificado (+${coins} IV Coins)`
    });
    return coins;
  }

  /**
   * Reward for completing a cardio session.
   */
  static async rewardCardio(userId: string, durationMins: number, distanceKm: number = 0): Promise<number> {
    const baseCoins = Math.min(50, Math.floor(durationMins * 1.5) + Math.floor(distanceKm * 5));
    const coins = Math.max(10, baseCoins);

    await WalletEngine.creditCoins({
      userId,
      amount: coins,
      category: 'ecosystem',
      origin: 'cardio',
      description: `Recompensa por cardio registrado (${durationMins} min) (+${coins} IV Coins)`
    });
    return coins;
  }

  /**
   * Reward for maintaining/reaching a workout streak milestone (e.g. 7 days, 14 days, 30 days).
   */
  static async rewardStreakMilestone(userId: string, streakDays: number): Promise<number> {
    let coins = 25;
    if (streakDays >= 30) coins = 200;
    else if (streakDays >= 14) coins = 100;
    else if (streakDays >= 7) coins = 50;

    await WalletEngine.creditCoins({
      userId,
      amount: coins,
      category: 'ecosystem',
      origin: 'streak',
      description: `Bônus por Off-Streak de ${streakDays} dias seguidos! (+${coins} IV Coins)`
    });
    return coins;
  }

  /**
   * Reward for League/Championship prizes. (Category: REDEEMABLE coins).
   */
  static async rewardLeaguePrize(userId: string, leagueName: string, rank: number, prizeCoins: number): Promise<void> {
    if (prizeCoins <= 0) return;
    await WalletEngine.creditCoins({
      userId,
      amount: prizeCoins,
      category: 'redeemable',
      origin: 'league',
      description: `Premiação da ${leagueName} - Posição #${rank} (+${prizeCoins} IV Coins Resgatáveis)`
    });
  }

  /**
   * Reward for completing a mission.
   */
  static async rewardMission(userId: string, missionTitle: string, rewardCoins: number, category: IVCoinCategory = 'ecosystem'): Promise<void> {
    if (rewardCoins <= 0) return;
    await WalletEngine.creditCoins({
      userId,
      amount: rewardCoins,
      category,
      origin: 'mission',
      description: `Conclusão da missão: ${missionTitle} (+${rewardCoins} IV Coins)`
    });
  }

  /**
   * Reward for referral (Indicação de amigo).
   */
  static async rewardReferral(referrerUserId: string, refereeName: string, coins: number = 50): Promise<void> {
    await WalletEngine.creditCoins({
      userId: referrerUserId,
      amount: coins,
      category: 'ecosystem',
      origin: 'referral',
      description: `Bônus por indicar o amigo ${refereeName} (+${coins} IV Coins)`
    });
  }
}
