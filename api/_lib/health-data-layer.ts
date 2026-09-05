import { createHash } from 'node:crypto';
import { db } from './common.js';
import { assessHealthConfidence, ConfidenceAssessment, deriveProvenanceStatus, HealthProvenance } from './health-confidence-engine.js';
import type { MeasurementContext } from './health-evidence-registry.js';
import { loadHealthConfidenceRuntime } from './health-confidence-runtime.js';
import { healthSampleLocalDate } from './health-source-priority.js';

/**
 * HEALTH DATA LAYER (Fase 1 -- fundacao).
 *
 * Contexto: hoje o app so guarda dados de saude "dentro" de cada sessao de
 * treino, na colecao `workouts` (avgHeartRate, calories, distance...). Isso
 * funciona para o que existe agora (Health.tsx le `workouts` e calcula
 * VO2 max/consistencia em cima disso, ver src/core/performance/), mas nao
 * da pra construir series temporais por METRICA (ex.: "minha FC media dos
 * ultimos 90 dias", independente de qual treino gerou cada leitura), nem
 * comparar a mesma metrica entre fontes diferentes (relogio vs. Health
 * Connect vs. digitado), nem preparar terreno para compartilhamento
 * profissional futuro (Invictus Health Professional) sem reconstruir o
 * banco do zero.
 *
 * Este modulo cria essa camada como um SEGUNDO destino de escrita, aditivo:
 * ninguem deixa de escrever em `workouts`, e o IGA/ranking continuam lendo
 * exatamente de onde ja liam. `health_samples` e escrito ALEM disso, nunca
 * EM VEZ disso. Ver nota de separacao mais abaixo.
 *
 * SEPARACAO ABSOLUTA DO IGA -- REGRA DE OURO:
 * Nenhuma funcao daqui deve ser chamada por igaService.ts, security-pipeline
 * ou qualquer motor de pontuacao/ranking. Dado de saude nao vira pontuacao
 * competitiva so porque esta disponivel (pedido explicito do usuario). Na
 * outra direcao, o inverso tambem vale: uma atividade ser rejeitada pelo
 * antifraude por motivo COMPETITIVO (ex.: duplicata entre fontes) nao
 * significa que a leitura biometrica em si seja falsa -- por isso o campo
 * `quality` existe (ver abaixo) em vez de simplesmente nao gravar a amostra.
 */

/**
 * Tipos de metrica reconhecidos pela camada. A lista e maior do que o que
 * realmente e gravado hoje de proposito -- o objetivo e nao ter que migrar
 * o schema quando novas fontes (sono, peso, HRV padrao) forem conectadas.
 * Ver `metricsGravadasHoje` no fim do arquivo para o que E populado agora.
 */
export type HealthMetricType =
  | 'heart_rate_avg'
  | 'heart_rate_max'
  | 'heart_rate_resting'   // #253: coletado via HealthVitalsProvider (@capgo/capacitor-health), sync separado de atividade (action 'sync-vitals')
  | 'heart_rate'
  | 'hrv_sdnn'
  | 'hrv_rmssd'            // #253: idem
  | 'vo2max_estimate'      // calculado no cliente (performanceEngine.ts), nao no servidor -- integracao futura
  | 'sleep_duration_min'   // #253: idem (agregado por noite a partir dos segmentos de estagio)
  | 'weight_kg'            // #253: idem
  | 'steps_daily'          // #253: total de passos do dia, via queryAggregated (bucket=day, sum) -- HealthVitalsProvider
  | 'steps_activity'       // passos associados a uma sessão de treino wearable
  | 'calories_active'
  | 'calories_total'
  | 'calories_basal'
  | 'distance_km'
  | 'distance_cycling_km'
  | 'respiratory_rate'
  | 'oxygen_saturation'
  | 'ecg'
  | 'atrial_fibrillation_detection'
  | 'blood_pressure_systolic'
  | 'blood_pressure_diastolic'
  | 'blood_glucose'
  | 'body_temperature'
  | 'height_cm'
  | 'flights_climbed'
  | 'exercise_duration_min'
  | 'body_fat_percent'
  | 'mindfulness_duration_min'
  | 'stand_hours'
  | 'hydration_l'
  | 'dietary_energy_kcal'
  | 'duration_min';

