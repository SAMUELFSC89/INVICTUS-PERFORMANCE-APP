let mockDb: any;

jest.mock('../_lib/common', () => ({
  get db() { return mockDb; },
}));
jest.mock('../_lib/reward-coin-engine', () => ({
  RewardCoinEngine: { credit: jest.fn() },
}));

import { MissionEngine } from '../_lib/mission-engine';
import { RewardCoinEngine } from '../_lib/reward-coin-engine';
import { getLevelFromXP } from '../_lib/xpConfig';

type Stored = Record<string, any>;

function createDb(initial: Record<string, Stored>) {
  const store = new Map(Object.entries(initial));
  const ref = (collectionName: string, id: string) => {
    const key = `${collectionName}/${id}`;
    return {
      collectionName,
      id,
      key,
      get: async () => snapshot(store.get(key)),
      set: async (value: Stored, options?: { merge?: boolean }) => {
        store.set(key, options?.merge ? { ...(store.get(key) || {}), ...value } : { ...value });
      },
    };
  };
  const snapshot = (value: Stored | undefined) => ({ exists: Boolean(value), data: () => value });
  return {
    store,
    collection: (collectionName: string) => ({
      doc: (id: string) => ref(collectionName, id),
      where: (field: string, _operator: string, expected: unknown) => ({
        get: async () => ({
          docs: [...store.entries()]
            .filter(([key, value]) => key.startsWith(`${collectionName}/`) && value[field] === expected)
            .map(([key, value]) => ({ id: key.slice(collectionName.length + 1), data: () => value })),
        }),
      }),
    }),
    runTransaction: async (callback: (transaction: any) => Promise<any>) => {
      const writes: Array<{ target: any; value: Stored; merge: boolean }> = [];
      const transaction = {
        get: async (target: any) => snapshot(store.get(target.key)),
        set: (target: any, value: Stored, options?: { merge?: boolean }) => {
          writes.push({ target, value, merge: options?.merge === true });
        },
      };
      const result = await callback(transaction);
      writes.forEach(({ target, value, merge }) => {
        store.set(target.key, merge ? { ...(store.get(target.key) || {}), ...value } : { ...value });
      });
      return result;
    },
  };
}

const mission = {
  id: 'casual-cardio-week',
  title: 'Corra duas vezes',
  description: 'Complete duas atividades de cardio, inclusive casuais.',
  category: 'weekly' as const,
  type: 'cardio_count' as const,
  target: 2,
  rewardCoins: 40,
  rewardXP: 25,
  isFreeAccess: true,
  ledgerType: 'MISSION_REWARD' as const,
  active: true,
};

