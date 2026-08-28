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

// #96: RunningStatsBase, RankingEntry e RankingResponse foram removidos junto
// com getMyStats()/addRun()/getRanking() abaixo -- eram usados so por esses
// tres metodos, que eram a 5a formula de pontuacao paralela (ou dependiam
// dela via RunTracker.tsx, orfao). getHistory() continua servindo dados
// historicos legados -- por isso fica.

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
