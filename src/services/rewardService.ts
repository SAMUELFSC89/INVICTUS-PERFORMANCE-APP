import { REWARD_RULES, REWARD_TIERS, TOP_10_PERCENTAGES, RewardTier } from '../constants';
import { UserProfile } from '../types';

export function getPoolStatus(count: number) {
  const currentCount = Math.max(0, count);
  const totalCount = count;

  let currentTier: RewardTier | null = null;
  let nextTierIndex = 0;

  for (let i = 0; i < REWARD_TIERS.length; i++) {
    if (currentCount >= REWARD_TIERS[i].participants) {
      currentTier = REWARD_TIERS[i];
      nextTierIndex = i + 1;
    } else {
      break;
    }
  }

  const nextTier = nextTierIndex < REWARD_TIERS.length ? REWARD_TIERS[nextTierIndex] : null;
  const active = currentTier !== null;

  return {
    active,
    statusLabel: active ? 'Ativo (Temporada Oficial Invictus)' : 'Aguardando ativação (Mín. 50 Atletas)',
    participantsCount: currentCount,
    totalCount,
    prizePool: currentTier ? currentTier.prizePool : 0,
    nextTier: nextTier || (currentTier ? null : REWARD_TIERS[0]),
    currentTier: currentTier || { participants: 0, prizePool: 0 },
  };
}

export function getPoolValue(count: number): number {
  return getPoolStatus(count).prizePool;
}

export const rewardService = {
  /**
   * Calculates the value per user for rewards - kept for legacy compatibility
   */
  getPrizePerUser() {
    return REWARD_RULES.SUBSCRIPTION_PRICE * 0.45;
  },

  /**
   * Determines current phase
   */
  getCurrentPhase(totalActiveUsers: number) {
    if (totalActiveUsers >= 150) return 3;
    if (totalActiveUsers >= 50) return 2;
    return 1;
  },

  /**
   * Calculates values per user per league (legacy compatibility)
   */
  getValuesPerUserByLeague(totalActiveUsers: number) {
    const pool = getPoolValue(totalActiveUsers);
    const rate = pool / Math.max(1, totalActiveUsers);
    return {
      gym: rate,
      city: rate,
      national: rate
    };
  },

  /**
   * Calculates specific pools based on user counts - returns the exact tier-based prize pools
   */
  calculatePools(totalActiveUsers: number, usersInGym: number, usersInCity: number) {
    const gymStatus = getPoolStatus(usersInGym);
    const cityStatus = getPoolStatus(usersInCity);
    const nationalStatus = getPoolStatus(totalActiveUsers);

    return {
      gym: gymStatus.prizePool,
      city: cityStatus.prizePool,
      national: nationalStatus.prizePool,
      
      gymDetails: gymStatus,
      cityDetails: cityStatus,
      nationalDetails: nationalStatus,

      status: {
        isCityUnlocked: false, // Locked until released
        isNationalUnlocked: false, // Locked until released
        currentPhase: 1
      }
    };
  },

  /**
   * Calculates individual rewards for Top 10 using the official Top 10 percentage system
   */
  calculateTop10Rewards(pool: number) {
    if (pool <= 0) return Array(10).fill(0);
    return TOP_10_PERCENTAGES.map(percent => Math.round(pool * percent));
  },

  /**
   * Gets the award for a user at a specific rank
   */
  getRankReward(rank: number, pool: number) {
    const rewards = this.calculateTop10Rewards(pool);
    if (rank > 0 && rank <= rewards.length) {
      return rewards[rank - 1];
    }
    return 0;
  },

  /**
   * Resolves cascading prize rules
   */
  resolvePrizes(
    userList: UserProfile[],
    poolsMap: Record<string, { gym: number; city: number; national: number }>
  ) {
    const results: Record<string, { gymReward: number; cityReward: number; nationalReward: number; totalReward: number }> = {};

    userList.forEach(user => {
      const pools = poolsMap[user.uid] || { gym: 0, city: 0, national: 0 };
      results[user.uid] = {
        gymReward: this.getRankReward(user.positions?.gym || 0, pools.gym),
        cityReward: this.getRankReward(user.positions?.city || 0, pools.city),
        nationalReward: this.getRankReward(user.positions?.national || 0, pools.national),
        totalReward: 0
      };
    });

    const topNationalUser = userList.find(u => u.positions?.national === 1);

    const topCityUsersByCity: Record<string, UserProfile> = {};
    userList.forEach(u => {
      if (u.city && u.positions?.city === 1) {
        topCityUsersByCity[u.city] = u;
      }
    });

    userList.forEach(user => {
      const res = results[user.uid];
      const pools = poolsMap[user.uid] || { gym: 0, city: 0, national: 0 };

      // City Reward Cascade
      if (user.positions?.city === 1) {
        if (topNationalUser && topNationalUser.uid === user.uid) {
          res.cityReward = 0;
        }
      } else if (user.positions?.city === 2) {
        const cityTop1 = topCityUsersByCity[user.city];
        if (cityTop1 && topNationalUser && topNationalUser.uid === cityTop1.uid) {
          res.cityReward = this.getRankReward(1, pools.city);
        }
      }

      // Gym Reward Cascade
      if (user.positions?.gym === 1) {
        const isTopCity = topCityUsersByCity[user.city] && topCityUsersByCity[user.city].uid === user.uid;
        const isTopNational = topNationalUser && topNationalUser.uid === user.uid;
        
        if (isTopCity || isTopNational) {
          res.gymReward = 0;
        }
      } else if (user.positions?.gym === 2 && user.gymId) {
        const gymTop1 = userList.find(u => u.gymId === user.gymId && u.positions?.gym === 1);
        if (gymTop1) {
          const isTopCity = topCityUsersByCity[gymTop1.city] && topCityUsersByCity[gymTop1.city].uid === gymTop1.uid;
          const isTopNational = topNationalUser && topNationalUser.uid === gymTop1.uid;
          if (isTopCity || isTopNational) {
            res.gymReward = this.getRankReward(1, pools.gym);
          }
        }
      }

      res.totalReward = res.gymReward + res.cityReward + res.nationalReward;
    });

    return results;
  }
};
