import { Capacitor } from '@capacitor/core';
import { auth, onAuthStateChanged } from '../firebase';
import { API_CONFIG } from '../config';

const getApiBase = () => {
  const base = API_CONFIG.baseUrl || '';
  return `${base}/api/strava`;
};

export interface StravaStatus {
  connected: boolean;
  lastSync: string | null;
  athleteId: string | null;
}

// Cache for Strava status to reduce backend Firestore reads
let statusCache: { data: StravaStatus, timestamp: number } | null = null;
const STATUS_CACHE_TTL = 120000; // 2 minutes cache to prevent rate limit issues

export const stravaService = {
  async getAuthUser(): Promise<any> {
    if (auth.currentUser) return auth.currentUser;
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        unsubscribe();
        reject(new Error('Not authenticated'));
      }, 3000);
      
      const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
        clearTimeout(timeout);
        unsubscribe();
        if (firebaseUser) {
          resolve(firebaseUser);
        } else {
          reject(new Error('Not authenticated'));
        }
      });
    });
  },

  async getStatus(forceRefresh?: boolean): Promise<StravaStatus> {
    if (!forceRefresh && statusCache && Date.now() - statusCache.timestamp < STATUS_CACHE_TTL) {
      return statusCache.data;
    }

    try {
      const user = await this.getAuthUser();
      const idToken = await user.getIdToken();
      const url = `${getApiBase()}/status`;
      const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${idToken}` }
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        console.warn('[stravaService] Status fetch warning:', res.status, errText);
        if (statusCache) {
          return statusCache.data;
        }
        return { connected: false, lastSync: null, athleteId: null };
      }
      
      const data = await res.json();
      statusCache = { data, timestamp: Date.now() };
      return data;
    } catch (error: any) {
      console.warn('[stravaService] getStatus fallback:', error?.message || error);
      if (statusCache) {
        return statusCache.data;
      }
      return { connected: false, lastSync: null, athleteId: null };
    }
  },

  async authorize(returnPath: string = '/profile'): Promise<string> {
    const user = await this.getAuthUser();

    const idToken = await user.getIdToken();
    // #250: avisa o backend se é o app nativo -- ele usa isso pra decidir se
    // o /callback devolve o controle por deep link (invictus://) ou por
    // redirect HTTPS normal (ver ProfileSecondary.connectProvider).
    const platform = Capacitor.isNativePlatform() ? 'native' : 'web';
    const url = `${getApiBase()}/auth?returnPath=${encodeURIComponent(returnPath)}&platform=${platform}`;
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${idToken}` }
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => 'No details available');
      console.error('[stravaService] Authorization failed:', res.status, errText);
      let errMsg = errText;
      try {
        const parsed = JSON.parse(errText);
        if (parsed.error) errMsg = parsed.error;
      } catch (e) {}
      throw new Error(`Failed to start Strava authorization: ${errMsg}`);
    }
    const data = await res.json();
    return data.url;
  },

  async handleCallback(code: string, state: string): Promise<void> {
    const url = `${getApiBase()}/callback?code=${code}&state=${state}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to complete Strava connection');
  },

  async sync(): Promise<{ syncCount: number }> {
    const user = await this.getAuthUser();

    const idToken = await user.getIdToken();
    const url = `${getApiBase()}/sync`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${idToken}` }
    });

    if (!res.ok) {
      let errMsg = 'Falha ao sincronizar atividades do Strava.';
      try {
        const data = await res.json();
        if (data.error) errMsg = data.error;
      } catch (e) {}
      throw new Error(errMsg);
    }
    return res.json();
  },

  async disconnect(): Promise<void> {
    const user = await this.getAuthUser();

    const idToken = await user.getIdToken();
    const url = `${getApiBase()}/disconnect`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${idToken}` }
    });

    if (!res.ok) throw new Error('Failed to disconnect Strava');
  }
};
