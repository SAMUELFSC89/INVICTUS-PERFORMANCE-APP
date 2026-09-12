import { auth } from '../firebase';
import { API_CONFIG } from '../config';
import { localDate } from '../core/cardioObjective/engine';
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

/**
 * O backend pode deixar a próxima missão em `available` logo após concluir a
 * atual. Isso é útil para a progressão interna, mas não significa que ela deve
 * aparecer como uma segunda missão no mesmo dia. No cliente, missões futuras
 * continuam visualmente bloqueadas até a data programada. Assim a tela mostra
 * o estado de conclusão do dia e a próxima missão só aparece quando chegar a
 * data dela.
 */
export function normalizeObjectiveDailyAvailability(view: ObjectiveView, now = new Date().toISOString()): ObjectiveView {
  const journey = view.journey;
  if (!journey) return view;
  const today = localDate(now, journey.timeZone);
  const missions = view.missions?.map((mission) => {
    if ('prescription' in mission && mission.state === 'available' && mission.localDate > today) {
      return { id: mission.id, state: 'locked' as const, week: mission.week };
    }
    return mission;
  });
  const summary = view.summary?.nextMission && view.summary.nextMission.localDate > today
    ? { ...view.summary, nextMission: null }
    : view.summary;
  return { ...view, ...(missions ? { missions } : {}), ...(summary !== undefined ? { summary } : {}) };
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
  return normalizeObjectiveDailyAvailability(result);
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

export interface ObjectiveActivitySyncResult {
  completed: boolean;
  missionId?: string;
  view?: ObjectiveView;
}

/**
 * Qualquer cardio canônico concluído pode alimentar a missão vigente, mesmo
 * quando foi iniciado pela Home/Cardio e não pelo botão de Buscar Objetivo.
 * O servidor continua sendo a autoridade: modalidade, duração/distância,
 * segurança, data, sessão e anti-dupla-contagem são validados pelo action
 * `complete`. Um 409 apenas significa que aquele cardio não cumpriu a missão.
 */
export async function syncCompletedCardioWithObjective(
  activityId: string,
  preferred?: { journeyId?: string | null; missionId?: string | null },
): Promise<ObjectiveActivitySyncResult> {
  if (!activityId) return { completed: false };
  const view = await objectiveRequest(
    undefined,
    preferred?.journeyId ? `?journeyId=${encodeURIComponent(preferred.journeyId)}` : '',
  );
  const journey = view.journey;
  if (!journey || journey.status !== 'active') return { completed: false, view };

  const today = localDate(new Date().toISOString(), journey.timeZone);
  const candidates = (view.missions || [])
    .filter((mission): mission is Mission => 'prescription' in mission)
    .filter((mission) => ['started', 'available'].includes(mission.state) && mission.localDate <= today)
    .sort((left, right) => {
      if (left.state !== right.state) return left.state === 'started' ? -1 : 1;
      return left.localDate.localeCompare(right.localDate);
    });
  const preferredMission = preferred?.missionId
    ? candidates.find((mission) => mission.id === preferred.missionId)
    : undefined;
  const mission = preferredMission || candidates[0];
  if (!mission) return { completed: false, view };

  try {
    const completedView = await objectiveRequest({
      action: 'complete',
      journeyId: journey.id,
      missionId: mission.id,
      activityId,
    });
    const completed = completedView.missions?.some((item) => item.id === mission.id && item.state === 'completed') === true;
    return { completed, missionId: mission.id, view: completedView };
  } catch (error) {
    if (error instanceof ObjectiveRequestError && error.status === 409) {
      return { completed: false, missionId: mission.id, view };
    }
    throw error;
  }
}
