import { db } from './common.js';

/**
 * Observabilidade de custo da Gemini API (auditoria de custo, set/2026).
 *
 * Antes desta mudança, NENHUMA chamada à Gemini registrava quantos tokens
 * consumiu -- toda a informação de `usageMetadata` que o SDK @google/genai já
 * devolve em cada resposta era descartada. Sem isso é impossível responder
 * "quanto custa cada funcionalidade" (só dá pra ver o total da fatura do
 * Google Cloud). Este módulo é só instrumentação: não decide nada, não
 * bloqueia nada, nunca lança erro para quem chamou (uma falha ao gravar o log
 * não pode derrubar uma resposta real da IA).
 *
 * O que NÃO fica aqui, de propósito: texto do prompt, texto da resposta,
 * conteúdo de imagem/selfie, qualquer dado de saúde. Só metadados numéricos
 * (regra de privacidade da auditoria -- Fase 16 do pedido original).
 */

export type AiFeature =
  | 'AI_CHAT'
  | 'AI_CHAT_TTS'
  | 'MEMORY_EXTRACTION'
  | 'WORKOUT_GENERATION'
  | 'POWERLIFT_VIDEO_AUDIT'
  | 'ACTIVITY_PHOTO_VALIDATION'
  | 'PRESENCE_BIOMETRIC_CHECK'
  | 'HABIT_REVEAL_MESSAGE';

export interface AiUsageEntry {
  requestId: string;
  userId?: string | null;
  feature: AiFeature;
  operation?: string;
  model: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  cachedTokens?: number | null;
  durationMs: number;
  success: boolean;
  retryCount?: number;
  /** Tamanho aproximado (em caracteres) do prompt enviado -- nunca o conteúdo. */
  contextSize?: number | null;
  conversationMessagesCount?: number | null;
  errorCode?: string;
}

/**
 * Converte usage.promptTokenCount/candidatesTokenCount/totalTokenCount (nomes
 * usados pelo SDK @google/genai) num formato estável, tolerando respostas sem
 * usageMetadata (algumas variantes/erros do SDK não retornam esse campo).
 */
export function extractUsage(response: any): { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null; cachedTokens: number | null } {
  const usage = response?.usageMetadata;
  if (!usage) return { inputTokens: null, outputTokens: null, totalTokens: null, cachedTokens: null };
  const inputTokens = Number.isFinite(usage.promptTokenCount) ? usage.promptTokenCount : null;
  const outputTokens = Number.isFinite(usage.candidatesTokenCount) ? usage.candidatesTokenCount : null;
  const totalTokens = Number.isFinite(usage.totalTokenCount) ? usage.totalTokenCount : null;
  const cachedTokens = Number.isFinite(usage.cachedContentTokenCount) ? usage.cachedContentTokenCount : null;
  return { inputTokens, outputTokens, totalTokens, cachedTokens };
}

/**
 * Estimativa de custo em USD, só quando o operador configurou o preço vigente
 * via env (AI_PRICE_INPUT_PER_1M_USD / AI_PRICE_OUTPUT_PER_1M_USD). Sem essas
 * variáveis, retorna null -- não inventamos um preço por token. Quando
 * calculado, o valor é sempre uma ESTIMATIVA (preço uniforme por modelo
 * configurado manualmente), não um número faturado pelo Google.
 */
function estimateCostUsd(inputTokens: number | null, outputTokens: number | null): number | null {
  const priceInput = Number(process.env.AI_PRICE_INPUT_PER_1M_USD);
  const priceOutput = Number(process.env.AI_PRICE_OUTPUT_PER_1M_USD);
  if (!Number.isFinite(priceInput) && !Number.isFinite(priceOutput)) return null;
  const inputCost = Number.isFinite(priceInput) && typeof inputTokens === 'number' ? (inputTokens / 1_000_000) * priceInput : 0;
  const outputCost = Number.isFinite(priceOutput) && typeof outputTokens === 'number' ? (outputTokens / 1_000_000) * priceOutput : 0;
  return Number((inputCost + outputCost).toFixed(6));
}

/**
 * Fire-and-forget: grava o registro de uso no Firestore. Nunca deve ser
 * `await`ado no caminho crítico da resposta ao usuário -- chame sem await e
 * deixe o `.catch` interno absorver qualquer falha de escrita.
 */
export async function logAiUsage(entry: AiUsageEntry): Promise<void> {
  try {
    const estimatedCostUsd = estimateCostUsd(entry.inputTokens ?? null, entry.outputTokens ?? null);
    await db.collection('ai_usage_logs').add({
      requestId: entry.requestId,
      userId: entry.userId || null,
      feature: entry.feature,
      operation: entry.operation || null,
      model: entry.model,
      inputTokens: entry.inputTokens ?? null,
      outputTokens: entry.outputTokens ?? null,
      totalTokens: entry.totalTokens ?? null,
      cachedTokens: entry.cachedTokens ?? null,
      durationMs: Math.max(0, Math.round(entry.durationMs)),
      success: entry.success,
      retryCount: entry.retryCount || 0,
      contextSize: entry.contextSize ?? null,
      conversationMessagesCount: entry.conversationMessagesCount ?? null,
      errorCode: entry.errorCode || null,
      estimatedCostUsd,
      costBasis: estimatedCostUsd === null ? 'not_configured' : 'estimated',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    // Observabilidade não pode derrubar uma resposta real da IA. Loga e segue.
    console.warn('[AiUsageLogger] Falha ao registrar uso de IA (não crítico):', (error as any)?.message || error);
  }
}

export function newAiRequestId(): string {
  return `ai_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
