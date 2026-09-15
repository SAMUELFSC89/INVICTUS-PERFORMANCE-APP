import { RunningRepository } from '../../_repositories/running-repository.js';
import { AppError } from '../../_middleware/error.js';
import { isWithinInterval, startOfMonth, endOfMonth, startOfWeek, endOfWeek } from 'date-fns';
import NodeCache from 'node-cache';

const cache = new NodeCache({ stdTTL: 300 });

// O antigo addRun() e o ranking paralelo de corrida foram removidos. A
// classificação competitiva é exclusivamente o IGA da academia. Este serviço
// permanece somente para compatibilidade com estatísticas/histórico legado.
export class RunningService {
  constructor(private runningRepository: RunningRepository) {}

  async getUserStats(userId: string) {
    if (!userId) throw new AppError('userId é obrigatório.', 400);

    const cacheKey = `user_stats_${userId}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const stats = await this.runningRepository.getUserStats(userId);
    if (!stats) {
      const defaultStats = {
        userId,
        best_run_km_month: 0,
        best_run_km_week: 0,
        last_run_date: new Date().toISOString(),
        is_paid_running: false
      };
      cache.set(cacheKey, defaultStats, 600);
      return defaultStats;
    }

    const now = new Date();
    const lastRun = stats.last_run_date ? new Date(stats.last_run_date) : null;
    let best_run_km_month = stats.best_run_km_month || 0;
    let best_run_km_week = stats.best_run_km_week || 0;

    if (lastRun) {
      if (!isWithinInterval(lastRun, { start: startOfMonth(now), end: endOfMonth(now) })) {
        best_run_km_month = 0;
      }
      if (!isWithinInterval(lastRun, { start: startOfWeek(now, { weekStartsOn: 1 }), end: endOfWeek(now, { weekStartsOn: 1 }) })) {
        best_run_km_week = 0;
      }
    }

    const result = { ...stats, best_run_km_month, best_run_km_week };
    cache.set(cacheKey, result, 600);
    return result;
  }

  async getHistory(userId: string) {
    if (!userId) throw new AppError('userId é obrigatório.', 400);
    const history = await this.runningRepository.getRunHistory(userId, 10);
    return { history };
  }
}
