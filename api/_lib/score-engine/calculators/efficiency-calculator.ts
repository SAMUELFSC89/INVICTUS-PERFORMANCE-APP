export interface EfficiencyEvaluation {
  score: number; // 0-100
  totalDurationMins: number;
  activeTimeMins: number;
  idleTimeMins: number;
  activeRatioPct: number;
  resultText: string;
  explanation: string;
  suggestion: string;
}

export function evaluateEfficiency(
  rawDurationMins: number,
  checkpoints?: any[],
  activityData?: any
): EfficiencyEvaluation {
  const totalDurationMins = Math.max(1, rawDurationMins);
  
  let idleTimeMins = 0;
  if (activityData && typeof activityData.idleTimeMins === 'number') {
    idleTimeMins = activityData.idleTimeMins;
  } else if (checkpoints && checkpoints.length >= 2) {
    // Estimate idle time from pauses
    let pauseMs = 0;
    for (let i = 1; i < checkpoints.length; i++) {
      const dt = new Date(checkpoints[i].timestamp).getTime() - new Date(checkpoints[i-1].timestamp).getTime();
      if (dt > 180000) { // pauses > 3 minutes count as idle rest
        pauseMs += (dt - 120000); // count excess over 2 mins as idle
      }
    }
    idleTimeMins = Math.round(pauseMs / 60000);
  } else {
    // Standard gym estimation: 15-22% idle time
    idleTimeMins = Math.round(totalDurationMins * 0.18);
  }

  const activeTimeMins = Math.max(1, totalDurationMins - idleTimeMins);
  const activeRatioPct = Math.round((activeTimeMins / totalDurationMins) * 100);

  let score = 100;
  if (activeRatioPct >= 85) {
    score = 100;
  } else if (activeRatioPct >= 75) {
    score = 85;
  } else if (activeRatioPct >= 65) {
    score = 70;
  } else {
    score = 50;
  }

  const resultText = `Tempo total: ${totalDurationMins} min | Tempo ativo: ${activeTimeMins} min | Tempo parado: ${idleTimeMins} min (${100 - activeRatioPct}% do treino)`;

  let explanation = '';
  if (score >= 90) {
    explanation = `Sua sessão teve excelente densidade e aproveitamento do tempo ativo, mantendo a estimulação muscular contínua.`;
  } else {
    explanation = `Você permaneceu aproximadamente ${100 - activeRatioPct}% do treino sem atividade. Pequenos períodos de descanso são importantes, porém pausas prolongadas reduzem a eficiência e densidade da sessão.`;
  }

  let suggestion = 'Mantenha os descansos entre séries bem estruturados.';
  if (idleTimeMins > 8) {
    const targetReduction = Math.min(idleTimeMins - 5, Math.round(idleTimeMins * 0.5));
    const potentialScore = Math.min(100, score + 15);
    suggestion = `Se o tempo parado fosse reduzido em aproximadamente ${targetReduction} minutos, sua nota nesta métrica subiria para cerca de ${potentialScore} pontos.`;
  }

  return {
    score,
    totalDurationMins,
    activeTimeMins,
    idleTimeMins,
    activeRatioPct,
    resultText,
    explanation,
    suggestion
  };
}
