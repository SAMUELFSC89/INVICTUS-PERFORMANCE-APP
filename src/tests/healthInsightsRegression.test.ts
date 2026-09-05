import { buildHealthInsights } from '../core/health/healthInsights';
import type { HealthConfidenceView, HealthSummaryResponse, PontoTendencia } from '../services/healthSummaryService';

const NOW = Date.parse('2026-09-07T12:00:00Z');
const confidence = (confidenceLevel: HealthConfidenceView['confidenceLevel'] = 'B'): HealthConfidenceView => ({
  confidenceLevel, confidenceScore: 75, confidenceReason: 'Fixture de origem identificada', limitations: [], evidenceReferences: [],
  confidenceEngineVersion: 'test', measurementContext: 'daily', provenanceStatus: 'identified', assessedAt: '2026-09-07T12:00:00Z'
});
const summary: HealthSummaryResponse = { windowDays: 30, latest: {}, trends: {} };
const activities = (durationAfter: number, distanceAfter?: number) => [0, 1, 2, 3].map((i) => ({
  timestamp: Date.parse(`2026-09-0${i + 1}T12:00:00Z`), workoutType: 'Corrida',
  durationMinutes: i < 2 ? 30 : durationAfter, distanceKm: i < 2 ? distanceAfter === undefined ? undefined : 6 : distanceAfter,
  avgHeartRate: i < 2 ? 150 : 130
}));
function points(values: number[], unit = 'passos'): PontoTendencia[] {
  return values.map((value, i) => ({ value, unit,
    timestamp: new Date(Date.parse('2026-08-29T08:00:00Z') + i * 86400000).toISOString(),
    source: 'apple_health', device: 'watch', confidenceAtMeasurement: confidence(), measurementContext: 'daily', aggregationMethod: 'daily_total'
  }));
}
function withMetric(metric: 'steps_daily' | 'sleep_duration_min' | 'calories_active', series: PontoTendencia[]): HealthSummaryResponse {
  return { ...summary, trends: { [metric]: series } };
}
const insightsFor = (data: HealthSummaryResponse) => buildHealthInsights({ summary: data, now: NOW });

describe('heart rate comparisons describe evidence instead of confounding effort', () => {
  test('slower sessions cannot support same pace claim', () => {
    expect(buildHealthInsights({ summary, now: NOW, workouts: activities(37.4, 4.9) }).some(i => i.metric === 'heart_rate_response')).toBe(false);
  });
  test('missing distance cannot support improved efficiency', () => {
    expect(buildHealthInsights({ summary, now: NOW, workouts: activities(30) }).some(i => i.metric === 'heart_rate_response')).toBe(false);
  });
  test('comparable pace describes observed heart rate without a congratulations badge', () => {
    const insight = buildHealthInsights({ summary, now: NOW, workouts: activities(30, 6) }).find(i => i.metric === 'heart_rate_response');
    expect(insight?.message).toContain('mesmo ritmo');
    expect(insight?.message).toContain('Temperatura, terreno');
    expect(insight?.message).toContain('não comprova melhora ou piora');
    expect(insight?.kind).toBe('tip');
  });
  test('repeated sessions on one day do not stand in for repeated observations over time', () => {
    const workouts = activities(30, 6).map((w, i) => ({ ...w, timestamp: NOW - 86400000 + i * 60000 }));
    expect(buildHealthInsights({ summary, now: NOW, workouts })).toEqual([]);
  });
  test('an empty wearable summary still permits a comparison from complete recorded sessions', () => {
    expect(buildHealthInsights({ summary: { ...summary, availability: 'empty' }, now: NOW, workouts: activities(30, 6) }).some(i => i.metric === 'heart_rate_response')).toBe(true);
  });
  test('partial training history cannot support a comparison', () => {
    expect(buildHealthInsights({ summary, now: NOW, workouts: activities(30, 6), trainingPartial: true })).toEqual([]);
  });
  test('sessions outside the requested window and future sessions are excluded', () => {
    expect(buildHealthInsights({ summary, now: NOW + 60 * 86400000, workouts: activities(30, 6) })).toEqual([]);
    expect(buildHealthInsights({ summary, now: NOW - 60 * 86400000, workouts: activities(30, 6) })).toEqual([]);
  });
});

