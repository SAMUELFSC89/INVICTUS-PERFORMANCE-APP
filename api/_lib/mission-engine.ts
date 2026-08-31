import { db } from './common.js';
import { RewardCoinEngine } from './reward-coin-engine.js';
import { getLevelFromXP } from './xpConfig.js';
import { Mission, UserMissionProgress } from '../../src/types.js';

export const MISSION_ECONOMY_VERSION = 2;
const RETIRED_MISSION_IDS = new Set([
  'miss_train_5_days', 'miss_cardio_30_mins', 'miss_streak_7_days',
  'miss_gym_checkins_3', 'miss_monthly_challenge_30',
]);

export const DEFAULT_MISSIONS: Mission[] = [
  {
    id: 'miss_trinca_invictus', title: 'Trinca Invictus',
    description: 'Complete 3 treinos de musculação validados nesta semana.',
    category: 'weekly',
    type: 'strength_workout_count', target: 3, rewardCoins: 40, rewardCategory: 'ecosystem', rewardXP: 0,
    isFreeAccess: true, ledgerType: 'MISSION_REWARD', definitionVersion: MISSION_ECONOMY_VERSION, active: true,
  },
  {
    id: 'miss_semana_de_aco', title: 'Semana de Aço',
    description: 'Complete 4 treinos de musculação validados nesta semana.',
    category: 'weekly', type: 'strength_workout_count', target: 4, rewardCoins: 60, rewardCategory: 'ecosystem', rewardXP: 0,
    isFreeAccess: true, ledgerType: 'MISSION_REWARD', definitionVersion: MISSION_ECONOMY_VERSION, active: true,
  },
  {
    id: 'miss_motor_ligado', title: 'Motor Ligado',
    description: 'Complete 2 sessões de cardio validadas nesta semana.',
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
    id: 'miss_consistencia_2', title: 'Consistência — 2 Semanas', description: 'Cumpra sua meta válida em 2 semanas consecutivas neste mês.',
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
    id: 'miss_supere_voce', title: 'Supere Você Mesmo', description: 'Supere uma marca pessoal validada neste mês.',
    category: 'monthly', type: 'personal_best', target: 1, rewardCoins: 80, rewardCategory: 'ecosystem', rewardXP: 0,
    isFreeAccess: true, ledgerType: 'MISSION_REWARD', definitionVersion: MISSION_ECONOMY_VERSION, active: true,
  },
  {
    id: 'miss_ritmo_elite', title: 'Ritmo de Elite', description: 'Complete 5 treinos de musculação validados nesta semana.',
    category: 'weekly', type: 'strength_workout_count', target: 5, rewardCoins: 80, rewardCategory: 'ecosystem', rewardXP: 0,
    isFreeAccess: false, ledgerType: 'PRO_MISSION_REWARD', definitionVersion: MISSION_ECONOMY_VERSION, active: true,
  },
  {
    id: 'miss_zona_performance', title: 'Zona de Performance', description: 'Conclua o objetivo semanal validado da sua Zona de Performance.',
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
    if (mission.category === 'daily') return now.toISOString().slice(0, 10);
    if (mission.category === 'monthly') return now.toISOString().slice(0, 7);
    if (mission.category === 'weekly') {
      const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      const day = date.getUTCDay() || 7;
      date.setUTCDate(date.getUTCDate() + 4 - day);
      const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
      const week = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
      return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
    }
    return 'permanent';
  }

  private static progressId(userId: string, mission: Mission): string {
    return `um_${userId}_${mission.id}_${this.periodKey(mission)}`;
  }

  /**
   * Fetches all active system missions.
   */
  static async getMissions(): Promise<Mission[]> {
    if (!db) return DEFAULT_MISSIONS;
    try {
      const snap = await db.collection('missions').where('active', '==', true).get();
      const defaultsById = new Map(DEFAULT_MISSIONS.map(mission => [mission.id, mission]));
      const custom = snap.docs
        .map(doc => doc.data() as Mission)
        .filter(mission => !defaultsById.has(mission.id) && !RETIRED_MISSION_IDS.has(mission.id));
      await Promise.all(DEFAULT_MISSIONS.map(mission => db!.collection('missions').doc(mission.id).set(mission)));
      await Promise.all([...RETIRED_MISSION_IDS].map(id => db!.collection('missions').doc(id).set({ active: false, retiredByVersion: MISSION_ECONOMY_VERSION }, { merge: true })));
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
      snap.docs.map(doc => doc.data() as UserMissionProgress).forEach(item => {
        const previous = newest.get(item.missionId);
        if (!previous || String(item.updatedAt).localeCompare(String(previous.updatedAt)) > 0) newest.set(item.missionId, item);
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
      updatedAt: new Date().toISOString()
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
      updatedAt: new Date().toISOString()
    };

    await docRef.set(updated, { merge: true });
    return updated;
  }

  /**
   * Rebuilds current mission progress from server-validated activities. Client
   * input is never accepted as evidence for a challenge reward.
   */
  static async syncUserProgressFromValidatedActivities(userId: string): Promise<void> {
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
    const validated = snap.docs.map(doc => doc.data()).filter(data => {
      const status = String(data.validationStatus ?? data.status ?? data.validation?.status ?? '').toLowerCase();
      return ['validated', 'valid', 'approved', 'homologated', 'homologada'].includes(status);
    }).map(data => ({ ...data, date: readDate(data.timestamp ?? data.createdAt) })).filter(data => data.date) as Array<Record<string, any> & { date: Date }>;
    const now = new Date();
    const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
    const weekStart = new Date(dayStart); weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const strengthInMonth = validated.filter(item => item.type === 'workout' && item.date >= monthStart && item.date < monthEnd);
    const longestQualifiedMonthStreak = (goal: number) => {
      const weeks = new Map<string, { start: number; count: number }>();
      strengthInMonth.forEach(item => {
        const start = new Date(item.date); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
        const key = start.toISOString().slice(0, 10);
        const previous = weeks.get(key);
        weeks.set(key, { start: start.getTime(), count: (previous?.count || 0) + 1 });
      });
      const counts = [...weeks.values()].sort((a, b) => a.start - b.start);
      let longest = 0;
      let current = 0;
      let previousStart: number | null = null;
      counts.forEach(week => {
        const consecutive = previousStart !== null && week.start - previousStart === 7 * 86400000;
        current = week.count >= goal ? (consecutive ? current + 1 : 1) : 0;
        longest = Math.max(longest, current);
        previousStart = week.start;
      });
      return Math.min(4, longest);
    };
    const missionEvents = (eventSnap?.docs || []).map(doc => doc.data()).filter(data => {
      const status = String(data.status ?? data.validationStatus ?? '').toLowerCase();
      return ['validated', 'valid', 'approved', 'completed'].includes(status);
    }).map(data => ({ ...data, date: readDate(data.occurredAt ?? data.completedAt ?? data.createdAt) })).filter(data => data.date) as Array<Record<string, any> & { date: Date }>;
    const uniqueDays = [...new Set(validated.map(item => item.date.toISOString().slice(0, 10)))].sort().reverse();
    let streak = 0;
    const cursor = new Date(dayStart);
    if (!uniqueDays.includes(cursor.toISOString().slice(0, 10))) cursor.setDate(cursor.getDate() - 1);
    while (uniqueDays.includes(cursor.toISOString().slice(0, 10))) { streak += 1; cursor.setDate(cursor.getDate() - 1); }

    await Promise.all(missions.map(async mission => {
      const from = mission.category === 'daily' ? dayStart : mission.category === 'monthly' ? monthStart : mission.category === 'weekly' ? weekStart : new Date(0);
      const periodActivities = validated.filter(item => item.date >= from);
      const periodEvents = missionEvents.filter(item => item.date >= from && (!item.missionId || item.missionId === mission.id));
      let value = 0;
      if (mission.type === 'workout_count') value = periodActivities.filter(item => item.type === 'workout').length;
      else if (mission.type === 'strength_workout_count') value = periodActivities.filter(item => item.type === 'workout').length;
      else if (mission.type === 'cardio_count') value = periodActivities.filter(item => item.type === 'cardio').length;
      else if (mission.type === 'cardio_minutes') value = periodActivities.filter(item => item.type === 'cardio').reduce((sum, item) => sum + (Number(item.duration ?? item.durationMins) || 0), 0);
      else if (mission.type === 'hybrid_week') value = periodActivities.some(item => item.type === 'workout') && periodActivities.some(item => item.type === 'cardio') ? 1 : 0;
      else if (mission.type === 'consistency_weeks' || mission.type === 'monthly_active_weeks') value = longestQualifiedMonthStreak(Math.max(1, mission.weeklyGoal || 3));
      else if (mission.type === 'personal_best') value = periodActivities.some(item => Boolean(item.isPersonalBest ?? item.personalBest ?? item.performanceImproved ?? item.newRecord)) ? 1 : periodEvents.length;
      else if (mission.type === 'performance_zone') value = periodActivities.some(item => Boolean(item.performanceZoneAchieved ?? item.targetZoneAchieved) || Number(item.targetZoneMinutes ?? item.zoneMinutes) > 0) ? 1 : periodEvents.length;
      else if (mission.type === 'event_count') value = periodEvents.length;
      else if (mission.type === 'streak_days') value = streak;
      else if (mission.type === 'total_days') value = new Set(periodActivities.map(item => item.date.toISOString().slice(0, 10))).size;
      else if (mission.type === 'gym_checkins') value = periodActivities.filter(item => item.type === 'workout' && (item.checkInId || item.gymId)).length;
      const progressId = this.progressId(userId, mission);
      const progressRef = db.collection('user_missions').doc(progressId);
      const existing = await progressRef.get();
      const claimed = Boolean(existing.data()?.claimed);
      await progressRef.set({
        id: progressId,
        userId,
        missionId: mission.id,
        periodKey: this.periodKey(mission),
        currentProgress: Math.min(mission.target, Math.max(0, value)),
        target: mission.target,
        completed: value >= mission.target,
        claimed,
        updatedAt: new Date().toISOString(),
      }, { merge: true });
    }));
  }

  /**
   * Claims rewards for a completed mission.
   */
  static async claimMissionReward(userId: string, missionId: string): Promise<{
    mission: Mission;
    rewardCoins: number;
    rewardXP: number;
  }> {
    if (!db) throw new Error('Database not initialized');
    const missions = await this.getMissions();
    const mission = missions.find(m => m.id === missionId);
    if (!mission) throw new Error('Missão não encontrada.');

    // Check user plan access
    const userDoc = await db.collection('users').doc(userId).get();
    const userData = userDoc.data() || {};
    const isPremium = Boolean(
      userData.premium || userData.isSubscribed
      || userData.subscriptionTier === 'performance'
      || userData.currentPlan === 'performance'
    );

    if (!mission.isFreeAccess && !isPremium) {
      throw new Error('Esta missão é exclusiva para assinantes do Plano Premium Invictus.');
    }

    const progressId = this.progressId(userId, mission);
    const docRef = db.collection('user_missions').doc(progressId);
    const snap = await docRef.get();

    if (!snap.exists) throw new Error('Progresso da missão não encontrado.');
    const prog = snap.data() as UserMissionProgress;

    if (!prog.completed) throw new Error('Missão ainda não foi concluída.');
    if (prog.claimed) throw new Error('Recompensa desta missão já foi resgatada.');

    // Invictus Coins are loyalty points only. They never enter the cash wallet
    // and cannot become a PIX withdrawal balance.
    await RewardCoinEngine.credit({
      userId,
      amount: mission.rewardCoins,
      origin: 'mission',
      ledgerType: mission.ledgerType || (mission.isFreeAccess ? 'MISSION_REWARD' : 'PRO_MISSION_REWARD'),
      description: `Conclusão do desafio: ${mission.title}`,
      idempotencyKey: `mission:${missionId}:${this.periodKey(mission)}:claim`,
    });

    // Update user XP & Level (Does NOT affect Ranking Score)
    if (mission.rewardXP > 0) {
      const newXP = (userData.xp || userData.totalXp || 0) + mission.rewardXP;
      const newLevel = getLevelFromXP(newXP);
      await db.collection('users').doc(userId).set({
        xp: newXP,
        totalXp: newXP,
        level: newLevel
      }, { merge: true });
    }

    // Mark mission as claimed
    await docRef.set({ claimed: true, updatedAt: new Date().toISOString() }, { merge: true });

    return {
      mission,
      rewardCoins: mission.rewardCoins,
      rewardXP: mission.rewardXP
    };
  }

  /**
   * Creates or updates a mission definition (for Admin).
   */
  static async upsertMission(missionData: Mission): Promise<Mission> {
    if (!db) throw new Error('Database not initialized');
    await db.collection('missions').doc(missionData.id).set(missionData, { merge: true });
    return missionData;
  }
}
