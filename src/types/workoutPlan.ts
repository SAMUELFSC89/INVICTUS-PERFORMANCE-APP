export type WorkoutPlanSource = 'manual' | 'ai' | 'imported';

export type MuscleGroup = 'peito' | 'costas' | 'pernas' | 'ombros' | 'bracos' | 'core';

export interface PlannedExercise {
  exerciseId: string;
  order: number;
  sets: number;
  repsMin: number;
  repsMax: number;
  restSeconds: number;
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
  daysPerWeek?: number;
  durationMinutes?: number;
  preferredPeriod?: string;
  energyLevel?: string;
  equipment?: string[];
  accessories?: string[];
  preferredTraining?: string;
  preferredSplit?: string;
  preferences?: string[];
  restrictions?: string[];
}

export interface WorkoutPlan {
  id: string;
  userId: string;
  name: string;
  description?: string;
  source: WorkoutPlanSource;
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
  source: WorkoutPlanSource;
  objective: string;
  experienceLevel?: string;
  durationMinutes: number;
  daysPerWeek: number;
  answers?: WorkoutPlanAnswers;
  workouts: PlannedWorkout[];
}
