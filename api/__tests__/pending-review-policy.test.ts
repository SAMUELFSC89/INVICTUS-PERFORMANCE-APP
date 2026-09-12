import { classifyPendingReview, resolveSecurityRetryResult } from '../_lib/pending-review-policy';

describe('pending review policy', () => {
  test('decisões antifraude não aprovadas são terminais e não ficam em fila humana', () => {
    expect(classifyPendingReview({ securityDecision: 'BLOCKED' })).toBe('reject');
    expect(classifyPendingReview({ securityDecision: 'UNDER_REVIEW' })).toBe('reject');
    expect(classifyPendingReview({ securityDecision: 'PARTIALLY_APPROVED' })).toBe('reject');
  });

  test('check-in competitivo ausente ou inválido é inelegível, não revisão eterna', () => {
    expect(classifyPendingReview({ nonScoringReason: 'GEOFENCE_CHECKIN_REQUIRED' })).toBe('ineligible');
    expect(classifyPendingReview({ nonScoringReason: 'GEOFENCE_CHECKIN_INVALID' })).toBe('ineligible');
  });

  test('falha técnica do pipeline é reenviada para processamento automático', () => {
    expect(classifyPendingReview({ securityDecision: 'ERROR', nonScoringReason: 'SECURITY_PIPELINE_ERROR' })).toBe('retry_security');
  });

  test('deduplicação indisponível é identificada como pendência técnica', () => {
    expect(classifyPendingReview({ dataQualityStatus: 'dedup_pending' })).toBe('technical_pending');
  });

  test('retry de segurança só aprova APPROVED; demais decisões do antifraude rejeitam', () => {
    expect(resolveSecurityRetryResult({ decision: 'APPROVED', competitivelyEligible: true })).toBe('approved');
    expect(resolveSecurityRetryResult({ decision: 'BLOCKED', competitivelyEligible: true })).toBe('rejected');
    expect(resolveSecurityRetryResult({ decision: 'UNDER_REVIEW', competitivelyEligible: true })).toBe('rejected');
    expect(resolveSecurityRetryResult({ decision: 'PARTIALLY_APPROVED', competitivelyEligible: true })).toBe('rejected');
    expect(resolveSecurityRetryResult({ decision: 'ERROR', competitivelyEligible: true })).toBe('pending_review');
    expect(resolveSecurityRetryResult({ decision: 'APPROVED', competitivelyEligible: false })).toBe('ineligible');
  });
});