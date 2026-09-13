let mockDb: any;

jest.mock('../_lib/common', () => ({
  get db() { return mockDb; },
}));

jest.mock('../_lib/reward-coin-engine', () => ({
  RewardCoinEngine: { credit: jest.fn() },
}));

import { MissionEngine } from '../_lib/mission-engine';

type Stored = Record<string, any>;

function clone<T>(value: T): T {
  return value === undefined ? value : structuredClone(value);
}

function createDb(initial: Record<string, Stored>) {
  const store = new Map<string, Stored>(Object.entries(initial).map(([key, value]) => [key, clone(value)]));

  const snapshot = (key: string) => ({
    id: key.split('/').at(-1),
    exists: store.has(key),
    data: () => clone(store.get(key)),
  });

  const ref = (key: string) => ({
    key,
    id: key.split('/').at(-1),
    get: async () => snapshot(key),
    set: async (value: Stored, options?: { merge?: boolean }) => {
      store.set(key, options?.merge ? { ...(store.get(key) || {}), ...clone(value) } : clone(value));
    },
  });

  const query = (collectionName: string, filters: Array<[string, unknown]> = []) => ({
    where(field: string, operator: string, expected: unknown) {
      if (operator !== '==') throw new Error(`Unsupported test operator: ${operator}`);
      return query(collectionName, [...filters, [field, expected]]);
    },
    async get() {
      const docs = [...store.entries()]
        .filter(([key]) => key.startsWith(`${collectionName}/`) && key.split('/').length === 2)
        .filter(([, value]) => filters.every(([field, expected]) => value[field] === expected))
        .map(([key]) => ({ ...snapshot(key), ref: ref(key) }));
      return { docs, empty: docs.length === 0, size: docs.length };
    },
  });

  return {
    store,
    collection(collectionName: string) {
      return {
        doc: (id: string) => ref(`${collectionName}/${id}`),
        where: (field: string, operator: string, expected: unknown) => query(collectionName).where(field, operator, expected),
      };
    },
    async runTransaction(callback: (transaction: any) => Promise<any>) {
      const writes: Array<{ target: any; value: Stored; merge: boolean }> = [];
      const transaction = {
        get: async (target: any) => snapshot(target.key),
        set: (target: any, value: Stored, options?: { merge?: boolean }) => {
          writes.push({ target, value: clone(value), merge: options?.merge === true });
        },
      };
      const result = await callback(transaction);
      for (const write of writes) {
        store.set(write.target.key, write.merge
          ? { ...(store.get(write.target.key) || {}), ...write.value }
          : write.value);
      }
      return result;
    },
  };
}

function wearableActivity(evidenceStatus?: string): Stored {
  const now = new Date().toISOString();
  return {
    userId: 'user-a',
    type: 'cardio',
    source: 'health_connect',
    recordStatus: 'completed',
    status: 'completed',
    validationStatus: 'recorded',
    duration: 35,
    startTime: now,
    endTime: now,
    economyEligible: true,
    missionEligible: true,
    dataQualityStatus: 'accepted',
    ...(evidenceStatus ? { competitionEvidenceStatus: evidenceStatus } : {}),
  };
}

function currentProgressFor(missionId: string): number {
  const found = [...mockDb.store.entries()]
    .find(([key, value]) => key.startsWith('user_missions/') && value.missionId === missionId);
  return Number(found?.[1]?.currentProgress || 0);
}

beforeEach(() => {
  jest.clearAllMocks();
});

test('Health Connect legado com flags antigas não progride missão sem evidência confiável', async () => {
  mockDb = createDb({
    'workouts/legacy-health': wearableActivity(),
  });

  await MissionEngine.syncUserProgressFromCompletedActivities('user-a');

  expect(currentProgressFor('miss_motor_ligado')).toBe(0);
  expect(currentProgressFor('miss_guerreiro_hibrido')).toBe(0);
});

test('wearable com trusted_native_attestation pode entrar na reconstrução de missão', async () => {
  mockDb = createDb({
    'workouts/trusted-health': wearableActivity('trusted_native_attestation'),
  });

  await MissionEngine.syncUserProgressFromCompletedActivities('user-a');

  expect(currentProgressFor('miss_motor_ligado')).toBe(1);
});

test('flag trusted enviada em campo errado não abre o gate de missão', async () => {
  mockDb = createDb({
    'workouts/forged-health': {
      ...wearableActivity(),
      sourceVerified: true,
      trusted: true,
    },
  });

  await MissionEngine.syncUserProgressFromCompletedActivities('user-a');

  expect(currentProgressFor('miss_motor_ligado')).toBe(0);
});
