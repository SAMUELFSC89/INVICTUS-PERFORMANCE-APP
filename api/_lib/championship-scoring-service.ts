import { db } from './common.js';
import { getRuntimeChampionship, matchRuntimeActiveChampionshipsForActivity } from './championship-catalog.js';
import { getUserRegistration } from './championship-inscription-service.js';
import { RewardCoinEngine } from './reward-coin-engine.js';
import type { ActivityCompetitionContext } from './activity-competition-policy.js';
import { hasTrustedCompetitionEvidence, readCompetitionEvidenceMetrics } from './competition-evidence.js';
import { isCurrentCompetitiveHrAcknowledgement } from './competitive-heart-rate-acknowledgement.js';
import { COMPETITION_RULES_VERSIONS } from '../../shared/competitiveHeartRatePolicy.js';
import { isActiveAccountState } from './account-state.js';
import { paidChampionshipSettlementDocumentId } from './paid-championship-edition.js';
import { publishAdminRealtimeSignalSafe } from './admin-realtime.js';

const COMMUNITY_EVENT_ID = 'community_friends_v1';

function communityCycleKey(when = new Date()): string {
  return when.toISOString().slice(0, 7);
}

async function activeUserIds(userIds: string[]): Promise<Set<string>> {
  const unique = [...new Set(userIds.filter(Boolean))];
  if (!unique.length) return new Set();
  const refs = unique.map((id) => db.collection('users').doc(id));
  const snapshots = await db.getAll(...refs);
  return new Set(
    snapshots
      .filter((snap: any) => snap.exists && isActiveAccountState(snap.data()))
      .map((snap: any) => snap.id),
  );
}

async function isActiveCompetitiveUser(userId: string): Promise<boolean> {
  if (!userId) return false;
  const snap = await db.collection('users').doc(userId).get();
  return snap.exists && isActiveAccountState(snap.data());
}

function scoreBelongsToEdition(data: any, championship: any): boolean {
  if (!championship) return false;
  if (String(data?.editionId || '') === championship.editionId) return true;
  // Compatibilidade pré-lançamento: score antigo sem editionId só é lido se o
  // regulamento congelado coincidir exatamente com a edição atual.
  return !data?.editionId
    && data?.championshipId === championship.id
    && data?.regulationHash === championship.regulationHash;
}

async function paidContextEditionId(context: ActivityCompetitionContext): Promise<string | null> {
  if (context.editionId) return context.editionId;
  const current = await getRuntimeChampionship(context.id);
  return current && context.regulationHash === current.regulationHash ? current.editionId : null;
}

export interface ChampionshipActivityInput {
  userId: string;
  userName?: string;
  userGymName?: string;
  activityId: string;
  activityType: string;
  isIndoorCardio?: boolean;
  durationMinutes: number;
  distanceKm?: number;
  score: number;
  when: Date;
  riskScore?: number;
  securityDecision?: string | null;
  securityReportId?: string | null;
  contexts?: ActivityCompetitionContext[];
}

