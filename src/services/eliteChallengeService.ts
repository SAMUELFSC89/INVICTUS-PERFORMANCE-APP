import { db, auth, handleFirestoreError, OperationType } from '../firebase';
import { QuotaExhaustedError, isQuotaError } from './errors';
import { 
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  getDocs, 
  query, 
  where, 
  orderBy, 
  limit, 
  updateDoc, 
  increment,
  Timestamp,
  addDoc
} from 'firebase/firestore';

export interface Season {
  id: string;
  name: string;
  theme: string;
  medalIcon: string;
  startDate: string;
  endDate: string;
  totalPool: number;
  athletesCount: number;
  status: 'active' | 'upcoming' | 'past';
  description?: string;
}

export interface EliteChallenge {
  id: string;
  seasonId: string;
  name: string;
  km: number;
  days: number;
  difficulty: 'Baixa' | 'Média' | 'Alta' | 'Extrema' | 'Insana' | 'Lendária';
  rarity: string;
  finishRate: number;
  entryFee: number;
  quotaMultiplier: number;
}

export interface UserEliteChallenge {
  id: string;
  userId: string;
  userName: string;
  userPhoto?: string;
  challengeId: string;
  challengeName?: string;
  seasonId: string;
  currentKm: number;
  targetKm: number;
  startDate: string;
  endDate: string;
  streak: number;
  status: 'active' | 'completed' | 'failed';
  paid: boolean;
  estimatedPrize: number;
  lastActivityDate?: string;
  activitiesCount: number;
}

// Memory cache to mitigate Firestore Quota Exhausted errors
const serviceCache: Record<string, { data: any, timestamp: number }> = {};
const CACHE_TTL = 120000; // Increase to 120 seconds

function getCached(key: string, ignoreExpiration = false) {
  const item = serviceCache[key];
  if (item && (ignoreExpiration || Date.now() - item.timestamp < CACHE_TTL)) return item.data;
  
  // Try localStorage for persistent fallback
  try {
    const stored = localStorage.getItem(`elite_persist_${key}`);
    if (stored) {
      const { data, timestamp } = JSON.parse(stored);
      // Allow using data up to 48 hours old as fallback for static-ish season info
      if (ignoreExpiration || Date.now() - timestamp < 172800000) return data;
    }
  } catch (e) { /* ignore */ }
  
  return null;
}

function setCache(key: string, data: any) {
  serviceCache[key] = { data, timestamp: Date.now() };
  try {
    localStorage.setItem(`elite_persist_${key}`, JSON.stringify({ data, timestamp: Date.now() }));
  } catch (e) { /* ignore */ }
}

