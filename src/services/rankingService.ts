import { startOfMonth, addMonths, format } from 'date-fns';
import { auth } from '../firebase';
import type { RankingSnapshot } from '../types';
import { QuotaExhaustedError, isQuotaError } from './errors';
import { redisService } from './redisService';
import { API_CONFIG } from '../config';
import type { CompetitiveHrAcknowledgementInput } from '../lib/competitiveHeartRateAcknowledgement';

export type AcademyRankingPeriod = 'all' | 'weekly' | 'monthly';

function cacheKey(uid: string, period: AcademyRankingPeriod) {
  return `ranking_academy_${uid}_${period}_${rankingService.getSeasonStatus().id}`;
}

async function authenticatedRequest(path: string, init?: RequestInit) {
  const user = auth.currentUser;
  if (!user) throw new Error('Autenticação necessária.');
  const token = await user.getIdToken();
  return fetch(`${API_CONFIG.baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
}

async function readJson(response: Response) {
  const text = await response.text();
  if (!text || text.trim().startsWith('<')) throw new Error('O servidor retornou uma resposta inválida.');
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Não foi possível interpretar a resposta do ranking.');
  }
}

function responseError(response: Response, result: any, fallback: string) {
  return response.status >= 500 ? fallback : (typeof result?.error === 'string' ? result.error : fallback);
}

export const rankingService = {
  async getEnrollment(): Promise<{ enrolled: boolean; gymId: string; consentVersion?: string | null }> {
    const response = await authenticatedRequest('/api/ranking-enrollment');
    const result = await readJson(response);
    if (!response.ok) throw new Error(responseError(response, result, 'Não foi possível consultar sua adesão ao ranking.'));
    return result;
  },

  async enroll(hrAcknowledgement: CompetitiveHrAcknowledgementInput): Promise<{ enrolled: boolean; gymId: string }> {
    const response = await authenticatedRequest('/api/ranking-enrollment', {
      method: 'POST',
      body: JSON.stringify({ hrAcknowledgement }),
    });
    const result = await readJson(response);
    if (!response.ok) throw new Error(responseError(response, result, 'Não foi possível entrar no ranking.'));
    if (auth.currentUser) await this.invalidate(auth.currentUser.uid);
    return result;
  },

  async withdraw(): Promise<void> {
    const user = auth.currentUser;
    const response = await authenticatedRequest('/api/ranking-enrollment', { method: 'DELETE' });
    const result = await readJson(response);
    if (!response.ok) throw new Error(responseError(response, result, 'Não foi possível sair do ranking.'));
    if (user) await this.invalidate(user.uid);
  },

  async getAcademyRanking(period: AcademyRankingPeriod, force = false): Promise<RankingSnapshot> {
    const user = auth.currentUser;
    if (!user) throw new Error('Autenticação necessária.');
    const key = cacheKey(user.uid, period);
    if (force) await redisService.del(key);

    return redisService.staleWhileRevalidate<RankingSnapshot>(key, async () => {
      const response = await authenticatedRequest(`/api/ranking?period=${period}&limit=100`);
      const result = await readJson(response);
      if (!response.ok) {
        if (isQuotaError(JSON.stringify(result))) {
          throw new QuotaExhaustedError('Ranking com alto tráfego. Tente novamente em instantes.');
        }
        throw new Error(responseError(response, result, 'Não foi possível carregar o ranking da academia.'));
      }
      return {
        id: `gym_${result.gymId || 'current'}`,
        level: 'gym',
        levelId: result.gymId || '',
        topUsers: Array.isArray(result.topUsers) ? result.topUsers : [],
        currentUser: result.currentUser || null,
        participantCount: Number(result.participantCount || 0),
        enrolled: result.enrolled === true,
        gymId: result.gymId || '',
        gymName: result.gymName || '',
        updatedAt: new Date().toISOString(),
      };
    }, { staleAfterSeconds: 45, exSeconds: 300 });
  },

  async invalidate(uid: string) {
    await Promise.all((['weekly', 'monthly', 'all'] as AcademyRankingPeriod[])
      .map((period) => redisService.del(cacheKey(uid, period))));
  },

  getSeasonStatus() {
    const now = new Date();
    const startDate = startOfMonth(now);
    const endDate = startOfMonth(addMonths(startDate, 1));
    return {
      id: `season_${format(startDate, 'yyyy-MM')}`,
      status: 'active' as const,
      daysRemaining: Math.max(1, Math.ceil((endDate.getTime() - now.getTime()) / 86_400_000)),
      endDate,
      nextSeasonStart: startDate,
    };
  },
};
