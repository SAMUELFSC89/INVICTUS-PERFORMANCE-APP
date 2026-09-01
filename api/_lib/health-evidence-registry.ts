import type { HealthMetricType } from './health-data-layer.js';

export type ConfidenceLevel = 'A' | 'B' | 'C' | 'D' | 'E';
export type EvidenceScope = 'DEVICE_SPECIFIC' | 'FAMILY_LEVEL' | 'CATEGORY_LEVEL' | 'METRIC_LEVEL';
export type MeasurementContext = 'resting' | 'exercise' | 'daily_living' | 'sleep' | 'recovery' | 'derived' | 'unknown';
export type ProvenanceStatus = 'VERIFIED_DEVICE' | 'USER_DECLARED_DEVICE' | 'UNKNOWN_DEVICE' | 'LEGACY_UNKNOWN_SOURCE';

export interface ScientificReference {
  id: string;
  title: string;
  authors?: string;
  journal: string;
  year: number;
  doi?: string;
  pubmedUrl?: string;
  publisherUrl?: string;
  studyType: string;
  shortSummary: string;
}

export interface HealthEvidenceEntry {
  evidenceId: string;
  metricTypes: HealthMetricType[];
  manufacturer?: string;
  deviceFamily?: string;
  deviceModel?: string;
  hardwareVersion?: string;
  measurementContexts: MeasurementContext[];
  /** Nível científico de referência opcional da evidência; o resultado final
   * continua sendo calculado pelo motor configurável para cada leitura. */
  baseConfidenceLevel?: ConfidenceLevel;
  evidenceScope: EvidenceScope;
  evidenceStrength: 'strong' | 'moderate' | 'limited';
  studyCount?: number;
  limitations: string[];
  referenceIds: string[];
  reviewedAt: string;
  classificationVersion: string;
  status: 'active' | 'inactive';
}

export interface ConfidenceEngineConfig {
  version: string;
  thresholds: Record<ConfidenceLevel, number>;
  baseMetricScores: Partial<Record<HealthMetricType, number>>;
  contextModifiers: Partial<Record<MeasurementContext, number>>;
  provenanceModifiers: Record<ProvenanceStatus, number>;
  evidenceModifiers: Record<HealthEvidenceEntry['evidenceStrength'] | 'none', number>;
  completeness: { complete: number; partial: number; minimal: number };
  reviewedAt: string;
}

export const SCIENTIFIC_REFERENCES: ScientificReference[] = [
  {
    id: 'apple-watch-living-review-2026',
    title: 'The accuracy of Apple Watch measurements: a living systematic review and meta-analysis',
    journal: 'npj Digital Medicine', year: 2026, doi: '10.1038/s41746-025-02238-1',
    publisherUrl: 'https://www.nature.com/articles/s41746-025-02238-1',
    studyType: 'Systematic review and meta-analysis',
    shortSummary: 'Avalia diversas métricas do Apple Watch; a precisão varia por métrica, contexto, geração e características individuais.'
  },
  {
    id: 'commercial-wearables-review-2020',
    title: 'Reliability and Validity of Commercially Available Wearable Devices for Measuring Steps, Energy Expenditure, and Heart Rate: Systematic Review',
    journal: 'JMIR mHealth and uHealth', year: 2020, doi: '10.2196/18694',
    pubmedUrl: 'https://pubmed.ncbi.nlm.nih.gov/32897239/',
    publisherUrl: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC7509623/',
    studyType: 'Systematic review',
    shortSummary: 'Sintetiza validade e confiabilidade de passos, frequência cardíaca e gasto energético em wearables comerciais.'
  },
  {
    id: 'fitbit-meta-analysis-2022',
    title: 'Accuracy and Precision of Energy Expenditure, Heart Rate, and Steps Measured by Combined-Sensing Fitbits Against Reference Measures',
    journal: 'JMIR mHealth and uHealth', year: 2022,
    publisherUrl: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC9047731/',
    studyType: 'Systematic review and meta-analysis',
    shortSummary: 'Mostra variação por métrica, atividade e modelo; gasto energético apresentou incerteza relevante.'
  },
  {
    id: 'apple-heart-study-2019',
    title: 'Large-Scale Assessment of a Smartwatch to Identify Atrial Fibrillation',
    journal: 'The New England Journal of Medicine', year: 2019, doi: '10.1056/NEJMoa1901183',
    publisherUrl: 'https://www.nejm.org/doi/full/10.1056/NEJMoa1901183',
    studyType: 'Large-scale pragmatic study',
    shortSummary: 'Avalia notificações de pulso irregular em larga escala; não autoriza diagnóstico automático no aplicativo.'
  },
  {
    id: 'interlive-vo2max-2022',
    title: 'Validity of Estimating the Maximal Oxygen Consumption by Consumer Wearables',
    journal: 'Sports Medicine', year: 2022, doi: '10.1007/s40279-021-01639-y',
    pubmedUrl: 'https://pubmed.ncbi.nlm.nih.gov/35072942/',
    studyType: 'Systematic review, meta-analysis and expert statement',
    shortSummary: 'A estimativa de VO2máx varia conforme método e contexto; o erro individual ainda pode ser grande.'
  }
];

