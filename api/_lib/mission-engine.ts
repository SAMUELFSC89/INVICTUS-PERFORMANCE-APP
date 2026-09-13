import { db } from './common.js';
import { RewardCoinEngine } from './reward-coin-engine.js';
import { getLevelFromXP } from './xpConfig.js';
import { Mission, UserMissionProgress } from '../../src/types.js';

export const MISSION_ECONOMY_VERSION = 2;
const RETIRED_MISSION_IDS = new Set([
  'miss_train_5_days', 'miss_cardio_30_mins', 'miss_streak_7_days',
  'miss_gym_checkins_3', 'miss_monthly_challenge_30',
]);

const MISSION_CATEGORIES = new Set(['daily', 'weekly', 'monthly', 'special']);
const MISSION_TYPES = new Set([
  'workout_count', 'strength_workout_count', 'cardio_count', 'cardio_minutes',
  'hybrid_week', 'consistency_weeks', 'personal_best', 'performance_zone',
  'monthly_active_weeks', 'event_count', 'streak_days', 'total_days', 'gym_checkins',
]);
const MISSION_LEDGER_TYPES = new Set(['MISSION_REWARD', 'CONSISTENCY_REWARD', 'PRO_MISSION_REWARD']);
const MISSION_TIME_ZONE = (() => {
  const requested = process.env.MISSION_TIME_ZONE || 'America/Sao_Paulo';
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: requested }).resolvedOptions().timeZone;
  } catch {
    return 'America/Sao_Paulo';
  }
})();

function zonedCalendarParts(date: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: MISSION_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(part => part.type === type)?.value);
  return { year: read('year'), month: read('month'), day: read('day') };
}

function zonedDayIndex(date: Date): number {
  const { year, month, day } = zonedCalendarParts(date);
  return Math.floor(Date.UTC(year, month - 1, day) / 86400000);
}

function zonedDateKey(date: Date): string {
  const { year, month, day } = zonedCalendarParts(date);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function zonedMonthKey(date: Date): string {
  return zonedDateKey(date).slice(0, 7);
}

function validateMissionDefinition(input: unknown): Mission {
  const value = (input && typeof input === 'object' ? input : {}) as Record<string, any>;
  const finiteInteger = (candidate: unknown, min: number, max: number, field: string): number => {
    const parsed = Number(candidate);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
      throw new Error(`Definição de missão inválida: ${field}.`);
    }
    return parsed;
  };
  const id = String(value.id || '').trim();
  const title = String(value.title || '').trim();
  const description = String(value.description || '').trim();
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(id) || !title || title.length > 160
    || !description || description.length > 600) {
    throw new Error('Definição de missão inválida: identificação ou texto.');
  }
  if (!MISSION_CATEGORIES.has(value.category) || !MISSION_TYPES.has(value.type)) {
    throw new Error('Definição de missão inválida: categoria ou tipo.');
  }
  const target = finiteInteger(value.target, 1, 100_000, 'target');
  const rewardCoins = finiteInteger(value.rewardCoins, 0, 100_000, 'rewardCoins');
  const rewardXP = finiteInteger(value.rewardXP, 0, 100_000, 'rewardXP');
  const ledgerType = value.ledgerType || (value.isFreeAccess ? 'MISSION_REWARD' : 'PRO_MISSION_REWARD');
  if (!MISSION_LEDGER_TYPES.has(ledgerType) || value.rewardCategory !== 'ecosystem'
    || typeof value.isFreeAccess !== 'boolean' || typeof value.active !== 'boolean') {
    throw new Error('Definição de missão inválida: política de recompensa ou acesso.');
  }
  return {
    id,
    title,
    description,
    category: value.category,
    type: value.type,
    target,
    rewardCoins,
    rewardCategory: 'ecosystem',
    rewardXP,
    ...(typeof value.rewardBadge === 'string' && value.rewardBadge.trim()
      ? { rewardBadge: value.rewardBadge.trim().slice(0, 120) } : {}),
    isFreeAccess: value.isFreeAccess,
    ledgerType,
    ...(value.weeklyGoal !== undefined
      ? { weeklyGoal: finiteInteger(value.weeklyGoal, 1, 31, 'weeklyGoal') } : {}),
    definitionVersion: value.definitionVersion === undefined
      ? MISSION_ECONOMY_VERSION
      : finiteInteger(value.definitionVersion, 1, 10_000, 'definitionVersion'),
    active: value.active,
  } as Mission;
}

