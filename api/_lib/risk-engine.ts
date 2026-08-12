import { SECURITY_CONFIG } from './security-config.js';
import { ValidationResult } from './validation-engine.js';
import { IntegrityResult } from './integrity-engine.js';
import { FraudAnalysis, FraudEvidence } from './fraud-engine.js';

export type AutomaticDecision = 'APPROVED' | 'PARTIALLY_APPROVED' | 'UNDER_REVIEW' | 'BLOCKED';
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface RiskAnalysis {
  riskScore: number;
  riskLevel: RiskLevel;
  automaticDecision: AutomaticDecision;
  riskReasons: string[];
  riskEvidence: FraudEvidence[];
  summary: string;
}

export class RiskEngine {
  /**
   * Risk Engine: Converts validation, integrity, and fraud evidence into a Risk Score and Decision.
   */
  static evaluate(
    validation: ValidationResult,
    integrity: IntegrityResult,
    fraud: FraudAnalysis
  ): RiskAnalysis {
    let riskScore = 0;
    const riskReasons: string[] = [];
    const cfg = SECURITY_CONFIG;

    // 1. Accumulate penalties from Fraud Evidence
    fraud.evidences.forEach(ev => {
      riskScore += ev.weightPenalty;
      riskReasons.push(`[${ev.category}] ${ev.description}`);
    });

    // 2. Deduction from low Integrity Score
    if (integrity.integrityScore < 70) {
      const integrityPenalty = Math.round((70 - integrity.integrityScore) * 0.8);
      riskScore += integrityPenalty;
      riskReasons.push(`Baixo índice de integridade de dados (${integrity.integrityScore}/100).`);
    }

    // 3. Validation Warnings Penalty
    if (validation.warnings.length > 0 && !validation.valid) {
      riskScore += 15 * validation.warnings.length;
      validation.warnings.forEach(w => riskReasons.push(`[VALIDATION] ${w}`));
    }

    // Cap floor at 0
    riskScore = Math.max(0, riskScore);

    // 4. Determine Risk Level
    let riskLevel: RiskLevel = 'LOW';
    if (riskScore <= cfg.riskLevels.lowMax) {
      riskLevel = 'LOW';
    } else if (riskScore <= cfg.riskLevels.mediumMax) {
      riskLevel = 'MEDIUM';
    } else if (riskScore <= cfg.riskLevels.highMax) {
      riskLevel = 'HIGH';
    } else {
      riskLevel = 'CRITICAL';
    }

    // 5. Determine Automatic Decision
    let automaticDecision: AutomaticDecision = 'APPROVED';

    // Immediate Block triggers
    const hasCriticalThreat = fraud.evidences.some(e => e.severity === 'CRITICAL');
    const isEmulatorOrHooked = fraud.deviceReport.isEmulator || fraud.deviceReport.isHookedOrInjected || fraud.deviceReport.isTamperedApk;

    if (!validation.valid && validation.details.userEligible === false) {
      automaticDecision = 'BLOCKED';
    } else if (isEmulatorOrHooked || hasCriticalThreat || riskScore > cfg.decisionThresholds.underReviewMaxRiskScore) {
      automaticDecision = 'BLOCKED';
    } else if (riskScore > cfg.decisionThresholds.partiallyApproveMaxRiskScore || fraud.evidences.some(e => e.severity === 'HIGH')) {
      automaticDecision = 'UNDER_REVIEW';
    } else if (riskScore > cfg.decisionThresholds.approveMaxRiskScore) {
      automaticDecision = 'PARTIALLY_APPROVED';
    } else {
      automaticDecision = 'APPROVED';
    }

    // Summary text
    let summary = '';
    switch (automaticDecision) {
      case 'APPROVED':
        summary = 'Atividade aprovada automaticamente com baixo índice de risco.';
        break;
      case 'PARTIALLY_APPROVED':
        summary = 'Atividade aprovada parcialmente devido a avisos moderados de telemetria.';
        break;
      case 'UNDER_REVIEW':
        summary = 'Atividade retida para revisão manual administrativa por pontuação de risco elevada.';
        break;
      case 'BLOCKED':
        summary = 'Atividade bloqueada por violação de integridade ou evidências críticas de fraude.';
        break;
    }

    return {
      riskScore,
      riskLevel,
      automaticDecision,
      riskReasons,
      riskEvidence: fraud.evidences,
      summary
    };
  }
}
