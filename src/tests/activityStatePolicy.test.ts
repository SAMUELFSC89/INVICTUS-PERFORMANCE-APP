import { normalizeActivityValidationStatus, resolveActivityState } from '../lib/workoutData';

describe('activity presentation policy', () => {
  it('treats a completed personal activity as available even with a stale legacy review field', () => {
    expect(resolveActivityState({
      recordStatus: 'completed',
      activityMode: 'personal',
      competitionReviewStatus: 'pending_review',
    })).toMatchObject({
      recordStatus: 'completed',
      activityMode: 'personal',
      competitionStatus: 'not_applicable',
      isCompleted: true,
      isCompetitionApproved: false,
    });
  });

  it('keeps the personal record completed while only competition is pending', () => {
    expect(resolveActivityState({
      recordStatus: 'completed',
      activityMode: 'competitive',
      competitionReviewStatus: 'pending_review',
    })).toMatchObject({
      recordStatus: 'completed',
      activityMode: 'competitive',
      competitionStatus: 'pending',
      isCompleted: true,
    });
  });

  it('recognizes recorded and completed compatibility statuses', () => {
    expect(resolveActivityState({ recordStatus: 'recorded' }).isCompleted).toBe(true);
    expect(resolveActivityState({ validationStatus: 'not_required' }).isCompleted).toBe(true);
    expect(normalizeActivityValidationStatus('completed')).toBe('recorded');
    expect(normalizeActivityValidationStatus('resolution_pending')).toBe('pending');
  });

  it('does not let an old active field reopen an explicitly completed record', () => {
    expect(resolveActivityState({ recordStatus: 'completed', status: 'active' }).recordStatus).toBe('completed');
  });

  it('preserves legacy competitive rejection signals without requiring modern contexts', () => {
    expect(resolveActivityState({
      status: 'completed',
      validationStatus: 'not_eligible',
      securityReviewApplied: true,
    })).toMatchObject({
      activityMode: 'competitive',
      competitionStatus: 'ineligible',
      isCompleted: true,
    });
  });
});
