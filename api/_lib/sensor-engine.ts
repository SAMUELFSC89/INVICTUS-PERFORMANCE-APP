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
    const requiresMotionEvidence = modality ? modality.requiresMotionEvidence : (
      activity.requiresGpsDistance === true ||
      ['RUNNING', 'WALKING', 'CYCLING'].includes(activityType) ||
      ['RUNNING', 'WALKING', 'BIKE'].includes(cardioType)
    );

    // 1. Motion Variance (Accelerometer / Gyroscope).
    // Antes, quando activity.sensorTelemetry vinha completamente ausente (ex.: o app nunca
    // pediu ou nunca recebeu permissao de DeviceMotionEvent no iOS), o codigo aplicava
    // valores padrao "plausiveis" (accelVariance=1.2, gyroVariance=0.8) e a checagem so
    // gerava uma ameaca quando sensorTelemetry EXISTIA mas mostrava variancia baixa --
    // ou seja, a AUSENCIA total de dados de sensor era tratada como "motion valida por
    // padrao" (fail-open). Foi exatamente essa brecha que permitiu uma atividade de
    // cardio feita de onibus ser homologada sem nenhum dado real de acelerometro/giroscopio.
    // Agora a ausencia de telemetria para atividades que dependem de movimento real
    // (corrida, caminhada, ciclismo ao ar livre) e tratada como evidencia insuficiente
    // (fail-closed), gerando uma ameaca MISSING_SENSOR_TELEMETRY em vez de passar batido.
    // Ver auditoria antifraude 2026-08.
    const hasSensorTelemetry = !!activity.sensorTelemetry && (
      activity.sensorTelemetry.accelVariance !== undefined || activity.sensorTelemetry.gyroVariance !== undefined
    );

    let hasMotionVariance: boolean;
    if (hasSensorTelemetry) {
      const accelVariance = Number(activity.sensorTelemetry.accelVariance ?? 0);
      const gyroVariance = Number(activity.sensorTelemetry.gyroVariance ?? 0);
      hasMotionVariance = accelVariance > 0.35 && gyroVariance > 0.12; // #200: limiar elevado para exigir variancia coerente com corrida/caminhada real (vibracao de veiculo em movimento passava facilmente no limiar antigo de 0.05/0.02)
      if (!hasMotionVariance) {
        threats.push('NO_SENSOR_MOTION_VARIANCE');
      }
    } else {
      hasMotionVariance = !requiresMotionEvidence;
      if (requiresMotionEvidence) {
        threats.push('MISSING_SENSOR_TELEMETRY');
      }
    }

    // 2. Step to Distance Ratio
    const steps = Number(activity.steps || activity.stepCount || 0);
    const distanceMeters = Number(activity.distanceMeters || (activity.distanceKm ? activity.distanceKm * 1000 : 0));
    let stepToDistanceRatioValid = true;

    if (steps > 0 && distanceMeters > 0) {
      const strideMeters = distanceMeters / steps;
      // Stride between 0.3m (short shuffle) and 2.5m (long sprint/stride)
      if (strideMeters < 0.2 || strideMeters > 3.0) {
        stepToDistanceRatioValid = false;
        threats.push(`UNREALISTIC_STRIDE_LENGTH (${strideMeters.toFixed(2)}m/step)`);
      }
    }

    // 3. Heart Rate to Motion Correlation
    const avgHr = Number(activity.avgHeartRate || activity.heartRate || 0);
    const durationMins = Number(activity.durationMins || activity.duration || 30);
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
