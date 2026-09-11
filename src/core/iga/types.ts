/**
 * IGA (Índice Global de Atividade) - Core Types
 */

export interface IGAHeartRateSample {
  timestamp: string;
  bpm: number;
}

export interface IGASession {
  id?: string;
  type: 'workout' | 'cardio' | 'running' | 'recovery' | string;
  durationMinutes: number;
  avgHeartRate?: number;
  maxHeartRate?: number;
  /** Série de FC validada da sessão. Quando presente, é a fonte preferida para I. */
  heartRateSamples?: IGAHeartRateSample[];
  caloriesInformed?: number;
  isValid?: boolean;
  date?: string;
  hasExercises?: boolean;
}

export interface IGAUserProfile {
  userId?: string;
  age?: number;
  weightKg?: number;
  /** FC máxima medida/cadastrada e considerada confiável. */
  maxHeartRate?: number;
  /** FC máxima histórica validada, quando o produto passar a persistir esse dado. */
  observedMaxHeartRate?: number;
}

export interface FrequencyConfig {
  /** Máximo de sessões usadas no cálculo. 6 representa a faixa "6+". */
  maxSessions: number;
  /** Mantido por compatibilidade com configurações antigas; IGA 2.0 usa scoreBySessions. */
  targetFrequency: number;
  /** Pontuação relativa por quantidade de sessões: índice 0, 1, 2... */
  scoreBySessions: number[];
}

export interface TimeConfig {
  minWorkoutMinutes: number;  // Default: 30
  minCardioMinutes: number;   // Default: 20
  /** Mantido por compatibilidade; IGA 2.0 não usa uma meta semanal linear. */
  targetTimeMinutes: number;
  /** Teto de duração pontuável por sessão. */
  maxCountedMinutesPerSession: number;
  /** Curva de retorno decrescente do tempo; score 100 = fator 1.00. */
  scoreCurve: Array<{ minutes: number; score: number }>;
}

export interface IntensityConfig {
  /** Campos antigos preservados para compatibilidade/fallback de sessões sem série de FC. */
  targetRelativeHR: number;
  minRelativeHR: number;
  defaultWorkoutRelativeHR: number;
  defaultCardioRelativeHR: number;
  defaultOtherRelativeHR: number;
  /** Fronteiras Z1/Z2/Z3/Z4/Z5 como fração da FC máxima. */
  zoneBoundaries: [number, number, number, number];
  /** Scores das zonas. Z3=100; Z4 é o maior bônus; Z5 não supera Z4. */
  zoneScores: [number, number, number, number, number];
  /** Margem de interpolação em torno de cada fronteira, em bpm. */
  transitionBpm: number;
  /** Janela de suavização temporal aplicada à série antes das zonas. */
  smoothingWindowSeconds: number;
}

export interface CalorieGateConfig {
  minRatio: number;
  maxRatio: number;
  workoutMET: number;
  cardioMET: number;
  defaultMET: number;
  suspiciousPenaltyGate: number;
}

export interface AgeHandicapConfig {
  enabled: boolean;
  baselineAge: number;
  factorPerYear: number;
}

export interface IGASessionAudit {
  sessionId?: string;
  type: string;
  /** Minutos que realmente contaram para T, já limitados pelo teto por sessão. */
  durationMinutes: number;
  /** Duração informada pela sessão, antes do teto. */
  durationRealMinutes?: number;
  eligible: boolean;
  ineligibleReason?: string;
  avgHeartRate: number;
  relativeHR: number;
  /** Fator de tempo da sessão (ex.: 1.00 aos 60 min; 1.04 aos 90 min). */
  timeFactor?: number;
  /** Fator de intensidade da sessão. Z3=1.00; Z4 pode chegar a 1.15. */
  intensityFactor?: number;
  intensitySource?: 'samples' | 'average' | 'estimated';
  heartRateSampleCount?: number;
  expectedCalories: number;
  informedCalories: number;
  calorieRatio: number;
  /** Mantido apenas para auditoria de coerência; não altera o IGA 2.0. */
  calorieGate: number;
  status: 'valid' | 'suspicious' | 'ineligible';
}

export interface IGACalculationResult {
  formulaVersion: 'IGA-2.0';
  frequency: number;
  totalTimeMinutes: number;
  avgHeartRate: number;
  maxHeartRate: number;
  avgRelativeHR: number;
  /** Fator F em escala relativa: 1.00 = referência 100; pode passar de 1.00. */
  Fn: number;
  /** Fator T médio por sessão: 1.00 = 60 min; 1.04 = 90 min. */
  Tn: number;
  /** Fator I médio ponderado: 1.00 = Z3; Z4 satura em até 1.15. */
  In: number;
  /** ∛((Fn×100) × (Tn×100) × (In×100)). */
  igaBase: number;
  expectedCaloriesTotal: number;
  informedCaloriesTotal: number;
  overallCalorieRatio: number;
  /** IGA 2.0: sempre 1.00; calorias não alteram pontuação. */
  overallGate: number;
  igaFinal: number;
  ageHandicapMultiplier: number;
  igaRanking: number;
  topSessions: IGASessionAudit[];
  auditSummary: string;
  calculatedAt: string;
}
