import { createHash } from 'node:crypto';
import { CacheManager } from './cache.js';
import { buildHealthViewModel, DEFAULT_HEALTH_POLICY, healthLocalDate, type HealthSummaryInput, type HealthWorkoutInput } from '../../src/core/health/healthViewModel.js';
import { buildHealthPeriodSummary } from '../../src/core/health/healthPeriodSummary.js';
import { normalizeActivityValidationStatus, readActivityTimestamp } from '../../src/lib/workoutData.js';
import { normalizeHeartRateSamples } from '../../src/services/wearables/heartRateSamples.js';
import { readWorkoutHealthRecord } from '../../src/core/health/workoutHealthTypes.js';
import { buildWorkoutFeedback, WORKOUT_FEEDBACK_RULES } from '../../src/core/health/workoutFeedback.js';

export const HEALTH_REPORT_PROMPT_VERSION = 'health-report-v3';
const CACHE_TTL_SECONDS = 60 * 60;
const MAX_LOCAL_CACHE_KEYS = 64;
const MAX_IN_FLIGHT = 16;
const cacheKeys = new Map<string, number>();
const inFlight = new Map<string, Promise<HealthReportNarrative>>();
const DAY_MS = 86_400_000;
export const HEALTH_REPORT_WORKOUT_LIMIT = 500;

export interface HealthReportWorkoutInput extends HealthWorkoutInput {
  /** Internal scalar facts only; compactHealthReportContext aggregates these. */
  sessionEvidence?: {
    hasMarkedCompletedSet: boolean;
    sufficientSessionHeartRate: boolean;
    heartRatePending: boolean;
    incomplete: boolean;
  };
}

export function prepareHealthReportWorkouts(records: Array<Record<string, unknown>>, now: number): { workouts: HealthReportWorkoutInput[]; partial: boolean } {
  let partial = records.length > HEALTH_REPORT_WORKOUT_LIMIT;
  const workouts: HealthReportWorkoutInput[] = [];
  for (const item of records.slice(0, HEALTH_REPORT_WORKOUT_LIMIT)) {
    const timestamp = readActivityTimestamp(item.timestamp) ?? readActivityTimestamp(item.startTime) ?? readActivityTimestamp(item.createdAt);
    if (!timestamp) { partial = true; continue; }
    if (timestamp < now - 90 * DAY_MS || timestamp > now) continue;
    const validation = item.validation && typeof item.validation === 'object' ? item.validation as Record<string, unknown> : {};
    const telemetry = item.healthTelemetry && typeof item.healthTelemetry === 'object' ? item.healthTelemetry as Record<string, unknown> : {};
    const details = item.details && typeof item.details === 'object' ? item.details as Record<string, unknown> : {};
    const healthSession = readWorkoutHealthRecord(item.healthSession ?? details.healthSession);
    const sessionFeedback = healthSession ? buildWorkoutFeedback(healthSession, [], now) : null;
    const status = normalizeActivityValidationStatus(item.validationStatus ?? item.status ?? validation.status);
    const wearable = item.source === 'apple_health' || item.source === 'health_connect';
    const avgHeartRate = sessionFeedback?.session.averageBpm
      ?? Number(item.avgHeartRate ?? item.averageHeartRate ?? item.avgHr ?? telemetry.avgHeartRate);
    const hasTelemetry = normalizeHeartRateSamples(item.heartRateSamples).length > 0 || Number(item.steps) > 0 || avgHeartRate > 0
      || Number(item.maxHeartRate ?? item.maxHr ?? telemetry.maxHeartRate) > 0
      || Number(item.distance ?? item.distanceKm) > 0 || Number(item.calories ?? item.caloriesBurned) > 0;
    const healthOnly = wearable && status !== 'validated' && item.nonScoringReason !== 'DUPLICATE_ACTIVITY' && hasTelemetry;
    if (status !== 'validated' && !healthOnly) continue;
    const durationMinutes = Number(item.durationMinutes ?? item.duration ?? 0);
    const positive = (value: unknown) => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : undefined;
    workouts.push({
      // IDs stay inside deterministic deduplication. The compact provider
      // context contains no individual workout, ID or heart-rate sample array.
      id: typeof item.id === 'string' ? item.id : undefined,
      timestamp, durationMinutes: positive(durationMinutes) ?? 0,
      avgHeartRate: positive(avgHeartRate),
      distanceKm: positive(item.distanceKm ?? item.distance),
      workoutType: typeof item.cardioType === 'string' && item.cardioType ? item.cardioType
        : typeof item.workoutType === 'string' ? item.workoutType : typeof item.type === 'string' ? item.type : undefined,
      cardioType: typeof item.cardioType === 'string' ? item.cardioType : undefined,
      ...(healthSession && sessionFeedback && !sessionFeedback.insights.some(insight => insight.id === 'invalid-session') ? { sessionEvidence: {
        // Only completions accepted by the engine, never raw or planned sets.
        hasMarkedCompletedSet: sessionFeedback.insights.some(insight => insight.id === 'recorded-completion'
          || insight.id.startsWith('heart-rate:') || insight.id.startsWith('achievement:')),
        sufficientSessionHeartRate: sessionFeedback.session.averageBpm !== null,
        heartRatePending: healthSession.heartRate.status === 'pending',
        incomplete: healthSession.integrity?.status === 'partial' || (healthSession.integrity?.discardedSets ?? 0) > 0
          || (healthSession.integrity?.discardedHeartRateSamples ?? 0) > 0 || healthSession.heartRate.status === 'partial' || healthSession.heartRate.truncated
      } } : {})
    });
  }
  return { workouts, partial };
}

