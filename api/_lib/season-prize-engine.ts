import { startOfMonth, addMonths } from 'date-fns';
import { db, FieldValue } from './common.js';
import { RewardsEngine } from './rewards-engine.js';
import { lerConfiguracaoInscricao } from './season-settings.js';
import { isProUser } from './entitlement.js';
import { isActiveAccountState } from './account-state.js';
import {
  SEASON_MIN_PARTICIPANTS_PER_GYM,
  SEASON_TOP5_THRESHOLD_PER_GYM,
  TOP_10_PERCENTAGES,
} from './season-constants.js';

export interface SeasonWindow {
  seasonId: string;
  startDate: Date;
  endDate: Date;
}

export interface SeasonWinner {
  userId: string;
  gymId: string;
  rank: number;
  prizeAmount: number;
  /** Compatibilidade do payload histórico: o valor vem do score canônico da temporada. */
  monthlyScore: number;
}

export interface ResultadoAcademia {
  gymId: string;
  participantsCount: number;
  grossRevenue: number;
  prizePool: number;
  futureReserve: number;
  winnerCount: number;
  winners: SeasonWinner[];
}

export interface SeasonPayoutResult {
  seasonId: string;
  alreadyDistributed: boolean;
  participantsCount: number;
  grossRevenue: number;
  prizePool: number;
  futureReserve: number;
  winnerCount: number;
  winners: SeasonWinner[];
  academias: ResultadoAcademia[];
}

function seasonIdFor(startDate: Date): string {
  return `season_${startDate.toISOString().slice(0, 7)}`;
}

function seasonWindowForMonth(reference: Date): SeasonWindow {
  const startDate = startOfMonth(reference);
  const endDate = startOfMonth(addMonths(startDate, 1));
  return { seasonId: seasonIdFor(startDate), startDate, endDate };
}

function isAlignedToFirstOfMonth(d: Date): boolean {
  return d.getDate() === 1 && d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0;
}

export function calcularProximaJanela(atual: SeasonWindow): SeasonWindow {
  const referencia = isAlignedToFirstOfMonth(atual.endDate)
    ? atual.endDate
    : startOfMonth(addMonths(atual.endDate, 1));
  return seasonWindowForMonth(referencia);
}

