import { SECURITY_CONFIG } from './security-config.js';
import { resolverPerfilValidacao } from './modality-config.js';

export interface IntegrityResult {
  integrityScore: number; // 0 - 100
  integrityLevel: 'EXCELLENT' | 'GOOD' | 'MEDIUM' | 'LOW' | 'CRITICAL';
  details: {
    gpsIntegrityScore: number;
    heartRateIntegrityScore: number;
    movementIntegrityScore: number;
    timeConsistencyScore: number;
    sensorIntegrityScore: number;
  };
  warnings: string[];
}

export class IntegrityEngine {
  /**
   * Integrity Engine: Evaluates payload data completeness, variance, and physical consistency.
   * Returns a weighted score from 0 to 100.
   */
  static calculate(activity: any): IntegrityResult {
    const warnings: string[] = [];
    // #247: pesos por perfil de validacao (STRENGTH/CARDIO tem conjunto
    // proprio; POWERLIFT e qualquer coisa nao mapeada usa o fallback plano).
    const perfil = resolverPerfilValidacao(activity);
    const weights = SECURITY_CONFIG.integrityWeightsByProfile[perfil.id] || SECURITY_CONFIG.integrityWeights;
    // #247: antes, quando resolveModality nao reconhecia o tipo (ex.: "workout"
    // de musculacao nao esta na lista de modalidades de cardio), o fallback
    // era `activity.requiresGpsDistance ?? true` -- ou seja, exigia GPS por
    // padrao pra qualquer atividade que o cliente nao marcasse explicitamente
    // como `requiresGpsDistance:false`. Um treino de musculacao sem esse
    // campo acabava sendo avaliado como se precisasse de GPS, gerando aviso
    // de "sinal GPS com baixa precisao" pra sessao que nunca usou GPS.
    // usaEvidenciaDeDeslocamento do perfil de validacao ja resolve isso
    // corretamente pra STRENGTH/CARDIO/POWERLIFT sem depender do cliente
    // mandar a flag certa.
    const requiresGps = perfil.usaEvidenciaDeDeslocamento;

    // 1. GPS Integrity (20%)
    let gpsIntegrityScore = 100;
    if (requiresGps) {
      const accuracyMeters = Number(activity.gpsAccuracy || activity.accuracy || 10);
      if (accuracyMeters > 50) {
        gpsIntegrityScore -= 40;
        warnings.push(`Sinal GPS com baixa precisão (${accuracyMeters}m).`);
      } else if (accuracyMeters > 25) {
        gpsIntegrityScore -= 20;
      }

      if (activity.checkpoints && Array.isArray(activity.checkpoints) && activity.checkpoints.length > 1) {
        // Check for static/frozen GPS checkpoints
        const uniqueCoords = new Set(
          activity.checkpoints.map((c: any) => `${c.latitude?.toFixed(5) || c.lat?.toFixed(5)},${c.longitude?.toFixed(5) || c.lng?.toFixed(5)}`)
        );
        if (uniqueCoords.size === 1 && activity.checkpoints.length > 5) {
          gpsIntegrityScore -= 60;
          warnings.push('Coordenadas de GPS congeladas ao longo do percurso.');
        }
      }
    } else {
      // Indoor activities and workouts do not require GPS checkpoints variance
      gpsIntegrityScore = 100;
    }
    gpsIntegrityScore = Math.max(0, gpsIntegrityScore);

    // 2. Heart Rate Integrity (20%)
    let heartRateIntegrityScore = 100;
    const avgHr = Number(activity.avgHeartRate || activity.heartRate || activity.healthTelemetry?.avgHeartRate || 0);
    const maxHr = Number(activity.maxHeartRate || activity.healthTelemetry?.maxHeartRate || avgHr);

    if (avgHr > 0) {
      if (avgHr < 40 || maxHr > 220) {
        heartRateIntegrityScore -= 50;
        warnings.push(`Frequência cardíaca com valores fora dos limites fisiológicos (${avgHr} BPM).`);
      }
      if (avgHr === maxHr && activity.hrSamples && activity.hrSamples.length > 5) {
        heartRateIntegrityScore -= 40;
        warnings.push('Sem variabilidade na frequência cardíaca (pulso plano).');
      }
    } else {
      // HR missing is standard on non-wearable devices; baseline score
      heartRateIntegrityScore = 75;
    }
    heartRateIntegrityScore = Math.max(0, heartRateIntegrityScore);

    // 3. Movement Integrity (20%)
    let movementIntegrityScore = 100;
    const durationMins = Number(activity.durationMins || activity.duration || 30);
    const activeTimeMins = Number(activity.activeTimeMins || durationMins * 0.85);
    const idleTimeMins = durationMins - activeTimeMins;

    if (idleTimeMins > durationMins * 0.5) {
      movementIntegrityScore -= 40;
      warnings.push(`Tempo inativo elevado (${Math.round(idleTimeMins)} min parados).`);
    }
    movementIntegrityScore = Math.max(0, movementIntegrityScore);

    // 4. Time Consistency (20%)
    let timeConsistencyScore = 100;
    if (activity.startLocalTimestamp && activity.endLocalTimestamp) {
      const start = new Date(activity.startLocalTimestamp).getTime();
      const end = new Date(activity.endLocalTimestamp).getTime();
      const diffMins = (end - start) / 60000;
      if (Math.abs(diffMins - durationMins) > 10) {
        timeConsistencyScore -= 40;
        warnings.push('Inconsistência entre os horários de início/fim e a duração informada.');
      }
    }
    timeConsistencyScore = Math.max(0, timeConsistencyScore);

    // 5. Sensor Integrity & Source Reliability (20%)
    let sensorIntegrityScore = 100;
    const healthSource = activity.healthTelemetry?.source || activity.smartwatchData?.dataSource;
    const source = (activity.source || activity.dataSource || healthSource || 'MANUAL').toUpperCase();
    if (source === 'HEALTH_CONNECT' || source === 'APPLE_HEALTH' || source === 'GARMIN') {
      sensorIntegrityScore = 100; // High trust hardware sources
    } else if (source === 'STRAVA') {
      sensorIntegrityScore = 90;
    } else if (source === 'GYM_CHECKIN' || activity.muscleGroup || !requiresGps) {
      sensorIntegrityScore = 85;
    } else {
      sensorIntegrityScore = 75;
    }

    if (activity.deviceInfo?.isEmulator || activity.isEmulator) {
      sensorIntegrityScore = 0;
      warnings.push('Execução em ambiente de emulador detectada.');
    }
    sensorIntegrityScore = Math.max(0, sensorIntegrityScore);

    // Weighted Total Score
    const integrityScore = Math.round(
      (gpsIntegrityScore * weights.gps) +
      (heartRateIntegrityScore * weights.heartRate) +
      (movementIntegrityScore * weights.movement) +
      (timeConsistencyScore * weights.timeConsistency) +
      (sensorIntegrityScore * weights.sensorIntegrity)
    );

    let integrityLevel: 'EXCELLENT' | 'GOOD' | 'MEDIUM' | 'LOW' | 'CRITICAL' = 'EXCELLENT';
    if (integrityScore >= 90) integrityLevel = 'EXCELLENT';
    else if (integrityScore >= 75) integrityLevel = 'GOOD';
    else if (integrityScore >= 50) integrityLevel = 'MEDIUM';
    else if (integrityScore >= 30) integrityLevel = 'LOW';
    else integrityLevel = 'CRITICAL';

    return {
      integrityScore,
      integrityLevel,
      details: {
        gpsIntegrityScore,
        heartRateIntegrityScore,
        movementIntegrityScore,
        timeConsistencyScore,
        sensorIntegrityScore
      },
      warnings
    };
  }
}
