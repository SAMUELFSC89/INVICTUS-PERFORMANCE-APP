import { SECURITY_CONFIG } from './security-config.js';
import { resolveModality } from './modality-config.js';

export interface ValidationResult {
  valid: boolean;
  reason?: string;
  warnings: string[];
  missingData: string[];
  details: {
    activityTypeValid: boolean;
    durationValid: boolean;
    gpsPresent: boolean;
    timeValid: boolean;
    dateValid: boolean;
    distanceValid: boolean;
    heartRateProvided: boolean;
    heartRateRequired: boolean;
    dataSourceValid: boolean;
    smartwatchConnected: boolean;
    userEligible: boolean;
  };
}

export class ValidationEngine {
  /**
   * Validation Engine: Performs strict pre-flight validation on raw activity payload.
   * Does NOT calculate scores or points.
   */
  static validate(activity: any, userData?: any): ValidationResult {
    const warnings: string[] = [];
    const missingData: string[] = [];
    const cfg = SECURITY_CONFIG.validation;

    // 1. Tipo de Atividade
    const rawType = (activity.activityType || activity.type || activity.sportType || 'GYM_WORKOUT').toString().toUpperCase();
    const activityTypeValid = Boolean(rawType && rawType.length > 0);
    if (!activityTypeValid) {
      missingData.push('activityType');
    }

    // 2. Duração Mínima e Máxima
    const durationMins = Number(activity.durationMins || activity.duration || (activity.durationSec ? activity.durationSec / 60 : 0));
    const durationValid = durationMins >= cfg.minDurationMins && durationMins <= cfg.maxDurationMins;
    if (durationMins < cfg.minDurationMins) {
      warnings.push(`Duração de ${durationMins} min abaixo do mínimo exigido (${cfg.minDurationMins} min).`);
    } else if (durationMins > cfg.maxDurationMins) {
      warnings.push(`Duração de ${durationMins} min excede o limite máximo por sessão (${cfg.maxDurationMins} min).`);
    }

    // 3. GPS presente quando necessário
    const modality = resolveModality(activity);
    const isGpsRequired = modality ? modality.requiresGps : cfg.requireGpsForTypes.includes(rawType);
    const hasGpsData = Boolean(
      (activity.checkpoints && Array.isArray(activity.checkpoints) && activity.checkpoints.length > 0) ||
      (activity.gpsTrack && activity.gpsTrack.length > 0) ||
      (activity.latitude && activity.longitude) ||
      activity.gymLocation
    );
    const gpsPresent = !isGpsRequired || hasGpsData;
    if (isGpsRequired && !hasGpsData) {
      missingData.push('GPS_TRACK');
      warnings.push(`Atividade do tipo ${rawType} exige dados de GPS.`);
    }

    // 4 & 5. Horário e Data Válidos
    const now = Date.now();
    const timestamp = activity.timestamp ? new Date(activity.timestamp).getTime() : now;
    const maxFutureMs = cfg.maxFutureTimestampToleranceSec * 1000;
    const maxAgeMs = cfg.maxActivityAgeDays * 24 * 60 * 60 * 1000;

    const isFuture = timestamp > (now + maxFutureMs);
    const isTooOld = (now - timestamp) > maxAgeMs;
    const timeValid = !isNaN(timestamp) && !isFuture;
    const dateValid = !isNaN(timestamp) && !isTooOld;

    if (isFuture) {
      warnings.push('Data/Horário da atividade está no futuro.');
    }
    if (isTooOld) {
      warnings.push(`Atividade possui mais de ${cfg.maxActivityAgeDays} dias de antiguidade.`);
    }

    // 6. Distância Válida
    const distanceKm = Number(activity.distanceKm || (activity.distanceMeters ? activity.distanceMeters / 1000 : 0));
    const distanceValid = distanceKm >= 0 && distanceKm <= cfg.maxDistanceKm;
    if (distanceKm > cfg.maxDistanceKm) {
      warnings.push(`Distância informada (${distanceKm} km) excede limite de ${cfg.maxDistanceKm} km.`);
    }

    // 7. Frequência Cardíaca (se obrigatória)
    const isHrRequired = cfg.requireHeartRateForTypes.includes(rawType);
    const hasHeartRate = Boolean(
      activity.avgHeartRate || activity.heartRate || (activity.hrSamples && activity.hrSamples.length > 0)
    );
    if (isHrRequired && !hasHeartRate) {
      missingData.push('HEART_RATE');
      warnings.push(`Frequência cardíaca é obrigatória para o tipo ${rawType}.`);
    }

    // 8. Origem dos Dados
    const source = (activity.source || activity.dataSource || 'MANUAL_VERIFIED').toString().toUpperCase();
    const dataSourceValid = cfg.allowedDataSources.includes(source) || source.length > 0;
    if (!cfg.allowedDataSources.includes(source)) {
      warnings.push(`Origem dos dados (${source}) não listada entre as fontes primárias confiáveis.`);
    }

    // 9. Smartwatch conectado
    const smartwatchConnected = Boolean(
      activity.smartwatchConnected ||
      activity.deviceInfo?.isWearable ||
      activity.hasWearableData ||
      ['GARMIN', 'POLAR', 'COROS', 'APPLE_HEALTH', 'HEALTH_CONNECT'].includes(source)
    );
    // Nota: smartwatchConnected e apenas informativo. O app suporta GPS
    // (corrida/caminhada) e check-in manual de academia como fontes primarias
    // validas sem exigir wearable conectado -- por isso isso NAO entra em
    // missingData nem bloqueia 'valid' (ver auditoria antifraude 2026-08).

    // 10. Usuário Elegível
    const isBanned = userData?.status === 'BANNED' || userData?.isSuspended || userData?.isBlocked;
    const userEligible = !isBanned;
    if (isBanned) {
      warnings.push('Usuário suspenso ou inapto para validação de atividades.');
    }

    // Decisão final de validação estrutural
    const valid = activityTypeValid &&
                  durationValid &&
                  gpsPresent &&
                  timeValid &&
                  dateValid &&
                  distanceValid &&
                  userEligible &&
                  missingData.length === 0;

    let reason: string | undefined;
    if (!valid) {
      if (missingData.length > 0) {
        reason = `Dados obrigatórios ausentes: ${missingData.join(', ')}`;
      } else if (warnings.length > 0) {
        reason = warnings[0];
      } else {
        reason = 'Requisitos mínimos de validação não atendidos.';
      }
    }

    return {
      valid,
      reason,
      warnings,
      missingData,
      details: {
        activityTypeValid,
        durationValid,
        gpsPresent,
        timeValid,
        dateValid,
        distanceValid,
        heartRateProvided: hasHeartRate,
        heartRateRequired: isHrRequired,
        dataSourceValid,
        smartwatchConnected,
        userEligible
      }
    };
  }
}
