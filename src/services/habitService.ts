import { auth } from '../firebase';
import { API_CONFIG } from '../config';

const getApiBase = () => `${API_CONFIG.baseUrl}/api/habits`;

export type HabitGoalType =
  | 'start_running'
  | 'walk_regularly'
  | 'cycling'
  | 'improve_conditioning'
  | 'reach_distance'
  | 'custom';

export interface HabitMilestonePublic {
  order: number;
  status: 'locked' | 'active' | 'completed';
  // Present only when status !== 'locked' (server enforces the "surprise" rule).
  targetDistanceKm?: number;
  requiredSessions?: number;
  completedSessions?: number;
}

export interface HabitGoal {
  id: string;
  goalType: HabitGoalType;
  targetDistanceKm: number;
  deadline: string;
  weeklyFrequency: number;
  status: 'active' | 'completed' | 'cancelled';
  currentMilestoneIndex: number;
  totalSessionsCompleted: number;
  milestones: HabitMilestonePublic[];
  createdAt: string;
  updatedAt: string;
}

async function authedFetch(action: string, body?: any) {
  const user = auth.currentUser;
  if (!user) throw new Error('Usuário não autenticado.');
  const idToken = await user.getIdToken();
  const method = body ? 'POST' : 'GET';
  const url = `${getApiBase()}?action=${action}`;
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${idToken}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const rawText = await res.text();
  let json: any = null;
  try { json = rawText ? JSON.parse(rawText) : null; } catch (_) { /* non-JSON response */ }
  if (!res.ok) {
    const msg = json?.message || json?.error || 'Não foi possível completar a operação do hábito.';
    throw new Error(msg);
  }
  return json;
}

export async function getActiveHabit(): Promise<HabitGoal | null> {
  const data = await authedFetch('active');
  return data?.habit || null;
}

export async function getHabitHistory(): Promise<HabitGoal[]> {
  const data = await authedFetch('history');
  return data?.habits || [];
}

export interface CreateHabitInput {
  goalType: HabitGoalType;
  targetDistanceKm: number;
  deadlineDays: number;
  weeklyFrequency: number;
}

export async function createHabit(input: CreateHabitInput): Promise<HabitGoal> {
  const data = await authedFetch('create', input);
  return data.habit;
}

export async function cancelHabit(goalId: string): Promise<void> {
  await authedFetch('cancel', { goalId });
}

export async function updateHabitGoal(
  goalId: string,
  updates: { weeklyFrequency?: number; targetDistanceKm?: number }
): Promise<HabitGoal> {
  const data = await authedFetch('update-goal', { goalId, ...updates });
  return data.habit;
}
