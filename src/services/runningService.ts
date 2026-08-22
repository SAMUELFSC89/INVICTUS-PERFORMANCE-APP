import { auth } from '../firebase';
import { API_CONFIG } from '../config';
import { QuotaExhaustedError, isQuotaError } from './errors';

const getApiBase = () => {
  return `${API_CONFIG.baseUrl}/api/running`;
};

export interface RunTrajectory {
  lat: number;
  lng: number;
  timestamp: number;
}

export interface RunPoint {
  lat: number;
  lng: number;
  timestamp: number;
  speed: number; // m/s
  accuracy: number;
  altitude: number;
}

export interface RunSession {
  id?: string;
  userId: string;
  startTime: string;
  endTime: string;
  points: RunPoint[];
  totalDistance: number; // meters
  avgPace: string;
  maxSpeed: number; // m/s
  avgSpeed: number; // m/s
  confidenceScore: number; // 0-100
  validationStatus: 'VALID' | 'SUSPICIOUS' | 'INVALID';
  photoProof?: string;
  rank?: number | string;
  // O backend ja devolve estes valores em addRun. Antes eram descartados, e a
  // tela de sucesso so conseguia dizer "confirmada com sucesso".
  pointsEarned?: number;
  isScoringEligible?: boolean;
}

export interface AdvancedRunStats {
  id?: string;
  km: number;
  timeSeconds: number;
  pace: string;
  calories: number;
  elevationGain: number;
  steps: number;
  trajectory?: RunTrajectory[];
  date: string;
  session?: RunSession; // Attaching the full session for audit
  rank?: number | string;
  photoProof?: string;
}

export interface RunningStatsBase {
  userId: string;
  best_run_km_month: number;
  best_run_km_week: number;
  last_run_date: string;
  is_paid_running: boolean;
  sessionId?: string;
  last_run_stats?: AdvancedRunStats;
  validation?: {
    score: number;
    status: 'VALID' | 'SUSPICIOUS' | 'INVALID';
    reasons: string[];
  };
}

export interface RankingEntry {
  userId: string;
  displayName: string;
  photoURL: string | null;
  km: number;
  is_paid_running: boolean;
}

export interface RankingResponse {
  ranking: RankingEntry[];
  totalPool: number;
  potentialOfficialRank?: number | null;
  officialPreview?: { displayName: string; km: number }[] | null;
}

// Cache for running stats and ranking
const serviceCache: Record<string, { data: any, timestamp: number }> = {};
const CACHE_TTL = 60000; // Increase to 60 seconds

function getCached(key: string, ignoreExpiration = false) {
  const item = serviceCache[key];
  if (item && (ignoreExpiration || Date.now() - item.timestamp < CACHE_TTL)) return item.data;
  
  // Try localStorage for public-safe data as a persistent fallback
  try {
    const stored = localStorage.getItem(`persist_${key}`);
    if (stored) {
      const { data, timestamp } = JSON.parse(stored);
      // If ignoreExpiration is true, we return it regardless of how old it is
      // Otherwise, for stats, we use slightly older data as fallback (24 hours for extreme cases)
      if (ignoreExpiration || Date.now() - timestamp < 86400000) return data;
    }
  } catch (e) { /* ignore */ }
  
  return null;
}

function setCache(key: string, data: any) {
  serviceCache[key] = { data, timestamp: Date.now() };
  try {
    localStorage.setItem(`persist_${key}`, JSON.stringify({ data, timestamp: Date.now() }));
  } catch (e) { /* ignore */ }
}

