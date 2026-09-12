import { randomUUID } from 'node:crypto';
import { db } from './common.js';
import { notificationService } from '../_services/notification-service.js';
import {
  activityAchievementSeeds,
  goalReached,
  localDate,
  missionMeetsActivity,
  safetyDecision,
  type VerifiedActivity,
} from '../../src/core/cardioObjective/engine.js';
import {
  OBJECTIVE_VERSIONS,
  type CardioAchievement,
  type Journey,
  type Mission,
} from '../../src/core/cardioObjective/types.js';

const objectiveRoot = (uid: string) => db.collection('cardio_objectives').doc(uid);
const WEEK_MS = 7 * 86_400_000;

function asVerifiedActivity(id: string, data: Record<string, any>): VerifiedActivity | null {
  const startedAt = data.startTime || data.healthSession?.startedAt || data.timestamp;
  const durationMinutes = Number(data.duration ?? data.durationMinutes ?? data.durationMins);
  const distanceKm = Number(data.distance ?? data.distanceKm ?? 0);
  const sessionId = String(data.activitySessionId || data.sessionId || data.healthSession?.sessionId || '').trim();
  const recordStatus = String(data.recordStatus || data.status || '').toLowerCase();
  const quality = String(data.dataQualityStatus || '').toLowerCase();
  const reason = String(data.nonScoringReason || '').toUpperCase();
  const rejected = data.securityBlocked === true
    || data.pendingReview === true
    || ['rejected', 'suspicious', 'discarded'].includes(String(data.status || '').toLowerCase())
    || ['duplicate', 'discarded', 'dedup_pending'].includes(quality)
    || reason === 'DUPLICATE_ACTIVITY'
    || data.missionEligible === false;

  if (data.type !== 'cardio' || recordStatus !== 'completed' || rejected) return null;
  if (!sessionId || typeof startedAt !== 'string' || !Number.isFinite(Date.parse(startedAt))) return null;
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) return null;

  return {
    id,
    userId: String(data.userId || ''),
    type: 'cardio',
    cardioType: String(data.cardioType || ''),
    sessionId,
    durationMinutes,
    distanceKm: Number.isFinite(distanceKm) && distanceKm >= 0 ? distanceKm : 0,
    startedAt,
    recordStatus: 'completed',
    rejected: false,
  };
}

function candidateMission(
  journey: Journey,
  missions: Mission[],
  activity: VerifiedActivity,
): { mission: Mission; synthetic: Mission } | null {
  const startedMs = Date.parse(activity.startedAt);
  if (!Number.isFinite(startedMs)) return null;
  const activityDate = localDate(new Date(startedMs).toISOString(), journey.timeZone);
  const weekEnd = Date.parse(journey.weekStartedAt) + WEEK_MS;
  if (startedMs < Date.parse(journey.weekStartedAt) || startedMs >= weekEnd) return null;

  // Regra de produto: no máximo uma missão de Buscar Objetivo por dia local.
  // Mesmo que existam missões atrasadas, um segundo cardio no mesmo dia não
  // consome outra etapa da jornada. A próxima oportunidade começa no dia local
  // seguinte.
  const alreadyCompletedOnActivityDay = missions.some((mission) =>
    mission.state === 'completed'
      && typeof mission.completedAt === 'string'
      && localDate(mission.completedAt, journey.timeZone) === activityDate,
  );
  if (alreadyCompletedOnActivityDay) return null;

  const ordered = missions
    .filter((mission) => ['started', 'available'].includes(mission.state) && mission.localDate <= activityDate)
    .sort((left, right) => {
      const leftSessionMatch = left.state === 'started' && left.sessionId === activity.sessionId;
      const rightSessionMatch = right.state === 'started' && right.sessionId === activity.sessionId;
      if (leftSessionMatch !== rightSessionMatch) return leftSessionMatch ? -1 : 1;
      if (left.state !== right.state) return left.state === 'started' ? -1 : 1;
      return left.localDate.localeCompare(right.localDate) || left.id.localeCompare(right.id);
    });

  for (const mission of ordered) {
    if (startedMs < Date.parse(mission.createdAt)) continue;
    const synthetic: Mission = mission.state === 'available'
      ? { ...mission, state: 'started', sessionId: activity.sessionId, startedAt: activity.startedAt }
      : mission;
    if (missionMeetsActivity(journey, synthetic, activity)) return { mission, synthetic };
  }
  return null;
}

