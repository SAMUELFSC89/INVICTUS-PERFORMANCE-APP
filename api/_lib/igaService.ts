import { db } from './common.js';
import { calculateWeeklyIGA, IGASession, IGAUserProfile, IGACalculationResult } from '../../src/core/iga/index.js';
import { getOrInitCurrentSeasonWindow } from './season-prize-engine.js';

/**
 * FONTE UNICA DE PONTUACAO DE RANKING.
 *
 * Ate 2026-08 weeklyScore, monthlyScore e score eram calculados por formulas
 * DIFERENTES (weeklyScore pelo IGA; monthlyScore por incremento ad-hoc em
 * validate-presence.ts e pelo ScoreEngine do Strava; score por
 * calculateRankingPoints em ranking-points.ts). Resultado: a mesma pessoa
 * aparecia em posicoes inconsistentes dependendo da aba do ranking (Semana /
 * Mes / Temporada), porque cada aba lia um campo alimentado por um sistema
 * diferente. Ver AUDITORIA-CORE-INVICTUS.md, secao 2.
 *
 * A partir de agora as tres janelas usam a MESMA formula (calculateWeeklyIGA,
 * ver src/core/iga/igaEngine.ts). A unica coisa que muda e a janela de datas
 * -- e como o IGA foi desenhado para uma semana (frequencia capada em 5
 * sessoes), janelas maiores que uma semana sao a MEDIA das semanas dentro da
 * janela, nao a mesma formula aplicada de uma vez sobre o periodo inteiro
 * (isso derrubaria Fn pra quem treinou mais de 5 vezes no mes/temporada
 * inteiros). Decisao confirmada com o usuario em 2026-08-27.
 */

function mondayOf(date: Date): Date {
  const d = new Date(date);
  const dayOfWeek = d.getDay(); // 0 = domingo
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  d.setDate(d.getDate() + diffToMonday);
  d.setHours(0, 0, 0, 0);
  return d;
}

interface DatedSession extends IGASession {
  createdAt: Date;
}

/**
 * Busca TODOS os treinos do usuario com createdAt dentro de [earliestNeeded, agora]
 * numa unica ida ao Firestore. As tres janelas (semana/mes/temporada) recortam
 * essa mesma lista em memoria -- antes desta funcao existir, cada semana
 * calculada (ate ~10 por recalculo) refazia a query inteira do usuario no
 * Firestore, multiplicando leituras desnecessariamente.
 */
async function fetchAllSessionsSince(userId: string, earliestNeeded: Date): Promise<DatedSession[]> {
  const sessions: DatedSession[] = [];
  if (!db) return sessions;

  try {
    const workoutsSnap = await db.collection('workouts')
      .where('userId', '==', userId)
      .get();

    workoutsSnap.forEach((doc) => {
      const data = doc.data();
      const createdAt = data.createdAt
        ? (data.createdAt.toDate ? data.createdAt.toDate() : new Date(data.createdAt))
        : null;
      if (!createdAt || createdAt < earliestNeeded) return;

      // #228: "aprovado" nao tem um unico nome no Firestore -- cada caminho de
      // escrita (treino manual, check-in de presenca, corrida GPS, Strava) usa
      // vocabulario proprio (status: 'completed'|'valid'|'invalid'|'suspicious'|
      // 'pending_review'|'rejected'; validationStatus: 'validated'|'invalid'|
      // 'rejected'|'not_eligible'; securityBlocked: true/false). Uma lista negra
      // (excluir so 'rejected') deixava 'suspicious'/'pending_review' passarem
      // como validos por omissao -- o oposto da regra "ausencia de dado != dado
      // valido". Por isso aqui e uma lista BRANCA: so conta se o status for
      // explicitamente um dos dois valores usados pelos pipelines aprovados, e
      // nenhum sinalizador de bloqueio/pendencia estiver presente.
      const isApprovedStatus = data.status === 'completed' || data.status === 'valid';
      const isFlaggedOrPending = data.status === 'rejected' || data.status === 'invalid' || data.status === 'suspicious'
        || data.validationStatus === 'rejected' || data.validationStatus === 'invalid' || data.validationStatus === 'not_eligible'
        || data.securityBlocked === true;

      sessions.push({
        id: doc.id,
        type: data.type || 'workout',
        durationMinutes: Number(data.duration) || Number(data.durationMinutes) || 30,
        avgHeartRate: Number(data.avgHeartRate) || Number(data.avgHr) || 0,
        caloriesInformed: Number(data.calories) || Number(data.caloriesBurned) || 0,
        isValid: isApprovedStatus && !isFlaggedOrPending,
        date: createdAt.toISOString(),
        createdAt
      });
    });
  } catch (err) {
    console.warn(`[IGA Service] Aviso ao buscar treinos de ${userId} desde ${earliestNeeded.toISOString()}:`, err);
  }

  return sessions;
}

function sliceSessions(all: DatedSession[], start: Date, end: Date): IGASession[] {
  return all
    .filter((s) => s.createdAt >= start && s.createdAt < end)
    .map(({ createdAt, ...session }) => session);
}

async function buildProfile(userId: string, userData: any): Promise<IGAUserProfile> {
  return {
    userId,
    age: Number(userData.age) || 30,
    weightKg: Number(userData.weight) || Number(userData.weightKg) || 70,
    maxHeartRate: Number(userData.maxHeartRate) || undefined
  };
}

/** Calcula o IGA de UMA semana (Monday 00:00 -> Monday+7 00:00) a partir de uma lista ja carregada. */
function computeWeekIGA(
  allSessions: DatedSession[],
  weekStart: Date,
  profile: IGAUserProfile,
  extraSession?: IGASession
): IGACalculationResult {
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);

  const sessions = sliceSessions(allSessions, weekStart, weekEnd);
  if (extraSession) sessions.push(extraSession);

  return calculateWeeklyIGA(sessions, profile);
}

