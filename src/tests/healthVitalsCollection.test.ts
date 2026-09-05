import { Capacitor } from '@capacitor/core';
import { Health } from 'capgo-capacitor-health';
import type { HealthSample } from 'capgo-capacitor-health';
import { aggregateSleepSamples, HealthVitalsProvider, readCompleteHealthRange } from '../services/wearables/HealthVitalsProvider';

jest.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: jest.fn(), isNativePlatform: jest.fn() } }));
jest.mock('capgo-capacitor-health', () => ({ Health: { readSamples: jest.fn(), queryAggregated: jest.fn(), checkAuthorization: jest.fn(), requestAuthorization: jest.fn() } }));

const sample = (overrides: Partial<HealthSample> = {}): HealthSample => ({
  dataType: 'heartRate', value: 65, unit: 'bpm', platformId: 'native-id',
  startDate: '2026-09-04T09:00:00Z', endDate: '2026-09-04T09:00:00Z', ...overrides
});
const since = new Date('2026-09-01T00:00:00Z');
const until = new Date('2026-09-05T10:00:00Z');

beforeEach(() => {
  jest.resetAllMocks();
  (Capacitor.getPlatform as jest.Mock).mockReturnValue('ios');
  (Capacitor.isNativePlatform as jest.Mock).mockReturnValue(true);
  (Health.readSamples as jest.Mock).mockResolvedValue({ samples: [] });
  (Health.queryAggregated as jest.Mock).mockResolvedValue({ samples: [] });
});

test('normaliza percentuais iOS e separa SDNN de RMSSD preservando o ID nativo', async () => {
  (Health.readSamples as jest.Mock).mockImplementation(async ({ dataType }) => ({ samples:
    dataType === 'oxygenSaturation' ? [sample({ value: 0.98 })]
      : dataType === 'bodyFat' ? [sample({ value: 0.20 })]
      : dataType === 'heartRateVariability' ? [sample({ value: 42 })] : []
  }));
  const { samples } = await HealthVitalsProvider.fetchVitalsWithDiagnostics(since, { until });
  expect(samples.find((s) => s.metricType === 'oxygen_saturation')).toMatchObject({ value: 98, unit: '%', sampleId: 'native-id', normalizationVersion: 2 });
  expect(samples.find((s) => s.metricType === 'body_fat_percent')?.value).toBe(20);
  expect(samples.find((s) => s.metricType === 'hrv_sdnn')?.value).toBe(42);
  expect(samples.some((s) => s.metricType === 'hrv_rmssd')).toBe(false);
});

test('mantém percentuais Android e HRV RMSSD sem aplicar conversão iOS', async () => {
  (Capacitor.getPlatform as jest.Mock).mockReturnValue('android');
  (Health.readSamples as jest.Mock).mockImplementation(async ({ dataType }) => ({ samples:
    dataType === 'oxygenSaturation' ? [sample({ value: 98 })]
      : dataType === 'heartRateVariability' ? [sample({ value: 42 })] : []
  }));
  const { samples } = await HealthVitalsProvider.fetchVitalsWithDiagnostics(since, { until });
  expect(samples.find((s) => s.metricType === 'oxygen_saturation')?.value).toBe(98);
  expect(samples.find((s) => s.metricType === 'hrv_rmssd')?.value).toBe(42);
});

test('status de solicitação iOS não vira alegação de permissão de leitura', async () => {
  (Health.checkAuthorization as jest.Mock).mockResolvedValue({ readAuthorized: ['heartRate'], readDenied: ['sleep'] });
  expect(await HealthVitalsProvider.checkPermissions()).toMatchObject({ readStatusKnown: false, readAuthorized: [], readDenied: [] });
});

