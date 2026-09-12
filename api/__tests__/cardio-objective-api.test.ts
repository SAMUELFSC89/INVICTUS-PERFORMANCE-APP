import handler from '../_handlers/cardio-objective';
import { verifyAuth } from '../_lib/common';
import type { ObjectiveAnswers } from '../../src/core/cardioObjective/types';

const records = new Map<string, any>();
let serial = 0;
function reference(path: string): any {
  return {
    id: path.split('/').at(-1), path,
    collection: (name: string) => collection(`${path}/${name}`),
    get: async () => document(path),
  };
}
function document(path: string): any {
  return { id: path.split('/').at(-1), ref: reference(path), exists: records.has(path), data: () => structuredClone(records.get(path)) };
}
function collection(path: string, filters: Array<(v: any) => boolean> = [], order?: [string, string], count = Infinity, cursor?: string): any {
  return {
    doc: (id = `generated_${++serial}`) => reference(`${path}/${id}`),
    where: (field: string, op: string, value: any) => collection(path, [...filters, v => op === '==' ? v[field] === value : v[field] >= value], order, count, cursor),
    orderBy: (field: string, direction = 'asc') => collection(path, filters, [field, direction], count, cursor),
    limit: (limit: number) => collection(path, filters, order, limit, cursor),
    startAfter: (value: string) => collection(path, filters, order, count, value),
    get: async () => {
      let entries = [...records].filter(([key, value]) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/') && filters.every(f => f(value)));
      if (order) entries.sort((a, b) => String(a[1][order[0]]).localeCompare(String(b[1][order[0]])) * (order[1] === 'desc' ? -1 : 1));
      if (cursor && order) entries = entries.filter(([, value]) => order[1] === 'desc' ? value[order[0]] < cursor : value[order[0]] > cursor);
      const docs = entries.slice(0, count).map(([key]) => document(key));
      return { docs, empty: !docs.length };
    },
  };
}
jest.mock('../_lib/common', () => ({
  cors: jest.fn(() => false), verifyAuth: jest.fn(),
  db: {
    collection: (name: string) => collection(name),
    runTransaction: async (fn: (tx: any) => Promise<void>) => {
      const writes: Array<() => void> = [];
      await fn({
        get: (ref: any) => { if (writes.length) throw new Error('Read after write'); return ref.get(); },
        create: (ref: any, value: any) => { if (records.has(ref.path)) throw new Error('ALREADY_EXISTS'); writes.push(() => records.set(ref.path, structuredClone(value))); },
        set: (ref: any, value: any) => writes.push(() => records.set(ref.path, structuredClone(value))),
        update: (ref: any, value: any) => writes.push(() => records.set(ref.path, { ...records.get(ref.path), ...structuredClone(value) })),
      });
      writes.forEach(write => write());
    },
  },
}));
const now = '2026-09-07T12:00:00.000Z';
const answers: ObjectiveAnswers = { goalType: 'sedentary', walkingMinutes: 15, runningAbility: 'none', availableMinutes: 25, availableDays: [1, 3, 5], timeZone: 'America/Sao_Paulo', preferredMoment: 'morning', preferredActivity: 'walking', barrier: 'starting', confidenceScore: 8, safety: { screened: true, signals: [], medicalClearance: null }, productConsent: true };
async function request(body?: any, query: any = {}) {
  const result = { status: 200, body: undefined as any };
  const res: any = { status: (status: number) => { result.status = status; return res; }, json: (value: any) => { result.body = value; return res; } };
  await handler({ method: body ? 'POST' : 'GET', body, query }, res);
  return result;
}
async function create(customAnswers = answers) {
  const result = await request({ action: 'create', answers: customAnswers });
  expect(result.status).toBe(201);
  const journeyId = result.body.journey.id;
  const missionId = result.body.missions[0].id;
  return { journeyId, missionId };
}
beforeEach(() => {
  records.clear(); serial = 0;
  jest.useFakeTimers().setSystemTime(new Date(now));
  (verifyAuth as jest.Mock).mockResolvedValue({ uid: 'u' });
  records.set('users/u', { birthDate: '1990-01-01', height: 175, weight: 80 });
});
afterEach(() => jest.useRealTimers());

test('requires authentication and never exposes another account journey', async () => {
  (verifyAuth as jest.Mock).mockResolvedValue(null);
  expect((await request()).status).toBe(401);
  (verifyAuth as jest.Mock).mockResolvedValue({ uid: 'u' });
  records.set('cardio_objectives/other/journeys/private', { id: 'private' });
  expect((await request(undefined, { journeyId: 'private' })).status).toBe(404);
});
test('baseline profile summarizes canonical recent cardio and persists the snapshot', async () => {
  records.set('workouts/current_1', { userId: 'u', type: 'cardio', cardioType: 'running', timestamp: '2026-09-07T08:00:00.000Z', duration: 40, distance: 5, recordStatus: 'completed', status: 'completed' });
  records.set('workouts/current_2', { userId: 'u', type: 'cardio', cardioType: 'running', timestamp: '2026-09-05T08:00:00.000Z', duration: 30, distance: 4, recordStatus: 'completed', status: 'completed' });
  records.set('workouts/previous_1', { userId: 'u', type: 'cardio', cardioType: 'bike', timestamp: '2026-08-30T08:00:00.000Z', duration: 20, distance: 8, recordStatus: 'completed', status: 'completed' });
  records.set('workouts/previous_2', { userId: 'u', type: 'cardio', cardioType: 'bike', timestamp: '2026-08-29T08:00:00.000Z', duration: 20, distance: 7, recordStatus: 'completed', status: 'completed' });
  records.set('workouts/rejected', { userId: 'u', type: 'cardio', cardioType: 'running', timestamp: '2026-09-06T08:00:00.000Z', duration: 90, distance: 15, recordStatus: 'completed', status: 'suspicious' });

  const initial = await request();
  expect(initial.status).toBe(200);
  expect(initial.body.profile.cardioHistory).toMatchObject({
    sessions7d: 2,
    sessions28d: 4,
    activeDays7d: 2,
    activeDays28d: 4,
    minutes7d: 70,
    previous7dMinutes: 40,
    minutes28d: 110,
    averageSessionMinutes28d: 27.5,
    longestSessionMinutes28d: 40,
    loadRatio7d: 1.8,
    loadTrend: 'spiking',
  });
  expect(initial.body.profile.recentLongestRunKm).toBe(5);

  const ids = await create({ ...answers, goalType: 'conditioning', walkingMinutes: 45, runningAbility: 'regular', preferredActivity: 'running', availableMinutes: 40 });
  const baseline = records.get(`cardio_objectives/u/journeys/${ids.journeyId}/baselines/initial`);
  expect(baseline.profile.cardioHistory).toMatchObject({ sessions28d: 4, minutes28d: 110, loadTrend: 'spiking' });
  expect(baseline.evidenceDecisionTrace.map((item: any) => item.id)).toEqual(expect.arrayContaining(['observed_training_history', 'recent_load_change']));
});
test('immutable baseline and exact future missions remain private', async () => {
  const created = await create();
  const result = await request();
  expect(result.body.missions[1]).toEqual({ id: 'w1_1', state: 'locked', week: 1 });
  expect((await request({ action: 'create', answers })).status).toBe(409);
  expect(records.get(`cardio_objectives/u/journeys/${created.journeyId}/baselines/initial`).answers).toEqual(answers);
});
test('missing session is retryable; wrong owner is not; binding is idempotent', async () => {
  const ids = await create();
  const body = { action: 'start', ...ids, sessionId: 's' };
  expect((await request(body)).status).toBe(425);
  records.set('active_sessions/s', { userId: 'other', type: 'cardio', cardioType: 'walking', startTime: now, status: 'active' });
  expect((await request(body)).status).toBe(400);
  records.get('active_sessions/s').userId = 'u';
  expect((await request(body)).status).toBe(200);
  expect((await request(body)).status).toBe(200);
  expect([...records.keys()].filter(k => k.endsWith('/session_claims/s'))).toHaveLength(1);
});
test('only persisted eligible activity advances mission; retries never double count', async () => {
  const ids = await create();
  records.set('active_sessions/s', { userId: 'u', type: 'cardio', cardioType: 'walking', startTime: now, status: 'active' });
  await request({ action: 'start', ...ids, sessionId: 's' });
  const completion = { action: 'complete', ...ids, activityId: 'a', duration: 999 };
  expect((await request(completion)).status).toBe(409);
  records.set('workouts/a', { userId: 'other', type: 'cardio', cardioType: 'walking', sessionId: 's', startTime: now, duration: 15, distance: 1, recordStatus: 'completed' });
  expect((await request(completion)).status).toBe(409);
  records.get('workouts/a').userId = 'u';
  expect((await request(completion)).body.journey.totalCompleted).toBe(1);
  expect((await request(completion)).body.journey.totalCompleted).toBe(1);
});
test('cancel preserves records and permits a new independent baseline', async () => {
  const ids = await create();
  expect((await request({ action: 'cancel', journeyId: ids.journeyId })).status).toBe(200);
  expect((await request(undefined, { new: 'true' })).body.journey).toBeNull();
  const next = await create();
  expect(next.journeyId).not.toBe(ids.journeyId);
  expect(records.has(`cardio_objectives/u/journeys/${ids.journeyId}/baselines/initial`)).toBe(true);
  expect((await request(undefined, { history: 'true' })).body.items).toHaveLength(2);
});
test('professional actions stay disabled regardless of client claims', async () => {
  expect((await request({ action: 'professional-book', partnerId: 'fake', consent: true })).status).toBe(409);
  expect((await request({ action: 'research-consent', granted: true })).status).toBe(409);
});
test('AI explanation cannot run before a deterministic weekly decision exists', async () => {
  const ids = await create();
  expect((await request({ action: 'explain', journeyId: ids.journeyId })).status).toBe(409);
});
test('weekly review uses a trusted synchronized weight when manual weight is absent', async () => {
  const weightAnswers: ObjectiveAnswers = { ...answers, goalType: 'lose_weight', weightConfirmed: true, currentWeightKg: 90, loseKg: 5, nutrition: { meals: '3', hardestTime: 'night', frequencies: {} } };
  const ids = await create(weightAnswers);
  records.set('health_samples/sensor_weight', { userId: 'u', metricType: 'weight_kg', value: 88.7, timestamp: '2026-09-14T10:00:00.000Z', source: 'apple_health', quality: 'sensor_verified' });
  jest.setSystemTime(new Date('2026-09-14T12:00:00.000Z'));
  const result = await request({ action: 'review', journeyId: ids.journeyId, week: 1, answers: { difficulty: 'appropriate', energy: 'good', confidenceScore: 8, habitAdherence: 'yes', barrier: 'starting', safety: answers.safety } });
  expect(result.status).toBe(200);
  expect(records.get(`cardio_objectives/u/journeys/${ids.journeyId}/weights/week_1`)).toMatchObject({ kg: 88.7, measuredAt: '2026-09-14T10:00:00.000Z', source: 'apple_health', sourceId: 'sensor_weight' });
});
test('expired week must be reviewed before another mission starts', async () => {
  const ids = await create();
  jest.setSystemTime(new Date('2026-09-15T12:00:00.000Z'));
  records.set('active_sessions/s', { userId: 'u', type: 'cardio', cardioType: 'walking', startTime: '2026-09-15T12:00:00.000Z', status: 'active' });
  expect((await request({ action: 'start', ...ids, sessionId: 's' })).status).toBe(409);
});
test('reschedule preserves the original mission as history and creates one replacement', async () => {
  const ids = await create();
  const result = await request({ action: 'reschedule', ...ids, localDate: '2026-09-08' });
  expect(result.status).toBe(200);
  expect(records.get(`cardio_objectives/u/journeys/${ids.journeyId}/missions/${ids.missionId}`).state).toBe('rescheduled');
  const replacements = result.body.missions.filter((mission: any) => mission.id.startsWith(`${ids.missionId}_r`));
  expect(replacements).toHaveLength(1);
  expect(replacements[0]).toMatchObject({ state: 'available', localDate: '2026-09-08' });
});
test('distance objective completes from persisted distance and records achievements', async () => {
  const ids = await create({ ...answers, goalType: 'run_5k', runningAbility: 'minutes', preferredActivity: 'running' });
  records.set('active_sessions/s', { userId: 'u', type: 'cardio', cardioType: 'running', startTime: now, status: 'active' });
  await request({ action: 'start', ...ids, sessionId: 's' });
  records.set('workouts/a', { userId: 'u', type: 'cardio', cardioType: 'running', sessionId: 's', startTime: now, duration: 35, distance: 5, recordStatus: 'completed' });
  const result = await request({ action: 'complete', ...ids, activityId: 'a' });
  expect(result.body.journey).toMatchObject({ status: 'completed', totalCompleted: 1 });
  expect(result.body.achievements.map((item: any) => item.id)).toEqual(expect.arrayContaining(['goal_completed', 'first_run', 'first_km', 'first_5k']));
});
test('persisted activity recovers an objective link if initial session publication raced', async () => {
  const ids = await create();
  records.set('workouts/a', { userId: 'u', type: 'cardio', cardioType: 'walking', sessionId: 'late-session', startTime: now, duration: 15, distance: 1, recordStatus: 'completed' });
  const result = await request({ action: 'complete', ...ids, activityId: 'a' });
  expect(result.status).toBe(200);
  expect(result.body.journey.totalCompleted).toBe(1);
  expect(records.get('cardio_objectives/u/session_claims/late-session')).toMatchObject({ journeyId: ids.journeyId, missionId: ids.missionId, recoveredFromActivityId: 'a' });
});
test('recovery never accepts an activity from before the mission', async () => {
  const ids = await create();
  records.set('workouts/old', { userId: 'u', type: 'cardio', cardioType: 'walking', sessionId: 'old-session', startTime: '2026-09-06T12:00:00.000Z', duration: 60, distance: 10, recordStatus: 'completed' });
  expect((await request({ action: 'complete', ...ids, activityId: 'old' })).status).toBe(409);
  expect(records.get(`cardio_objectives/u/journeys/${ids.journeyId}`).totalCompleted).toBe(0);
});