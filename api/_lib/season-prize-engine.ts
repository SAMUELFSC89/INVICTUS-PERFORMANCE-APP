import { startOfMonth, addMonths } from 'date-fns';
import { db, FieldValue } from './common.js';
import { RewardsEngine } from './rewards-engine.js';
import { lerConfiguracaoInscricao } from './season-settings.js';
import {
  SEASON_MIN_PARTICIPANTS_PER_GYM,
  SEASON_TOP5_THRESHOLD_PER_GYM,
  TOP_10_PERCENTAGES,
} from './season-constants.js';

/**
 * Motor de premiacao da temporada (Liga Invictus).
 *
 * A disputa acontece DENTRO de cada academia, e o pote de cada uma vem das
 * INSCRICOES pagas pelos alunos dela:
 *
 *   pote da academia = percentualPote (padrao 55%) do arrecadado em inscricoes
 *
 * A assinatura do plano Pro NAO entra nesta conta e NAO da direito a competir:
 * ela vende recursos (IA, saude, relatorios, integracoes). Quem compete e quem
 * pagou inscricao -- cobrada por PIX fora das lojas, porque a regra delas
 * proibe usar compra dentro do app para entrada em disputa de dinheiro real.
 *
 * Numero de vencedores, por academia:
 *   sem inscritos            -> nenhuma premiacao
 *   ate 149 inscritos        -> top 3
 *   >= 150 inscritos         -> top 5
 * Nunca mais vencedores do que participantes.
 *
 * TEMPORADA = MES CALENDARIO (dia 1 00:00 ate o dia 1 00:00 do mes seguinte,
 * intervalo meio-aberto). Ate 2026-08 a janela era ancorada em "proxima
 * segunda-feira" + 30 dias corridos (system_config/season_tracker). Migrado
 * para mes calendario a pedido do usuario: toda temporada comeca no dia 1 e
 * dura o mes inteiro (28 a 31 dias, sem desvio acumulado). A ancora em
 * system_config/season_tracker continua existindo, para as temporadas ja
 * criadas sob o sistema antigo terminarem normalmente (pagando quem ja
 * competia) antes de a primeira temporada no novo formato comecar -- ver
 * seasonWindowForMonth() e advanceToNextSeasonWindow() abaixo. Nao ha mais
 * uma funcao de exibicao paralela no frontend calculando isso por conta
 * propria -- ver src/lib/seasonUtils.ts, que agora usa a mesma regra de mes
 * calendario.
 */

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
  monthlyScore: number;
}

/** Resultado da premiacao de UMA academia dentro da temporada. */
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
  /** Somatorio de todas as academias. */
  participantsCount: number;
  grossRevenue: number;
  prizePool: number;
  futureReserve: number;
  winnerCount: number;
  winners: SeasonWinner[];
  /** Detalhe por academia -- a premiacao e disputada dentro de cada unidade. */
  academias: ResultadoAcademia[];
}

function seasonIdFor(startDate: Date): string {
  return `season_${startDate.toISOString().slice(0, 7)}`; // ex: season_2026-09
}

/** Janela de mes calendario que CONTEM a data de referencia: dia 1 00:00 ate o dia 1 00:00 do mes seguinte. */
function seasonWindowForMonth(reference: Date): SeasonWindow {
  const startDate = startOfMonth(reference);
  const endDate = startOfMonth(addMonths(startDate, 1));
  return { seasonId: seasonIdFor(startDate), startDate, endDate };
}

function isAlignedToFirstOfMonth(d: Date): boolean {
  return d.getDate() === 1 && d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0;
}

/**
 * Calcula, SEM gravar nada, a janela da temporada seguinte a uma dada janela.
 *
 * Existe separada de advanceToNextSeasonWindow porque aquela AVANCA a ancora
 * global em system_config -- chamar aquela a partir do fluxo de pagamento
 * empurraria a temporada de todos os usuarios.
 *
 * Em regime (endDate ja alinhado ao dia 1, o normal apos a migracao para mes
 * calendario), a proxima temporada comeca exatamente onde a anterior terminou
 * -- sem lacuna, mes seguinte imediato. Na transicao unica do sistema antigo
 * (endDate no meio do mes, herdado da ancora "proxima segunda-feira"), a
 * proxima temporada pula para o dia 1 do mes seguinte -- o restante do mes
 * corrente fica sem temporada ativa, uma unica vez, por decisao explicita de
 * nao realinhar retroativamente a temporada ja em andamento (que fecha e paga
 * normalmente com as datas antigas).
 */
