import type { HealthSummaryResponse, PontoTendencia } from '../../services/healthSummaryService';
import { healthLocalDate } from './healthViewModel';

export type HealthInsightKind = 'congratulations' | 'improvement' | 'decline' | 'alert' | 'tip';
export interface HealthInsight {
  id: string;
  metric: 'heart_rate_response' | 'steps' | 'sleep' | 'calories_active';
  kind: HealthInsightKind;
  priority: number;
  title: string;
  message: string;
  evidence: string;
}
export interface InsightWorkout {
  timestamp: number;
  durationMinutes: number;
  avgHeartRate?: number;
  distanceKm?: number;
  workoutType?: string;
}
export interface HealthInsightInput {
  summary: HealthSummaryResponse | null;
  workouts?: InsightWorkout[];
  now?: number;
  trainingPartial?: boolean;
}
interface Comparison {
  before: number;
  after: number;
  percent: number | null;
  beforeCount: number;
  afterCount: number;
}
const DAY_MS = 86400000;
const UNITS = { steps_daily: 'passos', sleep_duration_min: 'min', calories_active: 'kcal' } as const;
type InsightMetric = keyof typeof UNITS;

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}
function comparison(before: number[], after: number[]): Comparison {
  const beforeAverage = average(before);
  const afterAverage = average(after);
  return { before: beforeAverage, after: afterAverage,
    percent: beforeAverage > 0 ? (afterAverage - beforeAverage) / beforeAverage * 100 : null,
    beforeCount: before.length, afterCount: after.length };
}
function compareHalves(points: PontoTendencia[], minimumPerHalf = 3): Comparison | null {
  if (points.length < minimumPerHalf * 2) return null;
  const middle = Math.floor(points.length / 2);
  return comparison(points.slice(0, middle).map(p => p.value), points.slice(middle).map(p => p.value));
}
function canonicalUnit(point: PontoTendencia, metric: InsightMetric): string {
  const unit = (point.unit || '').trim().toLowerCase();
  return metric === 'steps_daily' && ['count', 'steps', 'passos'].includes(unit) ? 'passos' : unit;
}
function hasComparableConfidence(point: PontoTendencia): boolean {
  const grades = [point.confidenceAtMeasurement?.confidenceLevel, point.currentEvidenceConfidence?.confidenceLevel].filter(Boolean);
  return grades.length > 0 && grades.every(grade => ['A', 'B', 'C'].includes(grade!));
}
function sourceKey(point: PontoTendencia, metric: InsightMetric): string {
  return JSON.stringify([point.source, point.device || '', canonicalUnit(point, metric),
    point.provenance?.integration || '', point.provenance?.dataOrigin || '', point.provenance?.deviceModel || '',
    point.measurementContext || point.confidenceAtMeasurement?.measurementContext || '',
    point.provenance?.recordingMethod || '', point.aggregationMethod || '']);
}
/** The endpoint supplies daily values. Duplicate snapshots of a day must never
 * create extra days, inflate a total, or weight one day more than another. */
