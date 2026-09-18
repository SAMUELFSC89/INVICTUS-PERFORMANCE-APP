type Stored = Record<string, any>;

function clone<T>(value: T): T {
  return value === undefined ? value : structuredClone(value);
}

/**
 * Fake Firestore mínimo, só com o que o motor de notificações de engajamento
 * precisa: where('==' | '>=' | '<'), limit, get, doc().get()/create().
 */
function createMemoryDb(initial: Record<string, Stored> = {}) {
  const store = new Map<string, Stored>(Object.entries(initial).map(([key, value]) => [key, clone(value)]));

  const makeRef = (path: string) => ({
    path,
    id: path.split('/').at(-1),
    get: async () => makeSnapshot(path),
    create: async (value: Stored) => {
      if (store.has(path)) throw new Error(`Documento duplicado: ${path}`);
      store.set(path, clone(value));
    },
    set: async (value: Stored, options?: { merge?: boolean }) => {
      store.set(path, options?.merge ? { ...(store.get(path) || {}), ...clone(value) } : clone(value));
    },
  });

  const makeSnapshot = (path: string) => ({
    id: path.split('/').at(-1),
    ref: makeRef(path),
    exists: store.has(path),
    data: () => clone(store.get(path)),
  });

  const makeQuery = (
    collectionName: string,
    filters: Array<[string, string, unknown]> = [],
    maximum = Number.POSITIVE_INFINITY,
  ): any => ({
    doc: (id: string) => makeRef(`${collectionName}/${id}`),
    where: (field: string, operator: string, expected: unknown) => {
      if (!['==', '>=', '<', '<='].includes(operator)) throw new Error(`Operador não suportado no mock: ${operator}`);
      return makeQuery(collectionName, [...filters, [field, operator, expected]], maximum);
    },
    limit: (value: number) => makeQuery(collectionName, filters, value),
    get: async () => {
      const docs = [...store.keys()]
        .filter(key => key.startsWith(`${collectionName}/`) && key.split('/').length === 2)
        .filter(key => filters.every(([field, operator, expected]) => {
          const actual = store.get(key)?.[field];
          if (operator === '==') return actual === expected;
          if (operator === '>=') return actual !== undefined && actual >= (expected as any);
          if (operator === '<') return actual !== undefined && actual < (expected as any);
          return actual !== undefined && actual <= (expected as any);
        }))
        .slice(0, maximum)
        .map(makeSnapshot);
      return { docs, empty: docs.length === 0, size: docs.length };
    },
  });

  return {
    store,
    collection: (name: string) => makeQuery(name),
  };
}

let mockDb: any;
const notifyMock = jest.fn(async (..._args: any[]) => undefined);

jest.mock('../_lib/common', () => ({
  get db() { return mockDb; },
}));

jest.mock('../_services/notification-service', () => ({
  notificationService: { notify: (...args: any[]) => notifyMock(...args) },
}));

import { runEngagementRule } from '../_lib/engagement-notification-engine';
import { firstWorkoutOfDayReminderRule } from '../_lib/engagement-rules/first-workout-reminder';

// 2026-09-17 20:00 America/Sao_Paulo == 2026-09-17T23:00:00.000Z
const NOW = new Date('2026-09-17T23:00:00.000Z');

function activeUser(overrides: Stored = {}) {
  return {
    fcmTokens: ['token-fcm-1'],
    ...overrides,
  };
}

beforeEach(() => {
  notifyMock.mockClear();
});

describe('engagement notification engine', () => {
  it('não envia nada quando não há candidatos com push ativo', async () => {
    mockDb = createMemoryDb({});
    const summary = await runEngagementRule(firstWorkoutOfDayReminderRule, NOW);
    expect(summary).toEqual({ ruleId: 'first-workout-of-day', candidates: 0, sent: 0, skippedAlreadySent: 0, failed: 0 });
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('notifica usuário com push ativo que ainda não treinou hoje', async () => {
    mockDb = createMemoryDb({
      'push_device_tokens/hash1': { ownerUid: 'user-1', platform: 'android' },
      'users/user-1': activeUser(),
    });

    const summary = await runEngagementRule(firstWorkoutOfDayReminderRule, NOW);

    expect(summary.candidates).toBe(1);
    expect(summary.sent).toBe(1);
    expect(notifyMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      type: 'system',
      actionUrl: '/activity',
    }));
  });

  it('não notifica quem já treinou hoje', async () => {
    mockDb = createMemoryDb({
      'push_device_tokens/hash1': { ownerUid: 'user-1', platform: 'android' },
      'users/user-1': activeUser(),
      'workouts/w1': { userId: 'user-1', createdAt: '2026-09-17T18:00:00.000Z' },
    });

    const summary = await runEngagementRule(firstWorkoutOfDayReminderRule, NOW);

    expect(summary.sent).toBe(0);
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('ignora treino de ontem/amanhã (limite do dia local de Brasília)', async () => {
    mockDb = createMemoryDb({
      'push_device_tokens/hash1': { ownerUid: 'user-1', platform: 'android' },
      'users/user-1': activeUser(),
      // 2026-09-17T02:00:00Z ainda é 16/09 em Brasília (UTC-3)
      'workouts/w1': { userId: 'user-1', createdAt: '2026-09-17T02:00:00.000Z' },
    });

    const summary = await runEngagementRule(firstWorkoutOfDayReminderRule, NOW);

    expect(summary.sent).toBe(1);
  });

  it('não notifica conta inativa nem usuário sem token no perfil', async () => {
    mockDb = createMemoryDb({
      'push_device_tokens/hash1': { ownerUid: 'user-banido', platform: 'android' },
      'users/user-banido': activeUser({ status: 'banned' }),
      'push_device_tokens/hash2': { ownerUid: 'user-sem-token', platform: 'android' },
      'users/user-sem-token': activeUser({ fcmTokens: [] }),
    });

    const summary = await runEngagementRule(firstWorkoutOfDayReminderRule, NOW);

    expect(summary.sent).toBe(0);
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('é idempotente: rodar a regra duas vezes no mesmo dia só envia uma vez', async () => {
    mockDb = createMemoryDb({
      'push_device_tokens/hash1': { ownerUid: 'user-1', platform: 'android' },
      'users/user-1': activeUser(),
    });

    const first = await runEngagementRule(firstWorkoutOfDayReminderRule, NOW);
    const second = await runEngagementRule(firstWorkoutOfDayReminderRule, NOW);

    expect(first.sent).toBe(1);
    expect(second.sent).toBe(0);
    expect(second.skippedAlreadySent).toBe(1);
    expect(notifyMock).toHaveBeenCalledTimes(1);
  });

  it('deduplica o mesmo uid que aparece com mais de um token registrado', async () => {
    mockDb = createMemoryDb({
      'push_device_tokens/hash1': { ownerUid: 'user-1', platform: 'android' },
      'push_device_tokens/hash2': { ownerUid: 'user-1', platform: 'ios' },
      'users/user-1': activeUser(),
    });

    const summary = await runEngagementRule(firstWorkoutOfDayReminderRule, NOW);

    expect(summary.candidates).toBe(1);
    expect(notifyMock).toHaveBeenCalledTimes(1);
  });
});