export type HealthSampleSource =
  | 'apple_health'
  | 'health_connect'
  | 'strava'
  | 'invictus_manual'
  | 'invictus_gps';

/**
 * Campo legado do pipeline de atividade/antifraude. NÃO representa a
 * confiança científica da medição; essa responsabilidade é exclusiva de
 * `confidenceAtMeasurement` (Health Confidence Engine).
 * - sensor_verified: veio de sensor real E passou pelo SecurityPipeline sem alertas.
 * - sensor_flagged: veio de sensor real, mas o SecurityPipeline suspeitou da
 *   ATIVIDADE (ex.: padrao de GPS incompativel) -- a leitura biometrica pode
 *   ainda ser real; fica marcada para uso cauteloso em tendencias de saude,
 *   nao e descartada de cara.
 * - manual_entry: digitado pelo usuario, sem sensor.
 */
export type HealthSampleQuality = 'sensor_verified' | 'sensor_flagged' | 'manual_entry';

export interface HealthSample {
  id: string;
  userId: string;
  metricType: HealthMetricType;
  value: number;
  unit: string;
  timestamp: string; // ISO -- momento em que a leitura aconteceu (nao o de gravacao)
  startDate?: string;
  endDate?: string;
  sampleId?: string;
  sourceId?: string;
  platformId?: string;
  source: HealthSampleSource;
  sourceActivityId?: string; // referencia ao doc de `workouts`, quando aplicavel
  device?: string;
  quality: HealthSampleQuality;
  provenance?: HealthProvenance;
  confidenceAtMeasurement?: ConfidenceAssessment;
  currentEvidenceConfidence?: ConfidenceAssessment;
  measurementContext?: MeasurementContext;
  derivedFrom?: string[];
  sourceConfidence?: number[];
  createdAt: string;
  schemaVersion?: number;
  normalizationVersion?: number;
  aggregation?: 'daily_total' | 'sleep_session' | 'sample';
  localDate?: string;
  timeZone?: string;
  revision?: number;
  updatedAt?: string;
  legacyId?: string;
  sampleCount?: number;
  aggregationMethod?: 'mean' | 'sum' | 'latest' | 'daily_total';
  normalizationCorrection?: { previousVersion: number; currentVersion: number; correctedAt: string; historicalConfidencePreserved: true };
}

const HEALTH_SAMPLES_COLLECTION = 'health_samples';

export type HealthSampleInput = Omit<HealthSample, 'id' | 'createdAt'>;
export type HealthWriteStatus = 'created' | 'updated' | 'duplicate';
export interface HealthIngestionResult {
  receivedCount: number;
  savedCount: number;
  createdCount: number;
  updatedCount: number;
  duplicateCount: number;
  rejectedCount: number;
}

/** Identidade inclui o proprietário; nenhuma amostra de outra conta é reutilizada. */
export function healthSampleDocumentId(sample: HealthSampleInput): string {
  const identity = sample.sampleId || sample.sourceActivityId || sample.timestamp;
  return `v2_${createHash('sha256').update(JSON.stringify([sample.userId, sample.source, sample.metricType, identity])).digest('hex')}`;
}
function legacyDocumentId(sample: HealthSampleInput): string {
  const rawId = sample.sampleId || sample.sourceActivityId || sample.timestamp;
  return `${sample.source}_${sample.metricType}_${Buffer.from(rawId).toString('base64url').slice(0, 900)}`;
}

