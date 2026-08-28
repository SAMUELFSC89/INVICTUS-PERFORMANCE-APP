import { db, FieldValue } from './common.js';

/**
 * Primitiva reaproveitavel de verificacao de presenca por selfie (prova de
 * vida + identidade via Gemini, ver api/_handlers/validate-presence.ts).
 *
 * Ate 2026-08 esse mecanismo existia inteiro (motor de IA, transacao
 * atomica, modal no app -- VerifiedPresenceModal.tsx) mas era orfao: nada
 * no app real criava o documento `pending_presence_checks` que o dispara.
 * Generalizado agora pra 3 gatilhos, a pedido do usuario:
 *
 * 1. 'activity_under_review'  -- atividade que o SecurityPipeline marcou
 *    UNDER_REVIEW (confianca baixa, mas nao um bloqueio definitivo tipo
 *    mock location/teleporte). Em vez de recusar direto, oferece ao atleta
 *    confirmar que e ele mesmo, ao vivo.
 * 2. 'championship_registration' -- antes de emitir a cobranca PIX de
 *    inscricao num campeonato (dinheiro real em disputa).
 * 3. 'withdrawal' -- antes de processar um saque (dinheiro real saindo).
 *
 * `payload` fica salvo como `workoutPayload` no documento por compatibilidade
 * com o campo que o handler ja lia (nome antigo, mantido para nao quebrar o
 * caminho original de commitWorkoutSession/commitRunningSession).
 */

export type PresenceActionType = 'activity_under_review' | 'championship_registration' | 'withdrawal';

const LIVENESS_GESTURES = [
  'Levante o polegar para cima',
  'Pisque os dois olhos devagar, duas vezes',
  'Sorria naturalmente para a câmera',
  'Vire o rosto levemente para a esquerda',
  'Faça sinal de positivo com a mão perto do rosto',
  'Incline a cabeça levemente para o lado',
];

function sortearGesto(): string {
  return LIVENESS_GESTURES[Math.floor(Math.random() * LIVENESS_GESTURES.length)];
}

export async function criarPresenceCheck(params: {
  userId: string;
  actionType: PresenceActionType;
  payload: any;
  /** Tipo interno esperado por commitWorkoutSession/commitRunningSession (legado); nao se aplica aos novos actionTypes. */
  legacyType?: 'workout' | 'running';
  minutosValidade?: number;
}): Promise<{ presenceCheckId: string; livenessPrompt: string }> {
  const livenessPrompt = sortearGesto();
  const presenceCheckId = `pc_${params.userId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const expiredAt = new Date(Date.now() + (params.minutosValidade ?? 15) * 60000).toISOString();

  await db.collection('pending_presence_checks').doc(presenceCheckId).set({
    userId: params.userId,
    actionType: params.actionType,
    type: params.legacyType || null,
    workoutPayload: params.payload,
    livenessPrompt,
    status: 'pending',
    expiredAt,
    createdAt: FieldValue.serverTimestamp(),
  });

  return { presenceCheckId, livenessPrompt };
}
