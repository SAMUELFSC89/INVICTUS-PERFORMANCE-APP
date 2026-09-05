jest.mock('../../src/firebase', () => ({ auth: { currentUser: { uid: 'athlete-a' } } }));

import { auth } from '../../src/firebase';
import { MAX_RECORDED_SETS, workoutSetJournal } from '../../src/services/workoutSetJournal';

const exercise = { exerciseId: 'barbell_bench_press', exerciseName: 'Supino reto', equipment: 'barra e banco reto' };
const startAt = Date.parse('2026-09-05T10:00:00.000Z');
let stored: Map<string, string>;

beforeEach(() => {
  stored = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: jest.fn((key: string) => stored.get(key) ?? null),
    setItem: jest.fn((key: string, value: string) => { stored.set(key, value); }),
    removeItem: jest.fn((key: string) => { stored.delete(key); }),
  } });
  (auth as any).currentUser = { uid: 'athlete-a' };
});

test('reading or selecting an exercise does not invent a performed set', () => {
  expect(workoutSetJournal.read('athlete-a', 'session-1')).toEqual({ sets: [], active: null });
  expect(localStorage.setItem).not.toHaveBeenCalled();
});

test('only explicit start and completion produce a user-marked interval; absent results stay null', () => {
  const opened = workoutSetJournal.start('athlete-a', 'session-1', exercise, startAt);
  expect(opened.sets).toEqual([]);
  expect(opened.active).toMatchObject({ ...exercise, startedAt: new Date(startAt).toISOString(), timingSource: 'user_marked' });
  const finished = workoutSetJournal.complete('athlete-a', 'session-1', { reps: null, loadKg: null }, startAt + 35_000);
  expect(finished.active).toBeNull();
  expect(finished.sets[0]).toMatchObject({ ...exercise, status: 'completed', reps: null, loadKg: null, endedAt: new Date(startAt + 35_000).toISOString() });
  expect(JSON.parse([...stored.values()][0])).not.toHaveProperty('hasExercises');
});

test('persists actual user-entered repetitions and zero external load without importing planned fields', () => {
  workoutSetJournal.start('athlete-a', 'session-1', { ...exercise, initialLoadKg: 40, repsMin: 8 } as any, startAt);
  const result = workoutSetJournal.complete('athlete-a', 'session-1', { reps: 11, loadKg: 0 }, startAt + 30_000);
  expect(result.sets[0]).toMatchObject({ reps: 11, loadKg: 0 });
  expect(result.sets[0]).not.toHaveProperty('initialLoadKg');
  expect(result.sets[0]).not.toHaveProperty('repsMin');
});

test('typing results after completion does not extend the actual marked interval', () => {
  workoutSetJournal.start('athlete-a', 'session-1', exercise, startAt);
  const completed = workoutSetJournal.complete('athlete-a', 'session-1', { reps: null, loadKg: null }, startAt + 30_000);
  const result = workoutSetJournal.updateResults('athlete-a', 'session-1', completed.sets[0].id, { reps: 12, loadKg: 35 });
  expect(result.sets[0]).toMatchObject({ reps: 12, loadKg: 35, startedAt: new Date(startAt).toISOString(), endedAt: new Date(startAt + 30_000).toISOString() });
  expect(result.active).toBeNull();
});

test('result annotation cannot turn interrupted execution into a completed set', () => {
  workoutSetJournal.start('athlete-a', 'session-1', exercise, startAt);
  const interrupted = workoutSetJournal.interrupt('athlete-a', 'session-1', startAt + 30_000);
  expect(() => workoutSetJournal.updateResults('athlete-a', 'session-1', interrupted.sets[0].id, { reps: 12, loadKg: 35 })).toThrow(/concluída/);
  expect(workoutSetJournal.read('athlete-a', 'session-1').sets[0].status).toBe('interrupted');
});

test('same session identifier is isolated by authenticated account and cannot be cleared by another account', () => {
  workoutSetJournal.start('athlete-a', 'same-session', exercise, startAt);
  (auth as any).currentUser = { uid: 'athlete-b' };
  expect(workoutSetJournal.read('athlete-a', 'same-session')).toEqual({ sets: [], active: null });
  expect(() => workoutSetJournal.complete('athlete-a', 'same-session', { reps: 10, loadKg: 20 }, startAt + 20_000)).toThrow(/conta/);
  expect(() => workoutSetJournal.clear('athlete-a', 'same-session')).toThrow(/conta/);
  workoutSetJournal.start('athlete-b', 'same-session', { ...exercise, exerciseId: 'leg_press' }, startAt);
  expect(stored.size).toBe(2);
  (auth as any).currentUser = { uid: 'athlete-a' };
  expect(workoutSetJournal.read('athlete-a', 'same-session').active?.exerciseId).toBe(exercise.exerciseId);
});

test('sessions within an account stay independent and persisted active series can be restored', () => {
  workoutSetJournal.start('athlete-a', 'session-1', exercise, startAt);
  workoutSetJournal.start('athlete-a', 'session-2', { ...exercise, exerciseId: 'leg_press' }, startAt);
  expect(workoutSetJournal.read('athlete-a', 'session-1').active?.exerciseId).toBe(exercise.exerciseId);
  workoutSetJournal.clear('athlete-a', 'session-2');
  expect(workoutSetJournal.read('athlete-a', 'session-1').active).not.toBeNull();
});

