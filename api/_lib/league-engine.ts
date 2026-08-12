import { db } from './common.js';
import { LeaguePool, LeagueTier } from '../../src/types.js';

export const DEFAULT_LEAGUE_POOLS: LeaguePool[] = [
  {
    leagueId: 'bronze',
    name: 'Liga Bronze',
    monthlyPrizeCoins: 5000,
    weeklyPrizeCoins: 1200,
    sponsors: ['Invictus Fitness'],
    active: true
  },
  {
    leagueId: 'prata',
    name: 'Liga Prata',
    monthlyPrizeCoins: 10000,
    weeklyPrizeCoins: 2500,
    sponsors: ['Growth Supplements'],
    active: true
  },
  {
    leagueId: 'ouro',
    name: 'Liga Ouro',
    monthlyPrizeCoins: 25000,
    weeklyPrizeCoins: 6000,
    sponsors: ['Smart Fit', 'Integralmedica'],
    active: true
  },
  {
    leagueId: 'diamante',
    name: 'Liga Diamante',
    monthlyPrizeCoins: 50000,
    weeklyPrizeCoins: 12000,
    sponsors: ['Growth', 'Max Titanium'],
    active: true
  },
  {
    leagueId: 'mestre',
    name: 'Liga Mestre',
    monthlyPrizeCoins: 100000,
    weeklyPrizeCoins: 25000,
    sponsors: ['Invictus Pro', 'Under Armour'],
    active: true
  },
  {
    leagueId: 'lendario',
    name: 'Liga Lendária',
    monthlyPrizeCoins: 250000,
    weeklyPrizeCoins: 60000,
    sponsors: ['Invictus World Champion'],
    active: true
  }
];

export class LeagueEngine {
  /**
   * Fetches all league prize pool configurations.
   */
  static async getLeaguePools(): Promise<LeaguePool[]> {
    if (!db) return DEFAULT_LEAGUE_POOLS;
    try {
      const snap = await db.collection('league_pools').get();
      if (snap.empty) {
        // Initialize default pools
        for (const pool of DEFAULT_LEAGUE_POOLS) {
          await db.collection('league_pools').doc(pool.leagueId).set(pool);
        }
        return DEFAULT_LEAGUE_POOLS;
      }
      return snap.docs.map(doc => doc.data() as LeaguePool);
    } catch (err) {
      console.warn('[LeagueEngine] Error fetching league pools, using default:', err);
      return DEFAULT_LEAGUE_POOLS;
    }
  }

  /**
   * Updates a specific league prize pool configuration.
   */
  static async updateLeaguePool(leagueId: LeagueTier, poolData: Partial<LeaguePool>): Promise<LeaguePool> {
    if (!db) throw new Error('Database not initialized');
    const docRef = db.collection('league_pools').doc(leagueId);
    const snap = await docRef.get();

    let current = DEFAULT_LEAGUE_POOLS.find(p => p.leagueId === leagueId) || {
      leagueId,
      name: `Liga ${leagueId.toUpperCase()}`,
      monthlyPrizeCoins: 10000,
      weeklyPrizeCoins: 2500,
      sponsors: [],
      active: true
    };

    if (snap.exists) {
      current = snap.data() as LeaguePool;
    }

    const updated: LeaguePool = {
      ...current,
      ...poolData,
      leagueId
    };

    await docRef.set(updated, { merge: true });
    return updated;
  }
}
