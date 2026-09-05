import { ValidateActivityService } from '../_services/activities/validate-activity-service';
import { commitActivityAfterPresenceCheck } from '../_lib/activity-commit-service';
import { ActivityRepository } from '../_repositories/activity-repository';
import { UserRepository } from '../_repositories/user-repository';
import { SecurityPipeline } from '../_lib/security-pipeline';
import { recalculateAllUserScores } from '../_lib/igaService';
import { registrarAmostrasDeAtividade } from '../_lib/health-data-layer';
import { submitActivityToActiveChampionships } from '../_lib/championship-scoring-service';
import { db } from '../_lib/common';

jest.mock('../_lib/common', () => ({ db: { collection: jest.fn() } }));
jest.mock('../_repositories/activity-repository', () => ({ ActivityRepository: jest.fn() }));
jest.mock('../_repositories/user-repository', () => ({ UserRepository: jest.fn() }));
jest.mock('../_lib/security-pipeline', () => ({ SecurityPipeline: { runPipeline: jest.fn() } }));
jest.mock('../_lib/igaService', () => ({ recalculateAllUserScores: jest.fn() }));
jest.mock('../_lib/health-data-layer', () => ({ registrarAmostrasDeAtividade: jest.fn() }));
jest.mock('../_lib/user-activity-history', () => ({ buscarHistoricoRecente: async () => [] }));
jest.mock('../_lib/championship-scoring-service', () => ({ submitActivityToActiveChampionships: jest.fn() }));
jest.mock('../_lib/geofence-engine', () => ({ MAX_GEOFENCE_RADIUS_METERS: 80, MAX_GPS_ACCURACY_METERS: 30, validateGeofenceCheckin: () => ({ approved: false, status: 'outside', reason: 'Outside gym', userFacingMessage: 'Atividade em análise.' }) }));

let championshipActive = false;
let activities: { create: jest.Mock; findRecentByUser: jest.Mock };
let users: { findById: jest.Mock; addXP: jest.Mock };
let audit: { log: jest.Mock };
let notification: { send: jest.Mock };
let service: ValidateActivityService;
const startedAt = '2026-09-05T10:00:00.000Z';
const endedAt = '2026-09-05T11:00:00.000Z';
function health() {
  return {
    version: 1, sessionId: 'session-authenticated', startedAt, endedAt,
    ownerId: 'attacker-selected-other-user', points: 999999,
    sets: [{ id: 'set-1', exerciseId: 'squat', exerciseName: 'Agachamento', equipment: 'Barra', startedAt, endedAt: '2026-09-05T10:00:45.000Z', status: 'completed', timingSource: 'user_marked', reps: 8, loadKg: 50 }],
    heartRate: { status: 'available', source: 'apple_health', sourceKey: 'device-A', samples: [{ timestamp: '2026-09-05T10:00:20.000Z', bpm: 135 }], fetchedAt: '2026-09-05T11:01:00.000Z', truncated: false }
  };
}
function request(healthSession?: unknown) {
  return { userId: 'authenticated-user', activityData: { type: 'workout', muscleGroup: 'legs', duration: 60, intensity: 'moderate' as const, startTime: startedAt, endTime: endedAt, ...(healthSession !== undefined ? { healthSession } : {}) } };
}
function security(shouldScore = true, eligible = true) {
  (SecurityPipeline.runPipeline as jest.Mock).mockResolvedValue({ shouldScore, decision: shouldScore ? 'APPROVED' : 'UNDER_REVIEW', report: { validation: { competitivelyEligible: eligible, ineligibleReason: eligible ? undefined : 'Tempo mínimo não atingido.' }, explanation: {} } });
}

beforeEach(() => {
  jest.clearAllMocks(); championshipActive = false;
  jest.useFakeTimers().setSystemTime(new Date('2026-09-05T12:00:00Z'));
  for (const name of ['log', 'warn', 'error'] as const) jest.spyOn(console, name).mockImplementation(() => {});
  activities = { create: jest.fn(async (value) => ({ ...value, id: 'saved-activity', createdAt: endedAt })), findRecentByUser: jest.fn(async () => []) };
  users = { findById: jest.fn(async () => ({ id: 'authenticated-user', weightKg: 70 })), addXP: jest.fn(async () => ({ newXP: 500, newLevel: 2 })) };
  audit = { log: jest.fn(async () => undefined) }; notification = { send: jest.fn(async () => undefined) };
  (ActivityRepository as unknown as jest.Mock).mockImplementation(() => activities);
  (UserRepository as unknown as jest.Mock).mockImplementation(() => users);
  (db.collection as jest.Mock).mockImplementation(() => ({ doc: () => ({ get: async () => ({ data: () => ({ status: championshipActive ? 'active' : 'inactive' }) }) }), where: () => ({ get: async () => ({ docs: [] }) }) }));
  (recalculateAllUserScores as jest.Mock).mockResolvedValue({ weekly: { igaRanking: 73 }, monthly: { average: 65 }, season: { average: 60 } });
  (registrarAmostrasDeAtividade as jest.Mock).mockResolvedValue(undefined);
  (submitActivityToActiveChampionships as jest.Mock).mockResolvedValue(undefined);
  security();
  service = new ValidateActivityService(activities as any, users as any, audit as any, notification as any);
});
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

test.each(['approved', 'not-eligible', 'security-pending', 'geofence-pending'] as const)('preserva observações em persistência e resposta: %s', async (branch) => {
  if (branch === 'not-eligible') security(true, false);
  if (branch === 'security-pending') security(false);
  if (branch === 'geofence-pending') championshipActive = true;
  const result = await service.execute(request(health())) as any;
  const persisted = activities.create.mock.calls[0][0];
  expect(persisted.userId).toBe('authenticated-user');
  expect(persisted.healthSession).toMatchObject({ sessionId: 'session-authenticated', startedAt, endedAt, sets: [{ reps: 8, loadKg: 50 }], heartRate: { samples: [{ bpm: 135 }] } });
  expect(persisted.healthSession.ownerId).toBeUndefined();
  expect(persisted.healthSession.points).toBeUndefined();
  expect(result.healthSession).toEqual(persisted.healthSession);
  expect(result.workout.healthSession).toEqual(persisted.healthSession);
  expect(result.healthSessionStatus).toBe('available');
  expect(result.workout.healthSessionStatus).toBe('available');
  if (branch !== 'approved') expect(persisted.points).toBe(0);
  for (const [entry] of audit.log.mock.calls) expect(entry.details?.activityData?.healthSession).toBeUndefined();
});

test('adicionar saúde não modifica entrada do antifraude, XP, IGA, evidência ou competições', async () => {
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
  // #249 (preexistente, anterior a este pacote de saude): sem stakes ativos
  // (campeonato pago ou ranking da comunidade -- aqui championshipActive
  // fica false via beforeEach), a atividade e salva mas nunca pontua nem
  // recalcula IGA, ver competitivelyEligible/hasActiveScoringStakes em
  // validate-activity-service.ts. Isso vale igual pros dois lados (com e
  // sem healthSession) -- e exatamente o invariante que este teste verifica:
  // anexar dados de saude nao muda o resultado competitivo, nem mesmo pra
  // "nao chamar recalculo nenhum".
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
  await expect(service.execute(input)).rejects.toThrow('Duracao excessiva');
  expect(activities.create).not.toHaveBeenCalled();
  expect(audit.log.mock.calls[0][0].details.activityData.healthSession).toBeUndefined();
});
