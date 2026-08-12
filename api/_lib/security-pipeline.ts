import { db } from './common.js';
import { SECURITY_CONFIG } from './security-config.js';
import { ValidationEngine, ValidationResult } from './validation-engine.js';
import { IntegrityEngine, IntegrityResult } from './integrity-engine.js';
import { BehaviorEngine, BehaviorResult } from './behavior-engine.js';
import { DeviceFingerprintEngine, DeviceFingerprintReport } from './device-fingerprint.js';
import { NetworkEngine, NetworkReport } from './network-engine.js';
import { FraudEngine, FraudAnalysis } from './fraud-engine.js';
import { ReputationEngine, ReputationResult } from './reputation-engine.js';
import { TrustEngine, TrustResult } from './trust-engine.js';
import { RiskEngine, RiskAnalysis, AutomaticDecision } from './risk-engine.js';
import { ExplainabilityEngine, SecurityExplanation } from './explainability-engine.js';
import { securityEventBus } from './security-events.js';
import { AuditLogger } from './audit-logger.js';
import { recordPipelineStage, PipelineTraceIds } from './observability.js';

export interface SecurityReportDocument {
  id?: string;
  activityId: string;
  userId: string;
  validation: ValidationResult;
  integrity: IntegrityResult;
  behavior: BehaviorResult;
  deviceFingerprint: DeviceFingerprintReport;
  network: NetworkReport;
  fraud: FraudAnalysis;
  reputation: ReputationResult;
  trust: TrustResult;
  risk: RiskAnalysis;
  explanation: SecurityExplanation;
  device: any;
  gps: any;
  sensors: any;
  photos: any;
  heartRate: any;
  decision: AutomaticDecision;
  timestamp: string;
  securityVersion: string;
  pipelineVersion: string;
  rulesVersion: string;
  engineVersions: Record<string, string>;
  seasonId?: string;
  activityType?: string;
}

