import { fraudLogger } from '../logger.js';

export interface UserBehavior {
  userId: string;
  timestamp: number;
  activitiesPerDay: number;
  averageDistance: number;
  averageDuration: number;
  peakHours: number[];
  weekdayPattern: number;
}

export interface BehaviorAnalysis {
  isSuspicious: boolean;
  fraudScore: number;
  flags: string[];
  anomalies: string[];
}

export class BehaviorAnalyzer {
  /**
   * Analisar padrão de comportamento do usuário
   */
  static analyzeBehavior(
    userId: string,
    currentBehavior: UserBehavior,
    historicalBehavior: UserBehavior[]
  ): BehaviorAnalysis {
    const result: BehaviorAnalysis = {
      isSuspicious: false,
      fraudScore: 0,
      flags: [],
      anomalies: []
    };

    if (historicalBehavior.length === 0) {
      return result; // Sem histórico
    }

    // 1. Aceleração anômala (0 → 100 atividades em 1 dia)
    const avgActivities = historicalBehavior.reduce((sum, b) => sum + b.activitiesPerDay, 0) / historicalBehavior.length;
    
    if (currentBehavior.activitiesPerDay > avgActivities * 5) {
      result.fraudScore += 35;
      result.flags.push('ACTIVITY_SPIKE');
      result.anomalies.push(`Activity spike: ${currentBehavior.activitiesPerDay} vs avg ${Math.round(avgActivities)}`);
      fraudLogger.warn({
        userId,
        currentActivities: currentBehavior.activitiesPerDay,
        averageActivities: Math.round(avgActivities)
      }, 'Activity spike detected');
    }

    // 2. Distância anômala (mudar padrão drasticamente)
    const avgDistance = historicalBehavior.reduce((sum, b) => sum + b.averageDistance, 0) / historicalBehavior.length;
    
    if (avgDistance > 0 && currentBehavior.averageDistance > avgDistance * 3) {
      result.fraudScore += 20;
      result.flags.push('DISTANCE_ANOMALY');
      result.anomalies.push(`Distance anomaly: ${Math.round(currentBehavior.averageDistance)}km vs avg ${Math.round(avgDistance)}km`);
    }

    // 3. Padrão temporal suspeito (atividades fora do horário usual)
    const usualHours = new Set(historicalBehavior.flatMap(b => b.peakHours));
    const hourNow = new Date().getHours();
    
    if (!usualHours.has(hourNow) && usualHours.size > 5) {
      result.fraudScore += 15;
      result.flags.push('UNUSUAL_TIME');
      result.anomalies.push(`Activity at unusual hour: ${hourNow}h`);
    }

    // 4. Mudança no padrão semanal
    const historicalWeekday = Math.round(
      historicalBehavior.reduce((sum, b) => sum + b.weekdayPattern, 0) / historicalBehavior.length
    );
    
    if (Math.abs(currentBehavior.weekdayPattern - historicalWeekday) > 4) {
      result.fraudScore += 10;
      result.flags.push('WEEKDAY_PATTERN_CHANGE');
      result.anomalies.push(`Weekday pattern changed`);
    }

    result.isSuspicious = result.fraudScore > 40;

    return result;
  }
}
