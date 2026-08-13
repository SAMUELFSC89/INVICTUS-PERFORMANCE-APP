import { db } from './common.js';
import { RewardsEngine } from './rewards-engine.js';
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
    rewardCategory: 'redeemable',
    rewardXP: 1000,
    isFreeAccess: false, // Premium exclusive reward
    active: true
  }
];

export class MissionEngine {
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
      return snap.docs.map(doc => doc.data() as UserMissionProgress);
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

    const progressId = `um_${userId}_${missionId}`;
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
   * Claims rewards for a completed mission.
   */
  static async claimMissionReward(userId: string, missionId: string): Promise<{
    mission: Mission;
    rewardCoins: number;
    rewardAmount: number;
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

    const progressId = `um_${userId}_${missionId}`;
    const docRef = db.collection('user_missions').doc(progressId);
    const snap = await docRef.get();

    if (!snap.exists) throw new Error('Progresso da missão não encontrado.');
    const prog = snap.data() as UserMissionProgress;

    if (!prog.completed) throw new Error('Missão ainda não foi concluída.');
    if (prog.claimed) throw new Error('Recompensa desta missão já foi resgatada.');

    // Grant real R$ funds to the wallet (converted from the legacy rewardCoins value)
    const rewardAmount = await RewardsEngine.rewardMission(userId, mission.title, mission.rewardCoins, mission.rewardCategory);

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
      rewardAmount,
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
