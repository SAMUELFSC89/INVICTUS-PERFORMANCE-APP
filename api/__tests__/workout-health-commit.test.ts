import { ValidateActivityService } from '../_services/activities/validate-activity-service';
import { commitActivityAfterPresenceCheck } from '../_lib/activity-commit-service';
import { ActivityRepository } from '../_repositories/activity-repository';
import { UserRepository } from '../_repositories/user-repository';
import { SecurityPipeline } from '../_lib/security-pipeline';
import { recalculateAllUserScores } from '../_lib/igaService';
import { registrarAmostrasDeAtividade } from '../_lib/health-data-layer';
import { submitActivityToActiveChampionships } from '../_lib/championship-scoring-service';
import { db } from '../_lib/common';
import { loadActivityCompetitionPolicySnapshot, persistActivityCompetitionEntries } from '../_lib/activity-competition-policy';
import { MissionEngine } from '../_lib/mission-engine';
import { GpsEngine } from '../_lib/gps-engine';

jest.mock('../_lib/common', () => ({ db: { collection: jest.fn() } }));
jest.mock('../_repositories/activity-repository', () => ({ ActivityRepository: jest.fn() }));
jest.mock('../_repositories/user-repository', () => ({ UserRepository: jest.fn() }));
jest.mock('../_lib/security-pipeline', () => ({ SecurityPipeline: { runPipeline: jest.fn() } }));
jest.mock('../_lib/igaService', () => ({ recalculateAllUserScores: jest.fn() }));
jest.mock('../_lib/health-data-layer', () => ({ registrarAmostrasDeAtividade: jest.fn() }));
jest.mock('../_lib/user-activity-history', () => ({ buscarHistoricoRecente: async () => [] }));
jest.mock('../_lib/championship-scoring-service', () => ({ submitActivityToActiveChampionships: jest.fn() }));
jest.mock('../_lib/activity-competition-policy', () => ({
  loadActivityCompetitionPolicySnapshot: jest.fn(),
  persistActivityCompetitionEntries: jest.fn(),
}));
jest.mock('../_lib/activity-identity', () => ({
  reserveActivityIdentity: jest.fn().mockResolvedValue({
    status: 'claimed', canonicalActivityId: 'saved-activity', reservationToken: 'test-token',
  }),
  commitActivityIdentityReservation: jest.fn().mockResolvedValue({ status: 'committed' }),
}));
jest.mock('../_lib/mission-engine', () => ({ MissionEngine: { syncUserProgressFromCompletedActivities: jest.fn() } }));
jest.mock('../_lib/gps-engine', () => ({ GpsEngine: { evaluate: jest.fn() } }));
jest.mock('../_lib/geofence-engine', () => ({ MAX_GEOFENCE_RADIUS_METERS: 80, MAX_GPS_ACCURACY_METERS: 30, validateGeofenceCheckin: () => ({ approved: false, status: 'outside', reason: 'Outside gym', userFacingMessage: 'Atividade em análise.' }) }));