/** Escrita estrita para saúde passiva. Transação torna revisões e migração idempotentes. */
export async function persistirAmostraSaude(sample: HealthSampleInput): Promise<HealthWriteStatus> {
  const provenance = sample.provenance || provenanceFromLegacySample(sample.source, sample.sourceId, sample.device);
  const runtime = sample.confidenceAtMeasurement ? null : await loadHealthConfidenceRuntime();
  const confidenceAtMeasurement = sample.confidenceAtMeasurement || assessHealthConfidence({
    metricType: sample.metricType, provenance, measurementContext: sample.measurementContext,
    completeness: provenance.status === 'VERIFIED_DEVICE' ? 'complete' : 'partial',
    derivedFrom: sample.derivedFrom, sourceConfidence: sample.sourceConfidence
  }, runtime!.registry, runtime!.config);
  const id = healthSampleDocumentId(sample);
  const ref = db.collection(HEALTH_SAMPLES_COLLECTION).doc(id);
  const legacyId = legacyDocumentId(sample);
  const legacyRef = db.collection(HEALTH_SAMPLES_COLLECTION).doc(legacyId);
  return db.runTransaction(async (transaction) => {
    const existing = await transaction.get(ref);
    const legacy = existing.exists ? null : await transaction.get(legacyRef);
    const old = (existing.exists ? existing.data() : legacy?.data()) as HealthSample | undefined;
    // Hash collisions or corrupt documents never grant access to another owner.
    if (existing.exists && old?.userId !== sample.userId) throw new Error('HEALTH_SAMPLE_OWNER_MISMATCH');
    const previous = old?.userId === sample.userId ? old : undefined;
    const now = new Date().toISOString();
    const revisable = sample.aggregation === 'daily_total' || sample.aggregation === 'sleep_session'
      || (sample.normalizationVersion || 1) > (previous?.normalizationVersion || 1);
    const changed = previous && revisable && (
      previous.value !== sample.value || previous.unit !== sample.unit
      || previous.timestamp !== sample.timestamp || previous.startDate !== sample.startDate || previous.endDate !== sample.endDate
      || (sample.normalizationVersion || 1) > (previous.normalizationVersion || 1)
    );
    if (existing.exists && !changed) return 'duplicate';
    const next: HealthSample = {
      ...(previous || sample),
      ...(previous && !changed ? {} : sample),
      id, userId: sample.userId, schemaVersion: 2,
      provenance: previous?.provenance || provenance,
      confidenceAtMeasurement: previous?.confidenceAtMeasurement || confidenceAtMeasurement,
      measurementContext: previous?.measurementContext || confidenceAtMeasurement.measurementContext,
      createdAt: previous?.createdAt || now,
      revision: previous ? (previous.revision || 1) + (changed ? 1 : 0) : 1,
      ...(previous ? { legacyId: previous.legacyId || (legacy?.exists ? legacyId : undefined) } : {}),
      ...(changed ? { updatedAt: now } : {}),
      ...(previous && (sample.normalizationVersion || 1) > (previous.normalizationVersion || 1) ? {
        normalizationCorrection: { previousVersion: previous.normalizationVersion || 1, currentVersion: sample.normalizationVersion || 1, correctedAt: now, historicalConfidencePreserved: true as const }
      } : {})
    };
    if (existing.exists) transaction.set(ref, next);
    else transaction.create(ref, next);
    // O legado permanece intacto. Leituras preferem a identidade v2 e removem duplicatas.
    return previous ? (changed ? 'updated' : 'duplicate') : 'created';
  });
}

/** Compatibilidade: falha da telemetria auxiliar nunca altera o resultado competitivo. */
export async function gravarAmostraSaude(sample: HealthSampleInput): Promise<void> {
  try { await persistirAmostraSaude(sample); }
  catch { console.error('[HealthDataLayer] Falha na persistência de telemetria auxiliar.'); }
}

