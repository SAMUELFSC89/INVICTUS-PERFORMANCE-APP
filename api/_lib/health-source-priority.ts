import type { HealthMetricType, HealthSample } from './health-data-layer.js';

const SOURCE_PRIORITY: Record<string, number> = {
  apple_health: 100,
  health_connect: 90,
  strava: 70,
  invictus_gps: 60,
  invictus_manual: 10
};

/** Evita somar totais diários da mesma métrica vindos de ecossistemas
 * diferentes. Apple Health é a fonte principal quando existe no dia. */
export function selectDailyHealthSource(type: HealthMetricType, samples: HealthSample[]): HealthSample[] {
  if (type !== 'steps_daily') return samples;
  const byDay = new Map<string, HealthSample>();
  for (const sample of samples) {
    const day = sample.timestamp.slice(0, 10);
    const current = byDay.get(day);
    if (!current || (SOURCE_PRIORITY[sample.source] || 0) > (SOURCE_PRIORITY[current.source] || 0)) {
      byDay.set(day, sample);
    }
  }
  return Array.from(byDay.values()).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}