let activities: { create: jest.Mock; findById: jest.Mock; findRecentByUser: jest.Mock; update: jest.Mock };
let users: { findById: jest.Mock; addXP: jest.Mock };
let audit: { log: jest.Mock };
let notification: { send: jest.Mock };
let service: ValidateActivityService;
const startedAt = '2026-09-05T10:00:00.000Z';
const endedAt = '2026-09-05T11:00:00.000Z';
const personalPolicy = {
  version: 'activity-competition-v2' as const,
  activityType: 'workout' as const,
  isIndoorCardio: false,
  resolvedAt: '2026-09-05T09:59:00.000Z',
  effectiveAt: startedAt,
  contexts: [],
  requiresSecurityReview: false,
  requiresGymCheckIn: false,
  requiresContinuousGps: false,
  requiresMotionSensors: false,
  snapshotId: 'session-authenticated',
  sessionId: 'session-authenticated',
  startBy: '2026-09-05T10:30:00.000Z',
  expiresAt: '2026-09-12T10:00:00.000Z',
};
const competitivePolicy = (requiresGymCheckIn = false) => ({
  ...personalPolicy,
  contexts: [{
    type: 'paid_championship' as const,
    id: 'champ-a',
    label: 'Campeonato A',
    enrollmentId: 'registration-a',
    requiresGymCheckIn,
    requiresContinuousGps: false,
    requiresMotionSensors: true,
  }],
  requiresSecurityReview: true,
  requiresGymCheckIn,
  requiresMotionSensors: true,
});
function health() {
  return {
    version: 1, sessionId: 'session-authenticated', startedAt, endedAt,
    ownerId: 'attacker-selected-other-user', points: 999999,
    sets: [{ id: 'set-1', exerciseId: 'squat', exerciseName: 'Agachamento', equipment: 'Barra', startedAt, endedAt: '2026-09-05T10:00:45.000Z', status: 'completed', timingSource: 'user_marked', reps: 8, loadKg: 50 }],
    heartRate: { status: 'available', source: 'apple_health', sourceKey: 'device-A', samples: [{ timestamp: '2026-09-05T10:00:20.000Z', bpm: 135 }], fetchedAt: '2026-09-05T11:01:00.000Z', truncated: false }
  };
}
function request(healthSession?: unknown) {
  return { userId: 'authenticated-user', activityData: {
    type: 'workout', sessionId: 'session-authenticated', competitionPolicySnapshotId: 'session-authenticated',
    competitionPolicyVersion: 'activity-competition-v2', muscleGroup: 'legs', duration: 60,
    intensity: 'moderate' as const, startTime: startedAt, endTime: endedAt,
    ...(healthSession !== undefined ? { healthSession } : {})
  } };
}
function security(shouldScore = true, eligible = true) {
  (SecurityPipeline.runPipeline as jest.Mock).mockResolvedValue({ shouldScore, decision: shouldScore ? 'APPROVED' : 'UNDER_REVIEW', report: { validation: { competitivelyEligible: eligible, ineligibleReason: eligible ? undefined : 'Tempo mínimo não atingido.' }, explanation: {} } });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers().setSystemTime(new Date('2026-09-05T12:00:00Z'));
  for (const name of ['log', 'warn', 'error'] as const) jest.spyOn(console, name).mockImplementation(() => {});
  activities = {
    create: jest.fn(async (value) => ({ ...value, id: 'saved-activity', createdAt: endedAt })),
    findById: jest.fn(async () => null),
    findRecentByUser: jest.fn(async () => []),
    update: jest.fn(async () => undefined),
  };
  users = { findById: jest.fn(async () => ({ id: 'authenticated-user', weightKg: 70 })), addXP: jest.fn(async () => ({ newXP: 500, newLevel: 2 })) };
  audit = { log: jest.fn(async () => undefined) }; notification = { send: jest.fn(async () => undefined) };
  (ActivityRepository as unknown as jest.Mock).mockImplementation(() => activities);
  (UserRepository as unknown as jest.Mock).mockImplementation(() => users);
  (db.collection as jest.Mock).mockImplementation(() => ({ doc: () => ({ get: async () => ({ data: () => ({}) }) }), where: () => ({ get: async () => ({ docs: [] }) }) }));
  (recalculateAllUserScores as jest.Mock).mockResolvedValue({ weekly: { igaRanking: 73 }, monthly: { average: 65 }, season: { average: 60 } });
  (registrarAmostrasDeAtividade as jest.Mock).mockResolvedValue(undefined);
  (submitActivityToActiveChampionships as jest.Mock).mockResolvedValue(undefined);
  (loadActivityCompetitionPolicySnapshot as jest.Mock).mockResolvedValue(personalPolicy);
  (persistActivityCompetitionEntries as jest.Mock).mockResolvedValue(undefined);
  (MissionEngine.syncUserProgressFromCompletedActivities as jest.Mock).mockResolvedValue(undefined);
  security();
  service = new ValidateActivityService(activities as any, users as any, audit as any, notification as any);
});
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

test('atividade casual é concluída, ganha XP e alimenta missões sem análise competitiva', async () => {
  const result = await service.execute(request(health())) as any;
  const persisted = activities.create.mock.calls[0][0];
  expect(persisted).toMatchObject({
    recordStatus: 'completed',
    activityMode: 'personal',
    competitionReviewStatus: 'not_required',
    activityXpAwarded: 144,
    points: 144,
    competitionPoints: 0,
    missionEligible: true,
  });
  expect(result.scoreAwarded).toBe(144);
  expect(SecurityPipeline.runPipeline).not.toHaveBeenCalled();
  expect(persistActivityCompetitionEntries).not.toHaveBeenCalled();
  expect(recalculateAllUserScores).not.toHaveBeenCalled();
  expect(submitActivityToActiveChampionships).not.toHaveBeenCalled();
  expect(MissionEngine.syncUserProgressFromCompletedActivities).toHaveBeenCalledWith(
    'authenticated-user',
    expect.any(Array),
  );
});

