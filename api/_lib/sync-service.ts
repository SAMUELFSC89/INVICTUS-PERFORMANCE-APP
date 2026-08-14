import { db, FieldValue } from './common.js';
import { ScoreEngine } from './score-engine.js';

export class SyncService {
  static async processStravaActivity(userId: string, stravaActivity: any) {
    console.log(`[SyncService] Processing activity ${stravaActivity?.id} for user ${userId}`);

    let earnedPoints = 0;
    try {
      earnedPoints = await ScoreEngine.processStrava(userId, stravaActivity);
      console.log(`[SyncService] Activity ${stravaActivity?.id} processed by ScoreEngine. Points earned: ${earnedPoints}`);
    } catch (error: any) {
      console.warn(`[SyncService] Activity ${stravaActivity?.id} skipped during sync: ${error?.message}`);
      if (stravaActivity?.id) {
        try {
          await this.logStravaActivity(userId, stravaActivity, 'skipped', error?.message || 'Validation failed');
        } catch (logErr) {
          console.error('[SyncService] Failed to log skipped activity:', logErr);
        }
      }
      return false;
    }

    // Alem de pontuar via ScoreEngine (XP/score gerais), atividades de CORRIDA
    // sincronizadas do Strava tambem precisam alimentar running_stats,
    // run_sessions e o progresso de desafios Elite -- senao o usuario ganha
    // XP mas nunca aparece no ranking de corrida, no historico de corridas
    // nem progride desafios Elite. Isso era feito por
    // updateUserPerformance/updateEliteChallenges neste arquivo, mas essas
    // funcoes ficaram orfas (nunca chamadas) apos a consolidacao do
    // ScoreEngine (ver auditoria de anti-fraude/score, tasks #106-116).
    // Reativamos aqui SOMENTE a parte de stats/sessions/elite -- NAO
    // re-concedemos XP aqui, pois isso ja foi feito acima pelo ScoreEngine,
    // para nao causar dupla pontuacao.
    if (earnedPoints > 0) {
      const activityType = (stravaActivity?.type || stravaActivity?.sport_type || '').toString().toLowerCase();
      const isRunType = activityType.includes('run');

      if (isRunType) {
        try {
          const rawDistance = stravaActivity?.distance || 0;
          const km = rawDistance > 100 ? rawDistance / 1000 : rawDistance;
          const rawDurationSeconds = stravaActivity?.moving_time || stravaActivity?.elapsed_time || 0;
          const timeSeconds = rawDurationSeconds > 0 ? rawDurationSeconds : 0;
          const elevationGain = stravaActivity?.total_elevation_gain || 0;
          const rawDate = stravaActivity?.start_date || stravaActivity?.start_date_local || stravaActivity?.created_at;
          const activityDate = rawDate ? new Date(rawDate).toISOString() : new Date().toISOString();

          if (km > 0) {
            await this.updateRunningStatsAndSession(userId, {
              km,
              timeSeconds,
              elevationGain,
              date: activityDate,
              stravaActivityId: stravaActivity?.id?.toString()
            });
            await this.updateEliteChallenges(userId, km, activityDate);
          }
        } catch (statsErr: any) {
          // Nao derruba o sync inteiro -- o XP ja foi concedido pelo
          // ScoreEngine acima, entao so registramos o erro para investigar.
          console.error(`[SyncService] Failed to update running_stats/elite challenges for Strava activity ${stravaActivity?.id}:`, statsErr);
        }
      }
    }

    return earnedPoints > 0;
  }

  private static async logStravaActivity(userId: string, stravaActivity: any, status: string, reason: string) {
    console.log("Firestore Operation:", {
      collection: "strava_activities",
      document: stravaActivity.id.toString(),
      operation: "set"
    });
    await db.collection('strava_activities').doc(stravaActivity.id.toString()).set({
      userId,
      stravaActivityId: stravaActivity.id,
      status,
      fraudReason: reason,
      createdAt: FieldValue.serverTimestamp()
    });
    console.log("Firestore Success");
  }

