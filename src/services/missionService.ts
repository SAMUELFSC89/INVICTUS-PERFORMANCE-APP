import { auth } from '../firebase';
import type { Mission, RewardCoinWallet, UserMissionProgress } from '../types';

export type MissionDashboard = {
  missions: Mission[];
  userProgress: UserMissionProgress[];
  coinWallet: RewardCoinWallet;
};

async function request(method: 'GET' | 'POST', body?: Record<string, unknown>): Promise<any> {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Sessão inválida ou expirada.');
  const response = await fetch(`/api/missions${method === 'POST' ? '?action=claim' : ''}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  if (!response.ok || !data.success) throw new Error(data.error || 'Não foi possível carregar os desafios.');
  return data;
}

export const missionService = {
  async dashboard(): Promise<MissionDashboard> {
    const data = await request('GET');
    return {
      missions: Array.isArray(data.missions) ? data.missions : [],
      userProgress: Array.isArray(data.userProgress) ? data.userProgress : [],
      coinWallet: data.coinWallet || { userId: auth.currentUser?.uid || '', balance: 0, lifetimeEarned: 0, lifetimeSpent: 0, updatedAt: new Date().toISOString() },
    };
  },
  claim(missionId: string) { return request('POST', { missionId }); },
};
