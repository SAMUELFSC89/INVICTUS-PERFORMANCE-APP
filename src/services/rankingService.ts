import { db, handleFirestoreError, OperationType, auth } from '../firebase';
import { collection, query, where, getDocs, orderBy, limit, doc, getDoc, getCountFromServer } from 'firebase/firestore';
import { RankingSnapshot, RankingEntry, UserProfile } from '../types';
import { QuotaExhaustedError, isQuotaError } from './errors';
import { redisService } from './redisService';

const CACHE_DURATION = 15 * 60 * 1000; // 15 minutes

function getCached(key: string, ignoreExpiration: boolean = false) {
  const cachedStr = localStorage.getItem(`cache_${key}`);
  if (!cachedStr) return null;
  
  try {
    const cached = JSON.parse(cachedStr);
    if (ignoreExpiration || (Date.now() - cached.timestamp < CACHE_DURATION)) {
      return cached.data;
    }
  } catch (e) {
    localStorage.removeItem(`cache_${key}`);
  }
  return null;
}

function setCache(key: string, data: any) {
  try {
    localStorage.setItem(`cache_${key}`, JSON.stringify({ 
      data, 
      timestamp: Date.now() 
    }));
  } catch (e) {
    console.warn('LocalStorage quota exceeded, clearing cache...');
    Object.keys(localStorage).forEach(k => {
      if (k.startsWith('cache_')) localStorage.removeItem(k);
    });
  }
}

// Deduping inflight requests
const pendingRequests = new Map<string, Promise<any>>();
let pendingStatsRequest: Promise<any> | null = null;

async function getSystemStats() {
  if (pendingStatsRequest) return pendingStatsRequest;

  pendingStatsRequest = (async () => {
    try {
      const statsRef = doc(db, 'system_stats', 'global');
      const statsSnap = await getDoc(statsRef);
      if (statsSnap.exists()) {
        const data = statsSnap.data();
        return data;
      }
      return null;
    } catch (error) {
      console.warn('[Ranking Service] Failed to fetch system stats:', error);
      return null;
    } finally {
      // Clear after a short delay to allow batching but ensure fresh data for next "run"
      setTimeout(() => { pendingStatsRequest = null; }, 1000);
    }
  })();

  return pendingStatsRequest;
}

