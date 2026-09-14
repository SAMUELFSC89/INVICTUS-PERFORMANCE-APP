import { db, FieldValue } from './common.js';
import { isActiveAccountState, isDeletedAccountState } from './account-state.js';

const STRAVA_CLIENT_ID = process.env.STRAVA_CLIENT_ID;
const STRAVA_CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET;

export interface StravaTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export class StravaApi {
  constructor(private userId: string) {}

  private async getRawConnection() {
    try {
      const snap = await db.collection('strava_connections').doc(this.userId).get();
      return snap.exists ? snap.data() : null;
    } catch (err: any) {
      console.warn('[StravaApi] Falha ao ler conexão do Strava:', err?.message || err);
      return null;
    }
  }

  async getConnection() {
    try {
      const [profileSnap, connection] = await Promise.all([
        db.collection('users').doc(this.userId).get(),
        this.getRawConnection(),
      ]);
      const profile = profileSnap.exists ? profileSnap.data() : null;

      // Conta excluída não pode continuar sendo alimentada por webhook tardio.
      // Fazemos cleanup local best-effort aqui como segunda barreira; o fluxo
      // explícito de exclusão também chama deleteConnection/deauthorization.
      if (!profileSnap.exists || isDeletedAccountState(profile)) {
        if (connection) {
          const batch = db.batch();
          batch.delete(db.collection('strava_connections').doc(this.userId));
          if (connection.athleteId) batch.delete(db.collection('strava_athletes').doc(String(connection.athleteId)));
          batch.set(db.collection('wearable_configs').doc(this.userId), {
            stravaConnected: false,
            updatedAt: new Date().toISOString(),
          }, { merge: true });
          await batch.commit().catch((error: any) => console.warn('[StravaApi] Cleanup de conta excluída falhou:', error?.message || error));
        }
        return null;
      }

      // Bloqueio/suspensão interrompe importação sem destruir o vínculo caso a
      // restrição seja revertida administrativamente.
      if (!isActiveAccountState(profile)) return null;
      return connection;
    } catch (err: any) {
      console.warn('[StravaApi] Falha ao validar conexão do Strava:', err?.message || err);
      return null;
    }
  }

  async saveConnection(data: any) {
    if (!data?.athlete?.id || typeof data.access_token !== 'string' || typeof data.refresh_token !== 'string' || !Number.isFinite(Number(data.expires_at))) {
      throw new Error('Resposta de autorização do Strava inválida.');
    }

    const profileSnap = await db.collection('users').doc(this.userId).get();
    if (!profileSnap.exists || !isActiveAccountState(profileSnap.data())) {
      throw new Error('Conta inativa não pode conectar o Strava.');
    }

    const connectionData = {
      userId: this.userId,
      athleteId: data.athlete.id,
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: data.expires_at,
      scope: data.scope || 'read,activity:read_all',
      createdAt: FieldValue.serverTimestamp(),
      lastSyncAt: null
    };

    await db.collection('strava_connections').doc(this.userId).set(connectionData);

    // Reverse mapping for webhooks
    await db.collection('strava_athletes').doc(data.athlete.id.toString()).set({
      userId: this.userId,
      updatedAt: FieldValue.serverTimestamp()
    });

    // Update user profile
    await db.collection('users').doc(this.userId).update({
      strava_connected: true,
      strava_athlete_id: data.athlete.id.toString(),
      updatedAt: FieldValue.serverTimestamp()
    });

    // Update wearable configs in Firestore
    await db.collection('wearable_configs').doc(this.userId).set({
      stravaConnected: true,
      updatedAt: new Date().toISOString()
    }, { merge: true }).catch((err: any) => console.warn('[StravaApi] Failed to update wearable_configs:', err));

    return connectionData;
  }

