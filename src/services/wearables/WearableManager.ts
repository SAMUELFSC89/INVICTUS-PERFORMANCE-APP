import { db, auth } from '../../firebase';
import { collection, doc, getDoc, getDocs, query, where, setDoc, writeBatch, limit, increment } from 'firebase/firestore';
import { WearableProvider, WearableActivity, WearableConfig, WearableSyncLog, WearableSource } from './types';
import { HealthConnectProvider } from './HealthConnectProvider';
import { AppleHealthProvider } from './AppleHealthProvider';
import { StravaProvider } from './StravaProvider';
import { stravaService } from '../stravaService';
import { applyWorkoutProgress } from '../habitService';
import { Capacitor } from '@capacitor/core';

class FirestoreBatchChunker {
  private currentBatch = writeBatch(db);
  private opCount = 0;
  private maxOpsPerBatch = 450;
  private commitPromises: Promise<any>[] = [];

  public set(ref: any, data: any, options?: any) {
    if (this.opCount >= this.maxOpsPerBatch) {
      console.log(`[BATCH] Reached batch operation limit of ${this.maxOpsPerBatch}. Splitting batch and preparing commit...`);
      const batchToCommit = this.currentBatch;
      this.commitPromises.push(batchToCommit.commit());
      this.currentBatch = writeBatch(db);
      this.opCount = 0;
    }
    if (options) {
      this.currentBatch.set(ref, data, options);
    } else {
      this.currentBatch.set(ref, data);
    }
    this.opCount++;
  }

  public update(ref: any, data: any) {
    if (this.opCount >= this.maxOpsPerBatch) {
      console.log(`[BATCH] Reached batch operation limit of ${this.maxOpsPerBatch}. Splitting batch and preparing commit...`);
      const batchToCommit = this.currentBatch;
      this.commitPromises.push(batchToCommit.commit());
      this.currentBatch = writeBatch(db);
      this.opCount = 0;
    }
    this.currentBatch.update(ref, data);
    this.opCount++;
  }

  public async commit() {
    if (this.opCount > 0) {
      this.commitPromises.push(this.currentBatch.commit());
    }
    console.log(`[BATCH] Committing ${this.commitPromises.length} batch chunk(s) containing all operations...`);
    await Promise.all(this.commitPromises);
    console.log(`[BATCH] All batch chunks committed successfully.`);
  }
}

function isDuplicateActivity(newAct: WearableActivity, existingList: WearableActivity[]): boolean {
  // Normalize date properties before comparisons
  const newTimeNormalized = new Date(newAct.startTime).toISOString();

  // 1. Compare by ID if exists (using sourceActivityId)
  if (newAct.sourceActivityId) {
    const hasIdMatch = existingList.some(ext => 
      ext.source === newAct.source && ext.sourceActivityId === newAct.sourceActivityId
    );
    if (hasIdMatch) {
      console.log(`[DUPLICATE] ID match found: ${newAct.source}_${newAct.sourceActivityId}`);
      return true;
    }
  }

  // 2. Fallback: Compare by Start Time, Duration, and Activity Type using strict UTC
  const hasMetadataMatch = existingList.some(ext => {
    const extTimeNormalized = new Date(ext.startTime).toISOString();
    const tExt = new Date(extTimeNormalized).getTime();
    const tNew = new Date(newTimeNormalized).getTime();
    const sameStartTime = Math.abs(tExt - tNew) < 60000; // 60 seconds tolerance

    const sameDuration = Math.abs(ext.durationSeconds - newAct.durationSeconds) < 10; // 10 seconds tolerance

    const sameType = ext.activityType.toLowerCase() === newAct.activityType.toLowerCase();

    const isMatch = sameStartTime && sameDuration && sameType;
    if (isMatch) {
      console.log(`[DUPLICATE] [TIMEZONE] Metadata duplicate found under UTC matching: ext_start=${extTimeNormalized}, new_start=${newTimeNormalized} (source: ${ext.source} vs ${newAct.source})`);
    }
    return isMatch;
  });

  return hasMetadataMatch;
}

export class WearableManager {
  private static instance: WearableManager | null = null;
  private providers: Map<WearableSource, WearableProvider> = new Map();
  private config: WearableConfig | null = null;
  private isSyncing: boolean = false;

