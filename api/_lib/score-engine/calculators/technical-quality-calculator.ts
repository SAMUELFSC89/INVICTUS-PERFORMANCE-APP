export interface TechnicalQualityEvaluation {
  score: number; // 0-100
  checks: Array<{ label: string; passed: boolean; impactPts: number }>;
  resultText: string;
  explanation: string;
  suggestion: string;
}

export function evaluateTechnicalQuality(
  activityData: any,
  userData: any
): TechnicalQualityEvaluation {
  const checks: Array<{ label: string; passed: boolean; impactPts: number }> = [];

  const hasExercises = !!(activityData.hasExercises || (activityData.exercises && activityData.exercises.length > 0));
  checks.push({
    label: 'Exercícios cadastrados',
    passed: hasExercises,
    impactPts: hasExercises ? 25 : 0
  });

  const hasPhoto = !!(activityData.hasPhoto || activityData.photoBase64 || activityData.imageUrl);
  checks.push({
    label: 'Foto do treino enviada',
    passed: hasPhoto,
    impactPts: hasPhoto ? 25 : 0
  });

  const iaConfidence = activityData.iaConfidence ?? 90;
  const iaPassed = iaConfidence >= 80;
  checks.push({
    label: 'Validação por IA realizada',
    passed: iaPassed,
    impactPts: iaPassed ? 20 : 10
  });

  const gpsCoherent = activityData.hasGps !== false && !activityData.isMockLocation;
  checks.push({
    label: 'Coerência de GPS e localização',
    passed: gpsCoherent,
    impactPts: gpsCoherent ? 15 : 0
  });

  const isBiometricVerified = !!(activityData.smartwatchData || activityData.isBiometricVerified || userData.biometricsComplete);
  checks.push({
    label: 'Dados biométricos / Smartwatch conectado',
    passed: isBiometricVerified,
    impactPts: isBiometricVerified ? 15 : 0
  });

  const score = checks.reduce((acc, curr) => acc + curr.impactPts, 0);

  const passedCount = checks.filter(c => c.passed).length;
  const resultText = `${passedCount}/5 itens de qualidade técnica verificados (${score}/100 pts).`;

  const explanation = `A qualidade técnica mede o grau de comprovação e riqueza de dados fornecidos sobre a sessão de treino.`;

  const missingChecks = checks.filter(c => !c.passed);
  let suggestion = 'Excelente nível de comprovação técnica do treino!';
  if (missingChecks.length > 0) {
    const missingLabels = missingChecks.map(m => m.label.toLowerCase()).join(', ');
    suggestion = `Para alcançar a nota máxima de qualidade técnica: complete ${missingLabels}.`;
  }

  return {
    score,
    checks,
    resultText,
    explanation,
    suggestion
  };
}
