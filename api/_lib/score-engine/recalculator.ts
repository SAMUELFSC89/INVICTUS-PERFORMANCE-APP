import { db } from '../common.js';
import { ScoreEngine } from './index.js';

export class SeasonRecalculator {
  /**
   * Recalcula uma temporada lendo todos os eventos de `score_events`
   */
  static async recalculateSeason(userId?: string): Promise<{ totalProcessed: number; successCount: number }> {
    console.log(`[SCORE ENGINE] [RECALCULATOR] Iniciando reprocessamento administrativo de temporada${userId ? ` para usuário ${userId}` : ''}`);

    let query: any = db.collection('score_events').where('status', '==', 'SUCCESS');
    if (userId) {
      query = query.where('userId', '==', userId);
    }

    const snap = await query.get();
    let totalProcessed = 0;
    let successCount = 0;

    for (const doc of snap.docs) {
      const eventData = doc.data();
      totalProcessed++;
      try {
        console.log(`[SCORE ENGINE] [RECALCULATOR] Reprocessando evento ${eventData.eventId} do usuário ${eventData.userId}`);
        const result = await ScoreEngine.process({
          id: `${eventData.eventId}_recalc_${Date.now()}`,
          userId: eventData.userId,
          source: eventData.source,
          createdAt: eventData.receivedAt,
          payload: eventData.payload
        });

        if (result.report.finalScore >= 0) {
          successCount++;
        }
      } catch (err: any) {
        console.error(`[SCORE ENGINE] [RECALCULATOR] Erro ao reprocessar evento ${eventData.eventId}:`, err);
      }
    }

    console.log(`[SCORE ENGINE] [RECALCULATOR] Concluído: ${successCount}/${totalProcessed} eventos reprocessados com sucesso.`);
    return { totalProcessed, successCount };
  }
}
