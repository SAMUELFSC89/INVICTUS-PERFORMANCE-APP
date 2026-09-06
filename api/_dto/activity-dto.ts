export interface ValidateActivityRequest {
  userId: string;
  activityData: {
    type: string;
    /** Private observations; sanitized independently from competitive evidence. */
    healthSession?: unknown;
    duration: number;
    intensity: 'low' | 'moderate' | 'high';
    startTime: Date | string;
    endTime: Date | string;
    evidence?: {
      photoBase64?: string;
      framesBase64?: string[];
      location?: { latitude: number; longitude: number };
      heartRate?: number;
      calories?: number;
      steps?: number;
      exercise?: string;
      weight?: number;
      [key: string]: any;
    };
    [key: string]: any;
  };
}

export interface ValidateActivityResponse {
  success: boolean;
  activityId: string;
  scoreAwarded: number;
  rankingPointsEarned?: number;
  newRankingScore?: number;
  level: number;
  message: string;
  traceId: string;
  recordStatus?: 'completed';
  activityMode?: 'personal' | 'competitive' | 'unresolved';
  competitionReviewStatus?: 'not_required' | 'approved' | 'pending_review' | 'ineligible' | 'resolution_pending';
  competitionContexts?: Array<Record<string, any>>;
  status?: string;
  workout?: Record<string, any>;
  validation?: Record<string, any>;
  healthSession?: unknown;
  isScoringEligible?: boolean;
  details?: Record<string, any>;
}