function writeEvent(
  transaction: any,
  journeyRef: any,
  id: string,
  type: string,
  now: string,
  entityId: string,
  details: Record<string, unknown> = {},
) {
  transaction.create(journeyRef.collection('events').doc(id), {
    id,
    journeyId: journeyRef.id,
    type,
    occurredAt: now,
    entityId,
    details,
    version: 'JOURNEY_EVENT_V1',
    engineVersions: OBJECTIVE_VERSIONS,
  });
}

export interface ObjectiveCardioSyncResult {
  completed: boolean;
  journeyId?: string;
  missionId?: string;
  activityId?: string;
  goalReached?: boolean;
  notificationNeeded?: boolean;
}

/**
 * Faz uma atividade cardio canônica alimentar a missão vigente, sem depender
 * da tela/rota pela qual o cardio foi iniciado. A atividade só conta quando os
 * mesmos critérios do fluxo explícito são satisfeitos (modalidade, duração ou
 * distância, janela da semana, segurança e estado canônico concluído).
 *
 * activity_claims torna a operação idempotente: uma atividade nunca conclui
 * duas missões e retries não geram nova conquista. completion_notifications
 * garante uma única notificação oficial mesmo quando o fluxo explícito marcou
 * a missão antes desta reconciliação automática.
 */
export async function reconcileCardioObjectiveActivity(
  userId: string,
  activityId: string,
): Promise<ObjectiveCardioSyncResult> {
  const workoutRef = db.collection('workouts').doc(activityId);
  const workoutSnap = await workoutRef.get();
  if (!workoutSnap.exists) return { completed: false };
  const activity = asVerifiedActivity(activityId, workoutSnap.data() || {});
  if (!activity || activity.userId !== userId) return { completed: false };

  const account = objectiveRoot(userId);
  const now = new Date().toISOString();
  const notificationReceiptRef = account.collection('completion_notifications').doc(activityId);
  const result = await db.runTransaction(async (transaction: any): Promise<ObjectiveCardioSyncResult> => {
    const [index, activityClaim, notificationReceipt] = await Promise.all([
      transaction.get(account),
      transaction.get(account.collection('activity_claims').doc(activityId)),
      transaction.get(notificationReceiptRef),
    ]);
    if (activityClaim.exists) {
      const claim = activityClaim.data() || {};
      const journeyId = String(claim.journeyId || '');
      const missionId = String(claim.missionId || '');
      const notificationNeeded = !notificationReceipt.exists && !!journeyId && !!missionId;
      if (notificationNeeded) {
        transaction.create(notificationReceiptRef, {
          journeyId,
          missionId,
          activityId,
          createdAt: now,
          source: 'objective_completion_reconciliation',
        });
      }
      return { completed: true, journeyId, missionId, activityId, notificationNeeded };
    }

    const journeyId = String(index.data()?.currentJourneyId || '').trim();
    if (!journeyId) return { completed: false };
    const journeyRef = account.collection('journeys').doc(journeyId);
    const journeySnap = await transaction.get(journeyRef);
    if (!journeySnap.exists) return { completed: false };
    const journey = journeySnap.data() as Journey;
    if (journey.status !== 'active' || journey.userId !== userId) return { completed: false };
    if (safetyDecision(journey.safety, journey.goalType === 'gradual_return').blocked) return { completed: false };

    const missionQuery = await transaction.get(
      journeyRef.collection('missions').where('week', '==', journey.currentWeek),
    );
    const missions = missionQuery.docs.map((doc: any) => doc.data() as Mission);
    const candidate = candidateMission(journey, missions, activity);
    if (!candidate) return { completed: false };

    const mission = candidate.mission;
    const missionRef = journeyRef.collection('missions').doc(mission.id);
    const sessionClaimRef = account.collection('session_claims').doc(activity.sessionId);
    const sessionClaim = await transaction.get(sessionClaimRef);
    if (sessionClaim.exists) {
      const claim = sessionClaim.data() || {};
      if (claim.journeyId !== journeyId || claim.missionId !== mission.id) return { completed: false };
    }

    const achievementsSnap = await transaction.get(journeyRef.collection('achievements'));
    const existingAchievements = new Set(achievementsSnap.docs.map((doc: any) => doc.id));
    const totalCompleted = Math.max(0, Number(journey.totalCompleted) || 0) + 1;
    const reached = goalReached(journey, activity);
    const eventId = randomUUID();

    if (!sessionClaim.exists) {
      transaction.create(sessionClaimRef, {
        journeyId,
        missionId: mission.id,
        createdAt: now,
        recoveredFromActivityId: activityId,
      });
    }
    transaction.create(account.collection('activity_claims').doc(activityId), {
      journeyId,
      missionId: mission.id,
      createdAt: now,
      source: 'canonical_cardio_auto_sync',
    });
    if (!notificationReceipt.exists) {
      transaction.create(notificationReceiptRef, {
        journeyId,
        missionId: mission.id,
        activityId,
        createdAt: now,
        source: 'canonical_cardio_auto_sync',
      });
    }
    transaction.update(missionRef, {
      state: 'completed',
      activityId,
      completedAt: now,
      ...(mission.state === 'available' ? {
        sessionId: activity.sessionId,
        startedAt: activity.startedAt,
      } : {}),
    });

    const next = missionQuery.docs
      .filter((doc: any) => doc.data().state === 'locked')
      .sort((left: any, right: any) => {
        const dateDiff = String(left.data().localDate || '').localeCompare(String(right.data().localDate || ''));
        return dateDiff || left.id.localeCompare(right.id);
      })[0];
    if (next && !reached) transaction.update(next.ref, { state: 'available' });

    transaction.update(journeyRef, {
      updatedAt: now,
      totalCompleted,
      ...(reached ? { status: 'completed', completedAt: now } : {}),
    });

    const seeds = activityAchievementSeeds(journey, candidate.synthetic, activity, totalCompleted, now);
    if (reached) seeds.push({
      id: 'goal_completed',
      label: 'Objetivo alcançado',
      evidence: { goalType: journey.goalType, activityId },
    });
    for (const seed of seeds.filter((item) => !existingAchievements.has(item.id))) {
      const achievement: CardioAchievement = {
        ...seed,
        journeyId,
        createdAt: now,
        version: OBJECTIVE_VERSIONS.nextLevel,
      };
      transaction.create(journeyRef.collection('achievements').doc(seed.id), achievement);
      writeEvent(transaction, journeyRef, `${eventId}_${seed.id}`, 'achievement_unlocked', now, seed.id);
    }
    writeEvent(transaction, journeyRef, eventId, 'mission_completed', now, mission.id, {
      activityId,
      source: 'canonical_cardio_auto_sync',
    });

    return {
      completed: true,
      journeyId,
      missionId: mission.id,
      activityId,
      goalReached: reached,
      notificationNeeded: !notificationReceipt.exists,
    };
  });

  if (result.completed && result.missionId && result.notificationNeeded) {
    void notificationService.notify({
      userId,
      title: result.goalReached ? 'Objetivo alcançado! 🏆' : 'Missão concluída! ✅',
      message: result.goalReached
        ? 'Seu cardio confirmou o objetivo da jornada. Abra Buscar Objetivo para ver a conclusão.'
        : 'Seu cardio contou para o Buscar Objetivo. A próxima missão ficará disponível na data programada.',
      type: 'achievement',
      actionUrl: '/challenges/cardio/objective',
      data: {
        journeyId: result.journeyId || '',
        missionId: result.missionId,
        activityId,
      },
    }).catch((error: any) => {
      console.warn(`[CardioObjective] Falha não bloqueante ao notificar conclusão: ${error?.message || error}`);
    });
  }

  return result;
}

