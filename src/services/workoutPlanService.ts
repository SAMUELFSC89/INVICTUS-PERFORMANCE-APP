import { auth } from '../firebase';
import type { WorkoutPlan, WorkoutPlanAnswers, WorkoutPlanDraft } from '../types/workoutPlan';

const DRAFT_KEY = 'invictus_workout_plan_draft_v1';

async function request<T>(method: string, body?: unknown): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new Error('Usuário não autenticado.');
  const token = await user.getIdToken();
  const response = await fetch('/api/training-plans', {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Não foi possível salvar seu plano.');
  return payload as T;
}

export const workoutPlanService = {
  async list(): Promise<WorkoutPlan[]> {
    const result = await request<{ plans: WorkoutPlan[] }>('GET');
    return result.plans;
  },
  async save(plan: WorkoutPlanDraft): Promise<WorkoutPlan> {
    const result = await request<{ plan: WorkoutPlan }>('POST', { action: 'save', plan });
    this.clearDraft();
    return result.plan;
  },
  async generate(answers: WorkoutPlanAnswers): Promise<WorkoutPlanDraft> {
    const result = await request<{ plan: WorkoutPlanDraft }>('POST', { action: 'generate', answers });
    return result.plan;
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
