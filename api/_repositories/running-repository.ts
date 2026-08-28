import { BaseRepository } from './base-repository.js';
import { db } from '../_lib/common.js';
import { FieldPath } from 'firebase-admin/firestore';

// #96: setUserStats, addRunSession, getUserTrustScore, createPendingPresenceCheck
// e processRunTransaction foram removidos -- eram usados exclusivamente por
// RunningService.addRun() (a 5a formula de pontuacao paralela removida junto,
// ver running-service.ts). Sem chamador vivo no app. getUserStats/getRanking/
// getRunHistory abaixo continuam servindo dados historicos legados das
// colecoes `running_stats`/`run_sessions` -- por isso ficam.
export class RunningRepository extends BaseRepository<any> {
  constructor() {
    super('running_stats');
  }

  async getUserStats(userId: string): Promise<any | null> {
    const snap = await db.collection('running_stats').doc(userId).get();
    if (!snap.exists) return null;
    return snap.data();
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
