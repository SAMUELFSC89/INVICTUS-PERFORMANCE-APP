import { randomUUID } from 'node:crypto';
import { db } from './common.js';
import { CHAMPIONSHIPS, getChampionship } from './championship-catalog.js';
import { finalizePaidChampionship, type PaidChampionshipRankingEntry } from './paid-championship-settlement.js';
import { creditChampionshipPrize } from './championship-prize-credit.js';
import type { PrizeRank } from '../../src/types/championships.js';

const EXECUTION_LEASE_MS = 5 * 60 * 1000;
const TERMINAL_ACTIVITY_REVIEW = new Set(['approved', 'rejected', 'ineligible']);
const FINANCIAL_REVIEW_EVENTS = new Set([
  'PAYMENT_PARTIALLY_REFUNDED',
  'PAYMENT_REFUND_IN_PROGRESS',
  'PAYMENT_CHARGEBACK_REQUESTED',
  'PAYMENT_CHARGEBACK_DISPUTE',
  'PAYMENT_AWAITING_CHARGEBACK_REVERSAL',
]);

function millis(value: unknown): number | null {
  if (!value) return null;
  if (typeof (value as any)?.toMillis === 'function') return (value as any).toMillis();
  if (typeof (value as any)?._seconds === 'number') return (value as any)._seconds * 1000;
  if (typeof (value as any)?.seconds === 'number') return (value as any).seconds * 1000;
  const parsed = value instanceof Date ? value.getTime() : Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function money(value: unknown): number {
  return Math.round((Number(value) || 0) * 100) / 100;
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

async function assertResumePreconditions(championshipId: string): Promise<void> {
  const [registrationSnap, entriesSnap] = await Promise.all([
    db.collection('championship_registrations').where('championshipId', '==', championshipId).get(),
    db.collection('activity_competition_entries').where('contextType', '==', 'paid_championship').get(),
  ]);
  const registrations = registrationSnap.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }));
  const financialReview = registrations.filter(registrationNeedsFinancialReview);
  if (financialReview.length) throw new Error(`FINANCIAL_REVIEW_PENDING:${financialReview.length}`);

  const unresolved = entriesSnap.docs
    .map((doc: any) => doc.data() || {})
    .filter((entry: any) => entry.contextId === championshipId)
    .filter((entry: any) => !TERMINAL_ACTIVITY_REVIEW.has(String(entry.reviewStatus || '')));
  if (unresolved.length) throw new Error(`ACTIVITY_REVIEW_PENDING:${unresolved.length}`);
}

async function claimLease(settlementRef: any, expectedConfigDigest: string): Promise<{ token: string; snapshot: Record<string, any> }> {
  const token = randomUUID();
  const now = Date.now();
  return db.runTransaction(async (transaction: any) => {
    const snap = await transaction.get(settlementRef);
    if (!snap.exists) throw new Error('Snapshot de homologação não encontrado.');
    const data = snap.data() || {};
    if (data.status === 'FINALIZED') return { token: '', snapshot: data };
    if (data.status !== 'LOCKED') throw new Error('Homologação está em estado incompatível com retomada.');
    if (data.configDigest !== expectedConfigDigest) {
      throw new Error('A configuração publicada divergiu do snapshot congelado.');
    }
    const leaseUntil = Number(data.executionLeaseUntil || 0);
    if (leaseUntil > now) throw new Error('Settlement já está em execução por outro worker.');
    transaction.set(settlementRef, {
      executionLeaseToken: token,
      executionLeaseUntil: now + EXECUTION_LEASE_MS,
      executionStartedAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
    }, { merge: true });
    return { token, snapshot: data };
  });
}

