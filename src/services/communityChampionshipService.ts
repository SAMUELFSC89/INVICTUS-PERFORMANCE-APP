import { auth } from '../firebase';
import type { CompetitiveHrAcknowledgementInput } from '../lib/competitiveHeartRateAcknowledgement';

export type CommunityRankingPeriod = 'weekly' | 'monthly' | 'all';
export type CommunityLeaderboardEntry = {
  userId: string;
  userName: string;
  photoURL?: string;
  score: number;
  validActivities: number;
  rank: number;
};
export type CommunityChampionshipStatus = {
  eventId: string;
  enrolled: boolean;
  participantCount?: number;
  championship?: {
    cycleKey: string;
    period?: CommunityRankingPeriod;
    gymId?: string;
    gymName: string;
    rank: number | null;
    score: number;
    validActivities: number;
    leaderboard?: CommunityLeaderboardEntry[];
    resultStatus: 'OPEN' | 'PROVISIONAL' | 'APPROVED' | 'REVIEW' | 'REJECTED';
    prizes: { 1: number; 2: number; 3: number; participation: number };
  };
};

async function call(method = 'GET', period: CommunityRankingPeriod = 'weekly', body?: unknown) {
  const user = auth.currentUser;
  if (!user) throw new Error('Usuário não autenticado.');
  const token = await user.getIdToken();
  const suffix = method === 'GET' ? `?period=${encodeURIComponent(period)}` : '';
  const response = await fetch(`/api/community-championship${suffix}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Não foi possível atualizar sua participação.');
  return result as CommunityChampionshipStatus;
}

export const communityChampionshipService = {
  status: (period: CommunityRankingPeriod = 'weekly') => call('GET', period),
  enroll: (hrAcknowledgement: CompetitiveHrAcknowledgementInput) => call('POST', 'weekly', { hrAcknowledgement }),
  withdraw: () => call('DELETE')
};