  private constructor() {
    // Register default providers
    this.registerProvider(new HealthConnectProvider());
    this.registerProvider(new AppleHealthProvider());
    this.registerProvider(new StravaProvider());
    
    // Auto-sync schedule check on start
    this.initAutoSync();
  }

  public static getInstance(): WearableManager {
    if (!this.instance) {
      this.instance = new WearableManager();
    }
    return this.instance;
  }

  public registerProvider(provider: WearableProvider) {
    this.providers.set(provider.id, provider);
  }

  public getProviders(): WearableProvider[] {
    return Array.from(this.providers.values());
  }

  public getProvider(id: WearableSource): WearableProvider | undefined {
    return this.providers.get(id);
  }

  /**
   * Initializes or loads the Wearable Configuration from Firestore
   */
  public async loadConfig(): Promise<WearableConfig> {
    const user = auth.currentUser;
    if (!user) throw new Error('Usuário não autenticado');

    const configRef = doc(db, 'wearable_configs', user.uid);
    try {
      const snap = await getDoc(configRef);
      let config: WearableConfig;
      if (snap.exists()) {
        config = snap.data() as WearableConfig;
      } else {
        // Create initial default config
        const defaultConfig: WearableConfig = {
          userId: user.uid,
          healthConnectConnected: false,
          healthConnectPermissions: [],
          appleHealthConnected: false,
          appleHealthPermissions: [],
          stravaConnected: false,
          autoSync: true,
          lastSyncTime: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        await setDoc(configRef, defaultConfig);
        config = defaultConfig;
      }

      // Sync Strava real status from server-side to WearableConfig
      try {
        const stravaStatus = await stravaService.getStatus();
        const stravaConnected = !!stravaStatus?.connected;
        if (config.stravaConnected !== stravaConnected) {
          config.stravaConnected = stravaConnected;
          await setDoc(configRef, { stravaConnected }, { merge: true });
        }
      } catch (err) {
        console.warn('[WearableManager] Failed to sync Strava status in loadConfig:', err);
      }

      this.config = config;
      this.syncLocalProviderStates(this.config);
      return this.config;
    } catch (error) {
      console.error('[WearableManager] Error loading config:', error);
      // Fallback local memory config
      if (!this.config) {
        this.config = {
          userId: user.uid,
          healthConnectConnected: false,
          healthConnectPermissions: [],
          appleHealthConnected: false,
          appleHealthPermissions: [],
          stravaConnected: false,
          autoSync: true,
          lastSyncTime: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
      }
      this.syncLocalProviderStates(this.config);
      return this.config;
    }
  }

  /**
   * Updates configuration properties
   */
  public async updateConfig(updates: Partial<WearableConfig>): Promise<WearableConfig> {
    const user = auth.currentUser;
    if (!user) throw new Error('Usuário não autenticado');

    const configRef = doc(db, 'wearable_configs', user.uid);
    const current = await this.loadConfig();
    const updated = {
      ...current,
      ...updates,
      updatedAt: new Date().toISOString()
    };

    await setDoc(configRef, updated);
    this.config = updated;
    this.syncLocalProviderStates(updated);
    return updated;
  }

  /**
   * Synchronizes localStorage and provider states with Firestore configuration
   */
  private syncLocalProviderStates(config: WearableConfig) {
    if (typeof window === 'undefined') return;
    
    // Update Apple Health
    const appleP = this.getProvider('apple_health');
    if (appleP) {
      if (config.appleHealthConnected) {
        localStorage.setItem('wearable_conn_apple_health', 'true');
        (appleP as any).connected = true;
      } else {
        localStorage.removeItem('wearable_conn_apple_health');
        (appleP as any).connected = false;
      }
    }

    // Update Health Connect
    const hcP = this.getProvider('health_connect');
    if (hcP) {
      if (config.healthConnectConnected) {
        localStorage.setItem('wearable_conn_health_connect', 'true');
        (hcP as any).connected = true;
      } else {
        localStorage.removeItem('wearable_conn_health_connect');
        (hcP as any).connected = false;
      }
    }

    // Update Strava
    if (config.stravaConnected) {
      localStorage.setItem('wearable_conn_strava', 'true');
    } else {
      localStorage.removeItem('wearable_conn_strava');
    }

    // Sync legacy smartwatchConnected state for compatibility across dashboards
    const anyConnected = !!(config.appleHealthConnected || config.healthConnectConnected || config.stravaConnected);
    localStorage.setItem('smartwatchConnected', String(anyConnected));
  }

  /**
   * Connects a provider by requesting permissions and saving connection status
   */
  public async connectProvider(providerId: WearableSource): Promise<boolean> {
    const provider = this.getProvider(providerId);
    if (!provider) throw new Error(`Provedor ${providerId} não registrado.`);

    const authorized = await provider.requestPermissions();
    if (authorized) {
      const updates: Partial<WearableConfig> = {};
      if (providerId === 'health_connect') {
        updates.healthConnectConnected = true;
        updates.healthConnectPermissions = ['read_heart_rate', 'read_steps', 'read_distance', 'read_calories', 'read_workouts'];
      } else if (providerId === 'apple_health') {
        updates.appleHealthConnected = true;
        updates.appleHealthPermissions = ['read_heart_rate', 'read_steps', 'read_distance', 'read_calories', 'read_workouts'];
      } else if (providerId === 'strava') {
        updates.stravaConnected = true;
      }

      await this.updateConfig(updates);
      await this.logSyncOperation(providerId, 'success', 0, 0, undefined);
      
      // Also update user's smartwatch flag on user profile to unlock Plano Performance
      const userRef = doc(db, 'users', auth.currentUser!.uid);
      await setDoc(userRef, {
        hasSmartwatchConnected: true,
        smartwatchProvider: providerId,
        is_paid_running: true // unlock points
      }, { merge: true }).catch(err => console.warn('Failed to update user profile with smartwatch status', err));

      // Also unlock the OFFICIAL running ranking eligibility. RunningRepository.getRanking()
      // queries is_paid_running on the running_stats collection (not users), so it must be
      // mirrored here or the official Corrida ranking never matches connected users.
      const runningStatsRef = doc(db, 'running_stats', auth.currentUser!.uid);
      await setDoc(runningStatsRef, { is_paid_running: true }, { merge: true }).catch(err => console.warn('Failed to update running_stats with is_paid_running flag', err));
      return true;
    }
    return false;
  }

  /**
   * Disconnects a provider and updates configurations
   */
  public async disconnectProvider(providerId: WearableSource): Promise<void> {
    const provider = this.getProvider(providerId);
    if (provider) {
      await provider.disconnect();
    }

    const updates: Partial<WearableConfig> = {};
    if (providerId === 'health_connect') {
      updates.healthConnectConnected = false;
      updates.healthConnectPermissions = [];
    } else if (providerId === 'apple_health') {
      updates.appleHealthConnected = false;
      updates.appleHealthPermissions = [];
    } else if (providerId === 'strava') {
      updates.stravaConnected = false;
    }

    await this.updateConfig(updates);
    
    // Check if any other wearable remains connected
    const config = this.config || await this.loadConfig();
    const stillConnected = config.healthConnectConnected || config.appleHealthConnected || config.stravaConnected;
    if (!stillConnected) {
      const userRef = doc(db, 'users', auth.currentUser!.uid);
      await setDoc(userRef, {
        hasSmartwatchConnected: false,
        smartwatchProvider: null
      }, { merge: true }).catch(() => {});
      const runningStatsRef2 = doc(db, 'running_stats', auth.currentUser!.uid);
      await setDoc(runningStatsRef2, { is_paid_running: false }, { merge: true }).catch(() => {});
    }
  }

  /**
   * Runs synchronization of all connected wearable providers
   */
  public async syncAll(): Promise<{ syncedCount: number; duplicatesSkipped: number; logs: WearableSyncLog[] }> {
    if (this.isSyncing) throw new Error('A sincronização já está em andamento.');
    this.isSyncing = true;

    const user = auth.currentUser;
    if (!user) {
      this.isSyncing = false;
      throw new Error('Usuário não autenticado');
    }

    const config = await this.loadConfig();
    const connectedProviders: WearableProvider[] = [];

    // Prioritize and determine the "Primary Source" (Origem Principal)
    // iPhone: Apple Health (Recommended) > Strava
    // Android / other: Health Connect (Recommended) > Strava
    const platform = Capacitor.getPlatform();
    const isIOS = platform === 'ios' || (typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent));

    let mainSource: WearableSource | null = null;
    if (isIOS) {
      if (config.appleHealthConnected) {
        mainSource = 'apple_health';
      } else if (config.stravaConnected) {
        mainSource = 'strava';
      }
    } else {
      if (config.healthConnectConnected) {
        mainSource = 'health_connect';
      } else if (config.stravaConnected) {
        mainSource = 'strava';
      }
    }

    if (mainSource) {
      const p = this.getProvider(mainSource);
      if (p) {
        connectedProviders.push(p);
      }
    }

    let totalSynced = 0;
    let totalDuplicates = 0;
    const logs: WearableSyncLog[] = [];

    // Fetch user's existing synced activities for comparison (last 30 days)
    const existingActivitiesList: WearableActivity[] = [];
    try {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const actQuery = query(
        collection(db, 'wearable_activities'),
        where('userId', '==', user.uid),
        where('startTime', '>=', thirtyDaysAgo.toISOString())
      );
      const snap = await getDocs(actQuery);
      snap.forEach(d => {
        const data = d.data() as WearableActivity;
        if (data.startTime) {
          data.startTime = new Date(data.startTime).toISOString();
        }
        existingActivitiesList.push(data);
      });
    } catch (error) {
      console.warn('[WearableManager] Failed to fetch existing activities for deduplication, querying without date filter as fallback:', error);
      try {
        const fallbackQuery = query(
          collection(db, 'wearable_activities'),
          where('userId', '==', user.uid)
        );
        const snap = await getDocs(fallbackQuery);
        snap.forEach(d => {
          const data = d.data() as WearableActivity;
          if (data.startTime) {
            data.startTime = new Date(data.startTime).toISOString();
          }
          existingActivitiesList.push(data);
        });
      } catch (fallbackError) {
        console.error('[WearableManager] Complete failure to fetch existing activities for deduplication:', fallbackError);
      }
    }

    // Determine the threshold date (last sync time or 7 days ago)
    const lastSyncThreshold = config.lastSyncTime 
      ? new Date(config.lastSyncTime) 
      : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    // Anti-fraud: aplica o mesmo limite diário de 100 pts usado nos treinos manuais (POINTS_CONFIG.LIMIT),
    // para que a sincronização de wearables não consiga ultrapassar o teto diário anti-trapaça.
    const DAILY_POINTS_LIMIT = 100;
    let todayPointsAccumulator = 0;
    try {
      const todayStr = new Date().toISOString().split('T')[0];
        const qTodayPoints = query(
            collection(db, 'workouts'),
                where('userId', '==', user.uid),
                    where('timestamp', '>=', todayStr),
                        limit(20)
                          );
                            const todayPointsSnap = await getDocs(qTodayPoints);
                              todayPointsSnap.forEach((d) => {
                                  const w = d.data() as any;
                                      if (w.status !== 'invalid') todayPointsAccumulator += w.points || 0;
                                        });
                                        } catch (error) {
                                          console.warn('[WearableManager] Falha ao consultar pontos do dia para aplicar o limite anti-trapaça:', error);
                                          }
                                          
                                          for (const provider of connectedProviders) {
      let syncedCount = 0;
      let duplicatesSkipped = 0;
      const cardioActivityIdsForHabit: string[] = [];

      try {
        console.log(`[WearableManager] Sincronizando ${provider.name} desde ${lastSyncThreshold.toISOString()}...`);
        const activities = await provider.fetchActivities(lastSyncThreshold);

        const batch = new FirestoreBatchChunker();
        let batchHasData = false;
        let pointsEarnedInThisProvider = 0;

        for (const act of activities) {
          // Strict ISO 8601 UTC conversion before any deduplication comparison or persistence (CORREÇÃO 3)
          act.startTime = new Date(act.startTime).toISOString();
          act.createdAt = new Date().toISOString();

          // Perform advanced deduplication (by ID, or by start time, duration, and type)
          if (isDuplicateActivity(act, existingActivitiesList)) {
            duplicatesSkipped++;
            continue;
          }

          // Compute point rewards: Cardio Rules (up to 120pts) or Muscle/Workout (up to 150pts)
          let calculatedPoints = 80; // default points
          const durationMins = act.durationSeconds / 60;

          if (act.activityType === 'Corrida' || act.activityType === 'Cardio' || act.activityType === 'Bike') {
            calculatedPoints = Math.min(120, Math.round(durationMins * 2.5));
            if (act.averageHeartRate > 130) {
              calculatedPoints = Math.min(120, calculatedPoints + 20); // biometric intensity bonus
            }
          } else if (act.activityType === 'Musculação') {
            calculatedPoints = Math.min(150, Math.round(durationMins * 2.0));
            if (act.averageHeartRate > 110) {
              calculatedPoints = Math.min(150, calculatedPoints + 15);
            }
          }

          // Aplica o teto anti-trapaça: nunca deixa a sincronização ultrapassar o limite diário de pontos.
          const remainingDailyBudget = Math.max(0, DAILY_POINTS_LIMIT - todayPointsAccumulator);
          calculatedPoints = Math.min(calculatedPoints, remainingDailyBudget);
          todayPointsAccumulator += calculatedPoints;
          
          act.pointsEarned = calculatedPoints;
          pointsEarnedInThisProvider += calculatedPoints;

          // Unique ID: source_sourceActivityId to ensure datastore unique constraints
          const uniqueDocId = `${act.source}_${act.sourceActivityId}`;
          const wearableActRef = doc(db, 'wearable_activities', uniqueDocId);
          act.id = uniqueDocId;
          batch.set(wearableActRef, act);

          // Save Workout
          const workoutRef = doc(db, 'workouts', act.id);
          batch.set(workoutRef, {
            userId: user.uid,
            type: (act.activityType === 'Corrida' || act.activityType === 'Cardio' || act.activityType === 'Bike') ? 'cardio' : 'workout',
            cardioType: act.activityType === 'Corrida' ? 'running' : (act.activityType === 'Bike' ? 'bike' : 'other'),
            timestamp: act.startTime,
            status: 'valid',
            points: calculatedPoints,
            duration: Math.round(durationMins),
            distance: act.distanceMeters / 1000,
            heartRate: act.averageHeartRate,
            calories: act.calories,
            steps: act.steps,
            source: act.source,
            smartwatchData: {
              pedometerSteps: act.steps,
              calories: act.calories,
              averageHeartRate: act.averageHeartRate,
              maxHeartRate: act.maxHeartRate,
              pace: act.pace,
              averageSpeed: act.averageSpeed,
              source: act.source
            },
            photoUrl: '',
            validated: true,
            createdAt: new Date().toISOString()
          });

          if (act.activityType === 'Corrida' || act.activityType === 'Cardio' || act.activityType === 'Bike') {
            cardioActivityIdsForHabit.push(act.id);
          }

          // Save Biometric Metrics
          const biometricRef = doc(collection(db, 'biometric_metrics'));
          batch.set(biometricRef, {
            userId: user.uid,
            workoutId: act.id,
            timestamp: act.startTime,
            type: act.activityType,
            heartRate: act.averageHeartRate,
            intensity: act.averageHeartRate > 140 ? 85 : 65,
            calories: act.calories,
            duration: Math.round(durationMins),
            consistency: 100,
            tempoScore: Math.round(75 + Math.random() * 20),
            cardioScore: act.averageHeartRate,
            energyScore: act.calories,
            consistencyScore: 100,
            pontuacaoJusta: calculatedPoints,
            contributeToResearch: true
          });

          // Challenges
          if (act.activityType === 'Corrida' && act.distanceMeters > 0) {
            const distanceKm = act.distanceMeters / 1000;
            await this.advanceUserChallenges(user.uid, distanceKm, batch);
          }

          syncedCount++;
          batchHasData = true;
          existingActivitiesList.push(act); // prevent local list duplication in same sync
        }

        if (batchHasData) {
          await batch.commit();

          const userRef = doc(db, 'users', user.uid);
          await setDoc(userRef, {
            score: increment(pointsEarnedInThisProvider),
            lastCheckIn: new Date().toISOString()
          }, { merge: true }).catch(err => console.warn('Failed to increment user score', err));
        }

        // Hábito ("Criar Hábito"): aplica progresso ao hábito ativo do usuário para cada
        // atividade cardio recém-sincronizada, de forma idempotente (por activityId no
        // backend) e não-bloqueante — nunca interrompe a sincronização do wearable.
        if (cardioActivityIdsForHabit.length > 0) {
          for (const habitWorkoutId of cardioActivityIdsForHabit) {
            applyWorkoutProgress(habitWorkoutId).catch(() => {});
          }
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('invictus:cardio-logged', { detail: { source: provider.id } }));
          }
        }

        const log = await this.logSyncOperation(provider.id, 'success', syncedCount, duplicatesSkipped, undefined);
        logs.push(log);

        totalSynced += syncedCount;
        totalDuplicates += duplicatesSkipped;

      } catch (err: any) {
        console.error(`[WearableManager] Falha ao sincronizar provedor ${provider.name}:`, err);
        const log = await this.logSyncOperation(provider.id, 'error', 0, 0, err.message || 'Erro desconhecido');
        logs.push(log);
      }
    }

