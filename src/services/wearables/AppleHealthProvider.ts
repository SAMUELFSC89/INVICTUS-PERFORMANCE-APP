import { Capacitor } from '@capacitor/core';
import { Health } from 'capacitor-health';
import type { WearableProvider, WearableActivity } from './types';
import { normalizeHeartRateSamples, normalizeIsoTimestamp, normalizePositiveNumber } from './heartRateSamples';

// Plugin real: pacote npm "capacitor-health" (mley/capacitor-health), que expõe
// uma API única para Apple HealthKit (iOS) e Google Health Connect (Android).
// Documentação: https://github.com/mley/capacitor-health

// #248: READ_ROUTE entra pra ingestao real -- sem ela nenhuma corrida do
// Apple Watch tem coordenada, e o antifraude trata toda corrida como "sem
// GPS" (perfil CARDIO exige evidencia de deslocamento).
const READ_PERMISSIONS = ['READ_STEPS', 'READ_WORKOUTS', 'READ_ACTIVE_CALORIES', 'READ_DISTANCE', 'READ_HEART_RATE', 'READ_ROUTE'] as const;

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
  // O HealthKit não expõe concessão de leitura de forma confiável. Mantemos
  // apenas o consentimento desta instância e uma leitura bem-sucedida, nunca
  // um valor persistido em localStorage como se fosse uma permissão real.
  private consentRequestedInSession = false;
  private hasSuccessfulRead = false;

  private isSupportedPlatform(): boolean {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';
  }

  async isConnected(): Promise<boolean> {
    if (!this.isSupportedPlatform()) return false;
    return this.hasSuccessfulRead || this.consentRequestedInSession;
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
      // iOS nunca informa com certeza se o usuário negou leitura. Este sinal
      // representa apenas o consentimento/configuração da sessão; uma falha
      // de leitura abaixo volta a exigir reconexão, sem alegar acesso real.
      const granted = !!response;
      this.consentRequestedInSession = granted;
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
        // #248: precisa da rota real pra corrida/caminhada/bike passarem na
        // checagem de GPS do antifraude -- sem isso toda atividade de cardio
        // caia em "sem evidencia de deslocamento".
        includeRoute: true,
        // Os passos já existem no HKWorkout. Sem esta flag o app Saúde mostra
        // passos que nunca chegam ao Invictus.
        includeSteps: true,
      });
      this.hasSuccessfulRead = true;
      return (workouts || []).map((w) => this.mapWorkout(w));
    } catch (error) {
      console.error('[AppleHealthProvider] Erro ao buscar atividades do HealthKit:', error);
      this.hasSuccessfulRead = false;
      this.consentRequestedInSession = false;
      // Uma falha não é “nenhuma atividade”: o manager precisa manter o
      // cursor de backfill pendente para tentar de novo após a permissão ser
      // corrigida no app Saúde.
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    this.consentRequestedInSession = false;
    this.hasSuccessfulRead = false;
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

      this.hasSuccessfulRead = true;
      return {
        avgHeartRate,
        maxHeartRate,
        steps: totalSteps > 0 ? Math.round(totalSteps) : undefined,
        calories: totalCalories > 0 ? Math.round(totalCalories) : undefined,
        workoutFound
      };
    } catch (err) {
      console.warn('[AppleHealthProvider] Erro ao consultar métricas da sessão:', err);
      return null;
    }
  }

  private mapWorkout(w: any): WearableActivity {
    const heartRateSamples = normalizeHeartRateSamples(w.heartRate);
    const heartRates = heartRateSamples.map((sample) => sample.bpm);
    const averageHeartRate = heartRates.length ? Math.round(heartRates.reduce((a, b) => a + b, 0) / heartRates.length) : undefined;
    const maxHeartRate = heartRates.length ? Math.max(...heartRates) : undefined;
    // #248: RouteSample vem como {timestamp, lat, lng, alt} -- convertido pro
    // formato latitude/longitude que o antifraude (validation-engine,
    // integrity-engine) ja espera em `activity.checkpoints`. O timestamp é
    // preservado porque o servidor precisa calcular distância/velocidade
    // entre pontos reais; sem ele toda rota vira apenas uma lista de locais.
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