export function calcularProximaJanela(atual: SeasonWindow): SeasonWindow {
  const referencia = isAlignedToFirstOfMonth(atual.endDate)
    ? atual.endDate
    : startOfMonth(addMonths(atual.endDate, 1));
  return seasonWindowForMonth(referencia);
}

/**
 * Le (ou inicializa, no primeiro uso) a janela de temporada atual a partir de
 * system_config/season_tracker. No primeiro uso (documento ainda nao existe),
 * a temporada inicial e o mes calendario corrente.
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

  const { seasonId, startDate, endDate } = seasonWindowForMonth(new Date());

  await ref.set({
    seasonId,
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  return { seasonId, startDate, endDate };
}

async function advanceToNextSeasonWindow(previous: SeasonWindow): Promise<SeasonWindow> {
  const { seasonId, startDate, endDate } = calcularProximaJanela(previous);

  const ref = db.collection('system_config').doc('season_tracker');
  await ref.set({
    seasonId,
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  await promoverInscritosDaNovaTemporada(seasonId);

  return { seasonId, startDate, endDate };
}

/**
 * Vira o seasonStatus dos perfis quando a temporada troca.
 *
 * Sem isto, quem pagou a inscricao durante a temporada anterior ficaria preso
 * em WAITING_NEXT_SEASON mesmo depois de a temporada dele comecar, e quem
 * competiu na temporada que acabou continuaria marcado como ACTIVE sem ter
 * inscricao na nova.
 */
async function promoverInscritosDaNovaTemporada(novaSeasonId: string) {
  // 1. Quem tem inscricao paga na temporada que esta comecando entra.
  const inscritos = await db.collection('season_inscriptions')
    .where('seasonId', '==', novaSeasonId)
    .where('status', '==', 'paga')
    .get();

  const entrando = new Set<string>();
  for (const doc of inscritos.docs) {
    const userId = (doc.data() as any).userId;
    if (userId) entrando.add(userId);
  }

  // 2. Quem estava marcado como participante e nao esta na lista acima sai.
  const marcados = await db.collection('users')
    .where('seasonStatus', 'in', ['ACTIVE', 'WAITING_NEXT_SEASON'])
    .get();

  let lote = db.batch();
  let pendentes = 0;
  const gravar = async (ref: FirebaseFirestore.DocumentReference, dados: any) => {
    lote.set(ref, dados, { merge: true });
    pendentes++;
    if (pendentes >= 400) {
      await lote.commit();
      lote = db.batch();
      pendentes = 0;
    }
  };

  for (const doc of marcados.docs) {
    if (entrando.has(doc.id)) continue;
    await gravar(doc.ref, { seasonStatus: 'NOT_ENROLLED', nextSeasonStart: '' });
  }

  for (const userId of entrando) {
    await gravar(db.collection('users').doc(userId), {
      seasonStatus: 'ACTIVE',
      seasonInscritaId: novaSeasonId,
      nextSeasonStart: '',
    });
  }

  if (pendentes > 0) await lote.commit();

  console.log(`[Temporada] ${entrando.size} atletas ativos na temporada ${novaSeasonId}.`);
}


/**
 * Quantos atletas de UMA academia sao premiados, dado o tamanho dela.
 *
 * Nunca devolve mais vencedores do que participantes existentes. Isso importa:
 * se devolvesse 3 numa academia com 1 atleta, os percentuais seriam calculados
 * sobre 3 posicoes e a pessoa receberia apenas a fatia do 1o lugar (41%),
 * deixando o resto do pote sem destino.
 */
