import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.join(process.cwd(), 'api/_handlers/denounce.ts'), 'utf8');

describe('competitive denunciation abuse resistance', () => {
  test('reports cannot directly punish trust score or workouts', () => {
    expect(source).not.toContain("collection('user_trust_profiles')");
    expect(source).not.toContain('trustScore - 20');
    expect(source).not.toContain("status: 'under_review'");
    expect(source).not.toContain("validation.requiresManualReview");
    expect(source).toContain('automaticPenaltyApplied: false');
    expect(source).toContain("actionTaken: 'queued_for_review'");
  });

  test('reporter and suspect must share the same active acknowledged gym ranking', () => {
    expect(source).toContain("collection('gym_ranking_enrollments').doc(authUser.uid)");
    expect(source).toContain("collection('gym_ranking_enrollments').doc(suspectUserId)");
    expect(source).toContain('reporterEnrollment.enrolled === true');
    expect(source).toContain('suspectEnrollment.enrolled === true');
    expect(source).toContain('isCurrentCompetitiveHrAcknowledgement');
    expect(source).toContain("'gym_ranking'");
    expect(source).toContain('COMPETITION_RULES_VERSIONS.gym_ranking');
    expect(source).toContain('reporterAcknowledged');
    expect(source).toContain('suspectAcknowledged');
    expect(source).toContain('reporterGymId === suspectGymId');
    expect(source).toContain('suspectRankingGymId === reporterGymId');
  });

  test('duplicate and bulk reports are rate-limited and idempotent', () => {
    expect(source).toContain('REPORT_RATE_MAX = 5');
    expect(source).toContain("scope: 'denounce'");
    expect(source).toContain('reportDocumentId(authUser.uid, suspectUserId, reporterGymId, now)');
    expect(source).toContain('transaction.create(denounceRef');
    expect(source).toContain('if (existing.exists) return false');
    expect(source).toContain('return res.status(409)');
    expect(source).toContain('return res.status(429)');
  });
});
