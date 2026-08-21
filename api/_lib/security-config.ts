// #231: regra de deslocamento minimo -- ver validation.minDistanceKmPer10Min.
export interface SecurityConfig {
  engineVersion: string;
  ruleVersion: string;

  // Validation Engine Thresholds
  validation: {
    minDurationMins: number;
    maxDurationMins: number;
    maxActivityAgeDays: number;
    maxFutureTimestampToleranceSec: number;
    maxDistanceKm: number;
    minDistanceKmPer10Min: number;
    movementCheckTypes: string[];
    requireGpsForTypes: string[];
    requireHeartRateForTypes: string[];
    allowedDataSources: string[];
  };

  // Integrity Engine Weights (Must sum to 1.0)
  integrityWeights: {
    gps: number;
    heartRate: number;
    movement: number;
    timeConsistency: number;
    sensorIntegrity: number;
  };

  // Risk Score Penalty Increments
  riskPenalties: {
    mockLocation: number;
    frozenGps: number;
    replayDuplicate: number;
    timestampManipulation: number;
    teleportation: number;
    rootJailbreak: number;
    emulator: number;
    fridaXposedMagisk: number;
    virtualSpaceLuckyPatcher: number;
    moddedApkSignature: number;
    playIntegrityFailed: number;
    healthConnectTampered: number;
    appleHealthTampered: number;
    duplicatePhoto: number;
    inconsistentExif: number;
    aiGeneratedPhoto: number;
    internetStockPhoto: number;
    impossibleSpeed: number;
    impossibleCalories: number;
    impossibleHeartRate: number;
    badGpsAccuracy: number;
    absentHeartRateWhenRequired: number;
    suspiciousDeviceEnvironment: number;
    insufficientMovement: number;
  };

  // Risk Brackets
  riskLevels: {
    lowMax: number;       // 0 - 20
    mediumMax: number;    // 21 - 40
    highMax: number;      // 41 - 70
                          // 71+ = CRITICAL
  };

  // Decision Thresholds
  decisionThresholds: {
    approveMaxRiskScore: number;         // <= 20
    partiallyApproveMaxRiskScore: number; // <= 40
    underReviewMaxRiskScore: number;     // <= 70
                                         // > 70 = BLOCKED
  };
}

export const SECURITY_CONFIG: SecurityConfig = {
  engineVersion: "SECURITY_V2.0",
  ruleVersion: "2026.1",

  validation: {
    minDurationMins: 5,
    maxDurationMins: 360,
    maxActivityAgeDays: 30,
    maxFutureTimestampToleranceSec: 300, // 5 min clock skew allowance
    maxDistanceKm: 150, // max single session distance
    // #231: deslocamento minimo exigido por faixa de 10 min de atividade.
    // 0.5 km / 10 min equivale a 3 km/h. Vale SOMENTE para os tipos listados em
    // movementCheckTypes (os mesmos que exigem GPS). Cardio indoor (esteira,
    // ergometrica), quando existir, fica de fora de proposito.
    minDistanceKmPer10Min: 0.5,
    movementCheckTypes: ["RUNNING", "CYCLING", "WALKING", "OUTDOOR_HIKE"],
    requireGpsForTypes: ["RUNNING", "CYCLING", "WALKING", "OUTDOOR_HIKE"],
    requireHeartRateForTypes: ["HIIT", "INTENSE_CARDIO", "CROSSFIT"],
    allowedDataSources: [
      "HEALTH_CONNECT",
      "APPLE_HEALTH",
      "STRAVA",
      "GYM_CHECKIN",
      "MANUAL_VERIFIED",
      "GARMIN",
      "POLAR",
      "SAMSUNG_HEALTH",
      "COROS"
    ]
  },

  integrityWeights: {
    gps: 0.20,
    heartRate: 0.20,
    movement: 0.20,
    timeConsistency: 0.20,
    sensorIntegrity: 0.20
  },

  riskPenalties: {
    mockLocation: 50,
    frozenGps: 35,
    replayDuplicate: 40,
    timestampManipulation: 30,
    teleportation: 45,
    rootJailbreak: 30,
    emulator: 100,
    fridaXposedMagisk: 100,
    virtualSpaceLuckyPatcher: 80,
    moddedApkSignature: 90,
    playIntegrityFailed: 50,
    healthConnectTampered: 40,
    appleHealthTampered: 40,
    duplicatePhoto: 20,
    inconsistentExif: 25,
    aiGeneratedPhoto: 40,
    internetStockPhoto: 35,
    impossibleSpeed: 40,
    impossibleCalories: 35,
    impossibleHeartRate: 30,
    badGpsAccuracy: 10,
    absentHeartRateWhenRequired: 15,
    suspiciousDeviceEnvironment: 20,
    // 75 ultrapassa underReviewMaxRiskScore (70): decisao vira BLOCKED e
    // shouldScore fica false, ou seja, a atividade nao pontua.
    insufficientMovement: 75
  },

  riskLevels: {
    lowMax: 20,
    mediumMax: 40,
    highMax: 70
  },

  decisionThresholds: {
    approveMaxRiskScore: 20,
    partiallyApproveMaxRiskScore: 40,
    underReviewMaxRiskScore: 70
  }
};