/**
 * Recupera cardios da semana atual que ainda não foram computados. Usado na
 * reconciliação do perfil para cobrir encerramento do app, retorno de rede e
 * cardios iniciados fora da tela Buscar Objetivo.
 */
export async function reconcileRecentCardioObjectives(userId: string): Promise<ObjectiveCardioSyncResult[]> {
  const account = objectiveRoot(userId);
  const index = await account.get();
  const journeyId = String(index.data()?.currentJourneyId || '').trim();
  if (!journeyId) return [];
  const journeySnap = await account.collection('journeys').doc(journeyId).get();
  if (!journeySnap.exists) return [];
  const journey = journeySnap.data() as Journey;
  if (journey.status !== 'active') return [];

  const workouts = await db.collection('workouts').where('userId', '==', userId).get();
  const candidates = workouts.docs
    .map((doc: any) => ({ id: doc.id, data: doc.data() || {} }))
    .map((entry: any) => ({ ...entry, activity: asVerifiedActivity(entry.id, entry.data) }))
    .filter((entry: any) => entry.activity
      && Date.parse(entry.activity.startedAt) >= Date.parse(journey.weekStartedAt)
      && Date.parse(entry.activity.startedAt) < Date.parse(journey.weekStartedAt) + WEEK_MS)
    .sort((left: any, right: any) => Date.parse(left.activity.startedAt) - Date.parse(right.activity.startedAt));

  const results: ObjectiveCardioSyncResult[] = [];
  for (const candidate of candidates) {
    const result = await reconcileCardioObjectiveActivity(userId, candidate.id);
    if (result.completed) results.push(result);
  }
  return results;
}
