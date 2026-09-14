import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { RunningService } from '../_services/running/running-service.js';
import { RunningRepository } from '../_repositories/running-repository.js';

describe('RunningService', () => {
  let runningService: RunningService;
  let mockRunningRepo: jest.Mocked<RunningRepository>;

  beforeEach(() => {
    mockRunningRepo = {
      getUserStats: jest.fn().mockResolvedValue(null),
      getRunHistory: jest.fn().mockResolvedValue([])
    } as any;

    runningService = new RunningService(mockRunningRepo);
  });

  test('getUserStats should return default stats if user has no records', async () => {
    const stats = await runningService.getUserStats('user123');
    expect(stats.userId).toBe('user123');
    expect(stats.best_run_km_month).toBe(0);
  });

  test('getHistory should return user history list', async () => {
    const res = await runningService.getHistory('user123');
    expect(res.history).toBeDefined();
    expect(mockRunningRepo.getRunHistory).toHaveBeenCalledWith('user123', 10);
  });
});

describe('Contrato — ranking de corrida legado permanece desativado', () => {
  test('handler responde 410 e nenhuma camada conserva a fórmula paralela', () => {
    const handler = readFileSync(resolve(process.cwd(), 'api/_handlers/running.ts'), 'utf8');
    const service = readFileSync(resolve(process.cwd(), 'api/_services/running/running-service.ts'), 'utf8');
    const repository = readFileSync(resolve(process.cwd(), 'api/_repositories/running-repository.ts'), 'utf8');

    expect(handler).toContain("case 'ranking'");
    expect(handler).toContain("new AppError('Ranking de corrida legado desativado. Use o ranking IGA da academia.', 410)");
    expect(service).not.toContain('getRanking(');
    expect(service).not.toContain('totalPool');
    expect(service).not.toContain('19.90');
    expect(repository).not.toContain('getRanking(');
    expect(repository).not.toContain("where('is_paid_running'");
  });
});
