export type WearableSource = 'health_connect' | 'apple_health' | 'strava' | 'garmin' | 'fitbit' | 'polar';

export interface WearableHeartRateSample {
  timestamp: string;
  bpm: number;
}

export interface WearableActivity {
  id: string; // unique internal id
  userId: string;
  source: WearableSource;
  sourceActivityId: string; // ID from the original provider
  activityType: string; // e.g., 'Corrida', 'Caminhada', 'Ciclismo', 'Musculação', 'Cardio'
  startTime: string; // ISO string
  durationSeconds: number;
  distanceMeters: number;
  calories: number;
  averageHeartRate?: number;
  maxHeartRate?: number;
  /** Passos contabilizados pela fonte dentro desta sessão, quando disponíveis. */
  steps?: number;
  /** Série bruta de FC; cada ponto precisa ter timestamp real da fonte. */
  heartRateSamples?: WearableHeartRateSample[];
  averageSpeed: number; // m/s
  pace: string; // mm:ss / km
  biometricValidated: boolean; // meets heart rate variability and fraud criteria
  pointsEarned: number;
  createdAt: string;
  /** #248: rota real do GPS (quando o provedor e a atividade tiverem), usada
   * pelo antifraude pra confirmar deslocamento em modalidades de cardio. */
  checkpoints?: { latitude: number; longitude: number; timestamp?: string }[];
}

export interface WearableConfig {
  userId: string;
  healthConnectConnected: boolean;
  healthConnectPermissions: string[];
  appleHealthConnected: boolean;
  appleHealthPermissions: string[];
  stravaConnected: boolean;
  autoSync: boolean;
  lastSyncTime: string | null;
  /** Versão da telemetria de atividade persistida pelo servidor. */
  activityTelemetryVersion?: number;
  /** Versão do backfill de vitais passivas (FC, passos, sono e energia). */
  healthVitalsVersion?: number;
  lastVitalsSyncTime: string | null;
  lastVitalsSyncBySource?: { apple_health?: string; health_connect?: string };
  healthVitalsVersionBySource?: { apple_health?: number; health_connect?: number };
  createdAt: string;
  updatedAt: string;
}

export interface WearableSyncLog {
  id: string;
  userId: string;
  provider: WearableSource;
  status: 'success' | 'error';
  syncedCount: number;
  duplicatesSkipped: number;
  errorMessage?: string;
  timestamp: string;
}

export interface WearableProvider {
  id: WearableSource;
  name: string;
  logoUrl?: string;
  description: string;
  isConnected(): Promise<boolean>;
  requestPermissions(): Promise<boolean>;
  fetchActivities(since: Date): Promise<WearableActivity[]>;
  disconnect(): Promise<void>;
}
