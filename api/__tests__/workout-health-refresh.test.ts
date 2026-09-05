import wearables from '../_handlers/wearables';
import { db, verifyAuth } from '../_lib/common';
import type { WorkoutHealthRecord, WorkoutHeartRateEvidence } from '../../src/core/health/workoutHealthTypes';

jest.mock('../_lib/common', () => ({ db: { collection: jest.fn(), runTransaction: jest.fn() }, cors: () => false, verifyAuth: jest.fn() }));
jest.mock('../_lib/wearable-sync-service', () => ({ processarLoteWearable: jest.fn() }));
jest.mock('../_lib/health-data-layer', () => ({ registrarAmostrasPassivas: jest.fn() }));
jest.mock('../_lib/health-confidence-engine', () => ({ deriveProvenanceStatus: jest.fn() }));
jest.mock('../_lib/health-device-registry', () => ({ applyUserDeclaredDeviceFromList: jest.fn(), getUserDeviceDeclarations: jest.fn() }));

const start = '2026-09-05T10:00:00.000Z';
const end = '2026-09-05T11:00:00.000Z';
let stored: Record<string, any> | undefined;
let updates: Record<string, any>[];
let failCommit: boolean;
function evidence(): WorkoutHeartRateEvidence {
  return { status: 'available', source: 'apple_health', sourceKey: 'device-A', samples: [{ timestamp: '2026-09-05T10:00:20.000Z', bpm: 140 }], fetchedAt: '2026-09-05T11:30:00.000Z', truncated: false };
}
function record(): WorkoutHealthRecord {
  return {
    version: 1, sessionId: 'session-A', startedAt: start, endedAt: end,
    sets: [{ id: 'set-1', exerciseId: 'squat', exerciseName: 'Agachamento', equipment: 'Barra', startedAt: start, endedAt: '2026-09-05T10:00:45.000Z', status: 'completed', timingSource: 'user_marked', reps: 8, loadKg: 50 }],
    heartRate: { ...evidence(), status: 'pending', samples: [], fetchedAt: end },
    integrity: { status: 'complete', discardedSets: 0, discardedHeartRateSamples: 0 }
  };
}
async function refresh(heartRate: unknown, extra = {}, method = 'POST') {
  const res = { statusCode: 0, body: {} as any, status(code: number) { this.statusCode = code; return this; }, json(body: any) { this.body = body; return this; } };
  await wearables({ method, body: { action: 'refresh-session-heart-rate', workoutId: 'workout-A', heartRate, ...extra } } as any, res as any);
  return res;
}

beforeEach(() => {
  jest.clearAllMocks(); jest.useFakeTimers().setSystemTime(new Date('2026-09-05T12:00:00Z'));
  stored = { userId: 'user-A', healthSession: record(), points: 140, avgHeartRate: 95, duration: 60, evidence: { steps: 120 }, validationStatus: 'pending_review' };
  updates = []; failCommit = false;
  (verifyAuth as jest.Mock).mockResolvedValue({ uid: 'user-A' });
  (db.collection as jest.Mock).mockImplementation((collection: string) => ({ doc: (id: string) => ({ collection, id }) }));
  (db.runTransaction as jest.Mock).mockImplementation(async callback => {
    const pending: any[] = [];
    const result = await callback({
      get: async (ref: any) => { expect(ref).toEqual({ collection: 'workouts', id: 'workout-A' }); return { exists: Boolean(stored), data: () => stored }; },
      update: (ref: any, data: any) => { expect(ref).toEqual({ collection: 'workouts', id: 'workout-A' }); pending.push(data); }
    });
    if (failCommit) throw new Error('UNAVAILABLE');
    for (const update of pending) { updates.push(update); stored = { ...stored, ...update }; }
    return result;
  });
});
afterEach(() => jest.useRealTimers());

test('atualiza só saúde do proprietário e ignora séries, datas e pontuação enviadas', async () => {
  const before = structuredClone(stored);
  const res = await refresh(evidence(), { userId: 'user-B', points: 99999, sets: [], startedAt: '2000-01-01', endedAt: '2099-01-01', healthSession: { sessionId: 'fake', sets: [] } });
  expect(res.statusCode).toBe(200);
  expect(Object.keys(updates[0]).sort()).toEqual(['healthSession', 'healthSessionReason', 'healthSessionStatus']);
  expect(stored!.healthSession.sets).toEqual(before!.healthSession.sets);
  expect(stored!.healthSession.startedAt).toBe(start); expect(stored!.healthSession.endedAt).toBe(end);
  expect(stored!.healthSession.sessionId).toBe('session-A');
  for (const field of ['userId', 'points', 'avgHeartRate', 'duration', 'evidence', 'validationStatus']) expect(stored![field]).toEqual(before![field]);
  expect(res.body).toMatchObject({ healthSession: { heartRate: evidence() }, healthSessionStatus: 'available', healthSessionReason: null });
});