async function submitActivityToCommunityGymChampionship(input: ChampionshipActivityInput): Promise<void> {
  if (!db || !input.activityId || !['workout', 'cardio'].includes(input.activityType)) return;
  const frozenContext = input.contexts?.find((context) => context.type === 'community_championship' && context.id === COMMUNITY_EVENT_ID);
  if (input.contexts && !frozenContext) return;

  const [enrollmentSnap, userSnap] = await Promise.all([
    input.contexts ? Promise.resolve(null) : db.collection('community_championship_enrollments').doc(`${COMMUNITY_EVENT_ID}_${input.userId}`).get(),
    db.collection('users').doc(input.userId).get(),
  ]);
  if (!userSnap.exists || !isActiveAccountState(userSnap.data())) return;

  const enrollment = enrollmentSnap?.data();
  if (!input.contexts && (enrollment?.status !== 'active'
    || !isCurrentCompetitiveHrAcknowledgement(enrollment, COMMUNITY_EVENT_ID, COMPETITION_RULES_VERSIONS.community_friends_v1))) return;

  const user = userSnap.data() || {};
  const gymId = String(frozenContext?.gymId || user.gymId || user.academyId || 'community_global');
  const gymName = String(user.gymName || input.userGymName || 'Comunidade Invictus');
  const cycleKey = frozenContext?.cycleKey || communityCycleKey(input.when);
  const scoreId = `${cycleKey}_${input.activityId}`;
  const ref = db.collection('gym_championship_scores').doc(scoreId);
  const existing = await ref.get();
  const existingData = existing.exists ? existing.data() || {} : {};
  await ref.set({
    id: scoreId,
    eventId: COMMUNITY_EVENT_ID,
    cycleKey,
    gymId,
    gymName,
    userId: input.userId,
    userName: input.userName || user.name || user.displayName || 'Atleta Invictus',
    activityId: input.activityId,
    activityType: input.activityType,
    score: Math.max(0, Number(input.score) || 0),
    validationStatus: 'VALIDATED',
    auditStatus: 'APPROVED',
    riskScore: Number.isFinite(Number(input.riskScore)) ? Number(input.riskScore) : null,
    securityDecision: input.securityDecision || 'APPROVED',
    securityReportId: input.securityReportId || null,
    metrics: { durationMinutes: input.durationMinutes, distanceKm: input.distanceKm || 0 },
    createdAt: existingData.createdAt || input.when.toISOString(),
    updatedAt: new Date().toISOString(),
  }, { merge: true });
  publishAdminRealtimeSignalSafe({ type: 'CHAMPIONSHIP_SCORE_CHANGED', source: 'championship-score:community' });
}

export async function submitActivityToActiveChampionships(input: ChampionshipActivityInput): Promise<void> {
  if (!await isActiveCompetitiveUser(input.userId)) return;
  await submitActivityToCommunityGymChampionship(input);

  const candidates = input.contexts
    ? await Promise.all(input.contexts
        .filter((context) => context.type === 'paid_championship')
        .map(async (context) => ({
          id: context.id,
          editionId: await paidContextEditionId(context),
          context,
          minDurationMinutes: context.minDurationMinutes,
          maxDurationMinutes: context.maxDurationMinutes,
        })))
    : (await matchRuntimeActiveChampionshipsForActivity({
        activityType: input.activityType,
        isIndoorCardio: input.isIndoorCardio,
        when: input.when,
      })).map((championship) => ({
        id: championship.id,
        editionId: championship.editionId,
        context: undefined,
        minDurationMinutes: championship.antiFraudProfile?.minDurationMinutes,
        maxDurationMinutes: championship.antiFraudProfile?.maxDurationMinutes,
      }));
  if (!candidates.length) return;

  for (const champ of candidates) {
    if (!champ.editionId) continue;
    if (!input.contexts) {
      const registration = await getUserRegistration(input.userId, champ.id);
      if (!registration || registration.status !== 'paga' || registration.paymentStatus !== 'PAID') continue;
    }

    const withinDuration =
      (champ.minDurationMinutes == null || input.durationMinutes >= champ.minDurationMinutes)
      && (champ.maxDurationMinutes == null || input.durationMinutes <= champ.maxDurationMinutes);
    const scoreId = `${input.activityId}_${champ.editionId}`;
    const scoreRef = db.collection('championship_scores').doc(scoreId);
    const previous = await scoreRef.get();
    const existingData = previous.exists ? previous.data() || {} : {};
    await scoreRef.set({
      id: scoreId,
      championshipId: champ.id,
      editionId: champ.editionId,
      policyEpochId: champ.context?.epochId || null,
      regulationVersion: champ.context?.regulationVersion || null,
      regulationHash: champ.context?.regulationHash || null,
      userId: input.userId,
      userName: input.userName || 'Atleta Invictus',
      userGymName: input.userGymName || null,
      activityId: input.activityId,
      activityType: input.activityType,
      score: withinDuration ? input.score : 0,
      validationStatus: withinDuration ? 'VALIDATED' : 'REJECTED',
      validationMotives: withinDuration ? [] : ['DURATION_OUTSIDE_CHAMPIONSHIP_PROFILE'],
      championshipValidation: {
        eligible: withinDuration,
        riskScore: Number.isFinite(Number(input.riskScore)) ? Number(input.riskScore) : null,
        securityDecision: input.securityDecision || 'APPROVED',
        securityReportId: input.securityReportId || null,
        evaluatedAt: new Date().toISOString(),
      },
      metrics: { durationMinutes: input.durationMinutes, distanceKm: input.distanceKm || 0 },
      createdAt: existingData.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }, { merge: true });
    publishAdminRealtimeSignalSafe({ type: 'CHAMPIONSHIP_SCORE_CHANGED', source: 'championship-score:paid' });
  }
}