function frozenMissionDefinition(mission: Mission): Record<string, unknown> {
  return {
    rewardCoinsSnapshot: Number(mission.rewardCoins) || 0,
    rewardXPSnapshot: Number(mission.rewardXP) || 0,
    rewardCategorySnapshot: mission.rewardCategory || 'ecosystem',
    ledgerTypeSnapshot: mission.ledgerType || (mission.isFreeAccess ? 'MISSION_REWARD' : 'PRO_MISSION_REWARD'),
    missionTitleSnapshot: mission.title,
    missionDescriptionSnapshot: mission.description,
    missionCategorySnapshot: mission.category,
    missionTypeSnapshot: mission.type,
    targetSnapshot: Number(mission.target) || 0,
    weeklyGoalSnapshot: Number(mission.weeklyGoal) || 0,
    timeZoneSnapshot: MISSION_TIME_ZONE,
    isFreeAccessSnapshot: mission.isFreeAccess === true,
    definitionVersionSnapshot: Number(mission.definitionVersion) || MISSION_ECONOMY_VERSION,
  };
}

/**
 * Mission progress and competitive scoring are separate axes, but an activity
 * that is known fraud (or is still waiting for a technical security result)
 * cannot be used as a substitute for a legitimate workout. Competition-only
 * ineligibility such as a missing championship/geofence requirement remains
 * eligible for casual missions when the underlying activity itself is valid.
 */
function missionActivityIsEligible(data: Record<string, any>): boolean {
  const source = String(data.source || '').toLowerCase();
  const wearableSource = source === 'apple_health' || source === 'health_connect';
  const evidenceStatus = String(data.competitionEvidenceStatus || '').toLowerCase();
  const wearableTrusted = !wearableSource
    || evidenceStatus === 'trusted_native_attestation'
    || evidenceStatus === 'trusted_server_source';
  // Defesa em profundidade para documentos legados: reconstruções globais de
  // missão não podem confiar apenas em flags antigas economy/missionEligible.
  // Wearable só entra na economia depois de prova server-side persistida.
  if (!wearableTrusted) return false;

  const quality = String(data.dataQualityStatus || '').toLowerCase();
  if (data.missionEligible === false || data.economyEligible === false
    || ['duplicate', 'discarded', 'dedup_pending'].includes(quality)) return false;

  const status = String(data.status || '').toLowerCase();
  const recordStatus = String(data.recordStatus || '').toLowerCase();
  const validation = String(data.validationStatus ?? data.validation?.status ?? '').toLowerCase();
  const competitionReviewStatus = String(data.competitionReviewStatus || data.competitionStatus || '').toLowerCase();
  const securityDecision = String(data.securityDecision || '').toUpperCase();
  const reason = String(data.nonScoringReason || data.rejectionReason || '').toUpperCase();

  const technicalPending = data.pendingReview === true
    || competitionReviewStatus === 'pending_review'
    || validation === 'pending_review'
    || securityDecision === 'ERROR'
    || reason === 'SECURITY_PIPELINE_ERROR';
  const terminalFraud = data.securityBlocked === true
    || competitionReviewStatus === 'rejected'
    || validation === 'rejected'
    || ['BLOCKED', 'UNDER_REVIEW', 'PARTIALLY_APPROVED'].includes(securityDecision)
    || ['rejected', 'suspicious', 'discarded'].includes(status)
    || reason === 'COMPETITIVE_SANITY_CHECK'
    || ['SECURITY_PIPELINE_BLOCKED', 'SECURITY_PIPELINE_UNDER_REVIEW', 'SECURITY_PIPELINE_PARTIALLY_APPROVED'].includes(reason);

  if (technicalPending || terminalFraud) return false;
  if (recordStatus === 'completed') return true;
  if (['valid', 'validated', 'approved', 'homologated', 'homologada'].includes(status)
    || ['valid', 'validated', 'approved', 'homologated', 'homologada'].includes(validation)) return true;
  // Compatibilidade: o fluxo anterior salvava atividade casual concluída
  // como completed + not_eligible.
  return status === 'completed' && ['not_eligible', 'recorded', 'not_required'].includes(validation);
}

