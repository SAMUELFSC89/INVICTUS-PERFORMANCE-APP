export class BonusCalculator {
  static calculate(activityData: any): { multiplierBonus: number; flatBonus: number; breakdown: any } {
    let multiplierBonus = 0;
    let flatBonus = 0;
    const details: string[] = [];

    if (activityData.type === 'workout') {
      if (activityData.hasExercises) {
        multiplierBonus += 0.05;
        details.push('+5% cadastrou exercicios');
      }
      if (activityData.hasPhoto) {
        multiplierBonus += 0.03;
        details.push('+3% foto do treino');
      }
    } else if (activityData.type === 'cardio' || activityData.type === 'run') {
      if (activityData.isPaceConsistent) {
        multiplierBonus += 0.05;
        details.push('+5% pace constante');
      }
      if (activityData.hasNoPauses) {
        multiplierBonus += 0.05;
        details.push('+5% sem pausas');
      }
      if (activityData.isDistanceCoherent) {
        multiplierBonus += 0.03;
        details.push('+3% distancia coerente');
      }
    }

    if (activityData.iaConfidence && activityData.iaConfidence > 85) {
      flatBonus += 3;
      details.push('+3 pts IA confianca > 85%');
    }

    return {
      multiplierBonus,
      flatBonus,
      breakdown: { multiplierBonus, flatBonus, details }
    };
  }
}
