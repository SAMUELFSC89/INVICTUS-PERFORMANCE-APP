import { RunningRepository } from '../../_repositories/running-repository.js';
import { AddRunRequest, AddRunResponse, GetRankingResponse } from '../../_dto/running-dto.js';
import { AppError } from '../../_middleware/error.js';
import { isWithinInterval, startOfMonth, endOfMonth, startOfWeek, endOfWeek } from 'date-fns';
import NodeCache from 'node-cache';

const cache = new NodeCache({ stdTTL: 300 });

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

  async addRun(payload: AddRunRequest): Promise<AddRunResponse> {
    const { userId, km, timeSeconds, pace, calories, elevationGain, steps, trajectory, date, session } = payload;
    if (!userId) throw new AppError('userId é obrigatório.', 400);
    if (km === undefined || km === null) throw new AppError('km é obrigatório.', 400);

    const currentKm = parseFloat(String(km)) || 0;
    const now = new Date();
    const nowIso = now.toISOString();

    const lastRunStats = {
      km: currentKm,
      timeSeconds: timeSeconds || 0,
      pace: pace || "0'00\"/km",
      calories: calories || 0,
      elevationGain: elevationGain || 0,
      steps: steps || 0,
      trajectory: trajectory || [],
      date: date || nowIso
    };

    // Zero-movement / Stationary anti-cheat check
    if (currentKm < 0.1) {
      const zeroMovementMsg = "🚨 ATIVIDADE RECUSADA PELA AUDITORIA ANTIFRAUDE: Nenhum deslocamento ou movimento válido foi detectado no GPS (0.00 km).";
      return {
        userId,
        last_run_stats: lastRunStats,
        isScoringEligible: false,
        nonScoringReason: "NO_MOVEMENT_DETECTED",
        pointsEarned: 0,
        pointsAwarded: 0,
        success: false,
        status: "not_validated",
        reasonCode: "NO_MOVEMENT_DETECTED",
        userMessage: zeroMovementMsg,
        message: zeroMovementMsg,
        canRetry: false
      };
    }

    // Load existing stats
    const existingStats = await this.getUserStats(userId);
    let currentMonthBest = existingStats.best_run_km_month || 0;
    let currentWeekBest = existingStats.best_run_km_week || 0;

    if (currentKm >= 0.1 && currentKm > currentMonthBest) currentMonthBest = currentKm;
    if (currentKm >= 0.1 && currentKm > currentWeekBest) currentWeekBest = currentKm;

    const updatedData = {
      ...existingStats,
      best_run_km_month: currentMonthBest,
      best_run_km_week: currentWeekBest,
      last_run_date: nowIso,
      last_run_stats: lastRunStats
    };

    let sessionId: string | null = null;
    if (session) {
      sessionId = await this.runningRepository.addRunSession({
        ...session,
        userId
      });
    }

    await this.runningRepository.setUserStats(userId, updatedData);

    // Calculate presence risk score
    const trustScore = await this.runningRepository.getUserTrustScore(userId);
    let riskAcc = 10;
    if (payload.isEmulator || payload.isDeveloperMode) riskAcc += 25;
    if (payload.isMockLocation || payload.isRooted) riskAcc += 45;
    if (payload.sensorStatus === 'unavailable' || payload.hasSensorOscillation === false) riskAcc += 15;

    const calculatedSpeedKmh = currentKm / ((timeSeconds || 3600) / 3600);
    if (calculatedSpeedKmh > 22.0) riskAcc += 35;
    else if (calculatedSpeedKmh > 16.0) riskAcc += 15;

    const presenceRiskScore = Math.min(100, Math.max(0, riskAcc));

    let presenceCheckRequired = false;
    if (presenceRiskScore >= 75) {
      presenceCheckRequired = true;
    } else {
      let triggerProbability = trustScore >= 90 ? 0.05 : trustScore < 70 ? 0.30 : 0.10;
      if (presenceRiskScore >= 40) triggerProbability = Math.max(triggerProbability, 0.40);
      presenceCheckRequired = Math.random() < triggerProbability;
    }

    if (presenceCheckRequired) {
      const GESTURES = [
        "pisque os olhos repetidamente",
        "dê um sorriso natural para a câmera",
        "vire a cabeça levemente para a esquerda",
        "vire a cabeça levemente para a direita"
      ];
      const livenessPrompt = GESTURES[Math.floor(Math.random() * GESTURES.length)];

      const presenceCheck = await this.runningRepository.createPendingPresenceCheck({
        userId,
        presenceRiskScore,
        livenessPrompt,
        workoutPayload: payload
      });

      return {
        success: true,
        status: "presence_check_required",
        presenceCheckRequired: true,
        presenceCheckId: presenceCheck.presenceCheckId,
        livenessPrompt,
        userMessage: "Para finalizar sua corrida e computar seus pontos, conclua a confirmação rápida de presença."
      };
    }

    // Process Transaction: Add XP & Weekly Limit check
    const getWeekNumber = (d: Date) => {
      const dateCopy = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
      const dayNum = dateCopy.getUTCDay() || 7;
      dateCopy.setUTCDate(dateCopy.getUTCDate() + 4 - dayNum);
      const yearStart = new Date(Date.UTC(dateCopy.getUTCFullYear(), 0, 1));
      return Math.ceil((((dateCopy.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
    };

    const weekId = `${now.getFullYear()}-W${getWeekNumber(now)}`;
    const todayISO = nowIso.split('T')[0];

    const txResult = await this.runningRepository.processRunTransaction(
      userId,
      currentKm,
      weekId,
      todayISO,
      nowIso
    );

    cache.flushAll();

    const isWeeklyLimit = !txResult.isScoringEligible && txResult.nonScoringReason === "WEEKLY_SCORING_LIMIT_REACHED";
    const userMsg = isWeeklyLimit
      ? "Treino registrado com sucesso, mas você já atingiu seus 5 dias pontuáveis da semana."
      : "Corrida validada com sucesso! Seus pontos foram adicionados.";

    return {
      ...updatedData,
      sessionId,
      isScoringEligible: txResult.isScoringEligible,
      nonScoringReason: txResult.nonScoringReason,
      pointsEarned: txResult.finalXpAwarded,
      pointsAwarded: txResult.finalXpAwarded,
      success: !isWeeklyLimit,
      status: isWeeklyLimit ? "not_validated" : "approved",
      reasonCode: isWeeklyLimit ? "WEEKLY_LIMIT_REACHED" : null,
      userMessage: userMsg,
      message: userMsg,
      canRetry: false
    };
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