test.each(['ios', 'android'])('pede batimentos e deixa de solicitar ou coletar os cinco tipos sem uso em %s', async platform => {
  (Capacitor.getPlatform as jest.Mock).mockReturnValue(platform);
  (Health.requestAuthorization as jest.Mock).mockResolvedValue({ readAuthorized: ['heartRate'] });
  await expect(HealthVitalsProvider.requestPermissions()).resolves.toBe(true);
  const authorization = (Health.requestAuthorization as jest.Mock).mock.calls[0][0];
  expect(authorization.read).toEqual(expect.arrayContaining(['heartRate', 'restingHeartRate', 'heartRateVariability', 'sleep', 'workouts']));
  expect(authorization.requestHistoryAccess).toBe(false);
  expect(authorization.write).toBeUndefined();
  await HealthVitalsProvider.fetchVitalsWithDiagnostics(since, { until });
  const collectedTypes = (Health.readSamples as jest.Mock).mock.calls.map(([options]) => options.dataType);
  const aggregatedTypes = (Health.queryAggregated as jest.Mock).mock.calls.map(([options]) => options.dataType);
  expect(collectedTypes).toContain('heartRate');
  for (const unused of ['bloodGlucose', 'bodyTemperature', 'height', 'flightsClimbed', 'dietaryEnergyConsumed']) {
    expect(authorization.read).not.toContain(unused);
    expect(collectedTypes).not.toContain(unused);
    expect(aggregatedTypes).not.toContain(unused);
  }
  expect(authorization.read.includes('basalCalories')).toBe(platform === 'ios');
  expect(collectedTypes.includes('basalCalories')).toBe(platform === 'ios');
});

test('Android não expande meia-noite e sono para antes dos 30 dias permitidos', async () => {
  (Capacitor.getPlatform as jest.Mock).mockReturnValue('android');
  const thirtyDaysAgo = new Date(until.getTime() - 30 * 86400000);
  const { diagnostics } = await HealthVitalsProvider.fetchVitalsWithDiagnostics(thirtyDaysAgo, { until });
  const nativeOptions = [
    ...(Health.readSamples as jest.Mock).mock.calls,
    ...(Health.queryAggregated as jest.Mock).mock.calls
  ].map(([options]) => options);
  expect(nativeOptions.length).toBeGreaterThan(0);
  expect(nativeOptions.every(options => Date.parse(options.startDate) >= thirtyDaysAgo.getTime())).toBe(true);
  expect(nativeOptions.every(options => Date.parse(options.endDate) === until.getTime())).toBe(true);
  expect(Date.parse(diagnostics.since)).toBeGreaterThan(thirtyDaysAgo.getTime());
  expect(new Date(diagnostics.since).getHours()).toBe(0);
});

test('subdivide consultas cheias e coleta todo histórico além do primeiro limite', async () => {
  const records = Array.from({ length: 6 }, (_, i) => sample({
    platformId: `id-${i}`, startDate: new Date(Date.UTC(2026, 8, 4, i + 1)).toISOString(),
    endDate: new Date(Date.UTC(2026, 8, 4, i + 1)).toISOString()
  }));
  (Health.readSamples as jest.Mock).mockImplementation(async ({ startDate, endDate, limit }) => ({
    samples: records.filter((s) => Date.parse(s.startDate) >= Date.parse(startDate) && Date.parse(s.startDate) < Date.parse(endDate)).slice(0, limit)
  }));
  const result = await readCompleteHealthRange('heartRate', new Date('2026-09-04T00:00:00Z'), new Date('2026-09-04T08:00:00Z'), 2);
  expect(result.map((s) => s.platformId).sort()).toEqual(records.map((s) => s.platformId).sort());
  expect((Health.readSamples as jest.Mock).mock.calls.length).toBeGreaterThan(1);
});

test('preserva todos os pontos Android de um HeartRateRecord com o mesmo platformId, inclusive após subdivisão', async () => {
  (Capacitor.getPlatform as jest.Mock).mockReturnValue('android');
  const records = Array.from({ length: 6 }, (_, index) => sample({
    platformId: 'shared-heart-rate-record', value: 100 + index,
    startDate: new Date(Date.UTC(2026, 8, 4, index + 1)).toISOString(),
    endDate: new Date(Date.UTC(2026, 8, 4, index + 1)).toISOString()
  }));
  (Health.readSamples as jest.Mock).mockImplementation(async ({ startDate, endDate, limit }) => ({
    samples: records.filter(point => Date.parse(point.startDate) >= Date.parse(startDate) && Date.parse(point.startDate) < Date.parse(endDate)).slice(0, limit)
  }));
  const result = await readCompleteHealthRange('heartRate', new Date('2026-09-04T00:00:00Z'), new Date('2026-09-04T08:00:00Z'), 2);
  expect(result).toHaveLength(6);
  expect(result.map(point => point.value)).toEqual([100, 101, 102, 103, 104, 105]);
  expect(new Set(result.map(point => point.platformId)).size).toBe(1);
});

