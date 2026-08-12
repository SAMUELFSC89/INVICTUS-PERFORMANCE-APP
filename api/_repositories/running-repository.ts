import { BaseRepository } from './base-repository.js';
import { db } from '../_lib/common.js';
import { FieldValue, FieldPath } from 'firebase-admin/firestore';

export class RunningRepository extends BaseRepository<any> {
  constructor() {
    super('running_stats');
  }

  async getUserStats(userId: string): Promise<any | null> {
    const snap = await db.collection('running_stats').doc(userId).get();
    if (!snap.exists) return null;
    return snap.data();
  }

  async setUserStats(userId: string, data: Record<string, any>): Promise<void> {
    await db.collection('running_stats').doc(userId).set(data, { merge: true });
  }

  async addRunSession(sessionData: Record<string, any>): Promise<string> {
    const sessionRef = db.collection('run_sessions').doc();
    const id = sessionRef.id;
    await sessionRef.set({
      ...sessionData,
      id,
      createdAt: FieldValue.serverTimestamp()
    });
    return id;
  }

  async getUserTrustScore(userId: string): Promise<number> {
    try {
      const trustProfileSnap = await db.collection('user_trust_profiles').doc(userId).get();
      if (trustProfileSnap.exists) {
        return trustProfileSnap.data()?.trustScore ?? 100;
      }
      const userSnap = await db.collection('users').doc(userId).get();
      if (userSnap.exists && userSnap.data()?.createdAt) {
        const ageMs = Date.now() - new Date(userSnap.data().createdAt).getTime();
        return (ageMs / (1000 * 60 * 60 * 24)) > 30 ? 95 : 70;
      }
    } catch (_) {}
    return 70;
  }

  async createPendingPresenceCheck(payload: {
    userId: string;
    presenceRiskScore: number;
    livenessPrompt: string;
    workoutPayload: any;
  }): Promise<{ presenceCheckId: string; expiredAt: string }> {
    const dbCollection = db.collection('pending_presence_checks');
    const presenceCheckId = dbCollection.doc().id;
    const nowTime = new Date();
    const expiredAt = new Date(nowTime.getTime() + 15 * 60 * 1000).toISOString();

    await dbCollection.doc(presenceCheckId).set({
      id: presenceCheckId,
      userId: payload.userId,
      type: 'running',
      livenessPrompt: payload.livenessPrompt,
      riskScore: payload.presenceRiskScore,
      createdAt: nowTime.toISOString(),
      expiredAt,
      workoutPayload: payload.workoutPayload,
      status: 'pending'
    });

    return { presenceCheckId, expiredAt };
  }

  async processRunTransaction(
    userId: string,
    currentKm: number,
    weekId: string,
    todayISO: string,
    nowIso: string
  ): Promise<{ isScoringEligible: boolean; nonScoringReason: string | null; finalXpAwarded: number }> {
    const userRef = db.collection('users').doc(userId);
    const weeklyStatsRef = db.collection('users').doc(userId).collection('weeklyStats').doc(weekId);

    let isScoringEligible = false;
    let nonScoringReason: string | null = null;
    let finalXpAwarded = 0;

    await db.runTransaction(async (transaction: any) => {
      const userSnap = await transaction.get(userRef);
      if (!userSnap.exists) return;
      const userData = userSnap.data() || {};

      const xpAwarded = 20 + Math.floor(currentKm * 5);
      const weeklyStatsSnap = await transaction.get(weeklyStatsRef);
      const weeklyStatsData = weeklyStatsSnap.exists ? weeklyStatsSnap.data() : {
        weekId,
        scoredDays: [],
        totalScoredDays: 0,
        totalPoints: 0
      };

      const scoredDays: string[] = weeklyStatsData.scoredDays || [];
      const isDayAlreadyScored = scoredDays.includes(todayISO);

      if (xpAwarded > 0) {
        if (isDayAlreadyScored) {
          isScoringEligible = true;
          finalXpAwarded = xpAwarded;
        } else if (scoredDays.length < 5) {
          isScoringEligible = true;
          finalXpAwarded = xpAwarded;
          scoredDays.push(todayISO);
          weeklyStatsData.scoredDays = scoredDays;
          weeklyStatsData.totalScoredDays = scoredDays.length;
        } else {
          isScoringEligible = false;
          nonScoringReason = 'WEEKLY_SCORING_LIMIT_REACHED';
          finalXpAwarded = 0;
        }
      } else {
        isScoringEligible = true;
      }

      const userUpdates: any = {
        updatedAt: FieldValue.serverTimestamp()
      };

      userUpdates.score = (userData.score || 0) + finalXpAwarded;
      userUpdates.lastCheckIn = nowIso;

      const lastCheckInDay = userData.lastCheckIn ? userData.lastCheckIn.split('T')[0] : '';
      if (todayISO !== lastCheckInDay) {
        userUpdates.totalActiveDays = (userData.totalActiveDays || 0) + 1;
      }

      if (finalXpAwarded > 0) {
        weeklyStatsData.totalPoints = (weeklyStatsData.totalPoints || 0) + finalXpAwarded;
        weeklyStatsData.updatedAt = FieldValue.serverTimestamp();
        transaction.set(weeklyStatsRef, weeklyStatsData);
      }

      transaction.update(userRef, userUpdates);
    });

    return { isScoringEligible, nonScoringReason, finalXpAwarded };
  }

  async getRanking(period: 'month' | 'week', mode: 'official' | 'demo', startDateISO: string): Promise<any[]> {
    const field = period === 'month' ? 'best_run_km_month' : 'best_run_km_week';
    const isPaidFilter = mode === 'official';

    const querySnap = await db.collection('running_stats')
      .where('is_paid_running', '==', isPaidFilter)
      .where(field, '>', 0)
      .where('last_run_date', '>=', startDateISO)
      .orderBy(field, 'desc')
      .limit(10)
      .get();

    const runnerIds = querySnap.docs.map((snap: any) => snap.data().userId);
    const runnerMap = new Map();

    if (runnerIds.length > 0) {
      const usersSnap = await db.collection('users').where(FieldPath.documentId(), 'in', runnerIds).get();
      usersSnap.forEach((d: any) => runnerMap.set(d.id, d.data()));
    }

    return querySnap.docs.map((snap: any) => {
      const data = snap.data();
      const userData = runnerMap.get(data.userId);
      return {
        userId: data.userId,
        displayName: userData?.displayName || 'Velocista Anônimo',
        photoURL: userData?.photoURL || null,
        km: data[field],
        is_paid_running: data.is_paid_running
      };
    });
  }

  async getRunHistory(userId: string, limitNum = 10): Promise<any[]> {
    const snap = await db.collection('run_sessions')
      .where('userId', '==', userId)
      .orderBy('createdAt', 'desc')
      .limit(limitNum)
      .get();

    return snap.docs.map((doc: any) => ({
      id: doc.id,
      ...doc.data()
    }));
  }
}
