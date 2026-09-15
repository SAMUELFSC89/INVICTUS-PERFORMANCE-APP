import { VercelRequest, VercelResponse } from '@vercel/node';
import { cors, db, verifyAuth } from '../_lib/common.js';
import { lerSerieTemporalMetricaComLimite, HealthMetricType, HealthSample, deduplicateHealthSamples, persistirAmostraSaude } from '../_lib/health-data-layer.js';
import { aggregateDailyHealthSamples, healthSampleLocalDate } from '../_lib/health-source-priority.js';
import { buildConsolidatedDailyActiveCalories } from '../_lib/daily-active-energy.js';

const METRICAS_RESUMO: HealthMetricType[] = [
  'heart_rate', 'heart_rate_resting', 'hrv_rmssd', 'hrv_sdnn', 'sleep_duration_min', 'steps_daily', 'weight_kg',
  'calories_active', 'distance_km', 'respiratory_rate', 'oxygen_saturation', 'vo2max_estimate',
  'blood_pressure_systolic', 'blood_pressure_diastolic', 'body_fat_percent', 'hydration_l'
];
const METRICAS_TENDENCIA: HealthMetricType[] = [
  ...METRICAS_RESUMO, 'calories_total', 'calories_basal', 'distance_cycling_km', 'duration_min',
  'exercise_duration_min', 'stand_hours', 'mindfulness_duration_min'
];
const DAY_MS = 24 * 60 * 60 * 1000;
const LIMIT_PER_METRIC = 1000;
const STEP_METRICS = new Set<HealthMetricType>(['steps_daily', 'steps_activity']);

type SummaryPoint = Pick<HealthSample, 'value' | 'unit' | 'timestamp' | 'startDate' | 'endDate' | 'sampleId' | 'source' | 'device' | 'provenance' | 'confidenceAtMeasurement' | 'currentEvidenceConfidence' | 'measurementContext' | 'localDate' | 'timeZone' | 'sampleCount' | 'aggregationMethod' | 'derivedFrom' | 'sourceConfidence' | 'normalizationVersion' | 'normalizationCorrection' | 'revision'>;
export interface HealthSummaryResult {
  windowDays: number;
  latest: Partial<Record<HealthMetricType, SummaryPoint | null>>;
  trends: Partial<Record<HealthMetricType, SummaryPoint[]>>;
  metadata: {
    partial: boolean;
    aggregation: 'daily';
    timeZone: string;
    generatedAt: string;
    metrics: Partial<Record<HealthMetricType, { partial: boolean; scannedCount: number; limit: number; excludedLegacyCount: number; unusableLegacyCount: number; error?: boolean }>>;
  };
}

type ManualSleepCheckin = {
  localDate: string;
  timeZone: string;
  bedtime: string;
  wakeTime: string;
  sleepLatencyMinutes: number;
  awakenings: number;
  quality: number;
  restedness: number;
  sleepDurationMinutes: number;
  sleepStart: string;
  sleepEnd: string;
  source: 'invictus_manual';
  updatedAt: string;
};

function point(sample: HealthSample): SummaryPoint {
  return {
    value: sample.value, unit: sample.unit, timestamp: sample.timestamp,
    startDate: sample.startDate, endDate: sample.endDate, sampleId: sample.sampleId,
    source: sample.source, device: sample.device, provenance: sample.provenance,
    confidenceAtMeasurement: sample.confidenceAtMeasurement, currentEvidenceConfidence: sample.currentEvidenceConfidence,
    measurementContext: sample.measurementContext, localDate: sample.localDate, timeZone: sample.timeZone,
    sampleCount: sample.sampleCount, aggregationMethod: sample.aggregationMethod,
    derivedFrom: sample.derivedFrom, sourceConfidence: sample.sourceConfidence,
    normalizationVersion: sample.normalizationVersion, normalizationCorrection: sample.normalizationCorrection, revision: sample.revision
  };
}

function normalizeTimeZone(value: unknown): string {
  const requested = typeof value === 'string' && value.trim() ? value.trim().slice(0, 80) : 'UTC';
  try { return new Intl.DateTimeFormat('en-US', { timeZone: requested }).resolvedOptions().timeZone; }
  catch { return 'UTC'; }
}

