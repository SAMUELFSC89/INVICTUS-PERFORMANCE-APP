import { createHash } from 'node:crypto';
import { db } from './common.js';
import { getLevelFromXP } from './xpConfig.js';
import { rankingAchievementsForRank } from '../../src/achievements.js';

function achievementLedgerId(userId: string, achievementId: string): string {
  return `achievement_${createHash('sha256').update(`${userId}\u0000${achievementId}`).digest('hex')}`;
}

/**
 * Ranking achievements are based only on the canonical weekly, opt-in academy
 * ranking. They are permanent once earned and use the shared achievement
 * ledger so retries or repeated ranking views can never pay XP twice.
 *
 * `gym_leader` is a legacy alias for the same first-place fact as `champion`.
 * If a legacy profile already has it, we add `champion` for display continuity
 * but deliberately credit zero XP for that migration.
 */
export async function reconcileWeeklyRankingAchievements(userId: string, rank: number) {
  const eligible = rankingAchievementsForRank(rank);
  if (!eligible.length) {
    return { unlockedAchievementIds: [], xpCredit: 0 };
  }

  const userRef = db.collection('users').doc(userId);
  const ledgerRefs = eligible.map((achievement) =>
    db.collection('achievement_reward_ledger').doc(achievementLedgerId(userId, achievement.id)));

  return db.runTransaction(async (transaction: any) => {
    const reads = await Promise.all([
      transaction.get(userRef),
      ...ledgerRefs.map((ref) => transaction.get(ref)),
    ]);
    const userSnap = reads[0];
    if (!userSnap.exists) throw new Error('Perfil do atleta não encontrado para reconciliar ranking.');

    const userData = userSnap.data() || {};
    const existingAchievements = Array.isArray(userData.achievements)
      ? userData.achievements.filter((value: unknown): value is string => typeof value === 'string')
      : [];
    const achievementSet = new Set(existingAchievements);
    const ledgerSnaps = reads.slice(1);
    const unlockedAchievementIds: string[] = [];
    let xpCredit = 0;
    const now = new Date().toISOString();

    eligible.forEach((achievement, index) => {
      const alreadyListed = achievementSet.has(achievement.id);
      const legacyEquivalent = achievement.id === 'champion' && achievementSet.has('gym_leader');
      if (!alreadyListed) achievementSet.add(achievement.id);

      if (!ledgerSnaps[index].exists) {
        const credit = alreadyListed || legacyEquivalent ? 0 : Math.max(0, Number(achievement.points) || 0);
        if (!alreadyListed) unlockedAchievementIds.push(achievement.id);
        xpCredit += credit;
        transaction.create(ledgerRefs[index], {
          userId,
          achievementId: achievement.id,
          xp: credit,
          rankAtUnlock: rank,
          sourcePeriod: 'weekly',
          origin: alreadyListed || legacyEquivalent ? 'legacy_ranking_achievement_reconciliation' : 'weekly_ranking_achievement',
          createdAt: now,
        });
      }
    });

    const currentXP = Math.max(0, Number(userData.xp ?? userData.totalXp) || 0);
    const newXP = currentXP + xpCredit;
    const currentLevel = Math.max(1, Number(userData.level) || getLevelFromXP(currentXP));
    const newLevel = xpCredit > 0 ? getLevelFromXP(newXP) : currentLevel;
    const patch: Record<string, unknown> = {
      achievements: [...achievementSet],
      rankingAchievementsVersion: 1,
      rankingAchievementsReconciledAt: now,
    };
    if (xpCredit > 0) {
      patch.xp = newXP;
      patch.totalXp = newXP;
      patch.level = newLevel;
    }
    transaction.set(userRef, patch, { merge: true });

    return {
      unlockedAchievementIds,
      xpCredit,
      achievements: [...achievementSet],
      xp: newXP,
      totalXp: newXP,
      level: newLevel,
    };
  });
}
