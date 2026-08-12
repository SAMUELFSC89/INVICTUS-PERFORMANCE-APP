import { WearableProvider, WearableActivity } from './types';
import { stravaService } from '../stravaService';
import { auth, db } from '../../firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';

export class StravaProvider implements WearableProvider {
  id = 'strava' as const;
  name = 'Strava Link';
  description = 'Sincroniza automaticamente treinos de relógios Garmin, Polar, Suunto, Amazfit, COROS e Fitbit conectados ao seu Strava.';

  async isConnected(): Promise<boolean> {
    try {
      const status = await stravaService.getStatus();
      return status.connected;
    } catch (e) {
      // Fallback local storage connection state for robust testing
      return localStorage.getItem('wearable_conn_strava') === 'true';
    }
  }

  async requestPermissions(): Promise<boolean> {
    try {
      console.log('[StravaProvider] Redirecting to Strava authorize...');
      const url = await stravaService.authorize();
      if (url) {
        // Handle iframe vs top-level window context
        try {
          if (window.self !== window.top) {
            // Inside an iframe (e.g., Google AI Studio preview)
            try {
              window.top.location.href = url;
            } catch (iframeErr) {
              // Cross-origin iframe security error, fallback to opening a new tab
              window.open(url, '_blank');
            }
          } else {
            // Top-level window (e.g., custom domain outside Google AI Studio)
            window.location.href = url;
          }
        } catch (e) {
          window.location.href = url;
        }
      }
      // Return false to prevent WearableManager from immediately triggering a fake 'connected' state.
      // The authentic connection state will be resolved when the user returns via OAuth callback.
      return false;
    } catch (e) {
      console.error('[StravaProvider] Authorization failed:', e);
      throw e;
    }
  }

  async fetchActivities(since: Date): Promise<WearableActivity[]> {
    const user = auth.currentUser;
    if (!user) throw new Error('Usuário não autenticado');

    const connected = await this.isConnected();
    if (!connected) throw new Error('Strava não conectado.');

    // 1. Trigger backend real Strava API sync first
    try {
      console.log('[StravaProvider] Triggering backend Strava sync...');
      await stravaService.sync();
    } catch (err) {
      console.warn('[StravaProvider] Backend sync failed, attempting to read existing activities:', err);
    }

    // 2. Fetch authentic activities from Firestore 'strava_activities' collection
    // Querying with only userId avoids the requirement for a composite index with startDate
    const q = query(
      collection(db, 'strava_activities'),
      where('userId', '==', user.uid)
    );

    const querySnapshot = await getDocs(q);
    const activities: WearableActivity[] = [];
    const sinceTime = since.getTime();

    querySnapshot.forEach(doc => {
      const data = doc.data();
      
      // Filter by date in memory to bypass composite index requirement
      const actDateStr = data.startDate;
      if (!actDateStr) return;
      const actTime = new Date(actDateStr).getTime();
      if (actTime < sinceTime) return;

      const avgHR = data.average_heartrate || 140; 
      const maxHR = data.max_heartrate || 160;
      
      const durationSeconds = data.movingTime || 0;
      const distanceMeters = data.distance || 0;
      
      let pace = '00:00';
      if (distanceMeters > 0 && durationSeconds > 0) {
        const minPerKm = (durationSeconds / 60) / (distanceMeters / 1000);
        const mins = Math.floor(minPerKm);
        const secs = Math.round((minPerKm - mins) * 60);
        pace = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
      }

      // Estimate calories: ~70 kcal per km
      const calories = Math.round((distanceMeters / 1000) * 70) || 100;

      activities.push({
        id: `st_sync_${data.id}_${user.uid}`,
        userId: user.uid,
        source: 'strava',
        sourceActivityId: data.id,
        activityType: data.type === 'Run' || data.type === 'TrailRun' ? 'Corrida' : (data.type === 'Ride' ? 'Bike' : data.type),
        startTime: data.startDate,
        durationSeconds: durationSeconds,
        distanceMeters: distanceMeters,
        calories: calories,
        averageHeartRate: avgHR,
        maxHeartRate: maxHR,
        steps: 0, 
        averageSpeed: data.averageSpeed || 0,
        pace: pace,
        biometricValidated: data.status === 'VALID',
        pointsEarned: 0,
        createdAt: new Date().toISOString()
      });
    });

    return activities;
  }

  async disconnect(): Promise<void> {
    try {
      await stravaService.disconnect();
    } catch (e) {
      console.warn('[StravaProvider] Local disconnect fallback');
    }
    localStorage.removeItem('wearable_conn_strava');
  }
}
