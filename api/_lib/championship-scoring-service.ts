import { db } from './common.js';
import { matchActiveChampionshipsForActivity } from './championship-catalog.js';
import { getUserRegistration } from './championship-inscription-service.js';
import { RewardCoinEngine } from './reward-coin-engine.js';
import type { ActivityCompetitionContext } from './activity-competition-policy.js';
import {
  hasTrustedCompetitionEvidence,
  readCompetitionEvidenceMetrics,
} from './competition-evidence.js';

const COMMUNITY_EVENT_ID = 'community_friends_v1';

function communityCycleKey(when = new Date()): string {
  return when.toISOString().slice(0, 7);
}

async function submitActivityToCommunityGymChampionship(input: ChampionshipActivityInput): Promise<void> {
  if (!db || !input.activityId || !['workout', 'cardio'].includes(input.activityType)) return;
  const frozenContext = input.contexts?.find((context) => context.type === 'community_championship' && context.id === COMMUNITY_EVENT_ID);
  if (input.contexts && !frozenContext) return;
  const [enrollmentSnap, userSnap] = await Promise.all([
    input.contexts ? Promise.resolve(null) : db.collection('community_championship_enrollments').doc(`${COMMUNITY_EVENT_ID}_${input.userId}`).get(),
    db.collection('users').doc(input.userId).get(),
  ]);
  if (!input.contexts && enrollmentSnap?.data()?.status !== 'active') return;
  const user = userSnap.data() || {};
  const gymId = String(frozenContext?.gymId || user.gymId || user.academyId || 'community_global');
  const gymName = String(user.gymName || input.userGymName || 'Comunidade Invictus');
  const cycleKey = frozenContext?.cycleKey || communityCycleKey(input.when);
  const scoreId = `${cycleKey}_${input.activityId}`;
  const ref = db.collection('gym_championship_scores').doc(scoreId);
  const existing = await ref.get();
  const existingData = existing.exists ? existing.data() || {} : {};
  await ref.set({
    id: scoreId, eventId: COMMUNITY_EVENT_ID, cycleKey, gymId, gymName,
    userId: input.userId, userName: input.userName || user.name || user.displayName || 'Atleta Invictus',
    activityId: input.activityId, activityType: input.activityType,
    score: Math.max(0, Number(input.score) || 0), validationStatus: 'VALIDATED',
    auditStatus: 'APPROVED', riskScore: Number.isFinite(Number(input.riskScore)) ? Number(input.riskScore) : null,
    securityDecision: input.securityDecision || 'APPROVED', securityReportId: input.securityReportId || null,
    metrics: { durationMinutes: input.durationMinutes, distanceKm: input.distanceKm || 0 },
    createdAt: existingData.createdAt || input.when.toISOString(),
    updatedAt: new Date().toISOString(),
  }, { merge: true });
}

/**
 * Pontuacao e leaderboard de campeonato.
 *
 * Ate 2026-08 isso era 100% decorativo: getUserProgress() e getLeaderboard()
 * em championshipService.ts devolviam numeros fixos hardcoded (ex: "182º
 * lugar, 7650 pontos", "Lucas Titan Silva, 14850 pontos") sem nenhuma
 * atividade real por tras. Agora cada atividade homologada (SecurityPipeline
 * + IGA ja aprovaram, ver validate-activity-service.ts) que cair dentro da
 * janela e do tipo de um campeonato em que o usuario tem inscricao PAGA vira
 * um documento em `championship_scores`, e progresso/leaderboard sao somas
 * reais sobre essa colecao.
 *
 * O "score" por atividade reaproveita o scoreAwarded (XP) ja calculado pelo
 * ValidateActivityService -- de proposito NAO inventamos uma 6ª formula de
 * pontuacao: o app ja tinha 5 formulas independentes de ranking coexistindo
 * (ver AUDITORIA-CORE-INVICTUS.md) e o IGA foi criado exatamente para acabar
 * com isso. O placar do campeonato e a soma do esforco real ja auditado.
 *
 * Consultas usam filtro de igualdade UNICO (championshipId) e filtram o
 * resto (userId, validationStatus) em memoria -- mesmo padrao ja usado em
 * api/_lib/igaService.ts (fetchAllSessionsSince) para nao depender de indice
 * composto do Firestore, que precisaria ser criado manualmente no console e
 * quebraria a producao silenciosamente (failed-precondition) se alguem
 * esquecesse.
 */

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
  /** Allowlist congelada no início. Ausente apenas em writers legados. */
  contexts?: ActivityCompetitionContext[];
}

