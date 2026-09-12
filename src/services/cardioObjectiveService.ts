import { auth } from '../firebase';
import { API_CONFIG } from '../config';
import type { Baseline, CardioAchievement, ChallengePresentation, Journey, Mission, ProfessionalUnlock, ProfileSnapshot, Review, WeightMeasurement } from '../core/cardioObjective/types';

export interface ObjectiveView {
  journey: Journey | null; profile?: ProfileSnapshot; baseline?: Baseline;
  missions?: Array<Mission | Pick<Mission, 'id' | 'state' | 'week'>>;
  reviews?: Review[]; weights?: WeightMeasurement[]; professional?: ProfessionalUnlock;
  achievements?: CardioAchievement[];
  explanation?: { text: string; source: 'gemini' | 'deterministic'; model: string | null };
  items?: Array<{ id: string; goalLabel: string; status: Journey['status']; createdAt: string }>;
  nextCursor?: string | null;
  summary?: Pick<Journey, 'id' | 'goalLabel' | 'status' | 'totalCompleted'> & {
    challengePresentation?: ChallengePresentation | null;
    nextMission: null | Pick<Mission, 'localDate' | 'state'> & Pick<Mission['prescription'], 'modality' | 'targetMetric' | 'durationMinutes' | 'distanceKm'>
  } | null;
}
export class ObjectiveRequestError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
export async function objectiveRequest(body?: Record<string, unknown>, query = '', signal?: AbortSignal): Promise<ObjectiveView> {
  const current = auth.currentUser;
  if (!current) throw new Error('Entre na sua conta para continuar.');
  const token = await current.getIdToken();
  const timeoutSignal = typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(12000) : undefined;
  const response = await fetch(`${API_CONFIG.baseUrl}/api/cardio-objective${query}`, {
    method: body ? 'POST' : 'GET', signal: signal || timeoutSignal,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  if (auth.currentUser?.uid !== current.uid) throw new Error('Sua sessão mudou. Atualize a tela.');
  if (!response.ok) throw new ObjectiveRequestError(result.error || 'Não foi possível carregar sua jornada.', response.status);
  return result;
}

/** Only retry the known Firestore publication race, never authorization or safety failures. */
export async function bindObjectiveSession(journeyId: string, missionId: string, sessionId: string) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try { return await objectiveRequest({ action: 'start', journeyId, missionId, sessionId }); }
    catch (error) {
      if (!(error instanceof ObjectiveRequestError) || error.status !== 425 || attempt === 3) throw error;
      await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
}