export async function syncReviewedActivityCompetitionScores(activityId: string): Promise<void> {
  if (!db || !activityId) return;
  const workoutSnap = await db.collection('workouts').doc(activityId).get();
  if (!workoutSnap.exists) return;
  const workout: any = workoutSnap.data() || {};
  const contexts = Array.isArray(workout.competitionContexts) ? workout.competitionContexts as ActivityCompetitionContext[] : [];
  if (!contexts.length) return;

  const promotedMetrics = readCompetitionEvidenceMetrics(workout);
  const malformedTrustedEvidence = hasTrustedCompetitionEvidence(workout) && !promotedMetrics;
  const userIsActive = await isActiveCompetitiveUser(String(workout.userId || ''));
  const approved = userIsActive
    && workout.competitionReviewStatus === 'approved'
    && workout.isScoringEligible === true
    && !malformedTrustedEvidence;

  if (approved) {
    const userSnap = await db.collection('users').doc(workout.userId).get();
    const user: any = userSnap.data() || {};
    await submitActivityToActiveChampionships({
      userId: workout.userId,
      userName: user.name || user.displayName,
      userGymName: user.gymName,
      activityId,
      activityType: promotedMetrics?.activityType || workout.type,
      isIndoorCardio: promotedMetrics ? promotedMetrics.isIndoorCardio === true : workout.isIndoorCardio,
      durationMinutes: Number(promotedMetrics?.durationMinutes ?? workout.duration ?? workout.durationMinutes) || 0,
      distanceKm: Number(promotedMetrics?.distanceKm ?? workout.distance ?? workout.distanceKm) || 0,
      score: Math.max(0, Number(workout.competitionPoints) || 0),
      when: new Date(promotedMetrics?.startTime || workout.startTime || workout.createdAt || Date.now()),
      riskScore: workout.securityRiskScore,
      securityDecision: workout.securityDecision,
      securityReportId: workout.securityReportId,
      contexts,
    });
    return;
  }

  const batch = db.batch();
  for (const context of contexts) {
    if (context.type === 'community_championship') {
      const cycle = context.cycleKey || communityCycleKey(new Date(workout.startTime || workout.createdAt || Date.now()));
      batch.set(db.collection('gym_championship_scores').doc(`${cycle}_${activityId}`), {
        validationStatus: 'REJECTED',
        auditStatus: 'REJECTED',
        score: 0,
        invalidatedAt: new Date().toISOString(),
        ...(!userIsActive ? { invalidationReason: 'ACCOUNT_INACTIVE' } : {}),
      }, { merge: true });
    } else if (context.type === 'paid_championship') {
      const editionId = await paidContextEditionId(context);
      if (!editionId) continue;
      batch.set(db.collection('championship_scores').doc(`${activityId}_${editionId}`), {
        championshipId: context.id,
        editionId,
        validationStatus: 'REJECTED',
        score: 0,
        invalidatedAt: new Date().toISOString(),
        ...(!userIsActive ? { invalidationReason: 'ACCOUNT_INACTIVE' } : {}),
      }, { merge: true });
    }
  }
  await batch.commit();
  publishAdminRealtimeSignalSafe({ type: 'CHAMPIONSHIP_SCORE_CHANGED', source: 'championship-score:review-sync' });
}

