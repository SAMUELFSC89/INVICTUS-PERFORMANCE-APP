import { db, FieldValue } from '../../common.js';
import { ActivityScore, UserStats } from '../types.js';
import { scoreLogger } from '../../logger.js';

export class ScoreRepository {
  /**
   * Salvar score de atividade
   */
  static async saveActivityScore(score: ActivityScore): Promise<void> {
    try {
      if (db && typeof db.collection === 'function') {
        await db.collection('activity_scores').doc(score.eventId).set({
          ...score,
          createdAt: new Date()
        });
      }

      scoreLogger.info({ eventId: score.eventId, score: score.totalScore }, 'Activity score saved');
    } catch (error) {
      scoreLogger.error({ error, eventId: score.eventId }, 'Failed to save activity score');
    }
  }

  /**
   * Verificar se uma atividade (por eventId) ja foi processada e pontuada.
   * Usado para garantir idempotencia: reprocessar o mesmo evento (retry,
   * webhook duplicado, re-sync do Strava) nao deve incrementar o placar
   * do usuario de novo. Ver ScoreEngine.process().
   */
  static async getActivityScore(eventId: string): Promise<ActivityScore | null> {
    try {
      if (db && typeof db.collection === 'function') {
        const snap = await db.collection('activity_scores').doc(eventId).get();
        if (snap.exists) {
          return snap.data() as ActivityScore;
        }
      }
      return null;
    } catch (error) {
      scoreLogger.error({ error, eventId }, 'Failed to check existing activity score');
      return null;
    }
  }

  /**
   * Atualizar stats do usuário
   */
  static async updateUserStats(userId: string, scoreEarned: number): Promise<void> {
    try {
      if (db && typeof db.collection === 'function') {
        const userRef = db.collection('users').doc(userId);
        const inc = FieldValue ? FieldValue.increment(scoreEarned) : scoreEarned;
        const actInc = FieldValue ? FieldValue.increment(1) : 1;

        await userRef.set({
          totalScore: inc,
          totalActivities: actInc,
          lastActivityDate: new Date()
        }, { merge: true });
      }

      scoreLogger.info({ userId, scoreEarned }, 'User stats updated');
    } catch (error) {
      scoreLogger.error({ error, userId }, 'Failed to update user stats');
    }
  }

  /**
   * Obter stats do usuário
   */
  static async getUserStats(userId: string): Promise<UserStats | null> {
    try {
      if (db && typeof db.collection === 'function') {
        const docSnap = await db.collection('users').doc(userId).get();
        if (docSnap.exists) {
          const data = docSnap.data();
          return {
            userId,
            totalScore: data?.totalScore || 0,
            level: data?.level || 1,
            totalActivities: data?.totalActivities || 0,
            currentStreak: data?.currentStreak || 1,
            bestStreak: data?.bestStreak || 1,
            lastActivityDate: data?.lastActivityDate ? new Date(data.lastActivityDate) : new Date(),
            joinDate: data?.joinDate ? new Date(data.joinDate) : new Date(Date.now() - 30 * 24 * 3600 * 1000),
isBanned: data?.isBanned || false,
isBlocked: data?.isBlocked || false
          };
        }
      }
      return {
        userId,
        totalScore: 0,
        level: 1,
        totalActivities: 0,
        currentStreak: 1,
        bestStreak: 1,
        lastActivityDate: new Date(),
        joinDate: new Date(Date.now() - 30 * 24 * 3600 * 1000)
      };
    } catch (error) {
      scoreLogger.error({ error, userId }, 'Failed to fetch user stats');
      return {
        userId,
        totalScore: 0,
        level: 1,
        totalActivities: 0,
        currentStreak: 1,
        bestStreak: 1,
        lastActivityDate: new Date(),
        joinDate: new Date(Date.now() - 30 * 24 * 3600 * 1000)
      };
    }
  }

  /**
   * Obter histórico de scores do usuário
   */
  static async getUserScoreHistory(userId: string, limit: number = 100): Promise<ActivityScore[]> {
    try {
      if (db && typeof db.collection === 'function') {
        const snapshot = await db.collection('activity_scores')
          .where('userId', '==', userId)
          .orderBy('timestamp', 'desc')
          .limit(limit)
          .get();

        return snapshot.docs.map(docSnap => docSnap.data() as ActivityScore);
      }
      return [];
    } catch (error) {
      scoreLogger.error({ error, userId }, 'Failed to fetch score history');
      return [];
    }
  }
}
