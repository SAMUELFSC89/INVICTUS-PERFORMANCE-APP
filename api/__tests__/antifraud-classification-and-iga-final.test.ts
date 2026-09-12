import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GpsEngine } from '../_lib/gps-engine';
import { SensorEngine } from '../_lib/sensor-engine';
import { FraudEngine } from '../_lib/fraud-engine';
import { ValidationEngine } from '../_lib/validation-engine';
import { IntegrityEngine } from '../_lib/integrity-engine';
import { RiskEngine } from '../_lib/risk-engine';
import { calculateWeeklyIGA } from '../../src/core/iga';

const DEGREE_LON_KM_AT_EQUATOR = 111.32;

function routeAtSpeed(speedKmH: number, durationMinutes: number, intervalSec = 10) {
  const count = Math.max(3, Math.floor((durationMinutes * 60) / intervalSec) + 1);
  const kmPerInterval = speedKmH * intervalSec / 3600;
  const deltaLon = kmPerInterval / DEGREE_LON_KM_AT_EQUATOR;
  const start = Date.parse('2026-09-12T12:00:00.000Z');
  return Array.from({ length: count }, (_, index) => ({
    latitude: 0,
    longitude: index * deltaLon,
    accuracy: 5,
    timestamp: new Date(start + index * intervalSec * 1000).toISOString(),
    segmentId: 1,
  }));
}

function cardioPayload(params: {
  cardioType?: 'running' | 'walking' | 'bike';
  speedKmH?: number;
  durationMinutes?: number;
  steps?: number | null;
  avgHeartRate?: number;
  sensorTelemetry?: { accelVariance: number; gyroVariance: number } | null;
}) {
  const cardioType = params.cardioType || 'running';
  const durationMinutes = params.durationMinutes ?? 30;
  const speedKmH = params.speedKmH ?? (cardioType === 'walking' ? 5.5 : cardioType === 'bike' ? 24 : 10);
  const distanceKm = speedKmH * durationMinutes / 60;
  const activityType = cardioType === 'running' ? 'RUNNING' : cardioType === 'walking' ? 'WALKING' : 'CYCLING';
  const defaultSteps = cardioType === 'running'
    ? Math.round(distanceKm * 1000 / 1.0)
    : cardioType === 'walking'
      ? Math.round(distanceKm * 1000 / 0.72)
      : 0;

  return {
    id: `stress-${cardioType}-${speedKmH}`,
    type: 'cardio',
    activityType,
    cardioType,
    durationMins: durationMinutes,
    activeTimeMins: durationMinutes,
    distanceKm,
    distanceMeters: distanceKm * 1000,
    checkpoints: routeAtSpeed(speedKmH, durationMinutes),
    gpsAccuracy: 5,
    timestamp: '2026-09-12T12:00:00.000Z',
    source: 'APPLE_HEALTH',
    dataSource: 'APPLE_HEALTH',
    avgHeartRate: params.avgHeartRate ?? (cardioType === 'bike' ? 138 : 152),
    maxHeartRate: 178,
    steps: params.steps === null ? undefined : (params.steps ?? defaultSteps),
    sensorTelemetry: params.sensorTelemetry === null
      ? undefined
      : (params.sensorTelemetry ?? { accelVariance: 1.15, gyroVariance: 0.62 }),
    requiresMotionEvidence: true,
    healthTelemetry: {
      source: 'APPLE_HEALTH',
      avgHeartRate: params.avgHeartRate ?? (cardioType === 'bike' ? 138 : 152),
      maxHeartRate: 178,
    },
    deviceInfo: {
      isEmulator: false,
      isRooted: false,
      isJailbroken: false,
    },
  };
}

function classify(activity: any) {
  const validation = ValidationEngine.validate(activity, { status: 'ACTIVE' });
  const integrity = IntegrityEngine.calculate(activity);
  const fraud = FraudEngine.analyze(activity, { status: 'ACTIVE' }, []);
  const risk = RiskEngine.evaluate(validation, integrity, fraud);
  return { validation, integrity, fraud, risk };
}

function evidenceCodes(activity: any) {
  return classify(activity).fraud.evidences.map((item) => item.code);
}

