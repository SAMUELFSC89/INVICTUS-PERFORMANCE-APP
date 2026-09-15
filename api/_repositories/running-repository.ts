import { BaseRepository } from './base-repository.js';
import { db } from '../_lib/common.js';

// Escrita/pontuação/ranking paralelos de corrida foram removidos. Restam apenas
// as leituras históricas ainda usadas pela camada de compatibilidade.
export class RunningRepository extends BaseRepository<any> {
  constructor() {
    super('running_stats');
  }

  async getUserStats(userId: string): Promise<any | null> {
    const snap = await db.collection('running_stats').doc(userId).get();
    if (!snap.exists) return null;
    return snap.data();
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
