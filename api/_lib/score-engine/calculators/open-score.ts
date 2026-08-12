export function calculateOpenScorePure(
  type: string,
  rawDuration: number,
  userData: any,
  activityData: any
) {
  const scoredDays = userData.scoredDays || [];
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

  const smartwatchData = activityData.smartwatchData || userData.smartwatchData;
  let calories = 0;
  if (smartwatchData && smartwatchData.calories) {
    calories = smartwatchData.calories;
  } else {
    const calPerMin = type === 'workout' ? 6.5 : 8.5;
    calories = rawDuration * calPerMin;
  }

  const weight = userData.weight;
  let intensityScore: number | null = null;
  let caloriesPerKg: number | null = null;
  let isIntensityPending = false;

  if (!weight || weight <= 0) {
    isIntensityPending = true;
  } else {
    caloriesPerKg = calories / weight;
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

  return {
    basePoints,
    breakdown: { frequencyScore, timeScore, intensityScore, caloriesPerKg, finalScore: basePoints, isIntensityPending }
  };
}
