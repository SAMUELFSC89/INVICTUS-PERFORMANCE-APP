export type WorkoutPlanSource = 'manual' | 'ai' | 'imported';
export type WorkoutPlanGenerationMode = 'gemini' | 'training_engine' | 'local_fallback';

export type MuscleGroup = 'peito' | 'costas' | 'pernas' | 'ombros' | 'bracos' | 'core';

export interface AthleteTrainingProfileSnapshot {
  age?: number;
  weightKg?: number;
  heightCm?: number;
  sex?: 'male' | 'female';
}

export interface PlannedExercise {
  exerciseId: string;
  order: number;
  sets: number;
  repsMin: number;
  repsMax: number;
  restSeconds: number;
  /** Repetições em reserva planejadas para a maior parte das séries de trabalho. */
  targetRir?: number;
  initialLoadKg?: number;
  notes?: string;
}

export interface PlannedWorkout {
  id: string;
  name: string;
  focus: string;
  weekdays: number[];
  exercises: PlannedExercise[];
}

export interface WorkoutPlanAnswers {
  primaryGoal?: string;
  secondaryGoals?: string[];
  experienceLevel?: string;
  experienceTime?: string;
  /** Número de sessões desejadas por semana. */
  daysPerWeek?: number;
  /** Dias reais escolhidos pelo atleta (0=domingo ... 6=sábado). */
  availableWeekdays?: number[];
  durationMinutes?: number;
  preferredPeriod?: string;
  energyLevel?: string;
  equipment?: string[];
  accessories?: string[];
  preferredTraining?: string;
  preferredSplit?: string;
  preferences?: string[];
  restrictions?: string[];
  /** Snapshot mínimo usado pelo motor; carga inicial nunca é inferida só por peso/idade. */
  athleteProfile?: AthleteTrainingProfileSnapshot;
}

export interface WorkoutPlan {
  id: string;
  userId: string;
  name: string;
  description?: string;
  /** #246: explicação curta do "porquê" desse plano -- por que essas
   * séries/reps/descanso e essa divisão de dias, dado o objetivo do atleta. */
  rationale?: string;
  source: WorkoutPlanSource;
  /** Indica quem produziu a prescrição final. */
  generationMode?: WorkoutPlanGenerationMode;
  /** Versões tornam uma prescrição reproduzível mesmo após futuras atualizações. */
  trainingEngineVersion?: string;
  evidenceVersion?: string;
  status: 'active' | 'archived';
  objective: string;
  experienceLevel?: string;
  durationMinutes: number;
  daysPerWeek: number;
  answers?: WorkoutPlanAnswers;
  workouts: PlannedWorkout[];
  createdAt: string;
  updatedAt: string;
}

export interface WorkoutPlanDraft {
  name: string;
  description?: string;
  rationale?: string;
  source: WorkoutPlanSource;
  generationMode?: WorkoutPlanGenerationMode;
  trainingEngineVersion?: string;
  evidenceVersion?: string;
  objective: string;
  experienceLevel?: string;
  durationMinutes: number;
  daysPerWeek: number;
  answers?: WorkoutPlanAnswers;
  workouts: PlannedWorkout[];
}
