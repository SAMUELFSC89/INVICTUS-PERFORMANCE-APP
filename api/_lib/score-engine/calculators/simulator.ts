import { ConsistencyEvaluation } from './consistency-calculator.js';
import { IntensityEvaluation } from './intensity-calculator.js';
import { EfficiencyEvaluation } from './efficiency-calculator.js';
import { TechnicalQualityEvaluation } from './technical-quality-calculator.js';
import { DataIntegrityEvaluation } from './data-integrity-calculator.js';

export interface ImprovementItem {
  action: string;
  pointsGain: number;
  category: 'consistency' | 'intensity' | 'efficiency' | 'technicalQuality' | 'dataIntegrity';
}

export interface MaxScoreSimulation {
  currentScore: number;
  targetScore: number;
  estimatedTotalScore: number;
  simulatedImprovements: ImprovementItem[];
}

export function simulateMaxScore(
  currentScore: number,
  consistency: ConsistencyEvaluation,
  intensity: IntensityEvaluation,
  efficiency: EfficiencyEvaluation,
  technicalQuality: TechnicalQualityEvaluation,
  dataIntegrity: DataIntegrityEvaluation
): MaxScoreSimulation {
  const targetScore = 100;
  const needed = Math.max(0, targetScore - currentScore);
  const improvements: ImprovementItem[] = [];

  if (needed === 0 || dataIntegrity.isFraudDetected) {
    return {
      currentScore,
      targetScore: 100,
      estimatedTotalScore: currentScore,
      simulatedImprovements: needed === 0 ? [] : [
        { action: 'Corrigir integridade dos dados e desativar Mock Location', pointsGain: 100, category: 'dataIntegrity' }
      ]
    };
  }

  // 1. Efficiency improvement simulation
  if (efficiency.score < 95) {
    const deltaEff = Math.min(25, Math.round((100 - efficiency.score) * 0.20));
    if (deltaEff > 0) {
      const restReduc = Math.max(3, Math.round(efficiency.idleTimeMins * 0.4));
      improvements.push({
        action: `Reduzir cerca de ${restReduc} minutos de tempo parado entre séries`,
        pointsGain: deltaEff,
        category: 'efficiency'
      });
    }
  }

  // 2. Intensity improvement simulation
  if (intensity.score < 95) {
    const deltaInt = Math.min(25, Math.round((100 - intensity.score) * 0.25));
    if (deltaInt > 0) {
      if (intensity.avgHR === 0) {
        improvements.push({
          action: 'Conectar smartwatch para monitorar FC na zona ideal',
          pointsGain: deltaInt,
          category: 'intensity'
        });
      } else {
        improvements.push({
          action: 'Permanecer 10 minutos adicionais na zona-alvo de FC (Z3)',
          pointsGain: deltaInt,
          category: 'intensity'
        });
      }
    }
  }

  // 3. Technical Quality improvement simulation
  if (technicalQuality.score < 95) {
    const deltaTech = Math.min(20, Math.round((100 - technicalQuality.score) * 0.15));
    if (deltaTech > 0) {
      const missing = technicalQuality.checks.find(c => !c.passed);
      const actionText = missing 
        ? `Registrar: ${missing.label.toLowerCase()}` 
        : 'Anexar foto do treino e registrar a lista completa de exercícios';
      improvements.push({
        action: actionText,
        pointsGain: deltaTech,
        category: 'technicalQuality'
      });
    }
  }

  // 4. Consistency improvement simulation
  if (consistency.score < 95) {
    const deltaCons = Math.min(20, Math.round((100 - consistency.score) * 0.25));
    if (deltaCons > 0) {
      improvements.push({
        action: 'Completar mais 1 dia de treino consistente nesta semana',
        pointsGain: deltaCons,
        category: 'consistency'
      });
    }
  }

  // Calculate sum of simulated gains
  let accumulatedGain = 0;
  const finalImprovements: ImprovementItem[] = [];

  for (const item of improvements) {
    if (currentScore + accumulatedGain >= 100) break;
    const gainToTake = Math.min(item.pointsGain, 100 - (currentScore + accumulatedGain));
    if (gainToTake > 0) {
      finalImprovements.push({
        ...item,
        pointsGain: gainToTake
      });
      accumulatedGain += gainToTake;
    }
  }

  // If still need points to reach 100, add a general optimization item
  if (currentScore + accumulatedGain < 100) {
    const rem = 100 - (currentScore + accumulatedGain);
    finalImprovements.push({
      action: 'Manter a constância no plano e enviar a foto ao finalizar',
      pointsGain: rem,
      category: 'technicalQuality'
    });
    accumulatedGain += rem;
  }

  return {
    currentScore,
    targetScore: 100,
    estimatedTotalScore: currentScore + accumulatedGain,
    simulatedImprovements: finalImprovements
  };
}