function integrationForSource(source: HealthSampleSource): HealthProvenance['integration'] {
  if (source === 'apple_health') return 'APPLE_HEALTH';
  if (source === 'health_connect') return 'HEALTH_CONNECT';
  if (source === 'strava') return 'STRAVA';
  if (source === 'invictus_manual' || source === 'invictus_gps') return 'INVICTUS';
  return 'UNKNOWN';
}

function provenanceFromLegacySample(source: HealthSampleSource, sourceId?: string, device?: string): HealthProvenance {
  const partial: Omit<HealthProvenance, 'status'> = {
    integration: integrationForSource(source), dataOrigin: sourceId, applicationName: device
  };
  return { ...partial, status: deriveProvenanceStatus(partial) };
}

/**
 * Extrai e grava as amostras normalizadas disponiveis a partir de UMA
 * atividade ja processada (chamado depois do SecurityPipeline decidir, para
 * poder classificar `quality` corretamente). So grava o que realmente foi
 * medido -- nunca preenche metricas ausentes com zero ou estimativa.
 *
 * `pularDuplicata`: quando a atividade foi identificada como duplicata de
 * outra ja gravada (mesmo evento real, duas fontes), NAO gravamos de novo --
 * isso e sobre nao contar o mesmo treino duas vezes na serie temporal, uma
 * preocupacao de qualidade de dado de saude distinta (e adicional a) da
 * preocupacao antifraude/competitiva que gerou a deduplicacao em primeiro
 * lugar.
 */
export async function registrarAmostrasDeAtividade(params: {
  userId: string;
  source: HealthSampleSource;
  sourceActivityId: string;
  timestamp: string;
  device?: string;
  aprovadoPeloAntifraude: boolean;
  pularDuplicata: boolean;
  avgHeartRate?: number;
  maxHeartRate?: number;
  calories?: number;
  steps?: number;
  distanceKm?: number;
  durationMin?: number;
}): Promise<void> {
  if (params.pularDuplicata) return;

  const quality: HealthSampleQuality = params.aprovadoPeloAntifraude ? 'sensor_verified' : 'sensor_flagged';
  const base = {
    userId: params.userId,
    source: params.source,
    sourceActivityId: params.sourceActivityId,
    timestamp: params.timestamp,
    device: params.device,
    quality
  };

  const gravacoes: Promise<void>[] = [];
  if (typeof params.avgHeartRate === 'number' && params.avgHeartRate > 0) {
    gravacoes.push(gravarAmostraSaude({ ...base, metricType: 'heart_rate_avg', value: params.avgHeartRate, unit: 'bpm' }));
  }
  if (typeof params.maxHeartRate === 'number' && params.maxHeartRate > 0) {
    gravacoes.push(gravarAmostraSaude({ ...base, metricType: 'heart_rate_max', value: params.maxHeartRate, unit: 'bpm' }));
  }
  if (typeof params.calories === 'number' && params.calories > 0) {
    gravacoes.push(gravarAmostraSaude({ ...base, metricType: 'calories_active', value: params.calories, unit: 'kcal' }));
  }
  if (typeof params.steps === 'number' && params.steps > 0) {
    gravacoes.push(gravarAmostraSaude({ ...base, metricType: 'steps_activity', value: Math.round(params.steps), unit: 'passos' }));
  }
  if (typeof params.distanceKm === 'number' && params.distanceKm > 0) {
    gravacoes.push(gravarAmostraSaude({ ...base, metricType: 'distance_km', value: params.distanceKm, unit: 'km' }));
  }
  if (typeof params.durationMin === 'number' && params.durationMin > 0) {
    gravacoes.push(gravarAmostraSaude({ ...base, metricType: 'duration_min', value: params.durationMin, unit: 'min' }));
  }

  await Promise.all(gravacoes);
}

