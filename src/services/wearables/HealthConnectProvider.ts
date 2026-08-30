import { Capacitor } from '@capacitor/core';
import { Health } from 'capacitor-health';
import type { WearableProvider, WearableActivity } from './types';

// Plugin real: pacote npm "capacitor-health" (mley/capacitor-health), que expõe
// uma API única para Apple HealthKit (iOS) e Google Health Connect (Android).
// Documentação: https://github.com/mley/capacitor-health

// #248: READ_ROUTE entra pra ingestao real -- sem ela nenhuma corrida do
// Android/Health Connect tem coordenada, e o antifraude trata toda corrida
// como "sem GPS" (perfil CARDIO exige evidencia de deslocamento).
const READ_PERMISSIONS = ['READ_STEPS', 'READ_WORKOUTS', 'READ_ACTIVE_CALORIES', 'READ_DISTANCE', 'READ_HEART_RATE', 'READ_ROUTE'] as const;

/**
 * A tipagem publicada por `capacitor-health` declara `permissions` como
 * array, mas a implementação Kotlin 8.x devolve um JSObject indexado pelo
 * nome da permissão. Aceitamos ambos para não marcar a integração como
 * desconectada depois de o usuário autorizar tudo no Android.
 */
export function hasAllReadPermissions(response: any): boolean {
  const granted = response?.permissions;
  if (Array.isArray(granted)) {
    return READ_PERMISSIONS.every((permission) =>
      granted.some((entry: Record<string, boolean>) => entry?.[permission] === true)
    );
  }
  if (granted && typeof granted === 'object') {
    return READ_PERMISSIONS.every((permission) => granted[permission] === true);
  }
  return false;
}

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
    if (!this.isSupportedPlatform()) return false;
    try {
      const { available } = await Health.isHealthAvailable();
      if (!available) return false;
      // No Android o plugin permite consultar os grants reais. Não usamos
      // localStorage como prova de que o usuário ainda autorizou a leitura.
      const response = await Health.checkHealthPermissions({ permissions: [...READ_PERMISSIONS] as any });
      return hasAllReadPermissions(response);
    } catch (error) {
      console.warn('[HealthConnectProvider] Não foi possível consultar permissões atuais:', error);
      return false;
    }
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
      return hasAllReadPermissions(response);
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
        // #248: precisa da rota real pra corrida/caminhada/bike passarem na
        // checagem de GPS do antifraude -- sem isso toda atividade de cardio
        // caia em "sem evidencia de deslocamento".
        includeRoute: true,
        includeSteps: false,
      });
      return (workouts || []).map((w) => this.mapWorkout(w));
    } catch (error) {
      console.error('[HealthConnectProvider] Erro ao buscar atividades do Health Connect:', error);
      return [];
    }
  }

  async disconnect(): Promise<void> {
    // Health Connect não permite revogar o consentimento pelo app. O vínculo
    // visual é removido na configuração autenticada; o usuário pode revogar
    // as permissões no próprio Health Connect.
  }

  async querySessionMetrics(startDate: Date, endDate: Date): Promise<{
    avgHeartRate?: number;
    maxHeartRate?: number;
    steps?: number;
    calories?: number;
    workoutFound?: boolean;
  } | null> {
    if (!this.isSupportedPlatform()) return null;
    try {
      const { workouts } = await Health.queryWorkouts({
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        includeHeartRate: true,
        includeRoute: false,
        includeSteps: true,
      });

      const allHr: number[] = [];
      let totalSteps = 0;
      let totalCalories = 0;
      let workoutFound = false;

      if (workouts && workouts.length > 0) {
        workoutFound = true;
        for (const w of workouts) {
          if (Array.isArray(w.heartRate)) {
            for (const hr of w.heartRate) {
              if (hr && typeof hr.bpm === 'number' && hr.bpm >= 35 && hr.bpm <= 230) {
                allHr.push(hr.bpm);
              }
            }
          }
          if (typeof w.steps === 'number' && Number.isFinite(w.steps) && w.steps > 0) {
            totalSteps += w.steps;
          }
          if (typeof w.calories === 'number' && Number.isFinite(w.calories) && w.calories > 0) {
            totalCalories += w.calories;
          }
        }
      }

      const avgHeartRate = allHr.length ? Math.round(allHr.reduce((a, b) => a + b, 0) / allHr.length) : undefined;
      const maxHeartRate = allHr.length ? Math.max(...allHr) : undefined;

      return {
        avgHeartRate,
        maxHeartRate,
        steps: totalSteps > 0 ? Math.round(totalSteps) : undefined,
        calories: totalCalories > 0 ? Math.round(totalCalories) : undefined,
        workoutFound
      };
    } catch (err) {
      console.warn('[HealthConnectProvider] Erro ao consultar métricas da sessão:', err);
      return null;
    }
  }

  private mapWorkout(w: any): WearableActivity {
    const heartRates: number[] = (w.heartRate || []).map((h: any) => h.bpm).filter((v: number) => !!v);
    const averageHeartRate = heartRates.length ? Math.round(heartRates.reduce((a, b) => a + b, 0) / heartRates.length) : undefined;
    const maxHeartRate = heartRates.length ? Math.max(...heartRates) : undefined;
    // #248: RouteSample vem como {timestamp, lat, lng, alt} -- convertido pro
    // formato latitude/longitude que o antifraude (validation-engine,
    // integrity-engine) ja espera em `activity.checkpoints`.
    const checkpoints = Array.isArray(w.route) && w.route.length > 0
      ? w.route
          .filter((p: any) => typeof p?.lat === 'number' && typeof p?.lng === 'number')
          .map((p: any) => ({ latitude: p.lat, longitude: p.lng }))
      : undefined;
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
      checkpoints: checkpoints && checkpoints.length > 0 ? checkpoints : undefined,
    };
  }
}
