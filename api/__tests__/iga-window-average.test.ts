import { calculateWeeklyIGA } from '../../src/core/iga/igaEngine.js';
import { computeWindowAverageIGA, DatedIGASession } from '../../src/core/iga/windowAverage.js';

const profile = { age: 30, weightKg: 80, maxHeartRate: 190 };

function session(iso: string): DatedIGASession {
  return {
    id: iso,
    type: 'workout',
    durationMinutes: 60,
    avgHeartRate: 143,
    isValid: true,
    date: iso,
    createdAt: new Date(iso),
  };
}

describe('IGA period window averaging', () => {
  test('does not pull sessions from before the month even when they share the first calendar week', () => {
    const inside = session('2026-08-01T12:00:00.000Z');
    const result = computeWindowAverageIGA(
      [session('2026-07-31T12:00:00.000Z'), inside],
      new Date('2026-08-01T00:00:00.000Z'),
      new Date('2026-09-01T00:00:00.000Z'),
      profile,
      { now: new Date('2026-09-10T00:00:00.000Z') },
    );

    const expectedFirstWeek = calculateWeeklyIGA([
      {
        id: inside.id,
        type: inside.type,
        durationMinutes: inside.durationMinutes,
        avgHeartRate: inside.avgHeartRate,
        isValid: inside.isValid,
        date: inside.date,
      },
    ], profile);

    expect(result.weeks[0].frequency).toBe(1);
    expect(result.weeks[0].igaRanking).toBe(expectedFirstWeek.igaRanking);
  });

  test('starts the denominator at the current enrollment epoch instead of penalizing pre-enrollment weeks', () => {
    const result = computeWindowAverageIGA(
      [
        session('2026-08-03T12:00:00.000Z'),
        session('2026-08-10T12:00:00.000Z'),
        session('2026-08-15T13:00:00.000Z'),
        session('2026-08-16T13:00:00.000Z'),
      ],
      new Date('2026-08-01T00:00:00.000Z'),
      new Date('2026-09-01T00:00:00.000Z'),
      profile,
      {
        activeFrom: new Date('2026-08-15T12:00:00.000Z'),
        now: new Date('2026-09-10T00:00:00.000Z'),
      },
    );

    expect(result.weeks[0].weekStart).toContain('2026-08-10');
    expect(result.weeks[0].frequency).toBe(2);
    expect(result.weeks).toHaveLength(4);
  });

  test('clips the current partial week at now so future-dated sessions cannot enter early', () => {
    const result = computeWindowAverageIGA(
      [
        session('2026-08-19T12:00:00.000Z'),
        session('2026-08-21T12:00:00.000Z'),
      ],
      new Date('2026-08-01T00:00:00.000Z'),
      new Date('2026-09-01T00:00:00.000Z'),
      profile,
      { now: new Date('2026-08-20T12:00:00.000Z') },
    );

    expect(result.weeks.at(-1)?.frequency).toBe(1);
  });

  test('returns no weeks when enrollment begins after the evaluated window', () => {
    const result = computeWindowAverageIGA(
      [session('2026-08-20T12:00:00.000Z')],
      new Date('2026-08-01T00:00:00.000Z'),
      new Date('2026-09-01T00:00:00.000Z'),
      profile,
      {
        activeFrom: new Date('2026-09-02T00:00:00.000Z'),
        now: new Date('2026-09-10T00:00:00.000Z'),
      },
    );

    expect(result).toEqual({ average: 0, weeks: [] });
  });
});
