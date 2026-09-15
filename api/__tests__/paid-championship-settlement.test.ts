import fs from 'node:fs';
import path from 'node:path';

let mockDb: any = {};

jest.mock('../_lib/common', () => ({
  get db() { return mockDb; },
}));
jest.mock('../_lib/championship-catalog', () => ({
  CHAMPIONSHIPS: [],
  getChampionship: jest.fn(),
}));
jest.mock('../_lib/account-state', () => ({ isActiveAccountState: jest.fn(() => true) }));
jest.mock('../_lib/championship-prize-credit', () => ({ creditChampionshipPrize: jest.fn() }));

import { buildPaidChampionshipFinalRanking } from '../_lib/paid-championship-settlement';

const read = (relativePath: string) => fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');

describe('paid championship final settlement', () => {
  test('ranking usa score, frequência, minutos e instante final nessa ordem', () => {
    const scores = [
      { userId: 'a', userName: 'A', activityId: 'a1', validationStatus: 'VALIDATED', score: 100, metrics: { durationMinutes: 30 }, createdAt: '2026-10-01T10:00:00.000Z' },
      { userId: 'a', userName: 'A', activityId: 'a2', validationStatus: 'VALIDATED', score: 0, metrics: { durationMinutes: 30 }, createdAt: '2026-10-02T10:00:00.000Z' },
      { userId: 'b', userName: 'B', activityId: 'b1', validationStatus: 'VALIDATED', score: 100, metrics: { durationMinutes: 60 }, createdAt: '2026-10-01T09:00:00.000Z' },
      { userId: 'b', userName: 'B', activityId: 'b2', validationStatus: 'VALIDATED', score: 0, metrics: { durationMinutes: 0 }, createdAt: '2026-10-02T09:00:00.000Z' },
      { userId: 'c', userName: 'C', activityId: 'c1', validationStatus: 'VALIDATED', score: 100, metrics: { durationMinutes: 20 }, createdAt: '2026-10-01T08:00:00.000Z' },
      { userId: 'c', userName: 'C', activityId: 'c2', validationStatus: 'VALIDATED', score: 0, metrics: { durationMinutes: 20 }, createdAt: '2026-10-01T09:00:00.000Z' },
      { userId: 'c', userName: 'C', activityId: 'c3', validationStatus: 'VALIDATED', score: 0, metrics: { durationMinutes: 20 }, createdAt: '2026-10-01T10:00:00.000Z' },
      { userId: 'd', userName: 'D', activityId: 'd1', validationStatus: 'VALIDATED', score: 101, metrics: { durationMinutes: 20 }, createdAt: '2026-10-03T10:00:00.000Z' },
    ];
    const approved = new Set(scores.map((item) => item.activityId));
    const eligible = new Set(['a', 'b', 'c', 'd']);

    const ranking = buildPaidChampionshipFinalRanking({ scores, approvedActivityIds: approved, eligibleUserIds: eligible });
    expect(ranking.map((item) => item.userId)).toEqual(['d', 'c', 'b', 'a']);
    expect(ranking.find((item) => item.userId === 'a')?.finalScoreReachedAt).toBe('2026-10-01T10:00:00.000Z');
    expect(ranking.find((item) => item.userId === 'b')?.finalScoreReachedAt).toBe('2026-10-01T09:00:00.000Z');
    expect(ranking.find((item) => item.userId === 'c')?.finalScoreReachedAt).toBe('2026-10-01T08:00:00.000Z');
  });

  test('atividade sem aprovação competitiva e usuário inelegível não entram', () => {
    const ranking = buildPaidChampionshipFinalRanking({
      scores: [
        { userId: 'ok', userName: 'OK', activityId: 'approved', validationStatus: 'VALIDATED', score: 10, metrics: { durationMinutes: 30 }, createdAt: '2026-10-01T10:00:00.000Z' },
        { userId: 'ok', userName: 'OK', activityId: 'not-approved', validationStatus: 'VALIDATED', score: 999, metrics: { durationMinutes: 30 }, createdAt: '2026-10-01T11:00:00.000Z' },
        { userId: 'refund', userName: 'Refund', activityId: 'refund-approved', validationStatus: 'VALIDATED', score: 999, metrics: { durationMinutes: 30 }, createdAt: '2026-10-01T09:00:00.000Z' },
      ],
      approvedActivityIds: new Set(['approved', 'refund-approved']),
      eligibleUserIds: new Set(['ok']),
    });
    expect(ranking).toHaveLength(1);
    expect(ranking[0]).toMatchObject({ userId: 'ok', score: 10, validActivities: 1 });
  });

  test('capacidade só é considerada implementada com calendário, editionId, digest e settlement fail-closed', () => {
    const catalog = read('api/_lib/championship-catalog.ts');
    const settlement = read('api/_lib/paid-championship-settlement.ts');
    const credit = read('api/_lib/championship-prize-credit.ts');
    const edition = read('api/_lib/paid-championship-edition.ts');
    const policy = read('shared/paidChampionshipPolicy.ts');

    expect(catalog).toContain('PAID_CHAMPIONSHIP_SETTLEMENT_IMPLEMENTED = true');
    expect(catalog).toContain('CHAMPIONSHIP_STRENGTH_SETTLEMENT_AT');
    expect(catalog).toContain('publishedConfigDigest');
    expect(catalog).toContain('editionId');
    expect(catalog).toContain("regulationHash: `${offer.regulationHash}-${publishedConfigDigest.slice(0, 16)}`");
    expect(settlement).toContain('FINANCIAL_REVIEW_PENDING');
    expect(settlement).toContain('ACTIVITY_REVIEW_PENDING');
    expect(settlement).toContain('COMPETITION_DATA_MISMATCH');
    expect(settlement).toContain('UNRESOLVED_PRIZE_TIE');
    expect(settlement).toContain("status: 'LOCKED'");
    expect(settlement).toContain('paidChampionshipSettlementDocumentId(editionId)');
    expect(settlement).toContain('editionId,');
    expect(settlement).not.toContain('finalizeDuePaidChampionships');
    expect(credit).toContain("category: 'redeemable'");
    expect(credit).toContain("origin: 'championship'");
    expect(credit).toContain("registration.status === 'paga'");
    expect(credit).toContain("registration.paymentStatus === 'PAID'");
    expect(credit).toContain('registration.editionId === input.editionId');
    expect(edition).toContain("db.collection('championship_editions').doc(championship.editionId)");
    expect(edition).toContain("previousSettlement.data()?.status !== 'FINALIZED'");
    expect(policy).toContain('maior número de atividades válidas');
    expect(policy).toContain('maior total de minutos válidos');
    expect(policy).toContain('quem atingiu a pontuação final primeiro');
  });

  test('cron protegido tenta settlement diariamente e retoma somente a edição travada', () => {
    const vercel = read('vercel.json');
    const handler = read('api/_handlers/gym-championship-payout-cron.ts');
    const orchestrator = read('api/_lib/paid-championship-settlement-orchestrator.ts');

    expect(vercel).toContain('{ "path": "/api/gym-championship-payout-cron", "schedule": "0 7 * * *" }');
    expect(handler).toContain('timingSafeEqual');
    expect(handler).toContain('CRON_SECRET');
    expect(handler).toContain('runPaidChampionshipSettlementSweep');
    expect(handler).not.toContain("reason.startsWith('PAID_REGULATION_MISMATCH:')");
    expect(handler).not.toContain("reason.startsWith('COMPETITION_DATA_MISMATCH:')");
    expect(orchestrator).toContain("existing.data()?.status === 'LOCKED'");
    expect(orchestrator).toContain('resumeLockedPaidChampionship');
    expect(orchestrator).toContain('executionLeaseToken');
    expect(orchestrator).toContain('FINALIZED_CONFIG_MISMATCH');
    expect(orchestrator).toContain('getLockedChampionshipSnapshot(configured.id)');
    expect(orchestrator).toContain('ACTIVE_EDITION_CONFIG_MISMATCH');
    expect(orchestrator).toContain('paidChampionshipSettlementDocumentId(locked.editionId)');
  });
});