type CommunityRankingPeriod = 'weekly' | 'monthly' | 'all';

function communityRankingPeriodStart(period: CommunityRankingPeriod, now: Date): Date | null {
  if (period === 'all') return null;
  if (period === 'monthly') return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const start = new Date(now);
  const daysSinceMonday = (start.getUTCDay() + 6) % 7;
  start.setUTCDate(start.getUTCDate() - daysSinceMonday);
  start.setUTCHours(0, 0, 0, 0);
  return start;
}

export async function getCommunityGymChampionshipStatus(
  userId: string,
  now = new Date(),
  period: CommunityRankingPeriod = 'weekly',
) {
  const [userSnap, configSnap] = await Promise.all([
    db.collection('users').doc(userId).get(),
    db.collection('gym_championship_config').doc('global').get(),
  ]);
  const user = userSnap.data() || {};
  const config = configSnap.data() || {};
  const gymId = String(user.gymId || user.academyId || 'community_global');
  const gymName = String(user.gymName || 'Comunidade Invictus');
  const cycleKey = communityCycleKey(now);
  const cutoff = communityRankingPeriodStart(period, now);
  const snap = await db.collection('gym_championship_scores').where('eventId', '==', COMMUNITY_EVENT_ID).limit(5000).get();

  const totals = new Map<string, { userId: string; userName: string; score: number; validActivities: number }>();
  snap.forEach((doc) => {
    const data: any = doc.data();
    if (data.gymId !== gymId || data.validationStatus !== 'VALIDATED') return;
    if (cutoff) {
      const createdAt = data.createdAt?.toDate ? data.createdAt.toDate() : new Date(data.createdAt || 0);
      if (!Number.isFinite(createdAt.getTime()) || createdAt < cutoff || createdAt > now) return;
    }
    const item = totals.get(data.userId) || { userId: data.userId, userName: data.userName || 'Atleta Invictus', score: 0, validActivities: 0 };
    item.score += Math.max(0, Number(data.score) || 0);
    item.validActivities += 1;
    totals.set(data.userId, item);
  });

  const eligibleIds = await activeUserIds([...totals.keys()]);
  const ranked = [...totals.values()]
    .filter((item) => eligibleIds.has(item.userId))
    .sort((a, b) => b.score - a.score || a.userName.localeCompare(b.userName, 'pt-BR', { sensitivity: 'base' }) || a.userId.localeCompare(b.userId))
    .map((item, index) => ({ ...item, rank: index + 1 }));

  const visible = ranked.slice(0, 100);
  const profileRefs = visible.map((item) => db.collection('users').doc(item.userId));
  const profileSnaps = profileRefs.length ? await db.getAll(...profileRefs) : [];
  const profileByUid = new Map(profileSnaps.map((snap: any) => [snap.id, snap.data() || {}]));
  const leaderboard = visible.map((item) => ({
    ...item,
    photoURL: String((profileByUid.get(item.userId) as any)?.photoURL || (item.userId === userId ? user.photoURL || '' : '')),
  }));
  const rankIndex = ranked.findIndex((item) => item.userId === userId);
  const resultSnap = await db.collection('gym_championship_results').doc(`${cycleKey}_${gymId}_${userId}`).get();
  return {
    cycleKey,
    period,
    gymId,
    gymName,
    rank: rankIndex >= 0 ? rankIndex + 1 : null,
    score: rankIndex >= 0 ? ranked[rankIndex].score : 0,
    validActivities: rankIndex >= 0 ? ranked[rankIndex].validActivities : 0,
    leaderboard,
    resultStatus: resultSnap.data()?.status || 'OPEN',
    prizes: {
      1: Math.max(0, Number(config.top1Prize) || 2500),
      2: Math.max(0, Number(config.top2Prize) || 1500),
      3: Math.max(0, Number(config.top3Prize) || 1000),
      participation: Math.max(0, Number(config.participationPrize) || 50),
    },
  };
}

