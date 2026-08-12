import { Capacitor } from '@capacitor/core';
import { Health } from 'capacitor-health';
import type { WearableProvider, WearableActivity } from './types';

// Plugin real: pacote npm "capacitor-health" (mley/capacitor-health), que expõe
// uma API única para Apple HealthKit (iOS) e Google Health Connect (Android).
// Documentação: https://github.com/mley/capacitor-health

const READ_PERMISSIONS = ['READ_STEPS', 'READ_WORKOUTS', 'READ_CALORIES', 'READ_DISTANCE', 'READ_HEART_RATE'] as const;

function mapWorkoutType(hkType: string): string {
  if (!hkType) return 'Cardio';
  const typeStr = String(hkType).toLowerCase();
  if (typeStr.includes('running') || typeStr.includes('run') || typeStr.includes('corrida')) return 'Corrida';
  if (typeStr.includes('cycling') || typeStr.includes('bike') || typeStr.includes('pedalada')) return 'Bike';
  if (typeStr.includes('strength') || typeStr.includes('musculacao') || typeStr.includes('weight') || typeStr.includes('traditional_strength_training')) return 'Musculação';
  if (typeStr.includes('walking') || typeStr.includes('caminhada')) return 'Caminhada';
  return 'Cardio';
}

export class AppleHealthProvider implements WearableProvider {
  id = 'apple_health' as const;
  name = 'Apple HealthKit';
  description = 'Integração nativa com o Apple Health para iOS e Apple Watch.';

  private isSupportedPlatform(): boolean {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';
  }

  async isConnected(): Promise<boolean> {
    const saved = localStorage.getItem('wearable_conn_apple_health');
    return saved === 'true';
  }

  async requestPermissions(): Promise<boolean> {
    if (!this.isSupportedPlatform()) {
      console.warn('[AppleHealthProvider] Disponível apenas no app nativo iOS (via Xcode/App Store), não no navegador.');
      return false;
    }
    try {
      const { available } = await Health.isHealthAvailable();
      if (!available) {
        console.warn('[AppleHealthProvider] HealthKit não está disponível neste dispositivo.');
        return false;
      }
      const response = await Health.requestHealthPermissions({ permissions: [...READ_PERMISSIONS] as any });
      // iOS nunca informa com certeza se o usuário negou; assumimos concedido se a chamada não lançar erro.
      const granted = !!response;
      localStorage.setItem('wearable_conn_apple_health', granted ? 'true' : 'false');
      return granted;
    } catch (error) {
      console.error('[AppleHealthProvider] Erro ao solicitar permissões do HealthKit:', error);
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
      console.error('[AppleHealthProvider] Erro ao buscar atividades do HealthKit:', error);
      return [];
    }
  }

  async disconnect(): Promise<void> {
    localStorage.setItem('wearable_conn_apple_health', 'false');
  }

  private mapWorkout(w: any): WearableActivity {
    const heartRates: number[] = (w.heartRate || []).map((h: any) => h.bpm).filter((v: number) => !!v);
    const averageHeartRate = heartRates.length ? Math.round(heartRates.reduce((a, b) => a + b, 0) / heartRates.length) : undefined;
    const maxHeartRate = heartRates.length ? Math.max(...heartRates) : undefined;
    return {
      id: `apple_health_${w.id}`,
      userId: '',
      source: 'apple_health',
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
