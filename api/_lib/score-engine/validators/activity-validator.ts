import { RunActivity, GymCheckIn } from '../../schemas.js';
import { scoreLogger } from '../../logger.js';
import { SCORE_CONFIG } from '../../score-config.js';

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
      } else {
        // Antifraude: rejeita timestamps implausiveis (atividade "no futuro" alem
        // de uma tolerancia de relogio, ou absurdamente antiga - indicativo de
        // dados forjados/corrompidos). Ver auditoria de integridade.
        const nowMs = Date.now();
        const futureToleranceMs = SCORE_CONFIG.MAX_TIMESTAMP_FUTURE_MINUTES * 60 * 1000;
        const pastLimitMs = SCORE_CONFIG.MAX_TIMESTAMP_PAST_DAYS * 24 * 60 * 60 * 1000;
        if (parsed.getTime() > nowMs + futureToleranceMs) {
          errors.push('Activity timestamp is in the future');
        } else if (parsed.getTime() < nowMs - pastLimitMs) {
          errors.push('Activity timestamp is too old');
        }
      }
    }

    const { durationMins, durationSecs } = getNormalizedDuration(activity);
    const isDurationExemptType = type === 'checkin' || type === 'diet' || type === 'meal' || type === 'recovery';
    if (!isDurationExemptType) {
      // Antes, durationSecs<=0 passava sem erro (a condicao so disparava quando
      // durationSecs > 0), permitindo atividades com duracao zero/negativa
      // pontuarem. Ver auditoria de integridade.
      const minDurationSecs = SCORE_CONFIG.MIN_ACTIVITY_DURATION_SECS || 60;
      if (durationSecs <= 0) {
        errors.push('Activity duration is required and must be greater than zero');
      } else if (durationSecs < minDurationSecs) {
        errors.push(`Activity duration must be at least ${minDurationSecs} seconds`);
      } else if (durationSecs > SCORE_CONFIG.MAX_ACTIVITY_DURATION_SECS) {
        errors.push('Activity duration exceeds the maximum plausible duration');
      }
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
