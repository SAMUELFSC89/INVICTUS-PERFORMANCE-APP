import { randomUUID } from 'node:crypto';
import { db } from './common.js';
import { listRuntimeChampionships } from './championship-catalog.js';
import { finalizePaidChampionship, type PaidChampionshipRankingEntry } from './paid-championship-settlement.js';
import { creditChampionshipPrize } from './championship-prize-credit.js';
import {
  getLockedChampionshipSnapshot,
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

async function assertResumePreconditions(championship: Championship): Promise<void> {
  const editionId = String(championship.editionId || '');
  if (!editionId) throw new Error('EDITION_ID_MISSING');
  const [registrationSnap, entriesSnap] = await Promise.all([
    db.collection('championship_registrations').where('championshipId', '==', championship.id).get(),
    db.collection('activity_competition_entries').where('contextType', '==', 'paid_championship').get(),
  ]);
  const registrations = registrationSnap.docs
    .map((doc: any) => ({ id: doc.id, ...doc.data() }))
    .filter((registration: any) => String(registration.editionId || '') === editionId);
  const financialReview = registrations.filter(registrationNeedsFinancialReview);
  if (financialReview.length) throw new Error(`FINANCIAL_REVIEW_PENDING:${financialReview.length}`);

  const unresolved = entriesSnap.docs
    .map((doc: any) => doc.data() || {})
    .filter((entry: any) => entry.contextId === championship.id && String(entry.editionId || '') === editionId)
    .filter((entry: any) => !TERMINAL_ACTIVITY_REVIEW.has(String(entry.reviewStatus || '')));
  if (unresolved.length) throw new Error(`ACTIVITY_REVIEW_PENDING:${unresolved.length}`);
}

async function claimLease(settlementRef: any, expectedConfigDigest: string, expectedEditionId: string): Promise<{ token: string; snapshot: Record<string, any> }> {
  const token = randomUUID();
  const now = Date.now();
  return db.runTransaction(async (transaction: any) => {
    const snap = await transaction.get(settlementRef);
    if (!snap.exists) throw new Error('Snapshot de homologação não encontrado.');
    const data = snap.data() || {};
    if (String(data.editionId || '') !== expectedEditionId) throw new Error('SETTLEMENT_EDITION_MISMATCH');
    if (data.status === 'FINALIZED') {
      if (data.configDigest !== expectedConfigDigest) {
        throw new Error('FINALIZED_CONFIG_MISMATCH');
      }
      return { token: '', snapshot: data };
    }
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

async function resumeLockedPaidChampionship(championship: Championship): Promise<Record<string, any>> {
  const championshipId = championship.id;
  const editionId = String(championship.editionId || '');
  const currentConfigDigest = String(championship.publishedConfigDigest || '');
  if (!editionId) throw new Error('Edição oficial sem editionId na retomada.');
  if (!currentConfigDigest) throw new Error('Configuração publicada sem digest na retomada.');

  await assertResumePreconditions(championship);
  const settlementRef = db.collection('championship_settlements').doc(paidChampionshipSettlementDocumentId(editionId));
  const lease = await claimLease(settlementRef, currentConfigDigest, editionId);
  if (lease.snapshot.status === 'FINALIZED') {
    const finalizedAt = String(lease.snapshot.finalizedAt || new Date().toISOString());
    await markPaidChampionshipEditionFinalized(championship, finalizedAt);
    return lease.snapshot;
  }

  const snapshot = lease.snapshot;
  if (String(snapshot.championshipId || '') !== championshipId) throw new Error('SETTLEMENT_CHAMPIONSHIP_MISMATCH');
  const ranking = (Array.isArray(snapshot.ranking) ? snapshot.ranking : []) as PaidChampionshipRankingEntry[];
  const prizes = (Array.isArray(snapshot.prizeDistribution) ? snapshot.prizeDistribution : []) as PrizeRank[];
  if (!ranking.length && Number(snapshot.totalRankedParticipants || 0) > 0) throw new Error('Snapshot congelado perdeu o ranking.');
  if (!prizes.length) throw new Error('Snapshot congelado perdeu a premiação.');

  const assignments: Array<Record<string, any>> = [];
  const ineligibleFinalists: Array<Record<string, any>> = [];
  const unawardedRanks: Array<Record<string, any>> = [];
  let candidateIndex = 0;

  for (const prize of prizes) {
    let assigned = false;
    while (candidateIndex < ranking.length) {
      const frozenIndex = candidateIndex;
      const candidate = ranking[candidateIndex++];
      const payout = await creditChampionshipPrize({
        championshipId,
        editionId,
        championshipTitle: String(snapshot.championshipTitle || championship.title),
        regulationVersion: String(snapshot.regulationVersion || championship.regulationVersion),
        regulationHash: String(snapshot.regulationHash || championship.regulationHash),
        userId: candidate.userId,
        rank: Number(prize.rank),
        amount: money(prize.amount),
      });
      if (payout.ineligible) {
        ineligibleFinalists.push({
          userId: candidate.userId,
          userName: candidate.userName,
          frozenRank: frozenIndex + 1,
          attemptedPrizeRank: Number(prize.rank),
          reason: String(payout.reason || 'PAYOUT_INELIGIBLE'),
        });
        continue;
      }
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
  if (assignments.length > 0) {
    const resultsBatch = db.batch();
    for (const winner of assignments) {
      const resultRef = db.collection('championship_results').doc(`${editionId}_${winner.userId}`);
      resultsBatch.set(resultRef, {
        championshipId,
        editionId,
        championshipTitle: snapshot.championshipTitle || championship.title,
        edition: snapshot.edition || championship.edition,
        userId: winner.userId,
        userName: winner.userName,
        finalRank: winner.rank,
        totalParticipants: Math.max(0, ranking.length - ineligibleFinalists.length),
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
  }

  const totalPaid = money(assignments.reduce((sum, item) => sum + Number(item.amount || 0), 0));
  await db.runTransaction(async (transaction: any) => {
    const current = await transaction.get(settlementRef);
    if (!current.exists) throw new Error('Settlement desapareceu antes da conclusão da retomada.');
    const data = current.data() || {};
    if (data.status === 'FINALIZED') return;
    if (String(data.editionId || '') !== editionId || String(data.championshipId || '') !== championshipId) {
      throw new Error('Identidade do settlement mudou durante a retomada.');
    }
    if (data.executionLeaseToken !== lease.token) throw new Error('Lease do settlement foi perdido durante a retomada.');
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

export async function runPaidChampionshipSettlementSweep(now = new Date()): Promise<{
  finalized: Array<Record<string, any>>;
  blocked: Array<{ championshipId: string; reason: string }>;
  skipped: string[];
}> {
  const finalized: Array<Record<string, any>> = [];
  const blocked: Array<{ championshipId: string; reason: string }> = [];
  const skipped: string[] = [];
  const runtimeChampionships = await listRuntimeChampionships(now);

  for (const configured of runtimeChampionships) {
    try {
      const locked = await getLockedChampionshipSnapshot(configured.id);
      if (!locked?.editionId) {
        skipped.push(configured.id);
        continue;
      }
      if (String(locked.editionId) !== String(configured.editionId)) {
        throw new Error('RUNTIME_EDITION_MISMATCH');
      }
      if (String(locked.publishedConfigDigest || '') !== String(configured.publishedConfigDigest || '')) {
        throw new Error('RUNTIME_CONFIG_DIGEST_MISMATCH');
      }

      const settlementAt = millis(configured.settlementAt);
      if (settlementAt === null || now.getTime() < settlementAt) {
        skipped.push(configured.id);
        continue;
      }

      const settlementRef = db.collection('championship_settlements')
        .doc(paidChampionshipSettlementDocumentId(configured.editionId));
      const existing = await settlementRef.get();
      let result: Record<string, any>;
      if (existing.exists && existing.data()?.status === 'LOCKED') {
        result = await resumeLockedPaidChampionship(configured);
      } else if (existing.exists && existing.data()?.status === 'FINALIZED') {
        const stored = existing.data() || {};
        if (stored.configDigest !== configured.publishedConfigDigest || stored.editionId !== configured.editionId) {
          throw new Error('FINALIZED_CONFIG_MISMATCH');
        }
        await markPaidChampionshipEditionFinalized(configured, String(stored.finalizedAt || new Date().toISOString()));
        result = stored;
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
