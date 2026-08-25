import { RunningService } from '../_services/running/running-service.js';
import { RunningRepository } from '../_repositories/running-repository.js';

describe('RunningService', () => {
  let runningService: RunningService;
  let mockRunningRepo: jest.Mocked<RunningRepository>;

  beforeEach(() => {
    mockRunningRepo = {
      getUserStats: jest.fn().mockResolvedValue(null),
      setUserStats: jest.fn().mockResolvedValue(undefined),
      addRunSession: jest.fn().mockResolvedValue('session123'),
      getUserTrustScore: jest.fn().mockResolvedValue(100),
      createPendingPresenceCheck: jest.fn().mockResolvedValue({
        presenceCheckId: 'check123',
        expiredAt: '2026-12-31T23:59:59.000Z'
      }),
      processRunTransaction: jest.fn().mockResolvedValue({
        isScoringEligible: true,
        nonScoringReason: null,
        finalXpAwarded: 45
      }),
      getRanking: jest.fn().mockResolvedValue([
        { userId: 'u1', displayName: 'Atleta 1', km: 12.5 }
      ]),
      getRunHistory: jest.fn().mockResolvedValue([])
    } as any;

    runningService = new RunningService(mockRunningRepo);
  });

  test('getUserStats should return default stats if user has no records', async () => {
    const stats = await runningService.getUserStats('user123');
    expect(stats.userId).toBe('user123');
    expect(stats.best_run_km_month).toBe(0);
  });

  test('addRun should reject stationary/zero movement (< 0.1km)', async () => {
    const res = await runningService.addRun({
      userId: 'user123',
      km: 0
    });

    expect(res.success).toBe(false);
    expect(res.reasonCode).toBe('NO_MOVEMENT_DETECTED');
    expect(res.pointsEarned).toBe(0);
  });

  test('addRun should process transaction and award points when valid', async () => {
    const now = Date.now();
    const res = await runningService.addRun({
      userId: 'user123',
      km: 5.0,
      timeSeconds: 1800,
      steps: 5200,
      sensorTelemetry: { accelVariance: 1.5, gyroVariance: 0.9 },
      trajectory: [
        { latitude: -23.55052, longitude: -46.633308, timestamp: new Date(now - 1800000).toISOString() },
        { latitude: -23.56052, longitude: -46.643308, timestamp: new Date(now - 900000).toISOString() },
        { latitude: -23.57052, longitude: -46.653308, timestamp: new Date(now).toISOString() }
      ]
    });

    expect(res.success).toBe(true);
    expect(res.status).toBe('approved');
    expect(res.pointsEarned).toBe(45);
    expect(mockRunningRepo.processRunTransaction).toHaveBeenCalled();
  });

  test('getRanking should return cached or fetched ranking list', async () => {
    const res = await runningService.getRanking('month', 'official');
    expect(res.ranking).toBeDefined();
    expect(res.ranking.length).toBe(1);
    expect(res.ranking[0].displayName).toBe('Atleta 1');
  });

  test('getHistory should return user history list', async () => {
    const res = await runningService.getHistory('user123');
    expect(res.history).toBeDefined();
    expect(mockRunningRepo.getRunHistory).toHaveBeenCalledWith('user123', 10);
  });
});