export const DEFAULT_MISSIONS: Mission[] = [
  {
    id: 'miss_trinca_invictus', title: 'Trinca Invictus',
    description: 'Complete 3 treinos de musculação nesta semana.',
    category: 'weekly',
    type: 'strength_workout_count', target: 3, rewardCoins: 40, rewardCategory: 'ecosystem', rewardXP: 0,
    isFreeAccess: true, ledgerType: 'MISSION_REWARD', definitionVersion: MISSION_ECONOMY_VERSION, active: true,
  },
  {
    id: 'miss_semana_de_aco', title: 'Semana de Aço',
    description: 'Complete 4 treinos de musculação nesta semana.',
    category: 'weekly', type: 'strength_workout_count', target: 4, rewardCoins: 60, rewardCategory: 'ecosystem', rewardXP: 0,
    isFreeAccess: true, ledgerType: 'MISSION_REWARD', definitionVersion: MISSION_ECONOMY_VERSION, active: true,
  },
  {
    id: 'miss_motor_ligado', title: 'Motor Ligado',
    description: 'Complete 2 sessões de cardio nesta semana.',
    category: 'weekly', type: 'cardio_count', target: 2, rewardCoins: 40, rewardCategory: 'ecosystem', rewardXP: 0,
    isFreeAccess: true, ledgerType: 'MISSION_REWARD', definitionVersion: MISSION_ECONOMY_VERSION, active: true,
  },
  {
    id: 'miss_guerreiro_hibrido', title: 'Guerreiro Híbrido',
    description: 'Faça musculação e cardio na mesma semana.',
    category: 'weekly', type: 'hybrid_week', target: 1, rewardCoins: 60, rewardCategory: 'ecosystem', rewardXP: 0,
    isFreeAccess: true, ledgerType: 'MISSION_REWARD', definitionVersion: MISSION_ECONOMY_VERSION, active: true,
  },
  {
    id: 'miss_consistencia_2', title: 'Consistência — 2 Semanas', description: 'Cumpra sua meta em 2 semanas consecutivas neste mês.',
    category: 'monthly', type: 'consistency_weeks', target: 2, weeklyGoal: 3, rewardCoins: 100, rewardCategory: 'ecosystem', rewardXP: 0,
    isFreeAccess: true, ledgerType: 'CONSISTENCY_REWARD', definitionVersion: MISSION_ECONOMY_VERSION, active: true,
  },
  {
    id: 'miss_consistencia_3', title: 'Consistência — 3 Semanas', description: 'Mantenha a meta por 3 semanas consecutivas e avance na trilha mensal.',
    category: 'monthly', type: 'consistency_weeks', target: 3, weeklyGoal: 3, rewardCoins: 100, rewardCategory: 'ecosystem', rewardXP: 0,
    isFreeAccess: true, ledgerType: 'CONSISTENCY_REWARD', definitionVersion: MISSION_ECONOMY_VERSION, active: true,
  },
  {
    id: 'miss_consistencia_4', title: 'Consistência — 4 Semanas', description: 'Complete 4 semanas consecutivas cumprindo sua meta semanal.',
    category: 'monthly', type: 'consistency_weeks', target: 4, weeklyGoal: 3, rewardCoins: 200, rewardCategory: 'ecosystem', rewardXP: 0,
    isFreeAccess: true, ledgerType: 'CONSISTENCY_REWARD', definitionVersion: MISSION_ECONOMY_VERSION, active: true,
  },
  {
    id: 'miss_supere_voce', title: 'Supere Você Mesmo', description: 'Supere uma marca pessoal neste mês.',
    category: 'monthly', type: 'personal_best', target: 1, rewardCoins: 80, rewardCategory: 'ecosystem', rewardXP: 0,
    isFreeAccess: true, ledgerType: 'MISSION_REWARD', definitionVersion: MISSION_ECONOMY_VERSION, active: true,
  },
  {
    id: 'miss_ritmo_elite', title: 'Ritmo de Elite', description: 'Complete 5 treinos de musculação nesta semana.',
    category: 'weekly', type: 'strength_workout_count', target: 5, rewardCoins: 80, rewardCategory: 'ecosystem', rewardXP: 0,
    isFreeAccess: false, ledgerType: 'PRO_MISSION_REWARD', definitionVersion: MISSION_ECONOMY_VERSION, active: true,
  },
  {
    id: 'miss_zona_performance', title: 'Zona de Performance', description: 'Conclua o objetivo semanal da sua Zona de Performance.',
    category: 'weekly', type: 'performance_zone', target: 1, rewardCoins: 70, rewardCategory: 'ecosystem', rewardXP: 0,
    isFreeAccess: false, ledgerType: 'PRO_MISSION_REWARD', definitionVersion: MISSION_ECONOMY_VERSION, active: true,
  },
  {
    id: 'miss_invictus_ia', title: 'Missão Invictus IA', description: 'Conclua a missão semanal personalizada pela Invictus IA.',
    category: 'weekly', type: 'event_count', target: 1, rewardCoins: 100, rewardCategory: 'ecosystem', rewardXP: 0,
    isFreeAccess: false, ledgerType: 'PRO_MISSION_REWARD', definitionVersion: MISSION_ECONOMY_VERSION, active: true,
  },
  {
    id: 'miss_secreta', title: 'Missão Secreta', description: 'Descubra e conclua a missão secreta semanal.',
    category: 'weekly', type: 'event_count', target: 1, rewardCoins: 100, rewardCategory: 'ecosystem', rewardXP: 0,
    isFreeAccess: false, ledgerType: 'PRO_MISSION_REWARD', definitionVersion: MISSION_ECONOMY_VERSION, active: true,
  },
  {
    id: 'miss_bau_invictus', title: 'Baú Invictus', description: 'Complete os requisitos semanais para abrir o Baú Invictus.',
    category: 'weekly', type: 'event_count', target: 1, rewardCoins: 100, rewardCategory: 'ecosystem', rewardXP: 0,
    isFreeAccess: false, ledgerType: 'PRO_MISSION_REWARD', definitionVersion: MISSION_ECONOMY_VERSION, active: true,
  },
  {
    id: 'miss_mes_invictus_pro', title: 'Mês Invictus PRO', description: 'Cumpra a meta de 4 treinos em cada semana da trilha mensal.',
    category: 'monthly', type: 'monthly_active_weeks', target: 4, weeklyGoal: 4, rewardCoins: 300, rewardCategory: 'ecosystem', rewardXP: 0,
    isFreeAccess: false, ledgerType: 'PRO_MISSION_REWARD', definitionVersion: MISSION_ECONOMY_VERSION, active: true,
  },
  {
    id: 'miss_lendaria', title: 'Missão Lendária', description: 'Conclua a missão lendária mensal publicada para atletas PRO.',
    category: 'monthly', type: 'event_count', target: 1, rewardCoins: 400, rewardCategory: 'ecosystem', rewardXP: 0,
    isFreeAccess: false, ledgerType: 'PRO_MISSION_REWARD', definitionVersion: MISSION_ECONOMY_VERSION, active: true,
  },
];