describe('Antifraude por modalidade — stress de classificação', () => {
  test('corrida humana coerente fica sem evidência de fraude e baixa no risco base', () => {
    const result = classify(cardioPayload({ cardioType: 'running', speedKmH: 10 }));
    expect(result.validation.valid).toBe(true);
    expect(result.fraud.evidences).toEqual([]);
    expect(result.risk.automaticDecision).toBe('APPROVED');
  });

  test('pace/velocidade incompatível com corrida é detectado', () => {
    const result = classify(cardioPayload({ cardioType: 'running', speedKmH: 48, steps: 4_000 }));
    expect(result.fraud.gpsReport.hasExcessiveSpeed).toBe(true);
    expect(evidenceCodes(cardioPayload({ cardioType: 'running', speedKmH: 48, steps: 4_000 })))
      .toContain('EXCESSIVE_SPEED');
    expect(result.risk.automaticDecision).not.toBe('APPROVED');
  });

  test('carro/moto em velocidade urbana não pode passar como caminhada', () => {
    const result = classify(cardioPayload({ cardioType: 'walking', speedKmH: 32, steps: 1_000 }));
    expect(result.fraud.gpsReport.hasExcessiveSpeed).toBe(true);
    expect(result.risk.automaticDecision).not.toBe('APPROVED');
  });

  test('bike usada como corrida em velocidade plausível precisa de evidência de passada', () => {
    const activity = cardioPayload({
      cardioType: 'running',
      speedKmH: 22,
      steps: null,
      sensorTelemetry: { accelVariance: 0.9, gyroVariance: 0.5 },
      avgHeartRate: 155,
    });
    const sensor = SensorEngine.evaluate(activity);
    expect(sensor.threats).toContain('MISSING_GAIT_EVIDENCE');
    const result = classify(activity);
    expect(result.risk.automaticDecision).not.toBe('APPROVED');
  });

  test('distância incompatível com os passos acusa passada impossível', () => {
    const activity = cardioPayload({ cardioType: 'running', speedKmH: 18, steps: 350 });
    const sensor = SensorEngine.evaluate(activity);
    expect(sensor.stepToDistanceRatioValid).toBe(false);
    expect(sensor.threats.some((item) => item.startsWith('UNREALISTIC_STRIDE_LENGTH'))).toBe(true);
    expect(classify(activity).risk.automaticDecision).not.toBe('APPROVED');
  });

  test('movimento do acelerômetro/giroscópio incoerente com cardio real não aprova', () => {
    const activity = cardioPayload({
      cardioType: 'running',
      speedKmH: 11,
      sensorTelemetry: { accelVariance: 0.04, gyroVariance: 0.02 },
    });
    expect(SensorEngine.evaluate(activity).threats).toContain('NO_SENSOR_MOTION_VARIANCE');
    expect(classify(activity).risk.automaticDecision).not.toBe('APPROVED');
  });

  test('cardio outdoor sem telemetria de movimento é fail-closed', () => {
    const activity = cardioPayload({ cardioType: 'running', speedKmH: 10, sensorTelemetry: null });
    expect(SensorEngine.evaluate(activity).threats).toContain('MISSING_SENSOR_TELEMETRY');
    expect(classify(activity).risk.automaticDecision).not.toBe('APPROVED');
  });

  test('ficar parado com o GPS ligado não pontua como cardio', () => {
    const activity = cardioPayload({ cardioType: 'running', speedKmH: 0, steps: 0 });
    const result = classify(activity);
    expect(result.fraud.evidences.map((item) => item.code)).toContain('INSUFFICIENT_MOVEMENT');
    expect(result.risk.automaticDecision).toBe('BLOCKED');
  });

  test('bike em padrão de veículo motorizado sem esforço corroborado é retida', () => {
    const activity = cardioPayload({
      cardioType: 'bike',
      speedKmH: 34,
      steps: 0,
      avgHeartRate: 76,
      sensorTelemetry: { accelVariance: 0.8, gyroVariance: 0.4 },
    });
    const result = classify(activity);
    expect(result.fraud.gpsReport.suspectedMotorizedTransport).toBe(true);
    expect(result.fraud.evidences.map((item) => item.code)).toContain('SUSPECTED_MOTORIZED_TRANSPORT');
    expect(result.risk.automaticDecision).not.toBe('APPROVED');
  });

  test('bike legítima com velocidade e esforço coerentes não é confundida com carro', () => {
    const activity = {
      ...cardioPayload({ cardioType: 'bike', speedKmH: 24, steps: 0, avgHeartRate: 142 }),
      cadence: 78,
      powerWatts: 165,
    };
    const result = classify(activity);
    expect(result.fraud.gpsReport.suspectedMotorizedTransport).toBe(false);
    expect(result.fraud.evidences.map((item) => item.code)).not.toContain('SUSPECTED_MOTORIZED_TRANSPORT');
  });

  test('musculação não recebe regra de pace/GPS de corrida', () => {
    const activity = {
      id: 'strength-coherent',
      type: 'workout',
      activityType: 'WORKOUT',
      durationMins: 60,
      activeTimeMins: 52,
      avgHeartRate: 126,
      maxHeartRate: 168,
      timestamp: '2026-09-12T12:00:00.000Z',
      source: 'GYM_CHECKIN',
      muscleGroup: 'chest',
      sensorTelemetry: { accelVariance: 0.55, gyroVariance: 0.25 },
    };
    const result = classify(activity);
    expect(result.validation.profileId).toBe('STRENGTH');
    expect(result.fraud.evidences.map((item) => item.code)).not.toContain('INSUFFICIENT_MOVEMENT');
    expect(result.fraud.evidences.map((item) => item.code)).not.toContain('EXCESSIVE_SPEED');
  });
});