async function resumeLockedPaidChampionship(championshipId: string): Promise<Record<string, any>> {
  const championship = getChampionship(championshipId);
  if (!championship) throw new Error('Campeonato oficial não encontrado na retomada.');
  const currentConfigDigest = String(championship.publishedConfigDigest || '');
  if (!currentConfigDigest) throw new Error('Configuração publicada sem digest na retomada.');

  await assertResumePreconditions(championshipId);
  const settlementRef = db.collection('championship_settlements').doc(championshipId);
  const lease = await claimLease(settlementRef, currentConfigDigest);
  if (lease.snapshot.status === 'FINALIZED') return lease.snapshot;

  const snapshot = lease.snapshot;
  const ranking = (Array.isArray(snapshot.ranking) ? snapshot.ranking : []) as PaidChampionshipRankingEntry[];
  const prizes = (Array.isArray(snapshot.prizeDistribution) ? snapshot.prizeDistribution : []) as PrizeRank[];
  if (!ranking.length && Number(snapshot.totalRankedParticipants || 0) > 0) throw new Error('Snapshot congelado perdeu o ranking.');
  if (!prizes.length) throw new Error('Snapshot congelado perdeu a premiação.');

  const assignments: Array<Record<string, any>> = [];
  const unawardedRanks: Array<Record<string, any>> = [];
  let candidateIndex = 0;

  for (const prize of prizes) {
    let assigned = false;
    while (candidateIndex < ranking.length) {
      const candidate = ranking[candidateIndex++];
      const payout = await creditChampionshipPrize({
        championshipId,
        championshipTitle: String(snapshot.championshipTitle || championship.title),
        regulationVersion: String(snapshot.regulationVersion || championship.regulationVersion),
        regulationHash: String(snapshot.regulationHash || championship.regulationHash),
        userId: candidate.userId,
        rank: Number(prize.rank),
        amount: money(prize.amount),
      });
      if (payout.ineligible) continue;
      assignments.push({
        rank: Number(prize.rank),
        userId: candidate.userId,
        userName: candidate.userName,
        score: candidate.score,
        amount: money(prize.amount),
        transactionId: payout.transactionId,
      });
      assigned = true;
      break;
    }
    if (!assigned) {
      unawardedRanks.push({ rank: Number(prize.rank), amount: money(prize.amount), reason: 'NO_ELIGIBLE_FINALIST' });
    }
  }

  const finalizedAt = new Date().toISOString();
  const resultsBatch = db.batch();
  for (const winner of assignments) {
    const resultRef = db.collection('championship_results').doc(`${championshipId}_${winner.userId}`);
    resultsBatch.set(resultRef, {
      championshipId,
      championshipTitle: snapshot.championshipTitle || championship.title,
      edition: snapshot.edition || championship.edition,
      userId: winner.userId,
      userName: winner.userName,
      finalRank: winner.rank,
      totalParticipants: ranking.length,
      finalScore: winner.score,
      prizeWon: winner.amount,
      payoutTransactionId: winner.transactionId,
      status: 'finalized',
      regulationVersion: snapshot.regulationVersion,
      regulationHash: snapshot.regulationHash,
      configDigest: snapshot.configDigest,
      homologatedAt: finalizedAt,
    }, { merge: true });
  }
  await resultsBatch.commit();

  const totalPaid = money(assignments.reduce((sum, item) => sum + Number(item.amount || 0), 0));
  await db.runTransaction(async (transaction: any) => {
    const current = await transaction.get(settlementRef);
    if (!current.exists) throw new Error('Settlement desapareceu antes da conclusão da retomada.');
    const data = current.data() || {};
    if (data.status === 'FINALIZED') return;
    if (data.executionLeaseToken !== lease.token) throw new Error('Lease do settlement foi perdido durante a retomada.');
    transaction.set(settlementRef, {
      status: 'FINALIZED',
      winnerAssignments: assignments,
      unawardedRanks,
      totalPaid,
      finalizedAt,
      executionLeaseToken: null,
      executionLeaseUntil: 0,
      updatedAt: finalizedAt,
    }, { merge: true });
  });

  const finalSnap = await settlementRef.get();
  return finalSnap.data() || { championshipId, status: 'FINALIZED', winnerAssignments: assignments, totalPaid };
}

export async function runPaidChampionshipSettlementSweep(now = new Date()): Promise<{
  finalized: Array<Record<string, any>>;
  blocked: Array<{ championshipId: string; reason: string }>;
  skipped: string[];
}> {
  const finalized: Array<Record<string, any>> = [];
  const blocked: Array<{ championshipId: string; reason: string }> = [];
  const skipped: string[] = [];

  for (const configured of CHAMPIONSHIPS) {
    const settlementAt = millis(configured.settlementAt);
    if (settlementAt === null || now.getTime() < settlementAt) {
      skipped.push(configured.id);
      continue;
    }

    try {
      const settlementRef = db.collection('championship_settlements').doc(configured.id);
      const existing = await settlementRef.get();
      let result: Record<string, any>;
      if (existing.exists && existing.data()?.status === 'LOCKED') {
        result = await resumeLockedPaidChampionship(configured.id);
      } else if (existing.exists && existing.data()?.status === 'FINALIZED') {
        result = existing.data() || { championshipId: configured.id, status: 'FINALIZED' };
      } else {
        result = await finalizePaidChampionship(configured.id, now);
      }
      if (result.status === 'FINALIZED') finalized.push(result);
      else skipped.push(configured.id);
    } catch (error) {
      blocked.push({ championshipId: configured.id, reason: error instanceof Error ? error.message : 'UNKNOWN_SETTLEMENT_ERROR' });
    }
  }

  return { finalized, blocked, skipped };
}