export const eliteChallengeService = {
  async getActiveSeason(): Promise<Season | null> {
    const cached = getCached('active_season');
    if (cached) return cached;

    try {
      const q = query(collection(db, 'seasons'), where('status', '==', 'active'), limit(1));
      const snap = await getDocs(q);
      if (snap.empty) {
        // If not found in DB, try to see if we have ANY past season to show as fallback
        return getCached('active_season', true) || null;
      }
      const data = { id: snap.docs[0].id, ...snap.docs[0].data() } as Season;
      setCache('active_season', data);
      return data;
    } catch (error: any) {
      if (isQuotaError(error?.code) || isQuotaError(error?.message)) {
        console.warn('[EliteService] Quota exceeded for getActiveSeason, using fallback');
        const fallback = getCached('active_season', true);
        if (fallback) return fallback;
        throw new QuotaExhaustedError('Dados da temporada em atualização. Tente novamente.');
      }
      console.error('[EliteService] getActiveSeason error:', error);
      return getCached('active_season', true) || null;
    }
  },

  async getSeasonChallenges(seasonId: string): Promise<EliteChallenge[]> {
    const cacheKey = `challenges_${seasonId}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;

    try {
      const q = query(collection(db, 'elite_challenges'), where('seasonId', '==', seasonId));
      const snap = await getDocs(q);
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as EliteChallenge));
      setCache(cacheKey, data);
      return data;
    } catch (error: any) {
      if (isQuotaError(error?.code) || isQuotaError(error?.message)) {
        if (cached) return cached;
        throw new QuotaExhaustedError('Desafios em atualização. Tente novamente.');
      }
      console.error('[EliteService] getSeasonChallenges error:', error);
      return [];
    }
  },

  async getUserChallenges(userId: string): Promise<UserEliteChallenge[]> {
    const cacheKey = `user_challenges_${userId}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;

    try {
      const q = query(collection(db, 'user_elite_challenges'), where('userId', '==', userId));
      const snap = await getDocs(q);
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as UserEliteChallenge));
      setCache(cacheKey, data);
      return data;
    } catch (error: any) {
      if (isQuotaError(error?.code) || isQuotaError(error?.message)) {
        if (cached) return cached;
        throw new QuotaExhaustedError('Servidor em alta carga. Tente novamente em instantes.');
      }
      if (error?.message?.toLowerCase().includes('permission') || error?.code === 'permission-denied') {
        handleFirestoreError(error, OperationType.GET, 'user_elite_challenges');
      }
      console.error('[EliteService] getUserChallenges error:', error);
      return [];
    }
  },

  async joinChallenge(userId: string, userName: string | null, userPhoto: string | null, challenge: EliteChallenge, season: Season): Promise<void> {
    const id = `${userId}_${challenge.id}`;
    const now = new Date();
    const endDate = new Date();
    endDate.setDate(now.getDate() + challenge.days);

    const userChallenge: Omit<UserEliteChallenge, 'id'> = {
      userId,
      userName: userName || 'Atleta',
      userPhoto: userPhoto || '',
      challengeId: challenge.id,
      seasonId: challenge.seasonId,
      currentKm: 0,
      targetKm: challenge.km,
      startDate: now.toISOString(),
      endDate: endDate.toISOString(),
      streak: 0,
      status: 'active',
      paid: true,
      estimatedPrize: challenge.entryFee * (1 + challenge.quotaMultiplier),
      activitiesCount: 0
    };

    try {
      try {
        await setDoc(doc(db, 'user_elite_challenges', id), userChallenge);
      } catch (err: any) {
        if (err?.message?.toLowerCase().includes('permission') || err?.code === 'permission-denied') {
          handleFirestoreError(err, OperationType.CREATE, `user_elite_challenges/${id}`);
        }
        throw err;
      }
      
      // Update from server-side for safety and to avoid rule issues
      const headers: any = { 'Content-Type': 'application/json' };
      const fbUser = auth.currentUser;
      if (fbUser) {
        const idToken = await fbUser.getIdToken();
        headers['Authorization'] = `Bearer ${idToken}`;
      }

      const response = await fetch('/api/elite?action=join-success', {
        method: 'POST',
        headers,
        body: JSON.stringify({ 
          userId, 
          seasonId: season.id, 
          challengeId: challenge.id, 
          entryFee: challenge.entryFee,
          userName: userName || 'Atleta',
          userPhoto: userPhoto || ''
        })
      });

      if (!response.ok) {
        const text = await response.text();
        console.error('[EliteService] Failed to notify server of join:', text);
      }
    } catch (error) {
      console.error('[EliteService] joinChallenge error:', error);
      throw error;
    }
  },

  async getEliteFeed(): Promise<any[]> {
    const cached = getCached('elite_feed');
    if (cached) return cached;

    try {
      const q = query(collection(db, 'elite_feed'), orderBy('timestamp', 'desc'), limit(10));
      const snap = await getDocs(q);
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setCache('elite_feed', data);
      return data;
    } catch (error) {
      console.error('[EliteService] getEliteFeed error:', error);
      return [];
    }
  },

  async getSeasonRanking(seasonId: string, limitCount = 10): Promise<any[]> {
    const cacheKey = `ranking_${seasonId}_${limitCount}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;

    try {
      const q = query(
        collection(db, 'user_elite_challenges'), 
        where('seasonId', '==', seasonId),
        orderBy('currentKm', 'desc'),
        limit(limitCount)
      );
      const snap = await getDocs(q);
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setCache(cacheKey, data);
      return data;
    } catch (error: any) {
      if (error?.message?.toLowerCase().includes('permission') || error?.code === 'permission-denied') {
        handleFirestoreError(error, OperationType.GET, 'user_elite_challenges');
      }
      console.error('[EliteService] getSeasonRanking error:', error);
      return [];
    }
  }
};
