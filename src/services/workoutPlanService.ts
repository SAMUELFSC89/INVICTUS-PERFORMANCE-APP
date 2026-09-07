import { auth } from '../firebase';
import { API_CONFIG } from '../config';
import type { WorkoutPlan, WorkoutPlanAnswers, WorkoutPlanDraft } from '../types/workoutPlan';
import { OFFICIAL_EXERCISE_EQUIPMENT_REQUIREMENTS } from '../data/exerciseCatalog';
import { buildTrainingEnginePlan } from '../core/training/trainingEngine';

const DRAFT_KEY = 'invictus_workout_plan_draft_v1';
const LOCAL_PLANS_KEY = 'invictus_workout_plans_local_v1';

type RequestError = Error & { status?: number; code?: string; retryable?: boolean };

const apiUrl = (path: string) => `${API_CONFIG.baseUrl || ''}${path}`;

function isPersistenceFailure(error: unknown): boolean {
  const candidate = error as RequestError | undefined;
  if (candidate?.code === 'DATABASE_UNAVAILABLE' || candidate?.retryable === true) return true;
  if (typeof candidate?.status === 'number') return candidate.status >= 500;
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

// Compatibility export: every consumer uses the same requirements as the API.
export const FALLBACK_REQUIREMENTS = OFFICIAL_EXERCISE_EQUIPMENT_REQUIREMENTS;

/**
 * Contingency is no longer a round-robin/random-looking plan. It is the same
 * versioned Training Engine used as the deterministic foundation of workout
 * generation. Gemini can enhance a plan, but an outage cannot lower the
 * prescription below this baseline.
 */
export function buildLocalFallbackPlan(answers: WorkoutPlanAnswers): WorkoutPlanDraft {
  const plan = buildTrainingEnginePlan(answers);
  return {
    ...plan,
    name: 'Plano Invictus de contingência',
    description: 'Plano montado pelo Training Engine com exercícios oficiais e regras de evidência versionadas. A Invictus IA será reativada quando o serviço estiver disponível.',
    generationMode: 'local_fallback'
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
    return null;
  }
}

export const workoutPlanService = {
  async list(): Promise<WorkoutPlan[]> {
    try {
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
      if (!isPersistenceFailure(error)) throw error;
      const localPlan = writeLocalPlan(plan);
      this.clearDraft();
      return localPlan;
    }
  },
  async generate(answers: WorkoutPlanAnswers): Promise<WorkoutPlanDraft> {
    try {
      const result = await request<{ plan: WorkoutPlanDraft }>('POST', { action: 'generate', answers });
      return result.plan;
    } catch (error) {
      const candidate = error as RequestError | undefined;
      if (candidate?.code === 'PRO_REQUIRED') {
        console.info('[WorkoutPlanService] Invictus IA é exclusiva do PRO; usando Training Engine determinístico.');
        const fallback = buildLocalFallbackPlan(answers);
        return {
          ...fallback,
          generationMode: 'training_engine',
          description: 'Plano montado pelo Training Engine do Invictus. A personalização adicional pela Invictus IA é um benefício exclusivo do plano PRO.'
        };
      }
      if (isAiAvailabilityFailure(error)) {
        console.warn('[WorkoutPlanService] Gemini indisponível; Training Engine assumiu a geração:', error);
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