import { db } from '../common.js';
import { isActiveAccountState } from '../account-state.js';
import { brDaysSince } from '../engagement-notification-engine.js';
import type {
  EngagementRule,
  EngagementRuleContext,
  EngagementRuleResult,
} from '../engagement-notification-engine.js';

/**
 * Nudge de onboarding: convida quem ainda não fez NENHUM treino de
 * musculação (desde sempre, não só hoje) a fazer o primeiro. Dispara nos
 * dias 1, 3 e 7 depois do cadastro -- não todo dia, para não cansar quem
 * ainda está conhecendo o app (mesmo padrão de drip de onboarding usado por
 * apps de hábito como Duolingo/Strava: alguns toques espaçados, não diários).
 */
const ONBOARDING_DAY_OFFSETS = new Set([1, 3, 7]);

export const firstWorkoutOnboardingRule: EngagementRule = {
  id: 'first-workout-onboarding',

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

      if (await hasWorkoutOfType(userId, 'workout')) continue;

      results.push({
        userId,
        notification: {
          userId,
          title: 'Que tal seu primeiro treino? 💪',
          message: 'Registre seu primeiro treino de musculação no Invictus e comece a subir no ranking.',
          type: 'system',
          actionUrl: '/musculacao',
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