/** Only deterministic aggregate facts enter the provider; never names, IDs or raw arrays. */
export function compactHealthReportContext(input: {
  summary: HealthSummaryInput; workouts: HealthReportWorkoutInput[]; periodDays: 7 | 30 | 90;
  timeZone: string; now: number; trainingPartial: boolean;
}) {
  const view = buildHealthViewModel(input);
  const endDate = healthLocalDate(input.now, input.timeZone);
  const startDate = new Date(Date.parse(`${endDate}T12:00:00Z`) - (input.periodDays - 1) * DAY_MS).toISOString().slice(0, 10);
  const inPeriod = (timestamp: number | string, localDate?: string) => {
    const milliseconds = typeof timestamp === 'number' ? timestamp : Date.parse(timestamp);
    const date = localDate || healthLocalDate(timestamp, input.timeZone);
    return Number.isFinite(milliseconds) && milliseconds <= input.now && date >= startDate && date <= endDate;
  };
  const metrics = Object.entries(input.summary.trends).map(([metric, points]) => {
    const valid = (points || []).filter(point => Number.isFinite(point.value) && point.value >= 0 && inPeriod(point.timestamp, point.localDate))
      .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
    const partial = input.summary.metadata?.metrics?.[metric]?.partial === true
      || (input.summary.metadata?.partial === true && input.summary.metadata.metrics?.[metric]?.partial !== false);
    const latest = valid[valid.length - 1];
    if (!latest) return { metric, status: partial ? 'PARTIAL' : 'INSUFFICIENT_DATA', coverageDays: 0 };
    const units = [...new Set(valid.map(point => point.unit || 'unknown'))];
    // A mean cannot mix measurement units, even when a later point looks valid.
    if (units.length > 1) return { metric, status: 'UNRELIABLE', reason: 'Há unidades diferentes no período; não foi calculada uma média.' };
    const assessments = valid.flatMap(point => {
      const available = [point.confidenceAtMeasurement, point.currentEvidenceConfidence].filter(Boolean);
      return available.length ? available : [undefined];
    });
    const gradeRank = (grade?: string) => { const rank = ['A', 'B', 'C', 'D', 'E'].indexOf(grade || 'E'); return rank < 0 ? 4 : rank; };
    const worstRank = Math.max(...assessments.map(assessment => gradeRank(assessment?.confidenceLevel)));
    const confidence = assessments.find(assessment => gradeRank(assessment?.confidenceLevel) === worstRank);
    const confidenceVersion = (value: unknown) => value && typeof value === 'object' && 'confidenceEngineVersion' in value
      ? String(value.confidenceEngineVersion) : 'unversioned';
    const sources = [...new Set(valid.map(point => point.source || 'unknown'))].sort();
    const devices = [...new Set(valid.map(point => point.device || 'unknown'))].sort();
    const contexts = [...new Set(valid.map(point => point.measurementContext || 'unknown'))].sort();
    const origins = [...new Set(valid.map(point => point.provenance?.dataOrigin || 'unknown'))].sort();
    // The summary contract contains daily values. Defensive grouping keeps a
    // duplicated day from silently gaining extra weight in the period mean.
    const byDay = new Map(valid.map(point => [point.localDate || healthLocalDate(point.timestamp, input.timeZone), point]));
    const daily = [...byDay.values()];
    return {
      metric, status: partial ? 'PARTIAL' : worstRank >= 3 ? 'UNRELIABLE' : 'AVAILABLE',
      value: Number((daily.reduce((sum, point) => sum + point.value, 0) / daily.length).toFixed(3)),
      aggregation: 'mean_of_available_daily_values', latestValue: latest.value,
      unit: latest.unit, coverageDays: daily.length, requestedDays: input.periodDays,
      includesToday: byDay.has(endDate), missingDaysAreZero: false,
      comparableSourceAndContext: sources.length === 1 && devices.length === 1 && origins.length === 1 && contexts.length === 1,
      measuredAt: latest.timestamp, device: devices.length === 1 ? devices[0] : 'multiple', source: sources.length === 1 ? sources[0] : 'multiple',
      integration: latest.provenance?.integration, confidenceLevel: confidence?.confidenceLevel || 'E',
      confidenceScore: confidence?.confidenceScore ?? null,
      limitations: [...new Set(assessments.flatMap(assessment => assessment ? assessment.limitations || [] : ['Uma leitura do período não tem confiança classificada.']))].slice(0, 8),
      confidenceEngineVersions: [...new Set(assessments.map(confidenceVersion))].sort(),
      currentEvidenceVersions: [...new Set(valid.map(point => confidenceVersion(point.currentEvidenceConfidence)))].sort(),
      confidenceBasis: 'lowest_historical_or_current_daily_confidence',
      measurementContext: contexts.length === 1 ? contexts[0] : 'multiple'
    };
  });
  const periodTraining = buildHealthPeriodSummary(input.workouts, input.now, input.periodDays, input.timeZone, input.trainingPartial);
  const trainingPeriod = {
    status: input.trainingPartial ? 'PARTIAL' : periodTraining.sessionCount ? 'AVAILABLE' : 'INSUFFICIENT_DATA',
    sessions: periodTraining.sessionCount,
    recordedMinutes: periodTraining.activeMinutes === null ? null : Math.round(periodTraining.activeMinutes),
    durationCoveredSessions: periodTraining.coverage.durationSessions,
    activeDaysWithRecords: periodTraining.activeDays,
    averageHeartRate: periodTraining.averageHeartRate === null ? null : Number(periodTraining.averageHeartRate.toFixed(1)),
    heartRateCoveredSessions: periodTraining.coverage.heartRateSessions,
    heartRateMethod: 'MEAN_OF_AVAILABLE_SESSION_AVERAGES',
    missingRecordsMeanInactivity: false
  };
  const privateSessionEvidence = periodTraining.workouts.flatMap(workout => workout.sessionEvidence ? [workout.sessionEvidence] : []);
  const sufficientSessionHeartRate = privateSessionEvidence.filter(evidence => evidence.sufficientSessionHeartRate).length;
  const recordedSessionEvidence = {
    methodologyVersion: WORKOUT_FEEDBACK_RULES.version,
    sessionsWithPrivateRecord: privateSessionEvidence.length,
    sessionsWithMarkedCompletedSets: privateSessionEvidence.filter(evidence => evidence.hasMarkedCompletedSet).length,
    sessionsWithSufficientSessionHeartRate: sufficientSessionHeartRate,
    sessionsUsingLegacyHeartRateAverage: periodTraining.coverage.heartRateSessions - sufficientSessionHeartRate,
    sessionsAwaitingHeartRate: privateSessionEvidence.filter(evidence => evidence.heartRatePending).length,
    sessionsWithIncompletePrivateRecord: privateSessionEvidence.filter(evidence => evidence.incomplete).length,
    strengthProgressComparison: 'NOT_COMPUTED',
    notes: 'Séries são marcações informadas pelo usuário, não prova de execução ou técnica. A FC usa a média das leituras da sessão somente com cobertura suficiente; quando indisponível, preserva a média legada registrada pela fonte, sem confirmar a mesma cobertura. Não há atribuição de FC a exercício nem comparação de força neste agregado.'
  };
  const { points: _pairedDailyRecords, ...sleepActivity } = view.sleepActivity;
  return {
    period: { days: input.periodDays, startDate, endDate, timeZone: input.timeZone },
    partial: input.summary.metadata?.partial === true || input.trainingPartial,
    methodologyVersion: view.methodologyVersion,
    previousPeriodComparison: { status: 'NOT_AVAILABLE', reason: 'O contexto não compara este período com outro de mesma duração. Não afirmar melhora ou piora entre períodos.' },
    analysisWindows: {
      currentSignalsMaximumAgeHours: DEFAULT_HEALTH_POLICY.maximumAgeHours,
      personalBaselinePreviousDays: DEFAULT_HEALTH_POLICY.baselineWindowDays,
      personalBaselineMinimumDays: DEFAULT_HEALTH_POLICY.minimumBaselineDays,
      loadAndWeeklyReview: 'Últimos 7 dias corridos; referência de volume nas 3 semanas anteriores. Volume usa apenas sessões com duração registrada.',
      sleepActivity: 'Dias anteriores a hoje dentro da janela móvel selecionada, somente com sono e treino registrados.',
      dailyMeans: 'Média apenas dos dias com leitura; o dia de hoje pode estar incompleto.'
    },
    trainingPeriod, recordedSessionEvidence,
    metrics, baselines: view.baselines, recovery: view.recovery, readiness: view.readiness,
    load: view.load, sleepActivity, weeklyReview: view.weeklyReview, limitations: view.limitations
  };
}