export function getWinnerCountPorAcademia(participantsCount: number): number {
  if (participantsCount < SEASON_MIN_PARTICIPANTS_PER_GYM) return 0;
  const teto = participantsCount >= SEASON_TOP5_THRESHOLD_PER_GYM ? 5 : 3;
  return Math.min(teto, participantsCount);
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
/**
 * CORRECAO: esta funcao lia da colecao 'orders', que NAO existe -- nada no
 * projeto escreve nela. Os pagamentos sao gravados em 'payment_orders'
 * (ver api/_lib/payments-service.ts e api/_handlers/payments-verify-purchase.ts),
 * que ja traz status 'approved', paidAt e amount no formato esperado.
 * Enquanto apontava para 'orders', a receita somava sempre zero e portanto
 * nenhuma premiacao era distribuida em nenhuma temporada.
 */
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

/**
 * Total arrecadado em INSCRICOES da temporada, separado por academia.
 *
 * MUDANCA IMPORTANTE: antes isso somava assinaturas (payment_orders). Nao soma
 * mais. Assinatura do plano Pro vende recursos e NAO da direito a competir --
 * quem forma o pote e a inscricao, cobrada por PIX fora das lojas.
 *
 * A academia vem congelada no proprio documento da inscricao, gravada no ato
 * do pagamento. Trocar de academia depois nao muda onde o atleta compete.
 */
export async function computeSeasonRevenueByGym(seasonId: string): Promise<Map<string, number>> {
  const snap = await db.collection('season_inscriptions')
    .where('seasonId', '==', seasonId)
    .where('status', '==', 'paga')
    .limit(2000)
    .get();

  const porAcademia = new Map<string, number>();

  snap.docs.forEach((d: any) => {
    const dados = d.data();
    const gymId = dados.gymId;
    const valor = typeof dados.valorPago === 'number' ? dados.valorPago : dados.valor;
    if (!gymId || typeof valor !== 'number' || valor <= 0) return;
    porAcademia.set(gymId, (porAcademia.get(gymId) || 0) + valor);
  });

  return porAcademia;
}

/**
 * Retorna os assinantes Performance com monthlyScore > 0, ordenados do maior
 * para o menor -- estes sao os 'participantes' da temporada.
 */
export async function getSeasonParticipants(): Promise<Array<{ id: string; monthlyScore: number }>> {
  const snap = await db.collection('users')
    .where('monthlyScore', '>', 0)
    .orderBy('monthlyScore', 'desc')
    .limit(2000)
    .get();

  return snap.docs
    .filter((d: any) => d.data().subscriptionTier === 'performance')
    .map((d: any) => ({ id: d.id, monthlyScore: d.data().monthlyScore }));
}

/**
 * Participantes da temporada agrupados por academia, ja ordenados do maior
 * para o menor monthlyScore dentro de cada academia.
 *
 * Usuarios sem gymId nao entram em academia nenhuma e portanto nao concorrem
 * a premiacao -- a competicao e interna a cada unidade.
 */
export async function getSeasonParticipantsByGym(seasonId: string): Promise<Map<string, Array<{ id: string; monthlyScore: number }>>> {
  const snap = await db.collection('users')
    .where('monthlyScore', '>', 0)
    .orderBy('monthlyScore', 'desc')
    .limit(2000)
    .get();

  // Quem compete e quem tem INSCRICAO PAGA nesta temporada -- nao quem assina
  // o plano Pro. O plano vende recursos; a inscricao e a entrada na disputa.
  //
  // A academia vem congelada no ato da inscricao, entao trocar de academia
  // depois nao muda onde o atleta compete. E quem se inscreveu com a temporada
  // ja rodando tem inscricao para a SEGUINTE, e por isso nao aparece aqui.
  const academiaCongelada = await lerAcademiasCongeladas(seasonId);

  if (academiaCongelada.size === 0) {
    console.warn(
      `[Season Prize Engine] Nenhuma inscricao paga na temporada ${seasonId}. Ninguem concorre.`
    );
  }

  const porAcademia = new Map<string, Array<{ id: string; monthlyScore: number }>>();

  snap.docs.forEach((d: any) => {
    const dados = d.data();

    const gymId = academiaCongelada.get(d.id);
    if (!gymId) return;

    const lista = porAcademia.get(gymId) || [];
    lista.push({ id: d.id, monthlyScore: dados.monthlyScore });
    porAcademia.set(gymId, lista);
  });

  // A consulta ja vem ordenada globalmente, entao cada lista tambem esta
  // ordenada. Reordenamos por seguranca, caso a consulta mude no futuro.
  porAcademia.forEach((lista) => lista.sort((a, b) => b.monthlyScore - a.monthlyScore));

  return porAcademia;
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
      academias: data.academias || [],
    };
  }

  // A premiacao e disputada DENTRO de cada academia: cada unidade tem o seu
  // proprio pote, formado pela receita das assinaturas dos seus alunos, e os
  // seus proprios vencedores.
  const [receitaPorAcademia, participantesPorAcademia, configInscricao] = await Promise.all([
    computeSeasonRevenueByGym(season.seasonId),
    getSeasonParticipantsByGym(season.seasonId),
    lerConfiguracaoInscricao(),
  ]);

  const percentualPote = configInscricao.percentualPote;

  const academias: ResultadoAcademia[] = [];
  const todosVencedores: SeasonWinner[] = [];

  // Percorre toda academia que tenha participantes OU receita.
  const idsAcademias = new Set<string>([
    ...participantesPorAcademia.keys(),
    ...receitaPorAcademia.keys(),
  ]);

  for (const gymId of idsAcademias) {
    const participantes = participantesPorAcademia.get(gymId) || [];
    const receita = receitaPorAcademia.get(gymId) || 0;

    const participantsCount = participantes.length;
    const winnerCount = getWinnerCountPorAcademia(participantsCount);
    // O pote e uma fatia das INSCRICOES daquela academia. O restante fica com
    // a operacao -- nao ha mais reserva separada, que existia no modelo antigo
    // baseado em receita de assinatura.
    const prizePool = Math.round(receita * percentualPote * 100) / 100;
    const futureReserve = 0;

    const vencedores: SeasonWinner[] = [];

    if (winnerCount > 0 && prizePool > 0) {
      const percentages = normalizedPercentages(winnerCount);
      const topN = participantes.slice(0, winnerCount);

      for (let i = 0; i < topN.length; i++) {
        vencedores.push({
          userId: topN[i].id,
          gymId,
          rank: i + 1,
          prizeAmount: Math.round(prizePool * percentages[i] * 100) / 100,
          monthlyScore: topN[i].monthlyScore,
        });
      }
    } else {
      console.log(
        `[Season Prize Engine] Academia ${gymId}: sem premiacao ` +
        `(participantes=${participantsCount}, minimo=${SEASON_MIN_PARTICIPANTS_PER_GYM}, pote=R$ ${prizePool.toFixed(2)})`
      );
    }

    academias.push({ gymId, participantsCount, grossRevenue: receita, prizePool, futureReserve, winnerCount, winners: vencedores });
    todosVencedores.push(...vencedores);
  }

  // Sequencial (nao Promise.all) para nao sobrecarregar o WalletEngine com
  // escritas concorrentes na mesma janela de tempo.
  for (const winner of todosVencedores) {
    console.log(`[Season Prize Engine] Creditando R$ ${winner.prizeAmount.toFixed(2)} para ${winner.userId} (academia ${winner.gymId}, rank #${winner.rank})`);
    await RewardsEngine.rewardLeaguePrize(winner.userId, 'Liga Invictus', winner.rank, winner.prizeAmount);
  }

  const somar = (campo: keyof ResultadoAcademia) =>
    Math.round(academias.reduce((total, a) => total + (a[campo] as number), 0) * 100) / 100;

  const resultado: SeasonPayoutResult = {
    seasonId: season.seasonId,
    alreadyDistributed: false,
    participantsCount: academias.reduce((t, a) => t + a.participantsCount, 0),
    grossRevenue: somar('grossRevenue'),
    prizePool: somar('prizePool'),
    futureReserve: somar('futureReserve'),
    winnerCount: todosVencedores.length,
    winners: todosVencedores,
    academias,
  };

  await payoutRef.set({
    seasonId: season.seasonId,
    startDate: season.startDate.toISOString(),
    endDate: season.endDate.toISOString(),
    participantsCount: resultado.participantsCount,
    grossRevenue: resultado.grossRevenue,
    prizePool: resultado.prizePool,
    futureReserve: resultado.futureReserve,
    winnerCount: resultado.winnerCount,
    winners: todosVencedores,
    academias,
    distributedAt: FieldValue.serverTimestamp(),
  });

  return resultado;
}

/**
 * Le, para uma temporada, qual academia ficou congelada para cada atleta.
 * Devolve um mapa userId -> gymId.
 */
async function lerAcademiasCongeladas(seasonId: string): Promise<Map<string, string>> {
  const mapa = new Map<string, string>();
  try {
    const snap = await db.collection('season_inscriptions')
      .where('seasonId', '==', seasonId)
      .where('status', '==', 'paga')
      .limit(2000)
      .get();

    snap.docs.forEach((d: any) => {
      const dados = d.data();
      if (dados.userId && dados.gymId) mapa.set(dados.userId, dados.gymId);
    });
  } catch (erro: any) {
    // Falha aqui significa que ninguem sera considerado inscrito. E fail-closed
    // de proposito: melhor nao premiar do que premiar quem nao se inscreveu.
    console.error('[Season Prize Engine] nao foi possivel ler season_inscriptions:', erro?.message);
  }
  return mapa;
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