export class MissionEngine {
  private static periodKey(mission: Mission, now = new Date()): string {
    if (mission.category === 'daily') return zonedDateKey(now);
    if (mission.category === 'monthly') return zonedMonthKey(now);
    if (mission.category === 'weekly') {
      const { year, month, day: monthDay } = zonedCalendarParts(now);
      const date = new Date(Date.UTC(year, month - 1, monthDay));
      const day = date.getUTCDay() || 7;
      date.setUTCDate(date.getUTCDate() + 4 - day);
      const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
      const week = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
      return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
    }
    return 'permanent';
  }

  private static progressId(userId: string, mission: Mission, now = new Date()): string {
    return this.progressIdForPeriod(userId, mission.id, this.periodKey(mission, now));
  }

  private static progressIdForPeriod(userId: string, missionId: string, periodKey: string): string {
    return `um_${userId}_${missionId}_${periodKey}`;
  }

  /**
   * Fetches all active system missions.
   */
  static async getMissions(): Promise<Mission[]> {
    if (!db) return DEFAULT_MISSIONS;
    try {
      const snap = await db.collection('missions').where('active', '==', true).get();
      const defaultsById = new Map(DEFAULT_MISSIONS.map(mission => [mission.id, mission]));
      const custom = snap.docs.flatMap(doc => {
        try {
          return [validateMissionDefinition({ ...doc.data(), id: doc.data()?.id || doc.id })];
        } catch (error) {
          console.warn(`[MissionEngine] Ignorando missão inválida ${doc.id}:`, error);
          return [];
        }
      }).filter(mission => !defaultsById.has(mission.id) && !RETIRED_MISSION_IDS.has(mission.id));
      // A leitura de missões acontece também na finalização de atividades. Não
      // faça seed/migração a cada treino: além de latência, isso multiplicava
      // escritas em todos os fluxos casuais. Defaults são mesclados em memória;
      // publicação administrativa continua sendo feita por upsertMission().
      return [...DEFAULT_MISSIONS, ...custom];
    } catch (err) {
      console.warn('[MissionEngine] Error fetching missions from DB:', err);
      return DEFAULT_MISSIONS;
    }
  }

  /**
   * Fetches user mission progress records.
   */
  static async getUserMissionProgress(userId: string): Promise<UserMissionProgress[]> {
    if (!db) return [];
    try {
      const snap = await db.collection('user_missions').where('userId', '==', userId).get();
      const newest = new Map<string, UserMissionProgress>();
      snap.docs.map(doc => ({ ...doc.data(), id: doc.id } as UserMissionProgress)).forEach(item => {
        const previous = newest.get(item.missionId);
        const pendingClaim = (item as any).claimState === 'pending' && item.claimed !== true;
        const previousPendingClaim = (previous as any)?.claimState === 'pending' && previous?.claimed !== true;
        const unclaimedCompletion = item.completed === true && item.claimed !== true;
        const previousUnclaimedCompletion = previous?.completed === true && previous?.claimed !== true;
        const priority = pendingClaim ? 2 : unclaimedCompletion ? 1 : 0;
        const previousPriority = previousPendingClaim ? 2 : previousUnclaimedCompletion ? 1 : 0;
        if (!previous || priority > previousPriority
          || (priority === previousPriority
            && String(item.updatedAt).localeCompare(String(previous.updatedAt)) > 0)) {
          newest.set(item.missionId, item);
        }
      });
      return [...newest.values()];
    } catch (err) {
      console.warn('[MissionEngine] Error fetching user mission progress:', err);
      return [];
    }
  }

