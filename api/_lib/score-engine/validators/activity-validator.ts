import { RunActivity, GymCheckIn } from '../../schemas.js';
import { scoreLogger } from '../../logger.js';

export function getNormalizedDuration(activity: any): { durationMins: number; durationSecs: number } {
  if (!activity) return { durationMins: 0, durationSecs: 0 };

  let durationMins = 0;
  let durationSecs = 0;

  if (typeof activity.durationMins === 'number' && activity.durationMins > 0) {
    durationMins = activity.durationMins;
    durationSecs = activity.durationMins * 60;
  } else {
    const stravaSecs = activity.moving_time || activity.elapsed_time || activity.moving_time_seconds || activity.elapsed_time_seconds;
    if (typeof stravaSecs === 'number' && stravaSecs > 0) {
      durationSecs = stravaSecs;
      durationMins = stravaSecs / 60;
    } else if (typeof activity.duration === 'number' && activity.duration > 0) {
      const d = activity.duration;
      if (d >= 300) {
        durationSecs = d;
        durationMins = d / 60;
      } else if (activity.type === 'run' || activity.source === 'strava') {
        durationSecs = d;
        durationMins = d / 60;
      } else if (d <= 180) {
        durationMins = d;
        durationSecs = d * 60;
      } else {
        durationSecs = d;
        durationMins = d / 60;
      }
    }
  }

  // If activity has recorded movement/time (e.g. Strava short sprint or quick session),
  // clamp minimum duration to 1 minute so it passes sync and validation seamlessly.
  if (durationSecs > 0 && durationMins < 1.0) {
    durationMins = 1.0;
    durationSecs = Math.max(durationSecs, 60);
  }

  return { durationMins, durationSecs };
}

export class ActivityValidator {
  /**
   * Valida se atividade pode gerar score
   */
  static validateForScoring(activity: any): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!activity) {
      return { valid: false, errors: ['Activity payload is required'] };
    }

    const type = activity.type || activity.sport_type || activity.activityType;
    if (!type) {
      errors.push('Activity type is required');
    }

    const rawTs = activity.timestamp ?? activity.start_date ?? activity.start_date_local ?? activity.date ?? activity.createdAt;
    if (rawTs !== undefined && rawTs !== null) {
      const parsed = rawTs instanceof Date ? rawTs : new Date(rawTs);
      if (isNaN(parsed.getTime())) {
        errors.push('Invalid timestamp');
      }
    }

    const { durationMins, durationSecs } = getNormalizedDuration(activity);
    if (durationSecs > 0 && durationSecs < 5 && type !== 'checkin' && type !== 'diet' && type !== 'meal' && type !== 'recovery') {
      errors.push('Activity duration must be at least 5 seconds');
    }

    if ('distance' in activity && typeof activity.distance === 'number' && activity.distance > 0 && activity.distance < 0.01) {
      errors.push('Activity distance must be at least 0.01km');
    }

    if (errors.length > 0) {
      scoreLogger.warn({ activity, errors }, 'Activity validation failed');
      return { valid: false, errors };
    }

    return { valid: true, errors: [] };
  }

  /**
   * Valida se usuário pode receber score (não é fraude, não está banido, etc)
   */
  static validateUser(userId: string, userStatus: { isBanned?: boolean; accountAge?: number }): { valid: boolean; reason?: string } {
    if (userStatus.isBanned) {
      return { valid: false, reason: 'User is banned' };
    }

    if (userStatus.accountAge !== undefined && userStatus.accountAge < 86400000) { // 24 horas
      return { valid: false, reason: 'Account must be at least 24 hours old' };
    }

    return { valid: true };
  }
}
