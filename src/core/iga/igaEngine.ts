/**
 * IGA (Índice Global de Atividade) - Core Calculation Engine
 * 
 * Fórmula Oficial:
 * IGA = 100 * (Fn * Tn * In)^(1/3)
 * 
 * onde:
 * Fn = Frequência Normalizada (máximo 5 sessões)
 * Tn = Tempo Normalizado (minutos elegíveis de exercício)
 * In = Intensidade Normalizada (FC Relativa à FC Máxima)
 */

import {
  IGASession,
  IGAUserProfile,
  IGACalculationResult,
  IGASessionAudit,
  FrequencyConfig,
  TimeConfig,
  IntensityConfig,
  CalorieGateConfig,
  AgeHandicapConfig
} from './types.js';

import {
  normalizeFrequency,
  normalizeTime,
  normalizeIntensity,
  DEFAULT_FREQUENCY_CONFIG,
  DEFAULT_TIME_CONFIG,
  DEFAULT_INTENSITY_CONFIG
} from './normalizers.js';

import {
  calculateExpectedCalories,
  evaluateCalorieGate,
  DEFAULT_CALORIE_GATE_CONFIG
} from './calorieGate.js';

import {
  calculateAgeHandicap,
  DEFAULT_AGE_HANDICAP_CONFIG
} from './ageHandicap.js';

export interface IGAEngineOptions {
  frequencyConfig?: Partial<FrequencyConfig>;
  timeConfig?: Partial<TimeConfig>;
  intensityConfig?: Partial<IntensityConfig>;
  calorieGateConfig?: Partial<CalorieGateConfig>;
  ageHandicapConfig?: Partial<AgeHandicapConfig>;
}

/**
 * Estima a Frequência Cardíaca Máxima (FC Max) do usuário
 */
export function estimateMaxHeartRate(profile: IGAUserProfile): number {
  if (profile.maxHeartRate && profile.maxHeartRate > 100) {
    return profile.maxHeartRate;
  }
  const age = Math.max(12, Number(profile.age) || 30);
  return Math.round(220 - age);
}

/**
 * Motor Principal do Índice Global de Atividade (IGA)
 * Calcula a pontuação semanal do usuário com auditoria completa.
 */
