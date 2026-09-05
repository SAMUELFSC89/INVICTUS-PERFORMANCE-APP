import { WearableManager } from './wearables/WearableManager.js';
import { AppleHealthProvider } from './wearables/AppleHealthProvider.js';
import { HealthConnectProvider } from './wearables/HealthConnectProvider.js';

export interface CollectedHealthMetrics {
  healthTelemetry?: {
    avgHeartRate?: number;
    maxHeartRate?: number;
    steps?: number;
    calories?: number;
    source?: 'apple_health' | 'health_connect' | 'wearable' | 'none';
  };
  metricSources: {
    heartRate?: string;
    steps?: string;
    distance?: string;
    calories?: string;
    motion?: string;
  };
  smartwatchData?: {
    avgHeartRate?: number;
    maxHeartRate?: number;
    steps?: number;
    calories?: number;
    dataSource?: string;
    hasWearableSync?: boolean;
  };
}

export class HealthDataCollector {
  private static async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
    return Promise.race([
      promise,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
  }

  static async collectForSession(
    startTimeStr: string,
    endTimeStr: string = new Date().toISOString(),
    pedometerSteps?: number,
    sensorVarianceDetected?: boolean
  ): Promise<CollectedHealthMetrics> {
    const startDate = new Date(startTimeStr);
    const endDate = new Date(endTimeStr);

    const metricSources: CollectedHealthMetrics['metricSources'] = {
      motion: sensorVarianceDetected ? 'device_motion_sensors' : undefined,
      steps: pedometerSteps && pedometerSteps > 0 ? 'device_pedometer' : undefined,
      calories: 'server_estimated',
    };

    let collected: {
      avgHeartRate?: number;
      maxHeartRate?: number;
      steps?: number;
      calories?: number;
      source: 'apple_health' | 'health_connect' | 'none';
    } = { source: 'none' };

    try {
      const manager = WearableManager.getInstance();
      const userId = manager.getAuthenticatedUserId();
      const providers = await manager.getConnectedNativeProviders();

      for (const provider of providers) {
        if (provider.id === 'apple_health' && provider instanceof AppleHealthProvider) {
          const res = await this.withTimeout(provider.querySessionMetrics(startDate, endDate), 1200);
          if (!manager.isProviderEnabledForUser(provider.id, userId)) break;
          if (res && (res.avgHeartRate || res.steps || res.calories)) {
            collected = {
              avgHeartRate: res.avgHeartRate,
              maxHeartRate: res.maxHeartRate,
              steps: res.steps,
              calories: res.calories,
              source: 'apple_health',
            };
            if (res.avgHeartRate) metricSources.heartRate = 'apple_health';
            if (res.steps) metricSources.steps = 'apple_health';
            if (res.calories) metricSources.calories = 'apple_health';
            break;
          }
        } else if (provider.id === 'health_connect' && provider instanceof HealthConnectProvider) {
          const res = await this.withTimeout(provider.querySessionMetrics(startDate, endDate), 1200);
          if (!manager.isProviderEnabledForUser(provider.id, userId)) break;
          if (res && (res.avgHeartRate || res.steps || res.calories)) {
            collected = {
              avgHeartRate: res.avgHeartRate,
              maxHeartRate: res.maxHeartRate,
              steps: res.steps,
              calories: res.calories,
              source: 'health_connect',
            };
            if (res.avgHeartRate) metricSources.heartRate = 'health_connect';
            if (res.steps) metricSources.steps = 'health_connect';
            if (res.calories) metricSources.calories = 'health_connect';
            break;
          }
        }
      }
    } catch (err) {
      console.warn('[HealthDataCollector] Falha defensiva ao coletar dados de saúde:', err);
    }

    const finalSteps = collected.steps ?? pedometerSteps;

    const result: CollectedHealthMetrics = {
      metricSources,
    };

    if (collected.source !== 'none' || collected.avgHeartRate || finalSteps || collected.calories) {
      result.healthTelemetry = {
        avgHeartRate: collected.avgHeartRate,
        maxHeartRate: collected.maxHeartRate,
        steps: finalSteps,
        calories: collected.calories,
        source: collected.source,
      };

      result.smartwatchData = {
        avgHeartRate: collected.avgHeartRate,
        maxHeartRate: collected.maxHeartRate,
        steps: finalSteps,
        calories: collected.calories,
        dataSource: collected.source,
        hasWearableSync: collected.source !== 'none',
      };
    }

    return result;
  }
}