export const DEFAULT_EVIDENCE_REGISTRY: HealthEvidenceEntry[] = [
  {
    evidenceId: 'commercial-heart-rate', metricTypes: ['heart_rate', 'heart_rate_resting', 'heart_rate_avg', 'heart_rate_max'],
    measurementContexts: ['resting', 'exercise', 'daily_living', 'unknown'], evidenceScope: 'CATEGORY_LEVEL', evidenceStrength: 'moderate',
    limitations: ['Movimento, intensidade, ajuste no pulso, contato do sensor e características individuais podem alterar a leitura.'],
    referenceIds: ['commercial-wearables-review-2020'], reviewedAt: '2026-09-01', classificationVersion: '1.0.0', status: 'active'
  },
  {
    evidenceId: 'apple-watch-family', metricTypes: ['heart_rate', 'heart_rate_resting', 'heart_rate_avg', 'heart_rate_max', 'steps_daily', 'oxygen_saturation', 'sleep_duration_min', 'hrv_rmssd', 'calories_active', 'calories_total'],
    manufacturer: 'Apple', deviceFamily: 'Apple Watch', measurementContexts: ['resting', 'exercise', 'daily_living', 'sleep', 'recovery', 'unknown'],
    evidenceScope: 'FAMILY_LEVEL', evidenceStrength: 'moderate',
    limitations: ['A revisão reúne gerações e contextos diferentes; não prova precisão idêntica para todo modelo ou usuário.', 'Gasto energético e sono têm limitações maiores do que frequência cardíaca.'],
    referenceIds: ['apple-watch-living-review-2026'], reviewedAt: '2026-09-01', classificationVersion: '1.0.0', status: 'active'
  },
  {
    evidenceId: 'fitbit-family', metricTypes: ['heart_rate', 'heart_rate_resting', 'heart_rate_avg', 'heart_rate_max', 'steps_daily', 'calories_active', 'calories_total'],
    manufacturer: 'Fitbit', deviceFamily: 'Fitbit', measurementContexts: ['resting', 'exercise', 'daily_living', 'unknown'],
    evidenceScope: 'FAMILY_LEVEL', evidenceStrength: 'moderate',
    limitations: ['Resultados variam entre modelos, atividades e populações.', 'Estimativas de gasto energético apresentaram maior incerteza.'],
    referenceIds: ['fitbit-meta-analysis-2022'], reviewedAt: '2026-09-01', classificationVersion: '1.0.0', status: 'active'
  },
  {
    evidenceId: 'vo2max-wearables', metricTypes: ['vo2max_estimate'], measurementContexts: ['resting', 'exercise', 'unknown'],
    evidenceScope: 'METRIC_LEVEL', evidenceStrength: 'moderate',
    limitations: ['É uma estimativa; o erro individual pode ser grande e depende do algoritmo e do contexto.'],
    referenceIds: ['interlive-vo2max-2022'], reviewedAt: '2026-09-01', classificationVersion: '1.0.0', status: 'active'
  },
  {
    evidenceId: 'apple-irregular-pulse-special', metricTypes: ['atrial_fibrillation_detection'], manufacturer: 'Apple', deviceFamily: 'Apple Watch',
    measurementContexts: ['resting', 'daily_living', 'unknown'], evidenceScope: 'FAMILY_LEVEL', evidenceStrength: 'moderate',
    limitations: ['Notificação de pulso irregular não equivale a diagnóstico de fibrilação atrial.', 'Um resultado deve ser discutido com profissional de saúde.'],
    referenceIds: ['apple-heart-study-2019'], reviewedAt: '2026-09-01', classificationVersion: '1.0.0', status: 'active'
  }
];

export const DEFAULT_CONFIDENCE_CONFIG: ConfidenceEngineConfig = {
  version: '1.0.0', thresholds: { A: 85, B: 70, C: 50, D: 30, E: 0 },
  baseMetricScores: {
    heart_rate_resting: 88, heart_rate: 78, heart_rate_avg: 80, heart_rate_max: 76,
    duration_min: 90, exercise_duration_min: 88, steps_daily: 74, distance_km: 72, distance_cycling_km: 72,
    hrv_rmssd: 64, sleep_duration_min: 62, respiratory_rate: 65, oxygen_saturation: 58,
    vo2max_estimate: 56, body_temperature: 55, ecg: 50, atrial_fibrillation_detection: 50, calories_active: 38, calories_total: 35,
    calories_basal: 34, dietary_energy_kcal: 25
  },
  contextModifiers: { resting: 4, exercise: 0, daily_living: 0, sleep: -1, recovery: -1, derived: -4, unknown: -2 },
  provenanceModifiers: { VERIFIED_DEVICE: 3, USER_DECLARED_DEVICE: 1, UNKNOWN_DEVICE: -3, LEGACY_UNKNOWN_SOURCE: -6 },
  evidenceModifiers: { strong: 4, moderate: 2, limited: 0, none: -3 },
  completeness: { complete: 2, partial: 0, minimal: -3 }, reviewedAt: '2026-09-01'
};

export function referenceById(id: string): ScientificReference | undefined {
  return SCIENTIFIC_REFERENCES.find((reference) => reference.id === id);
}