export const rankingService = {
  async getRanking(level: 'league' | 'referral' | 'gym' | 'city' | 'global', levelId: string = '', period: 'all' | 'weekly' | 'monthly' = 'all', tier: 'open' | 'performance' = 'performance') {
    const season = this.getSeasonStatus();
    const cacheKey = `ranking_${level}_${levelId}_${period}_${season.id}_${tier}`;

    // Utilize the professional Redis-like SWR (Stale-While-Revalidate) pattern
    return redisService.staleWhileRevalidate<RankingSnapshot>(cacheKey, async () => {
      try {
        const user = auth.currentUser;
        const headers: Record<string, string> = {
          'Content-Type': 'application/json'
        };

        if (user) {
          const token = await user.getIdToken();
          headers['Authorization'] = `Bearer ${token}`;
        }

        const response = await fetch(`/api/ranking?level=${level}&levelId=${levelId}&period=${period}&tier=${tier}`, { headers });
        
        const text = await response.text();

        if (!response.ok) {
          const isQuota = isQuotaError(text);
          if (isQuota) throw new QuotaExhaustedError('Ranking pulsando com alto tráfego. Aguarde um momento.');
          console.warn(`[Ranking Service] HTTP ${response.status} ao carregar ranking:`, text.slice(0, 100));
          return {
            id: `${level}_${levelId}`,
            level,
            levelId,
            topUsers: [],
            updatedAt: new Date().toISOString()
          } as RankingSnapshot;
        }

        if (!text || text.trim().startsWith('<')) {
          console.warn('[Ranking Service] Resposta do servidor não é JSON (HTML recebido). Retornando estrutura vazia.');
          return {
            id: `${level}_${levelId}`,
            level,
            levelId,
            topUsers: [],
            updatedAt: new Date().toISOString()
          } as RankingSnapshot;
        }

        let parsed: any = {};
        try {
          parsed = JSON.parse(text);
        } catch (jsonErr) {
          console.warn('[Ranking Service] Erro ao analisar JSON do ranking:', jsonErr);
          return {
            id: `${level}_${levelId}`,
            level,
            levelId,
            topUsers: [],
            updatedAt: new Date().toISOString()
          } as RankingSnapshot;
        }

        let topUsers = parsed?.topUsers || [];

        // Direct client Firestore fallback if server API returned empty users list
        if (topUsers.length === 0 && db) {
          try {
            const scoreField = period === 'weekly' ? 'weeklyScore' : period === 'monthly' ? 'monthlyScore' : 'score';
            const usersRef = collection(db, 'users');
            let q = query(usersRef, orderBy(scoreField, 'desc'), limit(50));
            const snap = await getDocs(q);
            if (!snap.empty) {
              topUsers = snap.docs.map((d, i) => {
                const data = d.data();
                return {
                  uid: d.id,
                  displayName: data.displayName || 'Atleta',
                  photoURL: data.photoURL || '',
                  score: data[scoreField] || 0,
                  streak: data.streak || 0,
                  rank: i + 1,
                  isSubscribed: data.isSubscribed || false,
                  city: data.city || '',
                  gymId: data.gymId || '',
                  positions: data.positions || {}
                };
              });
            }
          } catch (clientFallbackErr) {
            console.warn('[Ranking Service] Client Firestore fallback warning:', clientFallbackErr);
          }
        }

        return {
          id: `${level}_${levelId}`,
          level,
          levelId,
          topUsers,
          updatedAt: new Date().toISOString()
        } as RankingSnapshot;
      } catch (error: any) {
        console.error('Core live fetcher failed inside SWR ranking wrapper:', error);
        throw error;
      }
    }, {
      staleAfterSeconds: 45, // Fresh for 45s
      exSeconds: 300 // Expiry 5 mins
    }).catch((swrErr) => {
      console.warn('[Ranking Service] SWR fallback chain failed. Returning empty array.', swrErr);
      return {
        id: `${level}_${levelId}`,
        level,
        levelId,
        topUsers: [],
        updatedAt: new Date().toISOString()
      } as RankingSnapshot;
    });
  },

  async getActiveUserCount(level?: 'league' | 'gymId' | 'city', levelId?: string) {
    const cacheKey = `active_count_${level}_${levelId}`;
    const cached = getCached(cacheKey);
    if (cached !== null) return cached;

    try {
      const data = await getSystemStats();
      if (data) {
        let count = 0;
        if (level === 'gymId') {
          count = levelId && data.partitionedCounts?.gyms?.[levelId] ? data.partitionedCounts.gyms[levelId] : 0;
        } else if (level === 'city') {
          count = levelId && data.partitionedCounts?.cities?.[levelId] ? data.partitionedCounts.cities[levelId] : 0;
        } else {
          count = data.activeUserCount || 0;
        }

        setCache(cacheKey, count);
        return count;
      }
      return 0; // Fallback
    } catch (error) {
      console.warn('getActiveUserCount failure:', error);
      return 0;
    }
  },

  async getTotalUserCount() {
    const cacheKey = 'total_user_count';
    const cached = getCached(cacheKey);
    if (cached !== null) return cached;

    try {
      const data = await getSystemStats();
      if (data) {
        const count = data.totalUserCount || 0;
        setCache(cacheKey, count);
        return count;
      }
      return 0; // Fallback
    } catch (error) {
      console.warn('getTotalUserCount failure:', error);
      return 0;
    }
  },

  getSeasonStatus() {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const daysUntilNextMonday = (1 + 7 - dayOfWeek) % 7;
    
    const startDate = new Date(now);
    if (daysUntilNextMonday > 0) {
      startDate.setDate(now.getDate() + daysUntilNextMonday);
    }
    startDate.setHours(0, 0, 0, 0);

    const endDate = new Date(startDate);
    endDate.setDate(startDate.getDate() + 7);
    endDate.setHours(23, 59, 59, 999);

    const diffTime = endDate.getTime() - now.getTime();
    const daysRemaining = Math.max(1, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));

    return {
      id: 'TEST_SEASON_7D',
      status: 'active' as const, // Active status for testing rank
      daysRemaining,
      endDate,
      nextSeasonStart: startDate
    };
  },

  calculateBoost(entryDay: number) {
    return 1;
  },

  async getUserPositions(profile: UserProfile, period: 'all' | 'weekly' | 'monthly' = 'all') {
    if (profile.positions) {
      return profile.positions;
    }

    const cacheKey = `user_positions_${profile.uid}_${period}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;

    // No on-the-fly getCountFromServer on the frontend.
    return {
      gym: 0,
      city: 0,
      national: 0,
      league: 0,
      global: 0,
      region: 0
    };
  },

  async isUserInActiveSeason(user: UserProfile) {
    // If user's status is 'next_season', they are registered for the upcoming season, not yet active in this quinzena.
    if (user.seasonEntryStatus === 'next_season') {
      return false;
    }
    return true;
  }
};
