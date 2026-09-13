let mockDb: any;

jest.mock('../_lib/common', () => ({
  get db() { return mockDb; },
}));
jest.mock('../_lib/mission-engine', () => ({
  MissionEngine: { syncUserProgressFromCompletedActivities: jest.fn() },
}));

import { settleCompletedActivityRewards } from '../_lib/activity-reward-service';
import { MissionEngine } from '../_lib/mission-engine';

function createDb() {
  const store = new Map<string, Record<string, any>>([
    ['users/user-a', { xp: 100, totalXp: 100, level: 1 }],
  ]);
  const snapshot = (value: Record<string, any> | undefined) => ({ exists: Boolean(value), data: () => value });
  const ref = (collection: string, id: string) => ({ collection, id, key: `${collection}/${id}` });
  return {
    store,
    collection: (collection: string) => ({
      doc: (id: string) => {
        const target = ref(collection, id);
        return { ...target, get: async () => snapshot(store.get(target.key)) };
      },
    }),
    runTransaction: async (callback: (transaction: any) => Promise<any>) => {
      const writes: Array<{ mode: 'set' | 'create'; target: any; value: Record<string, any>; merge?: boolean }> = [];
      const transaction = {
        get: async (target: any) => snapshot(store.get(target.key)),
        set: (target: any, value: Record<string, any>, options?: { merge?: boolean }) => {
          writes.push({ mode: 'set', target, value, merge: options?.merge });
        },
        create: (target: any, value: Record<string, any>) => {
          writes.push({ mode: 'create', target, value });
        },
      };
      const result = await callback(transaction);
      writes.forEach((write) => {
        if (write.mode === 'create' && store.has(write.target.key)) throw new Error('already exists');
        store.set(write.target.key, write.merge
          ? { ...(store.get(write.target.key) || {}), ...write.value }
          : { ...write.value });
      });
      return result;
    },
  };
}

