// Formula de pontos de RANKING (competicao), espelhando 1:1 src/lib/seasonUtils.ts
// (calculatePoints) no frontend. Existe uma copia aqui (em vez de importar direto de
// src/) porque as functions da api/ sao empacotadas isoladamente pela Vercel e nao
// devem depender de arquivos fora de api/. Qualquer ajuste na formula do frontend
// deve ser replicado aqui tambem.
//
// Motivo da existencia deste arquivo: ate 2026-08 o endpoint legado
// /api/validate-activity (usado pelo fluxo real de cardio/treino do app) so
// concedia XP (nivel) via UserRepository.addXP() e NUNCA incrementava o campo
// "score" que /api/ranking e o AdminDashboard usam para montar o ranking/leaderboard
// visivel ao usuario. Resultado: o usuario terminava uma atividade e via "+XX XP",
// mas o ranking de competicao nunca se movia. Ver auditoria 2026-08 (pedido do
// usuario: "XP nao e o mais importante e sim os pontos ganhos para a competicao").

export const POINTS_CONFIG = {
  CHECK_IN: 10,
  MAIN_ACTIVITY: 40,
  EXTRA: 30,
  DIET: 5,
  LIMIT: 100,
};

export const calculateConsistencyMultiplier = (streak: number): number => {
  if (streak >= 16) return 2.0;
  if (streak >= 8) return 1.5;
  if (streak >= 4) return 1.2;
  return 1.0;
};

function calculateOpenScore(type: string, rawDuration: number, context: any) {
  const scoredDays = context.scoredDays || [];
  const todayISO = new Date().toISOString().split('T')[0];
  const isTodayAlreadyScored = scoredDays.includes(todayISO);
  const daysTrainedVal = isTodayAlreadyScored ? scoredDays.length : (scoredDays.length + 1);
  const frequenciaSemanal = Math.max(1, Math.min(5, daysTrainedVal));

  const frequencyScore = Math.min(100, frequenciaSemanal * 20);

  const minMins = type === 'workout' ? 30 : 20;
  const duration = Math.min(rawDuration, 90);

  let timeScore = 0;
  if (duration >= minMins) {
    if (duration >= 90) {
      timeScore = 100;
    } else {
      const range = 90 - minMins;
      timeScore = Math.round(((duration - minMins) / range) * 100);
    }
  }

  const smartwatchData = context.smartwatchData;
  let calories = 0;
  if (smartwatchData && smartwatchData.calories) {
    calories = smartwatchData.calories;
  } else {
    const calPerMin = type === 'workout' ? 6.5 : 8.5;
    calories = rawDuration * calPerMin;
  }

  const weight = context.weight;
  let intensityScore: number | null = null;
  let isIntensityPending = false;

  if (!weight || weight <= 0) {
    isIntensityPending = true;
  } else {
    const caloriesPerKg = calories / weight;
    if (caloriesPerKg >= 6) intensityScore = 100;
    else if (caloriesPerKg >= 5) intensityScore = 85;
    else if (caloriesPerKg >= 4) intensityScore = 70;
    else if (caloriesPerKg >= 3) intensityScore = 55;
    else if (caloriesPerKg >= 2) intensityScore = 40;
    else intensityScore = 20;
  }

  let basePoints = 0;
  if (isIntensityPending) {
    basePoints = Math.round((frequencyScore * 0.50) + (timeScore * 0.50));
  } else {
    basePoints = Math.round((frequencyScore * 0.40) + (timeScore * 0.40) + ((intensityScore || 0) * 0.20));
  }

  return { basePoints };
}