  /**
   * Updates progress for a user's mission and checks for completion.
   */
  static async updateProgress(userId: string, missionId: string, currentProgress: number): Promise<UserMissionProgress> {
    if (!db) throw new Error('Database not initialized');
    const missions = await this.getMissions();
    const mission = missions.find(m => m.id === missionId);
    if (!mission) throw new Error('Missão não encontrada');

    const progressId = this.progressId(userId, mission);
    const docRef = db.collection('user_missions').doc(progressId);
    const snap = await docRef.get();

    let existingProgress: UserMissionProgress = {
      id: progressId,
      userId,
      missionId,
      currentProgress: 0,
      target: mission.target,
      completed: false,
      claimed: false,
      updatedAt: new Date().toISOString(),
      ...frozenMissionDefinition(mission),
    };

    if (snap.exists) {
      existingProgress = snap.data() as UserMissionProgress;
    }

    if (existingProgress.claimed) return existingProgress;

    const newProgress = Math.min(mission.target, currentProgress);
    const completed = newProgress >= mission.target;

    const updated: UserMissionProgress = {
      ...existingProgress,
      currentProgress: newProgress,
      completed,
      completionAccessGranted: existingProgress.completionAccessGranted === true
        || (completed && mission.isFreeAccess),
      ...(completed && !(existingProgress as any).completedAt ? { completedAt: new Date().toISOString() } : {}),
      updatedAt: new Date().toISOString()
    };

    await docRef.set(updated, { merge: true });
    return updated;
  }

