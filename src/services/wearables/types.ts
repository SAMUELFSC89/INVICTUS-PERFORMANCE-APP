export type WearableSource = 'health_connect' | 'apple_health' | 'strava' | 'garmin' | 'fitbit' | 'polar';

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
  averageHeartRate: number;
  maxHeartRate: number;
  steps: number;
  averageSpeed: number; // m/s
  pace: string; // mm:ss / km
  biometricValidated: boolean; // meets heart rate variability and fraud criteria
  pointsEarned: number;
  createdAt: string;
  /** #248: rota real do GPS (quando o provedor e a atividade tiverem), usada
   * pelo antifraude pra confirmar deslocamento em modalidades de cardio. */
  checkpoints?: { latitude: number; longitude: number }[];
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
