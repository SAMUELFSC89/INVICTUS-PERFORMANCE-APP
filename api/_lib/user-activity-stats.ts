import { createHash } from 'node:crypto';
import { db } from './common.js';
import { getLevelFromXP } from './xpConfig.js';
import { activityAchievementsForStats } from '../../src/achievements.js';
import { readActivityTimestamp, resolveActivityState } from '../../src/lib/workoutData.js';

export interface UserActivityStats {
  totalWorkouts: number;
  totalActiveDays: number;
  totalTimeSpent: number;
  streak: number;
  lastCheckIn: string | null;
}

export interface UserActivityStatsReconciliation extends UserActivityStats {
  achievements: string[];
  xp: number;
  totalXp: number;
  level: number;
  unlockedAchievementIds: string[];
}

function dayKeyUtc(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function previousDayKey(key: string): string {
  const date = new Date(`${key}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

/**
 * Estatísticas pessoais contam registros concluídos e economicamente válidos
 * da fonte canônica, não a elegibilidade competitiva. Uma atividade pode ser
 * válida como histórico pessoal e ficar fora do ranking; duplicatas, sessões
 * técnicas curtas, registros descartados e bloqueios de segurança nunca devem
 * inflar total, dias ativos ou streak.
 */
export function isCanonicalCompletedActivityForStats(data: Record<string, any>): boolean {
  const quality = String(data?.dataQualityStatus || '').toLowerCase();
  const reason = String(data?.nonScoringReason || '').toUpperCase();
  if (['duplicate', 'discarded', 'dedup_pending'].includes(quality)) return false;
  if (reason === 'DUPLICATE_ACTIVITY') return false;
  if (data?.economyEligible === false || data?.missionEligible === false) return false;
  if (data?.securityBlocked === true || data?.pendingReview === true) return false;
  return resolveActivityState(data).isCompleted;
}

export function deriveUserActivityStats(
  records: Array<Record<string, any>>,
  now: Date = new Date(),
): UserActivityStats {
  const completed = records.flatMap((record) => {
    if (!isCanonicalCompletedActivityForStats(record)) return [];
    const timestamp = readActivityTimestamp(
      record.endTime ?? record.startTime ?? record.timestamp ?? record.createdAt,
    );
    if (timestamp === null || timestamp > now.getTime() + 5 * 60_000) return [];
    const duration = Number(record.duration ?? record.durationMinutes ?? record.durationMins);
    return [{
      timestamp,
      day: dayKeyUtc(timestamp),
      duration: Number.isFinite(duration) && duration > 0 ? duration : 0,
    }];
  });

  completed.sort((a, b) => a.timestamp - b.timestamp);
  const activeDays = new Set(completed.map((record) => record.day));
  const today = dayKeyUtc(now.getTime());
  const yesterday = previousDayKey(today);
  let cursor = activeDays.has(today) ? today : activeDays.has(yesterday) ? yesterday : null;
  let streak = 0;
  while (cursor && activeDays.has(cursor)) {
    streak += 1;
    cursor = previousDayKey(cursor);
  }

  const latest = completed.length ? completed[completed.length - 1] : undefined;
  return {
    totalWorkouts: completed.length,
    totalActiveDays: activeDays.size,
    totalTimeSpent: Math.round(completed.reduce((sum, record) => sum + record.duration, 0)),
    streak,
    lastCheckIn: latest ? new Date(latest.timestamp).toISOString() : null,
  };
}

function achievementLedgerId(userId: string, achievementId: string): string {
  return `achievement_${createHash('sha256').update(`${userId}\u0000${achievementId}`).digest('hex')}`;
}

/**
 * Reconciliação idempotente: recalcula a partir de `workouts` em vez de
 * incrementar campos cegamente. Isso recupera automaticamente contadores
 * antigos que ficaram para trás e não duplica estatísticas ou XP em retries.
 *
 * Somente os marcos de atividade/frequência entram aqui. Conquistas sociais e
 * de ranking dependem das respectivas fontes autoritativas e não são inferidas
 * a partir do histórico de treino.
 */
export async function reconcileUserActivityStats(userId: string): Promise<UserActivityStatsReconciliation> {
  const snapshot = await db.collection('workouts').where('userId', '==', userId).get();
  const stats = deriveUserActivityStats(snapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() })));
  const eligibleAchievements = activityAchievementsForStats(stats);
  const userRef = db.collection('users').doc(userId);
  const ledgerRefs = eligibleAchievements.map((achievement) =>
    db.collection('achievement_reward_ledger').doc(achievementLedgerId(userId, achievement.id)));

  const reconciled = await db.runTransaction(async (transaction: any): Promise<UserActivityStatsReconciliation> => {
    const reads = await Promise.all([
      transaction.get(userRef),
      ...ledgerRefs.map((ref) => transaction.get(ref)),
    ]);
    const userSnap = reads[0];
    if (!userSnap.exists) throw new Error('Perfil do atleta não encontrado para reconciliar estatísticas.');
    const userData = userSnap.data() || {};
    const ledgerSnaps = reads.slice(1);
    const existingAchievements: string[] = Array.isArray(userData.achievements)
      ? (userData.achievements as unknown[]).filter((value: unknown): value is string => typeof value === 'string')
      : [];
    const achievementSet = new Set<string>(existingAchievements);
    const unlockedAchievementIds: string[] = [];
    let xpCredit = 0;
    const now = new Date().toISOString();

    eligibleAchievements.forEach((achievement, index) => {
      const alreadyListed = achievementSet.has(achievement.id);
      const ledgerSnap = ledgerSnaps[index];
      if (!alreadyListed) achievementSet.add(achievement.id);

      if (!ledgerSnap.exists) {
        const credit = alreadyListed ? 0 : Math.max(0, Number(achievement.points) || 0);
        if (!alreadyListed) {
          xpCredit += credit;
          unlockedAchievementIds.push(achievement.id);
        }
        transaction.create(ledgerRefs[index], {
          userId,
          achievementId: achievement.id,
          xp: credit,
          origin: alreadyListed ? 'legacy_achievement_reconciliation' : 'activity_achievement',
          createdAt: now,
        });
      }
    });

    const currentXP = Math.max(0, Number(userData.xp ?? userData.totalXp) || 0);
    const newXP = currentXP + xpCredit;
    const currentLevel = Math.max(1, Number(userData.level) || getLevelFromXP(currentXP));
    const newLevel = xpCredit > 0 ? getLevelFromXP(newXP) : currentLevel;
    const achievements: string[] = [...achievementSet];
    const patch: Record<string, unknown> = {
      ...stats,
      achievements,
      activityStatsVersion: 2,
      activityStatsReconciledAt: now,
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

  // O mesmo ponto de reconciliação executado após atividades e no carregamento
  // do perfil recupera missões de cardio independentemente da tela que iniciou
  // a sessão. O import é tardio para manter os helpers puros de estatística sem
  // carregar a infraestrutura de push nos testes/consumidores que só derivam dados.
  try {
    const { reconcileRecentCardioObjectives } = await import('./cardio-objective-activity-sync.js');
    await reconcileRecentCardioObjectives(userId);
  } catch (error: any) {
    console.warn(`[ACTIVITY_STATS] Falha não bloqueante ao reconciliar Buscar Objetivo: ${error?.message || error}`);
  }

  return reconciled;
}
