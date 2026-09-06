export type PendingReviewAction =
  | 'reject'
  | 'ineligible'
  | 'retry_security'
  | 'manual_review'
  | 'technical_pending';

export type SecurityRetryResolution =
  | 'approved'
  | 'rejected'
  | 'ineligible'
  | 'pending_review';

function normalized(value: unknown): string {
  return String(value || '').trim().toUpperCase();
}

/**
 * Decide o que pode sair automaticamente de `pending_review` sem abrir brecha
 * competitiva. Pendência humana continua humana; falha objetiva ou decisão
 * BLOCKED nunca deve permanecer eternamente como "em análise".
 */
export function classifyPendingReview(workout: Record<string, any>): PendingReviewAction {
  const decision = normalized(workout.securityDecision);
  const reason = normalized(workout.nonScoringReason || workout.rejectionReason);
  const dataQuality = normalized(workout.dataQualityStatus);

  if (decision === 'BLOCKED') return 'reject';

  // Regras objetivas já conhecidas no encerramento da atividade. Não existe
  // evidência futura que torne um check-in ausente/pertencente a outra sessão
  // válido retroativamente para aquela competição.
  if (reason === 'GEOFENCE_CHECKIN_REQUIRED' || reason === 'GEOFENCE_CHECKIN_INVALID') {
    return 'ineligible';
  }

  if (reason === 'COMPETITIVE_SANITY_CHECK') return 'reject';

  if (dataQuality === 'DUPLICATE' || reason === 'DUPLICATE_ACTIVITY') {
    return 'ineligible';
  }

  // Erro técnico do motor deve ser tentado novamente por máquina, e não ficar
  // disfarçado de revisão antifraude humana.
  if (decision === 'ERROR' || reason === 'SECURITY_PIPELINE_ERROR') {
    return 'retry_security';
  }

  // A reserva de deduplicação precisa do reconciliador econômico completo;
  // até isso acontecer ela é pendência técnica, não julgamento antifraude.
  if (dataQuality === 'DEDUP_PENDING' || reason === 'DEDUPLICATION_UNAVAILABLE') {
    return 'technical_pending';
  }

  if (decision === 'PARTIALLY_APPROVED' || decision === 'UNDER_REVIEW') {
    return 'manual_review';
  }

  return 'manual_review';
}

/** Converte uma nova execução do SecurityPipeline em estado competitivo final. */
export function resolveSecurityRetryResult(input: {
  decision: unknown;
  competitivelyEligible: boolean;
}): SecurityRetryResolution {
  if (!input.competitivelyEligible) return 'ineligible';
  const decision = normalized(input.decision);
  if (decision === 'APPROVED') return 'approved';
  if (decision === 'BLOCKED') return 'rejected';
  return 'pending_review';
}
