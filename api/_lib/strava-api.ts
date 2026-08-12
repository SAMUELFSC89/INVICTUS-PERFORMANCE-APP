import { db, FieldValue } from './common.js';

const STRAVA_CLIENT_ID = process.env.STRAVA_CLIENT_ID;
const STRAVA_CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET;

export interface StravaTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export class StravaApi {
  constructor(private userId: string) {}

  async getConnection() {
    const snap = await db.collection('strava_connections').doc(this.userId).get();
    return snap.exists ? snap.data() : null;
  }

  async saveConnection(data: any) {
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

  async deleteConnection() {
    const conn = await this.getConnection();
    if (conn?.athleteId) {
      await db.collection('strava_athletes').doc(conn.athleteId.toString()).delete();
    }
    await db.collection('strava_connections').doc(this.userId).delete();
    await db.collection('users').doc(this.userId).update({
      strava_connected: false,
      strava_athlete_id: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp()
    });

    // Update wearable configs in Firestore
    await db.collection('wearable_configs').doc(this.userId).set({
      stravaConnected: false,
      updatedAt: new Date().toISOString()
    }, { merge: true }).catch((err: any) => console.warn('[StravaApi] Failed to update wearable_configs in disconnect:', err));
  }

  async getAccessToken(): Promise<string | null> {
    const conn = await this.getConnection();
    if (!conn) return null;

    console.log("===== TOKEN INFO =====");
    console.log({
        accessTokenExists: !!conn?.accessToken,
        refreshTokenExists: !!conn?.refreshToken,
        expiresAt: conn?.expiresAt,
        now: Math.floor(Date.now()/1000),
        expired:
            conn?.expiresAt <
            Math.floor(Date.now()/1000)
    });

    const now = Math.floor(Date.now() / 1000);
    if (conn.expiresAt > now + 300) { // 5 min buffer
      return conn.accessToken;
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
      const err = await response.text();
      console.error(`[StravaApi] Token refresh failed: ${err}`);
      
      // If token refresh fails due to invalid/revoked refresh token (HTTP 400 Bad Request, 401, or 403)
      if (response.status === 400 || response.status === 401 || response.status === 403 || err.includes('invalid') || err.includes('RefreshToken')) {
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
    console.log("===== REFRESH RESPONSE =====");
    console.log(JSON.stringify(data, null, 2));

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

    const maskedToken = token ? `${token.slice(0, 10)}...${token.slice(-5)}` : 'null';
    console.log(`[StravaApi] GET ${url.toString()} with Authorization: Bearer ${maskedToken}`);

    const response = await fetch(url.toString(), {
        headers: {
            Authorization: `Bearer ${token}`
        }
    });

    const body = await response.text();

    console.log("===== STRAVA ACTIVITIES =====");
    console.log("STATUS:", response.status);
    console.log("BODY:", body);

    if (response.status === 401 || response.status === 403) {
      console.error("===== STRAVA API ERROR =====");
      console.error("URL:", url.toString());
      console.error("STATUS:", response.status);
      console.error("HEADERS:", JSON.stringify(Array.from(response.headers.entries())));
      console.error("BODY:", body);
    }

    if (!response.ok) {
        throw new Error(
            `Status ${response.status}: ${body}`
        );
    }

    return JSON.parse(body);
  }

  async fetchActivity(activityId: string | number) {
    const token = await this.getAccessToken();
    if (!token) throw new Error('Not connected to Strava');

    const url = `https://www.strava.com/api/v3/activities/${activityId}`;
    const maskedToken = token ? `${token.slice(0, 10)}...${token.slice(-5)}` : 'null';
    console.log(`[StravaApi] GET ${url} with Authorization: Bearer ${maskedToken}`);

    const response = await fetch(url, {
        headers: {
            Authorization: `Bearer ${token}`
        }
    });

    const body = await response.text();

    console.log("===== STRAVA ACTIVITY =====");
    console.log("STATUS:", response.status);
    console.log("BODY:", body);

    if (response.status === 401 || response.status === 403) {
      console.error("===== STRAVA API ERROR =====");
      console.error("URL:", url);
      console.error("STATUS:", response.status);
      console.error("HEADERS:", JSON.stringify(Array.from(response.headers.entries())));
      console.error("BODY:", body);
    }

    if (!response.ok) {
        throw new Error(
            `Status ${response.status}: ${body}`
        );
    }

    return JSON.parse(body);
  }
}
