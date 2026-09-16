let available = true;
let mockDb: any;

jest.mock('../_lib/common', () => ({
  get db() { return mockDb; },
  isDbAvailable: () => available,
}));

import { consumeDistributedRateLimit } from '../_lib/distributed-rate-limit';

function createDb() {
  const store = new Map<string, Record<string, any>>();
  const docRef = (collection: string, id: string) => ({ key: `${collection}/${id}` });
  const snapshot = (value?: Record<string, any>) => ({ exists: Boolean(value), data: () => value });
  return {
    store,
    collection: (collection: string) => ({ doc: (id: string) => docRef(collection, id) }),
    runTransaction: async (callback: (transaction: any) => Promise<any>) => {
      const writes: Array<{ key: string; value: Record<string, any>; merge: boolean }> = [];
      const transaction = {
        get: async (ref: any) => snapshot(store.get(ref.key)),
        set: (ref: any, value: Record<string, any>, options?: { merge?: boolean }) => {
          writes.push({ key: ref.key, value, merge: options?.merge === true });
        },
      };
      const result = await callback(transaction);
      writes.forEach(({ key, value, merge }) => {
        store.set(key, merge ? { ...(store.get(key) || {}), ...value } : value);
      });
      return result;
    },
  };
}

describe('distributed API rate limiter', () => {
  beforeEach(() => {
    available = true;
    mockDb = createDb();
    jest.useFakeTimers().setSystemTime(new Date('2026-09-15T20:00:00-03:00'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('shares one authoritative counter and blocks above the limit', async () => {
    const input = { scope: 'purchase', subjectId: 'user-a', windowMs: 60_000, maxRequests: 2 };
    await expect(consumeDistributedRateLimit(input)).resolves.toMatchObject({ allowed: true, remaining: 1 });
    await expect(consumeDistributedRateLimit(input)).resolves.toMatchObject({ allowed: true, remaining: 0 });
    await expect(consumeDistributedRateLimit(input)).resolves.toMatchObject({
      allowed: false,
      remaining: 0,
      reason: 'rate_limited',
    });
  });

  test('starts a fresh window after expiration', async () => {
    const input = { scope: 'purchase', subjectId: 'user-a', windowMs: 60_000, maxRequests: 1 };
    await expect(consumeDistributedRateLimit(input)).resolves.toMatchObject({ allowed: true });
    await expect(consumeDistributedRateLimit(input)).resolves.toMatchObject({ allowed: false });
    jest.setSystemTime(new Date('2026-09-15T20:01:01-03:00'));
    await expect(consumeDistributedRateLimit(input)).resolves.toMatchObject({ allowed: true, remaining: 0 });
  });

  test('fails closed when the authoritative store is unavailable', async () => {
    available = false;
    await expect(consumeDistributedRateLimit({
      scope: 'purchase', subjectId: 'user-a', windowMs: 60_000, maxRequests: 2,
    })).resolves.toMatchObject({
      allowed: false,
      reason: 'store_unavailable',
      remaining: 0,
    });
  });
});
