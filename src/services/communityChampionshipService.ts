import { auth } from '../firebase';

async function call(method = 'GET') {
  const user = auth.currentUser;
  if (!user) throw new Error('Usuário não autenticado.');
  const token = await user.getIdToken();
  const response = await fetch('/api/community-championship', { method, headers: { Authorization: `Bearer ${token}` } });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Não foi possível atualizar sua participação.');
  return result as {
    eventId: string;
    enrolled: boolean;
    participantCount?: number;
    championship?: {
      cycleKey: string;
      gymName: string;
      rank: number | null;
      score: number;
      validActivities: number;
      resultStatus: 'OPEN' | 'PROVISIONAL' | 'APPROVED' | 'REVIEW' | 'REJECTED';
      prizes: { 1: number; 2: number; 3: number; participation: number };
    };
  };
}

export const communityChampionshipService = {
  status: () => call('GET'),
  enroll: () => call('POST'),
  withdraw: () => call('DELETE')
};
