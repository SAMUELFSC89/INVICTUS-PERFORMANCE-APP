import { ActivitySource, ValidationStatus, ValidationReason, SCORE_CONFIG } from '../score-config.js';

export interface ValidationResult {
  status: ValidationStatus;
  reason: ValidationReason;
  flags: string[];
}

export class ScoreValidator {
  static validate(activityData: any, userData: any, source: ActivitySource): ValidationResult {
    const flags: string[] = [];

    if (source === ActivitySource.STRAVA) {
      if (activityData.manual) {
        return { status: ValidationStatus.INVALID, reason: ValidationReason.MANUAL_ENTRY, flags: ['STRAVA_MANUAL'] };
      }
      if (!activityData.hasGps) {
        return { status: ValidationStatus.INVALID, reason: ValidationReason.GPS_FAIL, flags: ['NO_GPS'] };
      }
      if (activityData.avgSpeed > SCORE_CONFIG.SPEED_LIMIT_MS) {
        return { status: ValidationStatus.INVALID, reason: ValidationReason.IMPOSSIBLE_SPEED, flags: ['IMPOSSIBLE_SPEED'] };
      }
    }

    if (activityData.type === 'workout' || activityData.type === 'cardio') {
      const minMins = (userData.subscriptionTier === 'performance') ? 30 : (activityData.type === 'workout' ? 30 : 20);
      if ((activityData.duration || 0) < minMins) {
        return { status: ValidationStatus.INVALID, reason: ValidationReason.PLAN_LIMIT, flags: ['INSUFFICIENT_DURATION'] };
      }
    }

    return { status: ValidationStatus.VALID, reason: ValidationReason.SUCCESS, flags };
  }
}
