import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { rankingAchievementsForRank } from '../achievements';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('Round 5 final audit guards', () => {
  test('health AI analysis cannot stay loading forever', () => {
    const source = read('src/pages/HealthReport.tsx');
    expect(source).toContain('HEALTH_AI_TIMEOUT_MS = 45_000');
    expect(source).toContain('controller.abort()');
    expect(source).toContain('window.clearTimeout(timeoutId)');
    expect(source).toContain("setError(timeoutMessage)");
  });

  test('weekly ranking achievements are cumulative but never include legacy gym_leader', () => {
    expect(rankingAchievementsForRank(11).map((item) => item.id)).toEqual([]);
    expect(rankingAchievementsForRank(10).map((item) => item.id)).toEqual(['top_10']);
    expect(rankingAchievementsForRank(5).map((item) => item.id)).toEqual(['top_10', 'top_5']);
    expect(rankingAchievementsForRank(3).map((item) => item.id)).toEqual(['top_10', 'top_5', 'top_3']);
    expect(rankingAchievementsForRank(1).map((item) => item.id)).toEqual(['top_10', 'top_5', 'top_3', 'champion']);
    expect(rankingAchievementsForRank(1).some((item) => item.id === 'gym_leader')).toBe(false);
  });

  test('ranking server awards only from weekly opt-in source and migrates legacy first-place badge without double XP', () => {
    const handler = read('api/_handlers/ranking.ts');
    const ledger = read('api/_lib/user-ranking-achievements.ts');
    expect(handler).toContain("period !== 'weekly'");
    expect(handler).toContain('reconcileWeeklyRankingAchievements');
    expect(ledger).toContain("achievement.id === 'champion' && achievementSet.has('gym_leader')");
    expect(ledger).toContain("origin: alreadyListed || legacyEquivalent ? 'legacy_ranking_achievement_reconciliation' : 'weekly_ranking_achievement'");
    expect(ledger).toContain("db.collection('achievement_reward_ledger')");
  });
});