test('sessão técnica com menos de um minuto fica no histórico sem XP, missão ou Coins', async () => {
  const input = request();
  input.activityData.duration = 0.5;
  const result = await service.execute(input) as any;
  const persisted = activities.create.mock.calls[0][0];
  expect(persisted).toMatchObject({
    recordStatus: 'completed',
    activityMode: 'personal',
    economyEligible: false,
    missionEligible: false,
    activityXpAwarded: 0,
    competitionPoints: 0,
  });
  expect(result.scoreAwarded).toBe(0);
  expect(result.message).toMatch(/menos de 1 minuto/i);
  expect(SecurityPipeline.runPipeline).not.toHaveBeenCalled();
});

test('cardio casual preserva a distância e não executa o motor GPS antifraude', async () => {
  (loadActivityCompetitionPolicySnapshot as jest.Mock).mockResolvedValue({
    ...personalPolicy,
    activityType: 'cardio',
    cardioType: 'running',
  });
  const input = request();
  Object.assign(input.activityData, { type: 'cardio', cardioType: 'running', distanceKm: 7.25 });
  await service.execute(input);
  expect(GpsEngine.evaluate).not.toHaveBeenCalled();
  expect(activities.create.mock.calls[0][0]).toMatchObject({
    activityMode: 'personal',
    distance: 7.25,
    points: 144,
    competitionPoints: 0,
  });
});

test('snapshot é obrigatório e a decisão não depende de marcador de versão opcional', async () => {
  const withoutMarker = request();
  delete (withoutMarker.activityData as any).competitionPolicyVersion;
  await expect(service.execute(withoutMarker)).resolves.toMatchObject({ activityMode: 'personal' });
  expect(loadActivityCompetitionPolicySnapshot).toHaveBeenCalledTimes(1);

  jest.clearAllMocks();
  const withoutSnapshot = request();
  delete (withoutSnapshot.activityData as any).competitionPolicySnapshotId;
  await expect(service.execute(withoutSnapshot)).rejects.toThrow(/autorização desta sessão está ausente/i);
  expect(loadActivityCompetitionPolicySnapshot).not.toHaveBeenCalled();
});

test('retry concilia XP e missões sem criar outra atividade após falha parcial', async () => {
  users.addXP.mockRejectedValueOnce(new Error('xp temporariamente indisponível'));
  await expect(service.execute(request())).rejects.toThrow('xp temporariamente indisponível');
  const persisted = await activities.create.mock.results[0].value;
  activities.findById.mockResolvedValueOnce(persisted);

  const retried = await service.execute(request()) as any;
  expect(retried).toMatchObject({ success: true, activityId: 'saved-activity', scoreAwarded: 144, level: 2 });
  expect(activities.create).toHaveBeenCalledTimes(1);
  expect(users.addXP).toHaveBeenCalledTimes(2);
  expect(MissionEngine.syncUserProgressFromCompletedActivities).toHaveBeenCalledTimes(2);
});