test('deduplica apenas o mesmo ponto FC e preserva valores conflitantes para validação posterior', async () => {
  const point = sample({ value: 100 });
  (Health.readSamples as jest.Mock).mockResolvedValue({ samples: [point, { ...point }, { ...point, value: 120 }, { ...point, endDate: '2026-09-04T09:00:01Z' }] });
  const result = await readCompleteHealthRange('heartRate', since, until, 20);
  expect(result).toHaveLength(3);
  expect(result.map(item => item.value)).toEqual([100, 120, 100]);
});

test('não junta pontos com identidade nativa igual mas origens diferentes', async () => {
  (Health.readSamples as jest.Mock).mockResolvedValue({ samples: [sample({ sourceId: 'app-a' }), sample({ sourceId: 'app-b' })] });
  expect(await readCompleteHealthRange('heartRate', since, until, 20)).toHaveLength(2);
});

test('identidade persistida de cada ponto FC Android é distinta e estável na ressincronização', async () => {
  (Capacitor.getPlatform as jest.Mock).mockReturnValue('android');
  const points = [sample({ value: 100 }), sample({ value: 120, startDate: '2026-09-04T09:00:05Z', endDate: '2026-09-04T09:00:05Z' })];
  (Health.readSamples as jest.Mock).mockImplementation(async ({ dataType }) => ({ samples: dataType === 'heartRate' ? points : [] }));
  const first = (await HealthVitalsProvider.fetchVitalsWithDiagnostics(since, { until })).samples;
  const second = (await HealthVitalsProvider.fetchVitalsWithDiagnostics(since, { until })).samples;
  expect(first).toHaveLength(2);
  expect(first.map(item => item.value)).toEqual([100, 120]);
  expect(new Set(first.map(item => item.sampleId)).size).toBe(2);
  expect(first.map(item => item.platformId)).toEqual(['native-id', 'native-id']);
  expect(first.map(item => item.sampleId)).toEqual(second.map(item => item.sampleId));
  expect(first.every(item => item.sampleId.startsWith('hr-point:v1:'))).toBe(true);
});

test('IDs das outras métricas Android e dos pontos iOS permanecem como IDs nativos', async () => {
  for (const platform of ['android', 'ios']) {
    (Capacitor.getPlatform as jest.Mock).mockReturnValue(platform);
    (Health.readSamples as jest.Mock).mockImplementation(async ({ dataType }) => ({ samples: dataType === 'restingHeartRate' || dataType === 'heartRate' ? [sample()] : [] }));
    const { samples } = await HealthVitalsProvider.fetchVitalsWithDiagnostics(since, { until });
    expect(samples.find(item => item.metricType === 'heart_rate_resting')?.sampleId).toBe('native-id');
    if (platform === 'ios') expect(samples.find(item => item.metricType === 'heart_rate')?.sampleId).toBe('native-id');
  }
});

test('preserva marcador iOS de entrada manual para que não vire leitura de sensor no feedback', async () => {
  (Health.readSamples as jest.Mock).mockImplementation(async ({ dataType }) => ({ samples: dataType === 'heartRate'
    ? [sample({ recordingMethod: 'manual' }), sample({ platformId: 'unknown-record', recordingMethod: 'unknown' })] : [] }));
  const { samples } = await HealthVitalsProvider.fetchVitalsWithDiagnostics(since, { until });
  expect(samples.map(point => point.recordingMethod)).toEqual(['manual', 'unknown']);
});

test('deduplicação por ID nativo das demais métricas não muda', async () => {
  (Health.readSamples as jest.Mock).mockResolvedValue({ samples: [sample({ dataType: 'restingHeartRate', value: 65 }), sample({ dataType: 'restingHeartRate', value: 66 })] });
  expect(await readCompleteHealthRange('restingHeartRate', since, until, 20)).toHaveLength(1);
});

