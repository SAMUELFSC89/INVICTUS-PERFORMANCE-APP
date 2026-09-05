import { db } from '../_lib/common';
import { persistirAmostraSaude, registrarAmostrasPassivas, gravarAmostraSaude, healthSampleDocumentId, deduplicateHealthSamples, lerSerieTemporalMetricaComLimite } from '../_lib/health-data-layer';
import type { HealthSample, HealthSampleInput } from '../_lib/health-data-layer';
import wearables from '../_handlers/wearables';
import { buildHealthSummary } from '../_handlers/health-summary';
import { aggregateDailyHealthSamples } from '../_lib/health-source-priority';

jest.mock('../_lib/common', () => ({ db: { collection: jest.fn(), runTransaction: jest.fn() }, cors: () => false, verifyAuth: async () => ({ uid: 'user-A' }) }));
jest.mock('../_lib/health-confidence-runtime', () => ({ loadHealthConfidenceRuntime: async () => ({ config: {}, registry: [] }) }));
jest.mock('../_lib/health-confidence-engine', () => ({
  deriveProvenanceStatus: () => 'UNKNOWN_DEVICE',
  assessHealthConfidence: () => ({ confidenceScore: 50, confidenceLevel: 'C', measurementContext: 'daily_living', confidenceEngineVersion: 'test', limitations: [], evidenceReferences: [] })
}));
jest.mock('../_lib/health-device-registry', () => ({ getUserDeviceDeclarations: async () => [], applyUserDeclaredDeviceFromList: (p: unknown) => p }));
jest.mock('../_lib/wearable-sync-service', () => ({ processarLoteWearable: jest.fn() }));

const store = new Map<string, Record<string, any>>();
let queryCount = 0;
let failHealthWrites = false;
let failMetric: string | undefined;
const now = '2026-09-05T12:00:00.000Z';
const daily: HealthSampleInput = {
  userId: 'user-A', source: 'apple_health', metricType: 'steps_daily', value: 1000, unit: 'passos',
  timestamp: '2026-09-04T00:00:00.000Z', startDate: '2026-09-04T00:00:00.000Z', endDate: '2026-09-05T00:00:00.000Z',
  sampleId: 'daily-2026-09-04', aggregation: 'daily_total', localDate: '2026-09-04', timeZone: 'UTC', normalizationVersion: 2,
  quality: 'sensor_verified'
};
function document(collection: string, id: string) {
  const key = `${collection}/${id}`;
  return { key, id, get: async () => snapshot(key) };
}
function snapshot(key: string) { return { exists: store.has(key), data: () => store.get(key), id: key.split('/').at(-1) }; }
function response() { return { statusCode: 0, body: {} as any, status(code: number) { this.statusCode = code; return this; }, json(body: any) { this.body = body; return this; } }; }

beforeEach(() => {
  store.clear(); queryCount = 0; failHealthWrites = false; failMetric = undefined;
  jest.useFakeTimers().setSystemTime(new Date(now));
  jest.spyOn(console, 'error').mockImplementation(() => {});
  (db.collection as jest.Mock).mockImplementation((name: string) => {
    const filters: Array<[string, string, any]> = [];
    let limit = Infinity;
    const query = {
      doc: (id: string) => document(name, id),
      where(field: string, op: string, value: any) { filters.push([field, op, value]); return this; },
      orderBy() { return this; },
      limit(value: number) { limit = value; return this; },
      async get() {
        queryCount += 1;
        if (filters.some(([key, , value]) => key === 'metricType' && value === failMetric)) throw new Error('QUERY_UNAVAILABLE');
        return { docs: [...store.entries()].filter(([key, value]) => key.startsWith(`${name}/`) && filters.every(([field, op, expected]) => op === '==' ? value[field] === expected : op === '>=' ? value[field] >= expected : value[field] <= expected))
          .sort((a, b) => b[1].timestamp.localeCompare(a[1].timestamp)).slice(0, limit).map(([key]) => snapshot(key)) };
      }
    };
    return query;
  });
  (db.runTransaction as jest.Mock).mockImplementation(async (callback: (transaction: any) => Promise<any>) => {
    const writes: Array<[string, any]> = [];
    const tx = {
      get: async (ref: any) => snapshot(ref.key),
      create: (ref: any, value: any) => {
        if (failHealthWrites && ref.key.startsWith('health_samples/')) throw new Error('UNAVAILABLE');
        if (store.has(ref.key)) throw new Error('ALREADY_EXISTS');
        writes.push([ref.key, value]);
      },
      set: (ref: any, value: any, options?: any) => {
        if (failHealthWrites && ref.key.startsWith('health_samples/')) throw new Error('UNAVAILABLE');
        writes.push([ref.key, { ...(options?.merge ? store.get(ref.key) : {}), ...value }]);
      }
    };
    const result = await callback(tx);
    for (const [key, value] of writes) store.set(key, value);
    return result;
  });
});
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

