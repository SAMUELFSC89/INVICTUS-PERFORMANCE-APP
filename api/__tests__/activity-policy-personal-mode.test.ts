/**
 * Cobertura do gate de "modo pessoal" (requestedMode: 'personal') no handler
 * de /api/activity-policy. Musculação sempre pôde pedir modo pessoal; este
 * teste cobre a extensão para cardio (corrida/caminhada), que passou a ter o
 * mesmo controlezinho de "pontuação ativa/desativada" que a Musculação já
 * tinha -- ver src/components/ScoringModeToggle.tsx e
 * src/services/personalWorkoutPolicyService.ts. As demais modalidades de
 * cardio (bike, esteira, etc.) continuam sem suporte a modo pessoal, porque
 * já não exigem GPS contínuo em modo competitivo -- o controle não se aplica
 * a elas.
 */
const mockCreate = jest.fn(async () => undefined);
let lastDocId = 0;

jest.mock('../_lib/common', () => ({
  cors: jest.fn(() => false),
  verifyAuth: jest.fn(async () => ({ uid: 'user-1' })),
  get db() {
    return {
      collection: (name: string) => {
        if (name !== 'activity_policy_snapshots') throw new Error(`Coleção inesperada no teste: ${name}`);
        return {
          doc: () => {
            lastDocId += 1;
            return { id: `snap-${lastDocId}`, create: mockCreate };
          },
        };
      },
    };
  },
}));

jest.mock('../_lib/activity-competition-policy', () => ({
  createActivityCompetitionPolicySnapshot: jest.fn(async () => {
    throw new Error('Caminho competitivo não deveria ser exercitado neste arquivo de teste.');
  }),
}));

import handler from '../_handlers/activity-policy';

function response() {
  const res: any = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res;
}

function request(body: Record<string, any>) {
  return { method: 'POST', body } as any;
}

describe('POST /api/activity-policy -- modo pessoal (requestedMode: personal)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    lastDocId = 0;
    jest.useFakeTimers().setSystemTime(new Date('2026-09-18T12:00:00.000Z'));
  });

  afterEach(() => jest.useRealTimers());

  test('musculação aceita modo pessoal (comportamento preexistente)', async () => {
    const res = response();
    await handler(request({ activityType: 'workout', isIndoorCardio: false, requestedMode: 'personal' }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    const policy = res.json.mock.calls[0][0];
    expect(policy).toMatchObject({
      activityType: 'workout',
      contexts: [],
      requiresSecurityReview: false,
      requiresGymCheckIn: false,
      requiresContinuousGps: false,
      requiresMotionSensors: false,
    });
    expect(policy.cardioType).toBeUndefined();
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1', activityType: 'workout', cardioType: null, requestedMode: 'personal',
    }));
  });

  test.each(['running', 'walking'])('cardio %s aceita modo pessoal', async (cardioType) => {
    const res = response();
    await handler(request({ activityType: 'cardio', cardioType, requestedMode: 'personal' }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    const policy = res.json.mock.calls[0][0];
    expect(policy).toMatchObject({
      activityType: 'cardio',
      cardioType,
      isIndoorCardio: false,
      contexts: [],
      requiresSecurityReview: false,
      requiresGymCheckIn: false,
      requiresContinuousGps: false,
      requiresMotionSensors: false,
    });
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1', activityType: 'cardio', cardioType, requestedMode: 'personal',
    }));
  });

  test.each(['bike', 'treadmill', 'stationary_bike', 'elliptical', 'rowing', 'stair_climber', 'swimming', 'hiit'])(
    'cardio %s rejeita modo pessoal (só corrida/caminhada têm o controle)',
    async (cardioType) => {
      const res = response();
      await handler(request({ activityType: 'cardio', cardioType, requestedMode: 'personal' }), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'O modo pessoal sem pontuação está disponível para musculação, corrida e caminhada neste fluxo.',
      });
      expect(mockCreate).not.toHaveBeenCalled();
    },
  );

  test('cada chamada emite um snapshot novo e independente', async () => {
    const res1 = response();
    await handler(request({ activityType: 'cardio', cardioType: 'running', requestedMode: 'personal' }), res1);
    const res2 = response();
    await handler(request({ activityType: 'cardio', cardioType: 'walking', requestedMode: 'personal' }), res2);

    const [policy1] = res1.json.mock.calls[0];
    const [policy2] = res2.json.mock.calls[0];
    expect(policy1.snapshotId).not.toEqual(policy2.snapshotId);
  });
});