export async function resolveGymChampionshipReview(params: {
  resultId: string;
  decision: 'APPROVED' | 'REJECTED';
  reviewerId: string;
  reason: string;
}) {
  const ref = db.collection('gym_championship_results').doc(params.resultId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('Resultado de campeonato não encontrado.');
  const result: any = snap.data();
  if (result.status !== 'REVIEW') throw new Error('Somente resultados em revisão podem receber decisão manual.');

  const active = await isActiveCompetitiveUser(String(result.userId || ''));
  const effectiveDecision = params.decision === 'APPROVED' && !active ? 'REJECTED' : params.decision;
  const reason = !active && params.decision === 'APPROVED'
    ? `${params.reason ? `${params.reason} | ` : ''}Conta inativa no momento do settlement.`
    : params.reason;

  if (effectiveDecision === 'APPROVED') {
    await RewardCoinEngine.credit({
      userId: result.userId,
      amount: Math.max(0, Number(result.prizeCoins) || 0),
      origin: 'championship',
      ledgerType: 'GYM_CHAMPIONSHIP_PODIUM',
      description: `${result.rank}º lugar no Campeonato da Academia ${result.cycleKey}`,
      idempotencyKey: `gym-championship:${result.cycleKey}:${result.gymId}:${result.userId}:podium:${result.rank}`,
    });
  }
  await ref.set({
    status: effectiveDecision,
    manualReview: { reviewerId: params.reviewerId, reason, decidedAt: new Date().toISOString() },
    ...(effectiveDecision === 'APPROVED' ? { paidAt: new Date().toISOString() } : { rejectedAt: new Date().toISOString() }),
    updatedAt: new Date().toISOString(),
  }, { merge: true });
  return { resultId: params.resultId, status: effectiveDecision };
}

export async function finalizeCommunityGymChampionshipCycle(cycleKey: string): Promise<{ gyms: number; payouts: number; reviews: number }> {
  if (!/^\d{4}-\d{2}$/.test(cycleKey)) throw new Error('Ciclo inválido. Use YYYY-MM.');
  const [scoresSnap, configSnap, competitionEntriesSnap] = await Promise.all([
    db.collection('gym_championship_scores').where('cycleKey', '==', cycleKey).get(),
    db.collection('gym_championship_config').doc('global').get(),
    db.collection('activity_competition_entries').where('contextType', '==', 'community_championship').get(),
  ]);
  const pendingEntries = competitionEntriesSnap.docs.filter((doc) => {
    const data: any = doc.data();
    return data.cycleKey === cycleKey && ['processing', 'pending_review'].includes(String(data.reviewStatus || ''));
  });
  if (pendingEntries.length > 0) throw new Error(`O ciclo ${cycleKey} ainda possui ${pendingEntries.length} atividade(s) competitiva(s) em análise.`);

  const config = configSnap.data() || {};
  const prizes = {
    1: Math.max(0, Number(config.top1Prize) || 2500),
    2: Math.max(0, Number(config.top2Prize) || 1500),
    3: Math.max(0, Number(config.top3Prize) || 1000),
    participation: Math.max(0, Number(config.participationPrize) || 50),
  } as Record<number | 'participation', number>;

  const grouped = new Map<string, Map<string, { userId: string; userName: string; score: number; risks: number[]; validActivities: number }>>();
  scoresSnap.forEach((doc) => {
    const data: any = doc.data();
    if (data.validationStatus !== 'VALIDATED') return;
    const gym = grouped.get(data.gymId) || new Map();
    const athlete = gym.get(data.userId) || { userId: data.userId, userName: data.userName || 'Atleta Invictus', score: 0, risks: [], validActivities: 0 };
    athlete.score += Math.max(0, Number(data.score) || 0);
    athlete.risks.push(Math.max(0, Number(data.riskScore) || 0));
    athlete.validActivities += 1;
    gym.set(data.userId, athlete);
    grouped.set(data.gymId, gym);
  });

  const everyUserId = [...grouped.values()].flatMap((gym) => [...gym.keys()]);
  const eligibleIds = await activeUserIds(everyUserId);
  let payouts = 0;
  let reviews = 0;
  let eligibleGyms = 0;

  for (const [gymId, athletesMap] of grouped) {
    const athletes = [...athletesMap.values()]
      .filter((athlete) => eligibleIds.has(athlete.userId))
      .sort((a, b) => b.score - a.score || a.userId.localeCompare(b.userId));
    if (!athletes.length) continue;
    eligibleGyms += 1;

    for (const athlete of athletes) {
      await RewardCoinEngine.credit({
        userId: athlete.userId,
        amount: prizes.participation,
        origin: 'championship',
        ledgerType: 'GYM_CHAMPIONSHIP_PARTICIPATION',
        description: `Conclusão válida do Campeonato da Academia ${cycleKey}`,
        idempotencyKey: `gym-championship:${cycleKey}:${gymId}:${athlete.userId}:participation`,
      });
    }

    for (let index = 0; index < Math.min(3, athletes.length); index += 1) {
      const athlete = athletes[index];
      const rank = index + 1;
      const maxRisk = Math.max(0, ...athlete.risks);
      const status = maxRisk >= 70 ? 'REVIEW' : 'APPROVED';
      const resultRef = db.collection('gym_championship_results').doc(`${cycleKey}_${gymId}_${athlete.userId}`);
      await resultRef.set({
        cycleKey,
        gymId,
        userId: athlete.userId,
        userName: athlete.userName,
        rank,
        score: athlete.score,
        status,
        provisionalAt: new Date().toISOString(),
        enhancedAudit: { status, maxRiskScore: maxRisk, activitiesAudited: athlete.validActivities, evaluatedAt: new Date().toISOString() },
        prizeCoins: prizes[rank],
        updatedAt: new Date().toISOString(),
      }, { merge: true });
      if (status === 'REVIEW') {
        reviews += 1;
        continue;
      }
      await RewardCoinEngine.credit({
        userId: athlete.userId,
        amount: prizes[rank],
        origin: 'championship',
        ledgerType: 'GYM_CHAMPIONSHIP_PODIUM',
        description: `${rank}º lugar no Campeonato da Academia ${cycleKey}`,
        idempotencyKey: `gym-championship:${cycleKey}:${gymId}:${athlete.userId}:podium:${rank}`,
      });
      await resultRef.set({ status: 'APPROVED', paidAt: new Date().toISOString() }, { merge: true });
      payouts += 1;
    }
  }
  publishAdminRealtimeSignalSafe({ type: 'CHAMPIONSHIP_SETTLEMENT_CHANGED', source: 'championship-settlement:community' });
  return { gyms: eligibleGyms, payouts, reviews };
}

export async function getChampionshipProgress(championshipId: string, userId: string) {
  const championship = await getRuntimeChampionship(championshipId);
  if (!championship || !await isActiveCompetitiveUser(userId)) {
    return { totalScore: 0, totalTimeMinutes: 0, validSessionsCount: 0, currentRank: 0, totalParticipants: 0 };
  }
  const snap = await db.collection('championship_scores').where('championshipId', '==', championshipId).get();
  let totalScore = 0;
  let totalTimeMinutes = 0;
  let validSessionsCount = 0;
  snap.forEach((doc) => {
    const d: any = doc.data();
    if (!scoreBelongsToEdition(d, championship) || d.userId !== userId || d.validationStatus !== 'VALIDATED') return;
    totalScore += Math.max(0, Number(d.score) || 0);
    totalTimeMinutes += Math.max(0, Number(d.metrics?.durationMinutes) || 0);
    validSessionsCount += 1;
  });
  const leaderboard = await getChampionshipLeaderboard(championshipId, Number.MAX_SAFE_INTEGER);
  const position = leaderboard.findIndex((entry) => entry.userId === userId);
  return {
    totalScore,
    totalTimeMinutes,
    validSessionsCount,
    currentRank: position >= 0 ? position + 1 : leaderboard.length + 1,
    totalParticipants: leaderboard.length,
  };
}

export interface ChampionshipActivityEntry {
  activityId: string;
  activityType: string;
  score: number;
  validationStatus: string;
  durationMinutes: number;
  distanceKm: number;
  createdAt: string;
}

export async function getUserChampionshipActivities(championshipId: string, userId: string, limit = 20): Promise<ChampionshipActivityEntry[]> {
  const championship = await getRuntimeChampionship(championshipId);
  if (!championship || !await isActiveCompetitiveUser(userId)) return [];
  const snap = await db.collection('championship_scores').where('championshipId', '==', championshipId).get();
  const entries: ChampionshipActivityEntry[] = [];
  snap.forEach((doc) => {
    const d: any = doc.data();
    if (!scoreBelongsToEdition(d, championship) || d.userId !== userId) return;
    entries.push({
      activityId: d.activityId,
      activityType: d.activityType,
      score: d.score || 0,
      validationStatus: d.validationStatus,
      durationMinutes: d.metrics?.durationMinutes || 0,
      distanceKm: d.metrics?.distanceKm || 0,
      createdAt: d.createdAt,
    });
  });
  return entries
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit);
}

