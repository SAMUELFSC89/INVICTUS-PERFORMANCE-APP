import { db } from './common.js';

export const aggregationService = {
  async updateAllStats() {
    if (!db) return;
    console.log('[Aggregation] Starting global stats update...');
    
    try {
      const usersCol = db.collection('users');
      
      // 1. Basic Counts
      const totalUsersSnap = await usersCol.count().get();
      const totalUserCount = totalUsersSnap.data().count;
      
      const activeUsersSnap = await usersCol.where('isSubscribed', '==', true).count().get();
      const activeUserCount = activeUsersSnap.data().count;
      
      // 2. City and Gym Partitioned Counts
      // For large scale, these should be updated incrementally, but for thousands we can do a group by in memory or separate queries
      // Since Firestore doesn't have a good "Group By", we'll fetch unique cities/gyms from a config or just focus on the active ones
      
      // 3. Pool Calculation
      // Move logic from rewardService to here
      const SUBSCRIPTION_PRICE = 39.90;
      const PRIZE_POOL_PERCENT = 0.45;
      const prizePerUser = SUBSCRIPTION_PRICE * PRIZE_POOL_PERCENT;
      
      let phase = 1;
      if (activeUserCount >= 10000) phase = 3;
      else if (activeUserCount >= 5000) phase = 2;
      
      const pools = {
        totalActive: activeUserCount,
        phase,
        poolValues: {
          national: activeUserCount * prizePerUser * (phase === 3 ? 0.05 : 0),
          // Gym and City pools depend on specific counts, we'll store the multipliers
          multipliers: {
            gym: phase === 1 ? 1 : 0.78,
            city: phase === 2 ? 0.22 : phase === 3 ? 0.17 : 0
          }
        }
      };

      await db.collection('system_stats').doc('global').set({
        totalUserCount,
        activeUserCount,
        pools,
        updatedAt: new Date().toISOString()
      }, { merge: true });

      console.log('[Aggregation] Global stats updated successfully.');
      
      // 4. Ranking Snapshots
      await this.updateRankings();
      
    } catch (error: any) {
      const errorMsg = error.message || '';
      if (errorMsg.includes('RESOURCE_EXHAUSTED')) {
        console.warn('[Aggregation] Quota limit reached, stopping update.');
        return;
      }
      console.error('[Aggregation] Error updating stats:', error);
    }
  },

  async updateRankings() {
    if (!db) return;
    const periods = ['all', 'weekly', 'monthly'];
    const scoreFields: Record<string, string> = {
      all: 'score',
      weekly: 'weeklyScore',
      monthly: 'monthlyScore'
    };

    try {
      for (const period of periods) {
        const scoreField = scoreFields[period];
        
        // Global Ranking
        const globalSnap = await db.collection('users')
          .where('activeSeason', '==', 'S1')
          .orderBy(scoreField, 'desc')
          .limit(50)
          .get();
          
        const topUsers = globalSnap.docs.map((d: any, i: number) => {
          const data = d.data();
          return {
            uid: d.id,
            displayName: data.displayName || 'Atleta',
            photoURL: data.photoURL || '',
            score: data[scoreField] || 0,
            streak: data.streak || 0,
            rank: i + 1,
            isSubscribed: data.isSubscribed || false
          };
        });

        await db.collection('aggregated_rankings').doc(`global_${period}`).set({
          level: 'global',
          period,
          topUsers,
          updatedAt: new Date().toISOString()
        });
      }
      console.log('[Aggregation] Global rankings snapshots updated.');
    } catch (error: any) {
      if (error.message?.includes('RESOURCE_EXHAUSTED')) {
        console.warn('[Aggregation] Quota limit reached during ranking snapshots.');
        return;
      }
      throw error;
    }
  }
};
