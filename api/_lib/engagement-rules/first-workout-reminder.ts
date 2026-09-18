import { db } from '../common.js';
import { isActiveAccountState } from '../account-state.js';
import type {
  EngagementRule,
  EngagementRuleContext,
  EngagementRuleResult,
} from '../engagement-notification-engine.js';

/**
 * Lembrete diário: "você ainda não treinou hoje". Dispara às 20h de
 * Brasília (ver vercel.json) para quem tem push ativo, ainda não registrou
 * nenhum treino no dia local e cuja conta está ativa.
 */
export const firstWorkoutOfDayReminderRule: EngagementRule = {
  id: 'first-workout-of-day',

  async buildCandidates(
    ctx: EngagementRuleContext,
    candidateUserIds: string[],
  ): Promise<EngagementRuleResult[]> {
    if (candidateUserIds.length === 0) return [];

    const trainedTodayUserIds = await usersWithWorkoutToday(ctx);
    const results: EngagementRuleResult[] = [];

    for (const userId of candidateUserIds) {
      if (trainedTodayUserIds.has(userId)) continue;

      const profileSnap = await db.collection('users').doc(userId).get();
      if (!profileSnap.exists) continue;
      const profile = profileSnap.data() || {};
      if (!isActiveAccountState(profile)) continue;

      const hasPushToken = tokenArrayHasEntries(profile.fcmTokens) || tokenArrayHasEntries(profile.apnsTokens);
      if (!hasPushToken) continue;

      results.push({
        userId,
        notification: {
          userId,
          title: 'Bora treinar? 💪',
          message: 'Você ainda não treinou hoje. Um treino rápido já conta pro seu ranking.',
          type: 'system',
          actionUrl: '/activity',
        },
      });
    }

    return results;
  },
};

function tokenArrayHasEntries(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

async function usersWithWorkoutToday(ctx: EngagementRuleContext): Promise<Set<string>> {
  const snapshot = await db.collection('workouts')
    .where('createdAt', '>=', ctx.dayStartUTC.toISOString())
    .where('createdAt', '<', ctx.dayEndUTC.toISOString())
    .get();

  const uids = new Set<string>();
  snapshot.docs.forEach((docSnap: any) => {
    const userId = String(docSnap.data()?.userId || '');
    if (userId) uids.add(userId);
  });
  return uids;
}
