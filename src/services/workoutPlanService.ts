import { auth } from '../firebase';
import { API_CONFIG } from '../config';
import type { WorkoutPlan, WorkoutPlanAnswers, WorkoutPlanDraft } from '../types/workoutPlan';
import { OFFICIAL_EXERCISES_BATCH_01, OFFICIAL_MUSCLE_GROUP_LABELS } from '../data/exerciseCatalog';

const DRAFT_KEY = 'invictus_workout_plan_draft_v1';
const LOCAL_PLANS_KEY = 'invictus_workout_plans_local_v1';

type RequestError = Error & { status?: number; code?: string; retryable?: boolean };

const apiUrl = (path: string) => `${API_CONFIG.baseUrl || ''}${path}`;

function isPersistenceFailure(error: unknown): boolean {
  const candidate = error as RequestError | undefined;
  if (candidate?.code === 'DATABASE_UNAVAILABLE' || candidate?.retryable === true) return true;
  if (typeof candidate?.status === 'number') return candidate.status >= 500;
  // TypeError é o erro padrão de fetch para rede indisponível/offline.
  return candidate instanceof TypeError;
}

function isAiAvailabilityFailure(error: unknown): boolean {
  const candidate = error as RequestError | undefined;
  if (['AI_NOT_CONFIGURED', 'BILLING_REQUIRED', 'QUOTA_EXCEEDED', 'INVALID_API_KEY', 'PERMISSION_DENIED', 'MODEL_UNAVAILABLE', 'NETWORK_ERROR', 'UPSTREAM_ERROR', 'INVALID_PLAN'].includes(candidate?.code || '')) return true;
  if (candidate?.retryable === true) return true;
  if (typeof candidate?.status === 'number' && candidate.status >= 500) return true;
  if (candidate instanceof TypeError) return true;
  const message = String(candidate?.message || '').toLowerCase();
  return /gemini|invictus ia|faturamento|billing|quota|modelo|ia está indisponível|ia esta indisponivel|fetch failed|network|timeout/.test(message);
}

// #326: exportado para Musculation.tsx reaproveitar a mesma tabela na
// contagem de "quantos exercicios a IA consegue usar com este equipamento"
// (availableAiExerciseCount) -- antes disso era uma formula numerica escrita
// a mao, duplicando esta tabela em outro arquivo. Cada exercicio novo tinha
// que ser somado nos dois lugares manualmente, sem nenhum aviso se alguem
// esquecesse; adicionar Pernas aqui e so aqui evita esse risco.
export const FALLBACK_REQUIREMENTS: Record<string, string[]> = {
  barbell_bench_press: ['barra_anilhas', 'banco'],
  dumbbell_bench_press: ['halteres', 'banco'],
  incline_dumbbell_press: ['halteres', 'banco'],
  standing_cable_fly: ['crossover'],
  pec_deck_fly: ['maquinas'],
  classic_push_up: [],
  decline_push_up: ['banco'],
  incline_push_up: ['banco'],
  barbell_bent_over_row: ['barra_anilhas'],
  t_bar_row: ['maquinas'],
  barbell_back_squat: ['barra_anilhas'],
  smith_machine_squat: ['maquinas'],
  leg_press_45: ['maquinas'],
  hack_squat: ['maquinas'],
  leg_extension: ['maquinas'],
  leg_curl: ['maquinas'],
  seated_leg_curl: ['maquinas'],
  barbell_stiff_deadlift: ['halteres'],
  dumbbell_lunge: ['halteres'],
  bulgarian_split_squat: ['halteres', 'banco'],
  dumbbell_walking_lunge: ['halteres'],
  hip_adductor_machine: ['maquinas'],
  hip_abductor_machine: ['maquinas'],
  barbell_hip_thrust: ['barra_anilhas', 'banco'],
  standing_calf_raise_machine: ['maquinas'],
  seated_calf_raise: ['maquinas'],
  leg_press_calf_raise: ['maquinas']
};

/**
 * Geração determinística de contingência. Ela não chama a IA nem inventa
 * exercícios: apenas distribui a biblioteca oficial compatível com os
 * equipamentos informados, mantendo o atleta treinando enquanto o Gemini
 * aguarda faturamento, cota ou configuração.
 */
export function buildLocalFallbackPlan(answers: WorkoutPlanAnswers): WorkoutPlanDraft {
  const equipment = Array.isArray(answers?.equipment) ? answers.equipment : [];
  const available = OFFICIAL_EXERCISES_BATCH_01.filter((exercise) =>
    (FALLBACK_REQUIREMENTS[exercise.id] || []).every((item) => equipment.includes(item))
  );
  if (available.length < 3) {
    throw new Error('Selecione equipamentos suficientes para montar um plano seguro com a biblioteca disponível.');
  }

  const days = Math.max(1, Math.min(7, Math.round(Number(answers.daysPerWeek) || 3)));
  const durationMinutes = Math.max(20, Math.min(180, Math.round(Number(answers.durationMinutes) || 60)));
  const isStrength = answers.primaryGoal === 'forca' || answers.preferredTraining === 'forca';
  const isAdvanced = answers.experienceLevel === 'avancado';
  const repsMin = isStrength ? 4 : isAdvanced ? 8 : 10;
  const repsMax = isStrength ? 6 : isAdvanced ? 12 : 15;
  const sets = isAdvanced ? 4 : 3;
  const restSeconds = isStrength ? 150 : 90;
  const workouts = Array.from({ length: days }, (_, dayIndex) => {
    const count = Math.min(4, available.length);
    const selectedExercises = Array.from({ length: count }, (_, slot) => available[(dayIndex * 2 + slot) % available.length]);
    const exercises = selectedExercises.map((exercise, slot) => {
      return {
        exerciseId: exercise.id,
        order: slot,
        sets,
        repsMin,
        repsMax,
        restSeconds
      };
    });
    const focusGroups = [...new Set(selectedExercises.map((exercise) => exercise.muscleGroup))];
    return {
      id: `workout_${dayIndex + 1}`,
      name: `Treino ${String.fromCharCode(65 + dayIndex)}`,
      focus: focusGroups.map((group) => OFFICIAL_MUSCLE_GROUP_LABELS[group] || group).join(' e '),
      weekdays: [dayIndex % 7],
      exercises
    };
  });

  return {
    name: 'Plano Invictus de contingência',
    description: 'Plano montado localmente com exercícios oficiais. A Invictus IA será reativada quando o serviço Gemini estiver disponível.',
    source: 'ai',
    generationMode: 'local_fallback',
    objective: answers.primaryGoal || 'Evolução física',
    experienceLevel: answers.experienceLevel,
    durationMinutes,
    daysPerWeek: days,
    answers,
    workouts
  };
}