/**
 * #253: grava METRICAS PASSIVAS (FC repouso, HRV, sono, peso) lidas do
 * HealthKit/Health Connect via @capgo/capacitor-health -- NAO estao ligadas a
 * uma atividade/treino especifico, entao nao passam pelo SecurityPipeline
 * (nao sao uma alegacao competitiva: nao geram pontos nem entram em
 * ranking). `quality='sensor_verified'` é mantido apenas por compatibilidade
 * do schema legado; origem por integração não prova hardware. Proveniência e
 * confiança são classificadas separadamente pelo Confidence Engine.
 *
 * Deduplicação inclui usuário, integração, métrica e identidade da leitura.
 * Totais diários/sessões e correções versionadas podem revisar o valor;
 * a confiança histórica permanece identificada separadamente da evidência atual.
 */
export async function registrarAmostrasPassivas(params: {
  userId: string;
  source: HealthSampleSource;
  amostras: Array<Omit<HealthSampleInput, 'userId' | 'source' | 'quality'>>;
}): Promise<HealthIngestionResult> {
  const validas = params.amostras.filter((a) => typeof a.value === 'number' && Number.isFinite(a.value) && a.value >= 0);
  const result: HealthIngestionResult = { receivedCount: params.amostras.length, savedCount: 0, createdCount: 0, updatedCount: 0, duplicateCount: 0, rejectedCount: params.amostras.length - validas.length };
  // Limita concorrência por requisição; um erro impede ACK/cursor e o retry é idempotente.
  for (let offset = 0; offset < validas.length; offset += 16) {
    const statuses = await Promise.all(validas.slice(offset, offset + 16).map((a) => persistirAmostraSaude({
      ...a, userId: params.userId, source: params.source, quality: 'sensor_verified'
    })));
    for (const status of statuses) {
      if (status === 'created') result.createdCount += 1;
      else if (status === 'updated') result.updatedCount += 1;
      else result.duplicateCount += 1;
    }
  }
  result.savedCount = result.createdCount + result.updatedCount;
  return result;
}

/**
 * Le a serie temporal de UMA metrica para um usuario, num intervalo. Usado
 * pelos relatorios/baseline futuros (atras de FEATURE_FLAGS.healthReports /
 * healthBaseline) -- ainda sem UI conectada nesta fase, mas a leitura ja
 * funciona de verdade contra dados reais gravados por registrarAmostrasDeAtividade.
 */
export interface BoundedHealthSeries {
  samples: HealthSample[];
  partial: boolean;
  scannedCount: number;
  limit: number;
  excludedLegacyCount: number;
  unusableLegacyCount: number;
}

/** Exact Android point identity, used only to bridge the old record-level HR ID. */
function androidHeartRatePointKey(sample: HealthSample, includeValue = true): string | null {
  if (sample.source !== 'health_connect' || sample.metricType !== 'heart_rate'
    || !sample.platformId || sample.unit !== 'bpm' || !Number.isFinite(sample.value)) return null;
  const at = Date.parse(sample.timestamp);
  if (!Number.isFinite(at) || (sample.startDate && Date.parse(sample.startDate) !== at)
    || (sample.endDate && Date.parse(sample.endDate) !== at)) return null;
  const origin = sample.provenance?.dataOrigin || sample.sourceId || '';
  return JSON.stringify([sample.userId, sample.source, sample.metricType, sample.platformId,
    sample.sourceId || origin, origin, at, sample.unit, ...(includeValue ? [sample.value] : [])]);
}

