import { createHash, randomUUID } from 'node:crypto';
import { db } from './common.js';
import { getChampionship } from './championship-catalog.js';
import { isActiveAccountState } from './account-state.js';
import { creditChampionshipPrize } from './championship-prize-credit.js';
import {
  markPaidChampionshipEditionFinalized,
  paidChampionshipSettlementDocumentId,
} from './paid-championship-edition.js';
import type { Championship, PrizeRank } from '../../src/types/championships.js';

const EXECUTION_LEASE_MS = 5 * 60 * 1000;
const TERMINAL_ACTIVITY_REVIEW = new Set(['approved', 'rejected', 'ineligible']);
const FINANCIAL_REVIEW_EVENTS = new Set([
  'PAYMENT_PARTIALLY_REFUNDED',
  'PAYMENT_REFUND_IN_PROGRESS',
  'PAYMENT_CHARGEBACK_REQUESTED',
  'PAYMENT_CHARGEBACK_DISPUTE',
  'PAYMENT_AWAITING_CHARGEBACK_REVERSAL',
]);

export interface PaidChampionshipRankingEntry {
  userId: string;
  userName: string;
  userGymName: string | null;
  score: number;
  validActivities: number;
  totalTimeMinutes: number;
  finalScoreReachedAt: string;
}

interface WinnerAssignment {
  rank: number;
  userId: string;
  userName: string;
  score: number;
  amount: number;
  transactionId: string;
}

interface IneligibleFinalist {
  userId: string;
  userName: string;
  frozenRank: number;
  attemptedPrizeRank: number;
  reason: string;
}

