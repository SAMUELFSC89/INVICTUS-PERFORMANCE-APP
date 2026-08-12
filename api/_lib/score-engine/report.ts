import { db, FieldValue, sanitizeForFirestore } from '../common.js';
import { ActivitySource, ValidationStatus, ValidationReason, SCORE_CONFIG, TrainingGoal } from '../score-config.js';
import { RULE_VERSION, ENGINE_VERSION } from './events.js';
import { 
  QualityBreakdown, 
  MainImpacts, 
  EvaluationConfidence, 
  EvolutionIndexResult, 
  CoachExplanation, 
  AthleteDnaProfile, 
  PerformanceInsight 
} from './types.js';
import { MaxScoreSimulation } from './calculators/simulator.js';

export interface ScoreReport {
  id?: string;
  userId: string;
  activityId?: string;
  source: ActivitySource;
  plan: 'open' | 'performance';
  validation: {
    status: ValidationStatus;
    reason: ValidationReason;
    flags?: string[];
  };

  // V2.0 Core Separation
  trainingQualityScore: number;  // 0-100 pure quality
  competitiveScore: number;      // Final score with multipliers/limits used in leaderboard
  goal?: TrainingGoal;
  
  evaluationConfidence?: EvaluationConfidence;
  evolutionIndex?: EvolutionIndexResult;
  qualityBreakdown?: QualityBreakdown;
  mainImpacts?: MainImpacts;
  coachSummary?: CoachExplanation;
  dnaSnapshot?: AthleteDnaProfile;
  insights?: PerformanceInsight[];
  simulation?: MaxScoreSimulation;

  baseScore: number;
  bonuses: number;
  multipliers: number;
  penalties: number;
  capped: boolean;
  finalScore: number;
  rawScore?: number;
  xp: number;
  rankingPoints: number;
  reason: string;
  
  ruleVersion: string;
  engineVersion: string;
  configSnapshot: typeof SCORE_CONFIG;
  processingTimeMs: number;
  persistDurationMs: number;
  transactionId?: string;
  eventId?: string;
  createdAt?: string;
}

export class ScoreReportService {
  static async saveReport(reportData: Partial<ScoreReport>): Promise<ScoreReport> {
    console.log(`[SCORE ENGINE] [REPORT V2.0] [${reportData.userId}] Criando relatório em 'score_reports' e 'performance_history'`);

    const docRef = db.collection('score_reports').doc();
    const historyRef = db.collection('performance_history').doc();

    const fullReport: ScoreReport = {
      id: docRef.id,
      userId: reportData.userId || 'ANONYMOUS',
      activityId: reportData.activityId || 'N/A',
      source: reportData.source || ActivitySource.GYM,
      plan: reportData.plan || 'open',
      validation: reportData.validation || { status: ValidationStatus.VALID, reason: ValidationReason.SUCCESS, flags: [] },
      
      trainingQualityScore: reportData.trainingQualityScore ?? reportData.finalScore ?? 0,
      competitiveScore: reportData.competitiveScore ?? reportData.finalScore ?? 0,
      goal: reportData.goal || TrainingGoal.HYPERTROPHY,

      evaluationConfidence: reportData.evaluationConfidence,
      evolutionIndex: reportData.evolutionIndex,
      qualityBreakdown: reportData.qualityBreakdown,
      mainImpacts: reportData.mainImpacts,
      coachSummary: reportData.coachSummary,
      dnaSnapshot: reportData.dnaSnapshot,
      insights: reportData.insights || [],
      simulation: reportData.simulation,

      baseScore: reportData.baseScore || 0,
      bonuses: reportData.bonuses || 0,
      multipliers: reportData.multipliers || 1,
      penalties: reportData.penalties || 0,
      capped: reportData.capped || false,
      finalScore: reportData.competitiveScore ?? reportData.finalScore ?? 0,
      rawScore: reportData.rawScore || reportData.finalScore || 0,
      xp: reportData.competitiveScore ?? reportData.finalScore ?? 0,
      rankingPoints: reportData.competitiveScore ?? reportData.finalScore ?? 0,
      reason: reportData.reason || ValidationReason.SUCCESS,
      
      ruleVersion: RULE_VERSION,
      engineVersion: ENGINE_VERSION,
      configSnapshot: { ...SCORE_CONFIG },
      processingTimeMs: reportData.processingTimeMs || 0,
      persistDurationMs: reportData.persistDurationMs || 0,
      transactionId: reportData.transactionId || 'N/A',
      eventId: reportData.eventId || reportData.activityId || 'N/A',
      createdAt: reportData.createdAt || new Date().toISOString()
    };

    // Save to score_reports
    await docRef.set(sanitizeForFirestore({
      ...fullReport,
      createdAtServer: FieldValue.serverTimestamp()
    }));

    // Save dedicated performance_history record
    try {
      await historyRef.set(sanitizeForFirestore({
        id: historyRef.id,
        userId: fullReport.userId,
        activityId: fullReport.activityId,
        trainingQualityScore: fullReport.trainingQualityScore,
        competitiveScore: fullReport.competitiveScore,
        goal: fullReport.goal,
        evaluationConfidence: fullReport.evaluationConfidence,
        evolutionIndex: fullReport.evolutionIndex,
        qualityBreakdown: fullReport.qualityBreakdown,
        mainImpacts: fullReport.mainImpacts,
        coachSummary: fullReport.coachSummary,
        dnaSnapshot: fullReport.dnaSnapshot,
        insights: fullReport.insights,
        simulation: fullReport.simulation,
        version: `${ENGINE_VERSION}_${RULE_VERSION}`,
        timestamp: fullReport.createdAt,
        createdAtServer: FieldValue.serverTimestamp()
      }));
    } catch (err) {
      console.warn(`[PERFORMANCE HISTORY] Non-blocking warning saving performance history:`, err);
    }

    return fullReport;
  }
}

