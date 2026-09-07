jest.mock('../../src/firebase', () => ({ auth: { currentUser: { uid: 'athlete-rir' } } }));

import { workoutSetJournal } from '../../src/services/workoutSetJournal';

const startAt = Date.parse('2026-09-07T10:00:00.000Z');
const exercise = { exerciseId: 'barbell_bench_press', exerciseName: 'Supino reto', equipment: 'barra e banco reto' };
let stored: Map<string, string>;

beforeEach(() => {
  stored = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: jest.fn((key: string) => stored.get(key) ?? null),
    setItem: jest.fn((key: string, value: string) => { stored.set(key, value); }),
    removeItem: jest.fn((key: string) => { stored.delete(key); }),
  } });
});

test('persists actual RIR only after explicit user result entry', () => {
  workoutSetJournal.start('athlete-rir', 'session-rir', exercise, startAt);
  const completed = workoutSetJournal.complete('athlete-rir', 'session-rir', { reps: null, loadKg: null, actualRir: null }, startAt + 30_000);
  expect(completed.sets[0].actualRir).toBeNull();

  const result = workoutSetJournal.updateResults('athlete-rir', 'session-rir', completed.sets[0].id, { reps: 12, loadKg: 70, actualRir: 2 });
  expect(result.sets[0]).toMatchObject({ reps: 12, loadKg: 70, actualRir: 2 });
});

test.each([-1, 6, 1.5, Number.NaN])('rejects invalid RIR %p without replacing the recorded result', (actualRir) => {
  workoutSetJournal.start('athlete-rir', 'session-rir', exercise, startAt);
  const completed = workoutSetJournal.complete('athlete-rir', 'session-rir', { reps: 10, loadKg: 60 }, startAt + 30_000);
  expect(() => workoutSetJournal.updateResults('athlete-rir', 'session-rir', completed.sets[0].id, { reps: 10, loadKg: 60, actualRir })).toThrow(/RIR/);
  expect(workoutSetJournal.read('athlete-rir', 'session-rir').sets[0].actualRir).toBeNull();
});