let mockDb: any;

jest.mock('../_lib/common', () => ({
  get db() { return mockDb; },
}));
jest.mock('../_lib/activity-competition-policy', () => ({
  persistActivityCompetitionEntries: jest.fn(),
}));
jest.mock('../_lib/championship-scoring-service', () => ({
  submitActivityToActiveChampionships: jest.fn(),
  syncReviewedActivityCompetitionScores: jest.fn(),
}));
jest.mock('../_lib/igaService', () => ({
  recalculateAllUserScores: jest.fn(),
}));

import { promoteCanonicalCompetitionProjection } from '../_lib/activity-competition-promotion';
import { persistActivityCompetitionEntries } from '../_lib/activity-competition-policy';
import { submitActivityToActiveChampionships } from '../_lib/championship-scoring-service';
import { recalculateAllUserScores } from '../_lib/igaService';

function createDb() {
  const store = new Map<string, Record<string, any>>();
  const snap = (value: Record<string, any> | undefined) => ({
    exists: value !== undefined,
    data: () => value,
  });
  const ref = (collection: string, id: string) => ({
    key: `${collection}/${id}`,
    id,
    get: async () => snap(store.get(`${collection}/${id}`)),
    set: async (value: Record<string, any>, options?: { merge?: boolean }) => {
      const key = `${collection}/${id}`;
      store.set(key, options?.merge ? { ...(store.get(key) || {}), ...value } : { ...value });
    },
  });
  return {
    store,
    collection: (collection: string) => ({ doc: (id: string) => ref(collection, id) }),
    runTransaction: async (callback: (transaction: any) => Promise<any>) => {
      const writes: Array<{ target: any; value: Record<string, any>; merge?: boolean }> = [];
      const transaction = {
        get: async (target: any) => snap(store.get(target.key)),
        set: (target: any, value: Record<string, any>, options?: { merge?: boolean }) => {
          writes.push({ target, value, merge: options?.merge });
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

const incomingContext = {
  type: 'gym_ranking' as const,
  id: 'gym-a',
  label: 'Ranking da Academia',
  enrollmentId: 'enrollment-a',
  epochId: 'enrollment-a:1',
  requiresGymCheckIn: false,
  requiresContinuousGps: true,
  requiresMotionSensors: true,
};

const policy = {
  version: 'activity-competition-v2' as const,
  activityType: 'cardio' as const,
  cardioType: 'running',
  isIndoorCardio: false,
  resolvedAt: '2026-09-06T10:00:00.000Z',
  effectiveAt: '2026-09-06T10:00:00.000Z',
  contexts: [incomingContext],
  requiresSecurityReview: true,
  requiresGymCheckIn: false,
  requiresContinuousGps: true,
  requiresMotionSensors: true,
};

function seedCanonical(overrides: Record<string, any> = {}) {
  mockDb.store.set('workouts/wearable-a', {
    userId: 'user-a', source: 'health_connect', type: 'cardio', cardioType: 'running',
    startTime: '2026-09-06T10:00:00.000Z', endTime: '2026-09-06T11:30:00.000Z',
    duration: 90, avgHeartRate: 240, calories: 9999,
    economyEligible: true, missionEligible: true, activityXpAwarded: 180,
    competitionReviewStatus: 'ineligible', isScoringEligible: false,
    competitionContexts: [{ ...incomingContext, requiresContinuousGps: false }],
    ...overrides,
  });
  mockDb.store.set('users/user-a', { name: 'Atleta A', gymName: 'Academia A' });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDb = createDb();
  seedCanonical();
  (persistActivityCompetitionEntries as jest.Mock).mockResolvedValue(undefined);
  (submitActivityToActiveChampionships as jest.Mock).mockResolvedValue(undefined);
  (recalculateAllUserScores as jest.Mock).mockResolvedValue({ weekly: { igaRanking: 77 } });
});

test('promoção preserva XP pessoal e usa somente policy/métricas da fonte confiável', async () => {
  await expect(promoteCanonicalCompetitionProjection({
    userId: 'user-a', canonicalActivityId: 'wearable-a', evidenceActivityId: 'strava-a',
    evidenceSource: 'strava_oauth', startTime: '2026-09-06T10:02:00.000Z',
    endTime: '2026-09-06T10:32:00.000Z', durationMinutes: 30, distanceKm: 5,
    activityType: 'cardio', cardioType: 'running', isIndoorCardio: false,
    calories: 300, avgHeartRate: 140, maxHeartRate: 170,
    policy, outcome: { status: 'approved', decision: 'APPROVED', reviewApplied: true }, score: 60,
  })).resolves.toEqual({ promoted: true, activityId: 'wearable-a' });

  expect(mockDb.store.get('workouts/wearable-a')).toMatchObject({
    duration: 90,
    avgHeartRate: 240,
    calories: 9999,
    activityXpAwarded: 180,
    missionEligible: true,
    competitionReviewStatus: 'approved',
    competitionPoints: 60,
    competitionEvidenceSource: 'strava_oauth',
    competitionEvidenceMetrics: {
      durationMinutes: 30, distanceKm: 5, avgHeartRate: 140, calories: 300,
      isIndoorCardio: false,
    },
    competitionContexts: [{ requiresContinuousGps: true }],
  });
  expect(persistActivityCompetitionEntries).toHaveBeenCalledWith(expect.objectContaining({
    activityId: 'wearable-a', policy: expect.objectContaining({ contexts: [incomingContext] }),
  }));
  expect(recalculateAllUserScores).toHaveBeenCalledWith('user-a');
  expect(submitActivityToActiveChampionships).toHaveBeenCalledWith(expect.objectContaining({
    activityId: 'wearable-a', durationMinutes: 30, distanceKm: 5,
  }));
});

test('evidência nativa aprovada supera Strava pendente e fonte inferior não rebaixa aprovação', async () => {
  const base = {
    userId: 'user-a', canonicalActivityId: 'wearable-a',
    startTime: '2026-09-06T10:02:00.000Z', endTime: '2026-09-06T10:32:00.000Z',
    durationMinutes: 30, activityType: 'cardio' as const, cardioType: 'running',
    isIndoorCardio: false, policy, score: 60,
  };
  await promoteCanonicalCompetitionProjection({
    ...base, evidenceActivityId: 'strava-a', evidenceSource: 'strava_oauth',
    outcome: { status: 'pending_review', decision: 'UNDER_REVIEW' },
  });
  await expect(promoteCanonicalCompetitionProjection({
    ...base, evidenceActivityId: 'native-a', evidenceSource: 'invictus_native',
    avgHeartRate: 135, outcome: { status: 'approved', decision: 'APPROVED' },
  })).resolves.toMatchObject({ promoted: true });
  await expect(promoteCanonicalCompetitionProjection({
    ...base, evidenceActivityId: 'strava-b', evidenceSource: 'strava_oauth',
    outcome: { status: 'rejected', decision: 'REJECTED' },
  })).resolves.toMatchObject({ promoted: false });

  expect(mockDb.store.get('workouts/wearable-a')).toMatchObject({
    competitionReviewStatus: 'approved',
    competitionEvidenceSource: 'invictus_native',
    competitionEvidenceActivityId: 'native-a',
  });
});

test('não promove sem sobreposição e ignora contexts forjados/ausentes do wearable', async () => {
  const base = {
    userId: 'user-a', canonicalActivityId: 'wearable-a', evidenceActivityId: 'strava-a',
    evidenceSource: 'strava_oauth' as const, durationMinutes: 30, activityType: 'cardio' as const,
    policy, outcome: { status: 'approved' as const, decision: 'APPROVED' }, score: 60,
  };
  await expect(promoteCanonicalCompetitionProjection({
    ...base, startTime: '2026-09-06T14:00:00.000Z', endTime: '2026-09-06T14:30:00.000Z',
  })).resolves.toMatchObject({ promoted: false });
  seedCanonical({ competitionContexts: [] });
  await expect(promoteCanonicalCompetitionProjection({
    ...base, startTime: '2026-09-06T10:02:00.000Z', endTime: '2026-09-06T10:32:00.000Z',
    policy: { ...policy, contexts: [{ ...incomingContext, epochId: 'other-epoch' }] },
  })).resolves.toMatchObject({ promoted: true });
  expect(mockDb.store.get('workouts/wearable-a')).toMatchObject({
    competitionContexts: [{ epochId: 'other-epoch', requiresContinuousGps: true }],
    activityXpAwarded: 180,
    missionEligible: true,
  });
});
