import { ReputationResult } from './reputation-engine.js';
import { IntegrityResult } from './integrity-engine.js';

export interface TrustBreakdown {
  reputationWeight: number;    // 30%
  integrityWeight: number;     // 20%
  behaviorWeight: number;      // 20%
  hardwareTrustWeight: number; // 15%
  networkTrustWeight: number;  // 15%
}

export interface TrustResult {
  trustScore: number; // 0 - 100
  trustLevel: 'VERY_HIGH' | 'HIGH' | 'MODERATE' | 'LOW' | 'CRITICAL';
  confidenceIndex: number; // 0 - 100 %
  falsePositiveTolerance: 'STRICT' | 'STANDARD' | 'LENIENT';
  details: {
    reputationContribution: number;
    integrityContribution: number;
    behaviorContribution: number;
    hardwareContribution: number;
    networkContribution: number;
  };
}

export class TrustEngine {
  /**
   * Trust Engine: Calculates global Trust Score (0-100).
   * High Trust Score lowers false positives for legitimate veteran athletes.
   */
  static calculate(
    reputation: ReputationResult,
    integrity: IntegrityResult,
    behaviorScore: number = 85,
    deviceRiskScore: number = 0,
    networkRiskScore: number = 0,
    hardwareSource: string = 'MANUAL'
  ): TrustResult {
    // Hardware Reliability Matrix
    let hardwareTrust = 70;
    const src = hardwareSource.toUpperCase();
    if (['APPLE_HEALTH', 'HEALTH_CONNECT', 'GARMIN', 'POLAR', 'COROS'].includes(src)) {
      hardwareTrust = 100;
    } else if (['STRAVA', 'SAMSUNG_HEALTH'].includes(src)) {
      hardwareTrust = 90;
    } else if (src === 'GYM_CHECKIN') {
      hardwareTrust = 85;
    }
    hardwareTrust = Math.max(0, hardwareTrust - deviceRiskScore);

    // Network Trust
    const networkTrust = Math.max(0, 100 - networkRiskScore);

    // Weighted Synthesis
    const repContrib = (reputation.reputationScore * 0.30);
    const intContrib = (integrity.integrityScore * 0.20);
    const behContrib = (behaviorScore * 0.20);
    const hwdContrib = (hardwareTrust * 0.15);
    const netContrib = (networkTrust * 0.15);

    const rawTrustScore = Math.round(repContrib + intContrib + behContrib + hwdContrib + netContrib);
    const trustScore = Math.max(0, Math.min(100, rawTrustScore));

    // Trust Level
    let trustLevel: 'VERY_HIGH' | 'HIGH' | 'MODERATE' | 'LOW' | 'CRITICAL' = 'MODERATE';
    let falsePositiveTolerance: 'STRICT' | 'STANDARD' | 'LENIENT' = 'STANDARD';

    if (trustScore >= 88) {
      trustLevel = 'VERY_HIGH';
      falsePositiveTolerance = 'LENIENT';
    } else if (trustScore >= 75) {
      trustLevel = 'HIGH';
      falsePositiveTolerance = 'STANDARD';
    } else if (trustScore >= 50) {
      trustLevel = 'MODERATE';
      falsePositiveTolerance = 'STANDARD';
    } else if (trustScore >= 30) {
      trustLevel = 'LOW';
      falsePositiveTolerance = 'STRICT';
    } else {
      trustLevel = 'CRITICAL';
      falsePositiveTolerance = 'STRICT';
    }

    // Confidence Index based on historical sample size & telemetry richness
    const confidenceIndex = Math.min(100, Math.round((reputation.stats.totalActivities * 3) + (integrity.integrityScore * 0.4)));

    return {
      trustScore,
      trustLevel,
      confidenceIndex,
      falsePositiveTolerance,
      details: {
        reputationContribution: Math.round(repContrib),
        integrityContribution: Math.round(intContrib),
        behaviorContribution: Math.round(behContrib),
        hardwareContribution: Math.round(hwdContrib),
        networkContribution: Math.round(netContrib)
      }
    };
  }
}
