export interface BehaviorAnomaly {
  code: string;
  zScore?: number;
  description: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
}

export interface BehaviorResult {
  behaviorScore: number; // 0 - 100
  isBehaviorNormal: boolean;
  anomalies: BehaviorAnomaly[];
  baselineStats: {
    avgDurationMins: number;
    stdDevDurationMins: number;
    avgCalories: number;
    avgHeartRate: number;
    frequentHours: number[];
  };
}

export class BehaviorEngine {
  /**
   * Behavior Engine: Evaluates current activity against historical statistical baseline.
   * Uses Z-scores, Standard Deviation, and Frequency Histograms. Pure statistical model without external AI.
   */
  static evaluate(currentActivity: any, userHistory: any[] = []): BehaviorResult {
    const anomalies: BehaviorAnomaly[] = [];
    let behaviorScore = 100;

    // Filter valid historical activities for baseline calculation (need at least 3 for statistical relevance)
    const validHistory = userHistory.filter(
      (a: any) => a && (a.securityDecision === 'APPROVED' || a.securityDecision === 'PARTIALLY_APPROVED' || a.status === 'validated')
    );

    if (validHistory.length < 3) {
      // Insufficient baseline data: default to neutral behavior score without penalizing new users
      return {
        behaviorScore: 90,
        isBehaviorNormal: true,
        anomalies: [],
        baselineStats: {
          avgDurationMins: 30,
          stdDevDurationMins: 10,
          avgCalories: 300,
          avgHeartRate: 130,
          frequentHours: [7, 8, 18, 19]
        }
      };
    }

    // 1. Duration Baseline (Mean & Standard Deviation)
    const durations = validHistory.map((a: any) => Number(a.durationMins || a.duration || 30)).filter(d => d > 0);
    const avgDuration = BehaviorEngine.mean(durations);
    const stdDevDuration = BehaviorEngine.stdDev(durations, avgDuration);

    const currDuration = Number(currentActivity.durationMins || currentActivity.duration || 30);
    if (stdDevDuration > 0 && currDuration > 0) {
      const zScoreDuration = Math.abs((currDuration - avgDuration) / stdDevDuration);
      if (zScoreDuration > 3.5) {
        behaviorScore -= 30;
        anomalies.push({
          code: 'EXTREME_DURATION_DEVIATION',
          zScore: Number(zScoreDuration.toFixed(2)),
          description: `Duração de ${currDuration} min atípica para o perfil histórico (Média: ${Math.round(avgDuration)} min, Z-Score: ${zScoreDuration.toFixed(1)}).`,
          severity: 'HIGH'
        });
      } else if (zScoreDuration > 2.5) {
        behaviorScore -= 15;
        anomalies.push({
          code: 'MODERATE_DURATION_DEVIATION',
          zScore: Number(zScoreDuration.toFixed(2)),
          description: `Duração de ${currDuration} min divergente do padrão habitual.`,
          severity: 'MEDIUM'
        });
      }
    }

    // 2. Calorie Outlier Baseline
    const caloriesList = validHistory.map((a: any) => Number(a.calories || a.caloriesKcal || 0)).filter(c => c > 0);
    if (caloriesList.length >= 3) {
      const avgCalories = BehaviorEngine.mean(caloriesList);
      const stdDevCalories = BehaviorEngine.stdDev(caloriesList, avgCalories);
      const currCalories = Number(currentActivity.calories || currentActivity.caloriesKcal || 0);

      if (stdDevCalories > 0 && currCalories > 0) {
        const zScoreCalories = (currCalories - avgCalories) / stdDevCalories;
        if (zScoreCalories > 4.0) {
          behaviorScore -= 25;
          anomalies.push({
            code: 'EXTREME_CALORIE_SPIKE',
            zScore: Number(zScoreCalories.toFixed(2)),
            description: `Gasto calórico de ${currCalories} kcal foge substancialmente do histórico (Média: ${Math.round(avgCalories)} kcal).`,
            severity: 'HIGH'
          });
        }
      }
    }

    // 3. Heart Rate Pattern Shift
    const hrList = validHistory.map((a: any) => Number(a.avgHeartRate || a.heartRate || 0)).filter(h => h > 40);
    if (hrList.length >= 3) {
      const avgHr = BehaviorEngine.mean(hrList);
      const stdDevHr = BehaviorEngine.stdDev(hrList, avgHr);
      const currHr = Number(currentActivity.avgHeartRate || currentActivity.heartRate || 0);

      if (currHr > 0 && stdDevHr > 0) {
        const zScoreHr = Math.abs((currHr - avgHr) / stdDevHr);
        if (zScoreHr > 3.0 && currHr > avgHr) {
          behaviorScore -= 20;
          anomalies.push({
            code: 'HEART_RATE_SPIKE_DEVIATION',
            zScore: Number(zScoreHr.toFixed(2)),
            description: `Frequência cardíaca média (${currHr} BPM) desproporcional à média histórica (${Math.round(avgHr)} BPM).`,
            severity: 'MEDIUM'
          });
        }
      }
    }

    // 4. Workout Time Window Anomaly (e.g. usually trains 7am, suddenly 3:30am)
    const currentHour = currentActivity.timestamp ? new Date(currentActivity.timestamp).getHours() : new Date().getHours();
    const historicalHours = validHistory.map((a: any) => new Date(a.timestamp || Date.now()).getHours());
    const hourCounts = new Array(24).fill(0);
    historicalHours.forEach(h => hourCounts[h]++);

    // Check if user has ever trained within +/- 2 hours of currentHour
    const isHabitualHour = [currentHour - 2, currentHour - 1, currentHour, currentHour + 1, currentHour + 2]
      .some(h => hourCounts[(h + 24) % 24] > 0);

    if (!isHabitualHour && validHistory.length >= 5) {
      behaviorScore -= 10;
      anomalies.push({
        code: 'UNUSUAL_WORKOUT_HOUR',
        description: `Horário de treino (${currentHour}:00h) fora da janela habitual do atleta.`,
        severity: 'LOW'
      });
    }

    // 5. Gym Location Jump without historical precedent
    if (currentActivity.gymId && validHistory.some(a => a.gymId)) {
      const knownGyms = new Set(validHistory.map(a => a.gymId).filter(Boolean));
      if (!knownGyms.has(currentActivity.gymId) && knownGyms.size > 0) {
        behaviorScore -= 10;
        anomalies.push({
          code: 'UNREGISTERED_NEW_GYM_LOCATION',
          description: 'Treino realizado em unidade/academia inédita para o perfil.',
          severity: 'LOW'
        });
      }
    }

    behaviorScore = Math.max(0, Math.min(100, Math.round(behaviorScore)));
    const isBehaviorNormal = anomalies.filter(a => a.severity === 'HIGH').length === 0 && behaviorScore >= 70;

    return {
      behaviorScore,
      isBehaviorNormal,
      anomalies,
      baselineStats: {
        avgDurationMins: Math.round(avgDuration),
        stdDevDurationMins: Math.round(stdDevDuration),
        avgCalories: caloriesList.length > 0 ? Math.round(BehaviorEngine.mean(caloriesList)) : 0,
        avgHeartRate: hrList.length > 0 ? Math.round(BehaviorEngine.mean(hrList)) : 0,
        frequentHours: Array.from(new Set(historicalHours))
      }
    };
  }

  private static mean(arr: number[]): number {
    if (arr.length === 0) return 0;
    return arr.reduce((sum, v) => sum + v, 0) / arr.length;
  }

  private static stdDev(arr: number[], meanVal: number): number {
    if (arr.length < 2) return 0;
    const variance = arr.reduce((sum, v) => sum + Math.pow(v - meanVal, 2), 0) / (arr.length - 1);
    return Math.sqrt(variance);
  }
}
