import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import { db } from './common.js';
import { getAiApiKey, getAiHabitModel } from './ai-config.js';
import { extractUsage, logAiUsage, newAiRequestId } from './ai-usage-logger.js';
import { isProUser } from './entitlement.js';
import type { Journey, Review } from '../../src/core/cardioObjective/types.js';

const responseSchema = z.object({ explanation: z.string().trim().min(12).max(420) }).strict();

export interface ObjectiveExplanation { text: string; source: 'gemini' | 'deterministic'; model: string | null }

/**
 * O motor determinístico sempre toma a decisão. Para FREE, a explicação também
 * é determinística e não gera custo de IA. Apenas um entitlement PRO canônico
 * permite que o Gemini reescreva a decisão de forma mais natural.
 */
export async function explainObjectiveDecision(userId: string, journey: Journey, review: Review): Promise<ObjectiveExplanation> {
  const fallback = { text: review.reason, source: 'deterministic' as const, model: null };

  try {
    const userSnap = await db.collection('users').doc(userId).get();
    if (!userSnap.exists || !isProUser(userSnap.data())) return fallback;
  } catch {
    // Fail closed: se não for possível comprovar PRO, não fazemos chamada paga.
    return fallback;
  }

  const apiKey = getAiApiKey();
  if (!apiKey) return fallback;
  const model = getAiHabitModel();
  const context = {
    goal: journey.goalLabel,
    completed: review.completed,
    planned: review.planned,
    difficulty: review.answers.difficulty,
    energy: review.answers.energy,
    mainBarrier: review.answers.barrier,
    decision: review.decision,
    deterministicReason: review.reason,
    before: review.before,
    after: review.after,
  };
  const prompt = `Explique em português brasileiro simples a decisão semanal já tomada pelo motor do Invictus. Em no máximo 3 frases, diga o que aconteceu e qual é o próximo passo. Não altere números, não prescreva dieta, não diagnostique, não prometa resultado e não sugira que a decisão foi sua. Retorne apenas JSON {"explanation":"..."}. Contexto mínimo: ${JSON.stringify(context)}`;
  const requestId = newAiRequestId();
  const startedAt = Date.now();
  try {
    const response = await new GoogleGenAI({ apiKey }).models.generateContent({ model, contents: prompt, config: { responseMimeType: 'application/json', maxOutputTokens: 180, temperature: 0.2 } });
    void logAiUsage({ requestId, userId, feature: 'CARDIO_OBJECTIVE_EXPLANATION', model, ...extractUsage(response), durationMs: Date.now() - startedAt, success: true, contextSize: prompt.length });
    const parsed = responseSchema.safeParse(JSON.parse((response.text || '{}').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')));
    return parsed.success ? { text: parsed.data.explanation, source: 'gemini', model } : fallback;
  } catch (error) {
    void logAiUsage({ requestId, userId, feature: 'CARDIO_OBJECTIVE_EXPLANATION', model, durationMs: Date.now() - startedAt, success: false, contextSize: prompt.length, errorCode: error instanceof Error ? error.message.slice(0, 120) : 'unknown_error' });
    return fallback;
  }
}
