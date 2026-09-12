import { createHash } from 'node:crypto';
import { db } from './common.js';
import { getLevelFromXP } from './xpConfig.js';
import { socialAchievementsForStats, type SocialAchievementStats } from '../../src/achievements.js';

export interface UserSocialStatsReconciliation extends SocialAchievementStats {
  achievements: string[];
  xp: number;
  totalXp: number;
  level: number;
  unlockedAchievementIds: string[];
}

function achievementLedgerId(userId: string, achievementId: string): string {
  return `achievement_${createHash('sha256').update(`${userId}\u0000${achievementId}`).digest('hex')}`;
}

function validPeer(value: unknown, userId: string): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 && value !== userId;
}

export function deriveSocialStatsFromRecords(
  userId: string,
  postRecords: Array<Record<string, any>>,
  followingRecords: Array<Record<string, any>>,
  followerRecords: Array<Record<string, any>>,
): SocialAchievementStats {
  const uniqueFollowing = new Set<string>();
  for (const record of followingRecords) {
    const peer = record?.followingId;
    if (validPeer(peer, userId)) uniqueFollowing.add(peer);
  }
  const uniqueFollowers = new Set<string>();
  for (const record of followerRecords) {
    const peer = record?.followerId;
    if (validPeer(peer, userId)) uniqueFollowers.add(peer);
  }

  return {
    postsCount: postRecords.length,
    followersCount: uniqueFollowers.size,
    followingCount: uniqueFollowing.size,
  };
}

/**
 * Social counters are derived from canonical documents instead of client-side
 * increments. Sets intentionally deduplicate malformed/legacy duplicate follow
 * documents so one relationship can never inflate a public counter or unlock XP.
 */
export async function deriveUserSocialStats(userId: string): Promise<SocialAchievementStats> {
  const [posts, following, followers] = await Promise.all([
    db.collection('posts').where('userId', '==', userId).get(),
    db.collection('follows').where('followerId', '==', userId).get(),
    db.collection('follows').where('followingId', '==', userId).get(),
  ]);

  return deriveSocialStatsFromRecords(
    userId,
    posts.docs.map((doc: any) => doc.data() || {}),
    following.docs.map((doc: any) => doc.data() || {}),
    followers.docs.map((doc: any) => doc.data() || {}),
  );
}

/**
 * Reconciliation is idempotent and authoritative. Existing achievements from
 * legacy versions are preserved but never paid again; new eligible social
 * achievements are credited exactly once through the shared reward ledger.
 */
export async function reconcileUserSocialStats(userId: string): Promise<UserSocialStatsReconciliation> {
  const stats = await deriveUserSocialStats(userId);
  const eligibleAchievements = socialAchievementsForStats(stats);
  const userRef = db.collection('users').doc(userId);
  const ledgerRefs = eligibleAchievements.map((achievement) =>
    db.collection('achievement_reward_ledger').doc(achievementLedgerId(userId, achievement.id)));

  return db.runTransaction(async (transaction: any) => {
    const reads = await Promise.all([
      transaction.get(userRef),
      ...ledgerRefs.map((ref) => transaction.get(ref)),
    ]);
    const userSnap = reads[0];
    if (!userSnap.exists) throw new Error('Perfil do atleta não encontrado para reconciliar Social.');
    const userData = userSnap.data() || {};
    const ledgerSnaps = reads.slice(1);
    const existingAchievements = Array.isArray(userData.achievements)
      ? userData.achievements.filter((value: unknown): value is string => typeof value === 'string')
      : [];
    const achievementSet = new Set(existingAchievements);
    const unlockedAchievementIds: string[] = [];
    let xpCredit = 0;
    const now = new Date().toISOString();

    eligibleAchievements.forEach((achievement, index) => {
      const alreadyListed = achievementSet.has(achievement.id);
      if (!alreadyListed) achievementSet.add(achievement.id);
      if (!ledgerSnaps[index].exists) {
        const credit = alreadyListed ? 0 : Math.max(0, Number(achievement.points) || 0);
        if (!alreadyListed) {
          xpCredit += credit;
          unlockedAchievementIds.push(achievement.id);
        }
        transaction.create(ledgerRefs[index], {
          userId,
          achievementId: achievement.id,
          xp: credit,
          origin: alreadyListed ? 'legacy_achievement_reconciliation' : 'social_achievement',
          createdAt: now,
        });
      }
    });

    const currentXP = Math.max(0, Number(userData.xp ?? userData.totalXp) || 0);
    const newXP = currentXP + xpCredit;
    const currentLevel = Math.max(1, Number(userData.level) || getLevelFromXP(currentXP));
    const newLevel = xpCredit > 0 ? getLevelFromXP(newXP) : currentLevel;
    const achievements = [...achievementSet];
    const patch: Record<string, unknown> = {
      ...stats,
      achievements,
      socialStatsVersion: 1,
      socialStatsReconciledAt: now,
    };
    if (xpCredit > 0) {
      patch.xp = newXP;
      patch.totalXp = newXP;
      patch.level = newLevel;
    }
    transaction.set(userRef, patch, { merge: true });

    return {
      ...stats,
      achievements,
      xp: newXP,
      totalXp: newXP,
      level: newLevel,
      unlockedAchievementIds,
    };
  });
}
