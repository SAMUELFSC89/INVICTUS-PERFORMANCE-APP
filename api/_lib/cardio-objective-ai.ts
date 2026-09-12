import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import { db } from './common.js';
import { getAiApiKey, getAiHabitModel } from './ai-config.js';
import { extractUsage, logAiUsage, newAiRequestId } from './ai-usage-logger.js';
import { isProUser } from './entitlement.js';
import { buildCardioBaseline, validateMissionCoherence } from '../../src/core/cardioObjective/engine.js';
import { CARDIO_RESEARCH_VERSION, buildResearchDecisionTrace } from '../../src/core/cardioObjective/research.js';
import type { Journey, ObjectiveAnswers, Prescription, ProfileSnapshot, Review } from '../../src/core/cardioObjective/types.js';

const responseSchema = z.object({ explanation: z.string().trim().min(12).max(420) }).strict();
const missionRefinementSchema = z.object({
  durationMinutes: z.number().int().min(1).max(180),
  rationale: z.string().trim().min(12).max(280),
}).strict();

export interface ObjectiveExplanation { text: string; source: 'gemini' | 'deterministic'; model: string | null }
export interface ObjectiveMissionRefinement {
  prescription: Prescription;
  rationale: string;
  source: 'gemini' | 'deterministic';
  model: string | null;
}

/**
 * Híbrido com autoridade determinística: a IA só pode escolher um tempo dentro
 * da faixa calculada pelo motor. A camada de pesquisa é enviada como contexto,
 * mas modalidade, métrica, segurança e limites finais continuam validados pelo
 * código antes de qualquer missão ser persistida.
 */
export async function refineInitialObjectiveMission(
  userId: string,
  answers: ObjectiveAnswers,
  profile: ProfileSnapshot,
  deterministic: Prescription,
): Promise<ObjectiveMissionRefinement> {
  const bounds = buildCardioBaseline(answers, profile);
  const decisionTrace = buildResearchDecisionTrace(answers, profile, bounds.profileClass);
  const fallback: ObjectiveMissionRefinement = {
    prescription: validateMissionCoherence(answers, deterministic, profile),
    rationale: bounds.reason,
    source: 'deterministic',
    model: null,
  };

  // Distância permanece 100% determinística nesta versão. Também não usamos IA
  // em retorno gradual/sinais de segurança: nesses casos, conservadorismo vence personalização.
  if (deterministic.targetMetric !== 'duration' || answers.goalType === 'gradual_return' || answers.safety.signals.length > 0) return fallback;

  const apiKey = getAiApiKey();
  if (!apiKey) return fallback;
  const model = getAiHabitModel();
  const context = {
    researchVersion: CARDIO_RESEARCH_VERSION,
    evidenceIds: bounds.evidenceIds,
    decisionTrace,
    goalType: answers.goalType,
    runningAbility: answers.runningAbility,
    walkingMinutes: answers.walkingMinutes,
    availableMinutes: answers.availableMinutes,
    preferredActivity: answers.preferredActivity,
    barrier: answers.barrier,
    confidenceScore: answers.confidenceScore,
    recentCardioSessions: profile.recentCardioSessions,
    recentLongestRunKm: profile.recentLongestRunKm,
    profileClass: bounds.profileClass,
    deterministicDurationMinutes: deterministic.durationMinutes,
    allowedDurationMinutes: { min: bounds.minMinutes, max: bounds.maxMinutes },
  };
  const prompt = `Você está refinando uma missão inicial de cardio do Invictus. O motor determinístico e a camada de evidência já definiram o perfil e os limites obrigatórios. Use o decisionTrace para personalizar, mas escolha apenas um durationMinutes inteiro dentro da faixa permitida e escreva uma rationale curta em português brasileiro. Não altere modalidade, intensidade, frequência, distância, regras de segurança ou fontes de evidência. Não reduza um corredor/atleta para uma missão trivial. Para sedentário, nunca use menos de 15 minutos. Para pessoa treinada, não introduza intensidade alta automaticamente: a evidência não justifica um único modelo universal e o motor ainda não comprovou recuperação/carga suficiente. Não diagnostique e não prometa resultado. Retorne apenas JSON {"durationMinutes":number,"rationale":"..."}. Contexto: ${JSON.stringify(context)}`;
  const requestId = newAiRequestId();
  const startedAt = Date.now();
  try {
    const response = await new GoogleGenAI({ apiKey }).models.generateContent({
      model,
      contents: prompt,
      config: { responseMimeType: 'application/json', maxOutputTokens: 180, temperature: 0.15 },
    });
    void logAiUsage({ requestId, userId, feature: 'CARDIO_OBJECTIVE_MISSION_REFINEMENT', model, ...extractUsage(response), durationMs: Date.now() - startedAt, success: true, contextSize: prompt.length });
    const parsed = missionRefinementSchema.safeParse(JSON.parse((response.text || '{}').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')));
    if (!parsed.success) return fallback;
    const durationMinutes = Math.max(bounds.minMinutes, Math.min(bounds.maxMinutes, parsed.data.durationMinutes));
    const prescription = validateMissionCoherence(answers, { ...deterministic, durationMinutes }, profile);
    return { prescription, rationale: parsed.data.rationale, source: 'gemini', model };
  } catch (error) {
    void logAiUsage({ requestId, userId, feature: 'CARDIO_OBJECTIVE_MISSION_REFINEMENT', model, durationMs: Date.now() - startedAt, success: false, contextSize: prompt.length, errorCode: error instanceof Error ? error.message.slice(0, 120) : 'unknown_error' });
    return fallback;
  }
}

/**
 * O motor determinístico sempre toma a decisão semanal. Para FREE, a explicação
 * é determinística e não gera custo de IA. Apenas um entitlement PRO canônico
 * permite que o Gemini reescreva essa decisão de forma mais natural.
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
