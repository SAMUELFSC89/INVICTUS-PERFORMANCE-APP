export interface SensorEngineReport {
  isSensorDataValid: boolean;
  hasMotionVariance: boolean;
  stepToDistanceRatioValid: boolean;
  hrToMotionCorrelated: boolean;
  threats: string[];
}

export class SensorEngine {
  /**
   * Sensor Engine: Cross-evaluates accelerometer, gyroscope, step counter, and heart rate telemetry.
   */
  static evaluate(activity: any): SensorEngineReport {
    const threats: string[] = [];

    // 1. Motion Variance (Accelerometer / Gyroscope)
    const accelVariance = Number(activity.sensorTelemetry?.accelVariance ?? 1.2);
    const gyroVariance = Number(activity.sensorTelemetry?.gyroVariance ?? 0.8);

    const hasMotionVariance = accelVariance > 0.05 && gyroVariance > 0.02;
    if (!hasMotionVariance && activity.sensorTelemetry) {
      threats.push('NO_SENSOR_MOTION_VARIANCE');
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
      threats
    };
  }
}
