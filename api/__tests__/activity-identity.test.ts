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

beforeEach(() => { mockDb = createTransactionalDb(); });

test('reserva concorrente entre fontes elege uma única atividade canônica', async () => {
  const base = {
    userId: 'user-a', type: 'cardio', cardioType: 'corrida',
    startTime: '2026-09-06T10:02:00.000Z', durationMinutes: 35,
  };
  const [strava, health] = await Promise.all([
    reserveActivityIdentity({ ...base, activityId: 'strava-a', source: 'strava' }),
    reserveActivityIdentity({ ...base, activityId: 'health-a', source: 'health_connect' }),
  ]);

  expect([strava.status, health.status].sort()).toEqual(['claimed', 'pending']);
  const canonical = strava.status === 'claimed' ? 'strava-a' : 'health-a';
  mockDb.store.set(`workouts/${canonical}`, { userId: 'user-a', economyEligible: true });
  const retry = await reserveActivityIdentity({
    ...base,
    activityId: canonical === 'strava-a' ? 'health-a' : 'strava-a',
    source: canonical === 'strava-a' ? 'health_connect' : 'strava',
  });
  expect(retry).toEqual({ status: 'duplicate', canonicalActivityId: canonical });
});

test('modalidades divergentes e sobrepostas continuam sendo uma única atividade física', async () => {
  const first = await reserveActivityIdentity({
    userId: 'user-a', activityId: 'cardio-a', type: 'cardio', cardioType: 'corrida',
    startTime: '2026-09-06T10:00:00.000Z', durationMinutes: 30, source: 'invictus',
  });
  const secondPending = await reserveActivityIdentity({
    userId: 'user-a', activityId: 'strength-a', type: 'workout',
    startTime: '2026-09-06T10:00:00.000Z', durationMinutes: 30, source: 'invictus',
  });
  expect(first.status).toBe('claimed');
  expect(secondPending.status).toBe('pending');
  mockDb.store.set('workouts/cardio-a', { userId: 'user-a', economyEligible: true });
  const secondRetry = await reserveActivityIdentity({
    userId: 'user-a', activityId: 'strength-a', type: 'workout',
    startTime: '2026-09-06T10:00:00.000Z', durationMinutes: 30, source: 'invictus',
  });
  expect(secondRetry).toEqual({ status: 'duplicate', canonicalActivityId: 'cardio-a' });
});

test('usa o fim real para reconhecer a mesma sessão mesmo com longas pausas', async () => {
  await reserveActivityIdentity({
    userId: 'user-a', activityId: 'paused-native', type: 'cardio', cardioType: 'corrida',
    startTime: '2026-09-06T10:00:00.000Z', endTime: '2026-09-06T11:00:00.000Z',
    durationMinutes: 20, source: 'invictus',
  });
  const wearable = await reserveActivityIdentity({
    userId: 'user-a', activityId: 'paused-wearable', type: 'cardio', cardioType: 'corrida',
    startTime: '2026-09-06T10:30:00.000Z', endTime: '2026-09-06T11:00:00.000Z',
    durationMinutes: 30, source: 'health_connect',
  });
  expect(wearable).toEqual({ status: 'pending', canonicalActivityId: 'paused-native' });
});

test('não funde duas sessões consecutivas com apenas um segundo de sobreposição', async () => {
  await reserveActivityIdentity({
    userId: 'user-a', activityId: 'first-session', type: 'workout',
    startTime: '2026-09-06T10:00:00.000Z', endTime: '2026-09-06T10:30:00.000Z',
    durationMinutes: 30, source: 'invictus',
  });
  const second = await reserveActivityIdentity({
    userId: 'user-a', activityId: 'second-session', type: 'workout',
    startTime: '2026-09-06T10:29:59.000Z', endTime: '2026-09-06T11:00:00.000Z',
    durationMinutes: 30, source: 'invictus',
  });
  expect(second).toMatchObject({ status: 'claimed', canonicalActivityId: 'second-session' });
});

