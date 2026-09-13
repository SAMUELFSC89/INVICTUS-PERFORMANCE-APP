import { createHash } from 'node:crypto';
import { db } from './common.js';
import {
  ACTIVITY_ECONOMY_VERSION,
  calculateCompletedActivityXPForVersion,
  isActivityEconomyEligible,
  SUPPORTED_ACTIVITY_ECONOMY_VERSIONS,
} from './activity-economy.js';
import { MissionEngine } from './mission-engine.js';
import { getLevelFromXP } from './xpConfig.js';

export interface CompletedActivityRewardInput {
  userId: string;
  activityId: string;
  type: 'workout' | 'cardio';
  durationMinutes: number;
  intensity?: string;
  source?: string;
  /**
   * Somente código server-side que validou criptograficamente/provedorialmente
   * a origem pode marcar uma importação wearable como confiável. Apple Health
   * e Health Connect chegam hoje por payload do cliente e, portanto, deixam
   * este campo ausente/false até existir App Attest/Play Integrity (ou prova
   * equivalente) ligada ao lote.
   */
  sourceVerified?: boolean;
  /** Valor congelado no documento da atividade. Nunca recalcule-o em retry. */
  activityXP?: number;
  economyEligible?: boolean;
  economyVersion?: number;
  /** Lotes fazem uma única reconstrução de missões depois de todos os itens. */
  syncMissions?: boolean;
  occurredAt?: Date | string;
}

/**
 * Credita a recompensa pessoal de uma atividade importada e reconstrói as
 * missões. O ledger usa o ID determinístico da origem, então webhook, sync e
 * retry nunca pagam a mesma atividade duas vezes.
 */