test('IDs isolam duas contas e cada uma confirma uma gravação real', async () => {
  expect(healthSampleDocumentId(daily)).not.toBe(healthSampleDocumentId({ ...daily, userId: 'user-B' }));
  const one = await registrarAmostrasPassivas({ userId: 'user-A', source: daily.source, amostras: [daily] });
  const two = await registrarAmostrasPassivas({ userId: 'user-B', source: daily.source, amostras: [daily] });
  expect(one.savedCount).toBe(1); expect(two.savedCount).toBe(1); expect(store.size).toBe(2);
});

test('snapshot diário aceita revisão e preserva classificação histórica', async () => {
  await persistirAmostraSaude(daily);
  const key = `health_samples/${healthSampleDocumentId(daily)}`;
  const confidence = store.get(key)!.confidenceAtMeasurement;
  expect(await persistirAmostraSaude({ ...daily, value: 9000 })).toBe('updated');
  expect(store.get(key)!.value).toBe(9000);
  expect(store.get(key)!.confidenceAtMeasurement).toEqual(confidence);
  expect(store.get(key)!.revision).toBe(2);
  expect(await persistirAmostraSaude({ ...daily, value: 9000 })).toBe('duplicate');
});

test('retry idempotente conta duplicatas sem alegar nova gravação', async () => {
  await registrarAmostrasPassivas({ userId: 'user-A', source: daily.source, amostras: [daily] });
  const retry = await registrarAmostrasPassivas({ userId: 'user-A', source: daily.source, amostras: [daily] });
  expect(retry).toMatchObject({ savedCount: 0, duplicateCount: 1, receivedCount: 1 });
});

test('falha em saúde passiva retorna 503 e não avança nenhum cursor', async () => {
  failHealthWrites = true;
  const res = response();
  await wearables({ method: 'POST', body: { action: 'sync-vitals', source: daily.source, vitals: [daily], syncWindowEnd: now, normalizationVersion: 2 } } as any, res as any);
  expect(res.statusCode).toBe(503); expect(res.body.retryable).toBe(true); expect(store.size).toBe(0);
  await expect(gravarAmostraSaude(daily)).resolves.toBeUndefined();
});

test('ACK usa janela coletada, mantém cursor por fonte e não retrocede', async () => {
  const send = async (syncWindowEnd: string) => {
    const res = response();
    await wearables({ method: 'POST', body: { action: 'sync-vitals', source: daily.source, vitals: [daily], syncWindowEnd, normalizationVersion: 2 } } as any, res as any);
    return res;
  };
  const first = await send('2026-09-05T09:00:00.000Z');
  expect(first.body.lastVitalsSyncTime).toBe('2026-09-05T09:00:00.000Z');
  expect(first.body.lastVitalsSyncBySource.apple_health).toBe(first.body.lastVitalsSyncTime);
  expect(first.body.healthVitalsVersionBySource.apple_health).toBe(2);
  const retry = await send('2026-09-05T08:00:00.000Z');
  expect(retry.body.lastVitalsSyncTime).toBe(first.body.lastVitalsSyncTime);
  expect(retry.body.savedCount).toBe(0);
});

test('lote inválido não vira sucesso vazio nem descarta excedente', async () => {
  for (const vitals of [[{ ...daily, value: -1 }], Array.from({ length: 801 }, () => daily)]) {
    const res = response();
    await wearables({ method: 'POST', body: { action: 'sync-vitals', source: daily.source, vitals } } as any, res as any);
    expect([400, 422]).toContain(res.statusCode); expect(store.size).toBe(0);
  }
});

test('migração ao toque não copia nem sobrescreve documento de outra conta', async () => {
  const legacyId = `${daily.source}_${daily.metricType}_${Buffer.from(daily.sampleId!).toString('base64url')}`;
  store.set(`health_samples/${legacyId}`, { ...daily, userId: 'user-B', id: legacyId, createdAt: now, value: 8000 });
  await persistirAmostraSaude(daily);
  expect(store.get(`health_samples/${legacyId}`)!.userId).toBe('user-B');
  expect(store.get(`health_samples/${legacyId}`)!.value).toBe(8000);
  expect(store.get(`health_samples/${healthSampleDocumentId(daily)}`)!.value).toBe(1000);
});

