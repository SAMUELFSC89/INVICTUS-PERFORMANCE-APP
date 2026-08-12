import { ScoreEvent, ScoreCalculationResult, ActivityScore } from './types.js';
import { ActivityValidator } from './validators/activity-validator.js';
import { BaseScoreCalculator } from './calculators/base-score-calculator.js';
import { MultiplierCalculator } from './calculators/multiplier-calculator.js';
import { ScoreRepository } from './repositories/score-repository.js';
import { ScoreReporter } from './reporters/score-reporter.js';
import { scoreLogger } from '../logger.js';
import { SCORE_CONFIG, TrainingGoal } from '../score-config.js';
import { RULE_VERSION, ENGINE_VERSION } from './events.js';

export class ScoreEngine {
  /**
   * Processar evento de score (main entry point)
   * Passo 1: Quality Score (0-100 puros) baseado nos 5 critérios e meta de treino
   * Passo 2: Competitive Score = Aplicar bônus, multiplicadores e teto do plano (OPEN: 100, PERFORMANCE: 100)
   */
  static async process(event: ScoreEvent): Promise<ScoreCalculationResult> {
    const startTime = Date.now();
    const userId = event.userId;

    try {
      scoreLogger.info({ eventId: event.id, source: event.source }, 'Score processing started');

      // 1. Validar atividade
      const validationResult = ActivityValidator.validateForScoring(event.payload);
      if (!validationResult.valid) {
        throw new Error(`Validation failed: ${validationResult.errors.join(', ')}`);
      }

      // 2. Obter ou criar stats do usuário
      let userStats = await ScoreRepository.getUserStats(userId);
      if (!userStats) {
        userStats = {
          userId,
          totalScore: 0,
          currentStreak: 1,
          subscriptionTier: (event.payload?.subscriptionTier || event.payload?.plan || 'OPEN').toString().toUpperCase(),
          goal: (event.payload?.trainingGoal || event.payload?.goal || TrainingGoal.HYPERTROPHY),
          joinDate: new Date()
        } as any;
      }

      // 3. Validar usuário
      const accountAge = new Date().getTime() - new Date(userStats.joinDate || Date.now()).getTime();
      const userValidation = ActivityValidator.validateUser(userId, { accountAge });
      if (!userValidation.valid) {
        throw new Error(userValidation.reason || 'User validation failed');
      }

      // Montar objeto de usuário completo para os calculadores
      const userData = {
        userId,
        trainingGoal: userStats.goal || event.payload?.trainingGoal || TrainingGoal.HYPERTROPHY,
        subscriptionTier: userStats.subscriptionTier || event.payload?.subscriptionTier || event.payload?.plan || 'OPEN',
        scoredDays: (userStats as any)?.scoredDays || [],
        age: (userStats as any)?.age || event.payload?.age || 25,
        weight: (userStats as any)?.weight || event.payload?.weight || 70,
        currentStreak: userStats.currentStreak || 1
      };

      // Montar dados da atividade
      const activityType = event.payload?.type || event.source || 'run';
      const duration = event.payload?.duration || event.payload?.durationMins || 60;
      const distance = event.payload?.distance || 0;

      const activityData = {
        type: activityType,
        duration,
        distance,
        hasExercises: event.payload?.hasExercises || (event.payload?.exercises && event.payload?.exercises.length > 0),
        hasPhoto: event.payload?.hasPhoto || !!event.payload?.photoBase64,
        iaConfidence: event.payload?.iaConfidence,
        hasGps: event.payload?.hasGps,
        isMockLocation: event.payload?.isMockLocation,
        smartwatchData: event.payload?.smartwatchData,
        checkpoints: event.payload?.checkpoints,
        ...event.payload
      };

      // 4. PASSO 1: Quality Score (0-100 puros) baseado nos 5 critérios Invictus e objetivo do usuário
      const qualityResult = BaseScoreCalculator.calculateQualityScore(activityData, userData);
      const qualityScore = qualityResult.score;

      const bonusScore = BaseScoreCalculator.calculateDifficultyBonus(event.payload?.intensity || 'moderate');

      // 5. PASSO 2: Competitive Score - Determinar plano (OPEN vs PERFORMANCE) e multiplicadores
      const isPerformance = (userData.subscriptionTier || '').toString().toUpperCase() === 'PERFORMANCE' || (userData.subscriptionTier || '').toString().toUpperCase() === 'PRO';
      const maxPoints = isPerformance ? SCORE_CONFIG.PERFORMANCE_MAX_POINTS : SCORE_CONFIG.OPEN_MAX_POINTS;

      const streakMultiplier = MultiplierCalculator.calculateStreakMultiplier(userStats.currentStreak);
      const consistencyMultiplier = MultiplierCalculator.calculateConsistencyMultiplier(
        await this.getActivitiesLastWeek(userId)
      );
      const fraudMultiplier = event.fraudMultiplier !== undefined
        ? event.fraudMultiplier
        : MultiplierCalculator.calculateFraudMultiplier(event.payload?.fraudScore || 0);

      const { totalScore, appliedMultipliers } = MultiplierCalculator.applyMultipliers(
        qualityScore + bonusScore,
        {
          streak: streakMultiplier,
          consistency: consistencyMultiplier,
          fraud: fraudMultiplier
        },
        maxPoints
      );

      // 6. Salvar score
      const activityScore: ActivityScore = {
        eventId: event.id,
        userId,
        activityType,
        baseScore: qualityScore,
        bonusScore,
        totalScore,
        multipliers: appliedMultipliers,
        timestamp: event.timestamp || new Date()
      };

      await ScoreRepository.saveActivityScore(activityScore);

      // 7. Atualizar stats do usuário
      await ScoreRepository.updateUserStats(userId, totalScore);

      // 8. Gerar relatório
      const processingTimeMs = Date.now() - startTime;
      const report = ScoreReporter.generateReport(
        event.id,
        qualityScore,
        bonusScore,
        totalScore,
        appliedMultipliers,
        processingTimeMs
      );

      scoreLogger.info({
        eventId: event.id,
        userId,
        qualityScore,
        earned: totalScore,
        plan: isPerformance ? 'PERFORMANCE' : 'OPEN',
        maxPoints,
        processingTimeMs
      }, 'Score processing completed');

      return {
        earned: totalScore,
        report
      };

    } catch (error) {
      scoreLogger.error({
        eventId: event.id,
        userId,
        error: error instanceof Error ? error.message : 'Unknown error'
      }, 'Score processing failed');

      throw error;
    }
  }

