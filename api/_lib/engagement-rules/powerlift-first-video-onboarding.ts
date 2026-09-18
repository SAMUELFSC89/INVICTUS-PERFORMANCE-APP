import { db } from '../common.js';
import { isActiveAccountState } from '../account-state.js';
import { brDaysSince } from '../engagement-notification-engine.js';
import type {
  EngagementRule,
  EngagementRuleContext,
  EngagementRuleResult,
} from '../engagement-notification-engine.js';

/**
 * Nudge de onboarding: convida quem ainda não enviou NENHUM vídeo no
 * Invictus Power Lift (campeonato de força gratuito -- ver
 * src/pages/championships/ChampionshipsHub.tsx) a enviar o primeiro. Mesmo
 * drip de dias 1, 3 e 7 usado em first-workout-onboarding.ts.
 */
const ONBOARDING_DAY_OFFSETS = new Set([1, 3, 7]);

export const powerLiftFirstVideoOnboardingRule: EngagementRule = {
  id: 'powerlift-first-video-onboarding',

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

      if (await hasAnyPowerLiftRecord(userId)) continue;

      results.push({
        userId,
        notification: {
          userId,
          title: 'Mostre sua força 🏋️',
          message: 'Envie seu primeiro vídeo no Invictus Power Lift e entre no ranking de força.',
          type: 'system',
          actionUrl: '/power',
        },
      });
    }

    return results;
  },
};

function tokenArrayHasEntries(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

async function hasAnyPowerLiftRecord(userId: string): Promise<boolean> {
  const snapshot = await db.collection('power_records')
    .where('userId', '==', userId)
    .limit(1)
    .get();
  return !snapshot.empty;
}