/** Migração de leitura: não mistura snapshots antigos com a versão corrigida. */
export function deduplicateHealthSamples(samples: HealthSample[], timeZone = 'UTC'): { samples: HealthSample[]; excludedLegacyCount: number; unusableLegacyCount: number } {
  const identity = new Map<string, HealthSample>();
  let excludedLegacyCount = 0;
  let unusableLegacyCount = 0;
  const normalizedIdentities = new Set(samples.filter(s => (s.normalizationVersion || 1) >= 2).map(healthSampleDocumentId));
  const normalizedDays = new Set(samples.filter(s => (s.normalizationVersion || 1) >= 2)
    .map(s => `${s.userId}:${s.source}:${s.metricType}:${healthSampleLocalDate(s, timeZone)}`));
  // Previous Android collection saved one reading per HeartRateRecord. A new
  // sync can recover its individual points; the old surviving point must not
  // count twice. Never reconstruct readings that were already lost.
  const newHeartRatePoints = samples.filter(sample => (sample.normalizationVersion || 1) >= 2
    && sample.sampleId?.startsWith('hr-point:v1:'));
  const newPointKeys = new Set(newHeartRatePoints.map(sample => androidHeartRatePointKey(sample)).filter(Boolean));
  const newPointTimes = new Set(newHeartRatePoints.map(sample => androidHeartRatePointKey(sample, false)).filter(Boolean));
  for (const sample of samples) {
    if (sample.platformId && sample.sampleId === sample.platformId) {
      const pointKey = androidHeartRatePointKey(sample);
      if (pointKey && newPointKeys.has(pointKey)) { excludedLegacyCount += 1; continue; }
      // Preserve conflicting raw evidence, but do not present the series as
      // complete when old/new versions disagree at the same source instant.
      const timeKey = androidHeartRatePointKey(sample, false);
      if (timeKey && newPointTimes.has(timeKey)) unusableLegacyCount += 1;
    }
    // SDNN iOS legado era rotulado RMSSD. Não inventar conversão nem baseline.
    const unsafeLegacy = (sample.normalizationVersion || 1) < 2 && (
      (sample.source === 'apple_health' && ['hrv_rmssd', 'oxygen_saturation', 'body_fat_percent'].includes(sample.metricType))
      || (sample.source === 'health_connect' && sample.metricType === 'calories_basal')
      || sample.metricType === 'sleep_duration_min'
    );
    if (unsafeLegacy) {
      const replacementDay = `${sample.userId}:${sample.source}:${sample.metricType}:${healthSampleLocalDate(sample, timeZone)}`;
      const replaced = normalizedIdentities.has(healthSampleDocumentId(sample)) || normalizedDays.has(replacementDay);
      excludedLegacyCount += 1; if (!replaced) unusableLegacyCount += 1; continue;
    }
    const dayKey = `${sample.userId}:${sample.source}:${sample.metricType}:${healthSampleLocalDate(sample, timeZone)}`;
    const legacyAggregate = sample.metricType === 'steps_daily' || sample.metricType === 'sleep_duration_min'
      || ((!sample.sourceActivityId) && ['calories_active', 'distance_km'].includes(sample.metricType));
    if ((sample.normalizationVersion || 1) < 2 && legacyAggregate && normalizedDays.has(dayKey)) {
      excludedLegacyCount += 1; continue;
    }
    const key = healthSampleDocumentId(sample);
    const current = identity.get(key);
    if (!current || (sample.schemaVersion || 1) > (current.schemaVersion || 1)
      || ((sample.schemaVersion || 1) === (current.schemaVersion || 1) && (sample.revision || 1) > (current.revision || 1))) identity.set(key, sample);
  }
  return { samples: [...identity.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp)), excludedLegacyCount, unusableLegacyCount };
}