test('recupera uma reserva órfã após o lease e permite substituir canônico sem economia', async () => {
  jest.useFakeTimers().setSystemTime(new Date('2026-09-06T10:00:00.000Z'));
  try {
    await reserveActivityIdentity({
      userId: 'user-a', activityId: 'orphan', type: 'cardio', cardioType: 'corrida',
      startTime: '2026-09-06T09:00:00.000Z', durationMinutes: 30, source: 'strava',
    });
    jest.setSystemTime(new Date('2026-09-06T10:06:00.000Z'));
    const takeover = await reserveActivityIdentity({
      userId: 'user-a', activityId: 'takeover', type: 'cardio', cardioType: 'corrida',
      startTime: '2026-09-06T09:00:00.000Z', durationMinutes: 30, source: 'health_connect',
    });
    expect(takeover).toMatchObject({ status: 'claimed', canonicalActivityId: 'takeover' });

    mockDb.store.set('workouts/takeover', {
      userId: 'user-a', economyEligible: false, isScoringEligible: false,
    });
    const verified = await reserveActivityIdentity({
      userId: 'user-a', activityId: 'verified', type: 'cardio', cardioType: 'corrida',
      startTime: '2026-09-06T09:00:00.000Z', durationMinutes: 30, source: 'invictus',
    });
    expect(verified).toMatchObject({ status: 'claimed', canonicalActivityId: 'verified' });
  } finally {
    jest.useRealTimers();
  }
});

test('token de fencing impede o dono antigo de gravar depois do takeover', async () => {
  jest.useFakeTimers().setSystemTime(new Date('2026-09-06T10:00:00.000Z'));
  try {
    const input = {
      userId: 'user-a', type: 'cardio', cardioType: 'corrida',
      startTime: '2026-09-06T09:00:00.000Z', durationMinutes: 30,
    };
    const oldReservation = await reserveActivityIdentity({
      ...input, activityId: 'old-owner', source: 'strava',
    });
    expect(oldReservation.status).toBe('claimed');

    jest.setSystemTime(new Date('2026-09-06T10:06:00.000Z'));
    const newReservation = await reserveActivityIdentity({
      ...input, activityId: 'new-owner', source: 'health_connect',
    });
    expect(newReservation.status).toBe('claimed');
    if (oldReservation.status !== 'claimed' || newReservation.status !== 'claimed') throw new Error('setup inválido');

    await expect(commitActivityIdentityReservation({
      input: { ...input, activityId: 'old-owner', source: 'strava' },
      reservation: oldReservation,
      payload: { userId: 'user-a', dataQualityStatus: 'accepted' },
    })).resolves.toEqual({ status: 'lost' });
    expect(mockDb.store.has('workouts/old-owner')).toBe(false);

    await expect(commitActivityIdentityReservation({
      input: { ...input, activityId: 'new-owner', source: 'health_connect' },
      reservation: newReservation,
      payload: { userId: 'user-a', dataQualityStatus: 'accepted' },
    })).resolves.toEqual({ status: 'committed' });
    expect(mockDb.store.get('workouts/new-owner')).toMatchObject({
      userId: 'user-a',
      dataQualityStatus: 'accepted',
      identityReservationToken: newReservation.reservationToken,
    });
  } finally {
    jest.useRealTimers();
  }
});

test('retry da mesma atividade reutiliza o token de reserva', async () => {
  const input = {
    userId: 'user-a', activityId: 'same-owner', type: 'workout',
    startTime: '2026-09-06T10:00:00.000Z', durationMinutes: 30, source: 'invictus',
  };
  const first = await reserveActivityIdentity(input);
  const retry = await reserveActivityIdentity(input);
  expect(first.status).toBe('claimed');
  expect(retry.status).toBe('claimed');
  if (first.status === 'claimed' && retry.status === 'claimed') {
    expect(retry.reservationToken).toBe(first.reservationToken);
  }
});
