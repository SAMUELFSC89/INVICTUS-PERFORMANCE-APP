import { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI } from '@google/genai';
import { FieldValue, cors, db, isDbAvailable, verifyAuth } from '../_lib/common.js';
import { classifyAiError, getAiApiKey, getAiWorkoutModel } from '../_lib/ai-config.js';
import { isProUser } from '../_lib/entitlement.js';
import { extractUsage, logAiUsage, newAiRequestId } from '../_lib/ai-usage-logger.js';

import { OFFICIAL_EXERCISES_BATCH_01, OFFICIAL_EXERCISE_BY_ID, OFFICIAL_EXERCISE_EQUIPMENT_REQUIREMENTS, isOfficialExerciseCompatible } from '../../src/data/exerciseCatalog.js';
import { buildTrainingEnginePlan } from '../../src/core/training/trainingEngine.js';
import { validateTrainingPlanDraft } from '../../src/core/training/trainingValidator.js';

export class InvalidTrainingPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidTrainingPlanError';
  }
}

export function getCompatibleOfficialExercises(equipment: readonly string[]) {
  return OFFICIAL_EXERCISES_BATCH_01
    .filter(exercise => isOfficialExerciseCompatible(exercise.id, equipment))
    .map(exercise => ({ id: exercise.id, name: exercise.name, group: exercise.muscleGroup, equipment: OFFICIAL_EXERCISE_EQUIPMENT_REQUIREMENTS[exercise.id] }));
}

const cleanText = (value: unknown, max = 120) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const clampInt = (value: unknown, min: number, max: number, fallback: number) => {
  const number = Math.round(Number(value));
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
};

export function normalizePlan(raw: any, userId: string, source?: 'manual' | 'ai' | 'imported', allowedIds?: ReadonlySet<string>) {
  const workouts = Array.isArray(raw?.workouts) ? raw.workouts.slice(0, 7).map((workout: any, workoutIndex: number) => ({
    id: cleanText(workout?.id, 64) || `workout_${workoutIndex + 1}`,
    name: cleanText(workout?.name, 40) || `Treino ${String.fromCharCode(65 + workoutIndex)}`,
    focus: cleanText(workout?.focus, 80) || 'Treino personalizado',
    weekdays: Array.isArray(workout?.weekdays) ? workout.weekdays.map((day: unknown) => clampInt(day, 0, 6, 1)).slice(0, 7) : [],
    exercises: Array.isArray(workout?.exercises) ? workout.exercises.flatMap((exercise: any, index: number) => {
      const exerciseId = cleanText(exercise?.exerciseId, 80);
      if (!OFFICIAL_EXERCISE_BY_ID.has(exerciseId)) {
        throw new InvalidTrainingPlanError(`Exercício não reconhecido no catálogo oficial: ${exerciseId || '(sem ID)'}.`);
      }
      if (allowedIds && !allowedIds.has(exerciseId)) {
        throw new InvalidTrainingPlanError(`O exercício ${exerciseId} exige equipamentos que não foram selecionados.`);
      }
      return [{
        exerciseId,
        order: index,
        sets: clampInt(exercise?.sets, 1, 6, 3),
        repsMin: clampInt(exercise?.repsMin, 1, 30, 8),
        repsMax: clampInt(exercise?.repsMax, 1, 30, 12),
        restSeconds: clampInt(exercise?.restSeconds, 30, 300, 90),
        ...(Number.isFinite(Number(exercise?.targetRir)) ? { targetRir: clampInt(exercise.targetRir, 0, 5, 2) } : {}),
        ...(Number(exercise?.initialLoadKg) >= 0 ? { initialLoadKg: Number(exercise.initialLoadKg) } : {})
      }];
    }).slice(0, 20) : []
  })).filter((workout: any) => workout.exercises.length > 0) : [];
  if (!workouts.length) throw new InvalidTrainingPlanError('O plano precisa conter ao menos um exercício oficial.');
  const generationMode = ['gemini', 'training_engine', 'local_fallback'].includes(raw?.generationMode) ? raw.generationMode : undefined;
  return {
    userId,
    name: cleanText(raw?.name, 60) || 'Meu plano',
    description: cleanText(raw?.description, 240),
    ...(cleanText(raw?.rationale, 500) ? { rationale: cleanText(raw?.rationale, 500) } : {}),
    source: source || (['manual', 'ai', 'imported'].includes(raw?.source) ? raw.source : 'manual'),
    ...(generationMode ? { generationMode } : {}),
    ...(cleanText(raw?.trainingEngineVersion, 40) ? { trainingEngineVersion: cleanText(raw.trainingEngineVersion, 40) } : {}),
    ...(cleanText(raw?.evidenceVersion, 60) ? { evidenceVersion: cleanText(raw.evidenceVersion, 60) } : {}),
    status: 'active',
    objective: cleanText(raw?.objective, 80) || 'Evolução física',
    experienceLevel: cleanText(raw?.experienceLevel, 40),
    durationMinutes: clampInt(raw?.durationMinutes, 20, 180, 60),
    daysPerWeek: clampInt(raw?.daysPerWeek, 1, 7, workouts.length),
    answers: raw?.answers && typeof raw.answers === 'object' ? raw.answers : {},
    workouts
  };
}

