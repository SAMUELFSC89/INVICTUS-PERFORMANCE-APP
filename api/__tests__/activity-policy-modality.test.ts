let mockDb: any;

jest.mock('../_lib/common', () => ({
  get db() { return mockDb; },
}));
jest.mock('../_lib/championship-catalog', () => ({
  matchRuntimeActiveChampionshipsForActivity: jest.fn(async () => []),
}));

import { loadActivityCompetitionPolicySnapshot } from '../_lib/activity-competition-policy';
import { normalizeSessionPolicyModality } from '../_lib/modality-config';

const snapshot = (value: Record<string, any> | undefined) => ({
  exists: value !== undefined,
  id: 'policy-a',
  data: () => value,
});

function createDb(value?: Record<string, any>) {
  return {
    collection: () => ({
      doc: () => ({ get: async () => snapshot(value) }),
    }),
  };
}

describe('modalidade da autorização de atividade', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-06T12:00:00.000Z'));
    mockDb = createDb();
  });

  afterEach(() => jest.useRealTimers());

  test.each([
    ['running', false, true],
    ['walking', false, true],
    ['bike', false, true],
    ['treadmill', true, false],
    ['stationary_bike', true, false],
    ['elliptical', true, false],
    ['rowing', true, false],
    ['stair_climber', true, false],
    ['swimming', true, false],
    ['hiit', true, false],
  ])('deriva ambiente e GPS da modalidade canônica %s', (cardioType, indoor, gps) => {
    expect(normalizeSessionPolicyModality({
      activityType: ' CARDIO ', cardioType: ` ${cardioType.toUpperCase()} `,
    })).toEqual({ activityType: 'cardio', cardioType, isIndoorCardio: indoor, requiresGps: gps });
  });

  test.each([
    { activityType: 'cardio', cardioType: 'treadmill', isIndoorCardio: false },
    { activityType: 'cardio', cardioType: 'running', isIndoorCardio: true },
    { activityType: 'cardio' },
    { activityType: 'cardio', cardioType: 'corrida' },
    { activityType: 'workout', cardioType: 'running' },
    { activityType: 'workout', isIndoorCardio: true },
    { activityType: 'cardio', cardioType: 123 },
    { activityType: 'cardio', cardioType: 'running', isIndoorCardio: 'false' },
  ])('rejeita combinação ambígua ou contraditória %#', (input) => {
    expect(() => normalizeSessionPolicyModality(input)).toThrow();
  });

  test('aceita musculação sem metadata de cardio', () => {
    expect(normalizeSessionPolicyModality({ activityType: 'workout', isIndoorCardio: false }))
      .toEqual({ activityType: 'workout', isIndoorCardio: false, requiresGps: false });
  });

  test('loader aceita somente envelope, policy e requisição coerentes', async () => {
    const policy = {
      version: 'activity-competition-v2',
      activityType: 'cardio',
      cardioType: 'running',
      isIndoorCardio: false,
      resolvedAt: '2026-09-06T11:00:00.000Z',
      effectiveAt: '2026-09-06T11:00:00.000Z',
      contexts: [],
      requiresSecurityReview: false,
      requiresGymCheckIn: false,
      requiresContinuousGps: false,
      requiresMotionSensors: false,
    };
    const envelope = {
      userId: 'user-a', sessionId: 'session-a', activityType: 'cardio',
      cardioType: 'running', isIndoorCardio: false, policy,
      expiresAt: '2026-09-07T12:00:00.000Z',
    };
    mockDb = createDb(envelope);
    await expect(loadActivityCompetitionPolicySnapshot({
      snapshotId: 'policy-a', userId: 'user-a', sessionId: 'session-a',
      activityType: 'cardio', cardioType: 'running', isIndoorCardio: false,
    })).resolves.toMatchObject({ cardioType: 'running', isIndoorCardio: false });

    mockDb = createDb({ ...envelope, cardioType: 'treadmill', isIndoorCardio: false,
      policy: { ...policy, cardioType: 'treadmill', isIndoorCardio: false } });
    await expect(loadActivityCompetitionPolicySnapshot({
      snapshotId: 'policy-a', userId: 'user-a', sessionId: 'session-a',
      activityType: 'cardio', cardioType: 'treadmill', isIndoorCardio: false,
    })).resolves.toBeNull();

    mockDb = createDb({ ...envelope, policy: { ...policy, cardioType: 'treadmill', isIndoorCardio: true } });
    await expect(loadActivityCompetitionPolicySnapshot({
      snapshotId: 'policy-a', userId: 'user-a', sessionId: 'session-a',
      activityType: 'cardio', cardioType: 'running', isIndoorCardio: false,
    })).resolves.toBeNull();
  });
});