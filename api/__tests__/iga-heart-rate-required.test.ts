import { calculateWeeklyIGA } from '../../src/core/iga';

const profile = { age: 30, weightKg: 80, maxHeartRate: 190 };

function session(overrides: Record<string, unknown> = {}) {
  return {
    id: 'session-1',
    type: 'cardio',
    durationMinutes: 60,
    isValid: true,
    ...overrides,
  };
}

describe('IGA 2.0 — frequência cardíaca obrigatória para intensidade', () => {
  test('sem FC medida, intensidade e IGA ficam zerados sem inventar fallback', () => {
    const result = calculateWeeklyIGA([session()], profile);

    expect(result.frequency).toBe(1);
    expect(result.Fn).toBe(0.15);
    expect(result.Tn).toBe(1);
    expect(result.In).toBe(0);
    expect(result.igaBase).toBe(0);
    expect(result.igaFinal).toBe(0);
    expect(result.igaRanking).toBe(0);
    expect(result.topSessions[0]?.intensityFactor).toBe(0);
    expect(result.topSessions[0]?.intensitySource).toBe('missing');
    expect(result.topSessions[0]?.avgHeartRate).toBe(0);
  });

  test('falha técnica com amostras inválidas e sem FC média também zera intensidade', () => {
    const result = calculateWeeklyIGA([
      session({
        heartRateSamples: [
          { timestamp: 'invalid', bpm: 160 },
          { timestamp: '2026-09-14T12:00:00.000Z', bpm: 0 },
        ],
      }),
    ], profile);

    expect(result.In).toBe(0);
    expect(result.igaRanking).toBe(0);
    expect(result.topSessions[0]?.intensitySource).toBe('missing');
  });

  test('FC média medida continua válida quando a série não está disponível', () => {
    const result = calculateWeeklyIGA([session({ avgHeartRate: 152 })], profile);

    expect(result.In).toBeGreaterThan(0);
    expect(result.igaRanking).toBeGreaterThan(0);
    expect(result.topSessions[0]?.intensitySource).toBe('average');
    expect(result.topSessions[0]?.avgHeartRate).toBe(152);
  });

  test('série medida continua tendo prioridade sobre FC média', () => {
    const start = Date.parse('2026-09-14T12:00:00.000Z');
    const heartRateSamples = Array.from({ length: 10 }, (_, index) => ({
      timestamp: new Date(start + index * 30_000).toISOString(),
      bpm: 153,
    }));

    const result = calculateWeeklyIGA([
      session({ avgHeartRate: 110, heartRateSamples }),
    ], profile);

    expect(result.topSessions[0]?.intensitySource).toBe('samples');
    expect(result.topSessions[0]?.heartRateSampleCount).toBe(10);
    expect(result.topSessions[0]?.avgHeartRate).toBe(153);
  });
});
