import { db } from '../common.js';
import { isActiveAccountState } from '../account-state.js';
import { brDaysSince } from '../engagement-notification-engine.js';
import type {
  EngagementRule,
  EngagementRuleContext,
  EngagementRuleResult,
} from '../engagement-notification-engine.js';

/**
 * Nudge de onboarding: convida quem ainda não fez NENHUM cardio (desde
 * sempre) a registrar o primeiro. Mesmo drip de dias 1, 3 e 7 usado em
 * first-workout-onboarding.ts -- ver comentário lá para o motivo do
 * espaçamento em vez de disparo diário.
 */
const ONBOARDING_DAY_OFFSETS = new Set([1, 3, 7]);

export const firstCardioOnboardingRule: EngagementRule = {
  id: 'first-cardio-onboarding',

  async buildCandidates(
    ctx: EngagementRuleContext,
    candidateUserIds: string[],
  ): Promise<EngagementRuleResult[]> {
    const results: EngagementRuleResult[] = [];

    for (const userId of candidateUserIds) {
      const profileSnap = await db.collection('users').doc(userId).get();
      if (!profileSnap.exists) continue;
      const profile = profileSnap.data() || {};
      if (!isActiveAccountState(profile)) continue;

      const hasPushToken = tokenArrayHasEntries(profile.fcmTokens) || tokenArrayHasEntries(profile.apnsTokens);
      if (!hasPushToken) continue;

      const daysSince = brDaysSince(profile.createdAt, ctx);
      if (daysSince === null || !ONBOARDING_DAY_OFFSETS.has(daysSince)) continue;

      if (await hasWorkoutOfType(userId, 'cardio')) continue;

      results.push({
        userId,
        notification: {
          userId,
          title: 'Hora do seu primeiro cardio 🏃',
          message: 'Escolha uma modalidade e registre sua primeira atividade de cardio no Invictus.',
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

async function hasWorkoutOfType(userId: string, type: string): Promise<boolean> {
  const snapshot = await db.collection('workouts')
    .where('userId', '==', userId)
    .where('type', '==', type)
    .limit(1)
    .get();
  return !snapshot.empty;
}
