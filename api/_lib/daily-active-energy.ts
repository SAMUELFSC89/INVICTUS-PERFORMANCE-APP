import type { HealthSample } from './health-data-layer.js';
import { aggregateDailyHealthSamples, healthSampleLocalDate } from './health-source-priority.js';

const KCAL_PER_STEP_PER_KG = 0.0005;

function daySamples(samples: HealthSample[], localDate: string, timeZone: string) {
  return samples.filter((sample) => healthSampleLocalDate(sample, timeZone) === localDate);
}

/**
 * Consolida o gasto ativo diário sem somar duas vezes um treino que já entrou
 * no total diário do Apple Health/Health Connect.
 *
 * Prioridade:
 * 1) total diário ativo do dispositivo (fonte mais confiável do dia);
 * 2) se o total do dispositivo for menor que calorias de treinos já conhecidas,
 *    preserva pelo menos a soma dos treinos;
 * 3) sem total diário de calorias, usa calorias dos treinos + estimativa dos
 *    passos FORA dos treinos, descontando `steps_activity` quando disponível.
 */
export function buildConsolidatedDailyActiveCalories(params: {
  calories: HealthSample[];
  stepsDaily: HealthSample[];
  stepsActivity: HealthSample[];
  weightKg?: number;
  timeZone?: string;
}): HealthSample[] {
  const timeZone = params.timeZone || 'UTC';
  const days = new Set<string>();
  for (const sample of [...params.calories, ...params.stepsDaily, ...params.stepsActivity]) {
    days.add(healthSampleLocalDate(sample, timeZone));
  }

  const result: HealthSample[] = [];
  for (const localDate of [...days].sort()) {
    const calories = daySamples(params.calories, localDate, timeZone);
    const stepsDaily = daySamples(params.stepsDaily, localDate, timeZone);
    const stepsActivity = daySamples(params.stepsActivity, localDate, timeZone);

    const deviceDailyTotals = calories.filter((sample) => sample.aggregation === 'daily_total' && !sample.sourceActivityId);
    const authoritative = deviceDailyTotals.length
      ? aggregateDailyHealthSamples('calories_active', deviceDailyTotals, timeZone).at(-1)
      : undefined;

    const activityCalories = calories.filter((sample) => Boolean(sample.sourceActivityId));
    const workoutCalories = activityCalories.reduce((sum, sample) => sum + Math.max(0, Number(sample.value) || 0), 0);

    if (authoritative) {
      const value = Math.max(Math.max(0, Number(authoritative.value) || 0), workoutCalories);
      result.push({
        ...authoritative,
        value: Math.round(value * 100) / 100,
        localDate,
        aggregation: 'daily_total',
        aggregationMethod: 'daily_total',
        sampleCount: Math.max(1, activityCalories.length + 1),
        derivedFrom: Array.from(new Set([
          ...(authoritative.derivedFrom || [authoritative.id]),
          ...activityCalories.map((sample) => sample.id),
        ])).slice(0, 100),
      });
      continue;
    }

    const selectedSteps = stepsDaily.length
      ? aggregateDailyHealthSamples('steps_daily', stepsDaily, timeZone).at(-1)
      : undefined;
    const totalSteps = Math.max(0, Number(selectedSteps?.value) || 0);
    const workoutSteps = stepsActivity.reduce((sum, sample) => sum + Math.max(0, Number(sample.value) || 0), 0);
    const movementSteps = Math.max(0, totalSteps - workoutSteps);
    const weightKg = Number(params.weightKg);
    const movementCalories = Number.isFinite(weightKg) && weightKg > 0
      ? movementSteps * weightKg * KCAL_PER_STEP_PER_KG
      : 0;
    const value = workoutCalories + movementCalories;
    if (!(value > 0)) continue;

    const base = activityCalories.at(-1) || selectedSteps || stepsActivity.at(-1);
    if (!base) continue;
    result.push({
      ...base,
      id: `derived_daily_active_energy_${localDate}`,
      metricType: 'calories_active',
      value: Math.round(value * 100) / 100,
      unit: 'kcal',
      source: 'invictus_manual',
      sourceActivityId: undefined,
      device: undefined,
      quality: 'manual_entry',
      provenance: undefined,
      confidenceAtMeasurement: undefined,
      currentEvidenceConfidence: undefined,
      measurementContext: undefined,
      sampleId: `daily-active-energy:v1:${localDate}`,
      aggregation: 'daily_total',
      aggregationMethod: 'sum',
      localDate,
      timeZone,
      sampleCount: activityCalories.length + stepsActivity.length + (selectedSteps ? 1 : 0),
      derivedFrom: Array.from(new Set([
        ...activityCalories.map((sample) => sample.id),
        ...stepsActivity.map((sample) => sample.id),
        ...(selectedSteps ? [selectedSteps.id] : []),
      ])).slice(0, 100),
      createdAt: base.createdAt || new Date().toISOString(),
    });
  }

  return result;
}
