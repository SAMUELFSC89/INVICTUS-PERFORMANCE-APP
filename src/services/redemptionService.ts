import { auth, db, handleFirestoreError, OperationType } from '../firebase';
import { collection, query, where, getDocs, orderBy } from 'firebase/firestore';
import { RedemptionRequest } from '../types';
import { API_CONFIG } from '../config';

export const redemptionService = {
  async requestRedemption(amount: number, pixKey: string, pixKeyType: RedemptionRequest['pixKeyType']) {
    const user = auth.currentUser;
    if (!user) throw new Error('Usuário não autenticado.');

    if (amount < 20) {
      throw new Error('O valor mínimo para resgate é R$ 20,00.');
    }

    // Generate unique requestId for idempotency and anti-fraud
    const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    const url = `${API_CONFIG.baseUrl}/api/wallet/redeem`;

    try {
      const token = await user.getIdToken();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      };

      const body = JSON.stringify({
        amount,
        pixKey,
        pixKeyType,
        requestId,
        deviceId: 'web_client_' + user.uid.substring(0, 6)
      });

      console.log(`[RedemptionService] Requesting redemption to backend: ${url}`);
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body
      }).catch(e => {
        console.error(`[RedemptionService] Fetch call failed (Network Error): ${url}`, e);
        throw new Error('Erro de conexão com o servidor. Verifique sua rede e tente novamente.');
      });

      const data = await response.json().catch(() => null);

      if (!response.ok || !data) {
        const errorMsg = data?.error || `Erro ao processar resgate (Status: ${response.status})`;
        throw new Error(errorMsg);
      }

      if (data.success) {
        return `red_req_${requestId}`;
      }

      throw new Error(data.error || 'Não foi possível completar a transação.');
    } catch (error) {
      // Re-throw to make sure errors are handled by page callers
      throw error;
    }
  },

  async getRedemptionHistory() {
    const user = auth.currentUser;
    if (!user) return [];

    const q = query(
      collection(db, 'redemptions'),
      where('userId', '==', user.uid),
      orderBy('createdAt', 'desc')
    );

    try {
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ id: d.id, ...d.data() } as RedemptionRequest));
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, 'redemptions');
      return [];
    }
  }
};

