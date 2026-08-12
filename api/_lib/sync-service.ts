import { db, FieldValue } from './common.js';
import { getLevelFromXP } from './xpConfig.js';
import { startOfMonth, endOfMonth, startOfWeek, endOfWeek, isWithinInterval } from 'date-fns';
import { ScoreEngine } from './score-engine.js';

export class SyncService {
  static async processStravaActivity(userId: string, stravaActivity: any) {
    console.log(`[SyncService] Processing activity ${stravaActivity?.id} for user ${userId}`);

    try {
      const earnedPoints = await ScoreEngine.processStrava(userId, stravaActivity);
      console.log(`[SyncService] Activity ${stravaActivity?.id} processed by ScoreEngine. Points earned: ${earnedPoints}`);
      return earnedPoints > 0;
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

  private static async updateUserPerformance(userId: string, activity: { km: number, timeSeconds: number, elevationGain: number, date: string, stravaActivityId: string }) {
    try {
      const km = activity.km;
      const normalizedActivityDate = new Date(activity.date).toISOString();
      const statsRef = db.collection('running_stats').doc(userId);
      const userRef = db.collection('users').doc(userId);

      console.log("[USER] Loading user & running_stats...");
      console.log("Firestore Operation:", { collection: "running_stats", document: userId, operation: "get" });
      console.log("Firestore Operation:", { collection: "users", document: userId, operation: "get" });

      const [statsSnap, userSnap] = await Promise.all([statsRef.get(), userRef.get()]);
      console.log("Firestore Success");

      console.log("[USER CHECK]", {
        userExists: userSnap.exists,
        statsExists: statsSnap.exists
      });

      const statsData = statsSnap.exists ? statsSnap.data() : { 
        userId, best_run_km_month: 0, best_run_km_week: 0, last_run_date: normalizedActivityDate 
      };
      const userData = userSnap.data() || {};

      console.log("USER DATA", JSON.stringify(userData, null, 2));
      console.log("RUNNING STATS", JSON.stringify(statsData, null, 2));

      const now = new Date();
      const isPerformance = userData.subscriptionTier === 'performance';
      const xpAwarded = !isPerformance ? (20 + Math.floor(km * 5)) : 0;

      if (userData && xpAwarded > 0) {
        const newXP = (userData.xp || userData.totalXp || 0) + xpAwarded;
        const newLevel = getLevelFromXP(newXP);
        const userUpdates: any = {
          xp: newXP,
          totalXp: newXP,
          level: newLevel,
          updatedAt: FieldValue.serverTimestamp()
        };

        const lastCheckIn = userData.lastCheckIn ? new Date(userData.lastCheckIn) : new Date(0);
        const isNewMonth = now.getMonth() !== lastCheckIn.getMonth() || now.getFullYear() !== lastCheckIn.getFullYear();

        if (isNewMonth) {
          userUpdates.monthlyScore = xpAwarded;
        } else {
          userUpdates.monthlyScore = (userData.monthlyScore || 0) + xpAwarded;
        }

        userUpdates.lastCheckIn = normalizedActivityDate;

        console.log("[USER] Validating user document existence before update...");
        const userCheck = await userRef.get();
        console.log({ userExists: userCheck.exists });

        console.log("Firestore Operation:", { collection: "users", document: userId, operation: "update" });
        await userRef.update(userUpdates);
        console.log("Firestore Success");
        console.log("[USER OK]");
      }

      const updates: any = {
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

      console.log("[USER] Validating running_stats document existence before set...");
      const statsCheck = await statsRef.get();
      console.log({ statsExists: statsCheck.exists });

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
    } catch (error: any) {
      console.error("================================");
      console.error("UPDATE USER PERFORMANCE ERROR");
      console.error("Collection: users / running_stats / run_sessions");
      console.error("Document:", userId);
      console.error("Message:", error?.message);
      console.error("Stack:", error?.stack);
      console.error("Cause:", error?.cause);
      console.error(error);
      console.error("================================");
      throw error;
    }
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

