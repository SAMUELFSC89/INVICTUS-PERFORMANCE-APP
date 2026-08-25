import { SECURITY_CONFIG } from './security-config.js';

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
    const weights = SECURITY_CONFIG.integrityWeights;

    // 1. GPS Integrity (20%)
    let gpsIntegrityScore = 100;
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
        activity.checkpoints.map((c: any) => `${c.latitude?.toFixed(5)},${c.longitude?.toFixed(5)}`)
      );
      if (uniqueCoords.size === 1 && activity.checkpoints.length > 5) {
        gpsIntegrityScore -= 60;
        warnings.push('Coordenadas de GPS congeladas ao longo do percurso.');
      }
    }
    gpsIntegrityScore = Math.max(0, gpsIntegrityScore);

    // 2. Heart Rate Integrity (20%)
    let heartRateIntegrityScore = 100;
    const avgHr = Number(activity.avgHeartRate || activity.heartRate || 0);
    const maxHr = Number(activity.maxHeartRate || avgHr);

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
      // Moderate deduction if HR missing but not required
      heartRateIntegrityScore = 70;
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
    const source = (activity.source || activity.dataSource || 'MANUAL').toUpperCase();
    if (source === 'HEALTH_CONNECT' || source === 'APPLE_HEALTH' || source === 'GARMIN') {
      sensorIntegrityScore = 100; // High trust hardware sources
    } else if (source === 'STRAVA') {
      sensorIntegrityScore = 90;
    } else if (source === 'GYM_CHECKIN') {
      sensorIntegrityScore = 85;
    } else {
      sensorIntegrityScore = 70;
    }

    if (activity.deviceInfo?.isEmulator) {
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
