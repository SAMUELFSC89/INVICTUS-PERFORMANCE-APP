let mockDb: any;

jest.mock('../_lib/common', () => ({
  get db() { return mockDb; },
}));

import {
  commitActivityIdentityReservation,
  reserveActivityIdentity,
} from '../_lib/activity-identity';

function createTransactionalDb() {
  const store = new Map<string, Record<string, any>>();
  let queue = Promise.resolve();
  const ref = (collection: string, id: string) => ({ key: `${collection}/${id}` });
  return {
    store,
    collection: (collection: string) => ({ doc: (id: string) => ref(collection, id) }),
    runTransaction: (callback: (transaction: any) => Promise<any>) => {
      const run = queue.then(async () => {
        const writes: Array<{ target: any; value: Record<string, any>; merge?: boolean; create?: boolean }> = [];
        const transaction = {
          get: async (target: any) => ({
            exists: store.has(target.key),
            data: () => store.get(target.key),
          }),
          set: (target: any, value: Record<string, any>, options?: { merge?: boolean }) => {
            writes.push({ target, value, merge: options?.merge });
          },
          create: (target: any, value: Record<string, any>) => writes.push({ target, value, create: true }),
        };
        const result = await callback(transaction);
        writes.forEach(({ target, value, merge, create }) => {
          if (create && store.has(target.key)) throw new Error('already exists');
          store.set(target.key, merge ? { ...(store.get(target.key) || {}), ...value } : { ...value });
        });
        return result;
      });
      queue = run.then(() => undefined, () => undefined);
      return run;
    },
  };
}

beforeEach(() => {
  mockDb = createTransactionalDb();
});

describe('Gate 1 — stress de identidade Invictus/Strava/Health', () => {
  test('300 entregas concorrentes da mesma sessão elegem um único dono e convergem para uma única atividade', async () => {
    const base = {
      userId: 'stress-user',
      type: 'cardio' as const,
      cardioType: 'corrida',
      startTime: '2026-09-13T10:00:00.000Z',
      endTime: '2026-09-13T10:45:00.000Z',
      durationMinutes: 45,
    };
    const sources = ['invictus', 'strava', 'health_connect'] as const;
    const inputs = Array.from({ length: 300 }, (_, index) => ({
      ...base,
      activityId: `same-physical-session-${index}`,
      source: sources[index % sources.length],
    }));

    const firstWave = await Promise.all(inputs.map(input => reserveActivityIdentity(input)));
    const claimed = firstWave
      .map((result, index) => ({ result, input: inputs[index] }))
      .filter(item => item.result.status === 'claimed');
    expect(claimed).toHaveLength(1);
    expect(firstWave.filter(result => result.status === 'pending')).toHaveLength(299);

    const winner = claimed[0];
    if (winner.result.status !== 'claimed') throw new Error('winner inválido');
    await expect(commitActivityIdentityReservation({
      input: winner.input,
      reservation: winner.result,
      payload: {
        userId: base.userId,
        source: winner.input.source,
        economyEligible: true,
        missionEligible: true,
        recordStatus: 'completed',
      },
    })).resolves.toEqual({ status: 'committed' });

    const retryLosers = await Promise.all(inputs
      .filter(input => input.activityId !== winner.input.activityId)
      .map(input => reserveActivityIdentity(input)));
    expect(retryLosers.every(result => result.status === 'duplicate'
      && result.canonicalActivityId === winner.input.activityId)).toBe(true);

    const workoutKeys = [...mockDb.store.keys()].filter(key => key.startsWith('workouts/'));
    expect(workoutKeys).toEqual([`workouts/${winner.input.activityId}`]);
  }, 20_000);

  test('sessões sequenciais reais continuam separadas mesmo sob retries de três fontes', async () => {
    const sessions = Array.from({ length: 20 }, (_, index) => {
      const startMs = Date.parse('2026-09-13T06:00:00.000Z') + index * 40 * 60_000;
      return {
        startTime: new Date(startMs).toISOString(),
        endTime: new Date(startMs + 30 * 60_000).toISOString(),
      };
    });

    for (const [index, window] of sessions.entries()) {
      const nativeInput = {
        userId: 'stress-user-2', activityId: `native-${index}`,
        type: 'cardio' as const, cardioType: 'corrida', durationMinutes: 30,
        startTime: window.startTime, endTime: window.endTime, source: 'invictus',
      };
      const reservation = await reserveActivityIdentity(nativeInput);
      expect(reservation.status).toBe('claimed');
      if (reservation.status !== 'claimed') throw new Error('reserva inesperada');
      await commitActivityIdentityReservation({
        input: nativeInput,
        reservation,
        payload: { userId: 'stress-user-2', economyEligible: true, missionEligible: true },
      });

      for (const source of ['strava', 'health_connect'] as const) {
        const duplicate = await reserveActivityIdentity({
          ...nativeInput,
          activityId: `${source}-${index}`,
          source,
        });
        expect(duplicate).toEqual({ status: 'duplicate', canonicalActivityId: `native-${index}` });
      }
    }

    const workoutKeys = [...mockDb.store.keys()].filter(key => key.startsWith('workouts/'));
    expect(workoutKeys).toHaveLength(20);
  });
});