  /**
   * Rebuilds mission progress from server-recorded completed activities.
   * Casual activities count here by product rule; competition approval is a
   * separate axis used only by ranking/championship scoring. Fraud and an
   * unresolved technical security state never count as casual progress.
   */
  static async syncUserProgressFromCompletedActivities(
    userId: string,
    affectedAt: Array<Date | string> = [],
  ): Promise<void> {
    if (!db) throw new Error('Database not initialized');
    const missions = await this.getMissions();
    if (!missions.length) return;
    const [snap, eventSnap] = await Promise.all([
      db.collection('workouts').where('userId', '==', userId).get(),
      db.collection('mission_events').where('userId', '==', userId).get().catch(() => null),
    ]);
    const readDate = (value: any): Date | null => {
      const raw = value?.toDate ? value.toDate() : value?._seconds ? new Date(value._seconds * 1000) : new Date(value);
      return Number.isNaN(raw.getTime()) ? null : raw;
    };
    const now = new Date();
    const validated = snap.docs.map(doc => doc.data()).filter(missionActivityIsEligible).map(data => ({
      ...data,
      // O desafio pertence ao período em que a atividade ocorreu, não ao dia
      // em que um envio offline finalmente chegou ao servidor.
      date: readDate(data.endTime ?? data.startTime ?? data.timestamp ?? data.createdAt),
    })).filter(data => data.date && data.date <= now) as Array<Record<string, any> & { date: Date }>;
    const longestQualifiedMonthStreak = (
      activities: Array<Record<string, any> & { date: Date }>,
      goal: number,
      monthKey: string,
    ) => {
      const weeks = new Map<string, { start: number; count: number }>();
      activities.filter(item => item.type === 'workout' && zonedMonthKey(item.date) === monthKey).forEach(item => {
        const itemDayIndex = zonedDayIndex(item.date);
        const weekday = new Date(itemDayIndex * 86400000).getUTCDay() || 7;
        const start = itemDayIndex - (weekday - 1);
        const key = String(start);
        const previous = weeks.get(key);
        weeks.set(key, { start, count: (previous?.count || 0) + 1 });
      });
      const counts = [...weeks.values()].sort((a, b) => a.start - b.start);
      let longest = 0;
      let current = 0;
      let previousStart: number | null = null;
      counts.forEach(week => {
        const consecutive = previousStart !== null && week.start - previousStart === 7;
        current = week.count >= goal ? (consecutive ? current + 1 : 1) : 0;
        longest = Math.max(longest, current);
        previousStart = week.start;
      });
      return Math.min(4, longest);
    };
    const missionEvents = (eventSnap?.docs || []).map(doc => doc.data()).filter(data => {
      const status = String(data.status ?? data.validationStatus ?? '').toLowerCase();
      return ['validated', 'valid', 'approved', 'completed'].includes(status);
    }).map(data => ({ ...data, date: readDate(data.occurredAt ?? data.completedAt ?? data.createdAt) }))
      .filter(data => data.date && data.date <= now) as Array<Record<string, any> & { date: Date }>;

    const calculateProgress = (mission: Mission, targetPeriodKey: string, referenceDate: Date): number => {
      const accessActivities = mission.isFreeAccess
        ? validated
        : validated.filter(item => item.missionAccessTier === 'pro');
      const accessEvents = mission.isFreeAccess
        ? missionEvents
        : missionEvents.filter(item => item.missionAccessTier === 'pro');
      const inTargetPeriod = (date: Date) => mission.category === 'special'
        || this.periodKey(mission, date) === targetPeriodKey;
      const periodActivities = accessActivities.filter(item => inTargetPeriod(item.date));
      const periodEvents = accessEvents.filter(item => inTargetPeriod(item.date)
        && (!item.missionId || item.missionId === mission.id));
      const uniqueDays = new Set(periodActivities.map(item => zonedDayIndex(item.date)));
      let streak = 0;
      let cursor = zonedDayIndex(referenceDate);
      if (!uniqueDays.has(cursor)) cursor -= 1;
      while (uniqueDays.has(cursor)) { streak += 1; cursor -= 1; }
      let value = 0;
      if (mission.type === 'workout_count') value = periodActivities.filter(item => item.type === 'workout').length;
      else if (mission.type === 'strength_workout_count') value = periodActivities.filter(item => item.type === 'workout').length;
      else if (mission.type === 'cardio_count') value = periodActivities.filter(item => item.type === 'cardio').length;
      else if (mission.type === 'cardio_minutes') value = periodActivities.filter(item => item.type === 'cardio').reduce((sum, item) => sum + (Number(item.duration ?? item.durationMins) || 0), 0);
      else if (mission.type === 'hybrid_week') value = periodActivities.some(item => item.type === 'workout') && periodActivities.some(item => item.type === 'cardio') ? 1 : 0;
      else if (mission.type === 'consistency_weeks' || mission.type === 'monthly_active_weeks') value = longestQualifiedMonthStreak(
        accessActivities,
        Math.max(1, mission.weeklyGoal || 3),
        zonedMonthKey(referenceDate),
      );
      else if (mission.type === 'personal_best') value = periodActivities.some(item => Boolean(item.isPersonalBest ?? item.personalBest ?? item.performanceImproved ?? item.newRecord))
        ? 1 : periodEvents.filter(item => item.missionId === mission.id).length;
      else if (mission.type === 'performance_zone') value = periodActivities.some(item => Boolean(item.performanceZoneAchieved ?? item.targetZoneAchieved) || Number(item.targetZoneMinutes ?? item.zoneMinutes) > 0)
        ? 1 : periodEvents.filter(item => item.missionId === mission.id).length;
      // Eventos genéricos nunca podem concluir várias missões pagas ao mesmo
      // tempo. Cada evento desse tipo precisa declarar a missão de destino.
      else if (mission.type === 'event_count') value = periodEvents.filter(item => item.missionId === mission.id).length;
      else if (mission.type === 'streak_days') value = streak;
      else if (mission.type === 'total_days') value = new Set(periodActivities.map(item => zonedDateKey(item.date))).size;
      else if (mission.type === 'gym_checkins') value = periodActivities.filter(item => item.type === 'workout' && (item.checkInId || item.gymId)).length;
      return value;
    };

    const reconciliationDates = [now, ...affectedAt.map(value => readDate(value))]
      .filter((value): value is Date => Boolean(value && value <= now));
    const targets = missions.flatMap(mission => {
      const periods = new Map<string, Date>();
      reconciliationDates.forEach(date => {
        const key = this.periodKey(mission, date);
        if (!periods.has(key)) periods.set(key, date);
      });
      return [...periods.entries()].map(([periodKey, referenceDate]) => ({
        mission,
        periodKey,
        referenceDate,
      }));
    });

    await Promise.all(targets.map(async ({ mission, periodKey, referenceDate }) => {
      const progressId = this.progressIdForPeriod(userId, mission.id, periodKey);
      const progressRef = db.collection('user_missions').doc(progressId);
      const definitionSnapshot = frozenMissionDefinition(mission);
      // Transação evita que duas reconstruções inicializem `claimed:false`
      // depois de um resgate. Claims reservados são estado terminal da saga:
      // a reconstrução pode atualizar contadores, mas não desfaz a conclusão.
      await db.runTransaction(async transaction => {
        const existing = await transaction.get(progressRef);
        const current = existing.exists ? existing.data() || {} : {};
        const effectiveMission: Mission = existing.exists ? {
          ...mission,
          category: current.missionCategorySnapshot || mission.category,
          type: current.missionTypeSnapshot || mission.type,
          target: Number(current.targetSnapshot ?? current.target ?? mission.target) || mission.target,
          weeklyGoal: Number(current.weeklyGoalSnapshot ?? mission.weeklyGoal) || undefined,
          isFreeAccess: typeof current.isFreeAccessSnapshot === 'boolean'
            ? current.isFreeAccessSnapshot : mission.isFreeAccess,
        } : mission;
        const value = calculateProgress(effectiveMission, periodKey, referenceDate);
        // Atividades de missão PRO já foram filtradas pelo snapshot de acesso
        // salvo no primeiro write. O plano atual nunca concede progresso
        // retroativo após um upgrade.
        const completionAccessGranted = current.completionAccessGranted === true
          || value >= effectiveMission.target;
        const currentProgress = Math.min(
          effectiveMission.target,
          Math.max(0, Number(current.currentProgress) || 0, value),
        );
        const progressPatch: Record<string, any> = {
          id: progressId,
          userId,
          missionId: mission.id,
          periodKey,
          // O hot path é monotônico: um scan concorrente mais antigo nunca
          // regride um progresso que outro pedido acabou de gravar.
          currentProgress,
          target: effectiveMission.target,
          completed: current.completed === true || completionAccessGranted,
          completionAccessGranted,
          ...(completionAccessGranted ? { completedAt: current.completedAt || new Date().toISOString() } : {}),
        };
        if (!existing.exists) {
          transaction.set(progressRef, {
            ...progressPatch,
            ...definitionSnapshot,
            claimed: false,
            updatedAt: new Date().toISOString(),
          });
          return;
        }
        const missingSnapshot = Object.fromEntries(
          Object.entries(definitionSnapshot).filter(([key]) => current[key] === undefined),
        );
        const patch = { ...progressPatch, ...missingSnapshot };
        if (current.completed === true && current.completionAccessGranted === true) {
          patch.completed = true;
          patch.completionAccessGranted = true;
          patch.completedAt = current.completedAt || patch.completedAt || new Date().toISOString();
        }
        if (current.claimState === 'pending' || current.claimState === 'complete') {
          patch.completed = current.completed !== false;
        }
        if (current.claimState === 'complete') patch.claimed = true;
        const changed = Object.entries(patch).some(([key, value]) => current[key] !== value);
        if (changed) {
          transaction.set(progressRef, {
            ...patch,
            updatedAt: new Date().toISOString(),
          }, { merge: true });
        }
      });
    }));
  }