function validLocalDate(value: unknown): string | null {
  const date = typeof value === 'string' ? value.trim() : '';
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

function boundedInt(value: unknown, min: number, max: number): number | null {
  const number = Number(value);
  return Number.isFinite(number) && Number.isInteger(number) && number >= min && number <= max ? number : null;
}

function safeClock(value: unknown): string | null {
  const clock = typeof value === 'string' ? value.trim() : '';
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(clock) ? clock : null;
}

async function readManualSleepCheckin(userId: string, localDate: string): Promise<ManualSleepCheckin | null> {
  const snap = await db.collection('users').doc(userId).collection('sleep_checkins').doc(localDate).get();
  return snap.exists ? snap.data() as ManualSleepCheckin : null;
}

async function saveManualSleepCheckin(userId: string, raw: any): Promise<ManualSleepCheckin> {
  const localDate = validLocalDate(raw?.localDate);
  const bedtime = safeClock(raw?.bedtime);
  const wakeTime = safeClock(raw?.wakeTime);
  const latency = boundedInt(raw?.sleepLatencyMinutes, 0, 180);
  const awakenings = boundedInt(raw?.awakenings, 0, 20);
  const quality = boundedInt(raw?.quality, 1, 5);
  const restedness = boundedInt(raw?.restedness, 1, 5);
  const timeZone = normalizeTimeZone(raw?.timeZone);
  const sleepStartRaw = typeof raw?.sleepStart === 'string' ? new Date(raw.sleepStart) : null;
  const sleepEndRaw = typeof raw?.sleepEnd === 'string' ? new Date(raw.sleepEnd) : null;

  if (!localDate || !bedtime || !wakeTime || latency === null || awakenings === null || quality === null || restedness === null
      || !sleepStartRaw || !sleepEndRaw || !Number.isFinite(sleepStartRaw.getTime()) || !Number.isFinite(sleepEndRaw.getTime())) {
    throw new Error('SLEEP_CHECKIN_INVALID');
  }

  const elapsedMinutes = Math.round((sleepEndRaw.getTime() - sleepStartRaw.getTime()) / 60_000);
  const sleepDurationMinutes = elapsedMinutes - latency;
  // Auto-relato plausível: janela de cama entre 2h e 16h; sono estimado entre
  // 2h e 14h. Valores fora disso são mais provavelmente erro de horário/data.
  if (elapsedMinutes < 120 || elapsedMinutes > 960 || sleepDurationMinutes < 120 || sleepDurationMinutes > 840) {
    throw new Error('SLEEP_CHECKIN_DURATION_INVALID');
  }

  const sleepStart = new Date(sleepStartRaw.getTime() + latency * 60_000).toISOString();
  const sleepEnd = sleepEndRaw.toISOString();
  const now = new Date().toISOString();

  // O questionário é AUTO-RELATO. Ele entra na Saúde como invictus_manual /
  // manual_entry e nunca como sensor_verified. O agregador diário já prioriza
  // Apple Health e Health Connect sobre invictus_manual quando ambos existem.
  await persistirAmostraSaude({
    userId,
    metricType: 'sleep_duration_min',
    value: sleepDurationMinutes,
    unit: 'min',
    timestamp: sleepEnd,
    startDate: sleepStart,
    endDate: sleepEnd,
    sampleId: `manual_sleep:${localDate}`,
    source: 'invictus_manual',
    quality: 'manual_entry',
    aggregation: 'sleep_session',
    localDate,
    timeZone,
    normalizationVersion: 1,
  });

  const checkin: ManualSleepCheckin = {
    localDate, timeZone, bedtime, wakeTime,
    sleepLatencyMinutes: latency,
    awakenings, quality, restedness,
    sleepDurationMinutes, sleepStart, sleepEnd,
    source: 'invictus_manual', updatedAt: now,
  };
  await db.collection('users').doc(userId).collection('sleep_checkins').doc(localDate).set(checkin, { merge: true });
  return checkin;
}

/**
 * Lê steps_daily e steps_activity na mesma consulta física. Isso mantém a
 * quantidade de RPCs do resumo estável: a antiga consulta de steps_daily é
 * substituída por esta consulta dual, em vez de adicionar uma chamada extra.
 */
async function readDailyAndActivitySteps(userId: string, since: Date, until: Date, limit: number, timeZone: string) {
  const snapshot = await db.collection('health_samples')
    .where('userId', '==', userId)
    .where('metricType', 'in', ['steps_daily', 'steps_activity'])
    .orderBy('timestamp', 'desc')
    .limit(Math.min(5000, Math.max(limit * 2, limit + 1)))
    .get();
  const all = snapshot.docs
    .map((entry: any) => ({ id: entry.id, ...entry.data() }) as HealthSample)
    .filter((sample: HealthSample) => {
      if (!STEP_METRICS.has(sample.metricType)) return false;
      const timestamp = Date.parse(sample.timestamp);
      return Number.isFinite(timestamp) && timestamp >= since.getTime() && timestamp <= until.getTime();
    });
  const split = (metricType: HealthMetricType) => {
    const raw = all.filter((sample) => sample.metricType === metricType);
    const deduped = deduplicateHealthSamples(raw, timeZone);
    return {
      samples: deduped.samples.slice(-limit),
      partial: raw.length > limit,
      scannedCount: raw.length,
      limit,
      excludedLegacyCount: deduped.excludedLegacyCount,
      unusableLegacyCount: deduped.unusableLegacyCount,
    };
  };
  return { stepsDaily: split('steps_daily'), stepsActivity: split('steps_activity') };
}

/** Resumo determinístico compartilhado por UI e IA explícita; nenhum Gemini nesta camada. */
export async function buildHealthSummary(userId: string, days = 30, timeZone = 'UTC'): Promise<HealthSummaryResult> {
  const windowDays = Number.isFinite(days) && days > 0 ? Math.min(Math.max(1, Math.floor(days)), 90) : 30;
  try { timeZone = new Intl.DateTimeFormat('en-US', { timeZone }).resolvedOptions().timeZone; }
  catch { timeZone = 'UTC'; }
  const now = new Date();
  const latestSince = now.getTime() - 14 * DAY_MS;
  const today = healthSampleLocalDate({ timestamp: now.toISOString() } as HealthSample, timeZone);
  const trendStartDate = new Date(Date.parse(`${today}T00:00:00.000Z`) - (windowDays - 1) * DAY_MS).toISOString().slice(0, 10);
  const since = new Date(Math.min(latestSince, Date.parse(`${trendStartDate}T00:00:00.000Z`)) - DAY_MS);
  const result: HealthSummaryResult = {
    windowDays, latest: {}, trends: {},
    metadata: { partial: false, aggregation: 'daily', timeZone, generatedAt: now.toISOString(), metrics: {} }
  };
  const rawSeries = new Map<HealthMetricType, HealthSample[]>();

  let pairedSteps: Awaited<ReturnType<typeof readDailyAndActivitySteps>> | null = null;
  try {
    pairedSteps = await readDailyAndActivitySteps(userId, since, now, LIMIT_PER_METRIC, timeZone);
    rawSeries.set('steps_daily', pairedSteps.stepsDaily.samples);
    rawSeries.set('steps_activity', pairedSteps.stepsActivity.samples);
    result.metadata.metrics.steps_activity = {
      partial: pairedSteps.stepsActivity.partial,
      scannedCount: pairedSteps.stepsActivity.scannedCount,
      limit: pairedSteps.stepsActivity.limit,
      excludedLegacyCount: pairedSteps.stepsActivity.excludedLegacyCount,
      unusableLegacyCount: pairedSteps.stepsActivity.unusableLegacyCount,
    };
    result.metadata.partial ||= pairedSteps.stepsActivity.partial;
  } catch {
    pairedSteps = null;
  }

  for (let offset = 0; offset < METRICAS_TENDENCIA.length; offset += 4) {
    await Promise.all(METRICAS_TENDENCIA.slice(offset, offset + 4).map(async metric => {
      try {
        const series = metric === 'steps_daily' && pairedSteps
          ? pairedSteps.stepsDaily
          : await lerSerieTemporalMetricaComLimite(userId, metric, since, now, LIMIT_PER_METRIC, timeZone);
        rawSeries.set(metric, series.samples);
        const daily = aggregateDailyHealthSamples(metric, series.samples, timeZone);
        result.metadata.metrics[metric] = {
          partial: series.partial, scannedCount: series.scannedCount, limit: series.limit,
          excludedLegacyCount: series.excludedLegacyCount, unusableLegacyCount: series.unusableLegacyCount
        };
        result.metadata.partial ||= series.partial;
        const completeDays = series.scannedCount > series.limit ? daily.slice(1) : daily;
        result.trends[metric] = completeDays.filter(sample => (sample.localDate || sample.timestamp.slice(0, 10)) >= trendStartDate).map(point);
        if (METRICAS_RESUMO.includes(metric)) {
          const useDailyValue = ['steps_daily', 'sleep_duration_min', 'calories_active', 'distance_km', 'hydration_l'].includes(metric);
          const latest = (useDailyValue ? completeDays : series.samples).filter(sample => Date.parse(sample.timestamp) >= latestSince).at(-1);
          const latestPoint = latest ? point(latest) : null;
          if (latestPoint && latest?.aggregation === 'daily_total') {
            latestPoint.timestamp = latest.updatedAt || latest.createdAt || latest.timestamp;
          }
          result.latest[metric] = latestPoint;
        }
      } catch {
        result.metadata.partial = true;
        result.metadata.metrics[metric] = { partial: true, error: true, scannedCount: 0, limit: LIMIT_PER_METRIC, excludedLegacyCount: 0, unusableLegacyCount: 0 };
        result.trends[metric] = [];
        if (METRICAS_RESUMO.includes(metric)) result.latest[metric] = null;
      }
    }));
  }

  try {
    let weightKg = Number(result.latest.weight_kg?.value) || 0;
    if (!(weightKg > 0)) {
      try {
        const userSnap = await db.collection('users').doc(userId).get();
        weightKg = Number(userSnap.data()?.weight) || 0;
      } catch {
        weightKg = 0;
      }
    }

    const consolidated = buildConsolidatedDailyActiveCalories({
      calories: rawSeries.get('calories_active') || [],
      stepsDaily: rawSeries.get('steps_daily') || [],
      stepsActivity: rawSeries.get('steps_activity') || [],
      weightKg,
      timeZone,
    });
    const visible = consolidated.filter(sample => (sample.localDate || sample.timestamp.slice(0, 10)) >= trendStartDate);
    if (visible.length) {
      result.trends.calories_active = visible.map(point);
      const latest = visible.at(-1);
      const latestPoint = latest ? point(latest) : null;
      if (latestPoint && latest?.aggregation === 'daily_total') {
        latestPoint.timestamp = latest.updatedAt || latest.createdAt || latest.timestamp;
      }
      result.latest.calories_active = latestPoint;
    }
  } catch {
    result.metadata.partial = true;
  }

  return result;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;
  const auth = await verifyAuth(req);
  if (!auth) return res.status(401).json({ error: 'Autenticação necessária.' });

  const action = typeof req.query?.action === 'string'
    ? req.query.action
    : typeof req.body?.action === 'string' ? req.body.action : '';

  if (action === 'sleep-checkin') {
    if (req.method === 'GET') {
      const localDate = validLocalDate(req.query?.date);
      if (!localDate) return res.status(400).json({ error: 'Data inválida.' });
      return res.status(200).json({ checkin: await readManualSleepCheckin(auth.uid, localDate) });
    }
    if (req.method === 'POST') {
      try {
        const checkin = await saveManualSleepCheckin(auth.uid, req.body || {});
        return res.status(200).json({ checkin });
      } catch (error: any) {
        const code = String(error?.message || '');
        if (code === 'SLEEP_CHECKIN_INVALID' || code === 'SLEEP_CHECKIN_DURATION_INVALID') {
          return res.status(422).json({
            error: code === 'SLEEP_CHECKIN_DURATION_INVALID'
              ? 'Confira os horários informados. O período de sono ficou fora de uma faixa plausível.'
              : 'Preencha todas as perguntas sobre o sono.',
            code,
          });
        }
        console.error('[HealthSummary] Falha ao salvar auto-relato de sono:', error);
        return res.status(503).json({ error: 'Não foi possível salvar seu sono agora. Tente novamente.', code: 'SLEEP_CHECKIN_UNAVAILABLE' });
      }
    }
    return res.status(405).json({ error: 'Método não permitido.' });
  }

  if (req.method !== 'GET') return res.status(405).json({ error: 'Método não permitido.' });
  const timeZone = typeof req.query?.timeZone === 'string' ? req.query.timeZone : 'UTC';
  return res.status(200).json(await buildHealthSummary(auth.uid, Number(req.query?.days), timeZone));
}
