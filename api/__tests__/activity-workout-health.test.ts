import { activityService } from '../../src/services/activityService';
import { workoutSetJournal } from '../../src/services/workoutSetJournal';
import { sessionHeartRateService } from '../../src/services/sessionHeartRateService';
import { HealthDataCollector } from '../../src/services/healthDataCollector';
import { auth } from '../../src/firebase';
import { updateDoc } from 'firebase/firestore';

jest.mock('../../src/firebase', () => ({ auth: { currentUser: null }, db: {} }));
jest.mock('../../src/config', () => ({ API_CONFIG: { baseUrl: '' } }));
jest.mock('firebase/firestore', () => ({
  collection: jest.fn(), doc: jest.fn((_db, collectionName, id) => ({ collectionName, id })),
  updateDoc: jest.fn().mockResolvedValue(undefined), getDoc: jest.fn(), query: jest.fn(), where: jest.fn(), getDocs: jest.fn(), setDoc: jest.fn(),
}));
jest.mock('../../src/services/validationService', () => ({ validationService: { calculateDistance: jest.fn(() => 0) } }));
jest.mock('../../src/lib/locationUtils', () => ({ getCurrentLocation: jest.fn().mockResolvedValue({ lat: -23.55, lng: -46.63, accuracy: 10 }) }));
jest.mock('../../src/lib/imageCompression', () => ({ compressBase64Image: jest.fn(async value => value) }));
jest.mock('../../src/services/healthDataCollector', () => ({ HealthDataCollector: { collectForSession: jest.fn() } }));
jest.mock('../../src/config/cardioConfig', () => ({ getModalityConfig: jest.fn() }));
jest.mock('../../src/services/nativeBackgroundLocationService', () => ({ nativeBackgroundLocationService: {
  collectAndStop: jest.fn().mockResolvedValue([]), stop: jest.fn().mockResolvedValue(undefined), start: jest.fn().mockResolvedValue(undefined),
} }));
jest.mock('../../src/services/sessionHeartRateService', () => ({ sessionHeartRateService: { read: jest.fn() } }), { virtual: true });

const UID = 'athlete-a', SESSION = 'workout-a';
const start = Date.parse('2026-09-05T09:30:00Z');
const end = Date.parse('2026-09-05T10:00:00Z');
const iso = (minutes: number) => new Date(start + minutes * 60_000).toISOString();
const authState = auth as unknown as { currentUser: { uid: string; getIdToken: jest.Mock } | null };
const originalFetch = global.fetch;
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const store = new Map<string, string>();
const health = () => ({ status: 'available', source: 'health_connect', sourceKey: 'watch-a', fetchedAt: new Date(end).toISOString(), truncated: false,
  samples: [{ timestamp: iso(10), bpm: 198 }, { timestamp: iso(11), bpm: 204 }] });
const saveSession = (overrides: Record<string, unknown> = {}) => localStorage.setItem('current_activity_session', JSON.stringify({
  id: SESSION, userId: UID, type: 'workout', status: 'active', startTime: iso(0), requiresGpsDistance: false,
  isPaused: false, pausedMs: 0, checkpoints: [], hasExercises: false,
  plannedExercises: [{ id: 'squat', sets: 8, reps: 99, loadKg: 999 }],
  smartwatchData: { avgHeartRate: 155, pedometerSteps: 320 }, ...overrides,
}));
const startSet = (minute = 10) => workoutSetJournal.start(UID, SESSION, { exerciseId: 'squat', exerciseName: 'Agachamento', equipment: 'Barra' }, start + minute * 60_000);
const completeSet = () => {
  startSet();
  return workoutSetJournal.complete(UID, SESSION, { reps: 12, loadKg: 30 }, start + 11 * 60_000).sets[0];
};
const requestBody = () => JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);

beforeEach(() => {
  jest.clearAllMocks(); store.clear();
  jest.useFakeTimers({ now: end });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value); }, removeItem: (key: string) => { store.delete(key); },
  } });
  authState.currentUser = { uid: UID, getIdToken: jest.fn().mockResolvedValue('token-a') };
  (sessionHeartRateService.read as jest.Mock).mockResolvedValue(health());
  (HealthDataCollector.collectForSession as jest.Mock).mockResolvedValue({
    healthTelemetry: { avgHeartRate: 142, steps: 325, source: 'health_connect' },
    metricSources: { heartRate: 'health_connect', steps: 'device_pedometer', calories: 'server_estimated' },
  });
  global.fetch = jest.fn().mockImplementation(async (_url, options) => {
    const payload = JSON.parse(options.body);
    return { ok: true, json: async () => ({ success: true, status: 'approved', rankingPointsEarned: 17,
      workout: { id: 'saved-workout', status: 'valid', points: 9 }, healthSession: payload.healthSession,
    }) };
  });
  saveSession();
});

afterEach(() => {
  jest.restoreAllMocks(); jest.useRealTimers(); global.fetch = originalFetch;
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
  else Reflect.deleteProperty(globalThis, 'localStorage');
});

