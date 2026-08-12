export interface ExplanationReason {
  category: 'VALIDATION' | 'INTEGRITY' | 'BEHAVIOR' | 'DEVICE' | 'NETWORK' | 'FRAUD' | 'REPUTATION' | 'TRUST';
  code: string;
  confidencePercent: number; // e.g. 95%
  weightImpact: number;
  description: string;
}

export interface SecurityExplanation {
  activityId: string;
  userId: string;
  decision: 'APPROVED' | 'PARTIALLY_APPROVED' | 'UNDER_REVIEW' | 'BLOCKED';
  riskScore: number;
  trustScore: number;
  reputationScore: number;
  primaryRiskDriver: string;
  reasons: ExplanationReason[];
  recommendedAdminAction: string;
  summaryText: string;
}

export class ExplainabilityEngine {
  /**
   * Explainability Engine: Generates human & audit readable explanation for every security decision.
   */
  static explain(
    activityId: string,
    userId: string,
    decision: 'APPROVED' | 'PARTIALLY_APPROVED' | 'UNDER_REVIEW' | 'BLOCKED',
    riskScore: number,
    trustScore: number,
    reputationScore: number,
    fraudEvidences: any[] = [],
    behaviorAnomalies: any[] = [],
    deviceThreats: string[] = [],
    networkThreats: string[] = [],
    integrityScore: number = 100
  ): SecurityExplanation {
    const reasons: ExplanationReason[] = [];

    // 1. Fraud Evidences
    fraudEvidences.forEach((ev: any) => {
      reasons.push({
        category: 'FRAUD',
        code: ev.code || 'SUSPECTED_FRAUD',
        confidencePercent: ev.confidencePercent || 90,
        weightImpact: ev.weightPenalty || 30,
        description: ev.description || 'Fraude ou anomalia detectada no motor de segurança.'
      });
    });

    // 2. Behavior Anomalies
    behaviorAnomalies.forEach((ban: any) => {
      reasons.push({
        category: 'BEHAVIOR',
        code: ban.code || 'BEHAVIOR_ANOMALY',
        confidencePercent: 80,
        weightImpact: 20,
        description: ban.description || 'Comportamento atípico detectado em relação ao histórico.'
      });
    });

    // 3. Device Threats
    deviceThreats.forEach((dt: string) => {
      reasons.push({
        category: 'DEVICE',
        code: dt,
        confidencePercent: 95,
        weightImpact: 35,
        description: `Risco de hardware detectado: ${dt}`
      });
    });

    // 4. Network Threats
    networkThreats.forEach((nt: string) => {
      reasons.push({
        category: 'NETWORK',
        code: nt,
        confidencePercent: 85,
        weightImpact: 25,
        description: `Risco de rede ou conexões suspeitas: ${nt}`
      });
    });

    // 5. Integrity Penalty
    if (integrityScore < 70) {
      reasons.push({
        category: 'INTEGRITY',
        code: 'LOW_INTEGRITY_INDEX',
        confidencePercent: 90,
        weightImpact: Math.round(100 - integrityScore),
        description: `Índice de integridade baixo (${integrityScore}/100) devido a discrepâncias de sensores/GPS.`
      });
    }

    // Identify Primary Risk Driver
    let primaryRiskDriver = 'NONE';
    if (reasons.length > 0) {
      const sorted = [...reasons].sort((a, b) => b.weightImpact - a.weightImpact);
      primaryRiskDriver = `${sorted[0].code} (${sorted[0].confidencePercent}%)`;
    }

    // Recommended Admin Action
    let recommendedAdminAction = 'Nenhuma ação necessária. Atividade auditada com sucesso.';
    if (decision === 'BLOCKED') {
      recommendedAdminAction = 'Manter rejeição de pontuação. Notificar usuário sobre inconsistência de dados ou fraude.';
    } else if (decision === 'UNDER_REVIEW') {
      recommendedAdminAction = 'Revisar logs de sensores, foto/comprovante e localização antes de aprovar manualmente.';
    } else if (decision === 'PARTIALLY_APPROVED') {
      recommendedAdminAction = 'Atividade aprovada com peso reduzido. Acompanhar próximos treinos.';
    }

    const summaryText = `Decisão ${decision} (Risco: ${riskScore}, Trust: ${trustScore}, Reputação: ${reputationScore}). Fator principal: ${primaryRiskDriver}.`;

    return {
      activityId,
      userId,
      decision,
      riskScore,
      trustScore,
      reputationScore,
      primaryRiskDriver,
      reasons,
      recommendedAdminAction,
      summaryText
    };
  }
}