export async function lerSerieTemporalMetricaComLimite(
  userId: string, metricType: HealthMetricType, desde: Date, ate: Date = new Date(), limit = 1000, timeZone = 'UTC'
): Promise<BoundedHealthSeries> {
  const boundedLimit = Math.max(1, Math.min(5000, Math.floor(limit)));
  const snap = await db.collection(HEALTH_SAMPLES_COLLECTION)
    .where('userId', '==', userId).where('metricType', '==', metricType)
    .where('timestamp', '>=', desde.toISOString()).where('timestamp', '<=', ate.toISOString())
    .orderBy('timestamp', 'desc').limit(boundedLimit + 1).get();
  const runtime = await loadHealthConfidenceRuntime();
  const deduplicated = deduplicateHealthSamples(snap.docs.slice(0, boundedLimit).map((d) => ({ ...d.data(), id: d.id } as HealthSample)), timeZone);
  const samples = deduplicated.samples.map((sample) => {
    const provenance = sample.provenance || { ...provenanceFromLegacySample(sample.source, sample.sourceId, undefined), status: 'LEGACY_UNKNOWN_SOURCE' as const };
    return { ...sample, provenance, currentEvidenceConfidence: assessHealthConfidence({
      metricType: sample.metricType, provenance, measurementContext: sample.measurementContext,
      completeness: sample.confidenceAtMeasurement ? 'complete' : 'minimal', assessedAt: new Date().toISOString(),
      derivedFrom: sample.derivedFrom, sourceConfidence: sample.sourceConfidence
    }, runtime.registry, runtime.config) };
  });
  return { samples, partial: snap.docs.length > boundedLimit || deduplicated.unusableLegacyCount > 0, scannedCount: snap.docs.length, limit: boundedLimit, excludedLegacyCount: deduplicated.excludedLegacyCount, unusableLegacyCount: deduplicated.unusableLegacyCount };
}

/** Compatibilidade de callers antigos: nunca entrega silenciosamente uma janela truncada. */
export async function lerSerieTemporalMetrica(userId: string, metricType: HealthMetricType, desde: Date, ate: Date = new Date()): Promise<HealthSample[]> {
  const result = await lerSerieTemporalMetricaComLimite(userId, metricType, desde, ate);
  if (result.partial) throw new Error('HEALTH_SERIES_PARTIAL');
  return result.samples;
}

/**
 * ARQUITETURA PREPARADA, AINDA NAO ATIVADA (professionalSharing=false):
 *
 * Estas duas formas modelam o que sera necessario quando o compartilhamento
 * profissional (medico/clinica) for ligado -- deixadas aqui como CONTRATO DE
 * DADOS, sem tabela/CRUD ainda, para nao criar infraestrutura sem uso real
 * (nenhum caller hoje) nem sem a etapa de compliance/interoperabilidade
 * (LGPD, FHIR quando fizer sentido) que esse tipo de acesso exige. Quando a
 * feature for priorizada, a implementacao usa estes mesmos formatos.
 */
export interface HealthConsentGrant {
  userId: string;
  grantedToId: string; // profissional/instituicao autorizada
  grantedToType: 'professional' | 'institution';
  scopeMetricTypes: HealthMetricType[] | 'all';
  grantedAt: string;
  revokedAt: string | null;
  expiresAt: string | null;
}

export interface HealthAccessAuditEntry {
  userId: string;
  accessedBy: string;
  accessedAt: string;
  scopeMetricTypes: HealthMetricType[] | 'all';
  reason: string;
}

/**
 * O que esta camada realmente grava hoje:
 * - Ligadas a atividade (wearable-sync-service.ts, via registrarAmostrasDeAtividade)
 * - Vitais passivas #253 (api/_handlers/wearables.ts action 'sync-vitals', via registrarAmostrasPassivas)
 */
export const metricsGravadasHoje: HealthMetricType[] = [
  'heart_rate_avg', 'heart_rate_max', 'calories_active', 'steps_activity', 'distance_km', 'duration_min',
  'heart_rate', 'heart_rate_resting', 'hrv_rmssd', 'hrv_sdnn', 'sleep_duration_min', 'weight_kg', 'steps_daily',
  'calories_total', 'calories_basal', 'distance_cycling_km', 'respiratory_rate', 'oxygen_saturation',
  'blood_pressure_systolic', 'blood_pressure_diastolic', 'blood_glucose', 'body_temperature', 'height_cm', 'flights_climbed', 'exercise_duration_min',
  'body_fat_percent', 'mindfulness_duration_min', 'stand_hours', 'hydration_l', 'dietary_energy_kcal'
];