export async function getOrInitCurrentSeasonWindow(): Promise<SeasonWindow> {
  const ref = db.collection('system_config').doc('season_tracker');
  const snap = await ref.get();
  if (snap.exists) {
    const data: any = snap.data();
    return {
      seasonId: data.seasonId,
      startDate: new Date(data.startDate),
      endDate: new Date(data.endDate),
    };
  }

  const window = seasonWindowForMonth(new Date());
  await ref.set({
    seasonId: window.seasonId,
    startDate: window.startDate.toISOString(),
    endDate: window.endDate.toISOString(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return window;
}

async function activeUserIdSet(userIds: string[]): Promise<Set<string>> {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return new Set();
  const refs = ids.map((id) => db.collection('users').doc(id));
  const snapshots = await db.getAll(...refs);
  return new Set(
    snapshots
      .filter((snap: any) => snap.exists && isActiveAccountState(snap.data()))
      .map((snap: any) => snap.id),
  );
}

async function promoverInscritosDaNovaTemporada(novaSeasonId: string) {
  const inscritos = await db.collection('season_inscriptions')
    .where('seasonId', '==', novaSeasonId)
    .where('status', '==', 'paga')
    .get();

  const candidatos = inscritos.docs
    .map((doc: any) => String(doc.data()?.userId || ''))
    .filter(Boolean);
  // Gate 1: pagamento antigo nunca reativa conta bloqueada/excluída na virada.
  const entrando = await activeUserIdSet(candidatos);

  const marcados = await db.collection('users')
    .where('seasonStatus', 'in', ['ACTIVE', 'WAITING_NEXT_SEASON'])
    .get();

  let batch = db.batch();
  let count = 0;
  const queue = async (ref: FirebaseFirestore.DocumentReference, data: any) => {
    batch.set(ref, data, { merge: true });
    count += 1;
    if (count >= 400) {
      await batch.commit();
      batch = db.batch();
      count = 0;
    }
  };

  for (const doc of marcados.docs) {
    if (entrando.has(doc.id)) continue;
    await queue(doc.ref, { seasonStatus: 'NOT_ENROLLED', nextSeasonStart: '' });
  }
  for (const userId of entrando) {
    await queue(db.collection('users').doc(userId), {
      seasonStatus: 'ACTIVE',
      seasonInscritaId: novaSeasonId,
      nextSeasonStart: '',
    });
  }
  if (count > 0) await batch.commit();
  console.log(`[Temporada] ${entrando.size} atletas ativos na temporada ${novaSeasonId}.`);
}

async function advanceToNextSeasonWindow(previous: SeasonWindow): Promise<SeasonWindow> {
  const next = calcularProximaJanela(previous);
  const ref = db.collection('system_config').doc('season_tracker');
  await ref.set({
    seasonId: next.seasonId,
    startDate: next.startDate.toISOString(),
    endDate: next.endDate.toISOString(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  await promoverInscritosDaNovaTemporada(next.seasonId);
  return next;
}

export function getWinnerCountPorAcademia(participantsCount: number): number {
  if (participantsCount < SEASON_MIN_PARTICIPANTS_PER_GYM) return 0;
  const ceiling = participantsCount >= SEASON_TOP5_THRESHOLD_PER_GYM ? 5 : 3;
  return Math.min(ceiling, participantsCount);
}

function normalizedPercentages(n: number): number[] {
  const raw = TOP_10_PERCENTAGES.slice(0, n);
  const sum = raw.reduce((a: number, b: number) => a + b, 0);
  return raw.map((p: number) => p / sum);
}

const COLECAO_PAGAMENTOS = 'payment_orders';

async function buscarPagamentosAprovados(startDate: Date, endDate: Date) {
  const snap = await db.collection(COLECAO_PAGAMENTOS)
    .where('status', '==', 'approved')
    .where('paidAt', '>=', startDate.toISOString())
    .where('paidAt', '<', endDate.toISOString())
    .get();
  return snap.docs;
}

export async function computeSeasonRevenue(startDate: Date, endDate: Date): Promise<number> {
  const docs = await buscarPagamentosAprovados(startDate, endDate);
  let total = 0;
  docs.forEach((doc: any) => {
    const amount = doc.data().amount;
    if (typeof amount === 'number' && amount > 0) total += amount;
  });
  return total;
}

export async function computeSeasonRevenueByGym(seasonId: string): Promise<Map<string, number>> {
  const snap = await db.collection('season_inscriptions')
    .where('seasonId', '==', seasonId)
    .where('status', '==', 'paga')
    .limit(2000)
    .get();

  // Receita já paga continua compondo o pote mesmo se o atleta ficar inativo
  // depois. Inatividade remove o atleta da disputa; não apaga dinheiro já
  // arrecadado. Reembolso, quando aplicável, deve ser tratado explicitamente.
  const byGym = new Map<string, number>();
  snap.docs.forEach((doc: any) => {
    const data = doc.data() || {};
    const gymId = String(data.gymId || '');
    const value = typeof data.valorPago === 'number' ? data.valorPago : data.valor;
    if (!gymId || typeof value !== 'number' || value <= 0) return;
    byGym.set(gymId, (byGym.get(gymId) || 0) + value);
  });
  return byGym;
}

/**
 * O nome `monthlyScore` no retorno é mantido por compatibilidade com consumidores
 * antigos, mas a fonte competitiva correta é `users.score`: o IGA da temporada
 * apontada pelo season_tracker. Na virada do mês, monthlyScore já pode representar
 * o mês novo antes do cron de payout rodar; score ainda representa a temporada
 * encerrada até o tracker avançar.
 */
export async function getSeasonParticipants(): Promise<Array<{ id: string; monthlyScore: number }>> {
  const snap = await db.collection('users')
    .where('score', '>', 0)
    .orderBy('score', 'desc')
    .limit(2000)
    .get();

  return snap.docs
    .filter((doc: any) => isProUser(doc.data()) && isActiveAccountState(doc.data()))
    .map((doc: any) => ({ id: doc.id, monthlyScore: Number(doc.data().score) || 0 }));
}

async function lerAcademiasCongeladas(seasonId: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const snap = await db.collection('season_inscriptions')
      .where('seasonId', '==', seasonId)
      .where('status', '==', 'paga')
      .limit(2000)
      .get();
    const docs = snap.docs.map((doc: any) => doc.data() || {});
    const activeIds = await activeUserIdSet(docs.map((data: any) => String(data.userId || '')));
    for (const data of docs as any[]) {
      const userId = String(data.userId || '');
      const gymId = String(data.gymId || '');
      if (activeIds.has(userId) && gymId) map.set(userId, gymId);
    }
  } catch (error: any) {
    console.error('[Season Prize Engine] nao foi possivel ler season_inscriptions:', error?.message);
  }
  return map;
}

export async function getSeasonParticipantsByGym(seasonId: string): Promise<Map<string, Array<{ id: string; monthlyScore: number }>>> {
  const snap = await db.collection('users')
    .where('score', '>', 0)
    .orderBy('score', 'desc')
    .limit(2000)
    .get();

  const frozenGym = await lerAcademiasCongeladas(seasonId);
  if (frozenGym.size === 0) {
    console.warn(`[Season Prize Engine] Nenhuma inscricao paga elegivel na temporada ${seasonId}. Ninguem concorre.`);
  }

  const byGym = new Map<string, Array<{ id: string; monthlyScore: number }>>();
  snap.docs.forEach((doc: any) => {
    const data = doc.data() || {};
    // Gate 1: conta inativa não ocupa posição nem reduz prêmio de atleta elegível.
    if (!isActiveAccountState(data)) return;
    const gymId = frozenGym.get(doc.id);
    if (!gymId) return;
    const list = byGym.get(gymId) || [];
    list.push({ id: doc.id, monthlyScore: Number(data.score) || 0 });
    byGym.set(gymId, list);
  });
  byGym.forEach((list) => list.sort((a, b) => b.monthlyScore - a.monthlyScore || a.id.localeCompare(b.id)));
  return byGym;
}

function payoutResultFromStored(seasonId: string, data: any, alreadyDistributed: boolean): SeasonPayoutResult {
  if (data?.seasonId !== seasonId || !Array.isArray(data?.winners) || !Array.isArray(data?.academias)) {
    throw new Error('Plano de premiacao da temporada invalido ou inconsistente.');
  }
  return {
    seasonId,
    alreadyDistributed,
    participantsCount: Number(data.participantsCount) || 0,
    grossRevenue: Number(data.grossRevenue) || 0,
    prizePool: Number(data.prizePool) || 0,
    futureReserve: Number(data.futureReserve) || 0,
    winnerCount: Number(data.winnerCount) || 0,
    winners: data.winners as SeasonWinner[],
    academias: data.academias as ResultadoAcademia[],
  };
}

async function buildSeasonPayoutPlan(season: SeasonWindow): Promise<SeasonPayoutResult> {
  const [revenueByGym, participantsByGym, config] = await Promise.all([
    computeSeasonRevenueByGym(season.seasonId),
    getSeasonParticipantsByGym(season.seasonId),
    lerConfiguracaoInscricao(),
  ]);
  const poolPercentage = config.percentualPote;
  const academias: ResultadoAcademia[] = [];
  const allWinners: SeasonWinner[] = [];
  const gymIds = new Set<string>([...participantsByGym.keys(), ...revenueByGym.keys()]);

  for (const gymId of gymIds) {
    const participants = participantsByGym.get(gymId) || [];
    const revenue = revenueByGym.get(gymId) || 0;
    const participantsCount = participants.length;
    const winnerCount = getWinnerCountPorAcademia(participantsCount);
    const prizePool = Math.round(revenue * poolPercentage * 100) / 100;
    const futureReserve = 0;
    const winners: SeasonWinner[] = [];

    if (winnerCount > 0 && prizePool > 0) {
      const percentages = normalizedPercentages(winnerCount);
      participants.slice(0, winnerCount).forEach((participant, index) => {
        winners.push({
          userId: participant.id,
          gymId,
          rank: index + 1,
          prizeAmount: Math.round(prizePool * percentages[index] * 100) / 100,
          monthlyScore: participant.monthlyScore,
        });
      });
    }

    academias.push({ gymId, participantsCount, grossRevenue: revenue, prizePool, futureReserve, winnerCount, winners });
    allWinners.push(...winners);
  }

  const sum = (field: keyof ResultadoAcademia) =>
    Math.round(academias.reduce((total, item) => total + Number(item[field] || 0), 0) * 100) / 100;
  return {
    seasonId: season.seasonId,
    alreadyDistributed: false,
    participantsCount: academias.reduce((total, item) => total + item.participantsCount, 0),
    grossRevenue: sum('grossRevenue'),
    prizePool: sum('prizePool'),
    futureReserve: sum('futureReserve'),
    winnerCount: allWinners.length,
    winners: allWinners,
    academias,
  };
}

export async function distributeSeasonPrizes(season: SeasonWindow): Promise<SeasonPayoutResult> {
  const payoutRef = db.collection('season_payouts').doc(season.seasonId);
  const firstSnapshot = await payoutRef.get();
  if (firstSnapshot.exists) {
    const stored: any = firstSnapshot.data() || {};
    if (stored.distributedAt || stored.status === 'DISTRIBUTED') {
      return payoutResultFromStored(season.seasonId, stored, true);
    }
    if (stored.status !== 'PROCESSING') {
      throw new Error('Premiacao existente em estado desconhecido; distribuicao interrompida.');
    }
  }

  // O plano completo é calculado apenas quando ainda não existe um plano
  // congelado. O commit transacional abaixo resolve a corrida entre dois crons:
  // somente o primeiro plano vence; os demais reutilizam exatamente o armazenado.
  const candidatePlan = firstSnapshot.exists
    ? null
    : await buildSeasonPayoutPlan(season);

  const frozenPlan = await db.runTransaction(async (transaction: any) => {
    const snapshot = await transaction.get(payoutRef);
    if (snapshot.exists) {
      const stored: any = snapshot.data() || {};
      if (stored.distributedAt || stored.status === 'DISTRIBUTED') {
        return { result: payoutResultFromStored(season.seasonId, stored, true), distributed: true };
      }
      if (stored.status !== 'PROCESSING') {
        throw new Error('Premiacao existente em estado desconhecido; distribuicao interrompida.');
      }
      return { result: payoutResultFromStored(season.seasonId, stored, false), distributed: false };
    }

    if (!candidatePlan) throw new Error('Plano de premiacao ausente durante o congelamento.');
    transaction.set(payoutRef, {
      seasonId: season.seasonId,
      startDate: season.startDate.toISOString(),
      endDate: season.endDate.toISOString(),
      participantsCount: candidatePlan.participantsCount,
      grossRevenue: candidatePlan.grossRevenue,
      prizePool: candidatePlan.prizePool,
      futureReserve: candidatePlan.futureReserve,
      winnerCount: candidatePlan.winnerCount,
      winners: candidatePlan.winners,
      academias: candidatePlan.academias,
      status: 'PROCESSING',
      plannedAt: FieldValue.serverTimestamp(),
    });
    return { result: candidatePlan, distributed: false };
  });

  if (frozenPlan.distributed) return frozenPlan.result;

  // O loop usa exclusivamente o plano congelado. Crash/retry, mudança posterior
  // de score ou um segundo cron não conseguem trocar vencedores ou valores.
  for (const winner of frozenPlan.result.winners) {
    console.log(`[Season Prize Engine] Creditando R$ ${winner.prizeAmount.toFixed(2)} para ${winner.userId} (academia ${winner.gymId}, rank #${winner.rank})`);
    await RewardsEngine.rewardLeaguePrize(
      winner.userId,
      'Liga Invictus',
      winner.rank,
      winner.prizeAmount,
      { seasonId: season.seasonId, gymId: winner.gymId },
    );
  }

  await db.runTransaction(async (transaction: any) => {
    const snapshot = await transaction.get(payoutRef);
    if (!snapshot.exists) throw new Error('Plano de premiacao desapareceu durante o settlement.');
    const stored: any = snapshot.data() || {};
    if (stored.distributedAt || stored.status === 'DISTRIBUTED') return;
    if (stored.status !== 'PROCESSING' || stored.seasonId !== season.seasonId) {
      throw new Error('Plano de premiacao mudou durante o settlement.');
    }
    transaction.set(payoutRef, {
      status: 'DISTRIBUTED',
      distributedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  });

  return frozenPlan.result;
}

export async function runDailySeasonCheck(): Promise<{ skipped: boolean; reason?: string; result?: SeasonPayoutResult; nextSeason?: SeasonWindow }> {
  const current = await getOrInitCurrentSeasonWindow();
  const now = new Date();
  if (current.endDate > now) return { skipped: true, reason: 'Temporada atual ainda nao terminou.' };

  const result = await distributeSeasonPrizes(current);
  const nextSeason = await advanceToNextSeasonWindow(current);
  return { skipped: false, result, nextSeason };
}