  /** @deprecated Use syncUserProgressFromCompletedActivities. */
  static async syncUserProgressFromValidatedActivities(userId: string): Promise<void> {
    return this.syncUserProgressFromCompletedActivities(userId);
  }

  /**
   * Claims rewards for a completed mission.
   */
  static async claimMissionReward(userId: string, missionId: string, requestedProgressId?: string): Promise<{
    mission: Mission;
    rewardCoins: number;
    rewardXP: number;
  }> {
    if (!db) throw new Error('Database not initialized');
    if (requestedProgressId && !/^[A-Za-z0-9_-]{1,500}$/.test(requestedProgressId)) {
      throw new Error('Identificador de progresso inválido.');
    }
    const missions = await this.getMissions();
    const activeMission = missions.find(m => m.id === missionId);
    const progressId = requestedProgressId
      || (activeMission ? this.progressId(userId, activeMission) : '');
    if (!progressId) throw new Error('Missão não encontrada.');
    const docRef = db.collection('user_missions').doc(progressId);
    const userRef = db.collection('users').doc(userId);

    // Reserva idempotente. Se o processo cair depois do crédito de Coins, uma
    // nova chamada retoma este mesmo claim em vez de rejeitar ou pagar duas
    // vezes.
    const reservation = await db.runTransaction(async transaction => {
      const progressSnap = await transaction.get(docRef);
      if (!progressSnap.exists) throw new Error('Progresso da missão não encontrado.');
      const progress = progressSnap.data() as UserMissionProgress & {
        claimKey?: string;
        claimState?: 'pending' | 'complete';
        claimRewardCoins?: number;
        claimRewardXP?: number;
        claimLedgerType?: string;
        claimMissionTitle?: string;
      };
      if (progress.userId !== userId || progress.missionId !== missionId) {
        throw new Error('O progresso não pertence a esta missão ou usuário.');
      }
      const resuming = progress.claimState === 'pending' || progress.claimState === 'complete';
      const mission = activeMission;
      const hasDefinitionSnapshot = progress.rewardCoinsSnapshot !== undefined
        && progress.rewardXPSnapshot !== undefined
        && Boolean(progress.missionTitleSnapshot);
      if (!mission && !resuming && !hasDefinitionSnapshot) throw new Error('Missão não encontrada.');
      const periodKey = String((progress as any).periodKey || (mission ? this.periodKey(mission) : 'unknown'));
      const claimKey = progress.claimKey || `mission:${missionId}:${periodKey}:claim`;
      const isFreeAccess = typeof progress.isFreeAccessSnapshot === 'boolean'
        ? progress.isFreeAccessSnapshot
        : mission?.isFreeAccess === true;
      // Acesso PRO é decidido quando as atividades entram no período. Uma
      // assinatura adquirida agora não transforma progresso Free antigo em
      // missão PRO. Uma conclusão legada sem snapshot de acesso não é prova
      // suficiente; ela precisa passar por migração/revisão server-side.
      // Claims já reservados continuam retomáveis de modo idempotente.
      if (!resuming && !isFreeAccess && progress.completionAccessGranted !== true) {
        throw new Error('Esta missão é exclusiva para assinantes do Plano Premium Invictus.');
      }
      if (!resuming && !progress.completed) throw new Error('Missão ainda não foi concluída.');
      const frozenRewardCoins = progress.claimState
        ? Number(progress.claimRewardCoins ?? 0)
        : Number(progress.rewardCoinsSnapshot ?? mission?.rewardCoins) || 0;
      const frozenRewardXP = progress.claimState
        ? Number(progress.claimRewardXP ?? 0)
        : Number(progress.rewardXPSnapshot ?? mission?.rewardXP) || 0;
      const frozenLedgerType = progress.claimState
        ? String(progress.claimLedgerType || 'MISSION_REWARD')
        : String(progress.ledgerTypeSnapshot
          || mission?.ledgerType
          || (isFreeAccess ? 'MISSION_REWARD' : 'PRO_MISSION_REWARD'));
      const frozenMissionTitle = progress.claimState
        ? String(progress.claimMissionTitle || missionId)
        : String(progress.missionTitleSnapshot || mission?.title || missionId);
      if (progress.claimed || progress.claimState === 'complete') {
        return {
          complete: true,
          rewardCoins: frozenRewardCoins,
          rewardXP: frozenRewardXP,
          ledgerType: frozenLedgerType,
          missionTitle: frozenMissionTitle,
          claimKey,
        };
      }
      transaction.set(docRef, {
        claimKey,
        claimState: 'pending',
        claimRewardCoins: frozenRewardCoins,
        claimRewardXP: frozenRewardXP,
        claimLedgerType: frozenLedgerType,
        claimMissionTitle: frozenMissionTitle,
        claimReservedAt: progress.claimState === 'pending'
          ? (progress as any).claimReservedAt || new Date().toISOString()
          : new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }, { merge: true });
      return {
        complete: false,
        rewardCoins: frozenRewardCoins,
        rewardXP: frozenRewardXP,
        ledgerType: frozenLedgerType,
        missionTitle: frozenMissionTitle,
        claimKey,
      };
    });

    const claimKey = reservation.claimKey;
    const mission = activeMission || ({
      id: missionId,
      title: reservation.missionTitle,
      description: '',
      category: 'special',
      type: 'event_count',
      target: 1,
      rewardCoins: reservation.rewardCoins,
      rewardCategory: 'ecosystem',
      rewardXP: reservation.rewardXP,
      isFreeAccess: true,
      active: false,
    } as Mission);

    if (reservation.complete) {
      return { mission, rewardCoins: reservation.rewardCoins, rewardXP: reservation.rewardXP };
    }

    // Invictus Coins are loyalty points only. They never enter the cash wallet
    // and cannot become a PIX withdrawal balance.
    if (reservation.rewardCoins > 0) {
      await RewardCoinEngine.credit({
        userId,
        amount: reservation.rewardCoins,
        origin: 'mission',
        ledgerType: reservation.ledgerType as any,
        description: `Conclusão do desafio: ${reservation.missionTitle}`,
        idempotencyKey: claimKey,
      });
    }

    // Finaliza o claim e o XP juntos. Em chamadas concorrentes, somente a
    // primeira transação que ainda encontrar `pending` soma XP; as demais
    // observam `complete` e retornam sucesso idempotente.
    await db.runTransaction(async (transaction) => {
      const [freshProgress, freshUser] = await Promise.all([
        transaction.get(docRef),
        transaction.get(userRef),
      ]);
      const latest = freshProgress.data() as (UserMissionProgress & {
        claimKey?: string;
        claimState?: 'pending' | 'complete';
      }) | undefined;
      if (latest?.claimed || latest?.claimState === 'complete') return;
      if (latest.claimKey !== claimKey || latest.claimState !== 'pending') {
        throw new Error('O resgate desta missão perdeu sua reserva. Tente novamente.');
      }
      if (reservation.rewardXP > 0) {
        const latestUser = freshUser.data() || {};
        const newXP = (Number(latestUser.xp ?? latestUser.totalXp) || 0) + reservation.rewardXP;
        transaction.set(userRef, {
          xp: newXP,
          totalXp: newXP,
          level: getLevelFromXP(newXP),
          updatedAt: new Date().toISOString(),
        }, { merge: true });
      }
      transaction.set(docRef, {
        claimed: true,
        claimState: 'complete',
        claimedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }, { merge: true });
    });

    return {
      mission,
      rewardCoins: reservation.rewardCoins,
      rewardXP: reservation.rewardXP
    };
  }

  /**
   * Creates or updates a mission definition (for Admin).
   */
  static async upsertMission(missionData: Mission): Promise<Mission> {
    if (!db) throw new Error('Database not initialized');
    const mission = validateMissionDefinition(missionData);
    await db.collection('missions').doc(mission.id).set(mission, { merge: true });
    return mission;
  }
}