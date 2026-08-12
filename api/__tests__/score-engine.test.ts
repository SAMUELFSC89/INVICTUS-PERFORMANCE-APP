import { describe, it, expect } from '@jest/globals';
import { BaseScoreCalculator } from '../_lib/score-engine/calculators/base-score-calculator.js';
import { MultiplierCalculator } from '../_lib/score-engine/calculators/multiplier-calculator.js';
import { ActivityValidator } from '../_lib/score-engine/validators/activity-validator.js';
import { QualityEngine } from '../_lib/score-engine/quality-engine.js';
import { TrainingGoal, SCORE_CONFIG } from '../_lib/score-config.js';

describe('Score Engine - Base Calculator & Quality Engine', () => {
  it('should calculate base fallback score correctly', () => {
    const score = BaseScoreCalculator.calculateBaseScore('run', 3600, 10); // 10km
    expect(score).toBe(100); // 10km * 10 points/km = 100
  });

  it('should calculate gym score correctly', () => {
    const score = BaseScoreCalculator.calculateBaseScore('gym', 3600); // 1 hour
    expect(score).toBe(60); // 1 hour * 60 points/hour = 60
  });

  it('should calculate difficulty bonus', () => {
    expect(BaseScoreCalculator.calculateDifficultyBonus('light')).toBe(0);
    expect(BaseScoreCalculator.calculateDifficultyBonus('moderate')).toBe(10);
    expect(BaseScoreCalculator.calculateDifficultyBonus('high')).toBe(25);
  });

  it('should calculate Quality Score using 5 criteria for HYPERTROPHY goal', () => {
    const activityData = {
      type: 'gym',
      duration: 60,
      hasExercises: true,
      hasPhoto: true,
      iaConfidence: 95,
      hasGps: true,
      isMockLocation: false
    };
    const userData = {
      trainingGoal: TrainingGoal.HYPERTROPHY,
      scoredDays: ['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04']
    };

    const qualityResult = BaseScoreCalculator.calculateQualityScore(activityData, userData);
    expect(qualityResult.score).toBeGreaterThan(0);
    expect(qualityResult.score).toBeLessThanOrEqual(100);
    expect(qualityResult.goal).toBe(TrainingGoal.HYPERTROPHY);
    expect(qualityResult.breakdown.subScores).toHaveProperty('consistency');
    expect(qualityResult.breakdown.subScores).toHaveProperty('intensity');
    expect(qualityResult.breakdown.subScores).toHaveProperty('efficiency');
    expect(qualityResult.breakdown.subScores).toHaveProperty('technicalQuality');
    expect(qualityResult.breakdown.subScores).toHaveProperty('dataIntegrity');
  });

  it('should adjust Quality Score weights based on TrainingGoal (WEIGHT_LOSS vs ENDURANCE)', () => {
    const activityData = {
      type: 'run',
      duration: 45,
      distance: 8,
      avgPace: 5.5,
      cadence: 175
    };
    const userWeightLoss = { trainingGoal: TrainingGoal.WEIGHT_LOSS, scoredDays: [] };
    const userEndurance = { trainingGoal: TrainingGoal.ENDURANCE, scoredDays: [] };

    const wlResult = QualityEngine.calculate(activityData, userWeightLoss);
    const endResult = QualityEngine.calculate(activityData, userEndurance);

    expect(wlResult.goal).toBe(TrainingGoal.WEIGHT_LOSS);
    expect(endResult.goal).toBe(TrainingGoal.ENDURANCE);
    expect(wlResult.goalWeightsUsed).not.toEqual(endResult.goalWeightsUsed);
  });
});

describe('Score Engine - Multipliers & Plan Caps', () => {
  it('should calculate streak multiplier according to Invictus rules (1-6d: 1.0, 7-13d: 1.2, 14+d: 1.5)', () => {
    expect(MultiplierCalculator.calculateStreakMultiplier(0)).toBe(1.0);
    expect(MultiplierCalculator.calculateStreakMultiplier(5)).toBe(1.0);
    expect(MultiplierCalculator.calculateStreakMultiplier(7)).toBe(SCORE_CONFIG.STREAK_X12); // 1.2
    expect(MultiplierCalculator.calculateStreakMultiplier(13)).toBe(SCORE_CONFIG.STREAK_X12); // 1.2
    expect(MultiplierCalculator.calculateStreakMultiplier(14)).toBe(SCORE_CONFIG.STREAK_X15); // 1.5
    expect(MultiplierCalculator.calculateStreakMultiplier(30)).toBe(SCORE_CONFIG.STREAK_X15); // 1.5
  });

  it('should calculate consistency multiplier (<=2d: 1.0, 3-5d: 1.05, 6-7d: 1.1, 8+d: 1.15)', () => {
    expect(MultiplierCalculator.calculateConsistencyMultiplier(2)).toBe(1.0);
    expect(MultiplierCalculator.calculateConsistencyMultiplier(5)).toBe(1.05);
    expect(MultiplierCalculator.calculateConsistencyMultiplier(7)).toBe(1.1);
    expect(MultiplierCalculator.calculateConsistencyMultiplier(8)).toBe(1.15);
  });

  it('should cap OPEN plan at 100 points', () => {
    const result = MultiplierCalculator.applyMultipliers(
      90,
      { streak: 1.5, consistency: 1.15 },
      SCORE_CONFIG.OPEN_MAX_POINTS // 100
    );
    expect(result.totalScore).toBe(100);
  });

  it('should cap PERFORMANCE plan at 100 points as well', () => {
    const result = MultiplierCalculator.applyMultipliers(
      90,
      { streak: 1.5, consistency: 1.1 },
      SCORE_CONFIG.PERFORMANCE_MAX_POINTS // 100
    );
    // 90 * 1.5 * 1.1 = 148.5 -> capped at PERFORMANCE_MAX_POINTS (100)
    expect(result.totalScore).toBe(100);
  });
});

describe('Score Engine - Validators', () => {
  it('should validate activity', () => {
    const activity = {
      type: 'run',
      distance: 10,
      duration: 3600,
      avgPace: 360,
      source: 'app',
      timestamp: new Date()
    };

    const result = ActivityValidator.validateForScoring(activity);
    expect(result.valid).toBe(true);
  });

  it('should reject short activity', () => {
    const activity = {
      type: 'run',
      distance: 1,
      duration: 30, // 30 segundos = muito curto
      avgPace: 120,
      source: 'app',
      timestamp: new Date()
    };

    const result = ActivityValidator.validateForScoring(activity);
    expect(result.valid).toBe(false);
  });
});

