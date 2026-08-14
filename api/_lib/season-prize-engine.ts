import { db, FieldValue } from './common.js';
import { RewardsEngine } from './rewards-engine.js';
import {
  SEASON_PRIZE_POOL_PERCENT,
  SEASON_FUTURE_RESERVE_PERCENT,
  SEASON_MIN_PARTICIPANTS_FOR_PRIZE,
  SEASON_TOP5_PARTICIPANTS_THRESHOLD,
  TOP_10_PERCENTAGES,
} from '../../src/constants.js';

/**
 * Motor de premiacao da temporada (Liga Invictus).
 *
 * O pote da temporada NAO e mais um valor fixo por numero de participantes.
 * Agora e calculado como uma porcentagem da receita bruta de assinaturas
 * (Plano Performance) aprovadas dentro da janela da temporada:
 *
 *   pote (top N)      = SEASON_PRIZE_POOL_PERCENT     (20%) da receita bruta
 *   reserva futura     = SEASON_FUTURE_RESERVE_PERCENT (5%)  da receita bruta (NAO distribuida ainda)
 *
 * Numero de vencedores:
 *   < 50 participantes com monthlyScore > 0  -> nenhuma premiacao (pote nao ativado)
 *   50 a 149 participantes                   -> top 3
 *   >= 150 participantes                     -> top 5
 *
 * A janela de temporada (inicio/fim, 30 dias) e controlada por um documento
 * de ancora em system_config/season_tracker, para garantir janelas continuas
 * e sem sobreposicao entre temporadas -- diferente da funcao de exibicao do
 * frontend (getSeasonStatus em src/lib/seasonUtils.ts), que recalcula 'proxima
 * segunda-feira' a cada chamada e serve apenas para o rotulo visual da tela
 * de Ranking.
 */

const SEASON_LENGTH_DAYS = 30;

export interface SeasonWindow {
  seasonId: string;
  startDate: Date;
  endDate: Date;
}

export interface SeasonWinner {
  userId: string;
  rank: number;
  prizeAmount: number;
  monthlyScore: number;
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
}