function calculatePerformanceScore(type: string, rawDuration: number, context: any) {
  const scoredDays = context.scoredDays || [];
  const todayISO = new Date().toISOString().split('T')[0];
  const isTodayAlreadyScored = scoredDays.includes(todayISO);
  const daysTrainedVal = isTodayAlreadyScored ? scoredDays.length : (scoredDays.length + 1);
  const frequenciaSemanal = Math.max(1, Math.min(7, daysTrainedVal));

  let frequencyScore = 50;
  if (frequenciaSemanal === 2) frequencyScore = 75;
  else if (frequenciaSemanal === 3) frequencyScore = 90;
  else if (frequenciaSemanal === 4) frequencyScore = 95;
  else if (frequenciaSemanal >= 5) frequencyScore = 100;

  let maxMins = 90;
  if (frequenciaSemanal >= 5) maxMins = 60;
  else if (frequenciaSemanal === 4) maxMins = 70;
  else if (frequenciaSemanal === 3) maxMins = 80;
  else if (frequenciaSemanal <= 2) maxMins = 90;

  const finalDuration = Math.min(rawDuration, 90);
  let timeScore = 100;
  if (finalDuration < maxMins) {
    const timeScoreRaw = ((finalDuration - 30) / (maxMins - 30)) * 100;
    timeScore = Math.max(0, Math.min(100, Math.round(timeScoreRaw)));
  }

  const age = context.age || 25;
  const FCmax = 208 - (0.7 * age);
  const smartwatchData = context.smartwatchData;
  let heartRateScore = 75;
  if (smartwatchData && (smartwatchData.maxHR || smartwatchData.avgHR)) {
    const hr = Math.max(smartwatchData.maxHR || 0, smartwatchData.avgHR || 0);
    if (hr > 0) {
      const percentage = (hr / FCmax) * 100;
      heartRateScore = Math.max(0, Math.min(100, Math.round(percentage)));
    }
  }

  const weight = context.weight || 70;
  let calories = 0;
  if (smartwatchData && smartwatchData.calories) {
    calories = smartwatchData.calories;
  } else {
    calories = finalDuration * 6.0;
  }
  const relativeCalories = calories / weight;
  const maxRelativeCalLimit = 8.0;
  const calorieScore = Math.max(0, Math.min(100, Math.round((relativeCalories / maxRelativeCalLimit) * 100)));

  const basePoints = Math.round((timeScore + heartRateScore + calorieScore + frequencyScore) / 4);

  return { basePoints };
}

export interface RankingPointsContext {
  duration?: number;
  hasExercises?: boolean;
  hasPhoto?: boolean;
  isPaceConsistent?: boolean;
  hasNoPauses?: boolean;
  isDistanceCoherent?: boolean;
  iaConfidence?: number;
  subscriptionTier?: 'open' | 'performance';
  weight?: number;
  age?: number;
  smartwatchData?: { maxHR?: number; avgHR?: number; calories?: number };
  scoredDays?: string[];
}

export function calculateRankingPoints(
  type: 'workout' | 'cardio' | 'diet',
  streak: number,
  isFirstActionToday: boolean,
  context: RankingPointsContext,
  seasonBoost: number = 0
) {
  if (type === 'diet') {
    return {
      basePoints: 5,
      bonusMultiplier: 1.0,
      checkInBonus: 0,
      consistencyMultiplier: 1.0,
      earned: 5,
      totalTodayLimit: POINTS_CONFIG.LIMIT
    };
  }

  const rawDuration = context.duration || 0;
  const subTier = context.subscriptionTier || 'open';

  const minMins = (subTier === 'performance') ? 30 : (type === 'workout' ? 30 : 20);
  if (rawDuration < minMins) {
    return {
      basePoints: 0,
      bonusMultiplier: 1.0,
      checkInBonus: 0,
      consistencyMultiplier: 1.0,
      earned: 0,
      totalTodayLimit: POINTS_CONFIG.LIMIT
    };
  }

  let basePoints = 0;
  if (subTier === 'performance') {
    basePoints = calculatePerformanceScore(type, rawDuration, context).basePoints;
  } else {
    basePoints = calculateOpenScore(type, rawDuration, context).basePoints;
  }

  let bonusMultiplier = 1.0;
  let validationBonus = 0;

  if (type === 'workout') {
    if (context.hasExercises) bonusMultiplier += 0.05;
    if (context.hasPhoto) bonusMultiplier += 0.03;
  } else if (type === 'cardio') {
    if (context.isPaceConsistent) bonusMultiplier += 0.05;
    if (context.hasNoPauses) bonusMultiplier += 0.05;
    if (context.isDistanceCoherent) bonusMultiplier += 0.03;
  }

  const checkInBonus = isFirstActionToday ? POINTS_CONFIG.CHECK_IN : 0;
  const consistencyMultiplier = calculateConsistencyMultiplier(streak);

  if (context.iaConfidence && context.iaConfidence > 85) {
    validationBonus = 3;
  }

  let earned = Math.round((basePoints * bonusMultiplier + checkInBonus + validationBonus) * consistencyMultiplier);

  if (seasonBoost > 0) {
    earned = Math.round(earned * (1 + (seasonBoost / 100)));
  }

  earned = Math.min(POINTS_CONFIG.LIMIT, earned);

  return { basePoints, bonusMultiplier, checkInBonus, consistencyMultiplier, earned, totalTodayLimit: POINTS_CONFIG.LIMIT };
}
