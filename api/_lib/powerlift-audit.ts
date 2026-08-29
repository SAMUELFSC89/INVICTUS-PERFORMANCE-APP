export type PowerLiftAuditDecision = 'approved' | 'manual_review' | 'rejected';

/** Aprovação automática é fail-closed: só uma decisão explícita do servidor
 * com confiança mínima de 98% pode homologar. */
export function resolvePowerLiftAuditStatus(decision: unknown, confidence: unknown): PowerLiftAuditDecision {
  const score = Math.max(0, Math.min(100, Number(confidence) || 0));
  if (decision === 'approved' && score >= 98) return 'approved';
  if (decision === 'rejected') return 'rejected';
  return 'manual_review';
}
