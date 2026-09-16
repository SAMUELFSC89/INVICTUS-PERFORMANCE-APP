import fs from 'node:fs';
import path from 'node:path';

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
jest.mock('../_lib/paid-championship-edition', () => ({
  paidChampionshipSettlementDocumentId: jest.fn((editionId: string) => `settlement_${editionId}`),
}));

import { buildProvisionalChampionshipLeaderboard } from '../_lib/championship-scoring-service';

const read = (relativePath: string) => fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');

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

  test('finalized leaderboard is read from the frozen settlement before live scores', () => {
    const source = read('api/_lib/championship-scoring-service.ts');
    const handlerStart = source.indexOf('export async function getChampionshipLeaderboard');
    const handler = source.slice(handlerStart);
    expect(handler).toContain("db.collection('championship_settlements')");
    expect(handler).toContain('paidChampionshipSettlementDocumentId(editionId)');
    expect(handler).toContain('if (frozen) return frozen;');
    expect(handler.indexOf("db.collection('championship_settlements')"))
      .toBeLessThan(handler.indexOf("db.collection('championship_scores')"));

    const frozenStart = source.indexOf('function frozenFinalLeaderboard');
    const frozenEnd = source.indexOf('export async function getChampionshipLeaderboard', frozenStart);
    const frozen = source.slice(frozenStart, frozenEnd);
    expect(frozen).toContain("String(settlement.status || '') !== 'FINALIZED'");
    expect(frozen).toContain('FINALIZED_RANKING_IDENTITY_MISMATCH');
    expect(frozen).toContain('FINALIZED_RANKING_UNAVAILABLE');
    expect(frozen).not.toContain('configDigest');
    expect(frozen).not.toContain('transactionId');
    expect(frozen).not.toContain('prizeDistribution');
  });
});
