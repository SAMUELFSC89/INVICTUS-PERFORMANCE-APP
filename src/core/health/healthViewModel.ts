/** Shared, deterministic health interpretation. No IO, Gemini or competition.
 * Thresholds describe deviation from recorded personal history, not clinical
 * ranges or clearance to exercise. Keep changes versioned and explainable.
 */
export const HEALTH_METHODOLOGY_VERSION = 'invictus-health-2.0.0';
export type HealthGrade = 'A' | 'B' | 'C' | 'D' | 'E';
export type BaselineMetric = 'heart_rate_resting' | 'hrv_rmssd' | 'hrv_sdnn' | 'sleep_duration_min';
export interface HealthPoint {
  value: number;
  timestamp: string;
  unit?: string;
  source?: string;
  device?: string;
  localDate?: string;
  measurementContext?: string;
  provenance?: { dataOrigin?: string; deviceModel?: string; integration?: string };
  confidenceAtMeasurement?: { confidenceLevel: HealthGrade; confidenceScore?: number; limitations?: string[] };
  currentEvidenceConfidence?: { confidenceLevel: HealthGrade; confidenceScore?: number; limitations?: string[] };
}
export interface HealthSummaryInput {
  windowDays: number;
  latest: Partial<Record<BaselineMetric | 'steps_daily', HealthPoint | null>>;
  trends: Partial<Record<BaselineMetric | 'steps_daily', HealthPoint[]>>;
  metadata?: { partial?: boolean; metrics?: Record<string, { partial?: boolean }> };
}
export interface HealthWorkoutInput {
  id?: string;
  timestamp: number;
  durationMinutes: number;
  avgHeartRate?: number;
  distanceKm?: number;
  workoutType?: string;
  cardioType?: string;
  rpe?: number;
}
export const DEFAULT_HEALTH_POLICY = {
  baselineWindowDays: 28,
  minimumBaselineDays: 7,
  maximumAgeHours: 36,
  minimumComparativeSessions: 3,
  minimumSleepPairs: 10,
  minimumSleepGroup: 4,
  relativeDeviation: 0.1,
  madMultiplier: 2,
  minimumWeeklyReferenceWeeks: 3,
  minimumWeeklyReferenceSessions: 6
} as const;
export type HealthPolicy = { [K in keyof typeof DEFAULT_HEALTH_POLICY]: number };
export interface PersonalBaseline {
  metric: BaselineMetric;
  label: string;
  unit: string;
  status: 'READY' | 'INSUFFICIENT_BASELINE' | 'STALE' | 'UNRELIABLE' | 'PARTIAL';
  value: number | null;
  latest: number | null;
  delta: number | null;
  percentDelta: number | null;
  direction: 'above' | 'within' | 'below' | null;
  baselineDays: number;
  requiredDays: number;
  measuredAt: string | null;
  source: string | null;
  confidenceLevel: HealthGrade;
  reason: string;
}
export interface HealthInterpretation {
  status: 'ABOVE_BASELINE' | 'WITHIN_BASELINE' | 'BELOW_BASELINE' | 'INSUFFICIENT_DATA';
  label: string;
  description: string;
  factors: string[];
  confidenceLevel: HealthGrade;
}
export interface RecordedTrainingLoad {
  status: 'AVAILABLE' | 'INSUFFICIENT_BASELINE' | 'PARTIAL';
  method: 'RECORDED_DURATION';
  label: string;
  sessions7d: number;
  minutes7d: number;
  baselineWeeklyMinutes: number | null;
  ratio: number | null;
  referenceWeeks: number;
  /** Received sessions in the comparison window have no usable duration. */
  incompleteDuration?: boolean;
  description: string;
}
export interface WeeklyReview {
  title: string;
  status: 'AVAILABLE' | 'PARTIAL' | 'INSUFFICIENT_DATA';
  highlights: Array<{ id: string; title: string; detail: string }>;
  nextSteps: string[];
}
export interface SleepActivityRelationship {
  status: 'AVAILABLE' | 'INSUFFICIENT_DATA' | 'PARTIAL';
  /** Observed daily pairs, exposed only after coverage checks pass. */
  points?: Array<{ sleepMinutes: number; activeMinutes: number }>;
  pairs: number;
  aboveBaselineDays: number;
  belowBaselineDays: number;
  baselineSleepMinutes: number | null;
  activityDifferencePercent: number | null;
  description: string;
}
export interface HealthViewModel {
  methodologyVersion: string;
  periodDays: number;
  timeZone: string;
  baselines: Record<BaselineMetric, PersonalBaseline>;
  recovery: HealthInterpretation;
  readiness: HealthInterpretation;
  load: RecordedTrainingLoad;
  sleepActivity: SleepActivityRelationship;
  weeklyReview: WeeklyReview;
  limitations: string[];
}
const DAY = 86400000;
const METRICS: BaselineMetric[] = ['heart_rate_resting', 'hrv_rmssd', 'hrv_sdnn', 'sleep_duration_min'];
const LABELS: Record<BaselineMetric, string> = { heart_rate_resting: 'FC em repouso', hrv_rmssd: 'HRV · RMSSD', hrv_sdnn: 'HRV · SDNN', sleep_duration_min: 'Sono' };
const UNITS: Record<BaselineMetric, string> = { heart_rate_resting: 'bpm', hrv_rmssd: 'ms', hrv_sdnn: 'ms', sleep_duration_min: 'min' };
export function healthLocalDate(timestamp: number | string, timeZone = 'UTC'): string {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return '';
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
    const part = (type: string) => parts.find(p => p.type === type)?.value || '';
    return `${part('year')}-${part('month')}-${part('day')}`;
  } catch { return date.toISOString().slice(0, 10); }
}
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const i = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[i] : (sorted[i - 1] + sorted[i]) / 2;
}
function weakest(grades: HealthGrade[]): HealthGrade {
  return grades.length ? grades.reduce((a, b) => 'ABCDE'.indexOf(a) > 'ABCDE'.indexOf(b) ? a : b) : 'E';
}
function grade(point: HealthPoint): HealthGrade {
  const values = [point.confidenceAtMeasurement?.confidenceLevel, point.currentEvidenceConfidence?.confidenceLevel].filter((v): v is HealthGrade => Boolean(v));
  return weakest(values);
}
function sourceKey(point: HealthPoint): string {
  return [point.source || 'unknown', point.provenance?.dataOrigin || '', point.provenance?.deviceModel || point.device || '', point.measurementContext || ''].join('|');
}
function validPoints(points: HealthPoint[], now: number): HealthPoint[] {
  return points.filter(p => Number.isFinite(p.value) && p.value > 0 && Number.isFinite(Date.parse(p.timestamp)) && Date.parse(p.timestamp) <= now)
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
}
function isMetricPartial(summary: HealthSummaryInput | null, metric: string): boolean {
  const specific = summary?.metadata?.metrics?.[metric]?.partial;
  return specific === true || (summary?.metadata?.partial === true && specific !== false);
}
function baseline(metric: BaselineMetric, summary: HealthSummaryInput | null, now: number, timeZone: string, policy: HealthPolicy): PersonalBaseline {
  const latest = summary?.latest[metric];
  const result: PersonalBaseline = { metric, label: LABELS[metric], unit: UNITS[metric], status: 'INSUFFICIENT_BASELINE', value: null, latest: null, delta: null,
    percentDelta: null, direction: null, baselineDays: 0, requiredDays: policy.minimumBaselineDays, measuredAt: latest?.timestamp || null,
    source: latest ? sourceKey(latest) : null, confidenceLevel: latest ? grade(latest) : 'E', reason: 'Ainda não há uma leitura válida deste sinal. Confira se ela aparece na fonte de saúde usada pelo app e atualize a sincronização.' };
  if (!latest || !Number.isFinite(latest.value) || latest.value <= 0) return result;
  result.latest = latest.value;
  if (latest.unit && latest.unit !== result.unit) return { ...result, status: 'UNRELIABLE', confidenceLevel: 'E', reason: 'A unidade recebida não permite esta comparação. Confira a origem e a unidade da leitura no relatório.' };
  const latestMs = Date.parse(latest.timestamp);
  if (!Number.isFinite(latestMs) || latestMs > now || now - latestMs > policy.maximumAgeHours * 3600000) {
    return { ...result, status: 'STALE', reason: !Number.isFinite(latestMs) || latestMs > now
      ? 'A data da última leitura não permite usá-la hoje. Confira a data e a hora na fonte de saúde e sincronize novamente.'
      : 'A última leitura está antiga para descrever seu estado de hoje. Confira se há uma leitura mais recente na fonte de saúde e atualize a sincronização.' };
  }
  if (isMetricPartial(summary, metric)) {
    return { ...result, status: 'PARTIAL', reason: 'Parte do histórico ainda não foi recebida. Atualize a sincronização e confira se os dias que faltam aparecem antes de comparar.' };
  }
  const currentDay = latest.localDate || healthLocalDate(latest.timestamp, timeZone);
  const byDay = new Map<string, HealthPoint[]>();
  for (const p of validPoints(summary?.trends[metric] || [], now)) {
    if (sourceKey(p) !== sourceKey(latest) || (p.unit && p.unit !== result.unit)) continue;
    const day = p.localDate || healthLocalDate(p.timestamp, timeZone);
    if (day >= currentDay || Date.parse(p.timestamp) < latestMs - policy.baselineWindowDays * DAY || 'ABCDE'.indexOf(grade(p)) > 2) continue;
    byDay.set(day, [...(byDay.get(day) || []), p]);
  }
  const values = [...byDay.values()].map(points => median(points.map(p => p.value)));
  result.baselineDays = values.length;
  result.reason = `Sua referência tem ${values.length} de ${policy.minimumBaselineDays} dias comparáveis necessários. Mantenha as leituras da mesma fonte e método sincronizadas para completar esse histórico.`;
  if (values.length < policy.minimumBaselineDays) return result;
  const reference = median(values);
  const mad = median(values.map(v => Math.abs(v - reference)));
  const threshold = Math.max(reference * policy.relativeDeviation, mad * policy.madMultiplier);
  result.value = reference;
  result.delta = latest.value - reference;
  result.percentDelta = 100 * result.delta / reference;
  result.direction = Math.abs(result.delta) <= threshold ? 'within' : result.delta > 0 ? 'above' : 'below';
  result.confidenceLevel = weakest([grade(latest), ...[...byDay.values()].flat().map(grade)]);
  if ('ABCDE'.indexOf(result.confidenceLevel) > 2) return { ...result, status: 'UNRELIABLE', reason: 'A qualidade disponível permite consultar o valor, mas ainda não compará-lo com segurança. Confira a origem e as limitações da leitura no relatório.' };
  return { ...result, status: 'READY', reason: `Comparação com a mediana de ${values.length} dias anteriores da mesma origem e método. A faixa é uma regra descritiva do app.` };
}
function usableWorkouts(workouts: readonly HealthWorkoutInput[], now: number): HealthWorkoutInput[] {
  const ids = new Set<string>();
  return workouts.filter(w => {
    if (!Number.isFinite(w.timestamp) || w.timestamp > now || !Number.isFinite(w.durationMinutes) || w.durationMinutes <= 0) return false;
    if (w.id && ids.has(w.id)) return false;
    if (w.id) ids.add(w.id);
    return true;
  });
}
function workoutsWithoutDuration(workouts: readonly HealthWorkoutInput[], usable: readonly HealthWorkoutInput[], now: number): HealthWorkoutInput[] {
  const ids = new Set(usable.map(w => w.id).filter((id): id is string => Boolean(id)));
  return workouts.filter(w => {
    if (!Number.isFinite(w.timestamp) || w.timestamp > now || (Number.isFinite(w.durationMinutes) && w.durationMinutes > 0)) return false;
    if (w.id && ids.has(w.id)) return false;
    if (w.id) ids.add(w.id);
    return true;
  });
}
function trainingLoad(workouts: HealthWorkoutInput[], now: number, partial: boolean, policy: HealthPolicy, missingDuration: HealthWorkoutInput[]): RecordedTrainingLoad {
  const current = workouts.filter(w => now - w.timestamp < 7 * DAY);
  const incomplete = missingDuration.filter(w => now - w.timestamp < 28 * DAY);
  const result: RecordedTrainingLoad = { status: partial || incomplete.length ? 'PARTIAL' : 'INSUFFICIENT_BASELINE', method: 'RECORDED_DURATION', label: 'Volume registrado', sessions7d: current.length + incomplete.filter(w => now - w.timestamp < 7 * DAY).length,
    minutes7d: Math.round(current.reduce((n, w) => n + w.durationMinutes, 0)), baselineWeeklyMinutes: null, ratio: null, referenceWeeks: 0,
    description: `Os totais mostram a duração e a frequência recebidas nos últimos 7 dias. A comparação precisa de registros em ${policy.minimumWeeklyReferenceWeeks} semanas anteriores e pelo menos ${policy.minimumWeeklyReferenceSessions} sessões nesse histórico.` };
  if (incomplete.length) return { ...result, incompleteDuration: true, description: `Falta duração em sessões recebidas nos últimos 28 dias. Os minutos somam apenas as sessões com duração válida; confira e complete esses registros na origem para comparar semanas.${partial ? ' O histórico recebido também está parcial; atualize a sincronização.' : ''}` };
  if (partial) return { ...result, description: 'Os totais incluem apenas os treinos recebidos até agora. Atualize a sincronização para completar o histórico antes de comparar semanas.' };
  const previous = workouts.filter(w => now - w.timestamp >= 7 * DAY && now - w.timestamp < 28 * DAY);
  const weeks = [0, 0, 0];
  previous.forEach(w => { const week = Math.floor((now - w.timestamp) / (7 * DAY)) - 1; weeks[week] += w.durationMinutes; });
  result.referenceWeeks = weeks.filter(v => v > 0).length;
  if (previous.length < policy.minimumWeeklyReferenceSessions || result.referenceWeeks < policy.minimumWeeklyReferenceWeeks) return result;
  const reference = weeks.reduce((n, v) => n + v, 0) / 3;
  const ratio = result.minutes7d / reference;
  return { ...result, status: 'AVAILABLE', baselineWeeklyMinutes: Math.round(reference), ratio,
    label: ratio > 1.2 ? 'Volume acima do padrão' : ratio < 0.8 ? 'Volume abaixo do padrão' : 'Volume no padrão',
    description: `${result.minutes7d} min registrados nos últimos 7 dias; sua média nas 3 semanas anteriores foi de ${Math.round(reference)} min por semana. Esta comparação usa a duração dos treinos.` };
}
function formattedValue(value: number): string {
  return value.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
}
function signalComparison(b: PersonalBaseline): string {
  const position = b.direction === 'within' ? 'na faixa do seu padrão' : b.direction === 'above' ? 'acima do seu padrão' : 'abaixo do seu padrão';
  return `${b.label}: ${formattedValue(b.latest!)} ${b.unit}, ${position} (referência de ${formattedValue(b.value!)} ${b.unit}).`;
}
function interpretRecovery(baselines: Record<BaselineMetric, PersonalBaseline>): HealthInterpretation {
  const hrv = [baselines.hrv_rmssd, baselines.hrv_sdnn].filter(b => b.status === 'READY').sort((a, b) => Date.parse(b.measuredAt!) - Date.parse(a.measuredAt!))[0];
  const usable = [baselines.heart_rate_resting, hrv, baselines.sleep_duration_min].filter((b): b is PersonalBaseline => Boolean(b && b.status === 'READY'));
  const factors = usable.map(signalComparison);
  if (usable.length < 2) return { status: 'INSUFFICIENT_DATA', label: 'Dados insuficientes', description: 'A leitura de hoje precisa de pelo menos dois sinais entre FC em repouso, HRV e sono, com dados recentes e referência pessoal formada.', factors, confidenceLevel: 'E' };
  const adverse = usable.filter(b => b.metric === 'heart_rate_resting' ? b.direction === 'above' : b.direction === 'below').length;
  const favorable = usable.filter(b => b.metric === 'heart_rate_resting' ? b.direction === 'below' : b.metric.startsWith('hrv_') && b.direction === 'above').length;
  const confidenceLevel = weakest(usable.map(b => b.confidenceLevel));
  if (adverse > 0) return { status: 'BELOW_BASELINE', label: 'Sinais abaixo do padrão', description: 'Um ou mais sinais se afastaram do seu padrão pessoal. Compare os valores abaixo com sua percepção de hoje e acompanhe as próximas leituras.', factors, confidenceLevel };
  if (favorable >= 2) return { status: 'ABOVE_BASELINE', label: 'Sinais acima do padrão', description: 'Dois sinais variaram em direção favorável em relação ao seu histórico. Observe se essa mudança se mantém nas próximas leituras.', factors, confidenceLevel };
  return { status: 'WITHIN_BASELINE', label: 'Sinais no padrão', description: 'Entre os sinais disponíveis, não há FC em repouso acima do padrão nem HRV ou sono abaixo dele. Confira os valores e como você se sente hoje.', factors, confidenceLevel };
}
function reviewNextSteps(baselines: Record<BaselineMetric, PersonalBaseline>, recovery: HealthInterpretation, load: RecordedTrainingLoad, policy: HealthPolicy): string[] {
  // HRV methods describe one signal. Prefer a usable method; otherwise explain
  // the method with the most recent reading instead of requesting both.
  const hrv = [baselines.hrv_rmssd, baselines.hrv_sdnn].sort((a, b) =>
    Number(b.status === 'READY') - Number(a.status === 'READY') ||
    (Date.parse(b.measuredAt || '') || 0) - (Date.parse(a.measuredAt || '') || 0))[0];
  const signals = [baselines.heart_rate_resting, hrv, baselines.sleep_duration_min];
  const nextSteps: string[] = [];
  const unavailable = signals.filter(b => b.status !== 'READY' &&
    (recovery.status === 'INSUFFICIENT_DATA' || b.status === 'PARTIAL'));
  for (const b of unavailable.filter(b => b.latest !== null).slice(0, 2)) nextSteps.push(`${b.label}: ${b.reason}`);
  const missing = unavailable.filter(b => b.latest === null);
  if (missing.length) nextSteps.push(`Ainda faltam leituras de ${missing.map(b => b.metric.startsWith('hrv_') ? 'HRV' : b.label).join(', ')}. Confira se esses dados aparecem na fonte de saúde usada pelo app e atualize a sincronização.`);
  for (const b of signals.filter(b => b.status === 'READY' && (b.metric === 'heart_rate_resting' ? b.direction === 'above' : b.direction === 'below')).slice(0, 2)) {
    nextSteps.push(`${signalComparison(b)} Compare esse sinal com sua percepção de hoje e confira se o desvio se repete na próxima leitura.`);
  }
  if (load.incompleteDuration) nextSteps.unshift('Falta duração em sessões recebidas. Confira os treinos dos últimos 28 dias e complete a duração no registro de origem; depois atualize esses dados no app.');
  else if (load.status === 'PARTIAL') nextSteps.push('O histórico de treinos chegou incompleto. Atualize a sincronização e confira se as sessões já realizadas aparecem antes de comparar semanas.');
  else if (load.status === 'INSUFFICIENT_BASELINE') nextSteps.push(`Confira se os treinos já realizados foram sincronizados e registre as próximas sessões. A referência precisa de ${policy.minimumWeeklyReferenceWeeks} semanas anteriores com registros e pelo menos ${policy.minimumWeeklyReferenceSessions} sessões nesse histórico.`);
  else if (load.ratio !== null && (load.ratio > 1.2 || load.ratio < 0.8)) nextSteps.push(`Você registrou ${load.minutes7d} min nos últimos 7 dias, frente à média de ${load.baselineWeeklyMinutes} min. Confira se todas as sessões aparecem e se a diferença corresponde ao que você fez na semana.`);
  if (!nextSteps.length) nextSteps.push('O tempo de treino está no seu padrão e os sinais disponíveis não mostram desvio desfavorável. Confira a próxima leitura e use sua percepção de hoje para dar contexto a esses dados.');
  return nextSteps.slice(0, 4);
}
function sleepRelationship(summary: HealthSummaryInput | null, workouts: HealthWorkoutInput[], now: number, periodDays: number, timeZone: string, policy: HealthPolicy, partial: boolean, incompleteDuration: boolean): SleepActivityRelationship {
  const empty: SleepActivityRelationship = { status: partial ? 'PARTIAL' : 'INSUFFICIENT_DATA', pairs: 0, aboveBaselineDays: 0, belowBaselineDays: 0, baselineSleepMinutes: null, activityDifferencePercent: null,
    description: `Ainda faltam dias com sono e treino registrados na mesma data. Confira o histórico de sono e sincronize as sessões; a comparação precisa de pelo menos ${policy.minimumSleepPairs} dias comparáveis.` };
  if (incompleteDuration) return { ...empty, status: 'PARTIAL', description: `Falta duração em sessões recebidas no período de ${periodDays} dias. Confira e complete esses registros na origem para relacionar o sono ao tempo de treino.${partial ? ' Parte do histórico também ainda não foi recebida; atualize a sincronização.' : ''}` };
  if (partial) return { ...empty, description: 'Parte do histórico de sono ou de treinos ainda não foi recebida. Atualize a sincronização antes de comparar esses registros.' };
  if (periodDays < policy.minimumSleepPairs) empty.description = `Selecione um período maior: esta comparação precisa de pelo menos ${policy.minimumSleepPairs} dias com sono e treino registrados na mesma data.`;
  const sleepDays = new Map<string, number[]>();
  const points = validPoints(summary?.trends.sleep_duration_min || [], now).filter(p => (!p.unit || p.unit === 'min') && now - Date.parse(p.timestamp) <= periodDays * DAY && 'ABCDE'.indexOf(grade(p)) <= 2);
  const latest = summary?.latest.sleep_duration_min || points[points.length - 1];
  if (!latest) return empty;
  const today = healthLocalDate(now, timeZone);
  for (const p of points) {
    if (sourceKey(p) !== sourceKey(latest)) continue;
    const day = p.localDate || healthLocalDate(p.timestamp, timeZone);
    if (day >= today) continue;
    sleepDays.set(day, [...(sleepDays.get(day) || []), p.value]);
  }
  const trainingDays = new Map<string, number>();
  for (const w of workouts.filter(w => now - w.timestamp <= periodDays * DAY)) {
    const day = healthLocalDate(w.timestamp, timeZone);
    if (day >= today) continue;
    trainingDays.set(day, (trainingDays.get(day) || 0) + w.durationMinutes);
  }
  const paired = [...sleepDays].filter(([day]) => trainingDays.has(day)).map(([day, values]) => ({ sleep: median(values), minutes: trainingDays.get(day)! }));
  empty.pairs = paired.length;
  if (paired.length < policy.minimumSleepPairs) return { ...empty, description: periodDays < policy.minimumSleepPairs ? empty.description
    : `Há ${paired.length} de ${policy.minimumSleepPairs} dias comparáveis necessários nos últimos ${periodDays} dias. Confira se o sono e os treinos já registrados foram sincronizados; ambos precisam aparecer na mesma data.` };
  const reference = median(paired.map(p => p.sleep));
  const above = paired.filter(p => p.sleep >= reference);
  const below = paired.filter(p => p.sleep < reference);
  Object.assign(empty, { baselineSleepMinutes: reference, aboveBaselineDays: above.length, belowBaselineDays: below.length });
  if (above.length < policy.minimumSleepGroup || below.length < policy.minimumSleepGroup) return { ...empty, description: `Há ${paired.length} dias com sono e treino registrados, mas ainda faltam dias nos dois grupos de sono. A comparação precisa de pelo menos ${policy.minimumSleepGroup} dias a partir da sua mediana de sono e ${policy.minimumSleepGroup} abaixo dela.` };
  const avg = (ps: typeof paired) => ps.reduce((n, p) => n + p.minutes, 0) / ps.length;
  const difference = 100 * (avg(above) - avg(below)) / avg(below);
  return { ...empty, status: 'AVAILABLE', activityDifferencePercent: difference,
    points: paired.map(p => ({ sleepMinutes: p.sleep, activeMinutes: p.minutes })),
    description: `Nos ${above.length} dias com sono a partir da mediana pessoal (${Math.round(reference)} min), o tempo de treino registrado foi ${Math.abs(Math.round(difference))}% ${difference >= 0 ? 'maior' : 'menor'} que nos ${below.length} dias abaixo dela. São dias com treino registrado, não prova de desempenho melhor ou de causalidade.` };
}
export function buildHealthViewModel(input: { summary: HealthSummaryInput | null; workouts?: readonly HealthWorkoutInput[]; now?: number; timeZone?: string; periodDays?: number; trainingPartial?: boolean; policy?: Partial<HealthPolicy> }): HealthViewModel {
  const now = input.now ?? Date.now();
  const timeZone = input.timeZone || 'UTC';
  const periodDays = input.periodDays ?? input.summary?.windowDays ?? 30;
  const policy: HealthPolicy = { ...DEFAULT_HEALTH_POLICY, ...input.policy };
  const workouts = usableWorkouts(input.workouts || [], now);
  const missingDuration = workoutsWithoutDuration(input.workouts || [], workouts, now);
  const baselines = Object.fromEntries(METRICS.map(metric => [metric, baseline(metric, input.summary, now, timeZone, policy)])) as Record<BaselineMetric, PersonalBaseline>;
  const recovery = interpretRecovery(baselines);
  const load = trainingLoad(workouts, now, Boolean(input.trainingPartial), policy, missingDuration);
  const readiness: HealthInterpretation = recovery.status === 'INSUFFICIENT_DATA' || load.status !== 'AVAILABLE'
    ? { status: 'INSUFFICIENT_DATA', label: 'Dados insuficientes', description: recovery.status === 'INSUFFICIENT_DATA'
      ? 'Precisamos completar a referência de pelo menos dois sinais recentes para relacionar seu estado de hoje aos treinos.'
      : load.incompleteDuration ? 'Já temos sinais do seu corpo, mas falta duração em sessões recebidas para comparar o volume desta semana.'
      : 'Já temos sinais do seu corpo, mas o histórico de treinos ainda não permite comparar o volume desta semana.', factors: [...recovery.factors, load.description], confidenceLevel: 'E' }
    : { ...recovery, status: recovery.status === 'BELOW_BASELINE' || (load.ratio ?? 0) > 1.2 ? 'BELOW_BASELINE' : recovery.status,
      label: recovery.status === 'BELOW_BASELINE' || (load.ratio ?? 0) > 1.2 ? 'Contexto pede atenção' : 'Contexto no padrão',
      description: 'Leitura descritiva de sinais e volume registrado. Sua percepção e orientação profissional continuam necessárias para decidir a sessão.', factors: [...recovery.factors, load.description] };
  const sleepDurationIncomplete = missingDuration.some(w => now - w.timestamp <= periodDays * DAY && healthLocalDate(w.timestamp, timeZone) < healthLocalDate(now, timeZone));
  const sleepActivity = sleepRelationship(input.summary, workouts, now, periodDays, timeZone, policy, Boolean(input.trainingPartial || isMetricPartial(input.summary, 'sleep_duration_min')), sleepDurationIncomplete);
  const highlights: WeeklyReview['highlights'] = [];
  if (load.sessions7d || load.status === 'AVAILABLE') highlights.push({ id: 'weekly-training', title: 'Últimos 7 dias · Treinos', detail: `${load.sessions7d} sessões recebidas nos últimos 7 dias; ${load.minutes7d} minutos somados das sessões com duração válida.${load.incompleteDuration ? ' Há registros sem duração na janela de comparação.' : ''}${input.trainingPartial ? ' Totais parciais: há sessões ainda não recebidas.' : ''}` });
  if (load.status === 'AVAILABLE') highlights.push({ id: 'weekly-volume', title: `Últimos 7 dias · ${load.label}`, detail: load.description });
  if (recovery.status !== 'INSUFFICIENT_DATA') highlights.push({ id: 'body-signals', title: `Leitura de hoje · ${recovery.label}`, detail: recovery.factors.join(' ') });
  if (sleepActivity.status === 'AVAILABLE') highlights.push({ id: 'sleep-activity', title: `Últimos ${periodDays} dias · Sono × treinos`, detail: sleepActivity.description });
  const nextSteps = reviewNextSteps(baselines, recovery, load, policy);
  if (sleepDurationIncomplete && !load.incompleteDuration) nextSteps.unshift(`Falta duração em sessões no período de ${periodDays} dias. Complete os registros na origem para comparar sono e tempo de treino.`);
  const reviewPartial = Boolean(input.trainingPartial || load.incompleteDuration || sleepDurationIncomplete || input.summary?.metadata?.partial || METRICS.some(metric => isMetricPartial(input.summary, metric)));
  return { methodologyVersion: HEALTH_METHODOLOGY_VERSION, periodDays, timeZone, baselines, recovery, readiness, load, sleepActivity,
    weeklyReview: { title: 'Sua semana em contexto', status: reviewPartial ? 'PARTIAL' : highlights.length ? 'AVAILABLE' : 'INSUFFICIENT_DATA', highlights, nextSteps: nextSteps.slice(0, 4) },
    limitations: ['Análise descritiva dos registros disponíveis, não diagnóstico nem autorização para treinar.', 'Ausência de registro não prova ausência de atividade.', 'Volume por duração não equivale a carga fisiológica nem a volume de força executado.', 'A metodologia e seus limiares são regras configuráveis de produto, sem validação clínica declarada.'] };
}