export interface ChampionshipLeaderboardEntry {
  rank: number;
  userId: string;
  name: string;
  gym: string;
  score: number;
  validActivities: number;
  totalTimeMinutes: number;
  finalScoreReachedAt: string;
}

function championshipScoreMillis(value: unknown): number | null {
  if (!value) return null;
  if (typeof (value as any)?.toMillis === 'function') return (value as any).toMillis();
  if (typeof (value as any)?._seconds === 'number') return (value as any)._seconds * 1000;
  if (typeof (value as any)?.seconds === 'number') return (value as any).seconds * 1000;
  const parsed = value instanceof Date ? value.getTime() : Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

export function buildProvisionalChampionshipLeaderboard(
  scores: Array<Record<string, any>>,
  eligibleUserIds: Set<string>,
  limit = 50,
): ChampionshipLeaderboardEntry[] {
  const byUser = new Map<string, Omit<ChampionshipLeaderboardEntry, 'rank'>>();
  for (const score of scores) {
    const userId = String(score.userId || '');
    if (!userId || !eligibleUserIds.has(userId) || score.validationStatus !== 'VALIDATED') continue;
    const current = byUser.get(userId) || {
      userId,
      name: String(score.userName || 'Atleta Invictus'),
      gym: String(score.userGymName || '-'),
      score: 0,
      validActivities: 0,
      totalTimeMinutes: 0,
      finalScoreReachedAt: '',
    };
    const contribution = Math.max(0, Number(score.score) || 0);
    const hadPositiveScore = current.score > 0;
    current.score += contribution;
    current.validActivities += 1;
    current.totalTimeMinutes += Math.max(0, Number(score.metrics?.durationMinutes) || 0);

    const createdAtMs = championshipScoreMillis(score.createdAt);
    const previousMs = championshipScoreMillis(current.finalScoreReachedAt);
    if (createdAtMs !== null) {
      if (contribution > 0) {
        if (!hadPositiveScore || previousMs === null || createdAtMs > previousMs) {
          current.finalScoreReachedAt = new Date(createdAtMs).toISOString();
        }
      } else if (!hadPositiveScore && current.score === 0 && (previousMs === null || createdAtMs < previousMs)) {
        current.finalScoreReachedAt = new Date(createdAtMs).toISOString();
      }
    }
    byUser.set(userId, current);
  }

  return [...byUser.values()]
    .map((entry) => ({
      ...entry,
      score: Number(entry.score.toFixed(6)),
      totalTimeMinutes: Number(entry.totalTimeMinutes.toFixed(3)),
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.validActivities !== a.validActivities) return b.validActivities - a.validActivities;
      if (b.totalTimeMinutes !== a.totalTimeMinutes) return b.totalTimeMinutes - a.totalTimeMinutes;
      const aFinal = championshipScoreMillis(a.finalScoreReachedAt) ?? Number.MAX_SAFE_INTEGER;
      const bFinal = championshipScoreMillis(b.finalScoreReachedAt) ?? Number.MAX_SAFE_INTEGER;
      if (aFinal !== bFinal) return aFinal - bFinal;
      return a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }) || a.userId.localeCompare(b.userId);
    })
    .slice(0, limit)
    .map((entry, index) => ({ rank: index + 1, ...entry }));
}

