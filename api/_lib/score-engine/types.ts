import { TrainingGoal } from '../score-config.js';

export interface ScoreEvent {
  userId: string;
  id: string;
  source: 'app' | 'strava' | 'manual' | 'wearable' | string;
  timestamp?: Date;
  createdAt?: string;
  payload: any;
  fraudMultiplier?: number;
}

export interface ActivityScore {
  eventId: string;
  userId: string;
  activityType: string;
  baseScore: number;
  bonusScore: number;
  totalScore: number;
  multipliers: {
    fraud?: number;
    streak?: number;
    difficulty?: number;
    consistency?: number;
  };
  timestamp: Date;
}

export interface UserStats {
  userId: string;
  totalScore: number;
  level: number;
  totalActivities: number;
  currentStreak: number;
  bestStreak: number;
  lastActivityDate: Date;
  joinDate: Date;
  goal?: string;
  subscriptionTier?: string;
  plan?: string;
  scoredDays?: string[];
  age?: number;
  weight?: number;
isBanned?: boolean;
isBlocked?: boolean;
}

export interface ScoreCalculationResult {
  earned: number;
  report: {
    activityId: string;
    baseScore: number;
    bonusScore: number;
    totalEarned: number;
    finalScore?: number;
    multipliers: Record<string, number>;
    processingTimeMs: number;
    timestamp: Date;
  };
}

export interface ScoreGainItem {
  category: string;
  label: string;
  points: number;
}

export interface ScoreLossItem {
  category: string;
  label: string;
  pointsLost: number;
  reason: string;
  fixSuggestion: string;
}

export interface QualityBreakdown {
  gains: ScoreGainItem[];
  losses: ScoreLossItem[];
  subScores: {
    consistency: number;
    intensity: number;
    efficiency: number;
    technicalQuality: number;
    dataIntegrity: number;
    paceScore?: number;
    cadenceScore?: number;
    activeTimeScore?: number;
  };
}

export interface MainImpacts {
  highestPositive: {
    title: string;
    description: string;
    category: string;
    impactPoints: number;
  };
  highestNegative: {
    title: string;
    description: string;
    category: string;
    lossPoints: number;
  };
}

export interface EvaluationConfidence {
  scorePct: number; // 0-100%
  level: 'HIGH' | 'MEDIUM' | 'LOW';
  availableSources: string[];
  missingSources: string[];
  explanationText: string;
}

export interface HistoricalComparison {
  last7DaysAvg: number;
  last30DaysAvg: number;
  last90DaysAvg: number;
  lastYearAvg: number;
  diff30DaysPct: number; // e.g. +8%
  isPersonalRecord: boolean;
  indicatorText: string;
}

export interface MetricEvolution {
  consistencyChangePct: number;
  intensityChangePct: number;
  efficiencyChangePct: number;
  recoveryChangePct: number;
}

export interface EvolutionIndexResult {
  indexPct: number; // e.g. +18%
  comparison: HistoricalComparison;
  metricEvolution: MetricEvolution;
}

export interface CoachExplanation {
  headline: string;
  detailedSummary: string;
  mainDragFactorText: string;
  nextStepsAdvice: string;
}

export interface AthleteDnaProfile {
  userId: string;
  totalWorkoutsAnalyzed: number;
  bestWorkoutTimeWindow: 'MORNING' | 'AFTERNOON' | 'EVENING' | 'NIGHT';
  bestWorkoutTimeLabel: string;
  avgIntensityPct: number;
  avgActiveTimeMins: number;
  avgIdleTimeMins: number;
  avgRecoveryHours: number;
  bestDaysOfWeek: string[];
  hrZoneEvolutionTrend: 'IMPROVING' | 'STABLE' | 'DECLINING';
  avgEfficiencyPct: number;
  lastUpdated: string;
}

export interface PerformanceInsight {
  id: string;
  type: 'POSITIVE' | 'WARNING' | 'TIP';
  title: string;
  description: string;
  basedOnData: string;
}

export interface TrainingQualityScoreResult {
  score: number; // 0-100 pure quality
  goal: TrainingGoal;
  goalWeightsUsed: Record<string, number>;
  breakdown: QualityBreakdown;
  mainImpacts: MainImpacts;
}

export interface CompetitiveScoreResult {
  finalScore: number;
  capped: boolean;
  baseQualityScore: number;
  streakMultiplier: number;
  activeBoost: number;
  flatBonuses: number;
  penalties: number;
  plan: 'open' | 'performance';
  appliedMultipliers: Array<{ label: string; value: number }>;
}

export interface PerformanceDashboardData {
  userId: string;
  lastWorkout: {
    activityId: string;
    timestamp: string;
    trainingQualityScore: number;
    competitiveScore: number;
    evaluationConfidence: number;
    goal: TrainingGoal;
  };
  overallEvolutionIndex: number;
  historicalAverages: HistoricalComparison;
  metricEvolution: MetricEvolution;
  athleteDna: AthleteDnaProfile;
  insights: PerformanceInsight[];
  recentHistory: Array<{
    id: string;
    createdAt: string;
    trainingQualityScore: number;
    competitiveScore: number;
    confidence: number;
    source: string;
  }>;
}
