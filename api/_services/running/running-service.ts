import { RunningRepository } from '../../_repositories/running-repository.js';
import { GetRankingResponse } from '../../_dto/running-dto.js';
import { AppError } from '../../_middleware/error.js';
import { isWithinInterval, startOfMonth, endOfMonth, startOfWeek, endOfWeek } from 'date-fns';
import NodeCache from 'node-cache';

const cache = new NodeCache({ stdTTL: 300 });

// #96: addRun() e o helper persistCardioToHistory() que ela usava foram
// removidos -- eram uma 5a formula de pontuacao paralela (XP proprio via
// RunningRepository.processRunTransaction, check-in de presenca proprio via
// RunningRepository.createPendingPresenceCheck, estado paralelo em
// `running_stats`), sem nenhum chamador vivo no app (RunTracker.tsx, o unico
// componente que a usava, nunca era importado/renderizado em lugar nenhum).
// Ver auditoria antifraude 2026-08 e api/_handlers/running.ts. getUserStats/
// getRanking/getHistory abaixo continuam servindo dados historicos legados
// dessas mesmas colecoes -- por isso ficam.

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

  async getRanking(period: 'month' | 'week', mode: 'official' | 'demo' = 'official', userId?: string): Promise<GetRankingResponse> {
    if (!period) throw new AppError('O parâmetro period (month/week) é obrigatório.', 400);

    const cacheKey = `ranking_${period}_${mode}`;
    const cachedData = cache.get<GetRankingResponse>(cacheKey);
    if (cachedData) return cachedData;

    const now = new Date();
    const start = period === 'month' ? startOfMonth(now) : startOfWeek(now, { weekStartsOn: 1 });

    const ranking = await this.runningRepository.getRanking(period, mode, start.toISOString());
    const totalPool = ranking.length * 19.90 * 0.5;

    const result = { ranking, totalPool };
    cache.set(cacheKey, result, 900);
    return result;
  }

  async getHistory(userId: string) {
    if (!userId) throw new AppError('userId é obrigatório.', 400);
    const history = await this.runningRepository.getRunHistory(userId, 10);
    return { history };
  }
}
