import type { MuscleGroup } from '../../types/workoutPlan';

export type TrainingGoal = 'massa' | 'forca' | 'gordura' | 'condicionamento' | 'definicao' | 'retorno' | 'saude';
export type EvidenceConfidence = 'high' | 'moderate' | 'limited';

export interface TrainingEvidenceSource {
  id: string;
  title: string;
  year: number;
  pmid: string;
  doi: string;
  confidence: EvidenceConfidence;
}

export interface GoalPrescriptionRule {
  goal: TrainingGoal;
  repsMin: number;
  repsMax: number;
  restSeconds: number;
  targetRir: number;
  weeklyDirectSets: { beginner: number; intermediate: number; advanced: number };
  preferredFrequencyPerMuscle: { min: number; max: number };
  notes: string[];
  evidenceSourceIds: string[];
}

/**
 * Training Engine evidence snapshot.
 *
 * This is deliberately data, not prose embedded in prompts. Updating a rule
 * requires changing this version and its cited evidence so plans remain
 * reproducible. Sources are PubMed-indexed reviews/meta-analyses; the engine
 * does not browse the internet at generation time.
 */
export const TRAINING_EVIDENCE_VERSION = '2026.09.06-v1';
export const TRAINING_ENGINE_VERSION = '2.0.0';

export const TRAINING_EVIDENCE_SOURCES: readonly TrainingEvidenceSource[] = [
  {
    id: 'ACSM_2026_POSITION_STAND',
    title: 'ACSM Position Stand: Resistance Training Prescription for Muscle Function, Hypertrophy, and Physical Performance in Healthy Adults',
    year: 2026,
    pmid: '41843416',
    doi: '10.1249/MSS.0000000000003897',
    confidence: 'high'
  },
  {
    id: 'PELLAND_2026_DOSE_RESPONSE',
    title: 'The Resistance Training Dose Response: Weekly Volume and Frequency Meta-Regressions',
    year: 2026,
    pmid: '41343037',
    doi: '10.1007/s40279-025-02344-w',
    confidence: 'high'
  },
  {
    id: 'ROBINSON_2024_RIR',
    title: 'Resistance Training Proximity to Failure, Strength Gain, and Muscle Hypertrophy: Meta-Regressions',
    year: 2024,
    pmid: '38970765',
    doi: '10.1007/s40279-024-02069-2',
    confidence: 'moderate'
  },
  {
    id: 'SINGER_2024_REST',
    title: 'Inter-set Rest Interval Duration and Muscle Hypertrophy: Systematic Review with Bayesian Meta-analysis',
    year: 2024,
    pmid: '39205815',
    doi: '10.3389/fspor.2024.1429789',
    confidence: 'moderate'
  }
] as const;

const hypertrophyEvidence = ['ACSM_2026_POSITION_STAND', 'PELLAND_2026_DOSE_RESPONSE', 'ROBINSON_2024_RIR', 'SINGER_2024_REST'];
const generalEvidence = ['ACSM_2026_POSITION_STAND', 'PELLAND_2026_DOSE_RESPONSE'];

/**
 * Starting prescriptions, not universal physiological limits. The progression
 * engine is expected to move volume from these starting targets using the
 * athlete's execution history and tolerance.
 */
export const GOAL_PRESCRIPTION_RULES: Record<TrainingGoal, GoalPrescriptionRule> = {
  massa: {
    goal: 'massa', repsMin: 6, repsMax: 12, restSeconds: 90, targetRir: 2,
    weeklyDirectSets: { beginner: 8, intermediate: 10, advanced: 12 },
    preferredFrequencyPerMuscle: { min: 2, max: 3 },
    notes: ['Start below maximal tolerable volume and progress from execution history.', 'Momentary failure is not required on every set.'],
    evidenceSourceIds: hypertrophyEvidence
  },
  definicao: {
    goal: 'definicao', repsMin: 6, repsMax: 12, restSeconds: 90, targetRir: 2,
    weeklyDirectSets: { beginner: 8, intermediate: 10, advanced: 12 },
    preferredFrequencyPerMuscle: { min: 2, max: 3 },
    notes: ['Resistance-training stimulus is preserved; fat loss is not created by an artificially high repetition range.'],
    evidenceSourceIds: hypertrophyEvidence
  },
  forca: {
    goal: 'forca', repsMin: 3, repsMax: 6, restSeconds: 180, targetRir: 3,
    weeklyDirectSets: { beginner: 6, intermediate: 8, advanced: 10 },
    preferredFrequencyPerMuscle: { min: 2, max: 4 },
    notes: ['Heavier loading is prioritized for voluntary strength.', 'Longer rest protects performance across work sets.'],
    evidenceSourceIds: generalEvidence
  },
  gordura: {
    goal: 'gordura', repsMin: 6, repsMax: 12, restSeconds: 90, targetRir: 2,
    weeklyDirectSets: { beginner: 7, intermediate: 9, advanced: 10 },
    preferredFrequencyPerMuscle: { min: 2, max: 3 },
    notes: ['The resistance prescription preserves strength and lean-mass stimulus; energy balance is handled outside this engine.'],
    evidenceSourceIds: generalEvidence
  },
  condicionamento: {
    goal: 'condicionamento', repsMin: 8, repsMax: 15, restSeconds: 75, targetRir: 3,
    weeklyDirectSets: { beginner: 6, intermediate: 8, advanced: 9 },
    preferredFrequencyPerMuscle: { min: 2, max: 3 },
    notes: ['Moderate repetition ranges and controlled rest are used without sacrificing movement quality.'],
    evidenceSourceIds: generalEvidence
  },
  retorno: {
    goal: 'retorno', repsMin: 8, repsMax: 12, restSeconds: 105, targetRir: 4,
    weeklyDirectSets: { beginner: 5, intermediate: 6, advanced: 7 },
    preferredFrequencyPerMuscle: { min: 2, max: 3 },
    notes: ['Initial volume is intentionally conservative and should rise from successful completed sessions.'],
    evidenceSourceIds: generalEvidence
  },
  saude: {
    goal: 'saude', repsMin: 8, repsMax: 12, restSeconds: 90, targetRir: 3,
    weeklyDirectSets: { beginner: 6, intermediate: 7, advanced: 8 },
    preferredFrequencyPerMuscle: { min: 2, max: 3 },
    notes: ['Consistency and broad movement coverage are prioritized over aggressive specialization.'],
    evidenceSourceIds: generalEvidence
  }
};

export const CORE_MUSCLE_GROUPS: readonly MuscleGroup[] = ['peito', 'costas', 'pernas', 'ombros', 'bracos', 'core'];

export function normalizeTrainingGoal(value?: string): TrainingGoal {
  return value && value in GOAL_PRESCRIPTION_RULES ? value as TrainingGoal : 'massa';
}