    await this.updateConfig({
      lastSyncTime: new Date().toISOString()
    });

    this.isSyncing = false;
    return {
      syncedCount: totalSynced,
      duplicatesSkipped: totalDuplicates,
      logs
    };
  }

  /**
   * Automatically advances any active user elite distance challenges
   */
  private async advanceUserChallenges(userId: string, distanceKm: number, batch: any) {
    try {
      const qChallenges = query(
        collection(db, 'user_elite_challenges'),
        where('userId', '==', userId),
        where('status', '==', 'active')
      );
      const snap = await getDocs(qChallenges);

      for (const d of snap.docs) {
        const challengeData = d.data();
        const currentKm = challengeData.currentKm || 0;
        const targetKm = challengeData.targetKm || 0;
        const newKm = Math.round((currentKm + distanceKm) * 100) / 100;
        const completed = newKm >= targetKm;

        batch.update(d.ref, {
          currentKm: newKm,
          activitiesCount: increment(1),
          status: completed ? 'completed' : 'active',
          updatedAt: new Date().toISOString()
        });

        // Add a feed post to social if completed
        if (completed) {
          const feedRef = doc(collection(db, 'elite_feed'));
          batch.set(feedRef, {
            userId,
            userName: challengeData.userName || 'Atleta',
            text: `completou o desafio elite: ${challengeData.name || 'Desafio Invictus'} de ${targetKm}km! 🏆`,
            type: 'challenge_completed',
            timestamp: new Date().toISOString()
          });
        }
      }
    } catch (e) {
      console.warn('[WearableManager] Failed to auto-advance user elite challenges:', e);
    }
  }

  /**
   * Logs a synchronization operation inside Firestore
   */
  private async logSyncOperation(provider: WearableSource, status: 'success' | 'error', syncedCount: number, duplicatesSkipped: number, errorMessage?: string): Promise<WearableSyncLog> {
    const user = auth.currentUser;
    if (!user) throw new Error('Usuário não autenticado');

    const logRef = doc(collection(db, 'wearable_sync_logs'));
    const log: WearableSyncLog = {
      id: logRef.id,
      userId: user.uid,
      provider,
      status,
      syncedCount,
      duplicatesSkipped,
      errorMessage: errorMessage || '',
      timestamp: new Date().toISOString()
    };

    try {
      await setDoc(logRef, log);
    } catch (e) {
      console.warn('[WearableManager] Failed to write sync log to Firestore:', e);
    }
    return log;
  }

  /**
   * Schedules or runs auto sync on app load if option is active
   */
  private initAutoSync() {
    if (typeof window === 'undefined') return;

    // Check config periodically and auto sync
    setTimeout(async () => {
      try {
        const config = await this.loadConfig();
        if (config.autoSync) {
          // If autoSync is enabled and has been more than 4 hours since last sync, auto-trigger!
          const lastSync = config.lastSyncTime ? new Date(config.lastSyncTime).getTime() : 0;
          const diffHrs = (Date.now() - lastSync) / (1000 * 60 * 60);
          
          if (diffHrs > 4) {
            console.log('[WearableManager] Triggering background auto-sync...');
            await this.syncAll().catch(e => console.warn('[WearableManager] Auto-sync background failed silently:', e));
          }
        }
      } catch (e) {
        // Silently capture
      }
    }, 5000); // 5s after startup
  }
}
