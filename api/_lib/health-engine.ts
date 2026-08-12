export interface HealthEngineReport {
  isSourceTrusted: boolean;
  isManualEntry: boolean;
  isPayloadTampered: boolean;
  healthProvider: string;
  threats: string[];
}

export class HealthEngine {
  /**
   * Health Engine: Validates origin authority and integrity of health SDK payloads.
   */
  static evaluate(activity: any): HealthEngineReport {
    const threats: string[] = [];
    const source = (activity.source || activity.dataSource || 'MANUAL').toString().toUpperCase();
    const provider = activity.healthProvider || activity.deviceInfo?.healthProvider || source;

    // 1. Trusted Provider Check
    const trustedProviders = [
      'HEALTH_CONNECT',
      'APPLE_HEALTH',
      'GARMIN',
      'POLAR',
      'SAMSUNG_HEALTH',
      'COROS',
      'STRAVA',
      'GOOGLE_FIT'
    ];
    const isSourceTrusted = trustedProviders.includes(provider) || trustedProviders.includes(source);
    if (!isSourceTrusted) {
      threats.push(`UNTRUSTED_HEALTH_PROVIDER (${provider})`);
    }

    // 2. Manual Entry Check
    const isManualEntry = Boolean(
      activity.isManual ||
      activity.wasUserEntered ||
      activity.healthData?.isManualEntry ||
      source === 'MANUAL'
    );
    if (isManualEntry && (activity.avgHeartRate > 150 || activity.durationMins > 120)) {
      threats.push('HIGH_INTENSITY_MANUAL_ENTRY_FLAGGED');
    }

    // 3. Payload Tampering / Signature Verification
    const isPayloadTampered = Boolean(
      activity.healthData?.isTampered ||
      activity.healthData?.signatureInvalid ||
      (activity.healthData && !activity.healthData.bundleIdentifier && provider === 'APPLE_HEALTH')
    );
    if (isPayloadTampered) {
      threats.push('HEALTH_PAYLOAD_TAMPERING_DETECTED');
    }

    return {
      isSourceTrusted,
      isManualEntry,
      isPayloadTampered,
      healthProvider: provider,
      threats
    };
  }
}
