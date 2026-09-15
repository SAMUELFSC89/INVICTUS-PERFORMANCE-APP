import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import { db } from './common.js';
import { getAiApiKey, getAiHabitModel } from './ai-config.js';
import { extractUsage, logAiUsage, newAiRequestId } from './ai-usage-logger.js';
import { isProUser } from './entitlement.js';
import { buildCardioBaseline, validateMissionCoherence } from '../../src/core/cardioObjective/engine.js';
import { CARDIO_RESEARCH_VERSION, buildResearchDecisionTrace } from '../../src/core/cardioObjective/research.js';
import { OBJECTIVE_VERSIONS, type Baseline, type ChallengePresentation, type Journey, type ObjectiveAnswers, type Prescription, type ProfileSnapshot, type Review } from '../../src/core/cardioObjective/types.js';

const responseSchema = z.object({ explanation: z.string().trim().min(12).max(420) }).strict();
const noDigits = (value: string) => !/\d/.test(value);
const challengeCopyShape = {
  name: z.string().trim().min(6).max(56).refine(noDigits),
  message: z.string().trim().min(24).max(190).refine(noDigits),
  cue: z.string().trim().min(12).max(150).refine(noDigits),
};
const challengeCopySchema = z.object(challengeCopyShape).strict();
const missionRefinementSchema = z.object({
  durationMinutes: z.number().int().min(1).max(180),
  rationale: z.string().trim().min(12).max(280),
  ...challengeCopyShape,
}).strict();

export interface ObjectiveExplanation { text: string; source: 'gemini' | 'deterministic'; model: string | null }
export interface ObjectiveMissionRefinement {
  prescription: Prescription;
  rationale: string;
  presentation: ChallengePresentation;
  source: 'gemini' | 'deterministic';
  model: string | null;
}

async function hasProAiAccess(userId: string): Promise<boolean> {
  try {
    const userSnap = await db.collection('users').doc(userId).get();
    return userSnap.exists && isProUser(userSnap.data());
  } catch {
    // Fail closed: falha de entitlement nunca pode virar chamada paga de IA.
    return false;
  }
}

function fallbackChallengePresentation(
  prescription: Prescription,
  profile?: ProfileSnapshot,
  review?: Review,
): ChallengePresentation {
  const signature = profile?.cardioHistory?.capacitySignature;
  const trained = signature && ['consistent', 'highly_consistent'].includes(signature.consistencyBand);
  const name = review?.decision === 'regress' ? 'Reconstruir sem zerar'
    : review?.decision === 'progress' ? 'Próximo degrau'
      : trained ? 'Base com controle'
        : prescription.modality === 'running' ? 'Ritmo sustentável'
          : 'Movimento com propósito';
  const message = review?.decision === 'regress'
    ? 'A semana pediu um ajuste. O desafio preserva o que você já construiu e reduz somente o necessário para voltar a encaixar a rotina.'
    : review?.decision === 'progress'
      ? 'Você sustentou a etapa anterior. Agora o desafio avança um pouco, sem transformar evolução em teste máximo.'
      : trained
        ? 'Seu padrão recente já mostra uma base de treino. O desafio usa essa referência para ser relevante sem adicionar intensidade só por adicionar.'
        : 'O desafio foi montado para caber no seu momento atual e ainda exigir uma ação que represente progresso de verdade.';
  const cue = prescription.runSecondsPerInterval > 0
    ? 'Respeite a alternância proposta e mantenha os blocos controlados do começo ao fim.'
    : 'Mantenha esforço controlado e termine com a sensação de que o treino foi sustentável, não um teste limite.';
  return { name, message, cue, source: 'deterministic', model: null, version: OBJECTIVE_VERSIONS.challengeCopy };
}

