
export interface ConsistencyEvaluation {
  score: number; // 0-100
  daysTrained: number;
  resultText: string;
  explanation: string;
  suggestion: string;
}

export function evaluateConsistency(weeklyFrequency: number): ConsistencyEvaluation {
  const days = Math.max(1, Math.min(7, weeklyFrequency));
  let score = 50;
  
  if (days >= 4 && days <= 5) {
    score = 100;
  } else if (days === 3) {
    score = 85;
  } else if (days === 6) {
    score = 90; // slightly high without rest
  } else if (days === 7) {
    score = 80; // risk of overtraining
  } else if (days === 2) {
    score = 65;
  } else {
    score = 40;
  }

  const resultText = `Você treinou ${days} ${days === 1 ? 'dia' : 'dias'} nos últimos 7 dias.`;

  let explanation = '';
  if (score >= 90) {
    explanation = `Treinar entre 4 e 5 vezes por semana mantém o estímulo muscular constante, favorece a recuperação e reduz o risco de lesões. Sua frequência está dentro da faixa considerada ideal para evolução consistente.`;
  } else if (days < 4) {
    explanation = `Você treinou apenas ${days} ${days === 1 ? 'dia' : 'dias'} nesta semana. Isso aumenta o intervalo entre estímulos musculares e reduz o potencial de evolução e supercompensação.`;
  } else {
    explanation = `Você treinou ${days} dias nesta semana. Lembre-se de que o descanso adequado é fundamental para a regeneração muscular e prevenção do overtraining.`;
  }

  let suggestion = 'Mantenha a frequência semanal para garantir a supercompensação muscular.';
  if (days < 4) {
    const diff = 4 - days;
    suggestion = `Treinando mais ${diff} ${diff === 1 ? 'dia' : 'dias'} nesta semana sua nota nesta métrica subiria para aproximadamente 95-100 pontos.`;
  } else if (days > 5) {
    suggestion = `Inclua 1 a 2 dias de descanso ativo ou recuperação programada para otimizar os ganhos sem sobrecarregar as articulações.`;
  }

  return {
    score,
    daysTrained: days,
    resultText,
    explanation,
    suggestion
  };
}