function frozenFinalLeaderboard(
  championshipId: string,
  editionId: string,
  settlement: Record<string, any>,
  limit: number,
): ChampionshipLeaderboardEntry[] | null {
  if (String(settlement.status || '') !== 'FINALIZED') return null;
  if (String(settlement.championshipId || '') !== championshipId || String(settlement.editionId || '') !== editionId) {
    throw new Error('FINALIZED_RANKING_IDENTITY_MISMATCH');
  }
  if (!Array.isArray(settlement.ranking)) throw new Error('FINALIZED_RANKING_UNAVAILABLE');

  const ineligibleUserIds = new Set(
    (Array.isArray(settlement.ineligibleFinalists) ? settlement.ineligibleFinalists : [])
      .map((entry: any) => String(entry?.userId || ''))
      .filter(Boolean),
  );
  return settlement.ranking
    .filter((entry: any) => !ineligibleUserIds.has(String(entry?.userId || '')))
    .slice(0, limit)
    .map((entry: any, index: number) => ({
      rank: index + 1,
      userId: String(entry?.userId || ''),
      name: String(entry?.userName || 'Atleta Invictus'),
      gym: String(entry?.userGymName || '-'),
      score: Math.max(0, Number(entry?.score) || 0),
      validActivities: Math.max(0, Math.floor(Number(entry?.validActivities) || 0)),
      totalTimeMinutes: Math.max(0, Number(entry?.totalTimeMinutes) || 0),
      finalScoreReachedAt: String(entry?.finalScoreReachedAt || ''),
    }));
}

export async function getChampionshipLeaderboard(championshipId: string, limit = 50): Promise<ChampionshipLeaderboardEntry[]> {
  const championship = await getRuntimeChampionship(championshipId);
  if (!championship) return [];
  const editionId = String(championship.editionId || '');
  if (editionId) {
    const settlementSnap = await db.collection('championship_settlements')
      .doc(paidChampionshipSettlementDocumentId(editionId))
      .get();
    if (settlementSnap.exists) {
      const frozen = frozenFinalLeaderboard(championshipId, editionId, settlementSnap.data() || {}, limit);
      if (frozen) return frozen;
    }
  }

  const snap = await db.collection('championship_scores').where('championshipId', '==', championshipId).get();
  const scores: Array<Record<string, any>> = [];
  snap.forEach((doc) => {
    const data: any = doc.data();
    if (!scoreBelongsToEdition(data, championship) || data.validationStatus !== 'VALIDATED') return;
    scores.push(data);
  });

  const eligibleIds = await activeUserIds(scores.map((score) => String(score.userId || '')).filter(Boolean));
  return buildProvisionalChampionshipLeaderboard(scores, eligibleIds, limit);
}
