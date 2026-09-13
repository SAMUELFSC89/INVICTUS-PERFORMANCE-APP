let mockDb: any;

jest.mock('../_lib/common', () => ({
  get db() { return mockDb; },
  FieldValue: {
    serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP'),
    delete: jest.fn(() => 'DELETE_FIELD'),
  },
}));
jest.mock('../_lib/security-pipeline', () => ({ SecurityPipeline: { runPipeline: jest.fn() } }));
jest.mock('../_lib/user-activity-history', () => ({ buscarHistoricoRecente: jest.fn(async () => []) }));
jest.mock('../_lib/activity-dedup', () => ({ encontrarAtividadeDuplicada: jest.fn() }));
jest.mock('../_lib/igaService', () => ({ recalculateAllUserScores: jest.fn() }));
jest.mock('../_lib/health-data-layer', () => ({ registrarAmostrasDeAtividade: jest.fn() }));
jest.mock('../_lib/activity-competition-policy', () => ({
  resolveActivityCompetitionPolicy: jest.fn(),
  persistActivityCompetitionEntries: jest.fn(),
}));
jest.mock('../_lib/championship-scoring-service', () => ({ submitActivityToActiveChampionships: jest.fn() }));
jest.mock('../_lib/activity-reward-service', () => ({ settleCompletedActivityRewards: jest.fn() }));
jest.mock('../_lib/activity-competition-promotion', () => ({
  promoteCanonicalCompetitionProjection: jest.fn(),
}));
jest.mock('../_lib/activity-identity', () => ({
  reserveActivityIdentity: jest.fn().mockImplementation((input: any) => Promise.resolve({
    status: 'claimed', canonicalActivityId: input.activityId, reservationToken: `token-${input.activityId}`,
  })),
  commitActivityIdentityReservation: jest.fn().mockImplementation(async ({ input, payload, mode }: any) => {
    const key = `workouts/${input.activityId}`;
    const existing = mockDb.store.get(key);
    if (existing && mode === 'create') return { status: 'existing', activity: existing };
    mockDb.store.set(key, mode === 'merge' ? { ...(existing || {}), ...payload } : { ...payload });
    return { status: 'committed' };
  }),
}));

import { SyncService } from '../_lib/sync-service';
import { processarAtividadeWearable } from '../_lib/wearable-sync-service';
import { SecurityPipeline } from '../_lib/security-pipeline';
import { encontrarAtividadeDuplicada } from '../_lib/activity-dedup';
import { recalculateAllUserScores } from '../_lib/igaService';
import {
  persistActivityCompetitionEntries,
  resolveActivityCompetitionPolicy,
} from '../_lib/activity-competition-policy';
import { submitActivityToActiveChampionships } from '../_lib/championship-scoring-service';
import { settleCompletedActivityRewards } from '../_lib/activity-reward-service';
import { promoteCanonicalCompetitionProjection } from '../_lib/activity-competition-promotion';

function createDb() {
  const store = new Map<string, Record<string, any>>([
    ['users/user-a', { name: 'Atleta A', xp: 100 }],
  ]);
  const snapshot = (value: Record<string, any> | undefined) => ({
    exists: Boolean(value),
    data: () => value,
  });
  const ref = (collection: string, id: string) => {
    const key = `${collection}/${id}`;
    return {
      id,
      get: async () => snapshot(store.get(key)),
      create: async (value: Record<string, any>) => {
        if (store.has(key)) throw Object.assign(new Error('already exists'), { code: 6 });
        store.set(key, { ...value });
      },
      set: async (value: Record<string, any>, options?: { merge?: boolean }) => {
        store.set(key, options?.merge ? { ...(store.get(key) || {}), ...value } : { ...value });
      },
    };
  };
  return {
    store,
    collection: (name: string) => ({
      doc: (id: string) => ref(name, id),
    }),
  };
}

const personalPolicy = {
  version: 'activity-competition-v2',
  activityType: 'cardio',
  cardioType: 'cardio',
  isIndoorCardio: false,
  resolvedAt: '2026-09-05T09:00:00.000Z',
  effectiveAt: '2026-09-05T09:00:00.000Z',
  contexts: [],
  requiresSecurityReview: false,
  requiresGymCheckIn: false,
  requiresContinuousGps: false,
  requiresMotionSensors: false,
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers().setSystemTime(new Date('2026-09-06T12:00:00.000Z'));
  mockDb = createDb();
  (encontrarAtividadeDuplicada as jest.Mock).mockResolvedValue(null);
  (resolveActivityCompetitionPolicy as jest.Mock).mockResolvedValue(personalPolicy);
  (settleCompletedActivityRewards as jest.Mock).mockImplementation(async (input: any) => {
    const unverifiedWearable = input?.source === 'health_connect' || input?.source === 'apple_health';
    return unverifiedWearable
      ? { economyEligible: false, activityXP: 0, credited: false, economyVersion: 1 }
      : { economyEligible: true, activityXP: 40, credited: true, economyVersion: 1 };
  });
  (persistActivityCompetitionEntries as jest.Mock).mockResolvedValue(undefined);
  (recalculateAllUserScores as jest.Mock).mockResolvedValue({ weekly: { igaRanking: 50 } });
  (submitActivityToActiveChampionships as jest.Mock).mockResolvedValue(undefined);
  (promoteCanonicalCompetitionProjection as jest.Mock).mockResolvedValue({ promoted: true, activityId: 'canonical-a' });
});