/**
 * Calcula a MEDIA do IGA semanal para cada semana (Monday-Sunday) que comeca
 * dentro de [rangeStart, rangeEnd) e ja comecou (nao inclui semanas futuras).
 * Semanas sem nenhum treino elegivel entram na media com igaRanking = 0 --
 * isso e intencional: e o que faz a media refletir CONSISTENCIA ao longo do
 * periodo, nao so o pico de uma semana boa.
 */
function computeWindowAverageIGA(
  allSessions: DatedSession[],
  rangeStart: Date,
  rangeEnd: Date,
  profile: IGAUserProfile
): { average: number; weeks: Array<{ weekStart: string; igaRanking: number; frequency: number }> } {
  const now = new Date();
  const effectiveEnd = rangeEnd < now ? rangeEnd : now;

  const weeks: Array<{ weekStart: string; igaRanking: number; frequency: number }> = [];
  let cursor = mondayOf(rangeStart);

  while (cursor < effectiveEnd) {
    const result = computeWeekIGA(allSessions, cursor, profile);
    weeks.push({
      weekStart: cursor.toISOString(),
      igaRanking: result.igaRanking,
      frequency: result.frequency
    });
    cursor = new Date(cursor);
    cursor.setDate(cursor.getDate() + 7);
  }

  const average = weeks.length > 0
    ? Math.round(weeks.reduce((sum, w) => sum + w.igaRanking, 0) / weeks.length)
    : 0;

  return { average, weeks };
}

export interface RecalculatedScores {
  weekly: IGACalculationResult;
  monthly: { average: number; weeks: Array<{ weekStart: string; igaRanking: number; frequency: number }> };
  season: { average: number; weeks: Array<{ weekStart: string; igaRanking: number; frequency: number }>; seasonId: string };
}

/**
 * Recalcula weeklyScore, monthlyScore e score (temporada) de um usuario numa
 * unica passada, com a MESMA formula de base, e grava tudo junto (evita 3
 * writes separados / race conditions entre eles).
 *
 * `extraSession` (opcional) e usado quando o recalculo e disparado no mesmo
 * request que acabou de validar uma atividade nova: evita ter que esperar o
 * Firestore confirmar o write anterior antes de conseguir contar essa sessao
 * na semana atual.
 */
export async function recalculateAllUserScores(
  userId: string,
  extraSession?: IGASession
): Promise<RecalculatedScores> {
  const emptyWeek = calculateWeeklyIGA([], {});
  if (!db || !userId) {
    return {
      weekly: emptyWeek,
      monthly: { average: 0, weeks: [] },
      season: { average: 0, weeks: [], seasonId: 'unknown' }
    };
  }

  const userRef = db.collection('users').doc(userId);
  const userSnap = await userRef.get();
  const userData = userSnap.exists ? (userSnap.data() || {}) : {};
  const profile = await buildProfile(userId, userData);

  const now = new Date();
  const currentWeekStart = mondayOf(now);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  let seasonWindow: { seasonId: string; startDate: Date; endDate: Date } | null = null;
  try {
    seasonWindow = await getOrInitCurrentSeasonWindow();
  } catch (err) {
    // #227: se o tracker de temporada nao puder ser lido, nao inventamos uma
    // janela -- score de temporada fica 0 em vez de um numero fabricado.
    console.warn(`[IGA Service] Nao foi possivel ler a janela de temporada para ${userId}:`, err);
  }

  // Busca tudo de uma vez, desde a mais antiga das tres janelas -- semana,
  // mes ou temporada, o que comecar primeiro.
  const earliestNeeded = [currentWeekStart, monthStart, seasonWindow?.startDate]
    .filter((d): d is Date => !!d)
    .reduce((min, d) => (d < min ? d : min));
  const allSessions = await fetchAllSessionsSince(userId, earliestNeeded);

  const weekly = computeWeekIGA(allSessions, currentWeekStart, profile, extraSession);
  const monthly = computeWindowAverageIGA(allSessions, monthStart, monthEnd, profile);

  const season: RecalculatedScores['season'] = seasonWindow
    ? { ...computeWindowAverageIGA(allSessions, seasonWindow.startDate, seasonWindow.endDate, profile), seasonId: seasonWindow.seasonId }
    : { average: 0, weeks: [], seasonId: 'unknown' };

  try {
    await userRef.set({
      weeklyScore: weekly.igaRanking,
      monthlyScore: monthly.average,
      score: season.average,
      igaAudit: weekly,
      igaAuditMonthly: { average: monthly.average, weeks: monthly.weeks },
      igaAuditSeason: { average: season.average, weeks: season.weeks, seasonId: season.seasonId },
      updatedAt: new Date().toISOString()
    }, { merge: true });
  } catch (saveErr) {
    console.error(`[IGA Service] Erro ao salvar pontuacoes (weekly/monthly/season) para ${userId}:`, saveErr);
  }

  return { weekly, monthly, season };
}

/**
 * Mantido para compatibilidade com quem so precisa do resultado semanal
 * (ex: fluxos que ja tinham essa chamada antes da consolidacao). Por baixo
 * dos panos ja recalcula as tres janelas, entao weeklyScore/monthlyScore/
 * score do usuario saem sempre consistentes entre si.
 */
export async function recalculateUserWeeklyIGA(
  userId: string,
  extraSession?: IGASession
): Promise<IGACalculationResult> {
  const result = await recalculateAllUserScores(userId, extraSession);
  return result.weekly;
}
