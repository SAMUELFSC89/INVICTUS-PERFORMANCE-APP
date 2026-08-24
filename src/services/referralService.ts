import { auth } from '../firebase';
import { Referral, UserProfile } from '../types';

async function authenticatedProfileRequest(action: 'resolve-referral' | 'create-referral', body: Record<string, unknown>) {
  const user = auth.currentUser;
  if (!user) throw new Error('Faça login novamente para concluir a indicação.');

  const token = await user.getIdToken();
  const response = await fetch(`/api/profile?action=${action}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Não foi possível processar a indicação.');
  return payload;
}

/**
 * Indicações são criadas e pontuadas exclusivamente no servidor. Isso impede
 * que um cliente leia perfis alheios ou conceda pontos para si/terceiros.
 */
export const referralService = {
  generateReferralCode(uid: string): string {
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `${uid.substring(0, 4).toUpperCase()}-${random}`;
  },

  async getReferrerByCode(code: string): Promise<UserProfile | null> {
    const referralCode = code.trim().toUpperCase();
    if (!referralCode) return null;
    try {
      const payload = await authenticatedProfileRequest('resolve-referral', { referralCode });
      return payload.referrer ? ({ ...payload.referrer } as UserProfile) : null;
    } catch (error) {
      console.warn('[Referral] Não foi possível resolver código de indicação:', error);
      return null;
    }
  },

  async createReferral(referralCode: string) {
    const normalizedCode = referralCode.trim().toUpperCase();
    if (!normalizedCode) return null;
    return authenticatedProfileRequest('create-referral', { referralCode: normalizedCode });
  },

  // A aprovação, os critérios e qualquer crédito de score são responsabilidade
  // de job/endpoint administrativo no servidor, nunca do aplicativo cliente.
  async validateReferral(_referralId: string) {
    throw new Error('A validação de indicação é processada somente pelo servidor.');
  },

  async checkMinWorkouts(_userId: string, _min: number): Promise<boolean> {
    return false;
  },

  async getMyReferrals(): Promise<Referral[]> {
    // Não há endpoint de leitura de indicações nesta revisão. Retornamos um
    // estado vazio em vez de consultar referências de outros usuários.
    return [];
  }
};