function athleteProfileFromUser(userData: any) {
  const age = Number(userData?.age);
  const weightKg = Number(userData?.weight);
  const heightCm = Number(userData?.height);
  const sex = userData?.sex === 'male' || userData?.sex === 'female' ? userData.sex : undefined;
  return {
    ...(Number.isFinite(age) && age >= 18 && age <= 100 ? { age: Math.round(age) } : {}),
    ...(Number.isFinite(weightKg) && weightKg >= 30 && weightKg <= 350 ? { weightKg } : {}),
    ...(Number.isFinite(heightCm) && heightCm >= 120 && heightCm <= 230 ? { heightCm } : {}),
    ...(sex ? { sex } : {})
  };
}

export async function generatePlan(answers: any, userId: string) {
  const equipment = Array.isArray(answers?.equipment) ? answers.equipment.filter((item: unknown) => typeof item === 'string') : [];
  const available = getCompatibleOfficialExercises(equipment);
  if (available.length < 3) throw new Error('Selecione equipamentos suficientes para montar um plano seguro com a biblioteca disponível.');

  // The deterministic engine creates the safe, evidence-versioned baseline.
  // Gemini is allowed to refine it, never to invent the prescription from zero.
  const basePlan = buildTrainingEnginePlan(answers);
  const apiKey = getAiApiKey();
  if (!apiKey) return { ...basePlan, generationMode: 'local_fallback' as const };

  const ai = new GoogleGenAI({ apiKey });
  const model = getAiWorkoutModel();
  const requestId = newAiRequestId();
  const startedAt = Date.now();
  const prompt = `Você é a camada de personalização do Training Engine do Invictus. O plano-base abaixo já foi calculado por regras de evidência e validado. NÃO crie um treino do zero. Preserve exatamente daysPerWeek, durationMinutes, trainingEngineVersion, evidenceVersion e os weekdays de cada sessão. Use SOMENTE exerciseIds permitidos. Você pode trocar um exercício por outro permitido quando isso melhorar a aderência às preferências, experiência e perfil do atleta; pode ajustar sets/reps/rest/targetRir apenas dentro de ranges sensatos e sem aumentar agressivamente volume. Não use idade, peso ou sexo para inventar carga inicial. Não diagnostique lesões. Retorne JSON no mesmo formato e inclua rationale curto explicando a individualização.\nRespostas: ${JSON.stringify(answers)}\nPlano-base: ${JSON.stringify(basePlan)}\nIDs permitidos: ${JSON.stringify(available)}.`;

  let response;
  try {
    response = await ai.models.generateContent({ model, contents: prompt, config: { responseMimeType: 'application/json' } });
    logAiUsage({
      requestId, userId, feature: 'WORKOUT_GENERATION', model,
      ...extractUsage(response), durationMs: Date.now() - startedAt, success: true, contextSize: prompt.length
    }).catch(() => {});
  } catch (err) {
    logAiUsage({
      requestId, userId, feature: 'WORKOUT_GENERATION', model,
      durationMs: Date.now() - startedAt, success: false, contextSize: prompt.length,
      errorCode: err instanceof Error ? err.message.slice(0, 200) : 'unknown_error'
    }).catch(() => {});
    console.warn('[Training Plans] Gemini refinement unavailable; returning Training Engine baseline.', classifyAiError(err).code);
    return { ...basePlan, generationMode: 'local_fallback' as const };
  }

  let parsed: any;
  try {
    const text = (response.text || '{}').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    parsed = JSON.parse(text);
  } catch {
    return { ...basePlan, generationMode: 'local_fallback' as const };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ...basePlan, generationMode: 'local_fallback' as const };
  }

  // Fields that belong to the engine cannot be overwritten by the model.
  parsed.daysPerWeek = basePlan.daysPerWeek;
  parsed.durationMinutes = basePlan.durationMinutes;
  parsed.trainingEngineVersion = basePlan.trainingEngineVersion;
  parsed.evidenceVersion = basePlan.evidenceVersion;
  parsed.generationMode = 'gemini';
  parsed.answers = answers;
  if (Array.isArray(parsed.workouts)) {
    parsed.workouts = parsed.workouts.slice(0, basePlan.workouts.length).map((workout: any, index: number) => ({
      ...workout,
      id: basePlan.workouts[index]?.id || workout?.id,
      weekdays: basePlan.workouts[index]?.weekdays || []
    }));
  }

  try {
    const normalized = normalizePlan(parsed, userId, 'ai', new Set(available.map(exercise => exercise.id)));
    const validation = validateTrainingPlanDraft(normalized as any, answers);
    if (!validation.valid) throw new InvalidTrainingPlanError(validation.issues.map(issue => issue.message).slice(0, 4).join(' '));
    return normalized;
  } catch (error) {
    console.warn('[Training Plans] Gemini refinement rejected by validator; returning Training Engine baseline.', error);
    return { ...basePlan, generationMode: 'local_fallback' as const };
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;
  const auth = await verifyAuth(req);
  if (!auth) return res.status(401).json({ error: 'Autenticação necessária.' });

  if (req.method === 'GET') {
    if (!isDbAvailable()) return res.status(503).json({ error: 'O banco de planos está temporariamente indisponível.', code: 'DATABASE_UNAVAILABLE', retryable: true });
    try {
      const collection = db.collection('training_plans');
      const snapshot = await collection.where('userId', '==', auth.uid).get();
      const plans = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })).sort((a: any, b: any) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
      return res.status(200).json({ plans });
    } catch (error) {
      console.error('[API Training Plans] Falha ao carregar planos:', error);
      return res.status(503).json({ error: 'O banco de planos está temporariamente indisponível.', code: 'DATABASE_UNAVAILABLE', retryable: true });
    }
  }

  if (req.method === 'POST' && req.body?.action === 'generate') {
    let userData: any = null;
    try {
      const userSnap = await db.collection('users').doc(auth.uid).get();
      userData = userSnap.exists ? userSnap.data() : null;
      if (!isProUser(userData)) {
        return res.status(403).json({
          error: 'A personalização adicional pela Invictus IA é um benefício exclusivo do plano PRO.',
          code: 'PRO_REQUIRED'
        });
      }
    } catch (entitlementErr) {
      console.warn('[API Training Plans] Falha ao verificar plano PRO:', entitlementErr);
      return res.status(503).json({
        error: 'Não foi possível confirmar seu plano agora. Tente novamente em instantes.',
        code: 'ENTITLEMENT_UNAVAILABLE', retryable: true
      });
    }

    const clientAnswers = req.body.answers && typeof req.body.answers === 'object' ? req.body.answers : {};
    const enrichedAnswers = {
      ...clientAnswers,
      athleteProfile: athleteProfileFromUser(userData)
    };
    try {
      return res.status(200).json({ plan: await generatePlan(enrichedAnswers, auth.uid) });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '';
      if (
        error instanceof InvalidTrainingPlanError ||
        message.startsWith('Selecione equipamentos suficientes') ||
        message.startsWith('TRAINING_ENGINE_INVALID_PLAN') ||
        message.startsWith('O plano precisa conter')
      ) {
        return res.status(422).json({ error: message, code: 'INVALID_PLAN' });
      }
      const failure = classifyAiError(error);
      console.error('[API Training Plans Error]:', failure.code, error);
      return res.status(failure.status).json({
        error: failure.message, code: failure.code,
        isBillingError: failure.isBillingError, retryable: failure.retryable
      });
    }
  }

  if (req.method === 'POST' && req.body?.action === 'save') {
    if (!isDbAvailable()) return res.status(503).json({ error: 'O banco de planos está temporariamente indisponível.', code: 'DATABASE_UNAVAILABLE', retryable: true });
    try {
      const collection = db.collection('training_plans');
      const normalized = normalizePlan(req.body.plan, auth.uid);
      const ref = collection.doc();
      const now = new Date().toISOString();
      await db.runTransaction(async transaction => {
        const active = await transaction.get(collection.where('userId', '==', auth.uid).where('status', '==', 'active'));
        active.docs.forEach(doc => transaction.update(doc.ref, { status: 'archived', updatedAt: now }));
        transaction.set(ref, { ...normalized, id: ref.id, createdAt: now, updatedAt: now, createdAtServer: FieldValue.serverTimestamp() });
      });
      return res.status(201).json({ plan: { ...normalized, id: ref.id, createdAt: now, updatedAt: now } });
    } catch (error: any) {
      const message = error?.message || '';
      if (/firestore|firebase|permission[_ -]?denied|failed-precondition|unavailable|deadline exceeded|resource exhausted|database/i.test(message)) {
        console.error('[API Training Plans] Falha de persistência:', error);
        return res.status(503).json({ error: 'O banco de planos está temporariamente indisponível.', code: 'DATABASE_UNAVAILABLE', retryable: true });
      }
      return res.status(422).json({ error: message || 'Plano inválido.', code: 'INVALID_PLAN' });
    }
  }
  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Método não permitido.' });
}