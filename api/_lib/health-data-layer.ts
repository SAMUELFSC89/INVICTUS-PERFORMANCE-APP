import { db } from './common.js';
import { assessHealthConfidence, ConfidenceAssessment, deriveProvenanceStatus, HealthProvenance } from './health-confidence-engine.js';
import type { MeasurementContext } from './health-evidence-registry.js';
import { loadHealthConfidenceRuntime } from './health-confidence-runtime.js';

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
}

const HEALTH_SAMPLES_COLLECTION = 'health_samples';

/**
 * Grava uma amostra normalizada. Nunca lanca: chamado de dentro de um
 * pipeline de ingestao que ja tem seu proprio resultado principal (a
 * atividade em si) -- uma falha aqui e uma falha de telemetria auxiliar,
 * nao pode derrubar o fluxo real.
 */
export async function gravarAmostraSaude(sample: Omit<HealthSample, 'id' | 'createdAt'>): Promise<void> {
  try {
    const provenance = sample.provenance || provenanceFromLegacySample(sample.source, sample.sourceId, sample.device);
    const runtime = sample.confidenceAtMeasurement ? null : await loadHealthConfidenceRuntime();
    const confidenceAtMeasurement = sample.confidenceAtMeasurement || assessHealthConfidence({
      metricType: sample.metricType,
      provenance,
      measurementContext: sample.measurementContext,
      completeness: provenance.status === 'VERIFIED_DEVICE' ? 'complete' : 'partial',
      derivedFrom: sample.derivedFrom,
      sourceConfidence: sample.sourceConfidence
    }, runtime!.registry, runtime!.config);
    const rawId = sample.sampleId || sample.sourceActivityId || sample.timestamp;
    const safeId = Buffer.from(rawId).toString('base64url').slice(0, 900);
    const id = `${sample.source}_${sample.metricType}_${safeId}`;
    // Classificação histórica é imutável. A mesma amostra resincronizada não
    // recebe silenciosamente uma nova versão/nota; evidência atual aparece em
    // `currentEvidenceConfidence` somente na leitura.
    await db.collection(HEALTH_SAMPLES_COLLECTION).doc(id).create({
      ...sample,
      provenance,
      confidenceAtMeasurement,
      measurementContext: confidenceAtMeasurement.measurementContext,
      id,
      createdAt: new Date().toISOString()
    });
  } catch (err: any) {
    if (err?.code === 6 || err?.code === 'already-exists' || err?.code === 'ALREADY_EXISTS') return;
    console.error('[HealthDataLayer] Falha ao gravar amostra (nao-fatal):', err);
  }
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
 * Deduplicacao: `gravarAmostraSaude` usa `source + (sourceActivityId ||
 * timestamp) + metricType` como id do documento e criação imutável. Vitais nao tem
 * sourceActivityId, entao o `timestamp` da propria leitura garante que
 * resincronizar uma janela sobreposta encontra o mesmo doc e não duplica nem
 * reclassifica silenciosamente a serie temporal.
 */
export async function registrarAmostrasPassivas(params: {
  userId: string;
  source: HealthSampleSource;
  amostras: Array<{
    metricType: HealthMetricType; value: number; unit: string; timestamp: string;
    startDate?: string; endDate?: string; sampleId?: string; sourceId?: string; platformId?: string; device?: string;
    provenance?: HealthProvenance; measurementContext?: MeasurementContext; derivedFrom?: string[]; sourceConfidence?: number[];
  }>;
}): Promise<number> {
  const validas = params.amostras.filter((a) => typeof a.value === 'number' && Number.isFinite(a.value) && a.value > 0);
  await Promise.all(validas.map((a) => gravarAmostraSaude({
    userId: params.userId,
    source: params.source,
    timestamp: a.timestamp,
    startDate: a.startDate,
    endDate: a.endDate,
    sampleId: a.sampleId,
    sourceId: a.sourceId,
    platformId: a.platformId,
    device: a.device,
    provenance: a.provenance,
    measurementContext: a.measurementContext,
    derivedFrom: a.derivedFrom,
    sourceConfidence: a.sourceConfidence,
    quality: 'sensor_verified',
    metricType: a.metricType,
    value: a.value,
    unit: a.unit
  })));
  return validas.length;
}

/**
 * Le a serie temporal de UMA metrica para um usuario, num intervalo. Usado
 * pelos relatorios/baseline futuros (atras de FEATURE_FLAGS.healthReports /
 * healthBaseline) -- ainda sem UI conectada nesta fase, mas a leitura ja
 * funciona de verdade contra dados reais gravados por registrarAmostrasDeAtividade.
 */
export async function lerSerieTemporalMetrica(
  userId: string,
  metricType: HealthMetricType,
  desde: Date,
  ate: Date = new Date()
): Promise<HealthSample[]> {
  const snap = await db.collection(HEALTH_SAMPLES_COLLECTION)
    .where('userId', '==', userId)
    .where('metricType', '==', metricType)
    .where('timestamp', '>=', desde.toISOString())
    .where('timestamp', '<=', ate.toISOString())
    .orderBy('timestamp', 'asc')
    .get();
  const runtime = await loadHealthConfidenceRuntime();
  return snap.docs.map((d) => {
    const sample = d.data() as HealthSample;
    const provenance = sample.provenance || { ...provenanceFromLegacySample(sample.source, sample.sourceId, undefined), status: 'LEGACY_UNKNOWN_SOURCE' as const };
    return {
      ...sample,
      provenance,
      currentEvidenceConfidence: assessHealthConfidence({
        metricType: sample.metricType, provenance, measurementContext: sample.measurementContext,
        completeness: sample.confidenceAtMeasurement ? 'complete' : 'minimal', assessedAt: new Date().toISOString(),
        derivedFrom: sample.derivedFrom, sourceConfidence: sample.sourceConfidence
      }, runtime.registry, runtime.config)
    };
  });
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
  'heart_rate', 'heart_rate_resting', 'hrv_rmssd', 'sleep_duration_min', 'weight_kg', 'steps_daily',
  'calories_total', 'calories_basal', 'distance_cycling_km', 'respiratory_rate', 'oxygen_saturation',
  'blood_pressure_systolic', 'blood_pressure_diastolic', 'blood_glucose', 'body_temperature', 'height_cm', 'flights_climbed', 'exercise_duration_min',
  'body_fat_percent', 'mindfulness_duration_min', 'stand_hours', 'hydration_l', 'dietary_energy_kcal'
];