test('migração mantém histórico próprio e leitura escolhe apenas v2', async () => {
  const legacyId = `${daily.source}_${daily.metricType}_${Buffer.from(daily.sampleId!).toString('base64url')}`;
  const historical = { ...daily, id: legacyId, createdAt: '2026-08-01T00:00:00.000Z', confidenceAtMeasurement: { confidenceScore: 31, measurementContext: 'daily_living' } };
  store.set(`health_samples/${legacyId}`, historical);
  expect(await persistirAmostraSaude(daily)).toBe('duplicate');
  const current = store.get(`health_samples/${healthSampleDocumentId(daily)}`)!;
  expect(current.createdAt).toBe(historical.createdAt);
  expect(current.confidenceAtMeasurement).toEqual(historical.confidenceAtMeasurement);
  expect(deduplicateHealthSamples([historical, current] as HealthSample[]).samples).toHaveLength(1);
});

test('sumário consulta uma vez por métrica e preserva falha parcial', async () => {
  failMetric = 'heart_rate';
  const summary = await buildHealthSummary('user-A', 30, 'America/Sao_Paulo');
  expect(queryCount).toBe(23);
  expect(summary.metadata.partial).toBe(true);
  expect(summary.metadata.metrics.heart_rate).toMatchObject({ error: true, partial: true });
  expect(summary.metadata.metrics.steps_daily?.partial).toBe(false);
  expect(summary.metadata.timeZone).toBe('America/Sao_Paulo');
});

test('limite de leitura explícito sinaliza série parcial', async () => {
  for (let index = 0; index < 5; index++) store.set(`health_samples/${index}`, { ...daily, sampleId: String(index), id: String(index), timestamp: `2026-09-04T0${index}:00:00.000Z`, schemaVersion: 2 });
  const result = await lerSerieTemporalMetricaComLimite('user-A', 'steps_daily', new Date('2026-09-01'), new Date(now), 3);
  expect(result.partial).toBe(true); expect(result.scannedCount).toBe(4); expect(result.samples).toHaveLength(3);
});

test('agregação prefere total diário a calorias de treino e não soma duas plataformas', () => {
  const sample = { ...daily, id: 'a', createdAt: now, metricType: 'calories_active' } as HealthSample;
  const output = aggregateDailyHealthSamples('calories_active', [sample, { ...sample, id: 'b', aggregation: 'sample', sourceActivityId: 'workout', value: 250 }, { ...sample, id: 'c', source: 'health_connect', value: 1600 }]);
  expect(output).toHaveLength(1); expect(output[0].value).toBe(1000); expect(output[0].aggregationMethod).toBe('daily_total');
});

test('HRV e FC não combinam dispositivos/contextos diferentes no mesmo dia', () => {
  const sample = { ...daily, aggregation: 'sample', id: 'a', createdAt: now, metricType: 'hrv_sdnn', device: 'old', value: 30, timestamp: '2026-09-04T08:00:00.000Z' } as HealthSample;
  const output = aggregateDailyHealthSamples('hrv_sdnn', [sample, { ...sample, id: 'b', device: 'new', value: 70, timestamp: '2026-09-04T10:00:00.000Z' }]);
  expect(output[0].value).toBe(70); expect(output[0].device).toBe('new');
});

test('legado de normalização ambígua é excluído e sinalizado, sem inventar conversão', () => {
  const sample = { ...daily, id: 'old', createdAt: now, metricType: 'oxygen_saturation', normalizationVersion: 1, value: 0.95 } as HealthSample;
  expect(deduplicateHealthSamples([sample])).toMatchObject({ samples: [], unusableLegacyCount: 1 });
});

test('correção versionada de unidade preserva nota histórica e registra a revisão', async () => {
  const legacy = { ...daily, metricType: 'oxygen_saturation', aggregation: 'sample', sampleId: 'o2', value: 0.95, unit: '%', normalizationVersion: 1 } as HealthSampleInput;
  await persistirAmostraSaude(legacy);
  const key = `health_samples/${healthSampleDocumentId(legacy)}`;
  const oldConfidence = store.get(key)!.confidenceAtMeasurement;
  expect(await persistirAmostraSaude({ ...legacy, value: 95, normalizationVersion: 2 })).toBe('updated');
  expect(store.get(key)).toMatchObject({ value: 95, normalizationCorrection: { previousVersion: 1, currentVersion: 2, historicalConfidencePreserved: true } });
  expect(store.get(key)!.confidenceAtMeasurement).toEqual(oldConfidence);
});

test('valida unidades e datas e preserva zero observado de passos', async () => {
  const valid = response();
  await wearables({ method: 'POST', body: { action: 'sync-vitals', source: daily.source, vitals: [{ ...daily, value: 0 }], readComplete: false } } as any, valid as any);
  expect(valid.statusCode).toBe(200); expect(valid.body.savedCount).toBe(1);
  expect(store.has('wearable_configs/user-A')).toBe(false);
  for (const vital of [{ ...daily, unit: 'kg' }, { ...daily, value: null }, { ...daily, localDate: '2026-02-30' }, { ...daily, startDate: 'invalid' }]) {
    const invalid = response();
    await wearables({ method: 'POST', body: { action: 'sync-vitals', source: daily.source, vitals: [vital] } } as any, invalid as any);
    expect(invalid.statusCode).toBe(422);
  }
});