function millis(value: unknown): number | null {
  if (!value) return null;
  if (typeof (value as any)?.toMillis === 'function') return (value as any).toMillis();
  if (typeof (value as any)?._seconds === 'number') return (value as any)._seconds * 1000;
  if (typeof (value as any)?.seconds === 'number') return (value as any).seconds * 1000;
  const parsed = value instanceof Date ? value.getTime() : Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizedMoney(value: unknown): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function stableDigest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function performanceCompare(a: PaidChampionshipRankingEntry, b: PaidChampionshipRankingEntry): number {
  if (b.score !== a.score) return b.score - a.score;
  if (b.validActivities !== a.validActivities) return b.validActivities - a.validActivities;
  if (b.totalTimeMinutes !== a.totalTimeMinutes) return b.totalTimeMinutes - a.totalTimeMinutes;
  const aFinal = millis(a.finalScoreReachedAt) ?? Number.MAX_SAFE_INTEGER;
  const bFinal = millis(b.finalScoreReachedAt) ?? Number.MAX_SAFE_INTEGER;
  if (aFinal !== bFinal) return aFinal - bFinal;
  return 0;
}

function stableRankingCompare(a: PaidChampionshipRankingEntry, b: PaidChampionshipRankingEntry): number {
  return performanceCompare(a, b)
    || a.userName.localeCompare(b.userName, 'pt-BR', { sensitivity: 'base' })
    || a.userId.localeCompare(b.userId);
}

export function buildPaidChampionshipFinalRanking(params: {
  scores: Array<Record<string, any>>;
  eligibleUserIds: Set<string>;
  approvedActivityIds: Set<string>;
}): PaidChampionshipRankingEntry[] {
  const aggregate = new Map<string, PaidChampionshipRankingEntry>();

  for (const score of params.scores) {
    if (score.validationStatus !== 'VALIDATED') continue;
    const userId = String(score.userId || '');
    const activityId = String(score.activityId || '');
    if (!userId || !activityId || !params.eligibleUserIds.has(userId) || !params.approvedActivityIds.has(activityId)) continue;

    const current = aggregate.get(userId) || {
      userId,
      userName: String(score.userName || 'Atleta Invictus'),
      userGymName: score.userGymName ? String(score.userGymName) : null,
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

    const createdAtMs = millis(score.createdAt);
    const previousMs = millis(current.finalScoreReachedAt);
    if (createdAtMs !== null) {
      if (contribution > 0) {
        if (!hadPositiveScore || previousMs === null || createdAtMs > previousMs) {
          current.finalScoreReachedAt = new Date(createdAtMs).toISOString();
        }
      } else if (!hadPositiveScore && current.score === 0 && (previousMs === null || createdAtMs < previousMs)) {
        current.finalScoreReachedAt = new Date(createdAtMs).toISOString();
      }
    }
    aggregate.set(userId, current);
  }

  return [...aggregate.values()]
    .map((entry) => ({
      ...entry,
      score: Number(entry.score.toFixed(6)),
      totalTimeMinutes: Number(entry.totalTimeMinutes.toFixed(3)),
    }))
    .sort(stableRankingCompare);
}

function validatePrizeDistribution(prizes: PrizeRank[]): PrizeRank[] {
  const normalized = prizes
    .map((item) => ({ ...item, rank: Math.floor(Number(item.rank)), amount: normalizedMoney(item.amount) }))
    .sort((a, b) => a.rank - b.rank);
  if (!normalized.length) throw new Error('Premiação oficial não publicada.');
  const ranks = normalized.map((item) => item.rank);
  if (new Set(ranks).size !== ranks.length) throw new Error('Premiação possui posições duplicadas.');
  for (let index = 0; index < normalized.length; index += 1) {
    if (normalized[index].rank !== index + 1 || normalized[index].amount <= 0) {
      throw new Error('Premiação precisa usar posições contínuas a partir do 1º lugar e valores positivos.');
    }
  }
  return normalized;
}

function hasMaterialPrizeTie(ranking: PaidChampionshipRankingEntry[], prizeCount: number): boolean {
  const boundary = Math.min(ranking.length - 1, prizeCount - 1);
  for (let index = 0; index <= boundary; index += 1) {
    const next = ranking[index + 1];
    if (!next) continue;
    if (performanceCompare(ranking[index], next) === 0) return true;
  }
  return false;
}

function currentConfigDigest(championship: Championship): string {
  const publishedDigest = String(championship.publishedConfigDigest || '').trim();
  if (!publishedDigest) throw new Error('A edição não possui digest de configuração publicado.');
  return publishedDigest;
}

function currentEditionId(championship: Championship): string {
  const editionId = String(championship.editionId || '').trim();
  if (!editionId) throw new Error('A edição não possui identidade imutável publicada.');
  return editionId;
}

async function activeUsers(userIds: string[]): Promise<Set<string>> {
  const unique = [...new Set(userIds.filter(Boolean))];
  if (!unique.length) return new Set();
  const refs = unique.map((uid) => db.collection('users').doc(uid));
  const snaps = await db.getAll(...refs);
  return new Set(snaps.filter((snap: any) => snap.exists && isActiveAccountState(snap.data())).map((snap: any) => snap.id));
}

function registrationNeedsFinancialReview(registration: Record<string, any>): boolean {
  const status = String(registration.status || '');
  const paymentStatus = String(registration.paymentStatus || '');
  const lifecycleEvent = String(registration.paymentLifecycleEvent || '');
  return status === 'contestada'
    || paymentStatus === 'RECONCILIATION_REQUIRED'
    || FINANCIAL_REVIEW_EVENTS.has(paymentStatus)
    || FINANCIAL_REVIEW_EVENTS.has(lifecycleEvent);
}

async function claimExecutionLease(params: {
  settlementRef: any;
  expectedConfigDigest: string;
  expectedRankingDigest: string;
}): Promise<{ token: string; snapshot: Record<string, any> }> {
  const token = randomUUID();
  const now = Date.now();
  return db.runTransaction(async (transaction: any) => {
    const snap = await transaction.get(params.settlementRef);
    if (!snap.exists) throw new Error('Snapshot de homologação desapareceu durante o settlement.');
    const data = snap.data() || {};
    if (data.status === 'FINALIZED') return { token: '', snapshot: data };
    if (data.status !== 'LOCKED') throw new Error('Homologação está em estado incompatível com pagamento.');
    if (data.configDigest !== params.expectedConfigDigest || data.rankingDigest !== params.expectedRankingDigest) {
      throw new Error('Snapshot de homologação divergiu. Operação interrompida.');
    }
    const leaseUntil = Number(data.executionLeaseUntil || 0);
    if (leaseUntil > now) throw new Error('Settlement já está em execução por outro worker.');
    transaction.set(params.settlementRef, {
      executionLeaseToken: token,
      executionLeaseUntil: now + EXECUTION_LEASE_MS,
      executionStartedAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
    }, { merge: true });
    return { token, snapshot: data };
  });
}

async function lockSettlementSnapshot(params: {
  championship: Championship;
  ranking: PaidChampionshipRankingEntry[];
  prizes: PrizeRank[];
  totalPaidRegistrations: number;
}): Promise<Record<string, any>> {
  const editionId = currentEditionId(params.championship);
  const settlementRef = db.collection('championship_settlements')
    .doc(paidChampionshipSettlementDocumentId(editionId));
  const configDigest = currentConfigDigest(params.championship);
  const rankingDigest = stableDigest(params.ranking);
  const now = new Date().toISOString();
  return db.runTransaction(async (transaction: any) => {
    const current = await transaction.get(settlementRef);
    if (current.exists) {
      const data = current.data() || {};
      if (data.editionId !== editionId || data.championshipId !== params.championship.id) {
        throw new Error('Identidade do snapshot de homologação divergiu.');
      }
      if (data.configDigest !== configDigest) {
        throw new Error('A configuração publicada mudou depois do início da homologação.');
      }
      if (data.status === 'FINALIZED') return data;
      if (data.status !== 'LOCKED') throw new Error('Homologação existente está em estado inválido.');
      if (data.rankingDigest !== rankingDigest) {
        throw new Error('O ranking mudou depois de ser congelado. Revisão administrativa obrigatória.');
      }
      return data;
    }

    const snapshot = {
      championshipId: params.championship.id,
      editionId,
      championshipTitle: params.championship.title,
      edition: params.championship.edition,
      status: 'LOCKED',
      regulationVersion: params.championship.regulationVersion,
      regulationHash: params.championship.regulationHash,
      configDigest,
      startAt: params.championship.startAt,
      endAt: params.championship.endAt,
      settlementAt: params.championship.settlementAt,
      prizeDistribution: params.prizes,
      prizePool: normalizedMoney(params.prizes.reduce((sum, prize) => sum + prize.amount, 0)),
      totalPaidRegistrations: params.totalPaidRegistrations,
      totalRankedParticipants: params.ranking.length,
      rankingDigest,
      ranking: params.ranking,
      tieBreakPolicy: ['TOTAL_SCORE_DESC', 'VALID_ACTIVITIES_DESC', 'TOTAL_VALID_MINUTES_DESC', 'FINAL_SCORE_REACHED_AT_ASC'],
      lockedAt: now,
      updatedAt: now,
    };
    transaction.create(settlementRef, snapshot);
    return snapshot;
  });
}

export async function finalizePaidChampionship(
  championshipId: string,
  now = new Date(),
): Promise<Record<string, any>> {
  const championship = getChampionship(championshipId);
  if (!championship) throw new Error('Campeonato oficial não encontrado.');
  const editionId = currentEditionId(championship);
  const endAtMs = millis(championship.endAt);
  const settlementAtMs = millis(championship.settlementAt);
  if (endAtMs === null || settlementAtMs === null || settlementAtMs <= endAtMs) {
    throw new Error('Calendário de homologação inválido.');
  }
  if (now.getTime() < settlementAtMs) {
    return { championshipId, editionId, status: 'NOT_DUE', settlementAt: championship.settlementAt };
  }

  const prizes = validatePrizeDistribution(championship.prizeDistribution || []);
  const [registrationSnap, scoresSnap, entriesSnap] = await Promise.all([
    db.collection('championship_registrations').where('championshipId', '==', championshipId).get(),
    db.collection('championship_scores').where('editionId', '==', editionId).get(),
    db.collection('activity_competition_entries').where('contextType', '==', 'paid_championship').get(),
  ]);

  const registrations = registrationSnap.docs
    .map((doc: any) => ({ id: doc.id, ...doc.data() }))
    .filter((registration: any) => String(registration.editionId || '') === editionId);
  const financialReview = registrations.filter(registrationNeedsFinancialReview);
  if (financialReview.length) {
    throw new Error(`FINANCIAL_REVIEW_PENDING:${financialReview.length}`);
  }

  const paidRegistrations = registrations.filter((registration: any) => registration.status === 'paga' && registration.paymentStatus === 'PAID');
  const mismatchedRegulation = paidRegistrations.filter((registration: any) => (
    registration.regulationVersion !== championship.regulationVersion
    || registration.regulationHash !== championship.regulationHash
  ));
  if (mismatchedRegulation.length) {
    throw new Error(`PAID_REGULATION_MISMATCH:${mismatchedRegulation.length}`);
  }

  const championshipEntries = entriesSnap.docs
    .map((doc: any) => ({ id: doc.id, ...doc.data() }))
    .filter((entry: any) => entry.contextId === championshipId && String(entry.editionId || '') === editionId);
  const unresolvedEntries = championshipEntries.filter((entry: any) => !TERMINAL_ACTIVITY_REVIEW.has(String(entry.reviewStatus || '')));
  if (unresolvedEntries.length) {
    throw new Error(`ACTIVITY_REVIEW_PENDING:${unresolvedEntries.length}`);
  }

  const approvedEntries = championshipEntries.filter((entry: any) => entry.reviewStatus === 'approved');
  const approvedActivityIds = new Set(approvedEntries.map((entry: any) => String(entry.activityId || '')).filter(Boolean));
  const scores = scoresSnap.docs
    .map((doc: any) => ({ id: doc.id, ...doc.data() }))
    .filter((score: any) => String(score.editionId || '') === editionId && String(score.championshipId || '') === championshipId);
  const validScoreActivityIds = new Set(
    scores.filter((score: any) => score.validationStatus === 'VALIDATED').map((score: any) => String(score.activityId || '')).filter(Boolean)
  );
  const missingScores = [...approvedActivityIds].filter((activityId) => !validScoreActivityIds.has(activityId));
  const orphanScores = [...validScoreActivityIds].filter((activityId) => !approvedActivityIds.has(activityId));
  if (missingScores.length || orphanScores.length) {
    throw new Error(`COMPETITION_DATA_MISMATCH:missing=${missingScores.length},orphan=${orphanScores.length}`);
  }

  const paidUserIds = paidRegistrations.map((registration: any) => String(registration.userId || '')).filter(Boolean);
  const activePaidUserIds = await activeUsers(paidUserIds);
  const ranking = buildPaidChampionshipFinalRanking({ scores, eligibleUserIds: activePaidUserIds, approvedActivityIds });
  if (hasMaterialPrizeTie(ranking, prizes.length)) {
    throw new Error('UNRESOLVED_PRIZE_TIE');
  }

  const snapshot = await lockSettlementSnapshot({
    championship,
    ranking,
    prizes,
    totalPaidRegistrations: paidRegistrations.length,
  });
  if (snapshot.status === 'FINALIZED') {
    const finalizedAt = String(snapshot.finalizedAt || new Date().toISOString());
    await markPaidChampionshipEditionFinalized(championship, finalizedAt);
    return snapshot;
  }

  const settlementRef = db.collection('championship_settlements')
    .doc(paidChampionshipSettlementDocumentId(editionId));
  const rankingDigest = String(snapshot.rankingDigest || stableDigest(ranking));
  const frozenRanking = (Array.isArray(snapshot.ranking) ? snapshot.ranking : ranking) as PaidChampionshipRankingEntry[];
  const frozenPrizes = (Array.isArray(snapshot.prizeDistribution) ? snapshot.prizeDistribution : prizes) as PrizeRank[];
  const lease = await claimExecutionLease({
    settlementRef,
    expectedConfigDigest: currentConfigDigest(championship),
    expectedRankingDigest: rankingDigest,
  });
  if (lease.snapshot.status === 'FINALIZED') {
    const finalizedAt = String(lease.snapshot.finalizedAt || new Date().toISOString());
    await markPaidChampionshipEditionFinalized(championship, finalizedAt);
    return lease.snapshot;
  }

  const assignments: WinnerAssignment[] = [];
  const ineligibleFinalists: IneligibleFinalist[] = [];
  const unawardedRanks: Array<{ rank: number; amount: number; reason: string }> = [];
  let candidateIndex = 0;

  for (const prize of frozenPrizes) {
    let assigned = false;
    while (candidateIndex < frozenRanking.length) {
      const frozenIndex = candidateIndex;
      const candidate = frozenRanking[candidateIndex++];
      const payout = await creditChampionshipPrize({
        championshipId,
        editionId,
        championshipTitle: championship.title,
        regulationVersion: championship.regulationVersion,
        regulationHash: championship.regulationHash,
        userId: candidate.userId,
        rank: prize.rank,
        amount: prize.amount,
      });
      if (payout.ineligible) {
        ineligibleFinalists.push({
          userId: candidate.userId,
          userName: candidate.userName,
          frozenRank: frozenIndex + 1,
          attemptedPrizeRank: prize.rank,
          reason: String(payout.reason || 'PAYOUT_INELIGIBLE'),
        });
        continue;
      }
      assignments.push({
        rank: prize.rank,
        userId: candidate.userId,
        userName: candidate.userName,
        score: candidate.score,
        amount: normalizedMoney(prize.amount),
        transactionId: payout.transactionId,
      });
      assigned = true;
      break;
    }
    if (!assigned) {
      unawardedRanks.push({ rank: prize.rank, amount: normalizedMoney(prize.amount), reason: 'NO_ELIGIBLE_FINALIST' });
    }
  }

  const finalizedAt = new Date().toISOString();
  const totalPaid = normalizedMoney(assignments.reduce((sum, item) => sum + item.amount, 0));
  if (assignments.length > 0) {
    const resultsBatch = db.batch();
    for (const winner of assignments) {
      const resultRef = db.collection('championship_results').doc(`${editionId}_${winner.userId}`);
      resultsBatch.set(resultRef, {
        championshipId,
        editionId,
        championshipTitle: championship.title,
        edition: championship.edition,
        userId: winner.userId,
        userName: winner.userName,
        finalRank: winner.rank,
        totalParticipants: frozenRanking.length - ineligibleFinalists.length,
        finalScore: winner.score,
        prizeWon: winner.amount,
        payoutTransactionId: winner.transactionId,
        status: 'finalized',
        regulationVersion: championship.regulationVersion,
        regulationHash: championship.regulationHash,
        configDigest: currentConfigDigest(championship),
        homologatedAt: finalizedAt,
      }, { merge: true });
    }
    await resultsBatch.commit();
  }

  await db.runTransaction(async (transaction: any) => {
    const current = await transaction.get(settlementRef);
    if (!current.exists) throw new Error('Settlement desapareceu antes da finalização.');
    const data = current.data() || {};
    if (data.status === 'FINALIZED') return;
    if (data.editionId !== editionId || data.championshipId !== championshipId) {
      throw new Error('Identidade do settlement mudou durante a execução.');
    }
    if (data.executionLeaseToken !== lease.token) throw new Error('Lease do settlement foi perdido durante a execução.');
    transaction.set(settlementRef, {
      status: 'FINALIZED',
      winnerAssignments: assignments,
      ineligibleFinalists,
      unawardedRanks,
      totalPaid,
      finalizedAt,
      executionLeaseToken: null,
      executionLeaseUntil: 0,
      updatedAt: finalizedAt,
    }, { merge: true });
  });

  await markPaidChampionshipEditionFinalized(championship, finalizedAt);
  const finalSnap = await settlementRef.get();
  return finalSnap.data() || { championshipId, editionId, status: 'FINALIZED', winnerAssignments: assignments, ineligibleFinalists, totalPaid };
}
