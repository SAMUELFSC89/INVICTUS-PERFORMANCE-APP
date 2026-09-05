import type { HealthMetricType, HealthSample } from './health-data-layer.js';

const SOURCE_PRIORITY: Record<string, number> = {
  apple_health: 100, health_connect: 90, strava: 70, invictus_gps: 60, invictus_manual: 10
};

const DATE_FORMATTERS = new Map<string, Intl.DateTimeFormat>();

export function healthSampleLocalDate(sample: HealthSample, fallbackTimeZone = 'UTC'): string {
  if (sample.localDate) return sample.localDate;
  const legacyDaily = !sample.sourceActivityId && sample.sampleId?.startsWith('health:') && ['calories_active', 'distance_km'].includes(sample.metricType);
  const timestamp = sample.aggregation === 'daily_total' || sample.metricType === 'steps_daily' || legacyDaily
    ? sample.startDate || sample.timestamp : sample.timestamp;
  try {
    const zone = sample.timeZone || fallbackTimeZone;
    if (!DATE_FORMATTERS.has(zone)) {
      if (DATE_FORMATTERS.size >= 32) DATE_FORMATTERS.clear();
      DATE_FORMATTERS.set(zone, new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }));
    }
    const parts = DATE_FORMATTERS.get(zone)!.formatToParts(new Date(timestamp));
    return ['year', 'month', 'day'].map(type => parts.find(p => p.type === type)?.value).join('-');
  } catch { return timestamp.slice(0, 10); }
}

/** Compatibilidade: uma origem por dia, sem somar passos de ecossistemas diferentes. */
export function selectDailyHealthSource(type: HealthMetricType, samples: HealthSample[]): HealthSample[] {
  if (type !== 'steps_daily') return samples;
  return aggregateDailyHealthSamples(type, samples);
}

const SUM_METRICS = new Set<HealthMetricType>([
  'sleep_duration_min', 'calories_active', 'calories_total', 'calories_basal', 'distance_km',
  'distance_cycling_km', 'duration_min', 'exercise_duration_min', 'stand_hours',
  'mindfulness_duration_min', 'hydration_l', 'dietary_energy_kcal', 'flights_climbed'
]);
const LATEST_METRICS = new Set<HealthMetricType>(['weight_kg', 'body_fat_percent', 'height_cm', 'vo2max_estimate']);

/** Compacta leituras em dias sem misturar totais do aparelho com parcelas de treino. */
export function aggregateDailyHealthSamples(type: HealthMetricType, samples: HealthSample[], timeZone = 'UTC'): HealthSample[] {
  const days = new Map<string, HealthSample[]>();
  for (const sample of samples) {
    const day = healthSampleLocalDate(sample, timeZone);
    if (!days.has(day)) days.set(day, []);
    days.get(day)!.push(sample);
  }
  const result: HealthSample[] = [];
  for (const [localDate, daySamples] of days) {
    const source = [...daySamples].sort((a, b) => (SOURCE_PRIORITY[b.source] || 0) - (SOURCE_PRIORITY[a.source] || 0))[0].source;
    let selected = daySamples.filter(s => s.source === source).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const totals = selected.filter(s => s.aggregation === 'daily_total' || s.metricType === 'steps_daily');
    if (!totals.length) {
      const sourceKey = (s: HealthSample) => [s.sourceId || s.provenance?.dataOrigin || '', s.device || '', s.provenance?.deviceModel || '', s.measurementContext || ''].join('|');
      const latestSource = sourceKey(selected[selected.length - 1]);
      selected = selected.filter(s => sourceKey(s) === latestSource);
    }
    let aggregationMethod: NonNullable<HealthSample['aggregationMethod']>;
    let value: number;
    if (totals.length) {
      // Totais são snapshots: escolher o mais recente, nunca somar snapshots.
      selected = [[...totals].sort((a, b) => (b.updatedAt || b.createdAt || b.timestamp).localeCompare(a.updatedAt || a.createdAt || a.timestamp))[0]];
      aggregationMethod = 'daily_total'; value = selected[0].value;
    } else if (LATEST_METRICS.has(type)) {
      selected = [selected[selected.length - 1]]; aggregationMethod = 'latest'; value = selected[0].value;
    } else {
      aggregationMethod = SUM_METRICS.has(type) ? 'sum' : 'mean';
      value = selected.reduce((sum, sample) => sum + sample.value, 0) / (aggregationMethod === 'mean' ? selected.length : 1);
    }
    const last = selected[selected.length - 1];
    const weakest = (key: 'confidenceAtMeasurement' | 'currentEvidenceConfidence') => selected
      .map(s => s[key]).filter((c): c is NonNullable<typeof c> => !!c)
      .sort((a, b) => a.confidenceScore - b.confidenceScore)[0];
    const mixedDevice = new Set(selected.map(s => `${s.sourceId || ''}:${s.device || ''}:${s.provenance?.deviceModel || ''}`)).size > 1;
    result.push({
      ...last, value, localDate, sampleCount: selected.length, aggregationMethod,
      device: mixedDevice ? undefined : last.device,
      provenance: mixedDevice ? { integration: last.provenance?.integration || 'UNKNOWN', status: 'UNKNOWN_DEVICE' } : last.provenance,
      confidenceAtMeasurement: weakest('confidenceAtMeasurement'), currentEvidenceConfidence: weakest('currentEvidenceConfidence'),
      derivedFrom: selected.length > 1 ? selected.map(s => s.id).slice(0, 100) : last.derivedFrom,
      sourceConfidence: selected.length > 1 ? selected.map(s => s.currentEvidenceConfidence?.confidenceScore ?? s.confidenceAtMeasurement?.confidenceScore ?? 0).slice(0, 100) : last.sourceConfidence
    });
  }
  return result.sort((a, b) => a.localDate!.localeCompare(b.localDate!));
}