/**
 * Submissao automatica pos-validacao. Roda depois do recalculo do IGA em
 * validate-activity-service.ts; e um no-op (sem nenhuma leitura extra
 * relevante) para qualquer usuario sem inscricao paga em nenhum campeonato
 * ativo -- ou seja, hoje, para todo mundo, ate a primeira inscricao real
 * acontecer. Escritas usam IDs determinísticos e propagam falhas: o chamador
 * pode repetir a conciliação sem duplicar a pontuação.
 */
export async function submitActivityToActiveChampionships(input: ChampionshipActivityInput): Promise<void> {
  await submitActivityToCommunityGymChampionship(input);
  const candidatos = input.contexts
    ? input.contexts
        .filter((context) => context.type === 'paid_championship')
        .map((context) => ({
          id: context.id,
          context,
          minDurationMinutes: context.minDurationMinutes,
          maxDurationMinutes: context.maxDurationMinutes,
        }))
    : matchActiveChampionshipsForActivity({
        activityType: input.activityType,
        isIndoorCardio: input.isIndoorCardio,
        when: input.when,
      }).map((championship) => ({
        id: championship.id,
        context: undefined,
        minDurationMinutes: championship.antiFraudProfile?.minDurationMinutes,
        maxDurationMinutes: championship.antiFraudProfile?.maxDurationMinutes,
      }));
  if (candidatos.length === 0) return;

  for (const champ of candidatos) {
    if (!input.contexts) {
      const registration = await getUserRegistration(input.userId, champ.id);
      const ativo = !!registration && registration.status === 'paga' && registration.paymentStatus === 'PAID';
      if (!ativo) continue;
    }

    const dentroDaDuracao =
      (champ.minDurationMinutes == null || input.durationMinutes >= champ.minDurationMinutes) &&
      (champ.maxDurationMinutes == null || input.durationMinutes <= champ.maxDurationMinutes);

    const scoreId = `${input.activityId}_${champ.id}`;
    const scoreRef = db.collection('championship_scores').doc(scoreId);
    const jaExiste = await scoreRef.get();
    const existingData = jaExiste.exists ? jaExiste.data() || {} : {};

    await scoreRef.set({
      id: scoreId,
      championshipId: champ.id,
      policyEpochId: champ.context?.epochId || null,
      regulationVersion: champ.context?.regulationVersion || null,
      regulationHash: champ.context?.regulationHash || null,
      userId: input.userId,
      userName: input.userName || 'Atleta Invictus',
      userGymName: input.userGymName || null,
      activityId: input.activityId,
      activityType: input.activityType,
      score: dentroDaDuracao ? input.score : 0,
      validationStatus: dentroDaDuracao ? 'VALIDATED' : 'REJECTED',
      validationMotives: dentroDaDuracao ? [] : ['DURATION_OUTSIDE_CHAMPIONSHIP_PROFILE'],
      championshipValidation: {
        eligible: dentroDaDuracao,
        riskScore: Number.isFinite(Number(input.riskScore)) ? Number(input.riskScore) : null,
        securityDecision: input.securityDecision || 'APPROVED',
        securityReportId: input.securityReportId || null,
        evaluatedAt: new Date().toISOString(),
      },
      metrics: {
        durationMinutes: input.durationMinutes,
        distanceKm: input.distanceKm || 0,
      },
      createdAt: existingData.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }, { merge: true });
  }
}

/**
 * Reprojeta placares após uma decisão administrativa. O workout continua
 * sendo a fonte do registro pessoal; estes documentos representam apenas o
 * resultado competitivo e podem ser zerados sem apagar a atividade.
 */
export async function syncReviewedActivityCompetitionScores(activityId: string): Promise<void> {
  if (!db || !activityId) return;
  const workoutSnap = await db.collection('workouts').doc(activityId).get();
  if (!workoutSnap.exists) return;
  const workout: any = workoutSnap.data() || {};
  const contexts = Array.isArray(workout.competitionContexts) ? workout.competitionContexts as ActivityCompetitionContext[] : [];
  if (!contexts.length) return;
  const promotedMetrics = readCompetitionEvidenceMetrics(workout);
  const malformedTrustedEvidence = hasTrustedCompetitionEvidence(workout) && !promotedMetrics;
  const approved = workout.competitionReviewStatus === 'approved'
    && workout.isScoringEligible === true && !malformedTrustedEvidence;
  if (approved) {
    const userSnap = await db.collection('users').doc(workout.userId).get();
    const user: any = userSnap.data() || {};
    await submitActivityToActiveChampionships({
      userId: workout.userId,
      userName: user.name || user.displayName,
      userGymName: user.gymName,
      activityId,
      activityType: promotedMetrics?.activityType || workout.type,
      isIndoorCardio: promotedMetrics
        ? promotedMetrics.isIndoorCardio === true : workout.isIndoorCardio,
      durationMinutes: Number(promotedMetrics?.durationMinutes
        ?? workout.duration ?? workout.durationMinutes) || 0,
      distanceKm: Number(promotedMetrics?.distanceKm
        ?? workout.distance ?? workout.distanceKm) || 0,
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
        validationStatus: 'REJECTED', auditStatus: 'REJECTED', score: 0,
        invalidatedAt: new Date().toISOString(),
      }, { merge: true });
    } else if (context.type === 'paid_championship') {
      batch.set(db.collection('championship_scores').doc(`${activityId}_${context.id}`), {
        validationStatus: 'REJECTED', score: 0,
        invalidatedAt: new Date().toISOString(),
      }, { merge: true });
    }
  }
  await batch.commit();
}

