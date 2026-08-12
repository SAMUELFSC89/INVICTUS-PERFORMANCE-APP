import { calculateOpenScorePure } from './calculators/open-score.js';
import { calculatePerformanceScorePure } from './calculators/performance-score.js';
import { calculateDietScorePure } from './calculators/diet-score.js';
import { calculateRecoveryScorePure } from './calculators/recovery-score.js';
import { calculateCheckinScorePure } from './calculators/checkin-score.js';

export class BaseScoreCalculator {
  static calculate(activityData: any, plan: 'open' | 'performance', userData: any): { basePoints: number; breakdown?: any } {
    if (activityData.type === 'diet') {
      return calculateDietScorePure();
    }
    if (activityData.type === 'recovery') {
      return calculateRecoveryScorePure();
    }
    if (activityData.type === 'checkin') {
      return calculateCheckinScorePure(!!activityData.hasPhoto);
    }

    const rawDuration = activityData.duration || 0;

    if (plan === 'performance') {
      return calculatePerformanceScorePure(activityData.type, rawDuration, userData, activityData);
    } else {
      return calculateOpenScorePure(activityData.type, rawDuration, userData, activityData);
    }
  }
}
