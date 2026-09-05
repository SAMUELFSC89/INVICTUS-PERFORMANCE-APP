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
  details?: Record<string, any>;
}