  private async revokeProviderTokenBestEffort(connection: any) {
    const token = typeof connection?.refreshToken === 'string' && connection.refreshToken
      ? connection.refreshToken
      : typeof connection?.accessToken === 'string' ? connection.accessToken : '';
    if (!token || !STRAVA_CLIENT_ID || !STRAVA_CLIENT_SECRET) return;

    try {
      const basic = Buffer.from(`${STRAVA_CLIENT_ID}:${STRAVA_CLIENT_SECRET}`).toString('base64');
      const body = new URLSearchParams({ token });
      if (token === connection.refreshToken) body.set('token_type_hint', 'refresh_token');
      const response = await fetch('https://www.strava.com/oauth/revoke', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basic}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      });
      if (!response.ok) {
        console.warn(`[StravaApi] Revogação remota retornou HTTP ${response.status}; cleanup local continuará.`);
      }
    } catch (error: any) {
      console.warn('[StravaApi] Revogação remota indisponível; cleanup local continuará:', error?.message || error);
    }
  }

  async deleteConnection() {
    const conn = await this.getRawConnection();
    if (conn) await this.revokeProviderTokenBestEffort(conn);

    const batch = db.batch();
    if (conn?.athleteId) {
      batch.delete(db.collection('strava_athletes').doc(conn.athleteId.toString()));
    }
    batch.delete(db.collection('strava_connections').doc(this.userId));
    batch.set(db.collection('wearable_configs').doc(this.userId), {
      stravaConnected: false,
      updatedAt: new Date().toISOString()
    }, { merge: true });
    await batch.commit();

    const profileRef = db.collection('users').doc(this.userId);
    const profile = await profileRef.get();
    if (profile.exists) {
      await profileRef.update({
        strava_connected: false,
        strava_athlete_id: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp()
      });
    }
  }

  async getAccessToken(): Promise<string | null> {
    const conn = await this.getConnection();
    if (!conn) return null;

    const now = Math.floor(Date.now() / 1000);
    const expiresAt = Number(conn.expiresAt);
    if (typeof conn.accessToken === 'string' && Number.isFinite(expiresAt) && expiresAt > now + 300) { // 5 min buffer
      return conn.accessToken;
    }

    if (!STRAVA_CLIENT_ID || !STRAVA_CLIENT_SECRET || typeof conn.refreshToken !== 'string') {
      console.error('[StravaApi] Configuração ou conexão de renovação inválida.');
      return null;
    }

    // Refresh token
    console.log(`[StravaApi] Refreshing token for ${this.userId}`);
    const response = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: STRAVA_CLIENT_ID,
        client_secret: STRAVA_CLIENT_SECRET,
        refresh_token: conn.refreshToken,
        grant_type: 'refresh_token'
      })
    });

    if (!response.ok) {
      console.error(`[StravaApi] Token refresh failed with status ${response.status}.`);

      // If token refresh fails due to invalid/revoked refresh token (HTTP 400 Bad Request, 401, or 403)
      if (response.status === 400 || response.status === 401 || response.status === 403) {
        console.warn(`[StravaApi] Refresh token invalid or revoked for user ${this.userId}. Cleaning up stale connection.`);
        try {
          await this.deleteConnection();
        } catch (delErr) {
          console.error('[StravaApi] Error deleting stale connection during refresh failure:', delErr);
        }
      }

      return null;
    }

    const data = await response.json();
    if (typeof data?.access_token !== 'string' || typeof data?.refresh_token !== 'string' || !Number.isFinite(Number(data?.expires_at))) {
      console.error('[StravaApi] A renovação retornou um formato de token inválido.');
      return null;
    }

    const updates = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: data.expires_at,
      updatedAt: FieldValue.serverTimestamp()
    };

    await db.collection('strava_connections').doc(this.userId).update(updates);
    return data.access_token;
  }

  async fetchActivities(after?: number) {
    const token = await this.getAccessToken();
    if (!token) throw new Error('Not connected to Strava');

    const url = new URL('https://www.strava.com/api/v3/athlete/activities');
    if (after) url.searchParams.append('after', after.toString());
    url.searchParams.append('per_page', '50');

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    if (!response.ok) {
      throw new Error(`Strava activities request failed (${response.status}).`);
    }

    const activities = await response.json();
    return Array.isArray(activities) ? activities : [];
  }

  async fetchActivity(activityId: string | number) {
    const token = await this.getAccessToken();
    if (!token) throw new Error('Not connected to Strava');

    const url = `https://www.strava.com/api/v3/activities/${activityId}`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    if (!response.ok) {
      throw new Error(`Strava activity request failed (${response.status}).`);
    }

    return response.json();
  }
}
