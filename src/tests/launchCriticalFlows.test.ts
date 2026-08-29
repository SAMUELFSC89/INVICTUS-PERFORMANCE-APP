import { selectDailyHealthSource } from '../../api/_lib/health-source-priority';
import { resolvePowerLiftAuditStatus } from '../../api/_lib/powerlift-audit';
import { GpsEngine } from '../../api/_lib/gps-engine';
import type { HealthSample } from '../../api/_lib/health-data-layer';

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
});
