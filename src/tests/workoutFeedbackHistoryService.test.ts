import { getDocs, limit, orderBy, where } from 'firebase/firestore';
import { auth } from '../firebase';
import { loadWorkoutFeedbackHistory, readWorkoutHealthRecord } from '../services/workoutFeedbackHistoryService';

jest.mock('../firebase', () => ({ auth: { currentUser: { uid: 'athlete-a' } }, db: {} }));
jest.mock('firebase/firestore', () => ({
  collection: jest.fn(() => 'workouts'), where: jest.fn((...args: unknown[]) => args),
  orderBy: jest.fn((...args: unknown[]) => args), limit: jest.fn((value: number) => value),
  query: jest.fn((...args: unknown[]) => args), getDocs: jest.fn(),
}));

const authState = auth as unknown as { currentUser: { uid: string } | null };
const record = (sessionId = 'session-a') => ({
  version: 1, sessionId, startedAt: '2026-09-01T10:00:00Z', endedAt: '2026-09-01T10:01:00Z', sets: [],
  heartRate: { status: 'pending', source: null, sourceKey: null, fetchedAt: null, truncated: false, samples: [] },
});
const document = (userId = 'athlete-a', sessionId = 'session-a') => ({ data: () => ({ userId, healthSession: record(sessionId) }) });

beforeEach(() => { jest.clearAllMocks(); authState.currentUser = { uid: 'athlete-a' }; });

test('queries only the authenticated owner with ordering and a 31-document sentinel; excludes a foreign record', async () => {
  (getDocs as jest.Mock).mockResolvedValue({ docs: [document(), document('athlete-b')] });
  const result = await loadWorkoutFeedbackHistory('athlete-a');
  expect(where).toHaveBeenCalledWith('userId', '==', 'athlete-a');
  expect(orderBy).toHaveBeenCalledWith('timestamp', 'desc');
  expect(limit).toHaveBeenCalledWith(31);
  expect(result.records).toHaveLength(1);
});

test('never queries another owner or a signed-out account', async () => {
  expect((await loadWorkoutFeedbackHistory('athlete-b')).status).toBe('unavailable');
  authState.currentUser = null;
  expect((await loadWorkoutFeedbackHistory('athlete-a')).records).toEqual([]);
  expect(getDocs).not.toHaveBeenCalled();
});

test('drops an in-flight response when the authenticated account changes', async () => {
  (getDocs as jest.Mock).mockImplementation(async () => {
    authState.currentUser = { uid: 'athlete-b' };
    return { docs: [document()] };
  });
  expect((await loadWorkoutFeedbackHistory('athlete-a')).records).toEqual([]);
});

test('bounds comparison records and discloses truncation', async () => {
  (getDocs as jest.Mock).mockResolvedValue({ docs: Array.from({ length: 31 }, (_, index) => document('athlete-a', `session-${index}`)) });
  const result = await loadWorkoutFeedbackHistory('athlete-a');
  expect(result.records).toHaveLength(30);
  expect(result.reviewedCount).toBe(30);
  expect(result.limitReached).toBe(true);
});

test('malformed records and network failure do not break the current workout', async () => {
  const malformed = { ...record(), sets: [null] };
  expect(readWorkoutHealthRecord(malformed)).toBeNull();
  expect(readWorkoutHealthRecord({ ...record(), heartRate: { ...record().heartRate, samples: [null] } })).toBeNull();
  expect(readWorkoutHealthRecord(record())).not.toBeNull();
  (getDocs as jest.Mock).mockRejectedValue(new Error('offline'));
  expect((await loadWorkoutFeedbackHistory('athlete-a')).status).toBe('unavailable');
});
