import { TrainingGoal, GOAL_WEIGHTS } from '../score-config.js';
import { TrainingQualityScoreResult, QualityBreakdown, MainImpacts, ScoreGainItem, ScoreLossItem } from './types.js';
import { evaluateConsistency } from './calculators/consistency-calculator.js';
import { evaluateIntensity } from './calculators/intensity-calculator.js';
import { evaluateEfficiency } from './calculators/efficiency-calculator.js';
import { evaluateTechnicalQuality } from './calculators/technical-quality-calculator.js';
import { evaluateDataIntegrity } from './calculators/data-integrity-calculator.js';
import { getNormalizedDuration } from './validators/activity-validator.js';

export class QualityEngine {
  static calculate(activityData: any, userData: any): TrainingQualityScoreResult {
    // 1. Determine user training goal
    const rawGoal = (userData.trainingGoal || userData.goal || 'HYPERTROPHY').toString().toUpperCase();
    let goal: TrainingGoal = TrainingGoal.HYPERTROPHY;
    if (rawGoal.includes('WEIGHT') || rawGoal.includes('EMAGRECIMENTO') || rawGoal.includes('FAT')) {
      goal = TrainingGoal.WEIGHT_LOSS;
    } else if (rawGoal.includes('ENDURANCE') || rawGoal.includes('RUN') || rawGoal.includes('CORRIDA')) {
      goal = TrainingGoal.ENDURANCE;
    } else if (rawGoal.includes('HEALTH') || rawGoal.includes('SAUDE')) {
      goal = TrainingGoal.GENERAL_HEALTH;
    }

    const { durationMins } = getNormalizedDuration(activityData);
    const rawDurationMins = durationMins > 0 ? durationMins : (activityData.durationMins || 30);
    const weeklyDays = (userData.scoredDays || []).length + 1;

    // 2. Compute foundational evaluations
    const consistency = evaluateConsistency(weeklyDays);
    const intensity = evaluateIntensity(rawDurationMins, userData, activityData);
    const efficiency = evaluateEfficiency(rawDurationMins, activityData.checkpoints, activityData);
    const technicalQuality = evaluateTechnicalQuality(activityData, userData);
    const dataIntegrity = evaluateDataIntegrity(activityData);

    // Additional sub-metrics for specialized goals
    const activeTimeScore = Math.round((efficiency.activeTimeMins / Math.max(1, efficiency.totalDurationMins)) * 100);
    const paceVal = activityData.avgPace || activityData.pace || 6.0; // min/km
    const paceScore = paceVal <= 5.0 ? 100 : paceVal <= 6.5 ? 85 : paceVal <= 8.0 ? 70 : 50;
    const cadenceVal = activityData.cadence || 165;
    const cadenceScore = cadenceVal >= 170 && cadenceVal <= 185 ? 100 : cadenceVal >= 155 ? 80 : 60;
    const recoveryScore = activityData.perceivedRecovery ? Math.min(100, activityData.perceivedRecovery * 20) : 85;

    let totalScore = 0;
    const weights = GOAL_WEIGHTS[goal] as Record<string, number>;

    if (goal === TrainingGoal.HYPERTROPHY) {
      totalScore = Math.round(
        (consistency.score * (weights.consistency ?? 0.3)) +
        (intensity.score * (weights.intensity ?? 0.3)) +
        (efficiency.score * (weights.efficiency ?? 0.2)) +
        (technicalQuality.score * (weights.technicalQuality ?? 0.15)) +
        (dataIntegrity.score * (weights.dataIntegrity ?? 0.05))
      );
    } else if (goal === TrainingGoal.WEIGHT_LOSS) {
      totalScore = Math.round(
        (consistency.score * (weights.consistency ?? 0.25)) +
        (activeTimeScore * (weights.activeTime ?? 0.25)) +
        (intensity.score * (weights.hrIntensity ?? 0.30)) +
        (intensity.score * (weights.caloriesPerKg ?? 0.15)) +
        (dataIntegrity.score * (weights.dataIntegrity ?? 0.05))
      );
    } else if (goal === TrainingGoal.ENDURANCE) {
      totalScore = Math.round(
        (consistency.score * (weights.consistency ?? 0.20)) +
        (paceScore * (weights.pace ?? 0.25)) +
        (cadenceScore * (weights.cadence ?? 0.20)) +
        (intensity.score * (weights.heartRate ?? 0.20)) +
        (recoveryScore * (weights.recovery ?? 0.10)) +
        (dataIntegrity.score * (weights.dataIntegrity ?? 0.05))
      );
    } else { // GENERAL_HEALTH
      totalScore = Math.round(
        (consistency.score * (weights.consistency ?? 0.20)) +
        (intensity.score * (weights.intensity ?? 0.20)) +
        (efficiency.score * (weights.efficiency ?? 0.20)) +
        (technicalQuality.score * (weights.technicalQuality ?? 0.20)) +
        (dataIntegrity.score * (weights.dataIntegrity ?? 0.20))
      );
    }

    if (dataIntegrity.isFraudDetected) {
      totalScore = 0;
    }

    // 3. Dynamic Gains & Losses Breakdown Calculation
    const gains: ScoreGainItem[] = [];
    const losses: ScoreLossItem[] = [];

    // Consistency
    const consistencyWeight = weights.consistency ?? 0.2;
    if (consistency.score >= 80) {
      gains.push({
        category: 'Consistência',
        label: `Frequência de ${consistency.daysTrained} dias/semana no objetivo`,
        points: Math.round(consistency.score * consistencyWeight)
      });
    } else {
      const lostPts = Math.round((100 - consistency.score) * consistencyWeight);
      losses.push({
        category: 'Consistência',
        label: `Abaixo da meta semanal (${consistency.daysTrained} dias)`,
        pointsLost: lostPts,
        reason: 'Espaçamento excessivo entre estímulos corporais.',
        fixSuggestion: consistency.suggestion
      });
    }

    // Intensity
    const intensityWeight = weights.intensity ?? weights.hrIntensity ?? 0.2;
    if (intensity.score >= 80) {
      gains.push({
        category: 'Intensidade',
        label: intensity.avgHR > 0 ? `FC Média em Z3/Z4 (${intensity.avgHR} bpm)` : 'Gasto calórico proporcional adequado',
        points: Math.round(intensity.score * intensityWeight)
      });
    } else {
      const lostPts = Math.round((100 - intensity.score) * intensityWeight);
      losses.push({
        category: 'Intensidade',
        label: 'Frequência cardíaca / estímulo metabólico abaixo da zona-alvo',
        pointsLost: lostPts,
        reason: 'Sessão com estímulo fisiológico aquém da faixa ideal.',
        fixSuggestion: intensity.suggestion
      });
    }

    // Efficiency / Pauses
    const efficiencyWeight = weights.efficiency ?? weights.activeTime ?? 0.2;
    if (efficiency.score >= 80) {
      gains.push({
        category: 'Eficiência',
        label: `Excelente densidade de treino (${efficiency.activeRatioPct}% tempo ativo)`,
        points: Math.round(efficiency.score * efficiencyWeight)
      });
    } else {
      const lostPts = Math.round((100 - efficiency.score) * efficiencyWeight);
      losses.push({
        category: 'Eficiência',
        label: `Tempo excessivo parado entre séries (${efficiency.idleTimeMins} min)`,
        pointsLost: lostPts,
        reason: 'Pausas prolongadas reduzem a densidade e esfriam a frequência cardíaca.',
        fixSuggestion: efficiency.suggestion
      });
    }

    // Technical Quality & Photo/Exercises
    const techQualityWeight = weights.technicalQuality ?? weights.cadence ?? 0.15;
    if (technicalQuality.score >= 80) {
      gains.push({
        category: 'Qualidade Técnica',
        label: 'Exercícios cadastrados e comprovantes auditados',
        points: Math.round(technicalQuality.score * techQualityWeight)
      });
    } else {
      const lostPts = Math.round((100 - technicalQuality.score) * techQualityWeight);
      losses.push({
        category: 'Qualidade Técnica',
        label: 'Falta de foto ou lista completa de exercícios',
        pointsLost: lostPts,
        reason: 'Registros incompletos reduzem a comprovabilidade técnica.',
        fixSuggestion: technicalQuality.suggestion
      });
    }

    // Integrity
    if (dataIntegrity.score >= 90) {
      gains.push({
        category: 'Integridade dos Dados',
        label: 'Telemetria e GPS 100% autênticos',
        points: Math.round(dataIntegrity.score * (weights.dataIntegrity || 0.05))
      });
    } else {
      losses.push({
        category: 'Integridade dos Dados',
        label: 'Inconsistência em sensores ou GPS',
        pointsLost: Math.round((100 - dataIntegrity.score) * (weights.dataIntegrity || 0.05)),
        reason: dataIntegrity.fraudReason || 'Inconsistência de segurança.',
        fixSuggestion: dataIntegrity.suggestion
      });
    }

    // 4. Calculate Main Positive and Negative Impacts
    let highestPositive = {
      title: 'Excelente Consistência Semanal',
      description: 'Sua frequência de treino manteve a supercompensação muscular no nível ideal.',
      category: 'Consistência',
      impactPoints: Math.max(...gains.map(g => g.points), 25)
    };

    if (gains.length > 0) {
      const bestGain = gains.reduce((prev, curr) => curr.points > prev.points ? curr : prev, gains[0]);
      highestPositive = {
        title: `Destaque: ${bestGain.category}`,
        description: bestGain.label,
        category: bestGain.category,
        impactPoints: bestGain.points
      };
    }

    let highestNegative = {
      title: 'Tempo Parado Entre Séries',
      description: 'Intervalos longos reduziram ligeiramente a densidade geral da sessão.',
      category: 'Eficiência',
      lossPoints: losses.length > 0 ? losses[0].pointsLost : 0
    };

    if (losses.length > 0) {
      const worstLoss = losses.reduce((prev, curr) => curr.pointsLost > prev.pointsLost ? curr : prev, losses[0]);
      highestNegative = {
        title: `Atenção: ${worstLoss.category}`,
        description: worstLoss.label,
        category: worstLoss.category,
        lossPoints: worstLoss.pointsLost
      };
    }

    const breakdown: QualityBreakdown = {
      gains,
      losses,
      subScores: {
        consistency: consistency.score,
        intensity: intensity.score,
        efficiency: efficiency.score,
        technicalQuality: technicalQuality.score,
        dataIntegrity: dataIntegrity.score,
        paceScore,
        cadenceScore,
        activeTimeScore
      }
    };

    const mainImpacts: MainImpacts = {
      highestPositive,
      highestNegative
    };

    return {
      score: totalScore,
      goal,
      goalWeightsUsed: weights as Record<string, number>,
      breakdown,
      mainImpacts
    };
  }
}