describe('mission reward claim idempotency', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-09-06T12:00:00.000Z'));
    mockDb = createDb({
      'users/free-user': { xp: 100, totalXp: 100, subscriptionTier: 'open' },
    });
    jest.spyOn(MissionEngine, 'getMissions').mockResolvedValue([mission as any]);
    (RewardCoinEngine.credit as jest.Mock).mockResolvedValue({ duplicated: false });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  function completeCurrentProgress() {
    const progressId = (MissionEngine as any).progressId('free-user', mission);
    mockDb.store.set(`user_missions/${progressId}`, {
      id: progressId,
      userId: 'free-user',
      missionId: mission.id,
      currentProgress: 2,
      target: 2,
      completed: true,
      claimed: false,
      rewardCoinsSnapshot: mission.rewardCoins,
      rewardXPSnapshot: mission.rewardXP,
      rewardCategorySnapshot: 'ecosystem',
      ledgerTypeSnapshot: mission.ledgerType,
      missionTitleSnapshot: mission.title,
      missionDescriptionSnapshot: mission.description,
      missionCategorySnapshot: mission.category,
      missionTypeSnapshot: mission.type,
      targetSnapshot: mission.target,
      isFreeAccessSnapshot: mission.isFreeAccess,
      completionAccessGranted: true,
    });
    return progressId;
  }

  it('credits Coins and XP once and makes a repeated claim a successful no-op', async () => {
    const progressId = completeCurrentProgress();
    await expect(MissionEngine.claimMissionReward('free-user', mission.id)).resolves.toMatchObject({ rewardCoins: 40, rewardXP: 25 });
    await expect(MissionEngine.claimMissionReward('free-user', mission.id)).resolves.toMatchObject({ rewardCoins: 40, rewardXP: 25 });

    expect(RewardCoinEngine.credit).toHaveBeenCalledTimes(1);
    expect(mockDb.store.get('users/free-user')).toMatchObject({ xp: 125, totalXp: 125, level: 2 });
    expect(mockDb.store.get(`user_missions/${progressId}`)).toMatchObject({ claimed: true, claimState: 'complete' });
  });

  it('resumes a pending claim after a temporary Coin failure without duplicating XP', async () => {
    const progressId = completeCurrentProgress();
    (RewardCoinEngine.credit as jest.Mock)
      .mockRejectedValueOnce(new Error('wallet unavailable'))
      .mockResolvedValueOnce({ duplicated: false });

    await expect(MissionEngine.claimMissionReward('free-user', mission.id)).rejects.toThrow('wallet unavailable');
    expect(mockDb.store.get('users/free-user').xp).toBe(100);
    expect(mockDb.store.get(`user_missions/${progressId}`)).toMatchObject({ claimed: false, claimState: 'pending' });

    await expect(MissionEngine.claimMissionReward('free-user', mission.id)).resolves.toBeDefined();
    expect(mockDb.store.get('users/free-user').xp).toBe(125);
    expect(mockDb.store.get(`user_missions/${progressId}`)).toMatchObject({ claimed: true, claimState: 'complete' });
  });

  it('uses the reward frozen at reservation when a retry happens after a definition change', async () => {
    completeCurrentProgress();
    (RewardCoinEngine.credit as jest.Mock).mockRejectedValueOnce(new Error('wallet unavailable'));
    await expect(MissionEngine.claimMissionReward('free-user', mission.id)).rejects.toThrow('wallet unavailable');

    (MissionEngine.getMissions as jest.Mock).mockResolvedValue([{
      ...mission,
      rewardCoins: 999,
      rewardXP: 999,
      title: 'Definição alterada',
    }]);
    await expect(MissionEngine.claimMissionReward('free-user', mission.id)).resolves.toMatchObject({
      rewardCoins: 40,
      rewardXP: 25,
    });
    expect(RewardCoinEngine.credit).toHaveBeenLastCalledWith(expect.objectContaining({
      amount: 40,
      description: 'Conclusão do desafio: Corra duas vezes',
    }));
    expect(mockDb.store.get('users/free-user').xp).toBe(125);
  });

  it('uses the period snapshot even when the definition changes before the first claim', async () => {
    const progressId = completeCurrentProgress();
    (MissionEngine.getMissions as jest.Mock).mockResolvedValue([{
      ...mission, rewardCoins: 900, rewardXP: 800, title: 'Definição nova', target: 5,
    }]);

    await expect(MissionEngine.claimMissionReward('free-user', mission.id, progressId))
      .resolves.toMatchObject({ rewardCoins: 40, rewardXP: 25 });
    expect(RewardCoinEngine.credit).toHaveBeenCalledWith(expect.objectContaining({
      amount: 40,
      description: 'Conclusão do desafio: Corra duas vezes',
    }));
  });

  it('permite resgatar missão PRO conquistada antes do downgrade', async () => {
    const proMission = { ...mission, id: 'pro-earned', isFreeAccess: false, ledgerType: 'PRO_MISSION_REWARD' };
    (MissionEngine.getMissions as jest.Mock).mockResolvedValue([proMission as any]);
    const progressId = (MissionEngine as any).progressId('free-user', proMission);
    mockDb.store.set(`user_missions/${progressId}`, {
      id: progressId, userId: 'free-user', missionId: proMission.id,
      currentProgress: 2, target: 2, completed: true, claimed: false,
      rewardCoinsSnapshot: 40, rewardXPSnapshot: 25,
      ledgerTypeSnapshot: 'PRO_MISSION_REWARD', missionTitleSnapshot: 'Pro conquistada',
      isFreeAccessSnapshot: false, completionAccessGranted: true,
    });

    await expect(MissionEngine.claimMissionReward('free-user', proMission.id, progressId))
      .resolves.toMatchObject({ rewardCoins: 40, rewardXP: 25 });
  });

  it('counts completed casual cardio toward the Coin challenge without competition approval', async () => {
    mockDb.store.set('workouts/casual-a', {
      userId: 'free-user', type: 'cardio', recordStatus: 'completed', activityMode: 'personal',
      competitionReviewStatus: 'not_required', endTime: '2026-09-05T08:00:00.000Z',
    });
    mockDb.store.set('workouts/casual-b', {
      userId: 'free-user', type: 'cardio', recordStatus: 'completed', activityMode: 'personal',
      competitionReviewStatus: 'not_required', endTime: '2026-09-06T08:00:00.000Z',
    });

    await MissionEngine.syncUserProgressFromCompletedActivities('free-user');
    const progressId = (MissionEngine as any).progressId('free-user', mission);
    expect(mockDb.store.get(`user_missions/${progressId}`)).toMatchObject({
      currentProgress: 2,
      target: 2,
      completed: true,
      claimed: false,
    });
  });

  it('concilia upload offline no período em que a atividade aconteceu', async () => {
    jest.setSystemTime(new Date('2026-09-07T12:00:00.000Z'));
    mockDb.store.set('workouts/late-sunday-a', {
      userId: 'free-user', type: 'cardio', recordStatus: 'completed',
      economyEligible: true, missionEligible: true,
      endTime: '2026-09-06T12:00:00.000Z',
    });
    mockDb.store.set('workouts/late-sunday-b', {
      userId: 'free-user', type: 'cardio', recordStatus: 'completed',
      economyEligible: true, missionEligible: true,
      // 02:30 UTC de segunda ainda é domingo em São Paulo.
      endTime: '2026-09-07T02:30:00.000Z',
    });

    await MissionEngine.syncUserProgressFromCompletedActivities('free-user', [
      '2026-09-06T12:00:00.000Z',
      '2026-09-07T02:30:00.000Z',
    ]);

    const previousId = (MissionEngine as any).progressId(
      'free-user', mission, new Date('2026-09-07T02:30:00.000Z'),
    );
    const currentId = (MissionEngine as any).progressId('free-user', mission);
    expect(previousId).not.toBe(currentId);
    expect(mockDb.store.get(`user_missions/${previousId}`)).toMatchObject({
      periodKey: '2026-W36', currentProgress: 2, completed: true, claimed: false,
    });
    expect(mockDb.store.get(`user_missions/${currentId}`)).toMatchObject({
      periodKey: '2026-W37', currentProgress: 0, completed: false,
    });
  });

  it('congela acesso por atividade: upgrade não concede PRO retroativo e downgrade não remove conquista', async () => {
    const proMission = {
      ...mission,
      id: 'pro-cardio-week',
      isFreeAccess: false,
      ledgerType: 'PRO_MISSION_REWARD',
    };
    (MissionEngine.getMissions as jest.Mock).mockResolvedValue([proMission as any]);
    mockDb.store.set('users/free-user', { subscriptionTier: 'pro' });
    for (const id of ['free-before-upgrade', 'unknown-before-upgrade']) {
      mockDb.store.set(`workouts/${id}`, {
        userId: 'free-user', type: 'cardio', recordStatus: 'completed',
        economyEligible: true, missionEligible: true,
        missionAccessTier: id.startsWith('free') ? 'free' : 'unknown',
        endTime: '2026-09-06T09:00:00.000Z',
      });
    }
    await MissionEngine.syncUserProgressFromCompletedActivities('free-user');
    const progressId = (MissionEngine as any).progressId('free-user', proMission);
    expect(mockDb.store.get(`user_missions/${progressId}`)).toMatchObject({
      currentProgress: 0, completed: false, completionAccessGranted: false,
    });

    for (const id of ['pro-one', 'pro-two']) {
      mockDb.store.set(`workouts/${id}`, {
        userId: 'free-user', type: 'cardio', recordStatus: 'completed',
        economyEligible: true, missionEligible: true, missionAccessTier: 'pro',
        endTime: '2026-09-06T10:00:00.000Z',
      });
    }
    mockDb.store.set('users/free-user', { subscriptionTier: 'open' });
    await MissionEngine.syncUserProgressFromCompletedActivities('free-user');
    expect(mockDb.store.get(`user_missions/${progressId}`)).toMatchObject({
      currentProgress: 2, completed: true, completionAccessGranted: true,
    });
    await expect(MissionEngine.claimMissionReward('free-user', proMission.id, progressId))
      .resolves.toMatchObject({ rewardCoins: 40, rewardXP: 25 });
  });

  it('does not count a technical session marked as economically ineligible', async () => {
    mockDb.store.set('workouts/too-short', {
      userId: 'free-user', type: 'cardio', recordStatus: 'completed', activityMode: 'personal',
      economyEligible: false, missionEligible: false, duration: 0.2,
      endTime: '2026-09-06T08:00:00.000Z',
    });
    mockDb.store.set('workouts/real-cardio', {
      userId: 'free-user', type: 'cardio', recordStatus: 'completed', activityMode: 'personal',
      economyEligible: true, missionEligible: true, duration: 20,
      endTime: '2026-09-06T09:00:00.000Z',
    });

    await MissionEngine.syncUserProgressFromCompletedActivities('free-user');
    const progressId = (MissionEngine as any).progressId('free-user', mission);
    expect(mockDb.store.get(`user_missions/${progressId}`)).toMatchObject({
      currentProgress: 1,
      completed: false,
    });
  });

  it('does not count a completed activity dated in the future', async () => {
    mockDb.store.set('workouts/current-cardio', {
      userId: 'free-user', type: 'cardio', recordStatus: 'completed',
      economyEligible: true, missionEligible: true, duration: 20,
      endTime: '2026-09-06T10:00:00.000Z',
    });
    mockDb.store.set('workouts/future-cardio', {
      userId: 'free-user', type: 'cardio', recordStatus: 'completed',
      economyEligible: true, missionEligible: true, duration: 20,
      endTime: '2026-09-07T10:00:00.000Z',
    });

    await MissionEngine.syncUserProgressFromCompletedActivities('free-user');
    const progressId = (MissionEngine as any).progressId('free-user', mission);
    expect(mockDb.store.get(`user_missions/${progressId}`)).toMatchObject({ currentProgress: 1, completed: false });
  });

  it('retoma pelo progressId congelado depois da virada da semana e da desativação da missão', async () => {
    const progressId = completeCurrentProgress();
    const originalTransaction = mockDb.runTransaction.bind(mockDb);
    let transactionCall = 0;
    mockDb.runTransaction = async (callback: any) => {
      transactionCall += 1;
      if (transactionCall === 2) throw new Error('finalização temporariamente indisponível');
      return originalTransaction(callback);
    };

    await expect(MissionEngine.claimMissionReward('free-user', mission.id, progressId))
      .rejects.toThrow('finalização temporariamente indisponível');
    expect(mockDb.store.get(`user_missions/${progressId}`)).toMatchObject({ claimState: 'pending', claimed: false });

    mockDb.runTransaction = originalTransaction;
    jest.setSystemTime(new Date('2026-09-14T12:00:00.000Z'));
    (MissionEngine.getMissions as jest.Mock).mockResolvedValue([]);
    await expect(MissionEngine.claimMissionReward('free-user', mission.id, progressId))
      .resolves.toMatchObject({ rewardCoins: 40, rewardXP: 25 });
    expect(mockDb.store.get('users/free-user')).toMatchObject({ xp: 125, totalXp: 125 });
    expect(mockDb.store.get(`user_missions/${progressId}`)).toMatchObject({ claimState: 'complete', claimed: true });
    const keys = (RewardCoinEngine.credit as jest.Mock).mock.calls.map(([input]) => input.idempotencyKey);
    expect(new Set(keys).size).toBe(1);
  });

  it('prioriza conclusão antiga não resgatada sobre o progresso vazio do novo período', async () => {
    mockDb.store.set('user_missions/old-complete', {
      id: 'old-complete', userId: 'free-user', missionId: mission.id,
      currentProgress: 2, target: 2, completed: true, claimed: false,
      updatedAt: '2026-08-31T12:00:00.000Z',
    });
    mockDb.store.set('user_missions/current-empty', {
      id: 'current-empty', userId: 'free-user', missionId: mission.id,
      currentProgress: 0, target: 2, completed: false, claimed: false,
      updatedAt: '2026-09-06T12:00:00.000Z',
    });
    await expect(MissionEngine.getUserMissionProgress('free-user'))
      .resolves.toEqual([expect.objectContaining({ id: 'old-complete' })]);
  });

  it('mantém critério e alvo congelados quando o admin edita a missão no meio do período', async () => {
    const changed = { ...mission, target: 5, rewardCoins: 999 };
    (MissionEngine.getMissions as jest.Mock).mockResolvedValue([changed as any]);
    const progressId = (MissionEngine as any).progressId('free-user', changed);
    mockDb.store.set(`user_missions/${progressId}`, {
      id: progressId, userId: 'free-user', missionId: mission.id,
      currentProgress: 0, target: 2, completed: false, claimed: false,
      missionCategorySnapshot: 'weekly', missionTypeSnapshot: 'cardio_count',
      targetSnapshot: 2, weeklyGoalSnapshot: 0, isFreeAccessSnapshot: true,
      rewardCoinsSnapshot: 40, rewardXPSnapshot: 25, missionTitleSnapshot: mission.title,
    });
    for (const [id, hour] of [['one', '08'], ['two', '09']]) {
      mockDb.store.set(`workouts/${id}`, {
        userId: 'free-user', type: 'cardio', recordStatus: 'completed',
        economyEligible: true, missionEligible: true, duration: 20,
        endTime: `2026-09-06T${hour}:00:00.000Z`,
      });
    }

    await MissionEngine.syncUserProgressFromCompletedActivities('free-user');
    expect(mockDb.store.get(`user_missions/${progressId}`)).toMatchObject({
      currentProgress: 2, target: 2, completed: true, rewardCoinsSnapshot: 40,
    });
  });

  it('não usa evento genérico para concluir várias missões especiais', async () => {
    const secondMission = { ...mission, id: 'secret', type: 'event_count', target: 1 };
    const firstMission = { ...mission, id: 'ai', type: 'event_count', target: 1 };
    (MissionEngine.getMissions as jest.Mock).mockResolvedValue([firstMission as any, secondMission as any]);
    mockDb.store.set('mission_events/generic', {
      userId: 'free-user', status: 'completed', occurredAt: '2026-09-06T10:00:00.000Z',
    });
    mockDb.store.set('mission_events/ai-only', {
      userId: 'free-user', missionId: 'ai', status: 'completed', occurredAt: '2026-09-06T10:30:00.000Z',
    });

    await MissionEngine.syncUserProgressFromCompletedActivities('free-user');
    const aiId = (MissionEngine as any).progressId('free-user', firstMission);
    const secretId = (MissionEngine as any).progressId('free-user', secondMission);
    expect(mockDb.store.get(`user_missions/${aiId}`)).toMatchObject({ currentProgress: 1, completed: true });
    expect(mockDb.store.get(`user_missions/${secretId}`)).toMatchObject({ currentProgress: 0, completed: false });
  });

  it('usa o calendário de São Paulo na virada semanal', () => {
    const periodKey = (MissionEngine as any).periodKey.bind(MissionEngine);
    expect(periodKey(mission, new Date('2026-09-07T02:30:00.000Z')))
      .toBe(periodKey(mission, new Date('2026-09-06T12:00:00.000Z')));
    expect(periodKey(mission, new Date('2026-09-07T03:30:00.000Z')))
      .not.toBe(periodKey(mission, new Date('2026-09-06T12:00:00.000Z')));
  });

  it('rejeita recompensa administrativa não finita e XP corrompido não trava o cálculo de nível', async () => {
    await expect(MissionEngine.upsertMission({ ...mission, rewardXP: Infinity } as any))
      .rejects.toThrow('rewardXP');
    expect(getLevelFromXP(Infinity)).toBe(1);
    expect(getLevelFromXP(Number.NaN)).toBe(1);
  });
});