test('não considera completo um limite que persiste no mesmo instante', async () => {
  (Health.readSamples as jest.Mock).mockResolvedValue({ samples: [sample(), sample({ platformId: 'other' })] });
  await expect(readCompleteHealthRange('heartRate', new Date('2026-09-04T09:00:00Z'), new Date('2026-09-04T09:00:01Z'), 2)).rejects.toThrow('incompleto');
});

test('vazio/permissão parcial é válido; erro em métrica opcional mantém leitura incompleta', async () => {
  const empty = await HealthVitalsProvider.fetchVitalsWithDiagnostics(since, { until, permissions: { readAuthorized: ['steps'], readDenied: ['heartRate'], readStatusKnown: true } });
  expect(empty.diagnostics.readComplete).toBe(true);
  expect(empty.diagnostics.reads.find((r) => r.dataType === 'heartRate')?.status).toBe('denied');
  expect((Health.readSamples as jest.Mock).mock.calls.some(([options]) => options.dataType === 'heartRate')).toBe(false);
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  (Health.readSamples as jest.Mock).mockImplementation(async ({ dataType }) => {
    if (dataType === 'sleep') throw new Error('native read failed');
    return { samples: [] };
  });
  const failed = await HealthVitalsProvider.fetchVitalsWithDiagnostics(since, { until });
  expect(failed.diagnostics.readComplete).toBe(false);
  expect(failed.diagnostics.failedTypes).toContain('sleep');
  warn.mockRestore();
});

test('expande estágios Android, exclui vigília e une intervalos de duas fontes', () => {
  const record = sample({ dataType: 'sleep', sourceId: 'watch', deviceModel: 'Watch', startDate: '2026-09-03T22:00:00Z', endDate: '2026-09-04T06:00:00Z', stages: [
    { startDate: '2026-09-03T22:00:00Z', endDate: '2026-09-04T02:00:00Z', stage: 'deep', durationMinutes: 240 },
    { startDate: '2026-09-04T02:00:00Z', endDate: '2026-09-04T03:00:00Z', stage: 'awake', durationMinutes: 60 },
    { startDate: '2026-09-04T03:00:00Z', endDate: '2026-09-04T06:00:00Z', stage: 'light', durationMinutes: 180 }
  ] });
  const output = aggregateSleepSamples([record, { ...record, platformId: 'ring-id', sourceId: 'ring', deviceModel: 'Ring' }], 'UTC');
  expect(output).toHaveLength(1);
  expect(output[0]).toMatchObject({ value: 420, localDate: '2026-09-04', normalizationVersion: 2, aggregation: 'sleep_session' });
  expect(output[0].sourceId).toBeUndefined();
  expect(output[0].deviceModel).toBeUndefined();
  expect(output[0].derivedFrom).toEqual(['native-id', 'ring-id']);
});

test('agrupa a noite local e mede duração real através da mudança de horário', () => {
  const output = aggregateSleepSamples([sample({ dataType: 'sleep', sleepState: 'asleep', startDate: '2026-03-08T05:00:00Z', endDate: '2026-03-08T12:00:00Z' })], 'America/New_York');
  expect(output[0]).toMatchObject({ value: 420, localDate: '2026-03-08', timeZone: 'America/New_York' });
  expect(aggregateSleepSamples([sample({ dataType: 'sleep', hasStageData: false, sleepState: undefined })], 'UTC')).toEqual([]);
});

test('identidade diária permanece estável quando o total muda e não usa amanhã como timestamp', async () => {
  let steps = 1000;
  (Health.queryAggregated as jest.Mock).mockImplementation(async ({ dataType }) => ({ samples: dataType === 'steps' ? [{ value: steps, startDate: '2026-09-05T00:00:00Z', endDate: '2026-09-06T00:00:00Z' }] : [] }));
  const first = await HealthVitalsProvider.fetchVitalsWithDiagnostics(since, { until });
  steps = 0;
  const second = await HealthVitalsProvider.fetchVitalsWithDiagnostics(since, { until: new Date('2026-09-05T11:00:00Z') });
  expect(first.samples[0]).toMatchObject({ aggregation: 'daily_total', timestamp: '2026-09-05T00:00:00Z' });
  expect(first.samples[0].sampleId).toBe(second.samples[0].sampleId);
  expect(second.samples[0].value).toBe(0);
});