test('migração de totais respeita dia local ao leste de UTC', () => {
  const legacy = { ...daily, id: 'legacy', createdAt: now, metricType: 'calories_active', aggregation: undefined, normalizationVersion: 1, sampleId: 'health:calories_active:old', localDate: undefined, timeZone: undefined, startDate: '2026-09-03T15:00:00.000Z', timestamp: '2026-09-04T15:00:00.000Z' } as HealthSample;
  const corrected = { ...legacy, id: 'v2', sampleId: 'calories:v2:Tokyo:2026-09-04', schemaVersion: 2, normalizationVersion: 2, aggregation: 'daily_total', localDate: '2026-09-04', timeZone: 'Asia/Tokyo', timestamp: legacy.startDate, value: 2000 } as HealthSample;
  const output = deduplicateHealthSamples([legacy, corrected], 'Asia/Tokyo');
  expect(output.samples).toHaveLength(1); expect(output.samples[0].value).toBe(2000);
});

function androidHeartRatePair(): [HealthSample, HealthSample] {
  const timestamp = '2026-09-04T09:00:00.000Z';
  const old = { ...daily, id: 'hr-old', source: 'health_connect', sourceId: 'com.watch.app', metricType: 'heart_rate', value: 120, unit: 'bpm', aggregation: 'sample', platformId: 'record-1', sampleId: 'record-1', timestamp, startDate: timestamp, endDate: timestamp, createdAt: now } as HealthSample;
  const current = { ...old, id: 'hr-new', sampleId: `hr-point:v1:${JSON.stringify([timestamp, timestamp, 120, 'record-1'])}` };
  return [old, current];
}

test.each([false, true])('ressincronização FC Android conta somente o novo ponto exato, independentemente da ordem: %s', reverse => {
  const [old, current] = androidHeartRatePair();
  const before = JSON.stringify([old, current]);
  const output = deduplicateHealthSamples(reverse ? [current, old] : [old, current]);
  expect(output.samples).toEqual([current]);
  expect(output.excludedLegacyCount).toBe(1);
  expect(output.unusableLegacyCount).toBe(0);
  expect(JSON.stringify([old, current])).toBe(before);
});

test.each(['timestamp', 'user', 'platform', 'origin', 'native-id', 'unit'] as const)('migração FC não funde pontos diferentes em %s', difference => {
  const [old, current] = androidHeartRatePair();
  if (difference === 'timestamp') { current.timestamp = '2026-09-04T09:00:05.000Z'; current.startDate = current.timestamp; current.endDate = current.timestamp; }
  if (difference === 'user') current.userId = 'user-B';
  if (difference === 'platform') current.source = 'apple_health';
  if (difference === 'origin') current.sourceId = 'com.other.watch';
  if (difference === 'native-id') current.platformId = 'record-2';
  if (difference === 'unit') current.unit = 'ms';
  const output = deduplicateHealthSamples([old, current]);
  expect(output.samples).toHaveLength(2);
  expect(output.excludedLegacyCount).toBe(0);
  expect(output.unusableLegacyCount).toBe(0);
});

test('migração FC preserva conflito de valor no mesmo instante e sinaliza leitura parcial', async () => {
  const [old, current] = androidHeartRatePair(); current.value = 140;
  store.set('health_samples/hr-old', old); store.set('health_samples/hr-new', current);
  const output = await lerSerieTemporalMetricaComLimite('user-A', 'heart_rate', new Date('2026-09-01'), new Date(now));
  expect(output.samples.map(sample => sample.value).sort()).toEqual([120, 140]);
  expect(output.partial).toBe(true);
  expect(output.unusableLegacyCount).toBe(1);
  expect(output.excludedLegacyCount).toBe(0);
});

test('migração FC exige ID antigo do registro e mantém séries intervalares distintas', () => {
  const [old, current] = androidHeartRatePair(); old.sampleId = 'some-other-point-id';
  expect(deduplicateHealthSamples([old, current]).samples).toHaveLength(2);
  old.sampleId = old.platformId; old.startDate = '2026-09-04T08:59:50.000Z';
  expect(deduplicateHealthSamples([old, current]).samples).toHaveLength(2);
});

test('FC antiga sem ponto substituto continua disponível e não recebe leituras reconstruídas', () => {
  const [old] = androidHeartRatePair();
  expect(deduplicateHealthSamples([old])).toMatchObject({ samples: [old], excludedLegacyCount: 0, unusableLegacyCount: 0 });
});
