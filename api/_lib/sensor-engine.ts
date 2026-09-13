import { resolveModality } from './modality-config.js';

export interface SensorEngineReport {
  isSensorDataValid: boolean;
  hasMotionVariance: boolean;
  stepToDistanceRatioValid: boolean;
  hrToMotionCorrelated: boolean;
  hasSensorTelemetry: boolean;
  threats: string[];
}

export class SensorEngine {
  /**
   * Sensor Engine: Cross-evaluates accelerometer, gyroscope, step counter, and heart rate telemetry.
   */
  static evaluate(activity: any): SensorEngineReport {
    const threats: string[] = [];

    const activityType = (activity.activityType || activity.type || '').toString().toUpperCase();
    const cardioType = (activity.cardioType || '').toString().toUpperCase();
    const modality = resolveModality(activity);
    const requiresMotionEvidence = typeof activity.requiresMotionEvidence === 'boolean'
      ? activity.requiresMotionEvidence
      : modality ? modality.requiresMotionEvidence : (
          activity.requiresGpsDistance === true ||
          ['RUNNING', 'WALKING', 'CYCLING'].includes(activityType) ||
          ['RUNNING', 'WALKING', 'BIKE'].includes(cardioType)
        );

    // 1. Motion Variance (Accelerometer / Gyroscope).
    const hasSensorTelemetry = !!activity.sensorTelemetry && (
      activity.sensorTelemetry.accelVariance !== undefined || activity.sensorTelemetry.gyroVariance !== undefined
    );

    let hasMotionVariance: boolean;
    if (hasSensorTelemetry) {
      const accelVariance = Number(activity.sensorTelemetry.accelVariance ?? 0);
      const gyroVariance = Number(activity.sensorTelemetry.gyroVariance ?? 0);
      hasMotionVariance = accelVariance > 0.35 && gyroVariance > 0.12;
      if (!hasMotionVariance) {
        threats.push('NO_SENSOR_MOTION_VARIANCE');
      }
    } else {
      hasMotionVariance = !requiresMotionEvidence;
      if (requiresMotionEvidence) {
        threats.push('MISSING_SENSOR_TELEMETRY');
      }
    }

    // 2. Gait / Step to Distance Ratio.
    // Acelerometro sozinho nao diferencia uma passada de vibracao de bicicleta,
    // moto ou carro. Para corrida/caminhada competitivas cruzamos GPS, passos,
    // cadencia e distancia. A falta de evidencia de passada e fail-closed.
    const steps = Number(activity.steps || activity.stepCount || activity.pedometerSteps || 0);
    const distanceMeters = Number(activity.distanceMeters || (activity.distanceKm ? activity.distanceKm * 1000 : 0));
    const durationMins = Number(activity.durationMins || activity.duration || 30);
    const isRunningGait = modality?.antiFraudProfile === 'RUNNING'
      || activityType === 'RUNNING'
      || cardioType === 'RUNNING';
    const isWalkingGait = modality?.antiFraudProfile === 'WALKING'
      || activityType === 'WALKING'
      || cardioType === 'WALKING';
    const gaitProfile = isRunningGait || isWalkingGait;
    let stepToDistanceRatioValid = true;

    if (requiresMotionEvidence && gaitProfile && steps <= 0) {
      stepToDistanceRatioValid = false;
      threats.push('MISSING_GAIT_EVIDENCE');
    }

    if (steps > 0 && distanceMeters > 0) {
      const strideMeters = distanceMeters / steps;
      // Limites amplos para nao punir passada curta nem sprint real.
      if (strideMeters < 0.2 || strideMeters > 3.0) {
        stepToDistanceRatioValid = false;
        threats.push(`UNREALISTIC_STRIDE_LENGTH (${strideMeters.toFixed(2)}m/step)`);
      }
    }

    if (requiresMotionEvidence && gaitProfile && steps > 0 && durationMins > 0) {
      const stepsPerMinute = steps / durationMins;
      const averageSpeedKmH = distanceMeters > 0
        ? (distanceMeters / 1000) / (durationMins / 60)
        : 0;

      if (stepsPerMinute < 45 || stepsPerMinute > 260) {
        stepToDistanceRatioValid = false;
        threats.push(`UNREALISTIC_GAIT_CADENCE (${stepsPerMinute.toFixed(0)} spm)`);
      }

      // Ataque de baixa velocidade: uma bike/moto pode ficar abaixo do teto de
      // velocidade da corrida. Em corrida sustentada muito rapida a cadencia de
      // passada tambem precisa subir; 18+ km/h com menos de 150 spm e um padrao
      // fortemente incompatível com corrida real. Para caminhada usamos um
      // limiar separado e conservador.
      if (isRunningGait && averageSpeedKmH >= 18 && stepsPerMinute < 150) {
        stepToDistanceRatioValid = false;
        threats.push(`SPEED_GAIT_MISMATCH (${averageSpeedKmH.toFixed(1)} km/h; ${stepsPerMinute.toFixed(0)} spm)`);
      }
      if (isWalkingGait && averageSpeedKmH >= 9 && stepsPerMinute < 100) {
        stepToDistanceRatioValid = false;
        threats.push(`SPEED_GAIT_MISMATCH (${averageSpeedKmH.toFixed(1)} km/h; ${stepsPerMinute.toFixed(0)} spm)`);
      }
    }

    // 3. Heart Rate to Motion Correlation
    const avgHr = Number(activity.avgHeartRate || activity.heartRate || 0);
    let hrToMotionCorrelated = true;

    if (steps > 5000 && durationMins > 20 && avgHr > 0 && avgHr < 60) {
      hrToMotionCorrelated = false;
      threats.push(`LOW_HR_FOR_HIGH_STEP_COUNT (Avg HR ${avgHr} BPM with ${steps} steps)`);
    }

    const isSensorDataValid = threats.length === 0;

    return {
      isSensorDataValid,
      hasMotionVariance,
      stepToDistanceRatioValid,
      hrToMotionCorrelated,
      hasSensorTelemetry,
      threats
    };
  }
}