function comparableDailySeries(summary: HealthSummaryResponse, metric: InsightMetric, now: number, timeZone: string): PontoTendencia[] {
  const partial = summary.metadata?.metrics?.[metric]?.partial;
  if (partial === true || (summary.metadata?.partial && partial !== false)) return [];
  const today = healthLocalDate(now, timeZone);
  const windowDays = Math.min(90, Math.max(1, Math.floor(summary.windowDays || 30)));
  const firstDay = new Date(Date.parse(`${today}T00:00:00Z`) - (windowDays - 1) * DAY_MS).toISOString().slice(0, 10);
  const dated = (summary.trends[metric] || []).filter(point => {
    const timestamp = Date.parse(point.timestamp);
    const day = point.localDate || healthLocalDate(timestamp, timeZone);
    return Number.isFinite(timestamp) && timestamp <= now && day >= firstDay && day <= today
      // An unfinished day is not comparable to a completed daily total.
      && (metric === 'sleep_duration_min' || day < today);
  }).sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const usable = (point: PontoTendencia) => typeof point.value === 'number' && Number.isFinite(point.value)
    && (metric === 'sleep_duration_min' ? point.value > 0 : point.value >= 0)
    && Boolean(point.source && point.source !== 'unknown') && canonicalUnit(point, metric) === UNITS[metric]
    && hasComparableConfidence(point);
  const latest = dated.at(-1);
  // Do not silently fall back to an older, better-rated device when the current
  // origin or quality cannot support a comparison.
  if (!latest || !usable(latest)) return [];
  const key = sourceKey(latest, metric);
  const byDay = new Map<string, PontoTendencia>();
  for (const point of dated) {
    if (usable(point) && sourceKey(point, metric) === key) {
      byDay.set(point.localDate || healthLocalDate(point.timestamp, timeZone), point);
    }
  }
  return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, point]) => point);
}
function formatNumber(value: number, maximumFractionDigits = 0): string {
  return value.toLocaleString('pt-BR', { maximumFractionDigits });
}
function formatPercent(value: number): string {
  return `${value >= 0 ? '+' : ''}${formatNumber(value)}%`;
}
function daysEvidence(change: Comparison): string {
  return `${change.beforeCount} dias iniciais → ${change.afterCount} dias finais com registro`;
}
function coefficientOfVariation(points: PontoTendencia[]): number | null {
  if (points.length < 4) return null;
  const values = points.map(p => p.value);
  const mean = average(values);
  return mean > 0 ? Math.sqrt(average(values.map(value => (value - mean) ** 2))) / mean : null;
}
function normalizedType(value?: string): string {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ');
}
function similarRecordedPace(a: InsightWorkout, b: InsightWorkout): boolean {
  if (!(Number(a.distanceKm) > 0) || !(Number(b.distanceKm) > 0)) return false;
  const paceA = a.durationMinutes / Number(a.distanceKm);
  const paceB = b.durationMinutes / Number(b.distanceKm);
  return Math.abs(paceA - paceB) / Math.max(paceA, paceB) <= 0.1
    && Math.abs(a.durationMinutes - b.durationMinutes) / Math.max(a.durationMinutes, b.durationMinutes) <= 0.2
    && Math.abs(Number(a.distanceKm) - Number(b.distanceKm)) / Math.max(Number(a.distanceKm), Number(b.distanceKm)) <= 0.2;
}
function comparableHeartRateChange(workouts: InsightWorkout[], now: number, windowDays: number, timeZone: string): Comparison | null {
  const groups = new Map<string, InsightWorkout[]>();
  const seen = new Set<string>();
  for (const workout of [...workouts].sort((a, b) => a.timestamp - b.timestamp)) {
    const type = normalizedType(workout.workoutType);
    const key = `${workout.timestamp}:${type}`;
    if (!type || seen.has(key) || !Number.isFinite(workout.timestamp) || workout.timestamp > now || now - workout.timestamp > windowDays * DAY_MS
      || !Number.isFinite(workout.durationMinutes) || workout.durationMinutes < 10
      || !Number.isFinite(workout.avgHeartRate) || Number(workout.avgHeartRate) < 40 || Number(workout.avgHeartRate) > 240
      || !Number.isFinite(workout.distanceKm) || Number(workout.distanceKm) <= 0) continue;
    seen.add(key);
    groups.set(type, [...(groups.get(type) || []), workout]);
  }
  let best: Comparison | null = null;
  for (const group of groups.values()) {
    const days = [...new Set(group.map(w => healthLocalDate(w.timestamp, timeZone)))];
    if (days.length < 4) continue;
    const cutoff = days[Math.floor(days.length / 2)];
    const before = group.filter(w => healthLocalDate(w.timestamp, timeZone) < cutoff);
    const after = group.filter(w => healthLocalDate(w.timestamp, timeZone) >= cutoff);
    const beforeComparable = before.filter(w => after.some(candidate => similarRecordedPace(w, candidate)));
    const afterComparable = after.filter(w => beforeComparable.some(candidate => similarRecordedPace(w, candidate)));
    if (new Set(beforeComparable.map(w => healthLocalDate(w.timestamp, timeZone))).size < 2
      || new Set(afterComparable.map(w => healthLocalDate(w.timestamp, timeZone))).size < 2) continue;
    const candidate = comparison(beforeComparable.map(w => Number(w.avgHeartRate)), afterComparable.map(w => Number(w.avgHeartRate)));
    // Prefer the most supported modality, not the largest observed swing.
    if (!best || candidate.beforeCount + candidate.afterCount > best.beforeCount + best.afterCount) best = candidate;
  }
  return best;
}

/** Describes changes in recorded observations. No clinical interpretation,
 * automatic claim of better conditioning, or energy-burn goal. */