export async function settleCompletedActivityRewards(input: CompletedActivityRewardInput): Promise<{
  economyEligible: boolean;
  activityXP: number;
  credited: boolean;
  economyVersion: number;
}> {
  const calculatedEligibility = isActivityEconomyEligible({
    type: input.type,
    durationMinutes: input.durationMinutes,
  });
  const wearableSource = input.source === 'apple_health' || input.source === 'health_connect';
  const sourceTrustedForRewards = !wearableSource || input.sourceVerified === true;
  // Gate de confiança: um usuário autenticado consegue fabricar um POST válido
  // para /api/wearables. Sem atestação da origem, plausibilidade fisiológica e
  // um toggle "conectado" não provam que a atividade veio do HealthKit/HC.
  // Mantemos histórico/saúde, mas nenhuma origem wearable não atestada pode
  // criar XP, progresso de missão ou Coins indiretamente por resgate.
  const economyEligible = sourceTrustedForRewards && (input.economyEligible === undefined
    ? calculatedEligibility
    : input.economyEligible === true && calculatedEligibility);
  const suppliedVersion = input.economyVersion === undefined ? null : Number(input.economyVersion);
  const formulaVersion = suppliedVersion ?? ACTIVITY_ECONOMY_VERSION;
  const versionSupported = Number.isInteger(formulaVersion)
    && SUPPORTED_ACTIVITY_ECONOMY_VERSIONS.has(formulaVersion);
  const calculatedXP = versionSupported ? calculateCompletedActivityXPForVersion({
    type: input.type,
    durationMinutes: input.durationMinutes,
    intensity: input.intensity,
  }, formulaVersion) : 0;
  const frozenInputXP = Number(input.activityXP);
  const supportedFrozenValue = input.activityXP !== undefined
    && suppliedVersion !== null && versionSupported;
  const activityXP = economyEligible
    ? Number.isFinite(frozenInputXP) && supportedFrozenValue
      ? Math.max(0, Math.round(frozenInputXP))
      : calculatedXP
    : 0;

  if (!economyEligible) {
    return { economyEligible: false, activityXP: 0, credited: false, economyVersion: formulaVersion };
  }

  const settlement = await db.runTransaction(async (transaction) => {
    const ledgerRef = db.collection('activity_reward_ledger').doc(input.activityId);
    const userRef = db.collection('users').doc(input.userId);
    // Mesmo após existir atestação wearable, quota continua sendo defesa em
    // profundidade econômica. Ela não substitui o gate criptográfico acima.
    const quotaDay = new Date().toISOString().slice(0, 10);
    const quotaRef = wearableSource
      ? db.collection('activity_reward_quotas').doc(createHash('sha256').update(`${input.userId}\u0000${quotaDay}`).digest('hex'))
      : null;
    const [ledgerSnap, userSnap, quotaSnap] = await Promise.all([
      transaction.get(ledgerRef),
      transaction.get(userRef),
      quotaRef ? transaction.get(quotaRef) : Promise.resolve(null),
    ]);
    if (ledgerSnap.exists) {
      const ledger = ledgerSnap.data() || {};
      if (ledger.userId !== input.userId || ledger.origin !== 'completed_activity') {
        throw new Error('Ledger de atividade pertence a outro usuário ou origem.');
      }
      const ledgerXP = Number(ledger.xp);
      if (!Number.isFinite(ledgerXP) || ledgerXP < 0) {
        throw new Error('Ledger de atividade possui recompensa inválida.');
      }
      return {
        credited: false,
        activityXP: ledgerXP,
        economyVersion: Number(ledger.economyVersion) || formulaVersion,
      };
    }
    if (!versionSupported) {
      throw new Error(`Versão econômica de atividade não suportada: ${String(input.economyVersion)}.`);
    }
    if (supportedFrozenValue && activityXP !== calculatedXP) {
      throw new Error('Recompensa congelada diverge da fórmula econômica versionada.');
    }
    let awardedXP = activityXP;

    if (wearableSource && quotaRef) {
      const quota = quotaSnap?.exists ? quotaSnap.data() || {} : {};
      const activityCount = Math.max(0, Number(quota.activityCount) || 0);
      const xpTotal = Math.max(0, Number(quota.xpTotal) || 0);
      if (xpTotal >= 1000) {
        transaction.create(ledgerRef, {
          activityId: input.activityId,
          userId: input.userId,
          xp: 0,
          origin: 'completed_activity',
          source: input.source,
          economyVersion: formulaVersion,
          settlementStatus: 'daily_quota_exceeded',
          createdAt: new Date().toISOString(),
        });
        transaction.set(db.collection('workouts').doc(input.activityId), {
          economyEligible: true,
          missionEligible: true,
          activityXpAwarded: 0,
          points: 0,
          pointsEarned: 0,
          scoreAwarded: 0,
          activityRewardStatus: 'daily_quota_exceeded',
          updatedAt: new Date().toISOString(),
        }, { merge: true });
        return { credited: false, activityXP: 0, economyVersion: formulaVersion };
      }
      const quotaActivityXP = Math.min(activityXP, Math.max(0, 1000 - xpTotal));
      transaction.set(quotaRef, {
        userId: input.userId,
        day: quotaDay,
        activityCount: activityCount + 1,
        xpTotal: xpTotal + quotaActivityXP,
        updatedAt: new Date().toISOString(),
      }, { merge: true });
      if (quotaActivityXP !== activityXP) {
        transaction.set(db.collection('workouts').doc(input.activityId), {
          activityXpAwarded: quotaActivityXP,
          points: quotaActivityXP,
          pointsEarned: quotaActivityXP,
          scoreAwarded: quotaActivityXP,
          activityRewardStatus: 'daily_quota_partially_applied',
          updatedAt: new Date().toISOString(),
        }, { merge: true });
      }
      awardedXP = quotaActivityXP;
    }

    const user = userSnap.data() || {};
    const currentXP = Number(user.xp ?? user.totalXp) || 0;
    const newXP = currentXP + awardedXP;
    transaction.set(userRef, {
      xp: newXP,
      totalXp: newXP,
      level: getLevelFromXP(newXP),
      updatedAt: new Date().toISOString(),
    }, { merge: true });
    transaction.create(ledgerRef, {
      activityId: input.activityId,
      userId: input.userId,
      xp: awardedXP,
      origin: 'completed_activity',
      source: input.source || 'external_sync',
      economyVersion: formulaVersion,
      createdAt: new Date().toISOString(),
    });
    return { credited: true, activityXP: awardedXP, economyVersion: formulaVersion };
  });

  // Também em retry: o ledger pode já existir enquanto uma falha anterior
  // aconteceu antes da atualização das missões.
  if (input.syncMissions !== false) {
    await MissionEngine.syncUserProgressFromCompletedActivities(
      input.userId,
      input.occurredAt ? [input.occurredAt] : [],
    );
  }
  return {
    economyEligible: true,
    activityXP: settlement.activityXP,
    credited: settlement.credited,
    economyVersion: settlement.economyVersion,
  };
}
