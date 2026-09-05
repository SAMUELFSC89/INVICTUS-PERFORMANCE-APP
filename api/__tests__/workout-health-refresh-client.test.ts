import { workoutHealthRefreshService } from '../../src/services/workoutHealthRefreshService';
import { sessionHeartRateService } from '../../src/services/sessionHeartRateService';
import { auth } from '../../src/firebase';
import type { WorkoutHealthRecord, WorkoutHeartRateEvidence } from '../../src/core/health/workoutHealthTypes';

jest.mock('../../src/firebase', () => ({ auth: { currentUser: null } }));
jest.mock('../../src/config', () => ({ API_CONFIG: { baseUrl: '' } }));
jest.mock('../../src/services/sessionHeartRateService', () => ({ sessionHeartRateService: { read: jest.fn() } }));
jest.mock('../../src/services/workoutFeedbackHistoryService', () => ({
  readWorkoutHealthRecord: jest.requireActual('../../src/core/health/workoutHealthTypes').readWorkoutHealthRecord,
}));

const authState = auth as unknown as { currentUser: { uid: string; getIdToken: jest.Mock } | null };
const originalFetch = global.fetch;
const startedAt = '2026-09-05T09:00:00.000Z', endedAt = '2026-09-05T09:30:00.000Z';
const freshHeartRate = (): WorkoutHeartRateEvidence => ({
  status: 'available', source: 'health_connect', sourceKey: 'watch-a', truncated: false,
  fetchedAt: '2026-09-05T10:00:00.000Z', samples: [{ timestamp: '2026-09-05T09:10:00.000Z', bpm: 133 }],
});
const savedRecord = (): WorkoutHealthRecord => ({
  version: 1, sessionId: 'session-a', startedAt, endedAt,
  sets: [{ id: 'set-a', exerciseId: 'squat', exerciseName: 'Agachamento', equipment: 'Barra',
    startedAt: '2026-09-05T09:10:00.000Z', endedAt: '2026-09-05T09:11:00.000Z', timingSource: 'user_marked',
    status: 'completed', reps: 12, loadKg: 25 }],
  heartRate: { status: 'pending', source: null, sourceKey: null, fetchedAt: null, truncated: false, samples: [] },
});
const acknowledged = () => ({ ...savedRecord(), heartRate: freshHeartRate() });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  jest.clearAllMocks();
  authState.currentUser = { uid: 'athlete-a', getIdToken: jest.fn().mockResolvedValue('token-a') };
  (sessionHeartRateService.read as jest.Mock).mockResolvedValue(freshHeartRate());
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ healthSession: acknowledged() }) });
});
afterEach(() => { global.fetch = originalFetch; });

test('saves only new private heart evidence and accepts a matching authoritative acknowledgement', async () => {
  const original = savedRecord(), before = JSON.stringify(original);
  const result = await workoutHealthRefreshService.refresh(original, 'workout-a');
  expect(result).toEqual(acknowledged());
  expect(JSON.stringify(original)).toBe(before);
  expect(sessionHeartRateService.read).toHaveBeenCalledWith('athlete-a', startedAt, endedAt, expect.any(AbortSignal));
  expect(global.fetch).toHaveBeenCalledWith('/api/wearables', expect.objectContaining({
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-a' },
  }));
  const payload = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
  expect(payload).toEqual({ action: 'refresh-session-heart-rate', workoutId: 'workout-a', heartRate: freshHeartRate() });
  expect(payload).not.toHaveProperty('sets');
  expect(payload).not.toHaveProperty('points');
});

test('signed-out callers and malformed workout identifiers never read native data or post', async () => {
  authState.currentUser = null;
  await expect(workoutHealthRefreshService.refresh(savedRecord(), 'workout-a')).rejects.toThrow('identificar');
  authState.currentUser = { uid: 'athlete-a', getIdToken: jest.fn().mockResolvedValue('token-a') };
  await expect(workoutHealthRefreshService.refresh(savedRecord(), 'other/workout')).rejects.toThrow('identificar');
  await expect(workoutHealthRefreshService.refresh(savedRecord(), '')).rejects.toThrow('identificar');
  await expect(workoutHealthRefreshService.refresh({} as WorkoutHealthRecord, 'workout-a')).rejects.toThrow('identificar');
  expect(sessionHeartRateService.read).not.toHaveBeenCalled();
  expect(global.fetch).not.toHaveBeenCalled();
});

test('empty new readings do not overwrite a saved record or trigger a POST', async () => {
  const original = acknowledged(), before = JSON.stringify(original);
  (sessionHeartRateService.read as jest.Mock).mockResolvedValue({ ...freshHeartRate(), samples: [], reason: 'Ainda não chegaram leituras deste treino.' });
  await expect(workoutHealthRefreshService.refresh(original, 'workout-a')).rejects.toThrow('Ainda não chegaram');
  expect(global.fetch).not.toHaveBeenCalled();
  expect(JSON.stringify(original)).toBe(before);
});

test('an account change while reading native data drops the response before posting', async () => {
  (sessionHeartRateService.read as jest.Mock).mockImplementation(async () => {
    authState.currentUser = { uid: 'athlete-b', getIdToken: jest.fn().mockResolvedValue('token-b') };
    return freshHeartRate();
  });
  await expect(workoutHealthRefreshService.refresh(savedRecord(), 'workout-a')).resolves.toBeNull();
  expect(global.fetch).not.toHaveBeenCalled();
});

