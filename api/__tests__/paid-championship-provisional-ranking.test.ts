jest.mock('../_lib/common', () => ({ db: {} }));
jest.mock('../_lib/championship-catalog', () => ({
  getChampionship: jest.fn(),
  matchActiveChampionshipsForActivity: jest.fn(() => []),
}));
jest.mock('../_lib/championship-inscription-service', () => ({ getUserRegistration: jest.fn() }));
jest.mock('../_lib/reward-coin-engine', () => ({ RewardCoinEngine: { credit: jest.fn() } }));
jest.mock('../_lib/competition-evidence', () => ({
  hasTrustedCompetitionEvidence: jest.fn(() => false),
  readCompetitionEvidenceMetrics: jest.fn(() => null),
}));
jest.mock('../_lib/competitive-heart-rate-acknowledgement', () => ({
  isCurrentCompetitiveHrAcknowledgement: jest.fn(() => true),
}));
jest.mock('../_lib/account-state', () => ({ isActiveAccountState: jest.fn(() => true) }));

import { buildProvisionalChampionshipLeaderboard } from '../_lib/championship-scoring-service';

describe('paid championship provisional ranking', () => {
  test('uses the published final tie-break order: score, activities, minutes, final-score time', () => {
    const scores = [
      { userId: 'a', userName: 'A', validationStatus: 'VALIDATED', score: 100, metrics: { durationMinutes: 30 }, createdAt: '2026-10-01T10:00:00.000Z' },
      { userId: 'a', userName: 'A', validationStatus: 'VALIDATED', score: 0, metrics: { durationMinutes: 30 }, createdAt: '2026-10-02T10:00:00.000Z' },
      { userId: 'b', userName: 'B', validationStatus: 'VALIDATED', score: 100, metrics: { durationMinutes: 60 }, createdAt: '2026-10-01T09:00:00.000Z' },
      { userId: 'b', userName: 'B', validationStatus: 'VALIDATED', score: 0, metrics: { durationMinutes: 0 }, createdAt: '2026-10-02T09:00:00.000Z' },
      { userId: 'c', userName: 'C', validationStatus: 'VALIDATED', score: 100, metrics: { durationMinutes: 20 }, createdAt: '2026-10-01T08:00:00.000Z' },
      { userId: 'c', userName: 'C', validationStatus: 'VALIDATED', score: 0, metrics: { durationMinutes: 20 }, createdAt: '2026-10-01T09:00:00.000Z' },
      { userId: 'c', userName: 'C', validationStatus: 'VALIDATED', score: 0, metrics: { durationMinutes: 20 }, createdAt: '2026-10-01T10:00:00.000Z' },
      { userId: 'd', userName: 'D', validationStatus: 'VALIDATED', score: 101, metrics: { durationMinutes: 20 }, createdAt: '2026-10-03T10:00:00.000Z' },
    ];

    const ranking = buildProvisionalChampionshipLeaderboard(scores, new Set(['a', 'b', 'c', 'd']), 50);

    expect(ranking.map((entry) => entry.userId)).toEqual(['d', 'c', 'b', 'a']);
    expect(ranking.find((entry) => entry.userId === 'a')).toMatchObject({
      score: 100,
      validActivities: 2,
      totalTimeMinutes: 60,
      finalScoreReachedAt: '2026-10-01T10:00:00.000Z',
    });
    expect(ranking.find((entry) => entry.userId === 'c')?.validActivities).toBe(3);
  });

  test('zero-point activity does not move finalScoreReachedAt after positive score', () => {
    const ranking = buildProvisionalChampionshipLeaderboard([
      { userId: 'u', userName: 'U', validationStatus: 'VALIDATED', score: 50, metrics: { durationMinutes: 30 }, createdAt: '2026-10-01T10:00:00.000Z' },
      { userId: 'u', userName: 'U', validationStatus: 'VALIDATED', score: 0, metrics: { durationMinutes: 30 }, createdAt: '2026-10-05T10:00:00.000Z' },
    ], new Set(['u']));

    expect(ranking[0].finalScoreReachedAt).toBe('2026-10-01T10:00:00.000Z');
  });

  test('ineligible and rejected rows never enter the provisional ranking', () => {
    const ranking = buildProvisionalChampionshipLeaderboard([
      { userId: 'ok', validationStatus: 'VALIDATED', score: 10, metrics: { durationMinutes: 30 }, createdAt: '2026-10-01T10:00:00.000Z' },
      { userId: 'inactive', validationStatus: 'VALIDATED', score: 999, metrics: { durationMinutes: 30 }, createdAt: '2026-10-01T09:00:00.000Z' },
      { userId: 'ok', validationStatus: 'REJECTED', score: 999, metrics: { durationMinutes: 30 }, createdAt: '2026-10-01T08:00:00.000Z' },
    ], new Set(['ok']));

    expect(ranking).toHaveLength(1);
    expect(ranking[0]).toMatchObject({ userId: 'ok', score: 10, validActivities: 1 });
  });
});