describe('Contrato terminal da decisão competitiva', () => {
  test('decisões antifraude conhecidas não podem voltar para uma fila humana inexistente', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'api/_services/activities/validate-activity-service.ts'),
      'utf8',
    );
    expect(source).toContain("| 'rejected';");
    expect(source).toContain("['BLOCKED', 'UNDER_REVIEW', 'PARTIALLY_APPROVED'].includes(securityResult.decision)");
    expect(source).toContain("competitionReviewStatus = 'rejected';");
    expect(source).toContain("competitionReviewStatus = 'ineligible';");
    expect(source).toContain("competitionReviewStatus === 'rejected'");
  });
});

describe('IGA 2.0 — cálculo final sob matriz de entradas', () => {
  const profile = { age: 30, weightKg: 80, maxHeartRate: 190 };

  test('resultado final bate exatamente com Fn × Tn × In em todas as combinações testadas', () => {
    const durations = [30, 45, 60, 90];
    const heartRates = [114, 133, 152, 171]; // 60%, 70%, 80%, 90% de 190
    let checked = 0;

    for (let frequency = 1; frequency <= 7; frequency += 1) {
      for (const durationMinutes of durations) {
        for (const avgHeartRate of heartRates) {
          const sessions = Array.from({ length: frequency }, (_, index) => ({
            id: `s-${frequency}-${durationMinutes}-${avgHeartRate}-${index}`,
            type: index % 2 === 0 ? 'workout' : 'cardio',
            durationMinutes,
            avgHeartRate,
            caloriesInformed: 400 + index * 20,
            isValid: true,
          }));
          const result = calculateWeeklyIGA(sessions, profile);
          const expectedBase = Math.round(100 * Math.cbrt(result.Fn * result.Tn * result.In));
          const expectedRanking = Math.round(expectedBase * result.ageHandicapMultiplier);

          expect(result.igaBase).toBe(expectedBase);
          expect(result.igaFinal).toBe(expectedBase);
          expect(result.igaRanking).toBe(expectedRanking);
          expect(result.frequency).toBe(Math.min(frequency, 5));
          checked += 1;
        }
      }
    }
    expect(checked).toBe(112);
  });

  test('sessão rejeitada não entra em F, T, I nem no IGA final', () => {
    const validSessions = [
      { id: 'a', type: 'workout', durationMinutes: 60, avgHeartRate: 145, caloriesInformed: 400, isValid: true },
      { id: 'b', type: 'cardio', durationMinutes: 45, avgHeartRate: 155, caloriesInformed: 450, isValid: true },
    ];
    const baseline = calculateWeeklyIGA(validSessions, profile);
    const withFraud = calculateWeeklyIGA([
      ...validSessions,
      { id: 'fraud', type: 'cardio', durationMinutes: 90, avgHeartRate: 175, caloriesInformed: 2_000, isValid: false },
    ], profile);

    expect(withFraud.frequency).toBe(baseline.frequency);
    expect(withFraud.Fn).toBe(baseline.Fn);
    expect(withFraud.Tn).toBe(baseline.Tn);
    expect(withFraud.In).toBe(baseline.In);
    expect(withFraud.igaRanking).toBe(baseline.igaRanking);
    expect(withFraud.topSessions.find((item) => item.sessionId === 'fraud')?.eligible).toBe(false);
  });

  test('calorias continuam informativas e não alteram a pontuação final', () => {
    const lowCalories = calculateWeeklyIGA([
      { id: 'same', type: 'cardio', durationMinutes: 60, avgHeartRate: 155, caloriesInformed: 80, isValid: true },
    ], profile);
    const highCalories = calculateWeeklyIGA([
      { id: 'same', type: 'cardio', durationMinutes: 60, avgHeartRate: 155, caloriesInformed: 3_000, isValid: true },
    ], profile);

    expect(highCalories.igaRanking).toBe(lowCalories.igaRanking);
    expect(highCalories.Fn).toBe(lowCalories.Fn);
    expect(highCalories.Tn).toBe(lowCalories.Tn);
    expect(highCalories.In).toBe(lowCalories.In);
  });

  test('a sexta e a sétima sessões não aumentam frequência acima de cinco', () => {
    const sessions = Array.from({ length: 7 }, (_, index) => ({
      id: `cap-${index}`,
      type: 'workout',
      durationMinutes: 60 + index * 2,
      avgHeartRate: 145 + index,
      caloriesInformed: 450,
      isValid: true,
    }));
    const result = calculateWeeklyIGA(sessions, profile);
    expect(result.frequency).toBe(5);
    expect(result.topSessions.filter((item) => item.eligible).length).toBe(7);
  });
});
