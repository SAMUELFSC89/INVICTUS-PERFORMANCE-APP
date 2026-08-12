export interface IntensityEvaluation {
  score: number; // 0-100
  avgHR: number;
  maxHR: number;
  targetZoneText: string;
  timeInZoneMins: number;
  calories: number;
  caloriesPerKg: number;
  resultText: string;
  explanation: string;
  suggestion: string;
}

export function evaluateIntensity(
  rawDuration: number,
  userData: any,
  activityData: any
): IntensityEvaluation {
  const age = userData.age || 25;
  const weight = userData.weight || 70;
  const FCmax = 208 - (0.7 * age);
  
  const smartwatchData = activityData.smartwatchData || userData.smartwatchData || {};
  const avgHR = smartwatchData.avgHR || 0;
  const maxHR = smartwatchData.maxHR || 0;

  let calories = 0;
  if (smartwatchData && smartwatchData.calories) {
    calories = smartwatchData.calories;
  } else {
    const type = activityData.type || 'workout';
    const calPerMin = type === 'workout' ? 6.5 : 8.5;
    calories = rawDuration * calPerMin;
  }

  const caloriesPerKg = weight > 0 ? calories / weight : 0;

  let hrScore = 75;
  let targetZoneText = 'Zona Aeróbica Moderada (Z2/Z3)';
  let timeInZoneMins = Math.round(rawDuration * 0.7);

  if (avgHR > 0) {
    const hrPct = (avgHR / FCmax) * 100;
    if (hrPct >= 70 && hrPct <= 85) {
      hrScore = 100;
      targetZoneText = 'Zona Ideal de Queima e Hipertrofia (Z3)';
    } else if (hrPct >= 60 && hrPct < 70) {
      hrScore = 85;
      targetZoneText = 'Zona Leve / Regenerativa (Z2)';
    } else if (hrPct > 85) {
      hrScore = 80; // High intensity, may fatigue early
      targetZoneText = 'Zona Anaeróbica Máxima (Z4/Z5)';
    } else {
      hrScore = 60;
      targetZoneText = 'Abaixo da Zona Alvo (Z1)';
    }
  }

  let calScore = 70;
  if (caloriesPerKg >= 5) calScore = 100;
  else if (caloriesPerKg >= 4) calScore = 85;
  else if (caloriesPerKg >= 3) calScore = 70;
  else calScore = 50;

  const score = Math.round((hrScore * 0.6) + (calScore * 0.4));

  const resultText = avgHR > 0 
    ? `FC Média: ${avgHR} bpm (~${Math.round((avgHR/FCmax)*100)}% FCmáx) | ${Math.round(calories)} kcal (${caloriesPerKg.toFixed(1)} kcal/kg)`
    : `${Math.round(calories)} kcal estimadas (${caloriesPerKg.toFixed(1)} kcal/kg) sem smartwatch conectado.`;

  const explanation = `O objetivo não é permanecer com a frequência cardíaca máxima durante todo o treino. O ideal é permanecer tempo suficiente na zona que produz maior adaptação fisiológica para seu objetivo.`;

  let suggestion = 'Mantenha o ritmo na zona metabólica ideal.';
  if (score < 80) {
    if (avgHR > 0 && (avgHR / FCmax) * 100 < 65) {
      suggestion = `Grande parte do treino ocorreu abaixo da intensidade esperada. Aumente levemente a carga ou reduza os descansos para manter sua FC na zona-alvo.`;
    } else if (!smartwatchData.avgHR) {
      suggestion = `Conecte seu smartwatch para registrar a frequência cardíaca exata e elevar sua pontuação de intensidade.`;
    } else {
      suggestion = `Aumente ligeiramente o ritmo para permanecer pelo menos 15 minutos adicionais na zona metabólica ideal.`;
    }
  }

  return {
    score,
    avgHR,
    maxHR,
    targetZoneText,
    timeInZoneMins,
    calories,
    caloriesPerKg,
    resultText,
    explanation,
    suggestion
  };
}
