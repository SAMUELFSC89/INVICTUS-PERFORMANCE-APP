export const OBJECTIVE_VERSIONS = {
  goal: 'GOAL_V1', readiness: 'CARDIO_READINESS_V1', mission: 'MISSION_V1',
  progression: 'CARDIO_PROGRESSION_V1', habit: 'HABIT_V1', weeklyReview: 'WEEKLY_REVIEW_V1',
  habitConfidence: 'HABIT_CONFIDENCE_V1', nextLevel: 'NEXT_LEVEL_V1', safety: 'SAFETY_V1',
} as const;

export const GOALS = {
  lose_weight: 'Perder peso', start_running: 'Começar a correr', sedentary: 'Sair do sedentarismo',
  post_workout: 'Criar rotina de cardio pós-treino', conditioning: 'Melhorar condicionamento',
  run_5k: 'Correr 5 km', run_10k: 'Correr 10 km', endurance: 'Melhorar resistência',
  pace: 'Melhorar ritmo de corrida', weekly_distance: 'Aumentar distância semanal',
  return_cardio: 'Voltar ao cardio depois de uma pausa', comfortable_walk: 'Caminhar sem cansar tanto',
  weekly_energy: 'Aumentar gasto energético semanal', rest_days: 'Cardio nos dias sem musculação',
  race: 'Preparar-se para uma corrida', gradual_return: 'Retorno gradual / pós-bariátrica',
  stress: 'Reduzir estresse através de atividade física', other: 'Outro objetivo',
} as const;
export type GoalType = keyof typeof GOALS;
export type Modality = 'walking' | 'running' | 'bike' | 'stationary_bike' | 'treadmill';
export type Barrier = 'time' | 'fatigue' | 'starting' | 'hunger' | 'sweets' | 'anxiety' | 'dislike_running' | 'pain' | 'restart' | 'unpredictable' | 'food' | 'other';
export type SafetySignal = 'chest_pain' | 'fainting' | 'dizziness' | 'unusual_breathlessness' | 'surgical_recovery' | 'pain';
export interface SafetyAnswers { screened: boolean; signals: SafetySignal[]; medicalClearance: boolean | null }
export type FoodFrequency = 'rarely' | 'weekly' | 'daily' | 'multiple_daily';
export const FOOD_LABELS = { soda: 'Refrigerante', alcohol: 'Bebida alcoólica', sweets: 'Doces', chocolate: 'Chocolate', fast_food: 'Fast food', delivery: 'Delivery', snacks: 'Salgadinhos', dessert: 'Sobremesas', large_meals: 'Refeições muito grandes', grazing: 'Beliscos', night_eating: 'Alimentação noturna' } as const;
export interface NutritionAnswers {
  meals: '2' | '3' | '4' | '5+' | 'variable';
  frequencies: Partial<Record<keyof typeof FOOD_LABELS, FoodFrequency>>;
  hardestTime: 'morning' | 'afternoon' | 'night' | 'late_night' | 'weekend';
}
export interface ObjectiveAnswers {
  goalType: GoalType; otherGoal?: string;
  walkingMinutes: 5 | 15 | 30 | 45;
  runningAbility: 'none' | 'seconds' | 'minutes' | 'regular' | 'structured';
  availableMinutes: 10 | 15 | 25 | 40 | 50;
  availableDays: number[]; timeZone: string;
  preferredMoment: 'post_workout' | 'pre_workout' | 'rest_days' | 'morning' | 'afternoon' | 'night' | 'any';
  preferredActivity: Modality; barrier: Barrier; confidenceScore: number;
  weightConfirmed?: boolean; currentWeightKg?: number; loseKg?: number;
  targetDistanceKm?: number; targetContinuousMinutes?: number;
  safety: SafetyAnswers; nutrition?: NutritionAnswers; productConsent: true;
}
export interface ProfileSnapshot {
  capturedAt: string; weightKg: number | null; heightCm: number | null; ageYears: number | null;
  strengthDays: number[]; source: 'users'; planId: string | null;
  recentCardioSessions: number | null; recentLongestRunKm: number | null;
  weightSource?: 'profile' | 'apple_health' | 'health_connect' | null;
  weightMeasuredAt?: string | null; weightSourceId?: string | null;
  historyStatus?: 'available' | 'unavailable'; historyWindowDays?: number;
}
export interface Baseline {
  id: string; capturedAt: string; profile: ProfileSnapshot; answers: ObjectiveAnswers;
  startingWeightKg: number | null; readinessLevel: number; versions: typeof OBJECTIVE_VERSIONS;
}
export interface Prescription {
  modality: Modality; targetMetric: 'duration' | 'distance'; durationMinutes: number; distanceKm: number | null;
  sessions: number; intensity: 'easy'; runSecondsPerInterval: number; walkSecondsPerInterval: number;
}
export type MissionState = 'locked' | 'available' | 'started' | 'completed' | 'skipped' | 'failed' | 'rescheduled';
export interface Mission {
  id: string; journeyId: string; week: number; goalType: GoalType; localDate: string;
  state: MissionState; prescription: Prescription; context: string; ruleVersion: string;
  createdAt: string; startedAt: string | null; completedAt: string | null;
  sessionId: string | null; activityId: string | null;
  rescheduledAt?: string | null; rescheduledFromMissionId?: string | null; rescheduledToMissionId?: string | null;
}
export interface HabitIntervention { id: string; target: keyof typeof FOOD_LABELS | 'routine'; text: string; createdAt: string; ruleVersion: string }
export interface WeightMeasurement { id: string; kg: number; measuredAt: string; recordedAt: string; source: 'confirmed_profile' | 'manual' | 'apple_health' | 'health_connect'; sourceId: string | null }
export interface WeeklyAnswers {
  difficulty: 'easy' | 'appropriate' | 'hard' | 'very_hard'; energy: 'poor' | 'fair' | 'good' | 'great';
  confidenceScore: number; hunger?: 'low' | 'normal' | 'high' | 'very_high';
  habitAdherence: 'yes' | 'partly' | 'no'; barrier: Barrier;
  safety: SafetyAnswers; weightKg?: number;
}
export interface Review {
  id: string; journeyId: string; week: number; createdAt: string; completed: number; planned: number;
  adherence: number; answers: WeeklyAnswers; before: Prescription; after: Prescription;
  decision: 'maintain' | 'progress' | 'regress' | 'pause'; reason: string;
  habitConfidence: number; plateau: 'insufficient' | 'none' | 'observe' | 'investigate' | 'persistent';
  versions: typeof OBJECTIVE_VERSIONS;
}
export interface CardioAchievement {
  id: string; journeyId: string; label: string; createdAt: string;
  evidence: Record<string, string | number | boolean | null>; version: string;
}
export interface Journey {
  id: string; userId: string; status: 'active' | 'paused' | 'completed' | 'cancelled';
  goalType: GoalType; goalLabel: string; outcome: { weightKg: number | null; distanceKm: number | null; continuousMinutes: number | null };
  behavior: Prescription; baselineId: string; createdAt: string; updatedAt: string;
  weekStartedAt: string; currentWeek: number; totalCompleted: number;
  habitConfidence: number; consolidated: boolean; availableDays: number[]; timeZone: string;
  habit: HabitIntervention; safety: SafetyAnswers; completedAt?: string | null; versions: typeof OBJECTIVE_VERSIONS;
}
export type ProfessionalKind = 'nutritionist' | 'personal_trainer' | 'running_coach' | 'physiotherapist';
export interface ProfessionalUnlock { journeyId: string; kind: ProfessionalKind; eligibleAt: string | null; status: 'COMING_SOON'; partnerId: null; canBook: false; canShare: false; reason: string; version: string }
export interface ProfessionalConsent { id: string; userId: string; journeyId: string; professionalId: string; fields: string[]; grantedAt: string; revokedAt: string | null; version: string; purpose: 'professional_followup' }
export interface ProfessionalFollowup { consentId: string; journeyId: string; professionalId: string; daysAfter: 30 | 60 | 90; observedAt: string; adherence: number | null; weightKg: number | null; outcomeIsCausal: false }
export interface ResearchConsent { userId: string; version: string; grantedAt: string | null; revokedAt: string | null; purpose: 'research' }
export interface BenchmarkProvider { version: string; lookup(cohort: { goalType: GoalType; readinessLevel: number }): Promise<{ sampleSize: number; observationalOnly: true } | null> }
export interface JourneyEvent { id: string; journeyId: string; type: string; occurredAt: string; version: string; entityId: string; details: Record<string, string | number | boolean | null> }
