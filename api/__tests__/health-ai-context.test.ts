import { CacheManager } from '../_lib/cache';
import { canonicalHealthContext, compactHealthReportContext, getHealthReportNarrative, healthContextHash, parseHealthReportDays, parseHealthReportTimeZone, prepareHealthReportWorkouts } from '../_lib/health-ai-context';
import type { WorkoutHealthRecord } from '../../src/core/health/workoutHealthTypes';
import { buildWorkoutFeedback } from '../../src/core/health/workoutFeedback';

jest.mock('../_lib/cache', () => ({ CacheManager: { get: jest.fn(), set: jest.fn(), delete: jest.fn() } }));

function privateHealthSession(): WorkoutHealthRecord {
  const time = (second: number) => new Date(Date.UTC(2026, 8, 4, 10, 0, second)).toISOString();
  return { version: 1, sessionId: 'PRIVATE_SESSION_ID', startedAt: time(0), endedAt: time(120),
    sets: [{ id: 'PRIVATE_SET_ID', exerciseId: 'PRIVATE_EXERCISE_ID', exerciseName: 'PRIVATE_EXERCISE_NAME', equipment: 'PRIVATE_EQUIPMENT',
      startedAt: time(10), endedAt: time(70), status: 'completed', timingSource: 'user_marked', reps: 10, loadKg: 40 }],
    heartRate: { status: 'available', source: 'apple_health', sourceKey: 'PRIVATE_SENSOR_ID', fetchedAt: time(121), truncated: false,
      samples: Array.from({ length: 25 }, (_, index) => ({ timestamp: time(index * 5), bpm: 140 })) } };
}