  // Atualiza running_stats (melhor km da semana/mes, ultima corrida) e cria um
  // registro em run_sessions para uma corrida sincronizada do Strava. Espelha
  // o que RunningService.addRun() faz para corridas nativas, para que
  // corridas do Strava tambem contem para o ranking de corrida
  // (running-repository.ts getRanking) e para o historico (getRunHistory).
  private static async updateRunningStatsAndSession(userId: string, activity: { km: number, timeSeconds: number, elevationGain: number, date: string, stravaActivityId?: string }) {
    const km = activity.km;
    const normalizedActivityDate = activity.date;
    const statsRef = db.collection('running_stats').doc(userId);

    console.log("Firestore Operation:", { collection: "running_stats", document: userId, operation: "get" });
    const statsSnap = await statsRef.get();
    console.log("Firestore Success");

    const statsData = statsSnap.exists ? statsSnap.data() : {
      userId, best_run_km_month: 0, best_run_km_week: 0, last_run_date: normalizedActivityDate
    };

    const updates: any = {
      userId,
      last_run_date: normalizedActivityDate,
      last_run_stats: {
        km,
        timeSeconds: activity.timeSeconds,
        elevationGain: activity.elevationGain,
        date: normalizedActivityDate,
        source: 'strava',
        stravaActivityId: activity.stravaActivityId
      },
      updatedAt: FieldValue.serverTimestamp()
    };

    if (km > (statsData?.best_run_km_month || 0)) updates.best_run_km_month = km;
    if (km > (statsData?.best_run_km_week || 0)) updates.best_run_km_week = km;

    console.log("Firestore Operation:", { collection: "running_stats", document: userId, operation: "set" });
    await statsRef.set(updates, { merge: true });
    console.log("Firestore Success");

    console.log("Firestore Operation:", { collection: "run_sessions", document: "auto-generated", operation: "add" });
    await db.collection('run_sessions').add({
      userId,
      km,
      duration: activity.timeSeconds,
      source: 'strava',
      stravaActivityId: activity.stravaActivityId,
      createdAt: FieldValue.serverTimestamp(),
      date: normalizedActivityDate
    });
    console.log("Firestore Success");
  }

  private static async updateEliteChallenges(userId: string, km: number, dateStr: string) {
    try {
      const activityDate = new Date(dateStr);

      console.log("[ELITE] Loading active challenges...");
      console.log("Firestore Operation:", { collection: "user_elite_challenges", document: `query(userId==${userId}, status==active)`, operation: "get" });

      const challengesSnap = await db.collection('user_elite_challenges')
        .where('userId', '==', userId)
        .where('status', '==', 'active')
        .get();
      console.log("Firestore Success");
      console.log(`[ELITE] Found ${challengesSnap.size} active challenge(s).`);

      const batch = db.batch();
      let batchOperationsCount = 0;

      challengesSnap.forEach(doc => {
        const data = doc.data();
        const startDate = new Date(data.startDate);
        const endDate = new Date(data.endDate);

        if (activityDate >= startDate && activityDate <= endDate) {
          const newKm = (data.currentKm || 0) + km;
          const status = newKm >= data.targetKm ? 'completed' : 'active';

          console.log("Firestore Operation:", { collection: "user_elite_challenges", document: doc.id, operation: "batch.update" });
          batch.update(doc.ref, {
            currentKm: newKm,
            status,
            lastActivityAt: activityDate.toISOString(),
            updatedAt: FieldValue.serverTimestamp()
          });
          batchOperationsCount++;

          if (status === 'completed') {
            console.log("Firestore Operation (UNAWAITED PROMISE NOTICE):", { collection: "elite_feed", document: "auto-generated", operation: "add" });
            db.collection('elite_feed').add({
              userId,
              userName: 'Atleta',
              text: `completou o desafio de ${data.targetKm}KM!`,
              type: 'challenge_complete',
              timestamp: FieldValue.serverTimestamp()
            }).then(() => {
              console.log("Firestore Success (elite_feed.add)");
            }).catch(err => {
              console.error("================================");
              console.error("ELITE FEED ADD UNHANDLED REJECTION");
              console.error("Collection: elite_feed");
              console.error("Message:", err?.message);
              console.error("Stack:", err?.stack);
              console.error(err);
              console.error("================================");
            });
          }
        }
      });

      if (batchOperationsCount > 0) {
        console.log("[ELITE] Committing batch update...");
        console.log("Firestore Operation:", { collection: "user_elite_challenges", document: "batch", operation: "commit" });
        await batch.commit();
        console.log("Firestore Success");
        console.log("[ELITE OK]");
      } else {
        console.log("[ELITE OK] No batch updates needed.");
      }
    } catch (error: any) {
      console.error("================================");
      console.error("UPDATE ELITE CHALLENGES ERROR");
      console.error("Collection: user_elite_challenges");
      console.error("Document:", userId);
      console.error("Message:", error?.message);
      console.error("Stack:", error?.stack);
      console.error("Cause:", error?.cause);
      console.error(error);
      console.error("================================");
      throw error;
    }
  }
}
