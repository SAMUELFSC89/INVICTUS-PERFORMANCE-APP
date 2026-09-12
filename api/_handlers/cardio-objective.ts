import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { cors, db, verifyAuth } from '../_lib/common.js';
import { answersSchema, identifierSchema, reviewSchema, safetySchema } from '../../src/core/cardioObjective/validation.js';
import { activityAchievementSeeds, adaptHabit, createJourney, goalReached, habitConfidence, localDate, makeMissions, missionMeetsActivity, professionalNextLevel, reviewAchievementSeeds, reviewWeek, safetyDecision, type VerifiedActivity } from '../../src/core/cardioObjective/engine.js';
import { summarizeCardioHistory } from '../../src/core/cardioObjective/history.js';
import { OBJECTIVE_VERSIONS, type Baseline, type CardioAchievement, type Journey, type Mission, type ObjectiveAnswers, type ProfileSnapshot, type Review, type SafetyAnswers, type WeeklyAnswers, type WeightMeasurement } from '../../src/core/cardioObjective/types.js';
import { describeObjectiveChallenge, explainObjectiveDecision, refineInitialObjectiveMission } from '../_lib/cardio-objective-ai.js';

const root = (uid: string) => db.collection('cardio_objectives').doc(uid);
class ObjectiveError extends Error { constructor(message: string, public status = 400) { super(message); } }
const event = (tx: FirebaseFirestore.Transaction, ref: FirebaseFirestore.DocumentReference, id: string, type: string, now: string, entityId: string, details = {}) => {
  tx.create(ref.collection('events').doc(id), { id, journeyId: ref.id, type, occurredAt: now, entityId, details, version: 'JOURNEY_EVENT_V1', engineVersions: OBJECTIVE_VERSIONS });
};
const snapshot = (d: FirebaseFirestore.DocumentSnapshot) => d.data();
function safeNumber(v: unknown, min: number, max: number) { return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null; }
async function getBaselineProfile(uid: string, user: Record<string, any>, now: string): Promise<ProfileSnapshot> {
  const cutoff = new Date(Date.parse(now) - 28 * 86400000).toISOString();
  const [plansResult, weightsResult, activitiesResult] = await Promise.allSettled([
    db.collection('training_plans').where('userId', '==', uid).where('status', '==', 'active').limit(1).get(),
    db.collection('health_samples').where('userId', '==', uid).where('metricType', '==', 'weight_kg').where('timestamp', '>=', cutoff).orderBy('timestamp', 'desc').limit(8).get(),
    db.collection('workouts').where('userId', '==', uid).where('timestamp', '>=', cutoff).orderBy('timestamp', 'desc').limit(80).get(),
  ]);
  const plan = plansResult.status === 'fulfilled' ? plansResult.value.docs[0] : undefined;
  const planData = plan?.data();
  const planId = plan?.id || null;
  const days: number[] = Array.isArray(planData?.workouts) ? planData.workouts.flatMap((w: any) => Array.isArray(w.weekdays) ? w.weekdays : []).filter((n: any) => Number.isInteger(n) && n >= 0 && n <= 6) : [];
  const birth = Date.parse(String(user.birthDate || ''));
  const age = Number.isFinite(birth) ? Math.floor((Date.parse(now) - birth) / (365.25 * 86400000)) : null;
  const weightDoc = weightsResult.status === 'fulfilled' ? weightsResult.value.docs.find(d => {
    const w = d.data();
    return ['apple_health', 'health_connect'].includes(w.source) && w.quality === 'sensor_verified' && safeNumber(w.value, 30, 350) !== null && w.timestamp <= now;
  }) : undefined;
  const weight = weightDoc?.data();
  const activities = activitiesResult.status === 'fulfilled' ? activitiesResult.value.docs.map(d => d.data()).filter(w => w.type === 'cardio' && w.recordStatus === 'completed' && typeof w.timestamp === 'string' && w.timestamp <= now && !w.securityBlocked && !['rejected', 'suspicious'].includes(w.status)) : null;
  const historyPoints = activities?.flatMap(w => {
    const occurredAt = typeof w.timestamp === 'string' ? w.timestamp : null;
    let durationMinutes = safeNumber(w.duration, 1, 600);
    if (durationMinutes === null && typeof w.startTime === 'string' && typeof w.endTime === 'string') {
      const elapsed = (Date.parse(w.endTime) - Date.parse(w.startTime)) / 60000;
      durationMinutes = safeNumber(elapsed, 1, 600);
    }
    if (!occurredAt || durationMinutes === null) return [];
    return [{ occurredAt, durationMinutes, modality: typeof w.cardioType === 'string' ? w.cardioType : null, distanceKm: safeNumber(w.distance, 0, 300) }];
  }) || [];
  const cardioHistory = activities ? summarizeCardioHistory(historyPoints, now) : null;
  const runs = activities?.filter(w => w.cardioType === 'running' && safeNumber(w.distance, 0, 300) !== null).map(w => w.distance as number) || [];
  return { capturedAt: now, source: 'users', planId: planData ? planId : null, heightCm: safeNumber(user.height, 100, 250), weightKg: weight?.value ?? safeNumber(user.weight, 30, 350), ageYears: age && age > 0 && age < 120 ? age : null, strengthDays: [...new Set(days)], recentCardioSessions: cardioHistory?.sessions28d ?? activities?.length ?? null, recentLongestRunKm: runs.length ? Math.max(...runs) : null, cardioHistory,
    weightSource: weight ? weight.source : safeNumber(user.weight, 30, 350) !== null ? 'profile' : null, weightMeasuredAt: weight?.timestamp || null, weightSourceId: weightDoc?.id || null, historyStatus: activities ? 'available' : 'unavailable', historyWindowDays: 28 };
}
async function currentView(uid: string, id: string) {
  const ref = root(uid).collection('journeys').doc(id);
  const doc = await ref.get();
  if (!doc.exists) throw new ObjectiveError('Jornada não encontrada.', 404);
  const journey = doc.data() as Journey;
  const [missions, baseline, reviews, weights, achievements] = await Promise.all([
    ref.collection('missions').where('week', '==', journey.currentWeek).get(),
    ref.collection('baselines').doc('initial').get(),
    ref.collection('reviews').orderBy('week', 'desc').limit(8).get(),
    ref.collection('weights').orderBy('measuredAt', 'desc').limit(16).get(),
    ref.collection('achievements').orderBy('createdAt', 'desc').limit(40).get(),
  ]);
  const visibleMissions = missions.docs.map(d => d.data() as Mission).sort((a, b) => a.localDate.localeCompare(b.localDate));
  return { journey, baseline: baseline.data(),
    missions: visibleMissions.map(m => m.state === 'locked' ? { id: m.id, state: 'locked', week: m.week } : m),
    reviews: reviews.docs.map(snapshot), weights: weights.docs.map(snapshot), achievements: achievements.docs.map(snapshot),
    professional: professionalNextLevel(journey, reviews.docs[0]?.data() as Review || null, new Date().toISOString()),
  };
}

