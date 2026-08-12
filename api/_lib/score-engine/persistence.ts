import { db, FieldValue } from '../common.js';
import { ActivitySource } from '../score-config.js';

export class ScorePersistence {
  static async loadUserData(userId: string): Promise<any> {
    console.log(`[SCORE ENGINE] [PERSISTENCE] Carregando perfil do usuário ${userId}`);
    const snap = await db.collection('users').doc(userId).get();
    return snap.exists ? snap.data() || {} : {};
  }

  /**
   * Persistência Atômica usando Transaction
   */
  static async persistScoreAtomic(
    userId: string,
    score: number,
    xp: number,
    activityData: any,
    source: ActivitySource
  ): Promise<{ transactionId: string; updatedDocCount: number }> {
    const transactionId = `tx_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    console.log(`[SCORE ENGINE] [PERSISTENCE] [${userId}] Iniciando transação atômica ${transactionId}`);

    const userRef = db.collection('users').doc(userId);
    const runningStatsRef = db.collection('running_stats').doc(userId);
    
    let updatedDocCount = 0;

    await db.runTransaction(async (tx) => {
      // 1. ALL READS FIRST
      const userSnap = await tx.get(userRef);
      const userData = userSnap.exists ? userSnap.data() || {} : {};

      const isRunOrStrava = activityData.type === 'run' || source === ActivitySource.STRAVA;
      const km = isRunOrStrava ? (activityData.distanceKm || (activityData.distance ? activityData.distance / 1000 : 0)) : 0;
      
      let statsData: any = { best_run_km_month: 0, best_run_km_week: 0 };
      if (isRunOrStrava && km > 0) {
        const statsSnap = await tx.get(runningStatsRef);
        if (statsSnap.exists) {
          statsData = statsSnap.data() || {};
        }
      }

      // 2. NOW ALL WRITES
      const now = new Date();
      const normalizedDate = activityData.date ? new Date(activityData.date).toISOString() : now.toISOString();

      const updates: any = {
        score: FieldValue.increment(score),
        xp: FieldValue.increment(xp),
        updatedAt: FieldValue.serverTimestamp()
      };

      const lastCheckIn = userData.lastCheckIn ? new Date(userData.lastCheckIn) : new Date(0);
      const isNewMonth = now.getMonth() !== lastCheckIn.getMonth() || now.getFullYear() !== lastCheckIn.getFullYear();

      if (isNewMonth) {
        updates.monthlyScore = score;
      } else {
        updates.monthlyScore = FieldValue.increment(score);
      }

      updates.lastCheckIn = normalizedDate;

      tx.update(userRef, updates);
      updatedDocCount++;

      if (isRunOrStrava && km > 0) {
        const statsUpdates: any = {
          last_run_date: normalizedDate,
          last_run_stats: {
            km,
            timeSeconds: activityData.duration || 0,
            date: normalizedDate,
            source: 'strava',
            stravaActivityId: activityData.stravaActivityId || activityData.id
          },
          updatedAt: FieldValue.serverTimestamp()
        };

        if (km > (statsData?.best_run_km_month || 0)) statsUpdates.best_run_km_month = km;
        if (km > (statsData?.best_run_km_week || 0)) statsUpdates.best_run_km_week = km;

        tx.set(runningStatsRef, statsUpdates, { merge: true });
        updatedDocCount++;
      }
    });

    // Registra sessão de corrida no Firestore
    if (activityData.type === 'run' || source === ActivitySource.STRAVA) {
      const km = activityData.distanceKm || (activityData.distance ? activityData.distance / 1000 : 0);
      if (km > 0) {
        await db.collection('run_sessions').add({
          userId,
          km,
          duration: activityData.duration || 0,
          source: 'strava',
          stravaActivityId: activityData.stravaActivityId || activityData.id,
          createdAt: FieldValue.serverTimestamp(),
          date: activityData.date ? new Date(activityData.date).toISOString() : new Date().toISOString()
        });
        updatedDocCount++;
      }
    }

    console.log(`[SCORE ENGINE] [PERSISTENCE] Transação ${transactionId} concluída com sucesso (${updatedDocCount} docs afetados)`);
    return { transactionId, updatedDocCount };
  }
}