export function buildHealthInsights({ summary, workouts = [], now = Date.now(), trainingPartial = false }: HealthInsightInput): HealthInsight[] {
  if (!summary || !Number.isFinite(now) || ['stale', 'error'].includes(summary.availability || '')) return [];
  const insights: HealthInsight[] = [];
  const timeZone = summary.timeZone || 'UTC';
  const windowDays = Math.min(90, Math.max(1, Math.floor(summary.windowDays || 30)));
  const heartRateChange = trainingPartial ? null : comparableHeartRateChange(workouts, now, windowDays, timeZone);
  if (heartRateChange && Math.abs(heartRateChange.after - heartRateChange.before) >= 5) {
    const lower = heartRateChange.after < heartRateChange.before;
    insights.push({
      id: lower ? 'heart-rate-response-improved' : 'heart-rate-response-attention',
      metric: 'heart_rate_response', kind: 'tip', priority: 90,
      title: lower ? 'FC menor em sessões comparáveis' : 'FC maior em sessões comparáveis',
      message: `A FC média registrada ${lower ? 'caiu' : 'subiu'} de ${formatNumber(heartRateChange.before)} para ${formatNumber(heartRateChange.after)} bpm em sessões da mesma modalidade e no mesmo ritmo aproximado. Temperatura, terreno e cobertura do sensor podem diferir. Confira o contexto e observe se a mudança se repete; ela não comprova melhora ou piora do condicionamento.`,
      evidence: `${heartRateChange.beforeCount} sessões iniciais → ${heartRateChange.afterCount} finais · ${formatPercent(heartRateChange.percent!)}`
    });
  }
  const stepsChange = compareHalves(comparableDailySeries(summary, 'steps_daily', now, timeZone));
  if (stepsChange && ((stepsChange.percent !== null && Math.abs(stepsChange.percent) >= 10) || (stepsChange.before === 0 && stepsChange.after > 0))) {
    const increased = stepsChange.after > stepsChange.before;
    insights.push({
      id: increased ? 'steps-improved' : 'steps-declined', metric: 'steps', kind: 'tip', priority: 80,
      title: increased ? 'Mais passos registrados' : 'Menos passos registrados',
      message: `Sua média nos dias com registro ${increased ? 'aumentou' : 'diminuiu'}${stepsChange.percent === null ? '' : ` ${formatNumber(Math.abs(stepsChange.percent))}%`} entre os dois grupos de dias. Confira se o uso do dispositivo foi semelhante e como sua rotina mudou; dias sem leitura não entram como zero.`,
      evidence: `${formatNumber(stepsChange.before)} → ${formatNumber(stepsChange.after)} passos/dia · ${daysEvidence(stepsChange)}`
    });
  }
  const sleepPoints = comparableDailySeries(summary, 'sleep_duration_min', now, timeZone);
  const sleepChange = compareHalves(sleepPoints);
  const middle = Math.floor(sleepPoints.length / 2);
  const firstVariation = coefficientOfVariation(sleepPoints.slice(0, middle));
  const lastVariation = coefficientOfVariation(sleepPoints.slice(middle));
  const steadier = firstVariation !== null && lastVariation !== null && lastVariation < firstVariation * 0.85;
  const moreVariable = firstVariation !== null && lastVariation !== null && lastVariation > firstVariation * 1.2;
  if (sleepChange && (Math.abs(sleepChange.percent || 0) >= 10 || steadier || moreVariable)) {
    const increased = sleepChange.after > sleepChange.before;
    insights.push({
      id: increased || steadier ? 'sleep-improved' : 'sleep-declined', metric: 'sleep', kind: 'tip', priority: 75,
      title: moreVariable ? 'Duração do sono mais variável' : steadier ? 'Duração do sono mais estável' : increased ? 'Mais sono registrado' : 'Menos sono registrado',
      message: `A média do sono registrado ${increased ? 'aumentou' : sleepChange.after < sleepChange.before ? 'diminuiu' : 'se manteve'}${Math.abs(sleepChange.percent || 0) >= 1 ? ` ${formatNumber(Math.abs(sleepChange.percent!))}%` : ''}.${steadier ? ' A duração também variou menos entre os dias.' : moreVariable ? ' A duração também variou mais entre os dias.' : ''} Isso não mede a qualidade do sono nem a regularidade dos horários. Compare com como você se sente ao acordar e com a cobertura do dispositivo.`,
      evidence: `${formatNumber(sleepChange.before / 60, 1)}h → ${formatNumber(sleepChange.after / 60, 1)}h/dia · ${daysEvidence(sleepChange)}`
    });
  }
  const caloriesChange = compareHalves(comparableDailySeries(summary, 'calories_active', now, timeZone));
  if (caloriesChange && ((caloriesChange.percent !== null && Math.abs(caloriesChange.percent) >= 15) || (caloriesChange.before === 0 && caloriesChange.after > 0))) {
    const increased = caloriesChange.after > caloriesChange.before;
    insights.push({
      id: increased ? 'active-calories-up' : 'active-calories-down', metric: 'calories_active', kind: 'tip', priority: 55,
      title: increased ? 'Estimativa de gasto em alta' : 'Estimativa de gasto em queda',
      message: `A estimativa diária de gasto energético ativo ${increased ? 'aumentou' : 'diminuiu'}${caloriesChange.percent === null ? '' : ` ${formatNumber(Math.abs(caloriesChange.percent))}%`}. Algoritmo, cobertura do dispositivo e atividade podem alterar esse valor. Confira essas condições; gastar mais calorias não comprova um treino melhor nem é uma meta por si só.`,
      evidence: `${formatNumber(caloriesChange.before)} → ${formatNumber(caloriesChange.after)} kcal/dia · ${daysEvidence(caloriesChange)}`
    });
  }
  return insights.sort((a, b) => b.priority - a.priority).slice(0, 4);
}
