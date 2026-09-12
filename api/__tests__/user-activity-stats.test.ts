jest.mock('../_lib/common', () => ({ db: { collection: jest.fn() } }));

import { deriveUserActivityStats, isCanonicalCompletedActivityForStats } from '../_lib/user-activity-stats';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const completed = (timestamp: string, duration = 30, extra: Record<string, unknown> = {}) => ({
  recordStatus: 'completed',
  activityMode: 'personal',
  economyEligible: true,
  missionEligible: true,
  timestamp,
  duration,
  ...extra,
});

describe('canonical user activity stats', () => {
  test('derives totals, active days, time and consecutive streak idempotently', () => {
    const now = new Date('2026-09-12T12:00:00.000Z');
    const stats = deriveUserActivityStats([
      completed('2026-09-10T10:00:00.000Z', 30),
      completed('2026-09-11T10:00:00.000Z', 40),
      completed('2026-09-12T08:00:00.000Z', 50),
      completed('2026-09-12T10:00:00.000Z', 20),
    ], now);

    expect(stats).toEqual({
      totalWorkouts: 4,
      totalActiveDays: 3,
      totalTimeSpent: 140,
      streak: 3,
      lastCheckIn: '2026-09-12T10:00:00.000Z',
    });
  });

  test('does not inflate stats with duplicate, discarded, technical or security-blocked records', () => {
    const now = new Date('2026-09-12T12:00:00.000Z');
    const stats = deriveUserActivityStats([
      completed('2026-09-12T08:00:00.000Z'),
      completed('2026-09-12T09:00:00.000Z', 30, { dataQualityStatus: 'duplicate' }),
      completed('2026-09-12T09:10:00.000Z', 30, { nonScoringReason: 'DUPLICATE_ACTIVITY' }),
      completed('2026-09-12T09:20:00.000Z', 30, { economyEligible: false }),
      completed('2026-09-12T09:30:00.000Z', 30, { missionEligible: false }),
      completed('2026-09-12T09:40:00.000Z', 30, { securityBlocked: true }),
      completed('2026-09-12T09:50:00.000Z', 30, { pendingReview: true }),
      completed('2026-09-12T10:00:00.000Z', 30, { dataQualityStatus: 'discarded' }),
    ], now);

    expect(stats.totalWorkouts).toBe(1);
    expect(stats.totalActiveDays).toBe(1);
    expect(stats.streak).toBe(1);
  });

  test('personal completion stays valid even when competition result is not applicable to ranking', () => {
    expect(isCanonicalCompletedActivityForStats(completed('2026-09-12T08:00:00.000Z', 30, {
      activityMode: 'competitive',
      competitionReviewStatus: 'rejected',
    }))).toBe(true);
  });

  test('streak expires when neither today nor yesterday has a qualifying activity', () => {
    const stats = deriveUserActivityStats([
      completed('2026-09-09T10:00:00.000Z'),
      completed('2026-09-10T10:00:00.000Z'),
    ], new Date('2026-09-12T12:00:00.000Z'));
    expect(stats.streak).toBe(0);
  });

  test('profile flow requests authenticated reconciliation without trusting client counters', () => {
    const missions = readFileSync(resolve(process.cwd(), 'api/_handlers/missions.ts'), 'utf8');
    const context = readFileSync(resolve(process.cwd(), 'src/UserContext.tsx'), 'utf8');
    expect(missions).toContain("action === 'sync-activity-stats'");
    expect(missions).toContain('reconcileUserActivityStats(auth.uid)');
    expect(context).toContain("fetch('/api/missions?action=sync-activity-stats'");
    expect(context).toContain('auth.currentUser?.uid !== uid');
    expect(context).toContain('setUser(current => current?.uid === uid ? { ...current, ...stats } : current)');
  });
});
