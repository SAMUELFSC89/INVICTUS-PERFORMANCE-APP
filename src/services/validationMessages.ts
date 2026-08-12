export const VALIDATION_MESSAGES: Record<string, string> = {
  GPS_OUTSIDE_ALLOWED_AREA: "Sua localização foi detectada fora da área permitida para o treino. Verifique se a localização está ativa e tente novamente.",
  GPS_TOO_FAR_FROM_GYM: "Não conseguimos validar este treino porque sua localização ficou fora da área da academia cadastrada. No próximo treino, inicie a atividade estando dentro ou próximo da academia correta.",
  GYM_DISTANCE_TOO_CLOSE_TO_START: "O local de início e fim da atividade são muito próximos ou idênticos à academia para caracterizar um deslocamento cardio. Tente iniciar um pouco mais distante.",
  INSUFFICIENT_TIME: "Este treino não atingiu o tempo mínimo necessário para pontuar. Continue treinando pelo tempo mínimo indicado para que a atividade seja validada.",
  PHOTO_NOT_CLEAR: "A foto enviada não ficou nítida o suficiente para validar o treino. Tente enviar uma imagem mais clara, mostrando melhor o ambiente da atividade.",
  PHOTO_NOT_FITNESS_CONTEXT: "Não conseguimos identificar um ambiente compatível com treino na imagem enviada. Para validar, envie uma foto que mostre claramente o local ou equipamento da atividade.",
  PHOTO_AI_FAILED: "Não conseguimos processar a imagem do treino automaticamente por inconsistência visual. A atividade será revisada manualmente.",
  LOCATION_PERMISSION_DENIED: "Não foi possível validar sua atividade porque a permissão de localização estava desativada. Ative a localização e tente novamente no próximo treino.",
  GPS_SIGNAL_WEAK: "O sinal de localização estava muito instável ou fraco durante o período. Aproxime-se de áreas abertas no próximo treino para garantir a validação automática.",
  PACE_TOO_FAST: "A velocidade registrada ficou acima do limite permitido para uma atividade humana. Por segurança, essa atividade não gerou pontos.",
  SUSPICIOUS_ROUTE: "O trajeto apresentou sinais inconsistentes com uma atividade normal. Por segurança, essa atividade foi enviada para análise ou não gerou pontuação.",
  IMPOSSIBLE_ACCELERATION: "Detectamos acelerações incompatíveis com corrida ou caminhada humana no trajeto. Por segurança, os pontos não foram concedidos.",
  MISSING_EVIDENCE: "Faltam evidências obrigatórias para este treino (como foto de validação ou dados de trajeto). Complete todas as etapas no seu próximo treino.",
  AUTH_REQUIRED: "Sessão expirada. Entre novamente na sua conta para registrar e validar suas atividades.",
  USER_NOT_AUTHENTICATED: "Usuário não autenticado. Faça login para registrar suas atividades de forma segura.",
  ACTIVITY_DUPLICATED: "Esta atividade ou imagem já foi enviada anteriormente. Registre um novo treino para continuar pontuando.",
  DAILY_LIMIT_REACHED: "Você já atingiu o limite máximo de pontos diários permitidos pela liga para manter o equilíbrio da competição.",
  WEEKLY_LIMIT_REACHED: "Você já atingiu o limite de treinos semanais elegíveis para premiação. Continue mantendo a consistência!",
  VALIDATION_SERVICE_UNAVAILABLE: "Sua atividade foi recebida, mas não conseguimos concluir a validação automática neste momento. Ela ficará em análise e você será informado quando for revisada.",
  PENDING_MANUAL_REVIEW: "Não conseguimos confirmar todos os sinais necessários para validar automaticamente esta atividade. Ela foi enviada para análise.",
  UNKNOWN_VALIDATION_ERROR: "Não conseguimos validar esta atividade no momento. Tente novamente ou realize uma nova atividade seguindo as regras do desafio."
};

export function getFriendlyMessage(reasonCode: string | null | undefined): string {
  if (!reasonCode) return "Atividade processada, mas não foi possível confirmar todos os critérios necessários.";
  return VALIDATION_MESSAGES[reasonCode] || VALIDATION_MESSAGES.UNKNOWN_VALIDATION_ERROR;
}