function readLocalPlans(): WorkoutPlan[] {
  try {
    const value = JSON.parse(localStorage.getItem(LOCAL_PLANS_KEY) || '[]');
    const userId = auth.currentUser?.uid;
    return Array.isArray(value)
      ? value.filter((item): item is WorkoutPlan => Boolean(item?.id && item?.userId === userId && Array.isArray(item?.workouts)))
      : [];
  } catch {
    return [];
  }
}

function writeLocalPlan(draft: WorkoutPlanDraft): WorkoutPlan {
  const now = new Date().toISOString();
  const plan: WorkoutPlan = {
    ...draft,
    id: `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    userId: auth.currentUser?.uid || 'local',
    status: 'active',
    createdAt: now,
    updatedAt: now
  };
  const previous = readLocalPlans().map((item) => ({ ...item, status: 'archived' as const }));
  localStorage.setItem(LOCAL_PLANS_KEY, JSON.stringify([plan, ...previous]));
  return plan;
}

async function request<T>(method: string, body?: unknown, path = '/api/training-plans'): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new Error('Usuário não autenticado.');
  const token = await user.getIdToken();
  const response = await fetch(apiUrl(path), {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || 'Não foi possível salvar seu plano.') as RequestError;
    error.status = response.status;
    error.code = typeof payload.code === 'string' ? payload.code : undefined;
    error.retryable = payload.retryable === true;
    throw error;
  }
  return payload as T;
}

async function syncPendingLocalPlan(): Promise<WorkoutPlan | null> {
  const pending = readLocalPlans().find((item) => item.id.startsWith('local_') && item.status === 'active');
  if (!pending) return null;
  try {
    const { id: _id, userId: _userId, status: _status, createdAt: _createdAt, updatedAt: _updatedAt, ...draft } = pending;
    const result = await request<{ plan: WorkoutPlan }>('POST', { action: 'save', plan: draft });
    const remaining = readLocalPlans().filter((item) => item.id !== pending.id);
    localStorage.setItem(LOCAL_PLANS_KEY, JSON.stringify(remaining));
    return result.plan;
  } catch {
    // A tentativa é oportunista; o plano local continua disponível para o
    // treino e será tentado novamente na próxima abertura da musculação.
    return null;
  }
}

export const workoutPlanService = {
  async list(): Promise<WorkoutPlan[]> {
    try {
      // Na Vercel, /api/* é reescrito para /api/app. Sem a ação explícita,
      // o endpoint unificado responde 400 em vez de encaminhar para a lista.
      // A query continua compatível com o handler direto usado localmente.
      const result = await request<{ plans: WorkoutPlan[] }>('GET', undefined, '/api/training-plans?action=training-plans');
      const synced = await syncPendingLocalPlan();
      const local = readLocalPlans();
      return [...(synced ? [synced] : []), ...local, ...result.plans.filter((remote) => !local.some((item) => item.id === remote.id))];
    } catch (error) {
      if (isPersistenceFailure(error)) return readLocalPlans();
      throw error;
    }
  },
  async save(plan: WorkoutPlanDraft): Promise<WorkoutPlan> {
    try {
      const result = await request<{ plan: WorkoutPlan }>('POST', { action: 'save', plan });
      this.clearDraft();
      return result.plan;
    } catch (error) {
      // O plano já foi gerado/validado pela IA. Se apenas a persistência caiu,
      // preservamos o resultado no aparelho para o atleta não perder o treino;
      // a mensagem na tela deixa explícito que a sincronização ficou pendente.
      if (!isPersistenceFailure(error)) throw error;
      const localPlan = writeLocalPlan(plan);
      this.clearDraft();
      return localPlan;
    }
  },
  async generate(answers: WorkoutPlanAnswers): Promise<WorkoutPlanDraft> {
    try {
      const result = await request<{ plan: WorkoutPlanDraft }>('POST', { action: 'generate', answers });
      return { ...result.plan, generationMode: 'gemini' };
    } catch (error) {
      if (isAiAvailabilityFailure(error)) {
        console.warn('[WorkoutPlanService] Gemini indisponível; usando plano local de contingência:', error);
        return buildLocalFallbackPlan(answers);
      }
      throw error;
    }
  },
  saveDraft(value: unknown) {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ version: 1, savedAt: Date.now(), value }));
  },
  loadDraft<T>(): T | null {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed?.version === 1 ? parsed.value as T : null;
    } catch { return null; }
  },
  clearDraft() { localStorage.removeItem(DRAFT_KEY); }
};