test.each(['approved', 'not-eligible', 'security-pending', 'geofence-pending'] as const)('preserva observações em persistência e resposta: %s', async (branch) => {
  (loadActivityCompetitionPolicySnapshot as jest.Mock).mockResolvedValue(competitivePolicy(branch === 'geofence-pending'));
  if (branch === 'not-eligible') security(true, false);
  if (branch === 'security-pending') security(false);
  const result = await service.execute(request(health())) as any;
  const persisted = activities.create.mock.calls[0][0];
  expect(persisted.userId).toBe('authenticated-user');
  expect(persisted.healthSession).toMatchObject({ sessionId: 'session-authenticated', startedAt, endedAt, sets: [{ reps: 8, loadKg: 50 }], heartRate: { samples: [{ bpm: 135 }] } });
  expect(persisted.healthSession.ownerId).toBeUndefined();
  expect(persisted.healthSession.points).toBeUndefined();
  expect(result.healthSession).toEqual(persisted.healthSession);
  expect(result.workout.healthSession).toEqual(persisted.healthSession);
  expect(result.healthSessionStatus).toBe('partial');
  expect(result.workout.healthSessionStatus).toBe('partial');
  expect(result.healthSessionReason).toMatch(/Cobertura parcial de FC/);
  expect(result.healthSession.heartRate.audit).toMatchObject({
    receivedSampleCount: 1,
    validSampleCount: 1,
    coveragePercent: 0,
    quality: 'insufficient',
  });
  expect(persisted.points).toBe(144);
  expect(persisted.competitionPoints).toBe(branch === 'approved' ? 144 : 0);
  for (const [entry] of audit.log.mock.calls) expect(entry.details?.activityData?.healthSession).toBeUndefined();
});

test('adicionar saúde não modifica entrada do antifraude, XP, IGA, evidência ou competições', async () => {
  (loadActivityCompetitionPolicySnapshot as jest.Mock).mockResolvedValue(competitivePolicy(false));
  const baseline = await service.execute(request());
  const baselineSaved = activities.create.mock.calls[0][0];
  const baselineSecurity = (SecurityPipeline.runPipeline as jest.Mock).mock.calls[0];
  const baselineChampionship = (submitActivityToActiveChampionships as jest.Mock).mock.calls[0];
  const withHealth = await service.execute(request(health()));
  const updatedSaved = activities.create.mock.calls[1][0];
  expect(withHealth.scoreAwarded).toBe(baseline.scoreAwarded);
  expect(withHealth.rankingPointsEarned).toBe(baseline.rankingPointsEarned);
  expect((SecurityPipeline.runPipeline as jest.Mock).mock.calls[1]).toEqual(baselineSecurity);
  expect((submitActivityToActiveChampionships as jest.Mock).mock.calls[1]).toEqual(baselineChampionship);
  for (const key of ['points', 'pointsEarned', 'scoreAwarded', 'rankingPointsEarned', 'duration', 'distance', 'status', 'validationStatus', 'evidence', 'calories', 'avgHeartRate']) expect(updatedSaved[key]).toEqual(baselineSaved[key]);
  expect(users.addXP.mock.calls[1]).toEqual(users.addXP.mock.calls[0]);
  // Campeonato pago não recalcula o ranking IGA da academia.
  expect((recalculateAllUserScores as jest.Mock).mock.calls).toEqual([]);
});

test('saúde malformada não rejeita treino nem altera XP', async () => {
  const baseline = await service.execute(request());
  const result = await service.execute(request({ version: 1, sessionId: 'bad', sets: [{ loadKg: Number.NaN }] })) as any;
  expect(result.success).toBe(true);
  expect(result.scoreAwarded).toBe(baseline.scoreAwarded);
  expect(result.healthSessionStatus).toBe('unavailable');
  expect(result.workout.healthSession).toBeUndefined();
  expect(activities.create.mock.calls[1][0].healthSessionStatus).toBe('unavailable');
});

test.each(['approved', 'pending'] as const)('confirmação de presença persiste saúde sem mudar pontos: %s', async (presenceOutcome) => {
  const baseline = await commitActivityAfterPresenceCheck({ userId: 'authenticated-user', rawActivity: request().activityData, presenceOutcome });
  const result = await commitActivityAfterPresenceCheck({ userId: 'authenticated-user', rawActivity: request(health()).activityData, presenceOutcome });
  expect(result.pointsAwarded).toBe(baseline.pointsAwarded);
  expect(result.weeklyIgaScore).toBe(baseline.weeklyIgaScore);
  expect(result.healthSession?.sessionId).toBe('session-authenticated');
  expect(activities.create.mock.calls[1][0].healthSession).toEqual(result.healthSession);
  expect(activities.create.mock.calls[1][0].userId).toBe('authenticated-user');
});

test('saúde nunca neutraliza rejeição por fraude existente', async () => {
  const input = request(health()); input.activityData.duration = 400;
  await expect(service.execute(input)).rejects.toThrow(/Duração excessiva/);
  expect(activities.create).not.toHaveBeenCalled();
  expect(audit.log).not.toHaveBeenCalled();
});
