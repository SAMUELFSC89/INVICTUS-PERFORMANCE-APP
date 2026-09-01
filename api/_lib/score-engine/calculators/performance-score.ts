export function calculatePerformanceScorePure(
  _type: string,
  rawDuration: number,
  userData: any,
  activityData: any
) {
  const scoredDays = userData.scoredDays || [];
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

  const age = userData.age || 25;
  const FCmax = 208 - (0.7 * age);
  const smartwatchData = activityData.smartwatchData || userData.smartwatchData;
  let heartRateScore = 75;
  if (smartwatchData && (smartwatchData.maxHR || smartwatchData.avgHR)) {
    const hr = Math.max(smartwatchData.maxHR || 0, smartwatchData.avgHR || 0);
    if (hr > 0) {
      const percentage = (hr / FCmax) * 100;
      heartRateScore = Math.max(0, Math.min(100, Math.round(percentage)));
    }
  }

  const weight = userData.weight || 70;
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

  return {
    basePoints,
    breakdown: { timeScore, heartRateScore, calorieScore, frequencyScore, finalScore: basePoints }
  };
}