describe('daily comparisons state what the data actually supports', () => {
  test('zero observed steps remain part of the daily average', () => {
    const insight = insightsFor(withMetric('steps_daily', points([1000, 1000, 1000, 0, 0, 0])))[0];
    expect(insight?.evidence).toContain('1.000 → 0 passos/dia');
    expect(insight?.evidence).toContain('3 dias iniciais → 3 dias finais');
    expect(insight?.message).toContain('100%');
    expect(insight?.kind).toBe('tip');
  });
  test('increase from a zero reference uses values, never an infinite percentage', () => {
    const insight = insightsFor(withMetric('steps_daily', points([0, 0, 0, 1000, 1000, 1000])))[0];
    expect(insight?.evidence).toContain('0 → 1.000 passos/dia');
    expect(insight?.message).not.toMatch(/Infinity|NaN|%/);
  });
  test('several snapshots of one date do not become several recorded days', () => {
    const repeated = points([1000, 1000, 1000, 2000, 2000, 2000]).map((p, i) => ({ ...p, timestamp: new Date(NOW - 86400000 + i * 60000).toISOString() }));
    expect(insightsFor(withMetric('steps_daily', repeated))).toEqual([]);
  });
  test('duplicate snapshots do not increase a daily total or weight that date more heavily', () => {
    const series = points([1000, 1000, 1000, 2000, 2000, 2000]);
    const reference = insightsFor(withMetric('steps_daily', series));
    const duplicates = [...series, ...Array.from({ length: 20 }, () => series[0])];
    expect(insightsFor(withMetric('steps_daily', duplicates))).toEqual(reference);
  });
  test('the unfinished current day is not compared with complete daily totals', () => {
    const series = [...points([1000, 1000, 1000, 1000, 1000, 1000]), { ...points([0])[0], timestamp: new Date(NOW - 3600000).toISOString() }];
    expect(insightsFor(withMetric('steps_daily', series))).toEqual([]);
  });
  test('local dates determine distinct days rather than UTC dates', () => {
    const series = points([1000, 1000, 1000, 2000, 2000, 2000]).map((p, i) => ({ ...p, localDate: `2026-09-0${Math.floor(i / 2) + 1}` }));
    expect(insightsFor(withMetric('steps_daily', series))).toEqual([]);
  });
  test.each(['D', 'E'] as const)('weakest confidence %s blocks a comparison despite another good assessment', level => {
    const series = points([1000, 1000, 1000, 2000, 2000, 2000]).map(p => ({ ...p, currentEvidenceConfidence: confidence(level) }));
    expect(insightsFor(withMetric('steps_daily', series))).toEqual([]);
  });
  test('missing confidence does not silently mean trustworthy', () => {
    const series = points([1000, 1000, 1000, 2000, 2000, 2000]).map(p => ({ ...p, confidenceAtMeasurement: undefined }));
    expect(insightsFor(withMetric('steps_daily', series))).toEqual([]);
  });
  test.each(['measurementContext', 'aggregationMethod', 'device', 'source', 'unit'] as const)('a change in %s cannot be attributed to user progress', field => {
    const series = points([1000, 1000, 1000, 2000, 2000, 2000]).map((p, i) => i < 3 ? p : { ...p, [field]: 'different' });
    expect(insightsFor(withMetric('steps_daily', series))).toEqual([]);
  });
  test('a different data origin behind the same integration is kept separate', () => {
    const series = points([1000, 1000, 1000, 2000, 2000, 2000]).map((p, i) => ({ ...p, provenance: { dataOrigin: i < 3 ? 'device-a' : 'device-b' } }));
    expect(insightsFor(withMetric('steps_daily', series))).toEqual([]);
  });
  test('stale and incomplete summaries do not generate fresh interpretations', () => {
    const data = withMetric('steps_daily', points([1000, 1000, 1000, 2000, 2000, 2000]));
    expect(insightsFor({ ...data, availability: 'stale' })).toEqual([]);
    expect(insightsFor({ ...data, metadata: { partial: true, aggregation: 'daily', metrics: {} } })).toEqual([]);
  });
  test('higher calories and longer sleep are observations rather than automatic improvements', () => {
    const calories = insightsFor(withMetric('calories_active', points([200, 200, 200, 400, 400, 400], 'kcal')))[0];
    const sleep = insightsFor(withMetric('sleep_duration_min', points([360, 360, 360, 480, 480, 480], 'min')))[0];
    expect(calories?.kind).toBe('tip');
    expect(calories?.message).toContain('não comprova um treino melhor');
    expect(sleep?.kind).toBe('tip');
    expect(sleep?.message).toContain('não mede a qualidade do sono');
  });
  test('stable duration cannot mask an overall reduction in recorded sleep', () => {
    const insight = insightsFor(withMetric('sleep_duration_min', points([600, 360, 600, 360, 300, 300, 300, 300], 'min')))[0];
    expect(insight?.message).toContain('diminuiu');
    expect(insight?.kind).toBe('tip');
  });
});