function challengeContext(
  answers: ObjectiveAnswers,
  profile: ProfileSnapshot,
  prescription: Prescription,
  extra?: { journey?: Journey; review?: Review },
) {
  const bounds = buildCardioBaseline(answers, profile);
  const decisionTrace = buildResearchDecisionTrace(answers, profile, bounds.profileClass);
  return {
    researchVersion: CARDIO_RESEARCH_VERSION,
    evidenceIds: bounds.evidenceIds,
    decisionTrace,
    goalType: answers.goalType,
    goalLabel: extra?.journey?.goalLabel,
    runningAbility: answers.runningAbility,
    walkingMinutes: answers.walkingMinutes,
    trainingBackground: answers.trainingBackground,
    primarySport: answers.primarySport,
    typicalCardioMinutes: answers.typicalCardioMinutes,
    availableMinutes: answers.availableMinutes,
    preferredActivity: answers.preferredActivity,
    barrier: answers.barrier,
    confidenceScore: answers.confidenceScore,
    recentCardioSessions: profile.recentCardioSessions,
    recentLongestRunKm: profile.recentLongestRunKm,
    cardioHistory: profile.cardioHistory || null,
    profileClass: bounds.profileClass,
    deterministicPrescription: prescription,
    allowedDurationMinutes: { min: bounds.minMinutes, max: bounds.maxMinutes },
    weeklyReview: extra?.review ? {
      decision: extra.review.decision,
      reason: extra.review.reason,
      adherence: extra.review.adherence,
      difficulty: extra.review.answers.difficulty,
      energy: extra.review.answers.energy,
      confidenceScore: extra.review.answers.confidenceScore,
      barrier: extra.review.answers.barrier,
      before: extra.review.before,
      after: extra.review.after,
    } : null,
  };
}

/**
 * Híbrido com autoridade determinística: o motor decide o que fazer e a IA
 * funciona como camada de linguagem/personalização. Ela pode escolher duração
 * somente quando o motor explicitamente permite; nunca altera modalidade,
 * métrica, frequência, distância, segurança ou limites finais.
 */
