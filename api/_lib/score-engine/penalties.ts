export class PenaltyCalculator {
  static calculate(activityData: any, userData: any): { penalties: number; breakdown: any } {
    let penalties = 0;
    const details: string[] = [];

    if (!userData.biometricsComplete) {
      penalties += 0;
    }

    return {
      penalties,
      breakdown: { penalties, details }
    };
  }
}
