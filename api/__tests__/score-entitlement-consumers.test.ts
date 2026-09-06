import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let mockDb: any;

jest.mock('../_lib/common', () => ({
  get db() { return mockDb; },
  FieldValue: {
    increment: (value: number) => value,
    serverTimestamp: () => ({ __serverTimestamp: true }),
  },
}));

import { ScoreRepository } from '../_lib/score-engine/repositories/score-repository';
import { ScoreEngine } from '../_lib/score-engine';
import { BaseScoreCalculator } from '../_lib/score-engine/calculators/base-score-calculator';
import { EventLogService } from '../_lib/score-engine/events';
import { getSeasonParticipants } from '../_lib/season-prize-engine';

const NOW = new Date('2026-09-06T12:00:00.000Z');
const FUTURE = '2026-10-06T12:00:00.000Z';

function canonicalPro(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    entitlementId: 'performance',
    tier: 'performance',
    provider: 'revenuecat',
    status: 'active',
    productId: 'invictus.performance.monthly',
    providerObservedAt: '2026-09-06T11:59:00.000Z',
    expiresAt: FUTURE,
    ...overrides,
  };
}

function document(id: string, data: Record<string, unknown>) {
  return { id, data: () => data };
}

function dbForUsers(
  profile: Record<string, unknown> | undefined,
  participants: Array<ReturnType<typeof document>> = [],
) {
  const query: any = {
    where: jest.fn(() => query),
    orderBy: jest.fn(() => query),
    limit: jest.fn(() => query),
    get: jest.fn(async () => ({ docs: participants })),
  };

  return {
    collection: jest.fn((name: string) => {
      if (name !== 'users') throw new Error(`unexpected collection ${name}`);
      return {
        doc: jest.fn(() => ({
          get: jest.fn(async () => ({
            exists: profile !== undefined,
            data: () => profile,
          })),
        })),
        where: query.where,
      };
    }),
  };
}

describe('entitlement canônico nos consumidores de score', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('ScoreRepository projeta PERFORMANCE somente com entitlement ativo e não expirado', async () => {
    mockDb = dbForUsers({
      totalScore: 10,
      joinDate: '2026-01-01T00:00:00.000Z',
      proEntitlement: canonicalPro(),
    });

    await expect(ScoreRepository.getUserStats('active-user')).resolves.toMatchObject({
      userId: 'active-user',
      subscriptionTier: 'PERFORMANCE',
    });
  });

  test.each([
    {
      label: 'flags legadas forjadas',
      profile: { subscriptionTier: 'performance', isSubscribed: true, premium: true, isPro: true },
    },
    {
      label: 'entitlement expirado',
      profile: {
        subscriptionTier: 'performance',
        subscriptionStatus: 'active_premium',
        expiresAt: FUTURE,
        proEntitlement: canonicalPro({ expiresAt: '2026-09-01T00:00:00.000Z' }),
      },
    },
  ])('ScoreRepository falha fechado para $label', async ({ profile }) => {
    mockDb = dbForUsers(profile);

    await expect(ScoreRepository.getUserStats('open-user')).resolves.toMatchObject({
      subscriptionTier: 'OPEN',
    });
  });

  test('payload não promove conta OPEN a PERFORMANCE no ScoreEngine', async () => {
    mockDb = dbForUsers(undefined);
    jest.spyOn(ScoreRepository, 'getActivityScore').mockResolvedValue(null);
    jest.spyOn(ScoreRepository, 'getUserStats').mockResolvedValue({
      userId: 'open-user',
      totalScore: 0,
      level: 1,
      totalActivities: 0,
      currentStreak: 1,
      bestStreak: 1,
      lastActivityDate: NOW,
      joinDate: new Date('2026-01-01T00:00:00.000Z'),
      subscriptionTier: 'OPEN',
    });
    jest.spyOn(ScoreRepository, 'getUserScoreHistory').mockResolvedValue([]);
    jest.spyOn(ScoreRepository, 'saveActivityScore').mockResolvedValue();
    jest.spyOn(ScoreRepository, 'updateUserStats').mockResolvedValue();
    jest.spyOn(EventLogService, 'logEventReceived').mockResolvedValue();
    jest.spyOn(EventLogService, 'markEventProcessed').mockResolvedValue();
    const qualitySpy = jest.spyOn(BaseScoreCalculator, 'calculateQualityScore').mockReturnValue({
      score: 50,
      goal: 'HYPERTROPHY',
      goalWeightsUsed: {},
      breakdown: { gains: [], losses: [], subScores: {} },
      mainImpacts: {},
    } as any);

    await ScoreEngine.process({
      id: 'forged-plan-event',
      userId: 'open-user',
      source: 'app',
      timestamp: NOW,
      payload: {
        type: 'checkin',
        subscriptionTier: 'PERFORMANCE',
        plan: 'PRO',
      },
    });

    expect(qualitySpy).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ subscriptionTier: 'OPEN' }),
    );
  });

  test('getSeasonParticipants exclui tier legado, expirado e inclui somente Pro canônico', async () => {
    mockDb = dbForUsers(undefined, [
      document('canonical-active', {
        monthlyScore: 90,
        proEntitlement: canonicalPro(),
      }),
      document('legacy-forged', {
        monthlyScore: 80,
        subscriptionTier: 'performance',
        isSubscribed: true,
      }),
      document('canonical-expired', {
        monthlyScore: 70,
        proEntitlement: canonicalPro({ expiresAt: '2026-09-01T00:00:00.000Z' }),
      }),
    ]);

    await expect(getSeasonParticipants()).resolves.toEqual([
      { id: 'canonical-active', monthlyScore: 90 },
    ]);
  });

  test('contrato dos consumidores não volta a confiar no plano enviado ou no tier legado', () => {
    const scoreEngine = readFileSync(resolve(process.cwd(), 'api/_lib/score-engine/index.ts'), 'utf8');
    const presence = readFileSync(resolve(process.cwd(), 'api/_handlers/validate-presence.ts'), 'utf8');
    const season = readFileSync(resolve(process.cwd(), 'api/_lib/season-prize-engine.ts'), 'utf8');

    expect(scoreEngine).not.toMatch(/event\.payload\?\.(?:subscriptionTier|plan)/);
    expect(presence).not.toContain('userData.subscriptionTier');
    expect(presence.match(/isProUser\(userData\)/g)).toHaveLength(2);
    expect(season).not.toContain('d.data().subscriptionTier');
    expect(season).toContain('.filter((d: any) => isProUser(d.data()))');
  });
});
