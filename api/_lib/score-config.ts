export enum ActivitySource {
  GYM = 'GYM',
  RUN = 'RUN',
  STRAVA = 'STRAVA',
  DIET = 'DIET',
  RECOVERY = 'RECOVERY',
  CHECKIN = 'CHECKIN',
  PHOTO = 'PHOTO',
  AI = 'AI',
  HEALTH_CONNECT = 'HEALTH_CONNECT',
  APPLE_HEALTH = 'APPLE_HEALTH'
}

export enum TrainingGoal {
  HYPERTROPHY = 'HYPERTROPHY',
  WEIGHT_LOSS = 'WEIGHT_LOSS',
  ENDURANCE = 'ENDURANCE',
  GENERAL_HEALTH = 'GENERAL_HEALTH'
}

export enum ValidationStatus {
  VALID = 'VALID',
  PARTIAL = 'PARTIAL',
  UNDER_REVIEW = 'UNDER_REVIEW',
  INVALID = 'INVALID',
  NOT_ELIGIBLE = 'NOT_ELIGIBLE'
}

export enum ValidationReason {
  GPS_FAIL = 'GPS_FAIL',
  MOCK_LOCATION = 'MOCK_LOCATION',
  NO_HEART_RATE = 'NO_HEART_RATE',
  DUPLICATE_ACTIVITY = 'DUPLICATE_ACTIVITY',
  WEEKLY_LIMIT = 'WEEKLY_LIMIT',
  DAILY_LIMIT = 'DAILY_LIMIT',
  PLAN_LIMIT = 'PLAN_LIMIT',
  SUCCESS = 'SUCCESS',
  IMPOSSIBLE_SPEED = 'IMPOSSIBLE_SPEED',
  MANUAL_ENTRY = 'MANUAL_ENTRY'
}

export const GOAL_WEIGHTS = {
  [TrainingGoal.HYPERTROPHY]: {
    consistency: 0.30,       // 30%
    intensity: 0.30,         // 30%
    efficiency: 0.20,        // 20%
    technicalQuality: 0.15,  // 15%
    dataIntegrity: 0.05      // 5%
  },
  [TrainingGoal.WEIGHT_LOSS]: {
    consistency: 0.25,       // 25%
    activeTime: 0.25,        // 25%
    hrIntensity: 0.30,       // 30%
    caloriesPerKg: 0.15,     // 15%
    dataIntegrity: 0.05      // 5%
  },
  [TrainingGoal.ENDURANCE]: {
    consistency: 0.20,       // 20%
    pace: 0.25,              // 25%
    cadence: 0.20,           // 20%
    heartRate: 0.20,         // 20%
    recovery: 0.10,          // 10%
    dataIntegrity: 0.05      // 5%
  },
  [TrainingGoal.GENERAL_HEALTH]: {
    consistency: 0.20,       // 20%
    intensity: 0.20,         // 20%
    efficiency: 0.20,        // 20%
    technicalQuality: 0.20,  // 20%
    dataIntegrity: 0.20      // 20%
  }
};

export const SCORE_CONFIG = {
  OPEN_MAX_POINTS: 100,
  PERFORMANCE_MAX_POINTS: 100,
  
  CHECKIN_BASE_POINTS: 20,
  CHECKIN_PHOTO_BONUS: 10,
  
  MEAL_POINTS: 15,
  RECOVERY_POINTS: 15,
  
  STRAVA_BASE_POINTS: 20,
  STRAVA_POINTS_PER_KM: 5,
  
  MAX_DAILY_CHECKINS: 1,
  MAX_WEEKLY_FREQUENCY_DAYS: 7,
  
  STREAK_X12: 1.2,
  STREAK_X15: 1.5,
  
  SPEED_LIMIT_MS: 8.5, // ~30.6 km/h max threshold for running

  // Antifraude: limites de plausibilidade de atividade (ver auditoria de integridade)
  MIN_ACTIVITY_DURATION_SECS: 60, // 1 minuto - atividades abaixo disso sao rejeitadas para pontuacao
  MAX_ACTIVITY_DURATION_SECS: 21600, // 6 horas - acima disso e implausivel/provavel erro de dados
  MAX_TIMESTAMP_FUTURE_MINUTES: 15, // tolerancia de relogio para atividades "no futuro"
  MAX_TIMESTAMP_PAST_DAYS: 90, // atividades mais antigas que isso sao rejeitadas (dados forjados/corrompidos)

  // 5 Quality Criteria Weights (summing to 1.0)
  WEIGHTS: {
    CONSISTENCY: 0.25,        // 25% - Weekly frequency vs target
    INTENSITY: 0.25,          // 25% - Heart rate, target zone, pace, calories/kg
    EFFICIENCY: 0.20,         // 20% - Active vs idle/rest time ratio
    TECHNICAL_QUALITY: 0.15,  // 15% - Logged exercises, photo, AI validation, biometrics
    DATA_INTEGRITY: 0.15      // 15% - GPS coherence, mock location check, sensor validity
  },

  // Ideal targets for sports science evaluation
  TARGETS: {
    IDEAL_WEEKLY_DAYS_MIN: 4,
    IDEAL_WEEKLY_DAYS_MAX: 5,
    IDEAL_ACTIVE_RATIO: 0.85, // 85%+ active time is optimal
    TARGET_HR_PCT_MIN: 60,    // 60% FCmax minimum target zone
    TARGET_HR_PCT_MAX: 85     // 85% FCmax optimal upper zone
  },

  // Science & UX Explanations per Metric
  EXPLANATIONS: {
    CONSISTENCY: {
      title: "Consistência Semanal",
      whatWeAnalyze: "Analisamos quantas vezes você treinou nos últimos 7 dias em relação à meta ideal de estímulos musculares.",
      whyItMatters: "Treinar entre 4 e 5 vezes por semana mantém o estímulo muscular constante, favorece a supercompensação e previne lesões sem causar overtraining."
    },
    INTENSITY: {
      title: "Intensidade Adequada",
      whatWeAnalyze: "Avaliamos sua frequência cardíaca média, tempo na zona-alvo e gasto calórico em relação ao seu perfil biológico.",
      whyItMatters: "A intensidade correta garante que seu corpo alcance as adaptações metabólicas e cardiovasculares desejadas sem exaustão precoce."
    },
    EFFICIENCY: {
      title: "Eficiência do Treino",
      whatWeAnalyze: "Medimos a relação entre o tempo em atividade real e os intervalos de descanso acumulados durante a sessão.",
      whyItMatters: "Pausas excessivas reduzem a densidade do treino e a frequência cardíaca ideal, diminuindo os ganhos de resistência e hipertrofia."
    },
    TECHNICAL_QUALITY: {
      title: "Qualidade Técnica",
      whatWeAnalyze: "Verificamos se os exercícios foram cadastrados, fotos enviadas, validação por IA aprovada e dados biométricos conectados.",
      whyItMatters: "Registros detalhados e validados garantem acompanhamento preciso da progressão de carga e execução correta."
    },
    DATA_INTEGRITY: {
      title: "Integridade dos Dados",
      whatWeAnalyze: "Checamos a coerência das coordenadas de GPS, ausência de ferramentas de localização simulada (Mock GPS) e estabilidade dos sensores.",
      whyItMatters: "Garante um ambiente justo e auditável para todo o ranking, recompensando unicamente esforços físicos reais."
    }
  }
};
