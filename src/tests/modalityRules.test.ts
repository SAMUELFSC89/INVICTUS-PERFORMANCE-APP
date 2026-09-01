import { CARDIO_MODALITY_CONFIG, getModalityConfig } from '../config/cardioConfig';
import { MODALITY_BACKEND_CONFIG } from '../../api/_lib/modality-config';
import { GpsEngine } from '../../api/_lib/gps-engine';
import { SensorEngine } from '../../api/_lib/sensor-engine';
import { ValidationEngine } from '../../api/_lib/validation-engine';

export function runModalityRulesTests() {
  console.log('🧪 Iniciando suíte de testes de Modalidades e Antifraude...\n');

  let passedCount = 0;
  let failedCount = 0;

  function assertTest(name: string, condition: boolean, details?: string) {
    if (condition) {
      console.log(`✅ [PASS] ${name}`);
      passedCount++;
    } else {
      console.error(`❌ [FAIL] ${name}${details ? ` -> ${details}` : ''}`);
      failedCount++;
    }
  }

  // 1. Todas as 10 modalidades de cardio existem no frontend e no backend
  const expectedModalities = [
    'running', 'walking', 'bike', 'treadmill', 'stationary_bike',
    'elliptical', 'rowing', 'stair_climber', 'swimming', 'hiit'
  ];

  for (const id of expectedModalities) {
    const frontCfg = getModalityConfig(id);
    const backCfg = MODALITY_BACKEND_CONFIG[id];
    assertTest(`Modalidade '${id}' configurada no frontend e backend`, Boolean(frontCfg && backCfg));
  }

  // 2. Modalidades Outdoor exigem GPS; Indoor NÃO exigem
  assertTest('Corrida outdoor exige GPS', CARDIO_MODALITY_CONFIG.running.requiresGps === true);
  assertTest('Caminhada outdoor exige GPS', CARDIO_MODALITY_CONFIG.walking.requiresGps === true);
  assertTest('Bike outdoor exige GPS', CARDIO_MODALITY_CONFIG.bike.requiresGps === true);
  assertTest('Esteira é indoor e NÃO exige GPS', CARDIO_MODALITY_CONFIG.treadmill.requiresGps === false);
  assertTest('Bike ergométrica é indoor e NÃO exige GPS', CARDIO_MODALITY_CONFIG.stationary_bike.requiresGps === false);
  assertTest('HIIT é indoor e NÃO exige GPS', CARDIO_MODALITY_CONFIG.hiit.requiresGps === false);

  // 3. Validação do ValidationEngine para atividade Indoor sem GPS
  {
    const indoorActivity = {
      activityType: 'CARDIO',
      cardioType: 'treadmill',
      durationMins: 30,
      timestamp: new Date().toISOString()
    };
    const res = ValidationEngine.validate(indoorActivity);
    assertTest('ValidationEngine aprova esteira sem GPS', res.valid === true);
  }

  // 4. Validação do ValidationEngine para atividade Outdoor sem GPS -> deve falhar
  {
    const outdoorActivityNoGps = {
      activityType: 'CARDIO',
      cardioType: 'running',
      durationMins: 30,
      timestamp: new Date().toISOString()
    };
    const res = ValidationEngine.validate(outdoorActivityNoGps);
    assertTest('ValidationEngine reprova corrida outdoor sem GPS', res.valid === false && res.missingData.includes('GPS_TRACK'));
  }

  // 5. GpsEngine: detecção de velocidade excessiva específica por modalidade
  {
    const runningWithHighSpeed = {
      activityType: 'CARDIO',
      cardioType: 'running',
      checkpoints: [
        { latitude: -23.550, longitude: -46.633, timestamp: '2026-08-24T10:00:00Z' },
        { latitude: -23.555, longitude: -46.633, timestamp: '2026-08-24T10:00:30Z' }, // ~555m em 30s = 66.6 km/h (excede 30 km/h)
        { latitude: -23.560, longitude: -46.633, timestamp: '2026-08-24T10:01:00Z' }
      ]
    };
    const res = GpsEngine.evaluate(runningWithHighSpeed);
    assertTest('GpsEngine detecta velocidade excessiva em corrida (>30 km/h)', res.hasExcessiveSpeed === true);
  }

  // 6. GpsEngine: bike outdoor permite velocidades de até 80 km/h (ex: descida a 45 km/h)
  {
    const bikeFastDescent = {
      activityType: 'CARDIO',
      cardioType: 'bike',
      checkpoints: [
        { latitude: -23.550, longitude: -46.633, timestamp: '2026-08-24T10:00:00Z' },
        { latitude: -23.553, longitude: -46.633, timestamp: '2026-08-24T10:00:30Z' }, // ~333m em 30s = 40 km/h (válido para bike)
        { latitude: -23.556, longitude: -46.633, timestamp: '2026-08-24T10:01:00Z' }
      ]
    };
    const res = GpsEngine.evaluate(bikeFastDescent);
    assertTest('GpsEngine aprova velocidade de 40 km/h para bike outdoor', res.hasExcessiveSpeed === false);
  }

  // 7. SensorEngine: indoor não exige telemetria de acelerômetro
  {
    const indoorSession = {
      activityType: 'CARDIO',
      cardioType: 'hiit',
      durationMins: 30
    };
    const res = SensorEngine.evaluate(indoorSession);
    assertTest('SensorEngine não reprova HIIT indoor por ausência de telemetria', res.isSensorDataValid === true);
  }

  // 8. Musculação: validação com grupo muscular
  {
    const workoutActivity = {
      activityType: 'WORKOUT',
      type: 'WORKOUT',
      muscleGroup: 'Peito',
      durationMins: 45,
      timestamp: new Date().toISOString()
    };
    const res = ValidationEngine.validate(workoutActivity);
    assertTest('ValidationEngine aprova musculação com grupo muscular e sem GPS', res.valid === true);
  }

  // 9. IntegrityEngine: Telemetria de saúde (Apple Health / Health Connect) eleva a integridade
  {
    const { IntegrityEngine } = require('../../api/_lib/integrity-engine');
    const activityWithHealth = {
      activityType: 'CARDIO',
      cardioType: 'treadmill',
      durationMins: 30,
      avgHeartRate: 145,
      maxHeartRate: 168,
      healthTelemetry: {
        avgHeartRate: 145,
        maxHeartRate: 168,
        steps: 3500,
        calories: 280,
        source: 'apple_health'
      },
      source: 'APPLE_HEALTH'
    };
    const integrityRes = IntegrityEngine.calculate(activityWithHealth);
    assertTest('IntegrityEngine atribui score elevado para dados com telemetria Apple Health', integrityRes.integrityScore >= 90);
  }

  console.log(`\n📊 Resultado dos testes: ${passedCount} aprovados, ${failedCount} falhos.`);
  return { passedCount, failedCount, success: failedCount === 0 };
}

describe('Modality Rules & Antifraud Tests', () => {
  it('should validate all cardio modalities, GPS requirements, and anti-fraud rules', () => {
    const result = runModalityRulesTests();
    expect(result.failedCount).toBe(0);
    expect(result.passedCount).toBeGreaterThan(0);
    expect(result.success).toBe(true);
  });
});

if (typeof process !== 'undefined' && process.argv && process.argv[1] && process.argv[1].includes('modalityRules.test')) {
  const result = runModalityRulesTests();
  if (result.failedCount > 0) {
    process.exit(1);
  }
}