test('não permite ler/atualizar treino de outro usuário e não revela sua existência', async () => {
  stored!.userId = 'user-B';
  const other = await refresh(evidence());
  stored = undefined;
  const missing = await refresh(evidence());
  expect(other.statusCode).toBe(404); expect(other.body).toEqual(missing.body);
  expect(updates).toEqual([]);
});

test('sem autenticação ou método POST não altera dados', async () => {
  for (const method of ['PUT', 'GET', 'DELETE']) {
    expect((await refresh(evidence(), {}, method)).statusCode).toBe(405);
  }
  (verifyAuth as jest.Mock).mockResolvedValue(null);
  expect((await refresh(evidence())).statusCode).toBe(401);
  expect(db.runTransaction).not.toHaveBeenCalled();
});

test.each(['../other', 'a/b', '', 'a'.repeat(161)])('rejeita ID inválido antes de acessar treino (%#)', async (workoutId) => {
  expect((await refresh(evidence(), { workoutId })).statusCode).toBe(400);
  expect(db.runTransaction).not.toHaveBeenCalled();
});

test('treino antigo sem intervalos próprios não recebe horários ou séries fabricados', async () => {
  delete stored!.healthSession;
  const result = await refresh(evidence(), { healthSession: record() });
  expect(result.statusCode).toBe(409); expect(updates).toEqual([]);
});

test.each([
  { ...evidence(), samples: [] },
  { ...evidence(), status: 'pending', samples: [] },
  { ...evidence(), source: 'manual' },
  { ...evidence(), fetchedAt: '2026-09-06T00:00:00Z' },
  { ...evidence(), samples: [{ timestamp: '2026-09-05T10:00:20Z', bpm: Number.NaN }] },
  { ...evidence(), fetchedAt: '2026-09-05T11:10:00Z' },
])('resposta vazia, rejeitada ou antiga preserva FC útil (%#)', async (incoming) => {
  stored!.healthSession.heartRate = evidence();
  const res = await refresh(incoming);
  expect(res.statusCode).toBe(200); expect(updates).toEqual([]);
  expect(res.body.healthSession.heartRate).toEqual(evidence());
});

test('consulta parcial ou menor não substitui uma série cardíaca mais completa', async () => {
  const current = evidence(); current.samples.push({ timestamp: '2026-09-05T10:01:00.000Z', bpm: 145 });
  stored!.healthSession.heartRate = current;
  expect((await refresh({ ...evidence(), fetchedAt: '2026-09-05T11:40:00Z' })).body.healthSession.heartRate).toEqual(current);
  expect((await refresh({ ...current, status: 'partial', truncated: true, fetchedAt: '2026-09-05T11:45:00Z' })).body.healthSession.heartRate).toEqual(current);
  expect(updates).toEqual([]);
});

test('séries antes descartadas continuam explicitamente parciais após atualizar FC', async () => {
  stored!.healthSession.integrity = { status: 'partial', discardedSets: 2, discardedHeartRateSamples: 4 };
  const res = await refresh(evidence());
  expect(res.statusCode).toBe(200);
  expect(res.body.healthSession.integrity).toEqual({ status: 'partial', discardedSets: 2, discardedHeartRateSamples: 0 });
  expect(res.body.healthSessionStatus).toBe('partial');
});

test('nova consulta limitada a 5000 amostras informa truncamento', async () => {
  const incoming = evidence();
  incoming.samples = Array.from({ length: 5001 }, (_, index) => ({ timestamp: new Date(Date.parse(start) + index * 500).toISOString(), bpm: 135 }));
  const res = await refresh(incoming);
  expect(res.statusCode).toBe(200);
  expect(res.body.healthSession.heartRate.samples).toHaveLength(5000);
  expect(res.body.healthSession.heartRate).toMatchObject({ status: 'partial', truncated: true });
});

test('falha de gravação não confirma atualização e mantém documento anterior', async () => {
  const before = structuredClone(stored); failCommit = true;
  const res = await refresh(evidence());
  expect(res.statusCode).toBe(503); expect(res.body.retryable).toBe(true);
  expect(stored).toEqual(before); expect(updates).toEqual([]);
});
