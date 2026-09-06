import { classifyPendingReview, resolveSecurityRetryResult } from '../_lib/pending-review-policy';

describe('pending review policy', () => {
  test('BLOCKED é terminal e não fica eternamente em análise', () => {
    expect(classifyPendingReview({ securityDecision: 'BLOCKED' })).toBe('reject');
  });

  test('check-in competitivo ausente ou inválido é inelegível, não revisão eterna', () => {
    expect(classifyPendingReview({ nonScoringReason: 'GEOFENCE_CHECKIN_REQUIRED' })).toBe('ineligible');
    expect(classifyPendingReview({ nonScoringReason: 'GEOFENCE_CHECKIN_INVALID' })).toBe('ineligible');
  });

  test('falha técnica do pipeline é reenviada para processamento automático', () => {
    expect(classifyPendingReview({ securityDecision: 'ERROR', nonScoringReason: 'SECURITY_PIPELINE_ERROR' })).toBe('retry_security');
  });

  test('UNDER_REVIEW e PARTIALLY_APPROVED continuam na fila humana', () => {
    expect(classifyPendingReview({ securityDecision: 'UNDER_REVIEW' })).toBe('manual_review');
    expect(classifyPendingReview({ securityDecision: 'PARTIALLY_APPROVED' })).toBe('manual_review');
  });

  test('deduplicação indisponível é identificada como pendência técnica', () => {
    expect(classifyPendingReview({ dataQualityStatus: 'dedup_pending' })).toBe('technical_pending');
  });

  test('retry de segurança aprova, rejeita ou mantém revisão conforme decisão real', () => {
    expect(resolveSecurityRetryResult({ decision: 'APPROVED', competitivelyEligible: true })).toBe('approved');
    expect(resolveSecurityRetryResult({ decision: 'BLOCKED', competitivelyEligible: true })).toBe('rejected');
    expect(resolveSecurityRetryResult({ decision: 'UNDER_REVIEW', competitivelyEligible: true })).toBe('pending_review');
    expect(resolveSecurityRetryResult({ decision: 'APPROVED', competitivelyEligible: false })).toBe('ineligible');
  });
});
