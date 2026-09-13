import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let mockDb: any;

jest.mock('../_lib/common', () => ({
  get db() { return mockDb; },
}));

jest.mock('../_lib/season-prize-engine', () => ({
  getOrInitCurrentSeasonWindow: jest.fn(async () => ({
    seasonId: 'stress-season',
    startDate: new Date('2026-08-01T00:00:00.000Z'),
    endDate: new Date('2026-10-01T00:00:00.000Z'),
  })),
}));

jest.mock('../../src/core/iga/index', () => ({
  calculateWeeklyIGA: jest.fn((sessions: any[]) => {
    const valid = sessions.filter(session => session.isValid === true);
    return {
      igaRanking: valid.length,
      frequency: valid.length,
      consistency: valid.length,
      topSessions: valid,
    };
  }),
}));

jest.mock('../_lib/reward-coin-engine', () => ({
  RewardCoinEngine: { credit: jest.fn() },
}));

import { MissionEngine } from '../_lib/mission-engine';
import { recalculateAllUserScores } from '../_lib/igaService';

type Stored = Record<string, any>;

type StressKind =
  | 'approved'
  | 'personal'
  | 'competition_ineligible'
  | 'fraud_rejected'
  | 'technical_pending'
  | 'duplicate';

const USER_ID = 'stress-user';
const GYM_ID = 'stress-gym';
const ENROLLED_AT = '2026-08-01T00:00:00.000Z';
const EPOCH_ID = `${USER_ID}:${Date.parse(ENROLLED_AT)}`;
const PER_KIND_PER_MODALITY = 1_000;
const EXPECTED_MISSION_PER_MODALITY = PER_KIND_PER_MODALITY * 3;
const EXPECTED_IGA_SESSIONS = PER_KIND_PER_MODALITY * 2;

function clone<T>(value: T): T {
  return value === undefined ? value : structuredClone(value);
}

