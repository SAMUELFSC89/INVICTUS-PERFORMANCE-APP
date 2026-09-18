type Stored = Record<string, any>;

function clone<T>(value: T): T {
  return value === undefined ? value : structuredClone(value);
}

/**
 * Mesmo fake Firestore mínimo usado em engagement-notifications.test.ts,
 * duplicado aqui para manter os arquivos de teste independentes.
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

import { runEngagementRule, brDayBoundsUTC } from '../_lib/engagement-notification-engine';
import { firstWorkoutOnboardingRule } from '../_lib/engagement-rules/first-workout-onboarding';
import { firstCardioOnboardingRule } from '../_lib/engagement-rules/first-cardio-onboarding';
import { powerLiftFirstVideoOnboardingRule } from '../_lib/engagement-rules/powerlift-first-video-onboarding';

// 2026-09-17 20:00 America/Sao_Paulo == 2026-09-17T23:00:00.000Z
const NOW = new Date('2026-09-17T23:00:00.000Z');
const { dayStartUTC } = brDayBoundsUTC(NOW);

/** ISO de cadastro que cai exatamente `offset` dias (calendário BR) atrás. */
function createdAtDaysAgo(offset: number): string {
  return new Date(dayStartUTC.getTime() - offset * 86_400_000 + 12 * 3_600_000).toISOString();
}

function activeUser(overrides: Stored = {}) {
  return {
    fcmTokens: ['token-fcm-1'],
    createdAt: createdAtDaysAgo(1),
    ...overrides,
  };
}

beforeEach(() => {
  notifyMock.mockClear();
});

describe.each([
  {
    label: 'primeiro treino de musculação',
    rule: firstWorkoutOnboardingRule,
    actionUrl: '/musculacao',
    doneCollection: 'workouts',
    doneDoc: { userId: 'user-1', type: 'workout' },
  },
  {
    label: 'primeiro cardio',
    rule: firstCardioOnboardingRule,
    actionUrl: '/activity',
    doneCollection: 'workouts',
    doneDoc: { userId: 'user-1', type: 'cardio' },
  },
  {
    label: 'primeiro vídeo de Power Lift',
    rule: powerLiftFirstVideoOnboardingRule,
    actionUrl: '/power',
    doneCollection: 'power_records',
    doneDoc: { userId: 'user-1' },
  },
])('$label (regra de onboarding)', ({ rule, actionUrl, doneCollection, doneDoc }) => {
  it('notifica no dia 1 após o cadastro quem ainda não fez a ação', async () => {
    mockDb = createMemoryDb({
      'push_device_tokens/hash1': { ownerUid: 'user-1', platform: 'android' },
      'users/user-1': activeUser({ createdAt: createdAtDaysAgo(1) }),
    });

    const summary = await runEngagementRule(rule, NOW);

    expect(summary.sent).toBe(1);
    expect(notifyMock).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1', type: 'system', actionUrl }));
  });

  it('notifica nos dias 3 e 7, mas não em outros dias (drip, não diário)', async () => {
    for (const offset of [0, 2, 4, 5, 6, 10]) {
      mockDb = createMemoryDb({
        'push_device_tokens/hash1': { ownerUid: 'user-1', platform: 'android' },
        'users/user-1': activeUser({ createdAt: createdAtDaysAgo(offset) }),
      });
      const summary = await runEngagementRule(rule, NOW);
      expect(summary.sent).toBe(0);
    }

    for (const offset of [3, 7]) {
      mockDb = createMemoryDb({
        'push_device_tokens/hash1': { ownerUid: 'user-1', platform: 'android' },
        'users/user-1': activeUser({ createdAt: createdAtDaysAgo(offset) }),
      });
      const summary = await runEngagementRule(rule, NOW);
      expect(summary.sent).toBe(1);
    }
  });

  it('não notifica quem já fez a ação, mesmo em um dia de drip válido', async () => {
    mockDb = createMemoryDb({
      'push_device_tokens/hash1': { ownerUid: 'user-1', platform: 'android' },
      'users/user-1': activeUser({ createdAt: createdAtDaysAgo(3) }),
      [`${doneCollection}/done-1`]: doneDoc,
    });

    const summary = await runEngagementRule(rule, NOW);

    expect(summary.sent).toBe(0);
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('não notifica conta inativa nem usuário sem token de push', async () => {
    mockDb = createMemoryDb({
      'push_device_tokens/hash1': { ownerUid: 'user-banido', platform: 'android' },
      'users/user-banido': activeUser({ createdAt: createdAtDaysAgo(1), status: 'banned' }),
      'push_device_tokens/hash2': { ownerUid: 'user-sem-token', platform: 'android' },
      'users/user-sem-token': activeUser({ createdAt: createdAtDaysAgo(1), fcmTokens: [] }),
    });

    const summary = await runEngagementRule(rule, NOW);

    expect(summary.sent).toBe(0);
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('é idempotente: rodar duas vezes no mesmo dia só envia uma vez', async () => {
    mockDb = createMemoryDb({
      'push_device_tokens/hash1': { ownerUid: 'user-1', platform: 'android' },
      'users/user-1': activeUser({ createdAt: createdAtDaysAgo(1) }),
    });

    const first = await runEngagementRule(rule, NOW);
    const second = await runEngagementRule(rule, NOW);

    expect(first.sent).toBe(1);
    expect(second.sent).toBe(0);
    expect(second.skippedAlreadySent).toBe(1);
    expect(notifyMock).toHaveBeenCalledTimes(1);
  });

  it('ignora cadastro sem data válida (createdAt ausente/inválido)', async () => {
    mockDb = createMemoryDb({
      'push_device_tokens/hash1': { ownerUid: 'user-1', platform: 'android' },
      'users/user-1': activeUser({ createdAt: undefined }),
    });

    const summary = await runEngagementRule(rule, NOW);

    expect(summary.sent).toBe(0);
    expect(notifyMock).not.toHaveBeenCalled();
  });
});
