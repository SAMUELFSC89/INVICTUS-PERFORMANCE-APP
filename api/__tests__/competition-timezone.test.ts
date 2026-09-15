import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  DEFAULT_COMPETITION_TIME_ZONE,
  resolveCompetitionTimeZone,
  zonedAddCalendarDays,
  zonedMonthWindowForId,
  zonedStartOfMonth,
  zonedStartOfNextMonth,
  zonedStartOfWeek,
} from '../../src/core/time/competitionTime.js';

describe('competitive timezone calendar', () => {
  test('Brasilia month ends at local midnight instead of 21:00 on the previous local day', () => {
    const timeZone = 'America/Sao_Paulo';
    const reference = new Date('2026-08-31T22:30:00.000Z'); // 19:30 local, still August

    expect(zonedStartOfMonth(reference, timeZone).toISOString())
      .toBe('2026-08-01T03:00:00.000Z');
    expect(zonedStartOfNextMonth(reference, timeZone).toISOString())
      .toBe('2026-09-01T03:00:00.000Z');

    const lateAugustWorkout = new Date('2026-09-01T01:30:00.000Z'); // 31/08 22:30 local
    expect(lateAugustWorkout < zonedStartOfNextMonth(reference, timeZone)).toBe(true);
  });

  test('season id reconstructs canonical Sao Paulo boundaries and safely migrates an old UTC tracker', () => {
    const window = zonedMonthWindowForId('season_2026-09', 'America/Sao_Paulo');

    expect(window?.startDate.toISOString()).toBe('2026-09-01T03:00:00.000Z');
    expect(window?.endDate.toISOString()).toBe('2026-10-01T03:00:00.000Z');
    expect(window?.startDate.toISOString()).not.toBe('2026-09-01T00:00:00.000Z');
  });

  test('week changes only at Monday 00:00 in the competitive timezone', () => {
    const timeZone = 'America/Sao_Paulo';
    const sundayLate = new Date('2026-09-14T02:30:00.000Z'); // domingo 23:30 local
    const mondayEarly = new Date('2026-09-14T03:30:00.000Z'); // segunda 00:30 local

    expect(zonedStartOfWeek(sundayLate, timeZone).toISOString())
      .toBe('2026-09-07T03:00:00.000Z');
    expect(zonedStartOfWeek(mondayEarly, timeZone).toISOString())
      .toBe('2026-09-14T03:00:00.000Z');
  });

  test('calendar-day addition preserves local midnight across DST changes', () => {
    const timeZone = 'America/New_York';
    const beforeDst = zonedStartOfWeek(new Date('2026-03-02T12:00:00.000Z'), timeZone);
    const afterSevenCalendarDays = zonedAddCalendarDays(beforeDst, 7, timeZone);

    expect(beforeDst.toISOString()).toBe('2026-03-02T05:00:00.000Z');
    expect(afterSevenCalendarDays.toISOString()).toBe('2026-03-09T04:00:00.000Z');
  });

  test('invalid configured timezone fails closed to the product default', () => {
    expect(resolveCompetitionTimeZone('Not/A_Real_Timezone'))
      .toBe(DEFAULT_COMPETITION_TIME_ZONE);
  });

  test('season tracker contract no longer depends on host-local date-fns boundaries', () => {
    const source = readFileSync(resolve(process.cwd(), 'api/_lib/season-prize-engine.ts'), 'utf8');

    expect(source).toContain('canonicalWindowForSeasonId');
    expect(source).toContain('timeZone: COMPETITION_TIME_ZONE');
    expect(source).toContain('zonedMonthWindowForId');
    expect(source).not.toContain("from 'date-fns'");
  });
});
