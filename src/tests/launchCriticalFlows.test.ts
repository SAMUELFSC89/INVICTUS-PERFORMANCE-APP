import { selectDailyHealthSource } from '../../api/_lib/health-source-priority';
import { resolveClientSampledFramesStatus, resolvePowerLiftAuditStatus } from '../../api/_lib/powerlift-audit';
import { GpsEngine } from '../../api/_lib/gps-engine';
import type { HealthSample } from '../../api/_lib/health-data-layer';
import { hasAllReadPermissions } from '../services/wearables/HealthConnectProvider';

const sample = (source: HealthSample['source'], value: number, timestamp: string): HealthSample => ({
  id: `${source}-${timestamp}`,
  userId: 'athlete',
  metricType: 'steps_daily',
  value,
  unit: 'passos',
  timestamp,
  source,
  quality: 'sensor_verified',
  createdAt: timestamp
});

describe('Fluxos críticos de lançamento', () => {
  test('Health Connect reconhece o formato real de permissões retornado pelo Android', () => {
    const allGranted = {
      READ_STEPS: true,
      READ_WORKOUTS: true,
      READ_ACTIVE_CALORIES: true,
      READ_DISTANCE: true,
      READ_HEART_RATE: true,
      READ_ROUTE: true
    };
    expect(hasAllReadPermissions({ permissions: allGranted })).toBe(true);
    expect(hasAllReadPermissions({ permissions: { ...allGranted, READ_ROUTE: false } })).toBe(false);
  });

  test('Apple Health tem prioridade sem somar passos de duas fontes', () => {
    const selected = selectDailyHealthSource('steps_daily', [
      sample('health_connect', 8000, '2026-08-28T23:00:00.000Z'),
      sample('apple_health', 7200, '2026-08-28T22:00:00.000Z')
    ]);
    expect(selected).toHaveLength(1);
    expect(selected[0].source).toBe('apple_health');
    expect(selected[0].value).toBe(7200);
  });

  test('Power Lift nunca aprova automaticamente abaixo de 98% de confiança', () => {
    expect(resolvePowerLiftAuditStatus('approved', 97.99)).toBe('manual_review');
    expect(resolvePowerLiftAuditStatus('approved', 98)).toBe('approved');
    expect(resolvePowerLiftAuditStatus('rejected', 100)).toBe('rejected');
  });

  test('frames extraídos no cliente nunca homologam automaticamente o Power Lift', () => {
    expect(resolveClientSampledFramesStatus('approved')).toBe('manual_review');
    expect(resolveClientSampledFramesStatus('manual_review')).toBe('manual_review');
    expect(resolveClientSampledFramesStatus('rejected')).toBe('rejected');
  });

  test('GPS aceita coordenada zero e calcula a precisão média real', () => {
    const result = GpsEngine.evaluate({
      activityType: 'CARDIO',
      cardioType: 'bike',
      checkpoints: [
        { location: { lat: 0, lng: 0, accuracy: 8 }, timestamp: '2026-08-28T10:00:00.000Z' },
        { location: { lat: 0, lng: 0.001, accuracy: 12 }, timestamp: '2026-08-28T10:01:00.000Z' },
        { location: { lat: 0, lng: 0.002, accuracy: 10 }, timestamp: '2026-08-28T10:02:00.000Z' }
      ]
    });
    expect(result.maxSpeedKmH).toBeGreaterThan(0);
    expect(result.avgAccuracyMeters).toBe(10);
  });

  test('bike com padrão sustentado de ônibus não pode ser aprovada no automático', () => {
    const checkpoints = Array.from({ length: 7 }, (_, index) => ({
      location: { lat: -30 + index * 0.00045, lng: -51, accuracy: 8 },
      timestamp: new Date(Date.parse('2026-08-28T10:00:00.000Z') + index * 4000).toISOString()
    }));
    const result = GpsEngine.evaluate({
      activityType: 'CYCLING',
      cardioType: 'bike',
      checkpoints
    });
    expect(result.verifiedDistanceKm).toBeGreaterThan(0.25);
    expect(result.averageMovingSpeedKmH).toBeGreaterThan(40);
    expect(result.suspectedMotorizedTransport).toBe(true);
  });

  test('bike urbana em velocidade de veículo sem esforço corroborado fica em análise', () => {
    const checkpoints = Array.from({ length: 25 }, (_, index) => ({
      location: { lat: -30 + index * 0.00018, lng: -51, accuracy: 7 },
      timestamp: new Date(Date.parse('2026-08-28T10:00:00.000Z') + index * 4000).toISOString()
    }));
    const result = GpsEngine.evaluate({
      activityType: 'CYCLING',
      cardioType: 'bike',
      checkpoints
    });
    expect(result.averageMovingSpeedKmH).toBeGreaterThan(18);
    expect(result.maxSpeedKmH).toBeLessThan(42);
    expect(result.suspectedMotorizedTransport).toBe(true);
  });

  test('pontos GPS acima de 30m de precisão não entram na distância oficial', () => {
    const result = GpsEngine.evaluate({
      activityType: 'RUNNING',
      cardioType: 'running',
      checkpoints: [
        { location: { lat: -30, lng: -51, accuracy: 8 }, timestamp: '2026-08-28T10:00:00.000Z' },
        { location: { lat: -29.99, lng: -51, accuracy: 80 }, timestamp: '2026-08-28T10:00:05.000Z' },
        { location: { lat: -29.9998, lng: -51, accuracy: 8 }, timestamp: '2026-08-28T10:00:10.000Z' }
      ]
    });
    expect(result.validPointCount).toBe(2);
    expect(result.verifiedDistanceKm).toBeLessThan(0.1);
  });
});
