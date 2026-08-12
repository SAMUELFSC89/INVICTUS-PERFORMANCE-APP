export interface DataIntegrityEvaluation {
  score: number; // 0-100
  isFraudDetected: boolean;
  fraudReason?: string;
  flags: string[];
  resultText: string;
  explanation: string;
  suggestion: string;
}

export function evaluateDataIntegrity(
  activityData: any
): DataIntegrityEvaluation {
  const flags: string[] = activityData.antiFraudFlags || activityData.flags || [];
  const isMock = !!activityData.isMockLocation;
  const isEmu = !!activityData.isEmulator;
  const isRoot = !!activityData.isRooted;
  
  let score = 100;
  let isFraudDetected = false;
  let fraudReason = '';

  if (isMock) {
    score = 0;
    isFraudDetected = true;
    fraudReason = 'Mock Location (localização simulada) detectado.';
    flags.push('MOCK_LOCATION');
  } else if (isEmu || isRoot) {
    score = 40;
    fraudReason = 'Ambiente de emulação ou dispositivo modificado detectado.';
    flags.push('SUSPICIOUS_ENVIRONMENT');
  } else if (activityData.avgSpeed > 8.5) {
    score = 0;
    isFraudDetected = true;
    fraudReason = 'Velocidade incompatível com atletismo humano detectada.';
    flags.push('IMPOSSIBLE_SPEED');
  } else if (flags.length > 0) {
    score = Math.max(20, 100 - (flags.length * 20));
  }

  let resultText = '100% - Dados totalmente íntegros e autênticos.';
  if (isFraudDetected) {
    resultText = `0% - Inconsistência de segurança: ${fraudReason}`;
  } else if (score < 100) {
    resultText = `${score}% - Pequenas inconsistências detectadas nos dados de sensores/GPS.`;
  }

  const explanation = `A integridade garante que o registro é fruto de um esforço físico autêntico, protegendo a transparência de todo o ecossistema.`;

  let suggestion = 'Nenhuma ação necessária. Seus dados de telemetria são 100% autênticos.';
  if (isFraudDetected) {
    suggestion = `Desative aplicativos de Mock GPS ou modificações no sistema operacional para pontuar normalmente nos próximos treinos.`;
  } else if (score < 100) {
    suggestion = `Certifique-se de manter o GPS em modo de alta precisão e evitar trocas bruscas de aplicativos durante a sessão.`;
  }

  return {
    score,
    isFraudDetected,
    fraudReason,
    flags,
    resultText,
    explanation,
    suggestion
  };
}
