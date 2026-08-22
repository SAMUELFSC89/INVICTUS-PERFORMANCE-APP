/**
 * Mensagens mostradas ao atleta quando uma atividade nao pontua.
 *
 * FONTE UNICA: o backend importa deste arquivo (api/_lib/validationMessages.ts
 * apenas reexporta). Duas copias divergiram no passado, e o app passou a dizer
 * "GPS" numa tela e "localizacao" em outra para o mesmo caso.
 *
 * TOM: neutro e curto. O que aconteceu, e a consequencia. Sem "indeferida",
 * sem "homologada", sem sirene -- a pessoa treinou, nao cometeu uma infracao.
 */
export const VALIDATION_MESSAGES: Record<string, string> = {
  NO_MOVEMENT_DETECTED: "Sem deslocamento detectado. Esta atividade não gerou pontos.",
  GPS_OUTSIDE_ALLOWED_AREA: "Sua localização ficou fora da área permitida. Esta atividade não gerou pontos.",
  GPS_TOO_FAR_FROM_GYM: "Sua localização ficou fora da área da academia cadastrada. Esta atividade não gerou pontos.",
  GYM_DISTANCE_TOO_CLOSE_TO_START: "Início e fim muito próximos da academia para caracterizar deslocamento. Esta atividade não gerou pontos.",
  INSUFFICIENT_TIME: "Tempo abaixo do mínimo necessário. Esta atividade não gerou pontos.",
  PHOTO_NOT_CLEAR: "A foto não ficou nítida o suficiente para validar a atividade.",
  PHOTO_NOT_FITNESS_CONTEXT: "A imagem não mostra um ambiente de treino identificável.",
  PHOTO_AI_FAILED: "Não foi possível processar a imagem. A atividade ficará em análise.",
  LOCATION_PERMISSION_DENIED: "A permissão de localização estava desativada. Esta atividade não gerou pontos.",
  GPS_SIGNAL_WEAK: "O sinal de localização ficou instável durante a atividade.",
  PACE_TOO_FAST: "A velocidade registrada ficou acima do limite para uma atividade humana. Esta atividade não gerou pontos.",
  SUSPICIOUS_ROUTE: "O trajeto apresentou inconsistências. Esta atividade não gerou pontos.",
  IMPOSSIBLE_ACCELERATION: "As acelerações registradas são incompatíveis com corrida ou caminhada. Esta atividade não gerou pontos.",
  MISSING_EVIDENCE: "Faltam dados obrigatórios desta atividade, como foto ou trajeto.",
  AUTH_REQUIRED: "Sessão expirada. Entre novamente para registrar atividades.",
  USER_NOT_AUTHENTICATED: "Você precisa estar logado para registrar atividades.",
  ACTIVITY_DUPLICATED: "Esta atividade já foi enviada antes.",
  DAILY_LIMIT_REACHED: "Você atingiu o limite de pontos do dia.",
  WEEKLY_LIMIT_REACHED: "Você atingiu o limite de treinos da semana elegíveis para premiação.",
  VALIDATION_SERVICE_UNAVAILABLE: "Atividade recebida. A validação automática não concluiu agora e ela ficará em análise.",
  PENDING_MANUAL_REVIEW: "Esta atividade foi enviada para análise.",
  UNKNOWN_VALIDATION_ERROR: "Não foi possível validar esta atividade."
};

export function getFriendlyMessage(reasonCode: string | null | undefined): string {
  if (!reasonCode) return "Não foi possível confirmar todos os critérios desta atividade.";
  return VALIDATION_MESSAGES[reasonCode] || VALIDATION_MESSAGES.UNKNOWN_VALIDATION_ERROR;
}
