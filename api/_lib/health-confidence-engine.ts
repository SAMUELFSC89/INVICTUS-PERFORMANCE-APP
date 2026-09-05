import type { HealthMetricType } from './health-data-layer.js';
import {
  ConfidenceEngineConfig, ConfidenceLevel, DEFAULT_CONFIDENCE_CONFIG, DEFAULT_EVIDENCE_REGISTRY,
  HealthEvidenceEntry, MeasurementContext, ProvenanceStatus, referenceById
} from './health-evidence-registry.js';

export interface HealthProvenance {
  integration: 'APPLE_HEALTH' | 'HEALTH_CONNECT' | 'STRAVA' | 'INVICTUS' | 'UNKNOWN';
  dataOrigin?: string;
  applicationName?: string;
  recordingMethod?: 'automatic' | 'active' | 'manual' | 'unknown';
  deviceManufacturer?: string;
  deviceModel?: string;
  deviceName?: string;
  deviceType?: string;
  hardwareVersion?: string;
  firmwareVersion?: string;
  softwareVersion?: string;
  localIdentifier?: string;
  sourceVersion?: string;
  sourceProductType?: string;
  sourceOperatingSystemVersion?: string;
  status: ProvenanceStatus;
}

export interface ConfidenceAssessment {
  confidenceLevel: ConfidenceLevel;
  confidenceScore: number;
  confidenceReason: string;
  limitations: string[];
  evidenceReferences: Array<{ id: string; title: string; url?: string; scope: string }>;
  confidenceEngineVersion: string;
  measurementContext: MeasurementContext;
  provenanceStatus: ProvenanceStatus;
  assessedAt: string;
  derivedFrom?: string[];
  sourceConfidence?: number[];
}

export interface ConfidenceInput {
  metricType: HealthMetricType;
  provenance: HealthProvenance;
  measurementContext?: MeasurementContext;
  completeness?: 'complete' | 'partial' | 'minimal';
  derivedFrom?: string[];
  sourceConfidence?: number[];
  assessedAt?: string;
}

const METRIC_LIMITATIONS: Partial<Record<HealthMetricType, string[]>> = {
  calories_active: ['Gasto energético é uma estimativa algorítmica e pode variar significativamente.'],
  calories_total: ['Gasto energético total combina medições e estimativas; não é um valor exato.'],
  calories_basal: ['Metabolismo basal é estimado a partir de dados corporais e algoritmos.'],
  hrv_rmssd: ['HRV varia com horário, postura, respiração, sono, estresse e qualidade do sinal.'],
  hrv_sdnn: ['HRV SDNN varia com duração da janela, horário, postura e qualidade do sinal; não é intercambiável com RMSSD.'],
  sleep_duration_min: ['Wearables inferem sono a partir de sinais indiretos e podem confundir repouso e sono.'],
  oxygen_saturation: ['Movimento, perfusão, temperatura e ajuste do sensor podem afetar SpO2.'],
  vo2max_estimate: ['VO2máx do wearable é uma estimativa e não substitui teste cardiopulmonar.']
  ,ecg: ['Um traçado de ECG de wearable exige interpretação apropriada e não deve ser diagnosticado automaticamente.'],
  atrial_fibrillation_detection: ['Uma notificação de ritmo irregular não confirma diagnóstico e requer avaliação profissional.']
};

function normalize(value?: string): string { return (value || '').trim().toLowerCase(); }

function evidenceFor(input: ConfidenceInput, registry: HealthEvidenceEntry[]): HealthEvidenceEntry[] {
  const manufacturer = normalize(input.provenance.deviceManufacturer);
  const modelText = normalize(`${input.provenance.deviceName || ''} ${input.provenance.deviceModel || ''} ${input.provenance.sourceProductType || ''}`);
  return registry.filter((entry) => {
    if (entry.status !== 'active' || !entry.metricTypes.includes(input.metricType)) return false;
    if (!entry.measurementContexts.includes(input.measurementContext || 'unknown')) return false;
    if (entry.manufacturer && !manufacturer.includes(normalize(entry.manufacturer))) return false;
    if (entry.deviceFamily && !modelText.includes(normalize(entry.deviceFamily))) return false;
    if (entry.deviceModel && !modelText.includes(normalize(entry.deviceModel))) return false;
    return true;
  }).sort((a, b) => ['METRIC_LEVEL', 'CATEGORY_LEVEL', 'FAMILY_LEVEL', 'DEVICE_SPECIFIC'].indexOf(b.evidenceScope) - ['METRIC_LEVEL', 'CATEGORY_LEVEL', 'FAMILY_LEVEL', 'DEVICE_SPECIFIC'].indexOf(a.evidenceScope));
}

