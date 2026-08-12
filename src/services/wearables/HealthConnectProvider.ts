import { Capacitor } from '@capacitor/core';
import { Health } from 'capacitor-health';
import type { WearableProvider, WearableActivity } from './types';

// Plugin real: pacote npm "capacitor-health" (mley/capacitor-health), que expõe
// uma API única para Apple HealthKit (iOS) e Google Health Connect (Android).
// Documentação: https://github.com/mley/capacitor-health

const READ_PERMISSIONS = ['READ_STEPS', 'READ_WORKOUTS', 'READ_CALORIES', 'READ_DISTANCE', 'READ_HEART_RATE'] as const;

function mapWorkoutType(hcType: string): string {
  if (!hcType) return 'Cardio';
  const typeStr = String(hcType).toLowerCase();
  if (typeStr.includes('running') || typeStr.includes('run') || typeStr.includes('corrida')) return 'Corrida';
  if (typeStr.includes('cycling') || typeStr.includes('bike') || typeStr.includes('pedalada')) return 'Bike';
  if (typeStr.includes('strength') || typeStr.includes('musculacao') || typeStr.includes('weight')) return 'Musculação';
  if (typeStr.includes('walking') || typeStr.includes('caminhada')) return 'Caminhada';
  return 'Cardio';
}

export class HealthConnectProvider implements WearableProvider {
  id = 'health_connect' as const;
  name = 'Android Health Connect';
  description = 'Integração nativa com a API de saúde do ecossistema Google/Android.';

  private isSupportedPlatform(): boolean {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
  }

  async isConnected(): Promise<boolean> {
    const saved = localStorage.getItem('wearable_conn_health_connect');
    return saved === 'true';
  }

  async requestPermissions(): Promise<boolean> {
    if (!this.isSupportedPlatform()) {
      console.warn('[HealthConnectProvider] Disponível apenas no app nativo Android, não no navegador.');
      return false;
    }
    try {
      const { available } = await Health.isHealthAvailable();
      if (!available) {
        console.warn('[HealthConnectProvider] Health Connect não está instalado neste dispositivo. Chame showHealthConnectInPlayStore().');
        return false;
      }
      const response = await Health.requestHealthPermissions({ permissions: [...READ_PERMISSIONS] as any });
      const granted = (response?.permissions || []).some((p: any) => Object.values(p).some(Boolean));
      localStorage.setItem('wearable_conn_health_connect', granted ? 'true' : 'false');
      return granted;
    } catch (error) {
      console.error('[HealthConnectProvider] Erro ao solicitar permissões do Health Connect:', error);
      return false;
    }
  }

  async fetchActivities(since: Date): Promise<WearableActivity[]> {
    if (!this.isSupportedPlatform()) return [];
    try {
      const { workouts } = await Health.queryWorkouts({
        startDate: since.toISOString(),
        endDate: new Date().toISOString(),
        includeHeartRate: true,
        includeRoute: false,
        includeSteps: false,
      });
      return (workouts || []).map((w) => this.mapWorkout(w));
    } catch (error) {
      console.error('[HealthConnectProvider] Erro ao buscar atividades do Health Connect:', error);
      return [];
    }
  }

  async disconnect(): Promise<void> {
    localStorage.setItem('wearable_conn_health_connect', 'false');
  }

  private mapWorkout(w: any): WearableActivity {
    const heartRates: number[] = (w.heartRate || []).map((h: any) => h.bpm).filter((v: number) => !!v);
    const averageHeartRate = heartRates.length ? Math.round(heartRates.reduce((a, b) => a + b, 0) / heartRates.length) : undefined;
    const maxHeartRate = heartRates.length ? Math.max(...heartRates) : undefined;
    return {
      id: `health_connect_${w.id}`,
      userId: '',
      source: 'health_connect',
      sourceActivityId: w.id,
      activityType: mapWorkoutType(w.workoutType),
      startTime: w.startDate,
      durationSeconds: Math.round(w.duration || 0),
      distanceMeters: w.distance || 0,
      calories: w.calories || 0,
      averageHeartRate,
      maxHeartRate,
      steps: w.steps || 0,
      averageSpeed: 0,
      pace: '--',
      biometricValidated: !!averageHeartRate,
      pointsEarned: 0,
      createdAt: new Date().toISOString(),
    };
  }
}