afterEach(() => {
  jest.useRealTimers();
});

test('Strava casual salva atividade concluída, dá XP/missão e não executa antifraude', async () => {
  await expect(SyncService.processStravaActivity('user-a', {
    id: 's-1', type: 'Ride', moving_time: 1200, distance: 5000,
    start_date: '2026-09-05T09:00:00.000Z',
  })).resolves.toBe(true);

  expect(SecurityPipeline.runPipeline).not.toHaveBeenCalled();
  expect(recalculateAllUserScores).not.toHaveBeenCalled();
  expect(submitActivityToActiveChampionships).not.toHaveBeenCalled();
  expect(settleCompletedActivityRewards).toHaveBeenCalledWith(expect.objectContaining({
    userId: 'user-a', activityId: 'strava_s-1', type: 'cardio', source: 'strava',
  }));
  expect(mockDb.store.get('workouts/strava_s-1')).toMatchObject({
    recordStatus: 'completed', status: 'completed', activityMode: 'personal',
    competitionReviewStatus: 'not_required', missionEligible: true,
    missionAccessTier: 'free', missionAccessVersion: 1,
    activityXpAwarded: 40, competitionPoints: 0,
  });
});

test('wearable sem atestação preserva histórico, mas não gera XP, missão ou placar', async () => {
  (resolveActivityCompetitionPolicy as jest.Mock).mockResolvedValue({
    ...personalPolicy,
    contexts: [{
      type: 'community_championship', id: 'community_friends_v1', label: 'Amigos',
      enrollmentId: 'enrollment-a', requiresGymCheckIn: false,
      requiresContinuousGps: true, requiresMotionSensors: false,
    }],
    requiresSecurityReview: true,
    requiresContinuousGps: true,
  });
  const result = await processarAtividadeWearable('user-a', {
    source: 'health_connect', sourceActivityId: 'hc-1', activityType: 'Corrida',
    startTime: '2026-09-05T09:00:00.000Z', durationSeconds: 1200,
    distanceMeters: 3000,
  }, { name: 'Atleta A' });

  expect(result).toMatchObject({ status: 'approved', competitionReviewStatus: 'ineligible' });
  const saved = [...mockDb.store.entries()].find(([key]) => key.startsWith('workouts/wearable_'))?.[1];
  expect(saved).toMatchObject({
    recordStatus: 'completed', status: 'completed', activityMode: 'competitive',
    competitionReviewStatus: 'ineligible', pendingReview: false,
    nonScoringReason: 'UNVERIFIED_WEARABLE_SOURCE',
    missionAccessTier: 'free', missionAccessVersion: 1,
    missionEligible: false, economyEligible: false, activityXpAwarded: 0, competitionPoints: 0,
  });
  expect(SecurityPipeline.runPipeline).not.toHaveBeenCalled();
  expect(settleCompletedActivityRewards).toHaveBeenCalledWith(expect.objectContaining({
    source: 'health_connect',
  }));
  expect(persistActivityCompetitionEntries).toHaveBeenCalledWith(expect.objectContaining({
    reviewStatus: 'ineligible',
  }));
  expect(recalculateAllUserScores).not.toHaveBeenCalled();
  expect(submitActivityToActiveChampionships).not.toHaveBeenCalled();
});

test('cópia wearable de outra fonte não recebe XP nem progresso de missão', async () => {
  (encontrarAtividadeDuplicada as jest.Mock).mockResolvedValue({
    id: 'canonical-a', fonte: 'invictus', motivo: 'MESMA_JANELA_E_METRICAS', detalhe: 'Duplicada',
  });
  const result = await processarAtividadeWearable('user-a', {
    source: 'apple_health', sourceActivityId: 'ah-duplicate', activityType: 'Corrida',
    startTime: '2026-09-05T09:00:00.000Z', durationSeconds: 1200, distanceMeters: 3000,
  }, {});

  expect(result.status).toBe('duplicate');
  expect(settleCompletedActivityRewards).not.toHaveBeenCalled();
  const saved = [...mockDb.store.entries()].find(([key]) => key.startsWith('workouts/wearable_'))?.[1];
  expect(saved).toMatchObject({
    recordStatus: 'completed', dataQualityStatus: 'duplicate',
    missionEligible: false, economyEligible: false, activityXpAwarded: 0,
  });

  (encontrarAtividadeDuplicada as jest.Mock).mockResolvedValue(null);
  (settleCompletedActivityRewards as jest.Mock).mockClear();
  await expect(processarAtividadeWearable('user-a', {
    source: 'apple_health', sourceActivityId: 'ah-duplicate', activityType: 'Corrida',
    startTime: '2026-09-05T09:00:00.000Z', durationSeconds: 1200, distanceMeters: 3000,
  }, {})).resolves.toMatchObject({ status: 'duplicate' });
  expect(settleCompletedActivityRewards).not.toHaveBeenCalled();
});

