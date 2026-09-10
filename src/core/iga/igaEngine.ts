/**
 * IGA 2.0 (Índice Global de Atividade) - Core Calculation Engine
 *
 * Fórmula oficial:
 * IGA = ∛(F × T × I)
 *
 * Na implementação os fatores são armazenados como relativos (1.00 = 100),
 * então a forma equivalente é 100 × ∛(Fn × Tn × In).
 *
 * Regras centrais:
 * - F: consistência semanal com curva 15/30/55/80/100/105.
 * - T: qualidade de duração POR SESSÃO; retorno fortemente decrescente após 60 min.
 * - I: qualidade da FC por zonas, com suavização e transição contínua de ±5 bpm.
 * - Z4 é a maior recompensa e satura; Z5 não supera Z4.
 * - calorias NÃO entram nem reduzem a pontuação.
 * - não existe teto artificial de 100 para o IGA.
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
  DEFAULT_FREQUENCY_CONFIG,
  DEFAULT_TIME_CONFIG,
  DEFAULT_INTENSITY_CONFIG
} from './normalizers.js';

import { evaluateSessionIntensity } from './intensity.js';

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
 * Hierarquia de FC máxima do IGA 2.0:
 * 1) FCmáx medida/cadastrada confiável;
 * 2) FCmáx histórica validada;
 * 3) estimativa por idade como fallback.
 */
export function estimateMaxHeartRate(profile: IGAUserProfile): number {
  if (profile.maxHeartRate && profile.maxHeartRate > 100) {
    return profile.maxHeartRate;
  }
  if (profile.observedMaxHeartRate && profile.observedMaxHeartRate > 100) {
    return profile.observedMaxHeartRate;
  }
  const age = Math.max(12, Number(profile.age) || 30);
  return Math.round(220 - age);
}

function fallbackHeartRateForSession(type: string, fcMax: number, cfg: IntensityConfig): number {
  const typeLower = (type || '').toLowerCase();
  if (typeLower.includes('workout') || typeLower.includes('muscul') || typeLower.includes('forca')) {
    return Math.round(fcMax * cfg.defaultWorkoutRelativeHR);
  }
  if (typeLower.includes('cardio') || typeLower.includes('corrid') || typeLower.includes('run') || typeLower.includes('bike')) {
    return Math.round(fcMax * cfg.defaultCardioRelativeHR);
  }
  return Math.round(fcMax * cfg.defaultOtherRelativeHR);
}

/**
 * Motor principal do IGA 2.0. Calcula a pontuação semanal com auditoria.
 */