function nextMonday(from: Date): Date {
  const d = new Date(from);
  const dayOfWeek = d.getDay(); // 0 = Sun, 1 = Mon...
  const daysUntilMonday = (1 + 7 - dayOfWeek) % 7;
  d.setDate(d.getDate() + daysUntilMonday);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function seasonIdFor(startDate: Date): string {
  return `season_${startDate.toISOString().slice(0, 10)}`;
}

/**
 * Le (ou inicializa, no primeiro uso) a janela de temporada atual a partir de
 * system_config/season_tracker. Garante que temporadas sejam continuas: a
 * proxima sempre comeca exatamente onde a anterior terminou.
 */
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

  const startDate = nextMonday(new Date());
  const endDate = addDays(startDate, SEASON_LENGTH_DAYS);
  const seasonId = seasonIdFor(startDate);

  await ref.set({
    seasonId,
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  return { seasonId, startDate, endDate };
}

async function advanceToNextSeasonWindow(previous: SeasonWindow): Promise<SeasonWindow> {
  const startDate = previous.endDate;
  const endDate = addDays(startDate, SEASON_LENGTH_DAYS);
  const seasonId = seasonIdFor(startDate);

  const ref = db.collection('system_config').doc('season_tracker');
  await ref.set({
    seasonId,
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  return { seasonId, startDate, endDate };
}

function getWinnerCount(participantsCount: number): number {
  if (participantsCount < SEASON_MIN_PARTICIPANTS_FOR_PRIZE) return 0;
  return participantsCount >= SEASON_TOP5_PARTICIPANTS_THRESHOLD ? 5 : 3;
}

function normalizedPercentages(n: number): number[] {
  const raw = TOP_10_PERCENTAGES.slice(0, n);
  const sum = raw.reduce((a: number, b: number) => a + b, 0);
  return raw.map((p: number) => p / sum);
}

/**
 * Soma o campo `amount` de todos os pedidos (orders) com status 'approved' e
 * `paidAt` dentro da janela [startDate, endDate) da temporada.
 */
export async function computeSeasonRevenue(startDate: Date, endDate: Date): Promise<number> {
  const snap = await db.collection('orders')
    .where('status', '==', 'approved')
    .where('paidAt', '>=', startDate.toISOString())
    .where('paidAt', '<', endDate.toISOString())
    .get();

  let total = 0;
  snap.docs.forEach((doc: any) => {
    const amount = doc.data().amount;
    if (typeof amount === 'number' && amount > 0) total += amount;
  });
  return total;
}

/**
 * Retorna os assinantes Performance com monthlyScore > 0, ordenados do maior
 * para o menor -- estes sao os 'participantes' da temporada.
 */
export async function getSeasonParticipants(): Promise<Array<{ id: string; monthlyScore: number }>> {
  const snap = await db.collection('users')
    .where('monthlyScore', '>', 0)
    .orderBy('monthlyScore', 'desc')
    .limit(500)
    .get();

  return snap.docs
    .filter((d: any) => d.data().subscriptionTier === 'performance')
    .map((d: any) => ({ id: d.id, monthlyScore: d.data().monthlyScore }));
}

/**
 * Distribui a premiacao de uma temporada especifica. Idempotente: se ja
 * existir um documento em season_payouts/{seasonId}, retorna o resultado
 * salvo em vez de pagar novamente.
 */
export async function distributeSeasonPrizes(season: SeasonWindow): Promise<SeasonPayoutResult> {
  const payoutRef = db.collection('season_payouts').doc(season.seasonId);
  const existing = await payoutRef.get();

  if (existing.exists) {
    const data: any = existing.data();
    return {
      seasonId: season.seasonId,
      alreadyDistributed: true,
      participantsCount: data.participantsCount,
      grossRevenue: data.grossRevenue,
      prizePool: data.prizePool,
      futureReserve: data.futureReserve,
      winnerCount: data.winnerCount,
      winners: data.winners || [],
    };
  }

  const [grossRevenue, participants] = await Promise.all([
    computeSeasonRevenue(season.startDate, season.endDate),
    getSeasonParticipants(),
  ]);

  const participantsCount = participants.length;
  const winnerCount = getWinnerCount(participantsCount);
  const prizePool = Math.round(grossRevenue * SEASON_PRIZE_POOL_PERCENT * 100) / 100;
  const futureReserve = Math.round(grossRevenue * SEASON_FUTURE_RESERVE_PERCENT * 100) / 100;

  const winners: SeasonWinner[] = [];

  if (winnerCount > 0 && prizePool > 0) {
    const percentages = normalizedPercentages(winnerCount);
    const topN = participants.slice(0, winnerCount);

    for (let i = 0; i < topN.length; i++) {
      const rank = i + 1;
      const prizeAmount = Math.round(prizePool * percentages[i] * 100) / 100;
      winners.push({ userId: topN[i].id, rank, prizeAmount, monthlyScore: topN[i].monthlyScore });
    }

    // Sequencial (nao Promise.all) para nao sobrecarregar o WalletEngine com
    // escritas concorrentes na mesma janela de tempo.
    for (const winner of winners) {
      console.log(`[Season Prize Engine] Creditando R$ ${winner.prizeAmount.toFixed(2)} para ${winner.userId} (rank #${winner.rank})`);
      await RewardsEngine.rewardLeaguePrize(winner.userId, 'Liga Invictus', winner.rank, winner.prizeAmount);
    }
  }

  await payoutRef.set({
    seasonId: season.seasonId,
    startDate: season.startDate.toISOString(),
    endDate: season.endDate.toISOString(),
    participantsCount,
    grossRevenue,
    prizePool,
    futureReserve,
    winnerCount,
    winners,
    distributedAt: FieldValue.serverTimestamp(),
  });

  return {
    seasonId: season.seasonId,
    alreadyDistributed: false,
    participantsCount,
    grossRevenue,
    prizePool,
    futureReserve,
    winnerCount,
    winners,
  };
}

/**
 * Ponto de entrada usado pelo cron diario: verifica se a temporada atual ja
 * terminou; se sim, distribui a premiacao e avanca a ancora para a proxima
 * temporada. Se a temporada ainda estiver em andamento, nao faz nada.
 */
export async function runDailySeasonCheck(): Promise<{ skipped: boolean; reason?: string; result?: SeasonPayoutResult; nextSeason?: SeasonWindow }> {
  const current = await getOrInitCurrentSeasonWindow();
  const now = new Date();

  if (current.endDate > now) {
    return { skipped: true, reason: 'Temporada atual ainda nao terminou.' };
  }

  const result = await distributeSeasonPrizes(current);
  const nextSeason = await advanceToNextSeasonWindow(current);

  return { skipped: false, result, nextSeason };
}