describe('contexto compacto e cache do relatório de saúde', () => {
  beforeEach(() => { jest.clearAllMocks(); (CacheManager.get as jest.Mock).mockResolvedValue(null); });

  test('hash ignora avaliação volátil, mas muda com valor, período e versão científica', () => {
    const context = { periodDays: 7, methodologyVersion: '1', metric: { value: 61, assessedAt: 'ontem' } };
    expect(healthContextHash(context)).toBe(healthContextHash({ metric: { assessedAt: 'hoje', value: 61 }, methodologyVersion: '1', periodDays: 7 }));
    expect(healthContextHash(context)).not.toBe(healthContextHash({ ...context, periodDays: 30 }));
    expect(healthContextHash(context)).not.toBe(healthContextHash({ ...context, methodologyVersion: '2' }));
    expect(healthContextHash(context)).not.toBe(healthContextHash({ ...context, metric: { value: 65 } }));
    expect(canonicalHealthContext(context)).not.toContain('assessedAt');
  });

  test('período e timezone inválidos não passam como padrão silencioso', () => {
    expect(parseHealthReportDays(undefined)).toBe(30);
    expect(parseHealthReportDays('90')).toBe(90);
    for (const invalid of [0, 14, [], {}, null, true]) expect(parseHealthReportDays(invalid)).toBeNull();
    expect(parseHealthReportTimeZone('America/Sao_Paulo')).toBe('America/Sao_Paulo');
    expect(parseHealthReportTimeZone('not-a-timezone')).toBeNull();
  });

  test('histórico inválido ou truncado marca contexto parcial sem fabricar treino', () => {
    const now = Date.parse('2026-09-05T12:00:00Z');
    const invalid = prepareHealthReportWorkouts([{ timestamp: 'invalid', status: 'valid', duration: 30 }], now);
    expect(invalid).toEqual({ workouts: [], partial: true });
    const many = prepareHealthReportWorkouts(Array.from({ length: 501 }, () => ({ timestamp: now - 1000, status: 'valid', duration: 30 })), now);
    expect(many.partial).toBe(true);
    expect(many.workouts).toHaveLength(500);
    expect(prepareHealthReportWorkouts([{ timestamp: now - 1000, status: 'pending', duration: 30 }], now).workouts).toHaveLength(0);
  });

  test('aliases e telemetria selecionam a mesma população de Saúde, preservando sessões sem duração', () => {
    const now = Date.parse('2026-09-05T12:00:00Z');
    const startTime = '2026-09-04T12:00:00Z';
    const records = [
      { id: 'nested-validation', startTime, validation: { status: 'approved' }, durationMinutes: 30 },
      { id: 'samples-only', startTime, source: 'apple_health', status: 'pending', heartRateSamples: [{ timestamp: startTime, bpm: 120 }] },
      { id: 'maximum-only', startTime, source: 'health_connect', status: 'pending', maxHr: 150, duration: 20 },
      { id: 'nested-telemetry', startTime, source: 'apple_health', healthTelemetry: { avgHeartRate: 130 }, durationMinutes: 0, duration: 99 },
      { id: 'nested-maximum', startTime, source: 'health_connect', healthTelemetry: { maxHeartRate: 140 } },
      { id: 'average-alias', startTime, source: 'apple_health', avgHr: 125, durationMinutes: 'invalid' },
      { id: 'manual-no-duration', startTime, validationStatus: 'valid' },
      { id: 'pending-manual', startTime, source: 'manual', status: 'pending', avgHeartRate: 130 },
      { id: 'duplicate-activity', startTime, source: 'apple_health', maxHr: 150, nonScoringReason: 'DUPLICATE_ACTIVITY' },
      { id: 'invalid-curve', startTime, source: 'apple_health', heartRateSamples: [{ timestamp: startTime, bpm: 10 }] }
    ];
    const prepared = prepareHealthReportWorkouts(records, now);
    expect(prepared.partial).toBe(false);
    expect(prepared.workouts.map(workout => workout.id)).toEqual([
      'nested-validation', 'samples-only', 'maximum-only', 'nested-telemetry', 'nested-maximum', 'average-alias', 'manual-no-duration'
    ]);
    expect(prepared.workouts.find(workout => workout.id === 'nested-telemetry')).toEqual(expect.objectContaining({ avgHeartRate: 130, durationMinutes: 0 }));
    const context = compactHealthReportContext({ summary: { windowDays: 30, latest: {}, trends: {} },
      workouts: [...prepared.workouts, prepared.workouts[0]], periodDays: 7, timeZone: 'UTC', now, trainingPartial: prepared.partial });
    expect(context.trainingPeriod).toEqual(expect.objectContaining({ sessions: 7, durationCoveredSessions: 2, recordedMinutes: 50 }));
    expect(canonicalHealthContext(context)).not.toMatch(/nested-validation|samples-only|manual-no-duration|heartRateSamples/);
  });

  test('FC privada usa o mesmo cálculo aprovado da tela e envia apenas médias e contagens agregadas', () => {
    const now = Date.parse('2026-09-05T12:00:00Z');
    const healthSession = privateHealthSession();
    const prepared = prepareHealthReportWorkouts([
      { id: 'PRIVATE_WORKOUT_ID', timestamp: healthSession.startedAt, status: 'valid', duration: 2, avgHeartRate: 100, healthSession }
    ], now);
    expect(prepared.workouts[0].avgHeartRate).toBe(buildWorkoutFeedback(healthSession, [], now).session.averageBpm);
    const context = compactHealthReportContext({ summary: { windowDays: 30, latest: {}, trends: {} },
      workouts: prepared.workouts, periodDays: 7, timeZone: 'UTC', now, trainingPartial: false });
    expect(context.trainingPeriod).toEqual(expect.objectContaining({ averageHeartRate: 140, heartRateCoveredSessions: 1 }));
    expect(context.recordedSessionEvidence).toEqual(expect.objectContaining({ sessionsWithPrivateRecord: 1,
      sessionsWithMarkedCompletedSets: 1, sessionsWithSufficientSessionHeartRate: 1, sessionsUsingLegacyHeartRateAverage: 0,
      strengthProgressComparison: 'NOT_COMPUTED' }));
    expect(canonicalHealthContext(context)).not.toMatch(/PRIVATE_|"sets"|"samples"|"loadKg"|"reps"/);
  });

  test('média privada suficiente entra mesmo quando não havia FC escalar legada', () => {
    const now = Date.parse('2026-09-05T12:00:00Z');
    const healthSession = privateHealthSession();
    const prepared = prepareHealthReportWorkouts([{ timestamp: healthSession.startedAt, status: 'valid', duration: 2, healthSession }], now);
    expect(prepared.workouts[0].avgHeartRate).toBe(140);
  });

  test.each(['partial', 'pending', 'unavailable'] as const)('registro privado %s não fabrica FC e mantém fallback legado explícito', status => {
    const now = Date.parse('2026-09-05T12:00:00Z');
    const healthSession = privateHealthSession(); healthSession.heartRate.status = status;
    const base = { timestamp: healthSession.startedAt, status: 'valid', duration: 2, healthSession };
    const prepared = prepareHealthReportWorkouts([{ ...base, id: 'one' }, { ...base, id: 'two', avgHr: 125 }], now);
    expect(prepared.workouts[0].avgHeartRate).toBeUndefined();
    expect(prepared.workouts[1].avgHeartRate).toBe(125);
    const context = compactHealthReportContext({ summary: { windowDays: 30, latest: {}, trends: {} },
      workouts: prepared.workouts, periodDays: 7, timeZone: 'UTC', now, trainingPartial: false });
    expect(context.trainingPeriod).toEqual(expect.objectContaining({ sessions: 2, averageHeartRate: 125, heartRateCoveredSessions: 1 }));
    expect(context.recordedSessionEvidence).toEqual(expect.objectContaining({ sessionsWithSufficientSessionHeartRate: 0, sessionsUsingLegacyHeartRateAverage: 1 }));
    const withoutLegacy = compactHealthReportContext({ summary: { windowDays: 30, latest: {}, trends: {} },
      workouts: prepared.workouts.slice(0, 1), periodDays: 7, timeZone: 'UTC', now, trainingPartial: false });
    expect(withoutLegacy.trainingPeriod).toEqual(expect.objectContaining({ averageHeartRate: null, heartRateCoveredSessions: 0 }));
  });

  test('planejamento, envelope inválido e leituras escassas não viram resultados privados utilizáveis', () => {
    const now = Date.parse('2026-09-05T12:00:00Z');
    const planned = privateHealthSession(); (planned.sets[0] as any).timingSource = 'planned';
    const sparse = privateHealthSession(); sparse.heartRate.samples = sparse.heartRate.samples.slice(0, 2);
    const overlapping = privateHealthSession(); overlapping.sets.push({ ...overlapping.sets[0], id: 'overlapping-set' });
    const prepared = prepareHealthReportWorkouts([
      { timestamp: planned.startedAt, status: 'valid', duration: 2, healthSession: planned },
      { timestamp: planned.startedAt, status: 'valid', duration: 2, healthSession: { version: 1, sets: null } },
      { timestamp: sparse.startedAt, status: 'valid', duration: 2, healthSession: sparse },
      { timestamp: sparse.startedAt, status: 'valid', duration: 2, avgHeartRate: 135 },
      { timestamp: overlapping.startedAt, status: 'valid', duration: 2, healthSession: overlapping }
    ], now);
    expect(prepared.workouts.slice(0, 3).every(workout => workout.avgHeartRate === undefined)).toBe(true);
    expect(prepared.workouts[0].sessionEvidence).toBeUndefined();
    expect(prepared.workouts[1].sessionEvidence).toBeUndefined();
    expect(prepared.workouts[3].avgHeartRate).toBe(135);
    expect(prepared.workouts[4].avgHeartRate).toBe(140);
    expect(prepared.workouts[4].sessionEvidence?.hasMarkedCompletedSet).toBe(false);
  });

  test('média do relatório mantém a menor confiança e exclui dias fora do período', () => {
    const context = compactHealthReportContext({
      summary: { windowDays: 30, latest: {}, trends: { steps_daily: [
        { timestamp: '2026-08-01T12:00:00Z', value: 9000 },
        { timestamp: '2026-09-03T12:00:00Z', value: 2000, confidenceAtMeasurement: { confidenceLevel: 'D' } },
        { timestamp: '2026-09-04T12:00:00Z', value: 4000, confidenceAtMeasurement: { confidenceLevel: 'A' } }
      ] } }, workouts: [], periodDays: 7, timeZone: 'UTC', now: Date.parse('2026-09-05T12:00:00Z'), trainingPartial: false
    });
    expect(context.metrics[0]).toEqual(expect.objectContaining({ value: 3000, confidenceLevel: 'D', coverageDays: 2 }));
    expect(JSON.stringify(context)).not.toContain('9000');
  });

  test('reavaliação atual de confiança pode limitar uma medição originalmente A', () => {
    const context = compactHealthReportContext({
      summary: { windowDays: 30, latest: {}, trends: { steps_daily: [{
        timestamp: '2026-09-04T12:00:00Z', value: 4000,
        confidenceAtMeasurement: { confidenceLevel: 'A', confidenceScore: 95 },
        currentEvidenceConfidence: { confidenceLevel: 'E', confidenceScore: 10, limitations: ['Método não confirmado.'] }
      }] } }, workouts: [], periodDays: 7, timeZone: 'UTC', now: Date.parse('2026-09-05T12:00:00Z'), trainingPartial: false
    });
    expect(context.metrics[0]).toEqual(expect.objectContaining({
      status: 'UNRELIABLE', confidenceLevel: 'E', confidenceScore: 10, limitations: ['Método não confirmado.']
    }));
  });

  test('não mistura unidades nem inclui timestamps inválidos ou futuros mesmo com localDate aparentemente válido', () => {
    const context = compactHealthReportContext({
      summary: { windowDays: 30, latest: {}, trends: { sleep_duration_min: [
        { timestamp: '2026-09-03T12:00:00Z', value: 420, unit: 'min' },
        { timestamp: '2026-09-04T12:00:00Z', value: 7, unit: 'h' }
      ], steps_daily: [
        { timestamp: 'invalid', localDate: '2026-09-04', value: 1000 },
        { timestamp: '2026-09-05T20:00:00Z', localDate: '2026-09-05', value: 9000 }
      ] } }, workouts: [], periodDays: 7, timeZone: 'UTC', now: Date.parse('2026-09-05T12:00:00Z'), trainingPartial: false
    });
    expect(context.metrics.find(metric => metric.metric === 'sleep_duration_min')).toEqual(expect.objectContaining({ status: 'UNRELIABLE' }));
    expect(context.metrics.every(metric => !('value' in metric))).toBe(true);
  });

  test('cada dia tem o mesmo peso; ausência não vira zero e mudança de origem fica explícita', () => {
    const context = compactHealthReportContext({
      summary: { windowDays: 30, latest: {}, trends: { steps_daily: [
        { timestamp: '2026-09-03T10:00:00Z', value: 1000, source: 'apple_health' },
        { timestamp: '2026-09-03T12:00:00Z', value: 2000, source: 'apple_health' },
        { timestamp: '2026-09-04T12:00:00Z', value: 4000, source: 'health_connect' }
      ] }, metadata: { partial: true, metrics: { steps_daily: { partial: true } } } },
      workouts: [], periodDays: 7, timeZone: 'UTC', now: Date.parse('2026-09-05T12:00:00Z'), trainingPartial: false
    });
    expect(context.metrics[0]).toEqual(expect.objectContaining({ value: 3000, coverageDays: 2, requestedDays: 7,
      status: 'PARTIAL', missingDaysAreZero: false, comparableSourceAndContext: false, includesToday: false }));
    expect(context.previousPeriodComparison.status).toBe('NOT_AVAILABLE');
  });

  test('treinos do relatório respeitam os dias locais do período, sem confundir referência antiga com atividade atual', () => {
    const now = Date.parse('2026-09-05T12:00:00Z');
    const context = compactHealthReportContext({ summary: { windowDays: 30, latest: {}, trends: {} }, workouts: [
      { timestamp: Date.parse('2026-08-30T01:00:00Z'), durationMinutes: 90 }, // 29/08 em São Paulo: fora.
      { timestamp: Date.parse('2026-08-30T03:00:00Z'), durationMinutes: 30 },
      { timestamp: now - 1000, durationMinutes: 45 },
      { timestamp: now + 1000, durationMinutes: 80 }
    ], periodDays: 7, timeZone: 'America/Sao_Paulo', now, trainingPartial: false });
    expect(context.trainingPeriod).toEqual(expect.objectContaining({ sessions: 2, recordedMinutes: 75,
      activeDaysWithRecords: 2, missingRecordsMeanInactivity: false }));
  });

  test('relação de sono envia apenas achados agregados ao provedor, sem pares diários brutos', () => {
    const now = Date.parse('2026-09-05T12:00:00Z');
    const sleep = Array.from({ length: 12 }, (_, day) => ({ timestamp: new Date(now - (day + 1) * 86400000).toISOString(),
      value: day % 2 ? 480 : 360, unit: 'min', source: 'apple_health', confidenceAtMeasurement: { confidenceLevel: 'B' as const } }));
    const context = compactHealthReportContext({
      summary: { windowDays: 30, latest: { sleep_duration_min: sleep[0] }, trends: { sleep_duration_min: sleep } },
      workouts: sleep.map((point, day) => ({ timestamp: Date.parse(point.timestamp), durationMinutes: day % 2 ? 60 : 30 })),
      periodDays: 30, timeZone: 'UTC', now, trainingPartial: false
    });
    expect(context.sleepActivity.status).toBe('AVAILABLE');
    expect(context.sleepActivity.pairs).toBe(12);
    expect(context.sleepActivity).not.toHaveProperty('points');
    expect(canonicalHealthContext(context)).not.toContain('activeMinutes');
  });

  test('cache hit evita geração e UID separa dois usuários com mesmos fatos', async () => {
    const generate = jest.fn().mockResolvedValue('Resumo');
    const context = { periodDays: 7, recovery: 'INSUFFICIENT_DATA' };
    await getHealthReportNarrative({ userId: 'user-a', context, model: 'model-a', cacheable: true, generate });
    const firstKey = (CacheManager.set as jest.Mock).mock.calls[0][0];
    await getHealthReportNarrative({ userId: 'user-b', context, model: 'model-a', cacheable: true, generate });
    const secondKey = (CacheManager.set as jest.Mock).mock.calls[1][0];
    expect(firstKey).not.toBe(secondKey);
    expect(firstKey).not.toContain('user-a');
    expect(generate.mock.calls[0][0]).not.toContain('user-a');
    (CacheManager.get as jest.Mock).mockResolvedValue({ answer: 'Cache', generatedAt: '2026-09-01' });
    const result = await getHealthReportNarrative({ userId: 'user-a', context, model: 'model-a', cacheable: true, generate });
    expect(result.cacheHit).toBe(true);
    expect(result.answer).toBe('Cache');
    expect(generate).toHaveBeenCalledTimes(2);
  });

  test('pedidos concorrentes iguais compartilham uma geração', async () => {
    let finish!: (value: string) => void;
    const generate = jest.fn(() => new Promise<string>((resolve) => { finish = resolve; }));
    const input = { userId: 'concurrent', context: { days: 7 }, model: 'model', cacheable: true, generate };
    const first = getHealthReportNarrative(input);
    const second = getHealthReportNarrative(input);
    await Promise.resolve();
    await Promise.resolve();
    finish('Resultado');
    const results = await Promise.all([first, second]);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(results.map(item => item.answer)).toEqual(['Resultado', 'Resultado']);
  });

  test('contexto parcial não lê nem persiste cache e falha não bloqueia tentativa seguinte', async () => {
    const input = { userId: 'partial', context: { partial: true }, model: 'model', cacheable: false };
    await expect(getHealthReportNarrative({ ...input, generate: async () => { throw new Error('offline'); } })).rejects.toThrow('offline');
    const result = await getHealthReportNarrative({ ...input, generate: async () => 'Dados parciais' });
    expect(result.answer).toBe('Dados parciais');
    expect(CacheManager.get).not.toHaveBeenCalled();
    expect(CacheManager.set).not.toHaveBeenCalled();
  });
});