export function calculateWeeklyIGA(
  sessions: IGASession[],
  userProfile: IGAUserProfile = {},
  options: IGAEngineOptions = {}
): IGACalculationResult {
  const timeCfg = { ...DEFAULT_TIME_CONFIG, ...options.timeConfig };
  const freqCfg = { ...DEFAULT_FREQUENCY_CONFIG, ...options.frequencyConfig };
  const intensityCfg = { ...DEFAULT_INTENSITY_CONFIG, ...options.intensityConfig };
  const calorieCfg = { ...DEFAULT_CALORIE_GATE_CONFIG, ...options.calorieGateConfig };
  const handicapCfg = { ...DEFAULT_AGE_HANDICAP_CONFIG, ...options.ageHandicapConfig };

  const fcMax = estimateMaxHeartRate(userProfile);
  const weightKg = userProfile.weightKg || 70;

  // 1. Filtrar sessões elegíveis segundo critérios de duração mínima
  const evaluatedSessions: IGASessionAudit[] = (sessions || []).map(sess => {
    const durationReal = Math.max(0, Number(sess.durationMinutes) || 0);
    // #239: teto de minutos CONTABILIZADOS por sessão. A duração real continua
    // sendo usada para checar o mínimo (uma sessão de 25 min não vira elegível
    // por causa do teto), mas só até `maxCountedMinutesPerSession` entra em T.
    const duration = Math.min(durationReal, timeCfg.maxCountedMinutesPerSession || durationReal);
    const typeLower = (sess.type || '').toLowerCase();
    let minMinutes = 15;

    if (typeLower.includes('workout') || typeLower.includes('muscul') || typeLower.includes('forca')) {
      minMinutes = timeCfg.minWorkoutMinutes; // 30 min
    } else if (typeLower.includes('cardio') || typeLower.includes('corrid') || typeLower.includes('run') || typeLower.includes('bike')) {
      minMinutes = timeCfg.minCardioMinutes; // 20 min
    }

    const isExplicitlyValid = sess.isValid !== false;
    const meetsDuration = durationReal >= minMinutes;
    const isEligible = isExplicitlyValid && meetsDuration;

    let ineligibleReason = undefined;
    if (!isExplicitlyValid) ineligibleReason = 'Sessão reprovada na validação';
    else if (!meetsDuration) ineligibleReason = `Tempo (${durationReal} min) abaixo do mínimo exigido (${minMinutes} min)`;

    // Estimar ou utilizar FC Média
    let avgHR = Number(sess.avgHeartRate) || 0;
    if (avgHR <= 0) {
      if (typeLower.includes('workout') || typeLower.includes('muscul')) {
        avgHR = Math.round(fcMax * intensityCfg.defaultWorkoutRelativeHR);
      } else if (typeLower.includes('cardio') || typeLower.includes('corrid')) {
        avgHR = Math.round(fcMax * intensityCfg.defaultCardioRelativeHR);
      } else {
        avgHR = Math.round(fcMax * intensityCfg.defaultOtherRelativeHR);
      }
    }

    const relativeHR = avgHR / fcMax;
    // Plausibilidade calórica usa a duração REAL, não a limitada: quem treinou
    // 120 min e gastou 900 kcal é coerente. Comparar 900 kcal contra as 90 min
    // do teto criaria uma falsa suspeita de caloria inflada.
    const expectedCal = calculateExpectedCalories(durationReal, sess.type, weightKg, calorieCfg);
    const informedCal = Number(sess.caloriesInformed) || 0;
    const gateResult = evaluateCalorieGate(informedCal, expectedCal, calorieCfg);

    return {
      sessionId: sess.id,
      type: sess.type,
      durationMinutes: duration,
      durationRealMinutes: durationReal,
      eligible: isEligible,
      ineligibleReason,
      avgHeartRate: avgHR,
      relativeHR: Math.round(relativeHR * 1000) / 1000,
      expectedCalories: expectedCal,
      informedCalories: informedCal,
      calorieRatio: gateResult.ratio,
      calorieGate: gateResult.gate,
      status: !isEligible ? 'ineligible' : gateResult.status
    };
  });

  // 2. Selecionar apenas as melhores até 5 sessões elegíveis (F <= 5)
  const eligibleSessions = evaluatedSessions
    .filter(s => s.eligible)
    .sort((a, b) => (b.durationMinutes * b.relativeHR) - (a.durationMinutes * a.relativeHR))
    .slice(0, freqCfg.maxSessions);

  const F = eligibleSessions.length;
  const Fn = normalizeFrequency(F, freqCfg);

  // 3. Tempo Total das Melhores Sessões (T)
  const totalTimeMinutes = eligibleSessions.reduce((acc, s) => acc + s.durationMinutes, 0);
  const Tn = normalizeTime(totalTimeMinutes, timeCfg);

  // 4. Intensidade Cardíaca Média Ponderada (I)
  let weightedHRSum = 0;
  let totalWeightedTime = 0;

  eligibleSessions.forEach(s => {
    weightedHRSum += s.avgHeartRate * s.durationMinutes;
    totalWeightedTime += s.durationMinutes;
  });

  const avgHeartRate = totalWeightedTime > 0 ? Math.round(weightedHRSum / totalWeightedTime) : 0;
  const avgRelativeHR = fcMax > 0 ? (avgHeartRate / fcMax) : 0;
  const In = normalizeIntensity(avgRelativeHR, intensityCfg);

  // 5. Fórmula Mestra do IGA: 100 * (Fn * Tn * In)^(1/3)
  const product = Fn * Tn * In;
  const igaBaseRaw = product > 0 ? 100 * Math.cbrt(product) : 0;
  const igaBase = Math.round(igaBaseRaw);

  // 6. Calorie Gate Overall
  const expectedCaloriesTotal = eligibleSessions.reduce((acc, s) => acc + s.expectedCalories, 0);
  const informedCaloriesTotal = eligibleSessions.reduce((acc, s) => acc + s.informedCalories, 0);

  let overallGate = 1.00;
  let overallCalorieRatio = 1.00;

  if (eligibleSessions.length > 0) {
    const minGate = Math.min(...eligibleSessions.map(s => s.calorieGate));
    overallGate = minGate;
    if (expectedCaloriesTotal > 0 && informedCaloriesTotal > 0) {
      overallCalorieRatio = Math.round((informedCaloriesTotal / expectedCaloriesTotal) * 100) / 100;
    }
  }

  const igaFinal = Math.round(igaBase * overallGate);

  // 7. Age Handicap (Desabilitado por padrão)
  const ageHandicapMultiplier = calculateAgeHandicap(userProfile.age, handicapCfg);
  const igaRanking = Math.round(igaFinal * ageHandicapMultiplier);

  // 8. Resumo da Auditoria
  const auditSummary = `[IGA Audit] Sessões Elegíveis: ${F}/5 | Tempo Total: ${totalTimeMinutes} min | FC Média: ${avgHeartRate} bpm (${Math.round(avgRelativeHR * 100)}% FC Max) | Fn: ${Fn.toFixed(2)}, Tn: ${Tn.toFixed(2)}, In: ${In.toFixed(2)} | IGA Base: ${igaBase} pts | Gate: ${overallGate.toFixed(2)} | IGA Final/Ranking: ${igaRanking} pts.`;

  return {
    frequency: F,
    totalTimeMinutes,
    avgHeartRate,
    maxHeartRate: fcMax,
    avgRelativeHR: Math.round(avgRelativeHR * 1000) / 1000,
    Fn: Math.round(Fn * 1000) / 1000,
    Tn: Math.round(Tn * 1000) / 1000,
    In: Math.round(In * 1000) / 1000,
    igaBase,
    expectedCaloriesTotal,
    informedCaloriesTotal,
    overallCalorieRatio,
    overallGate,
    igaFinal,
    ageHandicapMultiplier,
    igaRanking,
    topSessions: evaluatedSessions,
    auditSummary,
    calculatedAt: new Date().toISOString()
  };
}