export async function refineInitialObjectiveMission(
  userId: string,
  answers: ObjectiveAnswers,
  profile: ProfileSnapshot,
  deterministic: Prescription,
): Promise<ObjectiveMissionRefinement> {
  const bounds = buildCardioBaseline(answers, profile);
  const fallbackPrescription = validateMissionCoherence(answers, deterministic, profile);
  const fallback: ObjectiveMissionRefinement = {
    prescription: fallbackPrescription,
    rationale: bounds.reason,
    presentation: fallbackChallengePresentation(fallbackPrescription, profile),
    source: 'deterministic',
    model: null,
  };

  // FREE mantém todo o motor determinístico e a jornada completa. Somente a
  // camada Gemini de personalização é PRO, evitando custo de IA fora do plano.
  if (!await hasProAiAccess(userId)) return fallback;
  const apiKey = getAiApiKey();
  if (!apiKey) return fallback;

  const canRefineDuration = deterministic.targetMetric === 'duration'
    && answers.goalType !== 'gradual_return'
    && answers.safety.signals.length === 0;
  const model = getAiHabitModel();
  const context = challengeContext(answers, profile, deterministic);
  const prompt = `Você é a camada de linguagem do desafio de cardio do Invictus. O motor determinístico já decidiu a prescrição e continua sendo a única autoridade sobre segurança, modalidade, frequência, distância, intervalos e limites. Sua tarefa é transformar essa decisão em um desafio que pareça escrito para esta pessoa, usando objetivo, barreira, esporte, capacidade e a assinatura real de frequência/consistência/modalidade/distância quando existir. Evite frases genéricas. Não exponha rótulos internos como "advanced", razões de carga ou nomes de motores. Não invente histórico e não diagnostique. name, message e cue NÃO podem conter algarismos: os números exatos serão renderizados pelo aplicativo a partir da prescrição determinística. ${canRefineDuration ? 'Você também pode escolher durationMinutes dentro da faixa allowedDurationMinutes.' : 'durationMinutes deve permanecer exatamente igual ao deterministicPrescription.durationMinutes; sua responsabilidade aqui é apenas a linguagem.'} Se o histórico for insuficiente, personalize com objetivo, preferência, barreira e rotina declarada sem fingir que conhece mais do que conhece. Se houver tendência rising/spiking, não fale em risco, lesão, overtraining ou recuperação; no máximo reflita que o motor optou por não empilhar outra subida automática. Retorne somente JSON {"durationMinutes":number,"rationale":"...","name":"...","message":"...","cue":"..."}. Contexto: ${JSON.stringify(context)}`;
  const requestId = newAiRequestId();
  const startedAt = Date.now();
  try {
    const response = await new GoogleGenAI({ apiKey }).models.generateContent({
      model,
      contents: prompt,
      config: { responseMimeType: 'application/json', maxOutputTokens: 320, temperature: 0.35 },
    });
    void logAiUsage({ requestId, userId, feature: 'CARDIO_OBJECTIVE_MISSION_REFINEMENT', model, ...extractUsage(response), durationMs: Date.now() - startedAt, success: true, contextSize: prompt.length });
    const parsed = missionRefinementSchema.safeParse(JSON.parse((response.text || '{}').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')));
    if (!parsed.success) return fallback;
    const durationMinutes = canRefineDuration
      ? Math.max(bounds.minMinutes, Math.min(bounds.maxMinutes, parsed.data.durationMinutes))
      : deterministic.durationMinutes;
    const prescription = validateMissionCoherence(answers, { ...deterministic, durationMinutes }, profile);
    const presentation: ChallengePresentation = {
      name: parsed.data.name,
      message: parsed.data.message,
      cue: parsed.data.cue,
      source: 'gemini',
      model,
      version: OBJECTIVE_VERSIONS.challengeCopy,
    };
    return { prescription, rationale: parsed.data.rationale, presentation, source: 'gemini', model };
  } catch (error) {
    void logAiUsage({ requestId, userId, feature: 'CARDIO_OBJECTIVE_MISSION_REFINEMENT', model, durationMs: Date.now() - startedAt, success: false, contextSize: prompt.length, errorCode: error instanceof Error ? error.message.slice(0, 120) : 'unknown_error' });
    return fallback;
  }
}

/**
 * After a weekly deterministic decision, Gemini translates the new prescription
 * into user-facing challenge language. It cannot modify any prescription field.
 */
export async function describeObjectiveChallenge(
  userId: string,
  journey: Journey,
  baseline: Baseline,
  review: Review,
): Promise<ChallengePresentation> {
  const fallback = fallbackChallengePresentation(journey.behavior, baseline.profile, review);
  if (!await hasProAiAccess(userId)) return fallback;
  const apiKey = getAiApiKey();
  if (!apiKey || journey.status !== 'active') return fallback;
  const model = getAiHabitModel();
  const context = challengeContext(baseline.answers, baseline.profile, journey.behavior, { journey, review });
  const prompt = `Você é a camada de linguagem do próximo desafio do Invictus. O motor determinístico JÁ tomou a decisão semanal; você não pode alterar nenhum campo da prescrição. Traduza a decisão para um desafio pessoal, específico e humano. Use a resposta da semana, o objetivo, a barreira e a assinatura histórica de frequência, consistência, modalidade, duração e distância. Não exponha classificações internas, cálculos, razões de carga, fontes ou nomes de motores. Não faça diagnóstico, não prometa resultado e não invente fatos. name, message e cue não podem conter algarismos, pois o app mostra os números diretamente da prescrição. A mensagem deve explicar por que ESTE desafio faz sentido agora sem soar como texto genérico de motivação. Retorne somente JSON {"name":"...","message":"...","cue":"..."}. Contexto: ${JSON.stringify(context)}`;
  const requestId = newAiRequestId();
  const startedAt = Date.now();
  try {
    const response = await new GoogleGenAI({ apiKey }).models.generateContent({
      model,
      contents: prompt,
      config: { responseMimeType: 'application/json', maxOutputTokens: 260, temperature: 0.45 },
    });
    void logAiUsage({ requestId, userId, feature: 'CARDIO_OBJECTIVE_CHALLENGE_COPY', model, ...extractUsage(response), durationMs: Date.now() - startedAt, success: true, contextSize: prompt.length });
    const parsed = challengeCopySchema.safeParse(JSON.parse((response.text || '{}').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')));
    return parsed.success ? { ...parsed.data, source: 'gemini', model, version: OBJECTIVE_VERSIONS.challengeCopy } : fallback;
  } catch (error) {
    void logAiUsage({ requestId, userId, feature: 'CARDIO_OBJECTIVE_CHALLENGE_COPY', model, durationMs: Date.now() - startedAt, success: false, contextSize: prompt.length, errorCode: error instanceof Error ? error.message.slice(0, 120) : 'unknown_error' });
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
  if (!await hasProAiAccess(userId)) return fallback;

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