export interface HealthReportNarrative {
  answer: string;
  generatedAt: string;
}

/** Hash only meaningful facts. Assessment/generation times change on a read. */
export function canonicalHealthContext(value: unknown): string {
  const normalize = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(normalize);
    if (!input || typeof input !== 'object') return input;
    return Object.fromEntries(Object.entries(input as Record<string, unknown>)
      .filter(([key, item]) => item !== undefined && !['assessedAt', 'generatedAt'].includes(key))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, normalize(item)]));
  };
  return JSON.stringify(normalize(value));
}

export function healthContextHash(context: unknown): string {
  return createHash('sha256').update(canonicalHealthContext(context)).digest('hex');
}

export function parseHealthReportDays(value: unknown): 7 | 30 | 90 | null {
  if (value === undefined) return 30;
  const days = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
  return days === 7 || days === 30 || days === 90 ? days : null;
}

export function parseHealthReportTimeZone(value: unknown): string | null {
  if (value === undefined) return 'UTC';
  if (typeof value !== 'string' || value.length > 80) return null;
  try {
    return new Intl.DateTimeFormat('en', { timeZone: value }).resolvedOptions().timeZone;
  } catch { return null; }
}

export async function getHealthReportNarrative(input: {
  userId: string;
  context: unknown;
  model: string;
  cacheable: boolean;
  generate: (canonicalContext: string) => Promise<string>;
}): Promise<HealthReportNarrative & { contextHash: string; cacheHit: boolean }> {
  const canonicalContext = canonicalHealthContext(input.context);
  const contextHash = healthContextHash(input.context);
  // The UID scopes the cache, but does not become provider prompt content or a log key.
  const scopedHash = healthContextHash({ userId: input.userId, contextHash, model: input.model, promptVersion: HEALTH_REPORT_PROMPT_VERSION });
  const key = `health-report:${scopedHash}`;
  const now = Date.now();
  for (const [expiredKey, expiresAt] of cacheKeys) {
    if (expiresAt <= now) {
      cacheKeys.delete(expiredKey);
      await CacheManager.delete(expiredKey);
    }
  }
  if (input.cacheable) {
    const cached = await CacheManager.get<HealthReportNarrative>(key);
    if (cached) return { ...cached, contextHash, cacheHit: true };
  }
  const running = inFlight.get(key);
  if (running) return { ...await running, contextHash, cacheHit: true };
  if (inFlight.size >= MAX_IN_FLIGHT) {
    throw Object.assign(new Error('Análises de saúde ocupadas. Tente novamente em instantes.'), { statusCode: 503, code: 'HEALTH_AI_BUSY' });
  }
  const pending = (async () => {
    const answer = await input.generate(canonicalContext);
    if (!answer.trim()) throw new Error('A análise não retornou texto.');
    const result = { answer, generatedAt: new Date().toISOString() };
    if (input.cacheable) {
      const evictedKeys: string[] = [];
      while (cacheKeys.size >= MAX_LOCAL_CACHE_KEYS) {
        const oldest = cacheKeys.keys().next().value;
        if (!oldest) break;
        cacheKeys.delete(oldest);
        evictedKeys.push(oldest);
      }
      cacheKeys.set(key, Date.now() + CACHE_TTL_SECONDS * 1000);
      await Promise.all(evictedKeys.map(expiredKey => CacheManager.delete(expiredKey)));
      await CacheManager.set(key, result, CACHE_TTL_SECONDS);
    }
    return result;
  })();
  inFlight.set(key, pending);
  try { return { ...await pending, contextHash, cacheHit: false }; }
  finally { inFlight.delete(key); }
}