export class SecurityPipeline {
  /**
   * Enterprise Grade Security Pipeline (Enterprise Version 2.0.0)
   * 
   * Strict Pipeline Order:
   * Activity -> Validation -> Integrity -> Behavior -> Device Fingerprint -> Network ->
   * Fraud -> Reputation -> Trust -> Risk -> Explainability -> Security Events -> Immutable Audit Log
   */
  static async runPipeline(
    activityPayload: any,
    userId: string,
    userData?: any,
    userHistory: any[] = [],
    reqContext: any = {}
  ): Promise<{
    decision: AutomaticDecision;
    report: SecurityReportDocument;
    shouldScore: boolean;
  }> {
    const activityId = activityPayload.id || activityPayload.activityId || `ACT_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const timestamp = new Date().toISOString();

    const versions = {
      securityVersion: '2.0.0',
      pipelineVersion: '3.0.0',
      rulesVersion: SECURITY_CONFIG.ruleVersion || '2026.2',
      engineVersions: {
        validation: '2.0.0',
        integrity: '2.0.0',
        behavior: '1.0.0',
        deviceFingerprint: '1.0.0',
        network: '1.0.0',
        fraud: '2.0.0',
        reputation: '1.0.0',
        trust: '1.0.0',
        risk: '2.0.0',
        explainability: '1.0.0'
      }
    };

    // Extract active trace ID if available
    const traceId = reqContext?.traceId || activityPayload?._traceIds?.traceId;

    // 1. Validation Engine
    const validation = ValidationEngine.validate(activityPayload, userData);
    if (traceId) {
      recordPipelineStage(traceId, 'Validation', validation.valid ? 'SUCCESS' : 'WARNING', validation.reason || 'Sintaxe e estrutura de atividade válidas', { valid: validation.valid });
    }

    // 2. Integrity Engine
    const integrity = IntegrityEngine.calculate(activityPayload);
    if (traceId) {
      recordPipelineStage(traceId, 'Integrity', integrity.integrityScore >= 60 ? 'SUCCESS' : 'WARNING', `Integridade dos dados: ${integrity.integrityScore}/100 (${integrity.integrityLevel})`, { integrityScore: integrity.integrityScore, level: integrity.integrityLevel });
    }

    // 3. Behavior Engine (Statistical Baseline Analysis)
    const behavior = BehaviorEngine.evaluate(activityPayload, userHistory);

    // 4. Device Fingerprint Engine
    const deviceFingerprint = DeviceFingerprintEngine.evaluate(
      activityPayload.deviceInfo || activityPayload,
      userId,
      activityPayload
    );

    // 5. Network Security Engine
    const network = NetworkEngine.evaluate(reqContext, userData?.lastAccess);

    // 6. Fraud Engine
    const fraud = FraudEngine.analyze(activityPayload, userData, userHistory);
    if (traceId) {
      const fraudPenalty = fraud.evidences.reduce((acc, e) => acc + e.weightPenalty, 0);
      recordPipelineStage(traceId, 'Fraud', fraud.evidences.length === 0 ? 'SUCCESS' : 'WARNING', `Análise Antifraude: ${fraud.evidences.length} evidência(s) detectada(s)`, { evidencesCount: fraud.evidences.length, fraudPenalty });
    }

    // 7. Reputation Engine (Permanent Athlete History Score 0-100)
    const reputation = ReputationEngine.evaluate(userData, userHistory);

    // 8. Trust Engine (Global Trust Synthesis)
    const trust = TrustEngine.calculate(
      reputation,
      integrity,
      behavior.behaviorScore,
      deviceFingerprint.deviceRiskScore,
      network.networkRiskScore,
      activityPayload.dataSource || 'MANUAL'
    );

    // 9. Risk Engine
    const risk = RiskEngine.evaluate(validation, integrity, fraud);

    // Adjust risk slightly based on Trust Engine & Network Risk
    if (network.networkRiskScore > 50) {
      risk.riskScore = Math.min(100, risk.riskScore + 15);
    }
    if (trust.trustScore < 40) {
      risk.riskScore = Math.min(100, risk.riskScore + 10);
    } else if (trust.trustScore >= 90 && risk.riskScore <= 30) {
      risk.riskScore = Math.max(0, risk.riskScore - 5);
    }

    // Re-assign decision after trust adjustment
    if (risk.riskScore <= SECURITY_CONFIG.decisionThresholds.approveMaxRiskScore) {
      risk.automaticDecision = 'APPROVED';
    } else if (risk.riskScore <= SECURITY_CONFIG.decisionThresholds.partiallyApproveMaxRiskScore) {
      risk.automaticDecision = 'PARTIALLY_APPROVED';
    } else if (risk.riskScore <= SECURITY_CONFIG.decisionThresholds.underReviewMaxRiskScore) {
      risk.automaticDecision = 'UNDER_REVIEW';
    } else {
      risk.automaticDecision = 'BLOCKED';
    }

    if (traceId) {
      recordPipelineStage(traceId, 'Risk', risk.automaticDecision === 'APPROVED' ? 'SUCCESS' : risk.automaticDecision === 'BLOCKED' ? 'FAILED' : 'WARNING', `Análise de Risco: ${risk.automaticDecision} (Escore: ${risk.riskScore}/100)`, { riskScore: risk.riskScore, decision: risk.automaticDecision });
    }

    // 10. Explainability Engine
    const explanation = ExplainabilityEngine.explain(
      activityId,
      userId,
      risk.automaticDecision,
      risk.riskScore,
      trust.trustScore,
      reputation.reputationScore,
      fraud.evidences,
      behavior.anomalies,
      deviceFingerprint.threats,
      network.networkThreats,
      integrity.integrityScore
    );

    // Construct full audit report document
    const report: SecurityReportDocument = {
      activityId,
      userId,
      validation,
      integrity,
      behavior,
      deviceFingerprint,
      network,
      fraud,
      reputation,
      trust,
      risk,
      explanation,
      device: fraud.deviceReport,
      gps: fraud.gpsReport,
      sensors: fraud.sensorReport,
      photos: fraud.photoReport,
      heartRate: {
        avgHeartRate: activityPayload.avgHeartRate || activityPayload.heartRate || null,
        maxHeartRate: activityPayload.maxHeartRate || null,
        hrIntegrityScore: integrity.details.heartRateIntegrityScore
      },
      decision: risk.automaticDecision,
      timestamp,
      securityVersion: versions.securityVersion,
      pipelineVersion: versions.pipelineVersion,
      rulesVersion: versions.rulesVersion,
      engineVersions: versions.engineVersions,
      seasonId: userData?.activeSeasonId || 'SEASON_2026_Q3',
      activityType: activityPayload.activityType || activityPayload.type || 'GYM_WORKOUT'
    };

    // Console Logging strictly adhering to required format
    console.log(`\n==================================================`);
    console.log(`ENTERPRISE SECURITY PIPELINE v${versions.securityVersion} [${activityId}] [USER: ${userId}]`);
    console.log(`==================================================`);
    console.log(`VALIDATION: Valid=${validation.valid} | Reason=${validation.reason || 'OK'}`);
    console.log(`INTEGRITY: Score=${integrity.integrityScore}/100 (${integrity.integrityLevel})`);
    console.log(`BEHAVIOR: Score=${behavior.behaviorScore}/100 | Anomalies=${behavior.anomalies.length}`);
    console.log(`DEVICE FINGERPRINT: Hash=${deviceFingerprint.fingerprintHash.substring(0, 12)}... | Risk=${deviceFingerprint.deviceRiskScore}`);
    console.log(`NETWORK: Risk=${network.networkRiskScore} | VPN=${network.isVpnOrProxy} | Tor=${network.isTor}`);
    console.log(`FRAUD: Evidences=${fraud.evidences.length}`);
    console.log(`REPUTATION: Score=${reputation.reputationScore}/100 (${reputation.reputationTier})`);
    console.log(`TRUST: Score=${trust.trustScore}/100 (${trust.trustLevel})`);
    console.log(`RISK: Final Score=${risk.riskScore} (${risk.riskLevel})`);
    console.log(`EXPLANATION: Driver=${explanation.primaryRiskDriver} | ${explanation.summaryText}`);
    console.log(`FINAL DECISION: ${risk.automaticDecision}\n`);

    // 11. Dispatch Internal Security Events (Event Bus Pub/Sub)
    try {
      if (risk.automaticDecision === 'APPROVED') {
        securityEventBus.publish('SECURITY_APPROVED', userId, { activityId, riskScore: risk.riskScore }, activityId);
      } else if (risk.automaticDecision === 'PARTIALLY_APPROVED') {
        securityEventBus.publish('SECURITY_PARTIAL', userId, { activityId, riskScore: risk.riskScore }, activityId);
      } else if (risk.automaticDecision === 'UNDER_REVIEW') {
        securityEventBus.publish('SECURITY_REVIEW', userId, { activityId, explanation }, activityId);
      } else if (risk.automaticDecision === 'BLOCKED') {
        securityEventBus.publish('SECURITY_BLOCKED', userId, { activityId, explanation }, activityId);
      }

      if (fraud.gpsReport.isMockLocation) {
        securityEventBus.publish('GPS_FAKE', userId, { activityId }, activityId);
      }
      if (fraud.deviceReport.isRootedOrJailbroken) {
        securityEventBus.publish('DEVICE_ROOT', userId, { activityId }, activityId);
      }
      if (fraud.photoReport.isAiGenerated) {
        securityEventBus.publish('PHOTO_AI', userId, { activityId }, activityId);
      }
      if (network.networkRiskScore > 50) {
        securityEventBus.publish('NETWORK_RISK', userId, { activityId, networkRiskScore: network.networkRiskScore }, activityId);
      }
      if (behavior.anomalies.length > 0) {
        securityEventBus.publish('BEHAVIOR_ANOMALY', userId, { activityId, anomalies: behavior.anomalies }, activityId);
      }
    } catch (evtErr) {
      console.error(`[SecurityPipeline] Event dispatch error:`, evtErr);
    }

    // 12. Write to Immutable Audit Log (`security_audit_log`) & `security_reports`
    try {
      await AuditLogger.logDecision({
        timestamp,
        userId,
        activityId,
        decision: risk.automaticDecision,
        versions,
        scores: {
          riskScore: risk.riskScore,
          trustScore: trust.trustScore,
          reputationScore: reputation.reputationScore,
          behaviorScore: behavior.behaviorScore,
          integrityScore: integrity.integrityScore
        },
        evidences: fraud.evidences,
        explanation
      });

      if (db) {
        await db.collection('security_reports').doc(activityId).set(report);
      }
    } catch (saveErr) {
      console.error(`[SecurityPipeline] Error writing audit log:`, saveErr);
    }

    const shouldScore = risk.automaticDecision === 'APPROVED' || risk.automaticDecision === 'PARTIALLY_APPROVED';

    return {
      decision: risk.automaticDecision,
      report,
      shouldScore
    };
  }
}
