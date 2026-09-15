export const DEFAULT_COMPETITION_TIME_ZONE = 'America/Sao_Paulo';

export interface ZonedDateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  formatterCache.set(timeZone, formatter);
  return formatter;
}

export function resolveCompetitionTimeZone(value?: string | null): string {
  const candidate = String(value || '').trim() || DEFAULT_COMPETITION_TIME_ZONE;
  try {
    formatterFor(candidate).format(new Date(0));
    return candidate;
  } catch {
    return DEFAULT_COMPETITION_TIME_ZONE;
  }
}

export function zonedDateParts(date: Date, timeZone: string): ZonedDateParts {
  const values: Record<string, string> = {};
  for (const part of formatterFor(timeZone).formatToParts(date)) {
    if (part.type !== 'literal') values[part.type] = part.value;
  }
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  };
}

function offsetMsAt(date: Date, timeZone: string): number {
  const parts = zonedDateParts(date, timeZone);
  const representedAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  const dateWithoutMilliseconds = Math.floor(date.getTime() / 1000) * 1000;
  return representedAsUtc - dateWithoutMilliseconds;
}

export function zonedDateTimeToUtc(
  parts: ZonedDateParts,
  timeZone: string,
): Date {
  const wallClockAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );

  // Two passes are enough for normal IANA offset changes; the third makes the
  // conversion stable across DST boundaries without adding a timezone library.
  let candidateMs = wallClockAsUtc;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    candidateMs = wallClockAsUtc - offsetMsAt(new Date(candidateMs), timeZone);
  }
  return new Date(candidateMs);
}

function calendarShift(
  parts: ZonedDateParts,
  options: { days?: number; months?: number },
): ZonedDateParts {
  const shifted = new Date(Date.UTC(
    parts.year,
    parts.month - 1 + (options.months || 0),
    parts.day + (options.days || 0),
    parts.hour,
    parts.minute,
    parts.second,
  ));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
  };
}

export function zonedStartOfMonth(reference: Date, timeZone: string): Date {
  const parts = zonedDateParts(reference, timeZone);
  return zonedDateTimeToUtc({
    year: parts.year,
    month: parts.month,
    day: 1,
    hour: 0,
    minute: 0,
    second: 0,
  }, timeZone);
}

export function zonedStartOfNextMonth(reference: Date, timeZone: string): Date {
  const parts = zonedDateParts(reference, timeZone);
  const next = calendarShift({ ...parts, day: 1, hour: 0, minute: 0, second: 0 }, { months: 1 });
  return zonedDateTimeToUtc(next, timeZone);
}

export function zonedStartOfWeek(reference: Date, timeZone: string): Date {
  const parts = zonedDateParts(reference, timeZone);
  const localCalendarDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  const dayOfWeek = localCalendarDate.getUTCDay(); // 0 = domingo
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = calendarShift({ ...parts, hour: 0, minute: 0, second: 0 }, { days: diffToMonday });
  return zonedDateTimeToUtc(monday, timeZone);
}

export function zonedAddCalendarDays(reference: Date, days: number, timeZone: string): Date {
  const parts = zonedDateParts(reference, timeZone);
  return zonedDateTimeToUtc(calendarShift(parts, { days }), timeZone);
}

export function zonedYearMonth(reference: Date, timeZone: string): string {
  const parts = zonedDateParts(reference, timeZone);
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}`;
}

export function zonedMonthWindowForId(
  seasonId: string,
  timeZone: string,
): { startDate: Date; endDate: Date } | null {
  const match = /^season_(\d{4})-(\d{2})$/.exec(seasonId);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(year) || month < 1 || month > 12) return null;

  const startDate = zonedDateTimeToUtc({
    year,
    month,
    day: 1,
    hour: 0,
    minute: 0,
    second: 0,
  }, timeZone);
  const endDate = zonedStartOfNextMonth(startDate, timeZone);
  return { startDate, endDate };
}
