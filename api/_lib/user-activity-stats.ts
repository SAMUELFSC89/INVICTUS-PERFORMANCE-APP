import { db } from './common.js';
import { readActivityTimestamp, resolveActivityState } from '../../src/lib/workoutData.js';

export interface UserActivityStats {
  totalWorkouts: number;
  totalActiveDays: number;
  totalTimeSpent: number;
  streak: number;
  lastCheckIn: string | null;
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

/**
 * Reconciliação idempotente: recalcula a partir de `workouts` em vez de
 * incrementar campos cegamente. Isso recupera automaticamente contadores
 * antigos que ficaram para trás e não duplica estatísticas em retries.
 */
export async function reconcileUserActivityStats(userId: string): Promise<UserActivityStats> {
  const snapshot = await db.collection('workouts').where('userId', '==', userId).get();
  const stats = deriveUserActivityStats(snapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() })));
  await db.collection('users').doc(userId).set({
    ...stats,
    activityStatsVersion: 1,
    activityStatsReconciledAt: new Date().toISOString(),
  }, { merge: true });
  return stats;
}