export async function getCommunityGymChampionshipStatus(userId: string, now = new Date()) {
  const [userSnap, configSnap] = await Promise.all([
    db.collection('users').doc(userId).get(),
    db.collection('gym_championship_config').doc('global').get(),
  ]);
  const user = userSnap.data() || {};
  const config = configSnap.data() || {};
  const gymId = String(user.gymId || user.academyId || 'community_global');
  const cycleKey = communityCycleKey(now);
  const snap = await db.collection('gym_championship_scores').where('cycleKey', '==', cycleKey).get();
  const totals = new Map<string, { userId: string; userName: string; score: number; validActivities: number }>();
  snap.forEach(doc => {
    const data: any = doc.data();
    if (data.gymId !== gymId || data.validationStatus !== 'VALIDATED') return;
    const item = totals.get(data.userId) || { userId: data.userId, userName: data.userName || 'Atleta Invictus', score: 0, validActivities: 0 };
    item.score += Math.max(0, Number(data.score) || 0);
    item.validActivities += 1;
    totals.set(data.userId, item);
  });
  const leaderboard = [...totals.values()].sort((a, b) => b.score - a.score || a.userId.localeCompare(b.userId));
  const rankIndex = leaderboard.findIndex(item => item.userId === userId);
  const resultSnap = await db.collection('gym_championship_results').doc(`${cycleKey}_${gymId}_${userId}`).get();
  return {
    cycleKey, gymId, gymName: String(user.gymName || 'Comunidade Invictus'),
    rank: rankIndex >= 0 ? rankIndex + 1 : null,
    score: rankIndex >= 0 ? leaderboard[rankIndex].score : 0,
    validActivities: rankIndex >= 0 ? leaderboard[rankIndex].validActivities : 0,
    leaderboard: leaderboard.slice(0, 10),
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
  resultId: string; decision: 'APPROVED' | 'REJECTED'; reviewerId: string; reason: string;
}) {
  const ref = db.collection('gym_championship_results').doc(params.resultId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('Resultado de campeonato não encontrado.');
  const result: any = snap.data();
  if (result.status !== 'REVIEW') throw new Error('Somente resultados em revisão podem receber decisão manual.');
  if (params.decision === 'APPROVED') {
    await RewardCoinEngine.credit({
      userId: result.userId, amount: Math.max(0, Number(result.prizeCoins) || 0), origin: 'championship', ledgerType: 'GYM_CHAMPIONSHIP_PODIUM',
      description: `${result.rank}º lugar no Campeonato da Academia ${result.cycleKey}`,
      idempotencyKey: `gym-championship:${result.cycleKey}:${result.gymId}:${result.userId}:podium:${result.rank}`,
    });
  }
  await ref.set({
    status: params.decision,
    manualReview: { reviewerId: params.reviewerId, reason: params.reason, decidedAt: new Date().toISOString() },
    ...(params.decision === 'APPROVED' ? { paidAt: new Date().toISOString() } : { rejectedAt: new Date().toISOString() }),
    updatedAt: new Date().toISOString(),
  }, { merge: true });
  return { resultId: params.resultId, status: params.decision };
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
  if (pendingEntries.length > 0) {
    throw new Error(`O ciclo ${cycleKey} ainda possui ${pendingEntries.length} atividade(s) competitiva(s) em análise.`);
  }
  const config = configSnap.data() || {};
  const prizes = {
    1: Math.max(0, Number(config.top1Prize) || 2500),
    2: Math.max(0, Number(config.top2Prize) || 1500),
    3: Math.max(0, Number(config.top3Prize) || 1000),
    participation: Math.max(0, Number(config.participationPrize) || 50),
  } as Record<number | 'participation', number>;
  const grouped = new Map<string, Map<string, { userId: string; userName: string; score: number; risks: number[]; validActivities: number }>>();
  scoresSnap.forEach(doc => {
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
  let payouts = 0;
  let reviews = 0;
  for (const [gymId, athletesMap] of grouped) {
    const athletes = [...athletesMap.values()].sort((a, b) => b.score - a.score || a.userId.localeCompare(b.userId));
    for (const athlete of athletes) {
      await RewardCoinEngine.credit({
        userId: athlete.userId, amount: prizes.participation, origin: 'championship', ledgerType: 'GYM_CHAMPIONSHIP_PARTICIPATION',
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
        cycleKey, gymId, userId: athlete.userId, userName: athlete.userName, rank, score: athlete.score,
        status, provisionalAt: new Date().toISOString(),
        enhancedAudit: { status, maxRiskScore: maxRisk, activitiesAudited: athlete.validActivities, evaluatedAt: new Date().toISOString() },
        prizeCoins: prizes[rank], updatedAt: new Date().toISOString(),
      }, { merge: true });
      if (status === 'REVIEW') { reviews += 1; continue; }
      await RewardCoinEngine.credit({
        userId: athlete.userId, amount: prizes[rank], origin: 'championship', ledgerType: 'GYM_CHAMPIONSHIP_PODIUM',
        description: `${rank}º lugar no Campeonato da Academia ${cycleKey}`,
        idempotencyKey: `gym-championship:${cycleKey}:${gymId}:${athlete.userId}:podium:${rank}`,
      });
      await resultRef.set({ status: 'APPROVED', paidAt: new Date().toISOString() }, { merge: true });
      payouts += 1;
    }
  }
  return { gyms: grouped.size, payouts, reviews };
}

export async function getChampionshipProgress(championshipId: string, userId: string) {
  const snap = await db.collection('championship_scores')
    .where('championshipId', '==', championshipId)
    .get();

  let totalScore = 0;
  let totalTimeMinutes = 0;
  let validSessionsCount = 0;
  snap.forEach((doc) => {
    const d: any = doc.data();
    if (d.userId !== userId || d.validationStatus !== 'VALIDATED') return;
    totalScore += d.score || 0;
    totalTimeMinutes += d.metrics?.durationMinutes || 0;
    validSessionsCount += 1;
  });

  // Rank: posicao do usuario entre todos os participantes, ordenado por
  // pontuacao total (mesma soma acima, aplicada a cada usuario).
  const leaderboard = await getChampionshipLeaderboard(championshipId, Number.MAX_SAFE_INTEGER);
  const posicao = leaderboard.findIndex((e) => e.userId === userId);

  return {
    totalScore,
    totalTimeMinutes,
    validSessionsCount,
    currentRank: posicao >= 0 ? posicao + 1 : leaderboard.length + 1,
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

/** Atividades homologadas do proprio usuario neste campeonato, mais recentes primeiro. */
export async function getUserChampionshipActivities(championshipId: string, userId: string, limit = 20): Promise<ChampionshipActivityEntry[]> {
  const snap = await db.collection('championship_scores')
    .where('championshipId', '==', championshipId)
    .get();

  const entradas: ChampionshipActivityEntry[] = [];
  snap.forEach((doc) => {
    const d: any = doc.data();
    if (d.userId !== userId) return;
    entradas.push({
      activityId: d.activityId,
      activityType: d.activityType,
      score: d.score || 0,
      validationStatus: d.validationStatus,
      durationMinutes: d.metrics?.durationMinutes || 0,
      distanceKm: d.metrics?.distanceKm || 0,
      createdAt: d.createdAt,
    });
  });

  return entradas
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit);
}

export interface ChampionshipLeaderboardEntry {
  rank: number;
  userId: string;
  name: string;
  gym: string;
  score: number;
}

export async function getChampionshipLeaderboard(championshipId: string, limit = 50): Promise<ChampionshipLeaderboardEntry[]> {
  const snap = await db.collection('championship_scores')
    .where('championshipId', '==', championshipId)
    .get();

  const porUsuario = new Map<string, { userId: string; name: string; gym: string; score: number }>();
  snap.forEach((doc) => {
    const d: any = doc.data();
    if (d.validationStatus !== 'VALIDATED') return;
    const atual = porUsuario.get(d.userId) || { userId: d.userId, name: d.userName || 'Atleta Invictus', gym: d.userGymName || '-', score: 0 };
    atual.score += d.score || 0;
    porUsuario.set(d.userId, atual);
  });

  return Array.from(porUsuario.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry, index) => ({ rank: index + 1, ...entry }));
}
