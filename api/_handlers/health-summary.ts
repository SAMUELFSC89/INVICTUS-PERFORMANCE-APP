import { VercelRequest, VercelResponse } from '@vercel/node';
import { cors, verifyAuth } from '../_lib/common.js';
import { lerSerieTemporalMetricaComLimite, HealthMetricType, HealthSample } from '../_lib/health-data-layer.js';
import { aggregateDailyHealthSamples, healthSampleLocalDate } from '../_lib/health-source-priority.js';

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

/** Resumo determinístico compartilhado por UI e IA explícita; nenhum Gemini nesta camada. */
export async function buildHealthSummary(userId: string, days = 30, timeZone = 'UTC'): Promise<HealthSummaryResult> {
  const windowDays = Number.isFinite(days) && days > 0 ? Math.min(Math.max(1, Math.floor(days)), 90) : 30;
  try { timeZone = new Intl.DateTimeFormat('en-US', { timeZone }).resolvedOptions().timeZone; }
  catch { timeZone = 'UTC'; }
  const now = new Date();
  const latestSince = now.getTime() - 14 * DAY_MS;
  const today = healthSampleLocalDate({ timestamp: now.toISOString() } as HealthSample, timeZone);
  const trendStartDate = new Date(Date.parse(`${today}T00:00:00.000Z`) - (windowDays - 1) * DAY_MS).toISOString().slice(0, 10);
  // Margem UTC cobre o primeiro dia local completo, inclusive UTC+14 e mudanças de horário.
  const since = new Date(Math.min(latestSince, Date.parse(`${trendStartDate}T00:00:00.000Z`)) - DAY_MS);
  const result: HealthSummaryResult = {
    windowDays, latest: {}, trends: {},
    metadata: { partial: false, aggregation: 'daily', timeZone, generatedAt: now.toISOString(), metrics: {} }
  };
  // Cada métrica é lida uma única vez. Falha parcial não apaga as demais métricas.
  // Quatro consultas simultâneas evitam rajadas de dezenas de RPCs por usuário.
  for (let offset = 0; offset < METRICAS_TENDENCIA.length; offset += 4) {
    await Promise.all(METRICAS_TENDENCIA.slice(offset, offset + 4).map(async metric => {
      try {
        const series = await lerSerieTemporalMetricaComLimite(userId, metric, since, now, LIMIT_PER_METRIC, timeZone);
        const daily = aggregateDailyHealthSamples(metric, series.samples, timeZone);
        result.metadata.metrics[metric] = {
          partial: series.partial, scannedCount: series.scannedCount, limit: series.limit,
          excludedLegacyCount: series.excludedLegacyCount, unusableLegacyCount: series.unusableLegacyCount
        };
        result.metadata.partial ||= series.partial;
        // Janela cortada pode ter o primeiro dia incompleto. Não publicar um total parcial desse dia.
        const completeDays = series.scannedCount > series.limit ? daily.slice(1) : daily;
        result.trends[metric] = completeDays.filter(sample => (sample.localDate || sample.timestamp.slice(0, 10)) >= trendStartDate).map(point);
        if (METRICAS_RESUMO.includes(metric)) {
          // Latest mantém a leitura atual; trends contém estatísticas por dia.
          const useDailyValue = ['steps_daily', 'sleep_duration_min', 'calories_active', 'distance_km', 'hydration_l'].includes(metric);
          const latest = (useDailyValue ? completeDays : series.samples).filter(sample => Date.parse(sample.timestamp) >= latestSince).at(-1);
          result.latest[metric] = latest ? point(latest) : null;
        }
      } catch {
        result.metadata.partial = true;
        result.metadata.metrics[metric] = { partial: true, error: true, scannedCount: 0, limit: LIMIT_PER_METRIC, excludedLegacyCount: 0, unusableLegacyCount: 0 };
        result.trends[metric] = [];
        if (METRICAS_RESUMO.includes(metric)) result.latest[metric] = null;
      }
    }));
  }
  return result;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;
  const auth = await verifyAuth(req);
  if (!auth) return res.status(401).json({ error: 'Autenticação necessária.' });
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método não permitido.' });
  const timeZone = typeof req.query?.timeZone === 'string' ? req.query.timeZone : 'UTC';
  return res.status(200).json(await buildHealthSummary(auth.uid, Number(req.query?.days), timeZone));
}