function trustWearable(activityId: string, extra: Record<string, any> = {}) {
  mockDb.store.set(`workouts/${activityId}`, {
    userId: 'user-a',
    source: 'health_connect',
    competitionEvidenceStatus: 'trusted_native_attestation',
    ...extra,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDb = createDb();
  (MissionEngine.syncUserProgressFromCompletedActivities as jest.Mock).mockResolvedValue(undefined);
});

test('ledger transacional credita XP de wearable atestado uma única vez e sempre reconcilia missões', async () => {
  trustWearable('wearable-a');
  const input = {
    userId: 'user-a', activityId: 'wearable-a', type: 'cardio' as const,
    durationMinutes: 20, source: 'health_connect',
  };
  await expect(settleCompletedActivityRewards({ ...input, activityXP: 40, economyVersion: 1 }))
    .resolves.toMatchObject({ activityXP: 40, credited: true });
  await expect(settleCompletedActivityRewards({ ...input, durationMinutes: 300, activityXP: 999, economyVersion: 99 }))
    .resolves.toMatchObject({ activityXP: 40, credited: false });

  expect(mockDb.store.get('users/user-a')).toMatchObject({ xp: 140, totalXp: 140 });
  expect(mockDb.store.get('activity_reward_ledger/wearable-a')).toMatchObject({
    activityId: 'wearable-a', userId: 'user-a', xp: 40, origin: 'completed_activity', economyVersion: 1,
  });
  expect(MissionEngine.syncUserProgressFromCompletedActivities).toHaveBeenCalledTimes(2);
});

test('wearable declarado pelo cliente sem evidência persistida fica fora de XP, missão e ledger mesmo forjando flags de confiança', async () => {
  const forgedInput: any = {
    userId: 'user-a', activityId: 'unattested-health', type: 'cardio',
    durationMinutes: 60, source: 'health_connect', economyEligible: true,
    activityXP: 120, economyVersion: 1,
    sourceVerified: true,
    competitionEvidenceStatus: 'trusted_native_attestation',
  };
  await expect(settleCompletedActivityRewards(forgedInput)).resolves.toEqual({
    economyEligible: false, activityXP: 0, credited: false, economyVersion: 1,
  });

  expect(mockDb.store.get('users/user-a')).toMatchObject({ xp: 100, totalXp: 100 });
  expect(mockDb.store.has('activity_reward_ledger/unattested-health')).toBe(false);
  expect(MissionEngine.syncUserProgressFromCompletedActivities).not.toHaveBeenCalled();
});

test('sessão menor que um minuto não cria ledger nem missão', async () => {
  await expect(settleCompletedActivityRewards({
    userId: 'user-a', activityId: 'too-short', type: 'cardio', durationMinutes: 0.5,
  })).resolves.toMatchObject({ economyEligible: false, activityXP: 0, credited: false });
  expect(mockDb.store.has('activity_reward_ledger/too-short')).toBe(false);
  expect(MissionEngine.syncUserProgressFromCompletedActivities).not.toHaveBeenCalled();
});

test('quota técnica de wearable atestado limita economia sem apagar o registro pessoal', async () => {
  for (let index = 0; index < 10; index += 1) {
    trustWearable(`health-${index}`);
    await expect(settleCompletedActivityRewards({
      userId: 'user-a', activityId: `health-${index}`, type: 'cardio',
      durationMinutes: 50, activityXP: 100, source: 'health_connect',
      // Datas históricas diferentes continuam no mesmo teto do dia em que o
      // servidor recebeu o lote.
      occurredAt: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
    })).resolves.toMatchObject({ economyEligible: true, credited: true });
  }
  trustWearable('health-over-quota');
  await expect(settleCompletedActivityRewards({
    userId: 'user-a', activityId: 'health-over-quota', type: 'cardio',
    durationMinutes: 50, activityXP: 100, source: 'health_connect',
    occurredAt: '2026-02-20T18:00:00.000Z',
  })).resolves.toMatchObject({ economyEligible: true, activityXP: 0, credited: false });

  expect(mockDb.store.get('users/user-a')).toMatchObject({ xp: 1100, totalXp: 1100 });
  expect(mockDb.store.get('workouts/health-over-quota')).toMatchObject({
    economyEligible: true,
    missionEligible: true,
    activityRewardStatus: 'daily_quota_exceeded',
  });
  expect(MissionEngine.syncUserProgressFromCompletedActivities).toHaveBeenCalledTimes(11);
});

test('rejeita versão econômica desconhecida ou snapshot adulterado antes de criar ledger', async () => {
  await expect(settleCompletedActivityRewards({
    userId: 'user-a', activityId: 'unknown-version', type: 'cardio', durationMinutes: 20,
    activityXP: 40, economyVersion: 99,
  })).rejects.toThrow('Versão econômica de atividade não suportada');
  await expect(settleCompletedActivityRewards({
    userId: 'user-a', activityId: 'tampered-xp', type: 'cardio', durationMinutes: 20,
    activityXP: 999, economyVersion: 1,
  })).rejects.toThrow('Recompensa congelada diverge');
  expect(mockDb.store.has('activity_reward_ledger/unknown-version')).toBe(false);
  expect(mockDb.store.has('activity_reward_ledger/tampered-xp')).toBe(false);
});

test('teto diário de 1000 XP independe da ordem do lote wearable atestado', async () => {
  const settlePair = async (durations: number[]) => {
    for (const [index, durationMinutes] of durations.entries()) {
      trustWearable(`ordered-${index}`);
      await settleCompletedActivityRewards({
        userId: 'user-a', activityId: `ordered-${index}`, type: 'cardio', durationMinutes,
        source: 'health_connect', occurredAt: '2026-09-06T10:00:00.000Z',
      });
    }
    return {
      userXP: mockDb.store.get('users/user-a').xp,
      ledgerXP: [...mockDb.store.entries()]
        .filter(([key]) => key.startsWith('activity_reward_ledger/'))
        .reduce((sum, [, value]) => sum + Number(value.xp || 0), 0),
    };
  };

  await expect(settlePair([360, 240])).resolves.toEqual({ userXP: 1100, ledgerXP: 1000 });
  mockDb = createDb();
  await expect(settlePair([240, 360])).resolves.toEqual({ userXP: 1100, ledgerXP: 1000 });
});

test('quota de XP de wearable atestado não escolhe qual modalidade pode progredir desafios', async () => {
  const runOrder = async (types: Array<'cardio' | 'workout'>) => {
    const quotaKey = [...mockDb.store.keys()].find(key => key.startsWith('activity_reward_quotas/'));
    if (quotaKey) mockDb.store.delete(quotaKey);
    trustWearable('quota-seed');
    await settleCompletedActivityRewards({
      userId: 'user-a', activityId: 'quota-seed', type: 'cardio', durationMinutes: 360,
      activityXP: 720, source: 'health_connect', economyVersion: 1,
    });
    const createdQuotaKey = [...mockDb.store.keys()].find(key => key.startsWith('activity_reward_quotas/'))!;
    mockDb.store.set(createdQuotaKey, {
      userId: 'user-a', day: '2026-09-06', activityCount: 1, xpTotal: 990,
    });
    for (const [index, type] of types.entries()) {
      trustWearable(`mixed-${index}`, {
        type, economyEligible: true, missionEligible: true,
      });
      await settleCompletedActivityRewards({
        userId: 'user-a', activityId: `mixed-${index}`, type, durationMinutes: 20,
        source: 'health_connect', economyVersion: 1,
      });
    }
    return types.map((_, index) => mockDb.store.get(`workouts/mixed-${index}`))
      .map(value => ({ economyEligible: value.economyEligible, missionEligible: value.missionEligible }));
  };

  await expect(runOrder(['cardio', 'workout'])).resolves.toEqual([
    { economyEligible: true, missionEligible: true },
    { economyEligible: true, missionEligible: true },
  ]);
  mockDb = createDb();
  await expect(runOrder(['workout', 'cardio'])).resolves.toEqual([
    { economyEligible: true, missionEligible: true },
    { economyEligible: true, missionEligible: true },
  ]);
});
