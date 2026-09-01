import { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI } from '@google/genai';
import { FieldValue, cors, db, isDbAvailable, verifyAuth } from '../_lib/common.js';
import { classifyAiError, getAiApiKey, getAiTextModel } from '../_lib/ai-config.js';

const EXERCISES = [
  { id: 'barbell_bench_press', group: 'peito', equipment: ['barra_anilhas', 'banco'] },
  { id: 'dumbbell_bench_press', group: 'peito', equipment: ['halteres', 'banco'] },
  { id: 'incline_dumbbell_press', group: 'peito', equipment: ['halteres', 'banco'] },
  { id: 'standing_cable_fly', group: 'peito', equipment: ['crossover'] },
  { id: 'pec_deck_fly', group: 'peito', equipment: ['maquinas'] },
  { id: 'classic_push_up', group: 'peito', equipment: [] },
  { id: 'decline_push_up', group: 'peito', equipment: ['banco'] },
  { id: 'incline_push_up', group: 'peito', equipment: ['banco'] },
  { id: 'barbell_bent_over_row', group: 'costas', equipment: ['barra_anilhas'] },
  { id: 't_bar_row', group: 'costas', equipment: ['maquinas'] }
] as const;
const VALID_IDS = new Set(EXERCISES.map(item => item.id));

const cleanText = (value: unknown, max = 120) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const clampInt = (value: unknown, min: number, max: number, fallback: number) => {
  const number = Math.round(Number(value));
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
};

function normalizePlan(raw: any, userId: string, source?: 'manual' | 'ai' | 'imported') {
  const workouts = Array.isArray(raw?.workouts) ? raw.workouts.slice(0, 7).map((workout: any, workoutIndex: number) => ({
    id: cleanText(workout?.id, 64) || `workout_${workoutIndex + 1}`,
    name: cleanText(workout?.name, 40) || `Treino ${String.fromCharCode(65 + workoutIndex)}`,
    focus: cleanText(workout?.focus, 80) || 'Treino personalizado',
    weekdays: Array.isArray(workout?.weekdays) ? workout.weekdays.map((day: unknown) => clampInt(day, 0, 6, 1)).slice(0, 7) : [],
    exercises: Array.isArray(workout?.exercises) ? workout.exercises.flatMap((exercise: any, index: number) => {
      const exerciseId = cleanText(exercise?.exerciseId, 80);
      if (!VALID_IDS.has(exerciseId as any)) return [];
      return [{
        exerciseId,
        order: index,
        sets: clampInt(exercise?.sets, 1, 10, 3),
        repsMin: clampInt(exercise?.repsMin, 1, 100, 8),
        repsMax: clampInt(exercise?.repsMax, 1, 100, 12),
        restSeconds: clampInt(exercise?.restSeconds, 15, 600, 90),
        ...(Number(exercise?.initialLoadKg) >= 0 ? { initialLoadKg: Number(exercise.initialLoadKg) } : {})
      }];
    }).slice(0, 20) : []
  })).filter((workout: any) => workout.exercises.length > 0) : [];
  if (!workouts.length) throw new Error('O plano precisa conter ao menos um exercício oficial.');
  return {
    userId,
    name: cleanText(raw?.name, 60) || 'Meu plano',
    description: cleanText(raw?.description, 240),
    source: source || (['manual', 'ai', 'imported'].includes(raw?.source) ? raw.source : 'manual'),
    ...(raw?.generationMode === 'local_fallback' ? { generationMode: 'local_fallback' } : {}),
    status: 'active',
    objective: cleanText(raw?.objective, 80) || 'Evolução física',
    experienceLevel: cleanText(raw?.experienceLevel, 40),
    durationMinutes: clampInt(raw?.durationMinutes, 20, 180, 60),
    daysPerWeek: clampInt(raw?.daysPerWeek, 1, 7, workouts.length),
    answers: raw?.answers && typeof raw.answers === 'object' ? raw.answers : {},
    workouts
  };
}

async function generatePlan(answers: any, userId: string) {
  const equipment = Array.isArray(answers?.equipment) ? answers.equipment.filter((item: unknown) => typeof item === 'string') : [];
  const available = EXERCISES.filter(exercise => exercise.equipment.every(item => equipment.includes(item)) || exercise.equipment.length === 0);
  if (available.length < 3) throw new Error('Selecione equipamentos suficientes para montar um plano seguro com a biblioteca disponível.');
  const apiKey = getAiApiKey();
  if (!apiKey) throw new Error('AI_NOT_CONFIGURED');
  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: getAiTextModel(),
    contents: `Monte um plano de musculação em JSON usando SOMENTE os exerciseIds permitidos. Respostas do atleta: ${JSON.stringify(answers)}. IDs permitidos: ${JSON.stringify(available)}. Formato: {name,description,objective,experienceLevel,durationMinutes,daysPerWeek,workouts:[{id,name,focus,weekdays:number[],exercises:[{exerciseId,sets,repsMin,repsMax,restSeconds}]}]}. Não diagnostique lesões.`,
    config: { responseMimeType: 'application/json' }
  });
  let parsed: any;
  try {
    const text = (response.text || '{}').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    parsed = JSON.parse(text);
  } catch {
    throw new Error('A IA não retornou um plano válido. Tente novamente.');
  }
  parsed.answers = answers;
  return normalizePlan(parsed, userId, 'ai');
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
    try {
      return res.status(200).json({ plan: await generatePlan(req.body.answers || {}, auth.uid) });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '';
      // Falhas de preenchimento/validação do plano não são falhas do provedor.
      // Mantemos 422 para a interface orientar o atleta sem sugerir problema
      // de faturamento ou cota quando a resposta simplesmente não é válida.
      if (
        message.startsWith('Selecione equipamentos suficientes') ||
        message.startsWith('A IA não retornou um plano válido') ||
        message.startsWith('O plano precisa conter')
      ) {
        return res.status(422).json({ error: message, code: 'INVALID_PLAN' });
      }
      const failure = classifyAiError(error);
      console.error('[API Training Plans AI Error]:', failure.code, error);
      return res.status(failure.status).json({
        error: failure.message,
        code: failure.code,
        isBillingError: failure.isBillingError,
        retryable: failure.retryable
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
      return res.status(422).json({ error: message || 'Plano inválido.' });
    }
  }
  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Método não permitido.' });
}