export default async function handler(req: any, res: any) {
  if (cors(req, res)) return;
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Método não permitido.' });
  const auth = await verifyAuth(req);
  if (!auth) return res.status(401).json({ error: 'Autenticação necessária.' });
  try {
    const userDoc = await db.collection('users').doc(auth.uid).get();
    const user = userDoc.data() || {};
    if (!userDoc.exists || user.isBlocked || user.deletedAt || user.accountStatus === 'deleted') return res.status(403).json({ error: 'Conta indisponível.' });
    const now = new Date().toISOString();
    const account = root(auth.uid);
    if (req.method === 'GET') {
      if (req.query?.history === 'true') {
        const cursor = req.query?.before ? z.string().datetime().parse(req.query.before) : null;
        let query = account.collection('journeys').orderBy('createdAt', 'desc').limit(20);
        if (cursor) query = query.startAfter(cursor);
        const docs = (await query.get()).docs;
        return res.json({ items: docs.map(d => ({ id: d.id, goalLabel: d.data().goalLabel, status: d.data().status, createdAt: d.data().createdAt })), nextCursor: docs.length === 20 ? docs.at(-1)!.data().createdAt : null });
      }
      const index = await account.get();
      if (req.query?.summary === 'true') {
        const currentId = index.data()?.currentJourneyId;
        const current = currentId ? await account.collection('journeys').doc(currentId).get() : null;
        const data = current?.data() as Journey | undefined;
        const missionDocs = data && data.status === 'active' ? (await account.collection('journeys').doc(currentId).collection('missions').where('week', '==', data.currentWeek).get()).docs : [];
        const mission = missionDocs.map(d => d.data() as Mission).filter(m => ['started', 'available'].includes(m.state)).sort((a, b) => a.state === b.state ? a.localDate.localeCompare(b.localDate) : a.state === 'started' ? -1 : 1)[0];
        return res.json({ journey: null, summary: data && ['active', 'paused'].includes(data.status) ? { id: data.id, goalLabel: data.goalLabel, status: data.status, totalCompleted: data.totalCompleted, challengePresentation: data.challengePresentation || null, nextMission: mission ? { modality: mission.prescription.modality, targetMetric: mission.prescription.targetMetric, durationMinutes: mission.prescription.durationMinutes, distanceKm: mission.prescription.distanceKm, localDate: mission.localDate, state: mission.state } : null } : null });
      }
      if (req.query?.new === 'true') {
        const currentId = index.data()?.currentJourneyId;
        const current = currentId ? await account.collection('journeys').doc(currentId).get() : null;
        if (current?.exists && ['active', 'paused'].includes(current.data()?.status)) throw new ObjectiveError('Encerre sua jornada atual antes de iniciar outra.', 409);
        return res.json({ journey: null, profile: await getBaselineProfile(auth.uid, user, now) });
      }
      const id = req.query?.journeyId ? identifierSchema.parse(req.query.journeyId) : index.data()?.currentJourneyId;
      return res.json(id ? await currentView(auth.uid, id) : { journey: null, profile: await getBaselineProfile(auth.uid, user, now) });
    }
    const action = String(req.body?.action || '');
    if (action.startsWith('professional') || action === 'research-consent') throw new ObjectiveError('Parcerias e compartilhamento ainda não estão disponíveis.', 409);
    if (action === 'create') {
      const a = answersSchema.parse(req.body.answers) as ObjectiveAnswers;
      const profile = await getBaselineProfile(auth.uid, user, now);
      if (profile.ageYears === null || profile.ageYears < 18) throw new ObjectiveError('Esta jornada é destinada a adultos. Confirme a data de nascimento no perfil.');
      if (a.goalType === 'lose_weight' && profile.heightCm && (a.currentWeightKg! - a.loseKg!) / (profile.heightCm / 100) ** 2 < 18.5) throw new ObjectiveError('Esse objetivo requer avaliação profissional individual. Não vamos gerar uma meta de perda de peso automaticamente.');
      const ref = account.collection('journeys').doc();
      const created = createJourney(ref.id, auth.uid, a, profile, now);
      const refinement = await refineInitialObjectiveMission(auth.uid, a, profile, created.journey.behavior);
      created.journey.behavior = refinement.prescription;
      created.journey.challengePresentation = refinement.presentation;
      await db.runTransaction(async tx => {
        const index = await tx.get(account);
        const priorId = index.data()?.currentJourneyId;
        const prior = priorId ? await tx.get(account.collection('journeys').doc(priorId)) : null;
        if (prior?.exists && ['active', 'paused'].includes(prior.data()?.status)) throw new ObjectiveError('Você já tem uma jornada. Encerre ou conclua a atual antes de criar outra.', 409);
        tx.create(ref, created.journey);
        tx.create(ref.collection('baselines').doc('initial'), created.baseline);
        tx.create(ref.collection('interventions').doc(created.journey.habit.id), created.journey.habit);
        tx.create(ref.collection('consents').doc('product_v1'), { grantedAt: now, purpose: 'product_operation', version: 'PRODUCT_CONSENT_V1', researchConsent: false, professionalSharing: false });
        for (const mission of makeMissions(created.journey, now)) tx.create(ref.collection('missions').doc(mission.id), mission);
        if (a.currentWeightKg) tx.create(ref.collection('weights').doc('initial'), { id: 'initial', kg: a.currentWeightKg, measuredAt: now, recordedAt: now, source: 'confirmed_profile', sourceId: null });
        tx.set(account, { currentJourneyId: ref.id, updatedAt: now });
        event(tx, ref, 'created', 'goal_created', now, ref.id, {
          missionPersonalizationSource: refinement.source,
          missionPersonalizationModel: refinement.model,
          missionPersonalizationRationale: refinement.rationale,
          challengeCopySource: refinement.presentation.source,
          durationMinutes: refinement.prescription.durationMinutes,
          historySessions28d: profile.cardioHistory?.sessions28d ?? null,
          historyMinutes28d: profile.cardioHistory?.minutes28d ?? null,
          historyLoadTrend: profile.cardioHistory?.loadTrend ?? null,
          capacityConsistency: profile.cardioHistory?.capacitySignature.consistencyBand ?? null,
          capacityDominantModality: profile.cardioHistory?.capacitySignature.dominantModality ?? null,
        });
      });
      return res.status(201).json(await currentView(auth.uid, ref.id));
    }
    const id = identifierSchema.parse(req.body.journeyId);
    const ref = account.collection('journeys').doc(id);
    if (action === 'explain') {
      const view = await currentView(auth.uid, id);
      const latest = view.reviews[0] as Review | undefined;
      if (!latest) throw new ObjectiveError('Faça o primeiro check-in semanal para receber uma explicação.', 409);
      return res.json({ ...view, explanation: await explainObjectiveDecision(auth.uid, view.journey, latest) });
    }
    const eventId = randomUUID();
    await db.runTransaction(async tx => {
      const d = await tx.get(ref);
      if (!d.exists) throw new ObjectiveError('Jornada não encontrada.', 404);
      const j = d.data() as Journey;
      if (['cancelled', 'completed'].includes(j.status)) throw new ObjectiveError('Esta jornada está encerrada; o histórico permanece disponível.', 409);
      if (action === 'cancel' || action === 'pause') {
        tx.update(ref, { status: action === 'cancel' ? 'cancelled' : 'paused', updatedAt: now });
        event(tx, ref, eventId, action === 'cancel' ? 'goal_cancelled' : 'goal_paused', now, id); return;
      }
      if (action === 'review') {
        const answers = reviewSchema.parse(req.body.answers) as WeeklyAnswers;
        const week = z.number().int().positive().parse(req.body.week);
        if (week !== j.currentWeek) throw new ObjectiveError('Esta semana já foi revisada. Atualize a tela.', 409);
        const [base, ms, rs, ws, achievements, syncedWeights] = await Promise.all([
          tx.get(ref.collection('baselines').doc('initial')), tx.get(ref.collection('missions').where('week', '==', week)),
          tx.get(ref.collection('reviews').orderBy('week', 'desc').limit(8)), tx.get(ref.collection('weights').orderBy('measuredAt', 'desc').limit(56)),
          tx.get(ref.collection('achievements')),
          tx.get(db.collection('health_samples').where('userId', '==', auth.uid).where('metricType', '==', 'weight_kg').where('timestamp', '>=', j.weekStartedAt).orderBy('timestamp', 'desc').limit(8)),
        ]);
        if (ms.docs.some(m => m.data().state === 'started')) throw new ObjectiveError('Finalize ou descarte a atividade em andamento antes da revisão.');
        const weights = ws.docs.map(d => d.data() as WeightMeasurement);
        const syncedWeight = syncedWeights.docs.find(doc => {
          const data = doc.data();
          return ['apple_health', 'health_connect'].includes(data.source) && data.quality === 'sensor_verified'
            && safeNumber(data.value, 30, 350) !== null && typeof data.timestamp === 'string'
            && data.timestamp <= now;
        });
        const syncedWeightData = syncedWeight?.data();
        const measurement: WeightMeasurement | null = j.goalType !== 'lose_weight' ? null
          : answers.weightKg
            ? { id: `week_${week}`, kg: answers.weightKg, measuredAt: now, recordedAt: now, source: 'manual', sourceId: null }
            : syncedWeightData
              ? { id: `week_${week}`, kg: syncedWeightData.value, measuredAt: syncedWeightData.timestamp, recordedAt: now, source: syncedWeightData.source, sourceId: syncedWeight!.id }
              : null;
        if (measurement) weights.push(measurement);
        const prior = rs.docs.map(d => d.data() as Review);
        const review = reviewWeek(j, base.data() as Baseline, ms.docs.map(d => d.data() as Mission), answers, prior, weights, now);
        const confidence = habitConfidence([...prior, review]);
        const nextHabit = adaptHabit(j, base.data() as Baseline, review, now);
        const reached = goalReached(j, undefined, measurement?.kg);
        const next: Journey = { ...j, behavior: review.after, habit: nextHabit, safety: answers.safety, currentWeek: week + 1, weekStartedAt: now, updatedAt: now, habitConfidence: confidence.score, consolidated: j.consolidated || confidence.consolidated, status: reached ? 'completed' : review.decision === 'pause' ? 'paused' : 'active', completedAt: reached ? now : j.completedAt || null };
        tx.create(ref.collection('reviews').doc(review.id), review);
        if (measurement) tx.create(ref.collection('weights').doc(measurement.id), measurement);
        if (nextHabit.id !== j.habit.id) tx.create(ref.collection('interventions').doc(nextHabit.id), nextHabit);
        for (const mission of ms.docs) if (['available', 'locked'].includes(mission.data().state)) tx.update(mission.ref, { state: 'skipped' });
        tx.update(ref, { ...next });
        if (!reached) for (const mission of makeMissions(next, now)) tx.create(ref.collection('missions').doc(mission.id), mission);
        const existing = new Set(achievements.docs.map(d => d.id));
        const seeds = reviewAchievementSeeds(review, prior, confidence.consolidated);
        if (reached) seeds.push({ id: 'goal_completed', label: 'Objetivo alcançado', evidence: { goalType: j.goalType } });
        for (const seed of seeds.filter(seed => !existing.has(seed.id))) {
          const achievement: CardioAchievement = { ...seed, journeyId: id, createdAt: now, version: OBJECTIVE_VERSIONS.nextLevel };
          tx.create(ref.collection('achievements').doc(seed.id), achievement);
          event(tx, ref, `${eventId}_${seed.id}`, seed.id === 'base_built' ? 'next_level_unlocked' : 'achievement_unlocked', now, seed.id);
        }
        event(tx, ref, eventId, 'weekly_checkin_completed', now, review.id, { decision: review.decision, beforeMinutes: review.before.durationMinutes, afterMinutes: review.after.durationMinutes }); return;
      }
      if (action === 'resume') {
        if (j.status !== 'paused') throw new ObjectiveError('Esta jornada não está pausada.', 409);
        const safety = safetySchema.parse(req.body.safety) as SafetyAnswers;
        if (safetyDecision(safety, j.goalType === 'gradual_return').blocked) throw new ObjectiveError(safetyDecision(safety, j.goalType === 'gradual_return').reason);
        const ms = await tx.get(ref.collection('missions').where('week', '==', j.currentWeek));
        const next: Journey = { ...j, status: 'active', safety, updatedAt: now };
        tx.update(ref, { status: 'active', safety, updatedAt: now });
        if (ms.empty) for (const m of makeMissions(next, now)) tx.create(ref.collection('missions').doc(m.id), m);
        event(tx, ref, eventId, 'goal_resumed', now, id); return;
      }
      const mid = identifierSchema.parse(req.body.missionId);
      const mref = ref.collection('missions').doc(mid);
      const md = await tx.get(mref);
      if (!md.exists) throw new ObjectiveError('Meta não encontrada.', 404);
      const m = md.data() as Mission;
      if (m.week !== j.currentWeek || j.status !== 'active') throw new ObjectiveError('Esta meta não está disponível.', 409);
      if (action === 'reschedule') {
        if (m.state !== 'available') throw new ObjectiveError('Somente uma meta disponível pode ser reagendada.', 409);
        const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(req.body.localDate);
        const today = localDate(now, j.timeZone);
        const lastDay = localDate(new Date(Date.parse(j.weekStartedAt) + 6 * 86400000).toISOString(), j.timeZone);
        if (date < today || date > lastDay || Number.isNaN(Date.parse(`${date}T12:00:00Z`)) || new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date) throw new ObjectiveError('Escolha uma data válida nesta semana. Se a semana terminou, faça o check-in.');
        const missions = await tx.get(ref.collection('missions').where('week', '==', j.currentWeek));
        if (missions.docs.some(other => other.id !== mid && other.data().localDate === date)) throw new ObjectiveError('Você já tem uma meta nesse dia. Escolha outro dia.');
        const replacementId = `${m.id}_r${date.replaceAll('-', '')}`;
        tx.update(mref, { state: 'rescheduled', rescheduledAt: now, rescheduledToMissionId: replacementId });
        tx.create(ref.collection('missions').doc(replacementId), { ...m, id: replacementId, localDate: date, state: 'available', context: `Meta reagendada. ${m.context}`, createdAt: now, startedAt: null, completedAt: null, sessionId: null, activityId: null, rescheduledFromMissionId: m.id });
        event(tx, ref, eventId, 'mission_rescheduled', now, mid, { from: m.localDate, to: date });
        return;
      }
      if (action === 'start') {
        const sessionId = identifierSchema.parse(req.body.sessionId);
        const session = await tx.get(db.collection('active_sessions').doc(sessionId));
        if (!session.exists) throw new ObjectiveError('A sessão ainda está sincronizando. Tente vincular novamente.', 425);
        if (session.data()?.userId !== auth.uid || session.data()?.type !== 'cardio' || session.data()?.cardioType !== m.prescription.modality || session.data()?.status !== 'active') throw new ObjectiveError('Inicie a modalidade indicada no Cardio antes de vincular a meta.');
        if (m.state === 'started' && m.sessionId === sessionId) return;
        if (Date.parse(now) - Date.parse(j.weekStartedAt) >= 7 * 86400000) throw new ObjectiveError('Faça o check-in semanal antes de iniciar uma nova meta.', 409);
        const sessionStartedAt = session.data()?.startTime;
        if (typeof sessionStartedAt !== 'string' || !Number.isFinite(Date.parse(sessionStartedAt)) || Date.parse(sessionStartedAt) < Date.parse(m.createdAt) || Date.parse(sessionStartedAt) > Date.parse(now)) throw new ObjectiveError('Esta sessão não pertence ao período da meta.', 409);
        if (m.state !== 'available' || m.localDate > localDate(now, j.timeZone) || safetyDecision(j.safety, j.goalType === 'gradual_return').blocked) throw new ObjectiveError('Esta meta ainda não pode ser iniciada.', 409);
        const claim = account.collection('session_claims').doc(sessionId);
        if ((await tx.get(claim)).exists) throw new ObjectiveError('Esta sessão já está vinculada a uma meta.', 409);
        tx.create(claim, { journeyId: id, missionId: mid, createdAt: now });
        tx.update(mref, { state: 'started', startedAt: sessionStartedAt, sessionId });
        event(tx, ref, eventId, 'mission_started', now, mid); return;
      }
      if (action === 'complete' || action === 'skip') {
        if (m.state === 'completed' && action === 'complete') return;
        let activityId: string | null = null;
        let verifiedActivity: VerifiedActivity | null = null;
        let recoveredSessionClaim: FirebaseFirestore.DocumentReference | null = null;
        let achievementDocs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
        if (action === 'complete') {
          // Recovery after app closure uses the same canonical identity as activity validation.
          if (!m.sessionId && !req.body.activityId) throw new ObjectiveError('Informe a atividade salva para recuperar esta meta.', 409);
          activityId = req.body.activityId ? identifierSchema.parse(req.body.activityId)
            : `activity_${createHash('sha256').update(`${auth.uid}\u0000${m.sessionId}`).digest('hex')}`;
          const wd = await tx.get(db.collection('workouts').doc(activityId));
          const w = wd.data() || {};
          verifiedActivity = { id: activityId, userId: w.userId, type: w.type, cardioType: w.cardioType, sessionId: w.activitySessionId || w.sessionId || w.healthSession?.sessionId || '', durationMinutes: w.duration, distanceKm: w.distance, startedAt: w.startTime || w.healthSession?.startedAt || w.timestamp, recordStatus: w.recordStatus, rejected: w.securityBlocked === true || w.status === 'rejected' || w.status === 'suspicious' };
          let missionForValidation = m;
          if (m.state === 'available' && !m.sessionId && verifiedActivity.sessionId) {
            const activityStartedAt = Date.parse(verifiedActivity.startedAt);
            const activityLocalDate = Number.isFinite(activityStartedAt) ? localDate(new Date(activityStartedAt).toISOString(), j.timeZone) : '';
            if (!activityLocalDate || activityStartedAt < Date.parse(m.createdAt) || activityStartedAt > Date.parse(now) || activityStartedAt >= Date.parse(j.weekStartedAt) + 7 * 86400000 || m.localDate > activityLocalDate) throw new ObjectiveError('A atividade não pertence à data válida desta meta.', 409);
            recoveredSessionClaim = account.collection('session_claims').doc(identifierSchema.parse(verifiedActivity.sessionId));
            const sessionClaim = await tx.get(recoveredSessionClaim);
            if (sessionClaim.exists && (sessionClaim.data()?.journeyId !== id || sessionClaim.data()?.missionId !== mid)) throw new ObjectiveError('Esta sessão já está vinculada a outra meta.', 409);
            if (sessionClaim.exists) recoveredSessionClaim = null;
            missionForValidation = { ...m, state: 'started', sessionId: verifiedActivity.sessionId, startedAt: verifiedActivity.startedAt };
          }
          if (!missionMeetsActivity(j, missionForValidation, verifiedActivity)) throw new ObjectiveError('A atividade ainda não confirmou os critérios desta meta. Aguarde a sincronização ou finalize a proposta.', 409);
          const claim = account.collection('activity_claims').doc(activityId);
          if ((await tx.get(claim)).exists) throw new ObjectiveError('Esta atividade já foi utilizada.', 409);
        } else if (!['available', 'started'].includes(m.state)) throw new ObjectiveError('Meta não disponível.', 409);
        const [others, achievements] = await Promise.all([tx.get(ref.collection('missions').where('week', '==', m.week)), tx.get(ref.collection('achievements'))]);
        achievementDocs = achievements.docs;
        if (recoveredSessionClaim) tx.create(recoveredSessionClaim, { journeyId: id, missionId: mid, createdAt: now, recoveredFromActivityId: activityId });
        if (activityId) tx.create(account.collection('activity_claims').doc(activityId), { journeyId: id, missionId: mid, createdAt: now });
        tx.update(mref, { state: action === 'complete' ? 'completed' : 'skipped', activityId, completedAt: action === 'complete' ? now : null });
        const totalCompleted = j.totalCompleted + (activityId ? 1 : 0);
        const reached = !!verifiedActivity && goalReached(j, verifiedActivity);
        const next = others.docs.filter(d => d.data().state === 'locked').sort((a, b) => a.id.localeCompare(b.id))[0];
        if (next && !reached) tx.update(next.ref, { state: 'available' });
        tx.update(ref, { updatedAt: now, totalCompleted, ...(reached ? { status: 'completed', completedAt: now } : {}) });
        if (verifiedActivity) {
          const existing = new Set(achievementDocs.map(d => d.id));
          const seeds = activityAchievementSeeds(j, m, verifiedActivity, totalCompleted, now);
          if (reached) seeds.push({ id: 'goal_completed', label: 'Objetivo alcançado', evidence: { goalType: j.goalType, activityId } });
          for (const seed of seeds.filter(seed => !existing.has(seed.id))) {
            const achievement: CardioAchievement = { ...seed, journeyId: id, createdAt: now, version: OBJECTIVE_VERSIONS.nextLevel };
            tx.create(ref.collection('achievements').doc(seed.id), achievement);
            event(tx, ref, `${eventId}_${seed.id}`, 'achievement_unlocked', now, seed.id);
          }
        }
        event(tx, ref, eventId, activityId ? 'mission_completed' : 'mission_skipped', now, mid, { activityId }); return;
      }
      throw new ObjectiveError('Ação não reconhecida.');
    });

    if (action === 'review') {
      const view = await currentView(auth.uid, id);
      const latest = view.reviews[0] as Review | undefined;
      const baseline = view.baseline as Baseline | undefined;
      if (latest && baseline && view.journey.status === 'active') {
        const presentation = await describeObjectiveChallenge(auth.uid, view.journey, baseline, latest);
        await db.runTransaction(async tx => {
          const latestJourney = await tx.get(ref);
          const data = latestJourney.data() as Journey | undefined;
          if (latestJourney.exists && data?.status === 'active' && data.currentWeek === view.journey.currentWeek) {
            tx.update(ref, { challengePresentation: presentation, updatedAt: now });
            event(tx, ref, `${eventId}_challenge_copy`, 'challenge_copy_created', now, latest.id, { source: presentation.source, model: presentation.model });
          }
        });
      }
    }

    return res.json(await currentView(auth.uid, id));
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Confira as respostas e tente novamente.', code: 'INVALID_INPUT' });
    if (error instanceof ObjectiveError) return res.status(error.status).json({ error: error.message });
    if (error instanceof Error && error.message.startsWith('A revisão')) return res.status(409).json({ error: error.message });
    console.error('[cardio-objective] Request failed without logging health data');
    return res.status(503).json({ error: 'Não foi possível atualizar a jornada. Tente novamente.', retryable: true });
  }
}