export function calculateWeeklyIGA(
  sessions: IGASession[],
  userProfile: IGAUserProfile = {},
  options: IGAEngineOptions = {}
): IGACalculationResult {
  const timeCfg = { ...DEFAULT_TIME_CONFIG, ...options.timeConfig };
  const freqCfg = { ...DEFAULT_FREQUENCY_CONFIG, ...options.frequencyConfig };
  const intensityCfg = { ...DEFAULT_INTENSITY_CONFIG, ...options.intensityConfig } as IntensityConfig;
  const calorieCfg = { ...DEFAULT_CALORIE_GATE_CONFIG, ...options.calorieGateConfig };
  const handicapCfg = { ...DEFAULT_AGE_HANDICAP_CONFIG, ...options.ageHandicapConfig };

  const fcMax = estimateMaxHeartRate(userProfile);
  const weightKg = userProfile.weightKg || 70;

  // 1. Avaliar cada sessão isoladamente. T e I são qualidade da sessão; F cuida
  // da quantidade. Isso evita pagar duas vezes pela mesma disponibilidade de tempo.
  const evaluatedSessions: IGASessionAudit[] = (sessions || []).map(sess => {
    const durationReal = Math.max(0, Number(sess.durationMinutes) || 0);
    const duration = Math.min(durationReal, timeCfg.maxCountedMinutesPerSession || durationReal);
    const typeLower = (sess.type || '').toLowerCase();
    let minMinutes = 15;

    if (typeLower.includes('workout') || typeLower.includes('muscul') || typeLower.includes('forca')) {
      minMinutes = timeCfg.minWorkoutMinutes;
    } else if (typeLower.includes('cardio') || typeLower.includes('corrid') || typeLower.includes('run') || typeLower.includes('bike')) {
      minMinutes = timeCfg.minCardioMinutes;
    }

    const isExplicitlyValid = sess.isValid !== false;
    const meetsDuration = durationReal >= minMinutes;
    const isEligible = isExplicitlyValid && meetsDuration;

    let ineligibleReason: string | undefined;
    if (!isExplicitlyValid) ineligibleReason = 'Sessão reprovada na validação';
    else if (!meetsDuration) ineligibleReason = `Tempo (${durationReal} min) abaixo do mínimo exigido (${minMinutes} min)`;

    const intensity = evaluateSessionIntensity({
      heartRateSamples: sess.heartRateSamples,
      avgHeartRate: sess.avgHeartRate,
      fallbackHeartRate: fallbackHeartRateForSession(sess.type, fcMax, intensityCfg),
      maxHeartRate: fcMax,
      config: intensityCfg,
    });
    const avgHR = Math.round(intensity.averageHeartRate);
    const relativeHR = fcMax > 0 ? avgHR / fcMax : 0;
    const timeFactor = normalizeTime(duration, timeCfg);

    // Calorias permanecem disponíveis para telemetria/auditoria, mas no IGA 2.0
    // não somam, não multiplicam, não reduzem e não mudam elegibilidade.
    const expectedCal = calculateExpectedCalories(durationReal, sess.type, weightKg, calorieCfg);
    const informedCal = Number(sess.caloriesInformed) || 0;
    const calorieCheck = evaluateCalorieGate(informedCal, expectedCal, calorieCfg);

    return {
      sessionId: sess.id,
      type: sess.type,
      durationMinutes: duration,
      durationRealMinutes: durationReal,
      eligible: isEligible,
      ineligibleReason,
      avgHeartRate: avgHR,
      relativeHR: Math.round(relativeHR * 1000) / 1000,
      timeFactor: Math.round(timeFactor * 1000) / 1000,
      intensityFactor: Math.round(intensity.factor * 1000) / 1000,
      intensitySource: intensity.source,
      heartRateSampleCount: intensity.sampleCount,
      expectedCalories: expectedCal,
      informedCalories: informedCal,
      calorieRatio: calorieCheck.ratio,
      calorieGate: calorieCheck.gate,
      status: !isEligible ? 'ineligible' : 'valid'
    };
  });

  // 2. Até 6 sessões: 5 = referência de consistência; a sexta recebe apenas o
  // pequeno bônus definido em F=105. A 7ª+ não aumenta o score.
  const eligibleSessions = evaluatedSessions
    .filter(s => s.eligible)
    .sort((a, b) => ((b.timeFactor || 0) * (b.intensityFactor || 0)) - ((a.timeFactor || 0) * (a.intensityFactor || 0)))
    .slice(0, freqCfg.maxSessions);

  const F = eligibleSessions.length;
  const Fn = normalizeFrequency(F, freqCfg);

  // 3. T = média da qualidade de duração das sessões selecionadas.
  // 60 min = 1.00; 90 min = apenas 1.04. Não é soma semanal linear.
  const totalTimeMinutes = eligibleSessions.reduce((acc, s) => acc + s.durationMinutes, 0);
  const Tn = eligibleSessions.length > 0
    ? eligibleSessions.reduce((acc, s) => acc + (s.timeFactor || 0), 0) / eligibleSessions.length
    : 0;

  // 4. I = média da qualidade cardiovascular por sessão, sem peso extra pela
  // duração. Assim tempo e intensidade permanecem fatores independentes.
  const In = eligibleSessions.length > 0
    ? eligibleSessions.reduce((acc, s) => acc + (s.intensityFactor || 0), 0) / eligibleSessions.length
    : 0;

  // FC média abaixo é somente auditoria/explicação; não substitui o cálculo por zonas.
  let weightedHRSum = 0;
  let totalWeightedTime = 0;
  eligibleSessions.forEach(s => {
    weightedHRSum += s.avgHeartRate * s.durationMinutes;
    totalWeightedTime += s.durationMinutes;
  });
  const avgHeartRate = totalWeightedTime > 0 ? Math.round(weightedHRSum / totalWeightedTime) : 0;
  const avgRelativeHR = fcMax > 0 ? avgHeartRate / fcMax : 0;

  // 5. Fórmula final. Não há clamp em 100.
  const product = Fn * Tn * In;
  const igaBaseRaw = product > 0 ? 100 * Math.cbrt(product) : 0;
  const igaBase = Math.round(igaBaseRaw);

  // 6. Calorias são somente informativas no IGA 2.0.
  const expectedCaloriesTotal = eligibleSessions.reduce((acc, s) => acc + s.expectedCalories, 0);
  const informedCaloriesTotal = eligibleSessions.reduce((acc, s) => acc + s.informedCalories, 0);
  let overallCalorieRatio = 1.00;
  if (expectedCaloriesTotal > 0 && informedCaloriesTotal > 0) {
    overallCalorieRatio = Math.round((informedCaloriesTotal / expectedCaloriesTotal) * 100) / 100;
  }
  const overallGate = 1.00;
  const igaFinal = igaBase;

  // 7. Handicap legado permanece configurável e desabilitado por padrão.
  const ageHandicapMultiplier = calculateAgeHandicap(userProfile.age, handicapCfg);
  const igaRanking = Math.round(igaFinal * ageHandicapMultiplier);

  const auditSummary = `[IGA-2.0] Sessões: ${F}/6 | Tempo contado: ${totalTimeMinutes} min | F: ${(Fn * 100).toFixed(0)} | T: ${(Tn * 100).toFixed(1)} | I: ${(In * 100).toFixed(1)} | FC média auditada: ${avgHeartRate} bpm (${Math.round(avgRelativeHR * 100)}% FCmáx) | Calorias: informativas, sem efeito | IGA: ${igaRanking} pts.`;

  return {
    formulaVersion: 'IGA-2.0',
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
