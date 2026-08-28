import { RunningService } from '../_services/running/running-service.js';
import { RunningRepository } from '../_repositories/running-repository.js';

describe('RunningService', () => {
  let runningService: RunningService;
  let mockRunningRepo: jest.Mocked<RunningRepository>;

  beforeEach(() => {
    jest.spyOn(Math, 'random').mockReturnValue(0.99);
    mockRunningRepo = {
      getUserStats: jest.fn().mockResolvedValue(null),
      getRanking: jest.fn().mockResolvedValue([
        { userId: 'u1', displayName: 'Atleta 1', km: 12.5 }
      ]),
      getRunHistory: jest.fn().mockResolvedValue([])
    } as any;

    runningService = new RunningService(mockRunningRepo);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('getUserStats should return default stats if user has no records', async () => {
    const stats = await runningService.getUserStats('user123');
    expect(stats.userId).toBe('user123');
    expect(stats.best_run_km_month).toBe(0);
  });

  // #96: os dois testes de addRun() foram removidos junto com o metodo --
  // era a 5a formula de pontuacao paralela, sem chamador vivo no app. Ver
  // running-service.ts e running-repository.ts.

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