export const runningService = {
  async getMyStats(): Promise<RunningStatsBase | null> {
    const user = auth.currentUser;
    if (!user) return null;
    
    const cacheKey = `stats_${user.uid}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;

    const API_BASE = getApiBase();
    try {
      const idToken = await user.getIdToken();
      const res = await fetch(`${API_BASE}?action=me&userId=${user.uid}`, {
        headers: { 'Authorization': `Bearer ${idToken}` }
      });
      if (!res.ok) {
        const text = await res.text();
        console.error('Relatório de erro (getMyStats):', text);
        if (isQuotaError(text)) throw new QuotaExhaustedError('Servidor em alta carga. Tente novamente em instantes.');
        throw new Error(`Erro ${res.status}: ${text}`);
      }
      const data = await res.json();
      setCache(cacheKey, data);
      return data;
    } catch (err: any) {
      // If we have ANY cached data (even from localStorage and very old), return it on quota error
      const anyCached = getCached(cacheKey, true);
      if ((err instanceof QuotaExhaustedError || isQuotaError(err?.message)) && anyCached) {
        console.warn('[RunningService] Using persistent cached data due to quota limits');
        return anyCached;
      }
      console.error('RunningService.getMyStats Error:', err);
      // Return a minimal fallback object instead of throwing if we have to
      return getCached(cacheKey, true) || null;
    }
  },

  async addRun(stats: Partial<AdvancedRunStats>): Promise<RunningStatsBase | null> {
    const user = auth.currentUser;
    if (!user) return null;

    const API_BASE = getApiBase();
    try {
      const idToken = await user.getIdToken();
      const res = await fetch(`${API_BASE}?action=add`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({ userId: user.uid, ...stats })
      });
      if (!res.ok) {
        const rawText = await res.text();
        let errMsg = 'Não conseguimos validar esta atividade no momento. Tente novamente seguindo as regras do desafio.';
        try {
          const jsonErr = JSON.parse(rawText);
          errMsg = jsonErr.userMessage || jsonErr.error || errMsg;
        } catch (_) {
          if (rawText && !rawText.includes('<!DOCTYPE') && rawText.length < 200) errMsg = rawText;
        }
        if (isQuotaError(rawText) || isQuotaError(errMsg)) {
          throw new QuotaExhaustedError('Servidor ocupado. Tente novamente.');
        }
        throw new Error(errMsg);
      }
      
      // Invalidate cache
      delete serviceCache[`stats_${user.uid}`];
      delete serviceCache['ranking_month_official'];
      delete serviceCache['ranking_week_official'];

      const respData = await res.json();
      return respData;
    } catch (err: any) {
      console.error('RunningService.addRun Error:', err);
      throw err;
    }
  },

  async getRanking(period: 'month' | 'week', mode: 'official' | 'demo' = 'official'): Promise<RankingResponse> {
    const user = auth.currentUser;
    const userIdParam = user ? `&userId=${user.uid}` : '';
    const API_BASE = getApiBase();
    
    const cacheKey = `ranking_${period}_${mode}_${user?.uid || 'guest'}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;

    try {
      let headers: HeadersInit = {};
      if (user) {
        const idToken = await user.getIdToken();
        headers['Authorization'] = `Bearer ${idToken}`;
      }
      
      const res = await fetch(`${API_BASE}?action=ranking&period=${period}&mode=${mode}${userIdParam}`, {
        headers
      });
      if (!res.ok) {
        const text = await res.text();
        console.error('Relatório de erro (getRanking):', text);
        if (isQuotaError(text)) throw new QuotaExhaustedError('Ranking em atualização. Tente novamente em instantes.');
        throw new Error(`Erro ${res.status}: ${text}`);
      }
      const data = await res.json();
      setCache(cacheKey, data);
      return data;
    } catch (err: any) {
      if ((err instanceof QuotaExhaustedError || isQuotaError(err?.message)) && cached) return cached;
      console.error('RunningService.getRanking Error:', err);
      throw err;
    }
  },
  
  async getHistory(userId: string): Promise<{ history: RunSession[] }> {
    const user = auth.currentUser;
    const API_BASE = getApiBase();
    try {
      let headers: HeadersInit = {};
      if (user) {
        const idToken = await user.getIdToken();
        headers['Authorization'] = `Bearer ${idToken}`;
      }
      
      const res = await fetch(`${API_BASE}?action=history&userId=${userId}`, {
        headers
      });
      if (!res.ok) {
        const text = await res.text();
        console.error('Relatório de erro (getHistory):', text);
        if (isQuotaError(text)) throw new QuotaExhaustedError('Histórico temporariamente indisponível.');
        throw new Error(`Erro ${res.status}: ${text}`);
      }
      return res.json();
    } catch (err: any) {
      console.error('RunningService.getHistory Error:', err);
      throw err;
    }
  }
};