test('sends actual sets and point heart rates only in the private record, preserving competitive inputs and server points', async () => {
  const set = completeSet();
  const result = await activityService.endSession();
  const payload = requestBody();
  expect(payload.healthSession).toMatchObject({ version: 1, sessionId: SESSION, startedAt: iso(0), endedAt: iso(30), sets: [set], heartRate: health() });
  expect(payload.healthSession.sets[0]).toMatchObject({ reps: 12, loadKg: 30, status: 'completed' });
  expect(payload.avgHeartRate).toBe(142);
  expect(payload.healthTelemetry.avgHeartRate).toBe(142);
  expect(payload.smartwatchData.avgHeartRate).toBe(142);
  expect(payload.pedometerSteps).toBe(325);
  expect(payload.hasExercises).toBe(false);
  expect(payload.hasSensorOscillation).toBe(false);
  expect(payload.sensorTelemetry).toBeUndefined();
  expect(payload).not.toHaveProperty('points');
  expect(payload).not.toHaveProperty('rankingPointsEarned');
  expect(result.rankingPointsEarned).toBe(17);
  expect(result.workout?.points).toBe(9);
  expect(result.healthSession).toEqual(payload.healthSession);
  expect(workoutSetJournal.read(UID, SESSION).sets).toEqual([]);
  expect(localStorage.getItem('current_activity_session')).toBeNull();
});

test('planned exercises never create executed sets and private high heart rates never fill the competitive average', async () => {
  (HealthDataCollector.collectForSession as jest.Mock).mockResolvedValue({ metricSources: { calories: 'server_estimated' } });
  saveSession({ smartwatchData: undefined });
  await activityService.endSession();
  const payload = requestBody();
  expect(payload.healthSession.sets).toEqual([]);
  expect(payload.healthSession.heartRate.samples).toHaveLength(2);
  expect(payload.avgHeartRate).toBeUndefined();
  expect(payload.smartwatchData.avgHeartRate).toBeUndefined();
  expect(payload.hasExercises).toBe(false);
});

test('pause interrupts an open set and finishing never manufactures its results or counts paused duration', async () => {
  startSet(20);
  jest.setSystemTime(start + 25 * 60_000);
  activityService.pauseSession();
  jest.setSystemTime(end);
  await activityService.endSession();
  const payload = requestBody();
  expect(payload.durationMins).toBe(25);
  expect(payload.healthSession.sets).toHaveLength(1);
  expect(payload.healthSession.sets[0]).toMatchObject({ status: 'interrupted', reps: null, loadKg: null, endedAt: iso(25) });
  expect(payload.healthSession.endedAt).toBe(iso(30));
});

test('a slow health read does not lengthen the marked workout interval or final set', async () => {
  startSet(29);
  (sessionHeartRateService.read as jest.Mock).mockImplementation(async () => {
    jest.setSystemTime(end + 60_000);
    return health();
  });
  await activityService.endSession();
  const payload = requestBody();
  expect(payload.durationMins).toBe(30);
  expect(payload.healthSession.endedAt).toBe(iso(30));
  expect(payload.healthSession.sets[0]).toMatchObject({ status: 'interrupted', endedAt: iso(30), reps: null, loadKg: null });
});

test('missing heart readings do not block saving genuine sets and never become zero heart rate', async () => {
  const set = completeSet();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  (sessionHeartRateService.read as jest.Mock).mockRejectedValue(new Error('native unavailable'));
  await activityService.endSession();
  const payload = requestBody();
  expect(payload.healthSession.sets).toEqual([set]);
  expect(payload.healthSession.heartRate).toMatchObject({ status: 'unavailable', samples: [], fetchedAt: null });
  expect(payload.avgHeartRate).toBe(142);
});

test('failed activity submission retains the original completed sets and active session for retry', async () => {
  const set = completeSet();
  (global.fetch as jest.Mock).mockRejectedValue(new TypeError('offline'));
  await expect(activityService.endSession()).rejects.toThrow('A atividade continua salva');
  expect(workoutSetJournal.read(UID, SESSION).sets).toEqual([set]);
  expect(localStorage.getItem('current_activity_session')).not.toBeNull();
  expect(updateDoc).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ status: 'completed' }));
});

test('a different authenticated owner cannot read or submit another account’s active workout', async () => {
  completeSet();
  authState.currentUser = { uid: 'athlete-b', getIdToken: jest.fn().mockResolvedValue('token-b') };
  await expect(activityService.endSession()).rejects.toThrow('pertence a outra conta');
  expect(sessionHeartRateService.read).not.toHaveBeenCalled();
  expect(global.fetch).not.toHaveBeenCalled();
  expect(localStorage.getItem('current_activity_session')).not.toBeNull();
});

test('an account change during collection prevents posting private observations with a stale session', async () => {
  completeSet();
  (sessionHeartRateService.read as jest.Mock).mockImplementation(async () => {
    authState.currentUser = { uid: 'athlete-b', getIdToken: jest.fn().mockResolvedValue('token-b') };
    return health();
  });
  await expect(activityService.endSession()).rejects.toThrow('A conta mudou');
  expect(global.fetch).not.toHaveBeenCalled();
  expect(localStorage.getItem('current_activity_session')).not.toBeNull();
});

test('a presence-check response cannot expose the previous account’s health record after an account change', async () => {
  completeSet();
  (global.fetch as jest.Mock).mockImplementation(async (_url, options) => ({
    ok: true,
    json: async () => {
      authState.currentUser = { uid: 'athlete-b', getIdToken: jest.fn().mockResolvedValue('token-b') };
      return { presenceCheckRequired: true, presenceCheckId: 'presence-a', healthSession: JSON.parse(options.body).healthSession };
    },
  }));
  await expect(activityService.endSession()).rejects.toThrow('A conta mudou');
  expect(localStorage.getItem('current_activity_session')).not.toBeNull();
});
