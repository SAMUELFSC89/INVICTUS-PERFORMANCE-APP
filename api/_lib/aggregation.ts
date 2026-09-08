import { db } from './common.js';
import { isProUser } from './entitlement.js';

export const aggregationService = {
  async updateAllStats() {
    if (!db) return;
    console.log('[Aggregation] Starting global stats update...');
    
    try {
      const usersCol = db.collection('users');
      
      // 1. Basic Counts
      const totalUsersSnap = await usersCol.count().get();
      const totalUserCount = totalUsersSnap.data().count;
      
      const proCandidatesSnap = await usersCol.where('subscriptionTier', 'in', ['performance', 'pro']).get();
      const activeUserCount = proCandidatesSnap.docs.filter((document: any) => isProUser(document.data())).length;
      
      // 2. City and Gym Partitioned Counts
      // For large scale, these should be updated incrementally, but for thousands we can do a group by in memory or separate queries
      // Since Firestore doesn't have a good "Group By", we'll fetch unique cities/gyms from a config or just focus on the active ones
      
      // 3. League phase. RevenueCat products can use different periods,
      // prices and currencies, so subscriber counts must never be converted
      // into revenue or prize money with a hard-coded monthly price.
      let phase = 1;
      if (activeUserCount >= 10000) phase = 3;
      else if (activeUserCount >= 5000) phase = 2;
      
      const pools = {
        totalActive: activeUserCount,
        phase,
        poolValues: {
          // Monetary pools remain unavailable until they are calculated from
          // confirmed provider transactions grouped by currency and period.
          national: null,
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
      
    } catch (error: any) {
      const errorMsg = error.message || '';
      if (errorMsg.includes('RESOURCE_EXHAUSTED')) {
        console.warn('[Aggregation] Quota limit reached, stopping update.');
        return;
      }
      console.error('[Aggregation] Error updating stats:', error);
    }
  }
};
