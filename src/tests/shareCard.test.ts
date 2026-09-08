import { resolveShareCardMetrics } from '../lib/shareCard';

describe('métricas do novo card de compartilhamento', () => {
  it('usa pace, e nunca velocidade, em atividade de bike', () => {
    const metrics = resolveShareCardMetrics({
      activityType: 'cardio',
      distanceKm: 20,
      durationSeconds: 30 * 60,
    });

    expect(metrics).toEqual([
      { label: 'Distância', value: '20,00', unit: 'km' },
      { label: 'Pace', value: '1:30', unit: '/km' },
      { label: 'Tempo', value: '30:00' },
    ]);
    expect(metrics.some((metric) => metric.label.toLowerCase().includes('velocidade'))).toBe(false);
  });

  it('adapta as métricas quando a atividade não possui distância', () => {
    expect(resolveShareCardMetrics({ durationSeconds: 3661, calories: 420, weightKg: 80 })).toEqual([
      { label: 'Tempo', value: '1:01:01' },
      { label: 'Carga', value: '80,0', unit: 'kg' },
      { label: 'Calorias', value: '420', unit: 'kcal' },
    ]);
  });
});

