import { FraudLogger, fraudLogger } from '../logger.js';
import { GPSValidator } from './gps-validator.js';
import { DeviceFingerprintAnalyzer } from './device-fingerprint.js';
import { BehaviorAnalyzer } from './behavior-analyzer.js';

export interface FraudDetectionResult {
  isFraudulent: boolean;
  totalFraudScore: number;
  gpsValidation: ReturnType<typeof GPSValidator.validateActivity>;
  fingerprintAnalysis: ReturnType<typeof DeviceFingerprintAnalyzer.analyzeFingerprint>;
  behaviorAnalysis: ReturnType<typeof BehaviorAnalyzer.analyzeBehavior>;
  allFlags: string[];
  shouldBlock: boolean;
  recommendation: 'ACCEPT' | 'REVIEW' | 'BLOCK';
}

export class FraudDetectionEngine {
  /**
   * Análise completa de fraude (multi-layer)
   */
  static analyzeActivity(
    userId: string,
    data: {
      coordinates?: Array<{ lat: number; lng: number; timestamp: number }>;
      distance: number;
      duration: number;
      userAgent: string;
      ipAddress: string;
      acceptLanguage: string;
    },
    history: {
      previousFingerprints?: Array<any>;
      historicalBehavior?: Array<any>;
    }
  ): FraudDetectionResult {
    const allFlags: string[] = [];
    let totalScore = 0;

    // 1. GPS Validation
    const gpsValidation = data.coordinates
      ? GPSValidator.validateActivity(userId, data.coordinates, data.distance, data.duration)
      : { isValid: true, fraudScore: 0, flags: [], details: {} };

    totalScore += gpsValidation.fraudScore;
    allFlags.push(...gpsValidation.flags);

    // 2. Device Fingerprint Analysis
    const currentFingerprint = {
      userAgent: data.userAgent,
      ipAddress: data.ipAddress,
      acceptLanguage: data.acceptLanguage,
      timestamp: Date.now()
    };

    const fingerprintAnalysis = DeviceFingerprintAnalyzer.analyzeFingerprint(
      userId,
      currentFingerprint,
      history.previousFingerprints || []
    );

    totalScore += fingerprintAnalysis.fraudScore;
    allFlags.push(...fingerprintAnalysis.flags);

    // 3. Behavior Analysis
    const currentBehavior = {
      userId,
      timestamp: Date.now(),
      activitiesPerDay: 1,
      averageDistance: data.distance,
      averageDuration: data.duration,
      peakHours: [new Date().getHours()],
      weekdayPattern: new Date().getDay()
    };

    const behaviorAnalysis = BehaviorAnalyzer.analyzeBehavior(
      userId,
      currentBehavior,
      history.historicalBehavior || []
    );

    totalScore += behaviorAnalysis.fraudScore;
    allFlags.push(...behaviorAnalysis.flags);

    // Determinar ação
    let recommendation: 'ACCEPT' | 'REVIEW' | 'BLOCK' = 'ACCEPT';
    if (totalScore > 70) {
      recommendation = 'BLOCK';
    } else if (totalScore > 40) {
      recommendation = 'REVIEW';
    }

    const result: FraudDetectionResult = {
      isFraudulent: totalScore > 70,
      totalFraudScore: totalScore,
      gpsValidation,
      fingerprintAnalysis,
      behaviorAnalysis,
      allFlags,
      shouldBlock: recommendation === 'BLOCK',
      recommendation
    };

    // Log resultado
    if (recommendation !== 'ACCEPT') {
      FraudLogger.logSuspiciousActivity(
        userId,
        `${recommendation} recommended (score: ${totalScore})`,
        totalScore / 100,
        {
          flags: allFlags,
          gpsFlags: gpsValidation.flags,
          deviceFlags: fingerprintAnalysis.flags,
          behaviorFlags: behaviorAnalysis.flags
        }
      );
    }

    return result;
  }
}

export { GPSValidator, DeviceFingerprintAnalyzer, BehaviorAnalyzer };
