import { Capacitor } from '@capacitor/core';
import { Health } from 'capacitor-health';
import type { WearableProvider, WearableActivity, WearableHeartRateSample } from './types';
import { normalizeHeartRateSamples, normalizeIsoTimestamp, normalizePositiveNumber } from './heartRateSamples';
import { auditSessionHeartRate, collectHeartRateFromWorkouts, type SessionHeartRateAudit } from './sessionHeartRateAudit';

// Plugin real: pacote npm "capacitor-health" (mley/capacitor-health), que expõe
// uma API única para Apple HealthKit (iOS) e Google Health Connect (Android).
// Documentação: https://github.com/mley/capacitor-health

const READ_PERMISSIONS = ['READ_STEPS', 'READ_WORKOUTS', 'READ_ACTIVE_CALORIES', 'READ_DISTANCE', 'READ_HEART_RATE', 'READ_ROUTE'] as const;

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
  if (!hcType) return 'Desconhecido';
  const typeStr = String(hcType).toLowerCase();
  if (typeStr.includes('running') || typeStr.includes('run') || typeStr.includes('corrida')) return 'Corrida';
  if (typeStr.includes('cycling') || typeStr.includes('bike') || typeStr.includes('pedalada')) return 'Bike';
  if (typeStr.includes('strength') || typeStr.includes('musculacao') || typeStr.includes('weight')) return 'Musculação';
  if (typeStr.includes('walking') || typeStr.includes('caminhada')) return 'Caminhada';
  if (typeStr.includes('swim') || typeStr.includes('natacao')) return 'Natação';
  if (typeStr.includes('elliptical') || typeStr.includes('eliptico')) return 'Elíptico';
  if (typeStr.includes('rowing') || typeStr.includes('remo')) return 'Remo';
  if (typeStr.includes('stair') || typeStr.includes('escada')) return 'Escada';
  if (typeStr.includes('crossfit') || typeStr.includes('functional')) return 'Treino funcional';
  return String(hcType).trim().slice(0, 120) || 'Desconhecido';
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
        includeRoute: true,
        includeSteps: true,
      });
      return (workouts || []).map((w) => this.mapWorkout(w));
    } catch (error) {
      console.error('[HealthConnectProvider] Erro ao buscar atividades do Health Connect:', error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    // Revogação é feita no Health Connect; aqui removemos apenas o vínculo visual.
  }

  async querySessionMetrics(startDate: Date, endDate: Date): Promise<{
    avgHeartRate?: number;
    maxHeartRate?: number;
    steps?: number;
    calories?: number;
    workoutFound?: boolean;
    heartRateSamples?: WearableHeartRateSample[];
    heartRateAudit?: SessionHeartRateAudit;
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

      const workoutList = workouts || [];
      const workoutFound = workoutList.length > 0;
      const audit = auditSessionHeartRate(
        collectHeartRateFromWorkouts(workoutList),
        startDate,
        endDate,
        'health_connect',
        workoutFound,
      );
      const allHr = audit.samples.map((sample) => sample.bpm);
      let totalSteps = 0;
      let totalCalories = 0;

      for (const w of workoutList) {
        if (typeof w.steps === 'number' && Number.isFinite(w.steps) && w.steps > 0) totalSteps += w.steps;
        if (typeof w.calories === 'number' && Number.isFinite(w.calories) && w.calories > 0) totalCalories += w.calories;
      }

      const avgHeartRate = allHr.length ? Math.round(allHr.reduce((a, b) => a + b, 0) / allHr.length) : undefined;
      const maxHeartRate = allHr.length ? Math.max(...allHr) : undefined;

      return {
        avgHeartRate,
        maxHeartRate,
        steps: totalSteps > 0 ? Math.round(totalSteps) : undefined,
        calories: totalCalories > 0 ? Math.round(totalCalories) : undefined,
        workoutFound,
        heartRateSamples: audit.samples.length > 0 ? audit.samples : undefined,
        heartRateAudit: audit,
      };
    } catch (err) {
      console.warn('[HealthConnectProvider] Erro ao consultar métricas da sessão:', err);
      return null;
    }
  }

  private mapWorkout(w: any): WearableActivity {
    const heartRateSamples = normalizeHeartRateSamples(w.heartRate);
    const heartRates = heartRateSamples.map((sample) => sample.bpm);
    const averageHeartRate = heartRates.length ? Math.round(heartRates.reduce((a, b) => a + b, 0) / heartRates.length) : undefined;
    const maxHeartRate = heartRates.length ? Math.max(...heartRates) : undefined;
    const checkpoints = Array.isArray(w.route) && w.route.length > 0
      ? w.route
          .filter((p: any) => typeof p?.lat === 'number' && typeof p?.lng === 'number')
          .map((p: any) => {
            const timestamp = normalizeIsoTimestamp(p.timestamp);
            return {
              latitude: p.lat,
              longitude: p.lng,
              ...(timestamp ? { timestamp } : {})
            };
          })
      : undefined;
    return {
      id: `health_connect_${w.id}`,
      userId: '',
      source: 'health_connect',
      sourceActivityId: w.id,
      activityType: mapWorkoutType(w.workoutType),
      isIndoorCardio: w.isIndoor === true || w.indoor === true
        || /indoor|treadmill|esteira/i.test(String(w.workoutType || '')),
      startTime: w.startDate,
      durationSeconds: Math.round(w.duration || 0),
      distanceMeters: w.distance || 0,
      calories: w.calories || 0,
      averageHeartRate,
      maxHeartRate,
      steps: normalizePositiveNumber(w.steps),
      heartRateSamples: heartRateSamples.length > 0 ? heartRateSamples : undefined,
      averageSpeed: 0,
      pace: '--',
      biometricValidated: !!averageHeartRate,
      pointsEarned: 0,
      createdAt: new Date().toISOString(),
      checkpoints: checkpoints && checkpoints.length > 0 ? checkpoints : undefined,
    };
  }
}