test('missing login cannot read or mutate a journal', () => {
  workoutSetJournal.start('athlete-a', 'session-1', exercise, startAt);
  (auth as any).currentUser = null;
  expect(workoutSetJournal.read('athlete-a', 'session-1')).toEqual({ sets: [], active: null });
  expect(() => workoutSetJournal.interrupt('athlete-a', 'session-1', startAt + 10_000)).toThrow(/conta/);
});

test('copied storage envelopes do not expose another user or session', () => {
  workoutSetJournal.start('athlete-a', 'session-1', exercise, startAt);
  const key = [...stored.keys()][0];
  const envelope = JSON.parse(stored.get(key)!);
  stored.set(key, JSON.stringify({ ...envelope, uid: 'athlete-b' }));
  expect(workoutSetJournal.read('athlete-a', 'session-1').active).toBeNull();
  stored.set(key, JSON.stringify({ ...envelope, sessionId: 'another-session' }));
  expect(workoutSetJournal.read('athlete-a', 'session-1').active).toBeNull();
});

test('overlapping starts are refused without closing or replacing the existing active set', () => {
  workoutSetJournal.start('athlete-a', 'session-1', exercise, startAt);
  expect(() => workoutSetJournal.start('athlete-a', 'session-1', { ...exercise, exerciseId: 'other' }, startAt + 1000)).toThrow(/aberta/);
  expect(workoutSetJournal.read('athlete-a', 'session-1').active?.exerciseId).toBe(exercise.exerciseId);
});

test('pause/exercise switch interruption is idempotent and never reports completed repetitions', () => {
  workoutSetJournal.start('athlete-a', 'session-1', exercise, startAt);
  const interrupted = workoutSetJournal.interrupt('athlete-a', 'session-1', startAt + 13_000);
  expect(interrupted.sets[0]).toMatchObject({ status: 'interrupted', reps: null, loadKg: null });
  expect(workoutSetJournal.interrupt('athlete-a', 'session-1', startAt + 20_000)).toEqual(interrupted);
  expect(() => workoutSetJournal.complete('athlete-a', 'session-1', { reps: 10, loadKg: 20 }, startAt + 21_000)).toThrow(/Inicie/);
});

test('ending a session preserves completed sets and marks the open one interrupted until server acknowledgement', () => {
  workoutSetJournal.start('athlete-a', 'session-1', exercise, startAt);
  workoutSetJournal.complete('athlete-a', 'session-1', { reps: 9, loadKg: 50 }, startAt + 30_000);
  workoutSetJournal.start('athlete-a', 'session-1', exercise, startAt + 120_000);
  const result = workoutSetJournal.finish('athlete-a', 'session-1', startAt + 140_000);
  expect(result.map(set => set.status)).toEqual(['completed', 'interrupted']);
  expect(workoutSetJournal.read('athlete-a', 'session-1').sets).toEqual(result);
  workoutSetJournal.clear('athlete-a', 'session-1');
  expect(workoutSetJournal.read('athlete-a', 'session-1')).toEqual({ sets: [], active: null });
});

test.each([{ reps: 0, loadKg: 20 }, { reps: 2.5, loadKg: 20 }, { reps: 1001, loadKg: 20 }, { reps: 10, loadKg: -1 }, { reps: 10, loadKg: NaN }])('rejects invalid actual results %j without ending the set', (invalid) => {
  workoutSetJournal.start('athlete-a', 'session-1', exercise, startAt);
  expect(() => workoutSetJournal.complete('athlete-a', 'session-1', invalid, startAt + 30_000)).toThrow(/Informe/);
  expect(workoutSetJournal.read('athlete-a', 'session-1').active).not.toBeNull();
});

test('backward clock cannot create a completed interval; interruption retains the actual action time', () => {
  workoutSetJournal.start('athlete-a', 'session-1', exercise, startAt);
  expect(() => workoutSetJournal.complete('athlete-a', 'session-1', { reps: 10, loadKg: 20 }, startAt - 1000)).toThrow(/horário|relógio/);
  const interrupted = workoutSetJournal.interrupt('athlete-a', 'session-1', startAt - 1000);
  expect(interrupted.sets[0]).toMatchObject({ status: 'interrupted', endedAt: new Date(startAt - 1000).toISOString() });
});

test('storage write failure is surfaced and does not pretend a completed set was saved', () => {
  workoutSetJournal.start('athlete-a', 'session-1', exercise, startAt);
  (localStorage.setItem as jest.Mock).mockImplementation(() => { throw new Error('quota'); });
  expect(() => workoutSetJournal.complete('athlete-a', 'session-1', { reps: 10, loadKg: 20 }, startAt + 30_000)).toThrow(/salvar/);
  expect(workoutSetJournal.read('athlete-a', 'session-1').sets).toHaveLength(0);
  expect(workoutSetJournal.read('athlete-a', 'session-1').active).not.toBeNull();
});

test('session record cap prevents unbounded local data', () => {
  for (let index = 0; index < MAX_RECORDED_SETS; index++) {
    workoutSetJournal.start('athlete-a', 'session-1', exercise, startAt + index * 60_000);
    workoutSetJournal.complete('athlete-a', 'session-1', { reps: 10, loadKg: null }, startAt + index * 60_000 + 30_000);
  }
  expect(() => workoutSetJournal.start('athlete-a', 'session-1', exercise, startAt + MAX_RECORDED_SETS * 60_000)).toThrow(/limite/);
  expect(workoutSetJournal.read('athlete-a', 'session-1').sets).toHaveLength(MAX_RECORDED_SETS);
});
