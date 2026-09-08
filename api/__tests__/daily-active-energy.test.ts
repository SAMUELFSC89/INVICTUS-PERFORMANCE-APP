import { buildConsolidatedDailyActiveCalories } from '../_lib/daily-active-energy';
import type { HealthSample } from '../_lib/health-data-layer';

function sample(partial: Partial<HealthSample>): HealthSample {
  return {
    id: partial.id || Math.random().toString(36),
    userId: 'user-a',
    metricType: partial.metricType || 'calories_active',
    value: partial.value ?? 0,
    unit: partial.unit || 'kcal',
    timestamp: partial.timestamp || '2026-09-07T12:00:00.000Z',
    source: partial.source || 'health_connect',
    quality: partial.quality || 'sensor_verified',
    createdAt: partial.createdAt || '2026-09-07T12:01:00.000Z',
    ...partial,
  };
}

describe('gasto ativo diário consolidado', () => {
  test('não soma novamente treino já absorvido pelo total diário do Health', () => {
    const result = buildConsolidatedDailyActiveCalories({
      calories: [
        sample({ id: 'daily', value: 620, aggregation: 'daily_total', localDate: '2026-09-07', sourceActivityId: undefined }),
        sample({ id: 'workout', value: 300, source: 'invictus_manual', sourceActivityId: 'w1', localDate: '2026-09-07' }),
      ],
      stepsDaily: [], stepsActivity: [], weightKg: 80, timeZone: 'UTC',
    });
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe(620);
  });

  test('preserva pelo menos as calorias dos treinos quando superam um total diário incompleto', () => {
    const result = buildConsolidatedDailyActiveCalories({
      calories: [
        sample({ id: 'daily', value: 200, aggregation: 'daily_total', localDate: '2026-09-07', sourceActivityId: undefined }),
        sample({ id: 'workout', value: 300, source: 'invictus_manual', sourceActivityId: 'w1', localDate: '2026-09-07' }),
      ],
      stepsDaily: [], stepsActivity: [], weightKg: 80, timeZone: 'UTC',
    });
    expect(result[0].value).toBe(300);
  });

  test('sem calorias diárias, soma treino com estimativa dos passos fora do treino', () => {
    const result = buildConsolidatedDailyActiveCalories({
      calories: [sample({ id: 'workout', value: 300, source: 'invictus_manual', sourceActivityId: 'w1', localDate: '2026-09-07' })],
      stepsDaily: [sample({ id: 'steps-day', metricType: 'steps_daily', value: 10000, unit: 'passos', aggregation: 'daily_total', localDate: '2026-09-07' })],
      stepsActivity: [sample({ id: 'steps-workout', metricType: 'steps_activity', value: 2000, unit: 'passos', sourceActivityId: 'w1', localDate: '2026-09-07' })],
      weightKg: 80,
      timeZone: 'UTC',
    });
    // 8.000 passos fora do treino × 80 kg × 0,0005 = 320 kcal; + 300 kcal do treino.
    expect(result[0].value).toBe(620);
    expect(result[0].aggregationMethod).toBe('sum');
  });
});