  /**
   * Endpoint / API Consolidada do Dashboard de Performance
   */
  static async getPerformanceDashboard(userId: string): Promise<any> {
    const userStats = await ScoreRepository.getUserStats(userId);
    const history = await ScoreRepository.getUserScoreHistory(userId, 20);

    return {
      userId,
      userStats,
      lastWorkout: history[0] || null,
      history
    };
  }

  /**
   * Helper: obter atividades da última semana
   */
  private static async getActivitiesLastWeek(userId: string): Promise<number> {
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const history = await ScoreRepository.getUserScoreHistory(userId, 1000);
    return history.filter(score => new Date(score.timestamp) > oneWeekAgo).length;
  }

  // Wrappers retrocompatíveis
  static async processStrava(userId: string, stravaActivity: any): Promise<number> {
    const rawDate = stravaActivity?.start_date || stravaActivity?.start_date_local || stravaActivity?.created_at || stravaActivity?.timestamp || stravaActivity?.date;
    const actTimestamp = rawDate ? new Date(rawDate) : new Date();
    const rawDurationSeconds = stravaActivity?.moving_time || stravaActivity?.elapsed_time || stravaActivity?.duration || 0;
    const durationSeconds = rawDurationSeconds > 0 ? Math.max(rawDurationSeconds, 60) : 60;
    const rawDistance = stravaActivity?.distance || 0;
    const distanceKm = rawDistance > 100 ? rawDistance / 1000 : rawDistance;

    const payload = {
      ...stravaActivity,
      id: stravaActivity?.id?.toString() || `${Date.now()}`,
      type: (stravaActivity?.type || stravaActivity?.sport_type || 'run').toLowerCase(),
      timestamp: actTimestamp,
      duration: durationSeconds,
      durationMins: durationSeconds / 60,
      distance: distanceKm
    };

    const result = await this.process({
      id: payload.id,
      userId,
      source: 'strava',
      timestamp: actTimestamp,
      payload
    });
    return result.earned;
  }

  static async processCheckin(userId: string, checkinData: any): Promise<number> {
    const actTimestamp = checkinData.timestamp ? new Date(checkinData.timestamp) : new Date();
    const result = await this.process({
      id: checkinData.checkInId || checkinData.id || `${Date.now()}`,
      userId,
      source: 'checkin',
      timestamp: actTimestamp,
      payload: {
        id: checkinData.checkInId || checkinData.id,
        type: 'checkin',
        hasPhoto: !!checkinData.hasPhoto,
        gymId: checkinData.gymId,
        timestamp: actTimestamp
      }
    });
    return result.earned;
  }

  static async processMeal(userId: string, mealData: any): Promise<number> {
    const actTimestamp = mealData.timestamp ? new Date(mealData.timestamp) : new Date();
    const result = await this.process({
      id: mealData.id || `${Date.now()}`,
      userId,
      source: 'diet',
      timestamp: actTimestamp,
      payload: {
        id: mealData.id,
        type: 'diet',
        timestamp: actTimestamp
      }
    });
    return result.earned;
  }

  static async processRecovery(userId: string, recoveryData: any): Promise<number> {
    const actTimestamp = recoveryData.timestamp ? new Date(recoveryData.timestamp) : new Date();
    const result = await this.process({
      id: recoveryData.id || `${Date.now()}`,
      userId,
      source: 'recovery',
      timestamp: actTimestamp,
      payload: {
        id: recoveryData.id,
        type: 'recovery',
        timestamp: actTimestamp
      }
    });
    return result.earned;
  }

  static async processActivity(userId: string, activityData: any): Promise<ScoreCalculationResult> {
    const actTimestamp = activityData.timestamp ? new Date(activityData.timestamp) : new Date();
    return this.process({
      id: activityData.id || activityData.stravaActivityId || `${Date.now()}`,
      userId,
      source: activityData.source || 'gym',
      timestamp: actTimestamp,
      payload: {
        ...activityData,
        type: activityData.type || activityData.source || 'gym',
        timestamp: actTimestamp
      }
    });
  }
}

export {
  ActivityValidator,
  BaseScoreCalculator,
  MultiplierCalculator,
  ScoreRepository,
  ScoreReporter,
  RULE_VERSION,
  ENGINE_VERSION
};

export type { ScoreEvent, ActivityScore, ScoreCalculationResult };
