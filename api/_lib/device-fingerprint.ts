import crypto from 'crypto';

export interface DeviceFingerprintReport {
  fingerprintHash: string;
  isKnownDevice: boolean;
  associatedAccountsCount: number;
  deviceSwitchFrequency: number;
  isClonedOrVirtual: boolean;
  deviceRiskScore: number; // 0 - 100
  threats: string[];
  specsSummary: {
    brand: string;
    model: string;
    osVersion: string;
    architecture: string;
  };
}

export class DeviceFingerprintEngine {
  /**
   * Device Fingerprint Engine: Generates persistent SHA-256 hardware signature.
   * Detects multi-account sharing, device swapping, cloning, and virtual spaces.
   */
  static evaluate(
    deviceInfo: any = {},
    userId: string,
    payload: any = {},
    knownDeviceRegistry: Record<string, string[]> = {}
  ): DeviceFingerprintReport {
    const threats: string[] = [];
    let deviceRiskScore = 0;

    const brand = (deviceInfo.brand || payload.brand || 'GENERIC').toString().toLowerCase().trim();
    const model = (deviceInfo.model || payload.model || 'UNKNOWN').toString().toLowerCase().trim();
    const osVersion = (deviceInfo.osVersion || deviceInfo.systemVersion || payload.osVersion || '1.0').toString().trim();
    const architecture = (deviceInfo.architecture || deviceInfo.cpuAbi || payload.arch || 'arm64-v8a').toString().toLowerCase().trim();
    const screenRes = (deviceInfo.screenResolution || deviceInfo.resolution || '1080x2400').toString().trim();
    const timeZone = (deviceInfo.timeZone || payload.timeZone || 'America/Sao_Paulo').toString().trim();
    const locale = (deviceInfo.locale || payload.locale || 'pt-BR').toString().trim();
    const appSignature = (deviceInfo.appSignatureHash || payload.appSignatureHash || 'DEFAULT_SIG').toString().trim();

    // Raw components for SHA-256 fingerprint
    const rawFingerprintString = `${brand}|${model}|${architecture}|${screenRes}|${appSignature}`;
    const fingerprintHash = crypto.createHash('sha256').update(rawFingerprintString).digest('hex');

    // Multi-account detection on same hardware fingerprint
    const associatedAccounts = knownDeviceRegistry[fingerprintHash] || [userId];
    if (!associatedAccounts.includes(userId)) {
      associatedAccounts.push(userId);
    }
    const associatedAccountsCount = associatedAccounts.length;

    if (associatedAccountsCount > 3) {
      deviceRiskScore += 60;
      threats.push(`MULTIPLE_ACCOUNTS_ON_SAME_HARDWARE (${associatedAccountsCount} accounts registered)`);
    } else if (associatedAccountsCount > 1) {
      deviceRiskScore += 25;
      threats.push(`SHARED_DEVICE_DETECTED (${associatedAccountsCount} accounts)`);
    }

    // Virtualization / App Cloning Flags
    const isClonedOrVirtual = Boolean(
      deviceInfo.isVirtualSpace ||
      deviceInfo.isClonedApp ||
      payload.isVirtualSpace ||
      deviceInfo.hasLuckyPatcher
    );

    if (isClonedOrVirtual) {
      deviceRiskScore += 50;
      threats.push('VIRTUAL_SPACE_OR_APP_CLONING_DETECTED');
    }

    // Emulator hardware indicators
    if (brand.includes('generic') || model.includes('emulator') || model.includes('sdk') || brand.includes('google_sdk')) {
      deviceRiskScore += 80;
      threats.push('EMULATOR_HARDWARE_FINGERPRINT');
    }

    // Tampered App Signature
    if (deviceInfo.isTamperedApk || payload.isTamperedApk) {
      deviceRiskScore += 90;
      threats.push('INVALID_APP_DIGITAL_SIGNATURE');
    }

    const isKnownDevice = associatedAccounts.includes(userId);
    const deviceSwitchFrequency = Number(payload.deviceSwitchCount || 1);

    if (deviceSwitchFrequency > 4) {
      deviceRiskScore += 30;
      threats.push(`FREQUENT_DEVICE_SWAPPING (${deviceSwitchFrequency} devices recently used)`);
    }

    deviceRiskScore = Math.min(100, deviceRiskScore);

    return {
      fingerprintHash,
      isKnownDevice,
      associatedAccountsCount,
      deviceSwitchFrequency,
      isClonedOrVirtual,
      deviceRiskScore,
      threats,
      specsSummary: {
        brand: brand.toUpperCase(),
        model: model.toUpperCase(),
        osVersion,
        architecture
      }
    };
  }
}
