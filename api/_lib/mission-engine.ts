import { db } from './common.js';
import { RewardCoinEngine } from './reward-coin-engine.js';
import { getLevelFromXP } from './xpConfig.js';
import { Mission, UserMissionProgress } from '../../src/types.js';

export const DEFAULT_MISSIONS: Mission[] = [
  {
    id: 'miss_train_5_days',
    title: 'Consistência de Aço',
    description: 'Treine 5 dias nesta semana para manter seu ritmo imbatível.',
    category: 'weekly',
    type: 'workout_count',
    target: 5,
    rewardCoins: 100,
    rewardCategory: 'ecosystem',
    rewardXP: 150,
    isFreeAccess: true,
    active: true
  },
  {
    id: 'miss_cardio_30_mins',
    title: 'Explosão Cardiorrespiratória',
    description: 'Complete 30 minutos de cardio registrado por GPS ou relógio inteligente.',
    category: 'daily',
    type: 'cardio_minutes',
    target: 30,
    rewardCoins: 50,
    rewardCategory: 'ecosystem',
    rewardXP: 80,
    isFreeAccess: true,
    active: true
  },
  {
    id: 'miss_streak_7_days',
    title: 'Guardião do Streak',
    description: 'Alcance ou mantenha 7 dias consecutivos sem quebrar o streak.',
    category: 'weekly',
    type: 'streak_days',
    target: 7,
    rewardCoins: 150,
    rewardCategory: 'ecosystem',
    rewardXP: 250,
    isFreeAccess: true,
    active: true
  },
  {
    id: 'miss_gym_checkins_3',
    title: 'Atleta Presencial',
    description: 'Faça 3 check-ins presenciais na sua academia cadastrada.',
    category: 'weekly',
    type: 'gym_checkins',
    target: 3,
    rewardCoins: 80,
    rewardCategory: 'ecosystem',
    rewardXP: 100,
    isFreeAccess: true,
    active: true
  },
  {
    id: 'miss_monthly_challenge_30',
    title: 'Desafio Mensal Invictus 30D',
    description: 'Registre 30 dias de atividades físicas válidas durante o mês.',
    category: 'monthly',
    type: 'total_days',
    target: 30,
    rewardCoins: 500,
    rewardCategory: 'ecosystem',
    rewardXP: 1000,
    isFreeAccess: false, // Premium exclusive reward
    active: true
  }
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
      if (snap.empty) {
        for (const m of DEFAULT_MISSIONS) {
          await db.collection('missions').doc(m.id).set(m);
        }
        return DEFAULT_MISSIONS;
      }
      return snap.docs.map(doc => doc.data() as Mission);
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
    const snap = await db.collection('workouts').where('userId', '==', userId).get();
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
    const uniqueDays = [...new Set(validated.map(item => item.date.toISOString().slice(0, 10)))].sort().reverse();
    let streak = 0;
    const cursor = new Date(dayStart);
    if (!uniqueDays.includes(cursor.toISOString().slice(0, 10))) cursor.setDate(cursor.getDate() - 1);
    while (uniqueDays.includes(cursor.toISOString().slice(0, 10))) { streak += 1; cursor.setDate(cursor.getDate() - 1); }

    await Promise.all(missions.map(async mission => {
      const from = mission.category === 'daily' ? dayStart : mission.category === 'monthly' ? monthStart : mission.category === 'weekly' ? weekStart : new Date(0);
      const periodActivities = validated.filter(item => item.date >= from);
      let value = 0;
      if (mission.type === 'workout_count') value = periodActivities.filter(item => item.type === 'workout').length;
      else if (mission.type === 'cardio_minutes') value = periodActivities.filter(item => item.type === 'cardio').reduce((sum, item) => sum + (Number(item.duration ?? item.durationMins) || 0), 0);
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
    const isPremium = Boolean(userData.premium || userData.isSubscribed);

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
      description: `Conclusão do desafio: ${mission.title}`,
      idempotencyKey: `mission:${missionId}:claim`,
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
