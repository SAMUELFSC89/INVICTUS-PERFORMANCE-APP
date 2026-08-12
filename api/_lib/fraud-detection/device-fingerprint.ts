import { fraudLogger } from '../logger.js';
import { createHash } from 'crypto';

export interface DeviceFingerprint {
  userAgent: string;
  ipAddress: string;
  acceptLanguage: string;
  timestamp: number;
}

export interface FingerprintAnalysis {
  isSuspicious: boolean;
  fraudScore: number;
  flags: string[];
  details: {
    deviceChange?: boolean;
    frequentIpChange?: boolean;
    geolocationMismatch?: boolean;
  };
}

export class DeviceFingerprintAnalyzer {
  /**
   * Analisar fingerprint do device
   */
  static analyzeFingerprint(
    userId: string,
    currentFingerprint: DeviceFingerprint,
    previousFingerprints: DeviceFingerprint[]
  ): FingerprintAnalysis {
    const result: FingerprintAnalysis = {
      isSuspicious: false,
      fraudScore: 0,
      flags: [],
      details: {}
    };

    if (previousFingerprints.length === 0) {
      return result; // Primeira vez, não tem baseline
    }

    const lastFingerprint = previousFingerprints[previousFingerprints.length - 1];

    // 1. Checar mudança de device
    if (currentFingerprint.userAgent !== lastFingerprint.userAgent) {
      result.fraudScore += 10;
      result.flags.push('DEVICE_CHANGE');
      result.details.deviceChange = true;
      fraudLogger.warn({
        userId,
        previousUserAgent: lastFingerprint.userAgent,
        currentUserAgent: currentFingerprint.userAgent
      }, 'Device change detected');
    }

    // 2. Checar IP changes frequentes
    const ipChanges = previousFingerprints.filter(
      fp => fp.ipAddress !== currentFingerprint.ipAddress
    ).length;

    if (ipChanges > 5 && previousFingerprints.length > 10) {
      result.fraudScore += 20;
      result.flags.push('FREQUENT_IP_CHANGE');
      result.details.frequentIpChange = true;
      fraudLogger.warn({ userId, ipChanges }, 'Frequent IP changes detected');
    }

    // 3. Múltiplos devices simultâneos (suspeito)
    const uniqueDevices = new Set(
      previousFingerprints.map(fp => this.hashFingerprint(fp))
    );

    if (uniqueDevices.size > 3) {
      result.fraudScore += 25;
      result.flags.push('MULTIPLE_DEVICES');
      fraudLogger.warn({ userId, uniqueDevices: uniqueDevices.size }, 'Multiple devices detected');
    }

    result.isSuspicious = result.fraudScore > 30;

    return result;
  }

  /**
   * Gerar hash do device para comparação
   */
  private static hashFingerprint(fingerprint: DeviceFingerprint): string {
    return createHash('sha256')
      .update(`${fingerprint.userAgent}-${fingerprint.ipAddress}`)
      .digest('hex');
  }
}