function levelFor(score: number, thresholds = DEFAULT_CONFIDENCE_CONFIG.thresholds): ConfidenceLevel {
  if (score >= thresholds.A) return 'A';
  if (score >= thresholds.B) return 'B';
  if (score >= thresholds.C) return 'C';
  if (score >= thresholds.D) return 'D';
  return 'E';
}

export function inferMeasurementContext(metricType: HealthMetricType): MeasurementContext {
  if (metricType === 'heart_rate_resting') return 'resting';
  if (metricType === 'heart_rate_avg' || metricType === 'heart_rate_max' || metricType === 'duration_min' || metricType === 'exercise_duration_min') return 'exercise';
  if (metricType === 'sleep_duration_min') return 'sleep';
  if (metricType === 'hrv_rmssd' || metricType === 'hrv_sdnn') return 'recovery';
  return 'daily_living';
}

export function assessHealthConfidence(input: ConfidenceInput, registry = DEFAULT_EVIDENCE_REGISTRY, config: ConfidenceEngineConfig = DEFAULT_CONFIDENCE_CONFIG): ConfidenceAssessment {
  const context = input.measurementContext || inferMeasurementContext(input.metricType);
  const normalized = { ...input, measurementContext: context };
  const evidence = evidenceFor(normalized, registry);
  const strongest = evidence[0];
  // Métrica sem matriz revisada começa conservadoramente; nunca recebe uma
  // nota alta apenas por existir no HealthKit/Health Connect.
  const base = config.baseMetricScores[input.metricType] ?? 35;
  let score = base
    + (config.contextModifiers[context] ?? 0)
    + config.provenanceModifiers[input.provenance.status]
    + config.evidenceModifiers[strongest?.evidenceStrength || 'none']
    + config.completeness[input.completeness || 'partial'];

  if (input.provenance.recordingMethod === 'manual') score -= 5;
  if (input.derivedFrom?.length) {
    score += config.contextModifiers.derived || 0;
    const weakestSource = input.sourceConfidence?.length ? Math.min(...input.sourceConfidence) : score;
    score = Math.min(score, weakestSource);
  }
  score = Math.max(0, Math.min(100, Math.round(score)));
  const refs = evidence.flatMap((entry) => entry.referenceIds.map((id) => ({ entry, ref: referenceById(id) })))
    .filter((item) => Boolean(item.ref))
    .filter((item, index, all) => all.findIndex((other) => other.ref?.id === item.ref?.id) === index)
    .map(({ entry, ref }) => ({ id: ref!.id, title: ref!.title, url: ref!.publisherUrl || ref!.pubmedUrl, scope: entry.evidenceScope }));
  const limitations = [...new Set([...(METRIC_LIMITATIONS[input.metricType] || []), ...evidence.flatMap((entry) => entry.limitations)])];
  if (input.provenance.status === 'UNKNOWN_DEVICE' || input.provenance.status === 'LEGACY_UNKNOWN_SOURCE') limitations.push('O dispositivo que gerou esta leitura não foi identificado tecnicamente.');
  if (input.provenance.status === 'USER_DECLARED_DEVICE') limitations.push('O dispositivo foi informado pelo usuário e não confirmado pelos metadados técnicos desta leitura.');
  const confidenceLevel = levelFor(score, config.thresholds);
  const deviceText = input.provenance.deviceModel || input.provenance.deviceName || input.provenance.deviceManufacturer;
  const confidenceReason = `${deviceText ? `Origem atribuída a ${deviceText}` : 'Origem de hardware não identificada'}; nível-base da métrica, contexto ${context}, completude e evidência disponível foram combinados pela versão ${config.version}.`;
  return {
    confidenceLevel, confidenceScore: score, confidenceReason, limitations, evidenceReferences: refs,
    confidenceEngineVersion: config.version, measurementContext: context, provenanceStatus: input.provenance.status,
    assessedAt: input.assessedAt || new Date().toISOString(), derivedFrom: input.derivedFrom, sourceConfidence: input.sourceConfidence
  };
}

export function deriveProvenanceStatus(provenance: Omit<HealthProvenance, 'status'>, legacy = false): ProvenanceStatus {
  if (legacy) return 'LEGACY_UNKNOWN_SOURCE';
  if (provenance.deviceManufacturer || provenance.deviceModel || provenance.deviceName || provenance.deviceType || provenance.localIdentifier || provenance.sourceProductType) return 'VERIFIED_DEVICE';
  return 'UNKNOWN_DEVICE';
}

export function confidenceLabel(level: ConfidenceLevel): string {
  return ({ A: 'Alta confiança', B: 'Boa confiança', C: 'Confiança moderada', D: 'Confiança limitada', E: 'Evidência insuficiente' })[level];
}
