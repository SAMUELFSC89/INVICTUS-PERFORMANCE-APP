import { calculateWeeklyIGA } from './igaEngine.js';
import { IGASession, IGAUserProfile } from './types.js';

export interface DatedIGASession extends IGASession {
  createdAt: Date;
}

export interface IGAWindowWeek {
  weekStart: string;
  igaRanking: number;
  frequency: number;
}

function mondayOf(date: Date): Date {
  const d = new Date(date);
  const dayOfWeek = d.getDay(); // 0 = domingo
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  d.setDate(d.getDate() + diffToMonday);
  d.setHours(0, 0, 0, 0);
  return d;
}

function maxDate(left: Date, right: Date): Date {
  return left > right ? new Date(left) : new Date(right);
}

function minDate(left: Date, right: Date): Date {
  return left < right ? new Date(left) : new Date(right);
}

function sessionsInRange(allSessions: DatedIGASession[], start: Date, end: Date): IGASession[] {
  return allSessions
    .filter((session) => session.createdAt >= start && session.createdAt < end)
    .map(({ createdAt: _createdAt, ...session }) => session);
}

/**
 * Calcula a média das semanas que INTERSECTAM uma janela competitiva.
 *
 * Regras importantes:
 * - nunca conta sessão anterior a rangeStart;
 * - nunca conta sessão em/depois de rangeEnd;
 * - nunca conta sessão anterior à adesão vigente (activeFrom);
 * - semanas anteriores à adesão não entram no denominador;
 * - a semana corrente é recortada em `now`, evitando atividade futura entrar
 *   antecipadamente em mensal/temporada.
 *
 * O rótulo `weekStart` continua sendo a segunda-feira civil da semana para
 * manter o formato de auditoria existente; o conteúdo daquela semana, porém,
 * é recortado aos limites reais acima.
 */
export function computeWindowAverageIGA(
  allSessions: DatedIGASession[],
  rangeStart: Date,
  rangeEnd: Date,
  profile: IGAUserProfile,
  options: { activeFrom?: Date; now?: Date } = {},
): { average: number; weeks: IGAWindowWeek[] } {
  const now = options.now ? new Date(options.now) : new Date();
  const activeFrom = options.activeFrom ? new Date(options.activeFrom) : new Date(rangeStart);
  const effectiveStart = maxDate(rangeStart, activeFrom);
  const effectiveEnd = minDate(rangeEnd, now);

  if (!Number.isFinite(effectiveStart.getTime())
    || !Number.isFinite(effectiveEnd.getTime())
    || effectiveStart >= effectiveEnd) {
    return { average: 0, weeks: [] };
  }

  const weeks: IGAWindowWeek[] = [];
  let cursor = mondayOf(effectiveStart);

  while (cursor < effectiveEnd) {
    const calendarWeekEnd = new Date(cursor);
    calendarWeekEnd.setDate(calendarWeekEnd.getDate() + 7);

    const sliceStart = maxDate(cursor, effectiveStart);
    const sliceEnd = minDate(calendarWeekEnd, effectiveEnd);
    const result = calculateWeeklyIGA(
      sessionsInRange(allSessions, sliceStart, sliceEnd),
      profile,
    );

    weeks.push({
      weekStart: cursor.toISOString(),
      igaRanking: result.igaRanking,
      frequency: result.frequency,
    });

    cursor = calendarWeekEnd;
  }

  const average = weeks.length > 0
    ? Math.round(weeks.reduce((sum, week) => sum + week.igaRanking, 0) / weeks.length)
    : 0;

  return { average, weeks };
}
