export type PowerLiftAuditDecision = 'approved' | 'manual_review' | 'rejected';

/** Aprovação automática é fail-closed: só uma decisão explícita do servidor
 * com confiança mínima de 98% pode homologar. */
export function resolvePowerLiftAuditStatus(decision: unknown, confidence: unknown): PowerLiftAuditDecision {
  const score = Math.max(0, Math.min(100, Number(confidence) || 0));
  if (decision === 'approved' && score >= 98) return 'approved';
  if (decision === 'rejected') return 'rejected';
  return 'manual_review';
}

/** Frames escolhidos/extráidos no cliente não possuem vínculo criptográfico
 * com o vídeo que chegou ao Storage. Eles podem ajudar a reprovar ou priorizar
 * uma revisão, mas nunca homologam um levantamento automaticamente. */
export function resolveClientSampledFramesStatus(decision: unknown): PowerLiftAuditDecision {
  return decision === 'rejected' ? 'rejected' : 'manual_review';
}