function createDb(initial: Record<string, Stored>) {
  const store = new Map<string, Stored>(Object.entries(initial).map(([key, value]) => [key, clone(value)]));

  const snapshot = (key: string) => ({
    id: key.split('/').at(-1),
    exists: store.has(key),
    data: () => clone(store.get(key)),
    ref: ref(key),
  });

  function ref(key: string) {
    return {
      key,
      id: key.split('/').at(-1),
      get: async () => snapshot(key),
      set: async (value: Stored, options?: { merge?: boolean }) => {
        store.set(key, options?.merge ? { ...(store.get(key) || {}), ...clone(value) } : clone(value));
      },
    };
  }

  const query = (collectionName: string, filters: Array<[string, unknown]> = []) => ({
    where(field: string, operator: string, expected: unknown) {
      if (operator !== '==') throw new Error(`Unsupported operator in stress DB: ${operator}`);
      return query(collectionName, [...filters, [field, expected]]);
    },
    async get() {
      const docs = [...store.entries()]
        .filter(([key]) => key.startsWith(`${collectionName}/`) && key.split('/').length === 2)
        .filter(([, value]) => filters.every(([field, expected]) => value[field] === expected))
        .map(([key]) => snapshot(key));
      return {
        docs,
        empty: docs.length === 0,
        size: docs.length,
        forEach(callback: (doc: any) => void) { docs.forEach(callback); },
      };
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

function activity(kind: StressKind, modality: 'workout' | 'cardio', index: number): Stored {
  const base: Stored = {
    schemaVersion: 2,
    userId: USER_ID,
    type: modality,
    cardioType: modality === 'cardio' ? 'running' : undefined,
    recordStatus: 'completed',
    status: 'completed',
    duration: modality === 'cardio' ? 35 : 60,
    startTime: '2026-09-05T08:00:00.000Z',
    endTime: '2026-09-05T09:00:00.000Z',
    economyEligible: true,
    missionEligible: true,
    dataQualityStatus: 'accepted',
    competitionContexts: [{ type: 'gym_ranking', id: GYM_ID, epochId: EPOCH_ID }],
    avgHeartRate: 145,
    calories: 400,
    stressIndex: index,
  };

  if (kind === 'approved') {
    return {
      ...base,
      activityMode: 'competitive',
      competitionReviewStatus: 'approved',
      competitionStatus: 'approved',
      validationStatus: 'validated',
      isScoringEligible: true,
      pendingReview: false,
      securityDecision: 'APPROVED',
    };
  }
  if (kind === 'personal') {
    return {
      ...base,
      activityMode: 'personal',
      competitionContexts: [],
      competitionReviewStatus: 'not_required',
      competitionStatus: 'not_required',
      validationStatus: 'recorded',
      isScoringEligible: false,
      pendingReview: false,
      securityDecision: null,
    };
  }
  if (kind === 'competition_ineligible') {
    return {
      ...base,
      activityMode: 'competitive',
      competitionReviewStatus: 'ineligible',
      competitionStatus: 'ineligible',
      validationStatus: 'not_eligible',
      isScoringEligible: false,
      pendingReview: false,
      nonScoringReason: 'GEOFENCE_CHECKIN_REQUIRED',
      securityDecision: 'APPROVED',
    };
  }
  if (kind === 'fraud_rejected') {
    return {
      ...base,
      activityMode: 'competitive',
      competitionReviewStatus: 'rejected',
      competitionStatus: 'rejected',
      validationStatus: 'rejected',
      isScoringEligible: false,
      pendingReview: false,
      nonScoringReason: 'SECURITY_PIPELINE_BLOCKED',
      rejectionReason: 'SECURITY_PIPELINE_BLOCKED',
      securityDecision: index % 2 === 0 ? 'BLOCKED' : 'UNDER_REVIEW',
    };
  }
  if (kind === 'technical_pending') {
    return {
      ...base,
      activityMode: 'competitive',
      competitionReviewStatus: 'pending_review',
      competitionStatus: 'pending_review',
      validationStatus: 'pending_review',
      isScoringEligible: false,
      pendingReview: true,
      nonScoringReason: 'SECURITY_PIPELINE_ERROR',
      securityDecision: 'ERROR',
    };
  }
  return {
    ...base,
    activityMode: 'competitive',
    competitionReviewStatus: 'ineligible',
    competitionStatus: 'ineligible',
    validationStatus: 'not_eligible',
    isScoringEligible: false,
    pendingReview: false,
    dataQualityStatus: 'duplicate',
    economyEligible: false,
    missionEligible: false,
    nonScoringReason: 'DUPLICATE_ACTIVITY',
    securityDecision: 'DUPLICATE',
  };
}

function stressDataset(): Record<string, Stored> {
  const data: Record<string, Stored> = {
    [`users/${USER_ID}`]: { age: 30, weight: 80 },
    [`gym_ranking_enrollments/${USER_ID}`]: {
      enrolled: true,
      gymId: GYM_ID,
      enrolledAt: ENROLLED_AT,
      accepted: true,
      consentType: 'competitive_hr_measurement_acknowledgement',
      competitionId: 'gym_ranking',
      competitionRulesVersion: 'gym-ranking-v2-hr',
      hrAcknowledgementVersion: 'competitive-hr-v1',
    },
  };
  const kinds: StressKind[] = [
    'approved', 'personal', 'competition_ineligible',
    'fraud_rejected', 'technical_pending', 'duplicate',
  ];
  for (const modality of ['workout', 'cardio'] as const) {
    for (const kind of kinds) {
      for (let index = 0; index < PER_KIND_PER_MODALITY; index += 1) {
        data[`workouts/${modality}-${kind}-${index}`] = activity(kind, modality, index);
      }
    }
  }
  return data;
}

const strengthMission = {
  id: 'stress-strength',
  title: 'Stress Musculação',
  description: 'Conta somente musculação legítima.',
  category: 'weekly' as const,
  type: 'strength_workout_count' as const,
  target: 10_000,
  rewardCoins: 0,
  rewardXP: 0,
  rewardCategory: 'ecosystem' as const,
  isFreeAccess: true,
  ledgerType: 'MISSION_REWARD' as const,
  active: true,
};

const cardioMission = {
  ...strengthMission,
  id: 'stress-cardio',
  title: 'Stress Cardio',
  description: 'Conta somente cardio legítimo.',
  type: 'cardio_count' as const,
};

function progress(missionId: string): Stored | undefined {
  return [...mockDb.store.values()].find((value: Stored) => value?.missionId === missionId && value?.userId === USER_ID);
}

describe('IGA + missões — stress antifraude', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-09-06T12:00:00.000Z'));
    mockDb = createDb(stressDataset());
    jest.spyOn(MissionEngine, 'getMissions').mockResolvedValue([strengthMission as any, cardioMission as any]);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('12.000 atividades: fraude e pendência técnica nunca substituem treino válido em missão', async () => {
    await MissionEngine.syncUserProgressFromCompletedActivities(USER_ID);

    expect(progress(strengthMission.id)).toMatchObject({
      currentProgress: EXPECTED_MISSION_PER_MODALITY,
      completed: false,
    });
    expect(progress(cardioMission.id)).toMatchObject({
      currentProgress: EXPECTED_MISSION_PER_MODALITY,
      completed: false,
    });
  });

  test('12.000 atividades: IGA/ranking recebe somente as sessões competitivas aprovadas', async () => {
    const result = await recalculateAllUserScores(USER_ID);
    expect(result.weekly.frequency).toBe(EXPECTED_IGA_SESSIONS);
    expect(result.weekly.igaRanking).toBe(EXPECTED_IGA_SESSIONS);
  });

  test('reconciliação repetida é idempotente e não faz fraude completar a missão', async () => {
    for (let run = 0; run < 25; run += 1) {
      await MissionEngine.syncUserProgressFromCompletedActivities(USER_ID);
    }
    expect(progress(strengthMission.id)?.currentProgress).toBe(EXPECTED_MISSION_PER_MODALITY);
    expect(progress(cardioMission.id)?.currentProgress).toBe(EXPECTED_MISSION_PER_MODALITY);
  });

  test('fraude não substitui a última repetição necessária para concluir missão de musculação ou cardio', async () => {
    const strengthGoal = { ...strengthMission, target: 3 };
    const cardioGoal = { ...cardioMission, target: 2 };
    (MissionEngine.getMissions as jest.Mock).mockResolvedValue([strengthGoal, cardioGoal]);
    mockDb = createDb({
      [`workouts/strength-valid-1`]: activity('approved', 'workout', 1),
      [`workouts/strength-valid-2`]: activity('personal', 'workout', 2),
      [`workouts/strength-fraud`]: activity('fraud_rejected', 'workout', 3),
      [`workouts/cardio-valid-1`]: activity('approved', 'cardio', 1),
      [`workouts/cardio-fraud`]: activity('fraud_rejected', 'cardio', 2),
    });

    await MissionEngine.syncUserProgressFromCompletedActivities(USER_ID);
    expect(progress(strengthGoal.id)).toMatchObject({ currentProgress: 2, completed: false });
    expect(progress(cardioGoal.id)).toMatchObject({ currentProgress: 1, completed: false });

    mockDb.store.set('workouts/strength-valid-3', activity('competition_ineligible', 'workout', 4));
    mockDb.store.set('workouts/cardio-valid-2', activity('personal', 'cardio', 3));
    await MissionEngine.syncUserProgressFromCompletedActivities(USER_ID);

    expect(progress(strengthGoal.id)).toMatchObject({ currentProgress: 3, completed: true });
    expect(progress(cardioGoal.id)).toMatchObject({ currentProgress: 2, completed: true });
  });

  test('falha técnica não conta antes da decisão; se aprovada depois, entra exatamente uma vez em ambas modalidades', async () => {
    const strengthGoal = { ...strengthMission, target: 1 };
    const cardioGoal = { ...cardioMission, target: 1 };
    (MissionEngine.getMissions as jest.Mock).mockResolvedValue([strengthGoal, cardioGoal]);
    mockDb = createDb({
      [`workouts/strength-pending`]: activity('technical_pending', 'workout', 1),
      [`workouts/cardio-pending`]: activity('technical_pending', 'cardio', 1),
    });

    await MissionEngine.syncUserProgressFromCompletedActivities(USER_ID);
    expect(progress(strengthGoal.id)).toMatchObject({ currentProgress: 0, completed: false });
    expect(progress(cardioGoal.id)).toMatchObject({ currentProgress: 0, completed: false });

    mockDb.store.set('workouts/strength-pending', activity('approved', 'workout', 1));
    mockDb.store.set('workouts/cardio-pending', activity('approved', 'cardio', 1));
    await MissionEngine.syncUserProgressFromCompletedActivities(USER_ID);
    await MissionEngine.syncUserProgressFromCompletedActivities(USER_ID);

    expect(progress(strengthGoal.id)).toMatchObject({ currentProgress: 1, completed: true });
    expect(progress(cardioGoal.id)).toMatchObject({ currentProgress: 1, completed: true });
  });

  test('falha técnica que termina rejeitada continua em zero para musculação e cardio', async () => {
    const strengthGoal = { ...strengthMission, target: 1 };
    const cardioGoal = { ...cardioMission, target: 1 };
    (MissionEngine.getMissions as jest.Mock).mockResolvedValue([strengthGoal, cardioGoal]);
    mockDb = createDb({
      [`workouts/strength-pending`]: activity('technical_pending', 'workout', 1),
      [`workouts/cardio-pending`]: activity('technical_pending', 'cardio', 1),
    });

    await MissionEngine.syncUserProgressFromCompletedActivities(USER_ID);
    mockDb.store.set('workouts/strength-pending', activity('fraud_rejected', 'workout', 1));
    mockDb.store.set('workouts/cardio-pending', activity('fraud_rejected', 'cardio', 1));
    await MissionEngine.syncUserProgressFromCompletedActivities(USER_ID);

    expect(progress(strengthGoal.id)).toMatchObject({ currentProgress: 0, completed: false });
    expect(progress(cardioGoal.id)).toMatchObject({ currentProgress: 0, completed: false });
  });

  test('Buscar Objetivo rejeita também o estado terminal antifraude, não só pendingReview', () => {
    const source = readFileSync(resolve(process.cwd(), 'api/_lib/cardio-objective-activity-sync.ts'), 'utf8');
    expect(source).toContain('competitionReviewStatus');
    expect(source).toContain('validationStatus');
    expect(source).toContain('securityDecision');
  });

  test('reconciliador técnico sincroniza missões e Buscar Objetivo após aprovação automática', () => {
    const source = readFileSync(resolve(process.cwd(), 'api/_lib/pending-review-reconciler.ts'), 'utf8');
    expect(source).toContain('MissionEngine.syncUserProgressFromCompletedActivities');
    expect(source).toContain('reconcileCardioObjectiveActivity');
    expect(source).toContain("status === 'rejected' ? { missionEligible: false }");
  });
});
