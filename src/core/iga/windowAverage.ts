import { calculateWeeklyIGA } from './igaEngine.js';
import { IGASession, IGAUserProfile } from './types.js';
import { zonedAddCalendarDays, zonedStartOfWeek } from '../time/competitionTime.js';

export interface DatedIGASession extends IGASession {
  createdAt: Date;
}

export interface IGAWindowWeek {
  weekStart: string;
  igaRanking: number;
  frequency: number;
}

function maxDate(left: Date, right: Date): Date {
  return left > right ? new Date(left.getTime()) : new Date(right.getTime());
}

function minDate(left: Date, right: Date): Date {
  return left < right ? new Date(left.getTime()) : new Date(right.getTime());
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
 *   antecipadamente em mensal/temporada;
 * - a virada de semana usa um timezone IANA explícito, nunca o timezone do host.
 *
 * O rótulo `weekStart` é o instante UTC correspondente à segunda-feira 00:00
 * no timezone competitivo. Isso mantém auditoria inequívoca em qualquer runtime.
 */
export function computeWindowAverageIGA(
  allSessions: DatedIGASession[],
  rangeStart: Date,
  rangeEnd: Date,
  profile: IGAUserProfile,
  options: { activeFrom?: Date; now?: Date; timeZone?: string } = {},
): { average: number; weeks: IGAWindowWeek[] } {
  const now = options.now ? new Date(options.now.getTime()) : new Date();
  const timeZone = options.timeZone || 'UTC';
  const activeFrom = options.activeFrom
    ? new Date(options.activeFrom.getTime())
    : new Date(rangeStart.getTime());
  const effectiveStart = maxDate(rangeStart, activeFrom);
  const effectiveEnd = minDate(rangeEnd, now);

  if (!Number.isFinite(effectiveStart.getTime())
    || !Number.isFinite(effectiveEnd.getTime())
    || effectiveStart >= effectiveEnd) {
    return { average: 0, weeks: [] };
  }

  const weeks: IGAWindowWeek[] = [];
  let cursor = zonedStartOfWeek(effectiveStart, timeZone);

  while (cursor < effectiveEnd) {
    const calendarWeekEnd = zonedAddCalendarDays(cursor, 7, timeZone);
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
