import { db } from './common.js';
import { calculateWeeklyIGA, IGASession, IGAUserProfile, IGACalculationResult } from '../../src/core/iga/index.js';
import { getOrInitCurrentSeasonWindow } from './season-prize-engine.js';
import {
  hasTrustedCompetitionEvidence,
  readCompetitionEvidenceMetrics,
} from './competition-evidence.js';
import { isCurrentCompetitiveHrAcknowledgement } from './competitive-heart-rate-acknowledgement.js';
import { COMPETITION_RULES_VERSIONS } from '../../shared/competitiveHeartRatePolicy.js';

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

interface GymRankingEnrollmentEpoch {
  gymId: string;
  enrolledAt: Date;
  epochId: string;
}

/**
 * Busca TODOS os treinos do usuario com createdAt dentro de [earliestNeeded, agora]
 * numa unica ida ao Firestore. As tres janelas (semana/mes/temporada) recortam
 * essa mesma lista em memoria -- antes desta funcao existir, cada semana
 * calculada (ate ~10 por recalculo) refazia a query inteira do usuario no
 * Firestore, multiplicando leituras desnecessariamente.
 */
async function fetchAllSessionsSince(
  userId: string,
  earliestNeeded: Date,
  enrollment: GymRankingEnrollmentEpoch,
): Promise<DatedSession[]> {
  const sessions: DatedSession[] = [];
  if (!db) return sessions;

  try {
    const workoutsSnap = await db.collection('workouts')
      .where('userId', '==', userId)
      .get();

    workoutsSnap.forEach((doc) => {
      const data = doc.data();
      const promotedMetrics = readCompetitionEvidenceMetrics(data);
      // Nunca volte às métricas do wearable quando o documento afirma ter
      // evidência confiável, mas o snapshot está ausente/adulterado.
      if (hasTrustedCompetitionEvidence(data) && !promotedMetrics) return;
      // `createdAt` pode ser a hora de sincronização (dias depois da prática).
      // Prefira sempre o instante real da atividade e o campo v2 congelado.
      const activityDateValue = promotedMetrics?.startTime
        || data.startTime
        || data.timestamp
        || data.competitionPolicyEffectiveAt
        || data.policyEffectiveAt
        || data.createdAt;
      const createdAt = activityDateValue
        ? (activityDateValue.toDate ? activityDateValue.toDate() : new Date(activityDateValue))
        : null;
      if (!createdAt || createdAt < earliestNeeded) return;

      if (createdAt < enrollment.enrolledAt) return;
      const isApprovedStatus = data.status === 'completed' || data.status === 'valid';
      const isFlaggedOrPending = data.status === 'rejected' || data.status === 'invalid' || data.status === 'suspicious'
        || ['rejected', 'invalid', 'not_eligible', 'pending', 'pending_review'].includes(String(data.validationStatus || ''))
        || data.securityBlocked === true || data.pendingReview === true;

      const isVersioned = Number(data.schemaVersion) >= 2 || Boolean(data.competitionPolicyVersion);
      const contexts = Array.isArray(data.competitionContexts) ? data.competitionContexts : [];
      const approvedForCurrentGym = isVersioned
        ? isApprovedStatus && !isFlaggedOrPending
          && data.competitionReviewStatus === 'approved'
          && data.isScoringEligible === true
          && contexts.some((context: any) => context?.type === 'gym_ranking'
            && String(context?.id) === enrollment.gymId
            && String(context?.epochId || '') === enrollment.epochId)
        // Compatibilidade temporária para atividades antigas já homologadas,
        // mas nunca anteriores à adesão atual ao ranking.
        : isApprovedStatus && !isFlaggedOrPending && data.isScoringEligible === true;

      sessions.push({
        id: doc.id,
        // Quando um wearable controlado pelo cliente foi deduplicado e depois
        // promovido por Strava/nativo, o ranking lê somente o snapshot da
        // evidência confiável. As métricas pessoais originais são preservadas.
        type: promotedMetrics?.activityType || data.type || 'workout',
        durationMinutes: Number(promotedMetrics?.durationMinutes)
          || Number(data.duration) || Number(data.durationMinutes) || 30,
        avgHeartRate: promotedMetrics
          ? Number(promotedMetrics.avgHeartRate) || 0
          : Number(data.avgHeartRate) || Number(data.avgHr) || 0,
        caloriesInformed: promotedMetrics
          ? Number(promotedMetrics.calories) || 0
          : Number(data.calories) || Number(data.caloriesBurned) || 0,
        isValid: approvedForCurrentGym,
        date: createdAt.toISOString(),
        createdAt
      });
    });
  } catch (err) {
    console.warn(`[IGA Service] Aviso ao buscar treinos de ${userId} desde ${earliestNeeded.toISOString()}:`, err);
    throw err;
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
  void extraSession;
  const emptyWeek = calculateWeeklyIGA([], {});
  if (!db || !userId) {
    return {
      weekly: emptyWeek,
      monthly: { average: 0, weeks: [] },
      season: { average: 0, weeks: [], seasonId: 'unknown' }
    };
  }

  const userRef = db.collection('users').doc(userId);
  const enrollmentRef = db.collection('gym_ranking_enrollments').doc(userId);
  const [userSnap, enrollmentSnap] = await Promise.all([userRef.get(), enrollmentRef.get()]);
  const userData = userSnap.exists ? (userSnap.data() || {}) : {};
  const profile = await buildProfile(userId, userData);
  const enrollmentData = enrollmentSnap.exists ? (enrollmentSnap.data() || {}) : {};
  const enrolledAtValue = enrollmentData.enrolledAt?.toDate
    ? enrollmentData.enrolledAt.toDate()
    : new Date(enrollmentData.enrolledAt || '');
  const enrollment: GymRankingEnrollmentEpoch | null = enrollmentData.enrolled === true
    && isCurrentCompetitiveHrAcknowledgement(enrollmentData, 'gym_ranking', COMPETITION_RULES_VERSIONS.gym_ranking)
    && typeof enrollmentData.gymId === 'string'
    && enrollmentData.gymId
    && Number.isFinite(enrolledAtValue.getTime())
    ? { gymId: enrollmentData.gymId, enrolledAt: enrolledAtValue, epochId: `${userId}:${enrolledAtValue.getTime()}` }
    : null;

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
  const earliestWindow = [currentWeekStart, monthStart, seasonWindow?.startDate]
    .filter((d): d is Date => !!d)
    .reduce((min, d) => (d < min ? d : min));
  const earliestNeeded = enrollment && enrollment.enrolledAt > earliestWindow
    ? enrollment.enrolledAt
    : earliestWindow;
  const allSessions = enrollment
    ? await fetchAllSessionsSince(userId, earliestNeeded, enrollment)
    : [];

  // A atividade recém-gravada já está no Firestore. Um IGASession avulso não
  // carrega o contexto/época de adesão necessários e por isso não pode ser
  // usado como atalho para entrar no ranking.
  const weekly = computeWeekIGA(allSessions, currentWeekStart, profile);
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
    throw saveErr;
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