test('an account change while awaiting the server acknowledgement cannot expose the previous owner’s record', async () => {
  (global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => {
    authState.currentUser = { uid: 'athlete-b', getIdToken: jest.fn().mockResolvedValue('token-b') };
    return { healthSession: acknowledged() };
  } });
  await expect(workoutHealthRefreshService.refresh(savedRecord(), 'workout-a')).resolves.toBeNull();
});

test.each([
  ['missing record', () => undefined],
  ['malformed sample list', () => ({ ...acknowledged(), heartRate: { ...freshHeartRate(), samples: null } })],
  ['wrong session', () => ({ ...acknowledged(), sessionId: 'session-b' })],
  ['wrong beginning', () => ({ ...acknowledged(), startedAt: '2026-09-05T08:00:00.000Z' })],
  ['wrong ending', () => ({ ...acknowledged(), endedAt: '2026-09-05T10:00:00.000Z' })],
  ['wrong version', () => ({ ...acknowledged(), version: 2 })],
])('rejects an acknowledgement with %s and retains the caller record', async (_label, value) => {
  const original = savedRecord(), before = JSON.stringify(original);
  (global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => ({ healthSession: value() }) });
  await expect(workoutHealthRefreshService.refresh(original, 'workout-a')).rejects.toThrow('não confirmou');
  expect(JSON.stringify(original)).toBe(before);
});

test('shares one in-flight request per owner and workout, then permits a fresh user-requested retry', async () => {
  const reading = deferred<WorkoutHeartRateEvidence>();
  (sessionHeartRateService.read as jest.Mock).mockReturnValueOnce(reading.promise);
  const first = workoutHealthRefreshService.refresh(savedRecord(), 'workout-a');
  const second = workoutHealthRefreshService.refresh(savedRecord(), 'workout-a');
  expect(first).toBe(second);
  expect(sessionHeartRateService.read).toHaveBeenCalledTimes(1);
  reading.resolve(freshHeartRate());
  await Promise.all([first, second]);
  expect(global.fetch).toHaveBeenCalledTimes(1);
  await workoutHealthRefreshService.refresh(savedRecord(), 'workout-a');
  expect(sessionHeartRateService.read).toHaveBeenCalledTimes(2);
  expect(global.fetch).toHaveBeenCalledTimes(2);
});

test('different workouts do not share their in-flight request', async () => {
  const reading = deferred<WorkoutHeartRateEvidence>();
  (sessionHeartRateService.read as jest.Mock).mockReturnValue(reading.promise);
  const first = workoutHealthRefreshService.refresh(savedRecord(), 'workout-a');
  const second = workoutHealthRefreshService.refresh(savedRecord(), 'workout-b');
  expect(first).not.toBe(second);
  expect(sessionHeartRateService.read).toHaveBeenCalledTimes(2);
  reading.resolve(freshHeartRate());
  await Promise.all([first, second]);
  expect(global.fetch).toHaveBeenCalledTimes(2);
});

test('another owner never shares an outstanding request even for an identical workout identifier', async () => {
  const readingA = deferred<WorkoutHeartRateEvidence>();
  (sessionHeartRateService.read as jest.Mock).mockReturnValueOnce(readingA.promise);
  const first = workoutHealthRefreshService.refresh(savedRecord(), 'workout-a');
  authState.currentUser = { uid: 'athlete-b', getIdToken: jest.fn().mockResolvedValue('token-b') };
  const second = workoutHealthRefreshService.refresh(savedRecord(), 'workout-a');
  expect(first).not.toBe(second);
  readingA.resolve(freshHeartRate());
  const results = await Promise.all([first, second]);
  expect(results[0]).toBeNull();
  expect(results[1]).toEqual(acknowledged());
  expect(sessionHeartRateService.read).toHaveBeenCalledTimes(2);
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect((global.fetch as jest.Mock).mock.calls[0][1].headers.Authorization).toBe('Bearer token-b');
});

test('a token failure prevents posting and leaves the caller record unchanged', async () => {
  const original = savedRecord(), before = JSON.stringify(original);
  authState.currentUser!.getIdToken.mockRejectedValue(new Error('Authentication unavailable'));
  await expect(workoutHealthRefreshService.refresh(original, 'workout-a')).rejects.toThrow('Authentication unavailable');
  expect(global.fetch).not.toHaveBeenCalled();
  expect(JSON.stringify(original)).toBe(before);
});

test('a failed POST preserves the caller record and does not block the next retry', async () => {
  const original = acknowledged(), before = JSON.stringify(original);
  (global.fetch as jest.Mock).mockRejectedValueOnce(new TypeError('offline'));
  await expect(workoutHealthRefreshService.refresh(original, 'workout-a')).rejects.toThrow('offline');
  expect(JSON.stringify(original)).toBe(before);
  await expect(workoutHealthRefreshService.refresh(original, 'workout-a')).resolves.toEqual(acknowledged());
});

test('an HTTP rejection is not treated as acknowledgement even when a record is included', async () => {
  (global.fetch as jest.Mock).mockResolvedValue({ ok: false, json: async () => ({ error: 'Não foi possível atualizar este treino.', healthSession: acknowledged() }) });
  await expect(workoutHealthRefreshService.refresh(savedRecord(), 'workout-a')).rejects.toThrow('Não foi possível atualizar este treino');
});
