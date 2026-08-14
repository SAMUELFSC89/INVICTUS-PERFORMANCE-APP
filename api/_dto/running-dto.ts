export interface AddRunRequest {
  userId: string;
  km: number;
  timeSeconds?: number;
  pace?: string;
  calories?: number;
  elevationGain?: number;
  steps?: number;
  trajectory?: any[];
  date?: string;
  session?: Record<string, any>;
  isMockLocation?: boolean;
  isEmulator?: boolean;
  isRooted?: boolean;
  isDeveloperMode?: boolean;
  hasSensorOscillation?: boolean;
  sensorStatus?: string;
  avgHeartRate?: number;
  sensorTelemetry?: { accelVariance?: number; gyroVariance?: number };
}

export interface AddRunResponse {
  success: boolean;
  status: string;
  isScoringEligible?: boolean;
  nonScoringReason?: string | null;
  pointsEarned?: number;
  pointsAwarded?: number;
  userMessage?: string;
  message?: string;
  presenceCheckRequired?: boolean;
  presenceCheckId?: string;
  livenessPrompt?: string;
  sessionId?: string | null;
  [key: string]: any;
}

export interface GetRankingResponse {
  ranking: Array<{
    userId: string;
    displayName: string;
    photoURL?: string | null;
    km: number;
    is_paid_running?: boolean;
  }>;
  totalPool: number;
}
