/**
 * IGA (Índice Global de Atividade) - Core Types
 */

export interface IGASession {
  id?: string;
  type: 'workout' | 'cardio' | 'running' | 'recovery' | string;
  durationMinutes: number;
  avgHeartRate?: number;
  caloriesInformed?: number;
  isValid?: boolean;
  date?: string;
  hasExercises?: boolean;
}

export interface IGAUserProfile {
  userId?: string;
  age?: number;
  weightKg?: number;
  maxHeartRate?: number;
}

export interface FrequencyConfig {
  maxSessions: number;      // Default: 5
  targetFrequency: number;  // Default: 5
}

export interface TimeConfig {
  minWorkoutMinutes: number;  // Default: 30
  minCardioMinutes: number;   // Default: 20
  targetTimeMinutes: number;  // Default: 250 (e.g., 5 sessions x 50 min)
  /**
   * #239: teto de minutos CONTABILIZADOS por sessão (default 90).
   * A sessão pode ter durado mais -- o excedente simplesmente não conta.
   * Sem este teto, uma única sessão de 5 horas já levava Tn ao máximo
   * sozinha (targetTimeMinutes = 250), transformando duração inflada no
   * caminho mais barato para o topo do ranking.
   */
  maxCountedMinutesPerSession: number;
}

export interface IntensityConfig {
  targetRelativeHR: number;         // Default: 0.85 (85% FC Max)
  minRelativeHR: number;            // Default: 0.50 (50% FC Max)
  defaultWorkoutRelativeHR: number; // Default: 0.70 (Musculação sem monitor)
  defaultCardioRelativeHR: number;  // Default: 0.75 (Cardio sem monitor)
  defaultOtherRelativeHR: number;   // Default: 0.65
}

export interface CalorieGateConfig {
  minRatio: number;              // Default: 0.70
  maxRatio: number;              // Default: 1.40
  workoutMET: number;            // Default: 5.0
  cardioMET: number;             // Default: 8.0
  defaultMET: number;            // Default: 6.0
  suspiciousPenaltyGate: number; // Default: 0.80
}

export interface AgeHandicapConfig {
  enabled: boolean;        // Default: false (Desabilitado por configuração)
  baselineAge: number;     // Default: 30
  factorPerYear: number;   // Default: 0.005 (+0.5% por ano acima dos 30)
}

export interface IGASessionAudit {
  sessionId?: string;
  type: string;
  /** Minutos que realmente contaram para T (já limitados pelo teto por sessão). */
  durationMinutes: number;
  /** Duração informada pela sessão, antes do teto. Serve para auditoria. */
  durationRealMinutes?: number;
  eligible: boolean;
  ineligibleReason?: string;
  avgHeartRate: number;
  relativeHR: number;
  expectedCalories: number;
  informedCalories: number;
  calorieRatio: number;
  calorieGate: number;
  status: 'valid' | 'suspicious' | 'ineligible';
}

export interface IGACalculationResult {
  frequency: number;              // F (Máximo 5 sessões válidas)
  totalTimeMinutes: number;       // T (Soma de tempo das melhores até 5 sessões)
  avgHeartRate: number;           // FC Média ponderada
  maxHeartRate: number;           // FC Máxima estimada ou cadastrada do atleta
  avgRelativeHR: number;          // FC Relativa (FC Média / FC Máxima)
  Fn: number;                     // Frequência Normalizada [0.0 - 1.0]
  Tn: number;                     // Tempo Normalizado [0.0 - 1.0]
  In: number;                     // Intensidade Normalizada [0.0 - 1.0]
  igaBase: number;                // 100 * (Fn * Tn * In)^(1/3)
  expectedCaloriesTotal: number;
  informedCaloriesTotal: number;
  overallCalorieRatio: number;
  overallGate: number;            // Gate de calorias (1.00 se coerente, < 1.00 se suspeita)
  igaFinal: number;               // IGA Base * Gate
  ageHandicapMultiplier: number;  // Multiplicador de Idade (1.00 por padrão quando desabilitado)
  igaRanking: number;             // Pontuação Final de Ranking (IGA Final * Handicap)
  topSessions: IGASessionAudit[];
  auditSummary: string;
  calculatedAt: string;
}