test('atividade manual do Strava fica no histórico sem XP ou missão', async () => {
  await expect(SyncService.processStravaActivity('user-a', {
    id: 'manual-1', sport_type: 'Run', moving_time: 1200, distance: 80,
    start_date: '2026-09-05T09:00:00.000Z', manual: true,
  })).resolves.toBe(true);

  expect(SecurityPipeline.runPipeline).not.toHaveBeenCalled();
  expect(settleCompletedActivityRewards).not.toHaveBeenCalled();
  expect(mockDb.store.get('workouts/strava_manual-1')).toMatchObject({
    recordStatus: 'completed', distance: 0.08, dataQualityStatus: 'unverified_manual',
    economyEligible: false, missionEligible: false, activityXpAwarded: 0,
  });
});

test('Strava rejeita atividade sem data real ou que termina no futuro', async () => {
  await expect(SyncService.processStravaActivity('user-a', {
    id: 'bad-date', sport_type: 'Run', moving_time: 1200, distance: 5000,
  })).resolves.toBe(false);
  await expect(SyncService.processStravaActivity('user-a', {
    id: 'future', sport_type: 'Run', moving_time: 1200, distance: 5000,
    start_date: '2026-09-06T12:30:00.000Z',
  })).resolves.toBe(false);
  expect(settleCompletedActivityRewards).not.toHaveBeenCalled();
});

test('Strava confiável promove só a projeção competitiva do wearable canônico', async () => {
  const context = {
    type: 'gym_ranking', id: 'gym-a', label: 'Ranking', enrollmentId: 'enroll-a',
    epochId: 'enroll-a:1', requiresGymCheckIn: false,
    requiresContinuousGps: true, requiresMotionSensors: true,
  };
  mockDb.store.set('workouts/canonical-a', {
    userId: 'user-a', source: 'health_connect', startTime: '2026-09-05T09:00:00.000Z',
    endTime: '2026-09-05T09:30:00.000Z', duration: 30,
    competitionContexts: [context], competitionEvidenceStatus: 'untrusted_client_import',
    economyEligible: true, missionEligible: true,
  });
  (encontrarAtividadeDuplicada as jest.Mock).mockResolvedValue({
    id: 'canonical-a', fonte: 'health_connect', motivo: 'MESMA_JANELA_E_METRICAS', detalhe: 'Duplicada',
  });
  (resolveActivityCompetitionPolicy as jest.Mock).mockResolvedValue({
    ...personalPolicy, cardioType: 'running', contexts: [context],
    requiresSecurityReview: true, requiresContinuousGps: true, requiresMotionSensors: true,
  });
  (SecurityPipeline.runPipeline as jest.Mock).mockResolvedValue({
    shouldScore: true, decision: 'APPROVED',
    report: { activityId: 'report-a', risk: { riskScore: 5 }, validation: { competitivelyEligible: true } },
  });

  await expect(SyncService.processStravaActivity('user-a', {
    id: 'trusted-1', sport_type: 'Run', moving_time: 1800, distance: 5000,
    calories: 300, average_heartrate: 140, start_date: '2026-09-05T09:00:00.000Z',
  })).resolves.toBe(false);

  expect(promoteCanonicalCompetitionProjection).toHaveBeenCalledWith(expect.objectContaining({
    canonicalActivityId: 'canonical-a', evidenceActivityId: 'strava_trusted-1',
    evidenceSource: 'strava_oauth', durationMinutes: 30, distanceKm: 5,
    avgHeartRate: 140, calories: 300,
    policy: expect.objectContaining({ contexts: [context], requiresContinuousGps: true }),
    outcome: expect.objectContaining({ status: 'approved' }),
  }));
  expect(settleCompletedActivityRewards).not.toHaveBeenCalled();
});

test('entrada manual do Strava nunca promove canônico wearable', async () => {
  mockDb.store.set('workouts/canonical-a', {
    userId: 'user-a', source: 'apple_health', competitionContexts: [{}], economyEligible: true,
  });
  (encontrarAtividadeDuplicada as jest.Mock).mockResolvedValue({
    id: 'canonical-a', fonte: 'apple_health', motivo: 'MESMA_JANELA_E_METRICAS', detalhe: 'Duplicada',
  });
  await SyncService.processStravaActivity('user-a', {
    id: 'manual-promotion', sport_type: 'Run', moving_time: 1800, distance: 5000,
    manual: true, start_date: '2026-09-05T09:00:00.000Z',
  });
  expect(promoteCanonicalCompetitionProjection).not.toHaveBeenCalled();
});