import { db } from './common.js';

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
  | 'heart_rate_resting'   // ainda nao coletado (nenhuma fonte manda hoje)
  | 'hrv_rmssd'            // ainda nao coletado
  | 'vo2max_estimate'      // calculado no cliente (performanceEngine.ts), nao no servidor -- integracao futura
  | 'sleep_duration_min'   // ainda nao coletado
  | 'weight_kg'            // ainda nao coletado
  | 'calories_active'
  | 'distance_km'
  | 'duration_min';

export type HealthSampleSource =
  | 'apple_health'
  | 'health_connect'
  | 'strava'
  | 'invictus_manual'
  | 'invictus_gps';

/**
 * Confiabilidade da leitura, INDEPENDENTE de ela ter pontuado no IGA.
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
  source: HealthSampleSource;
  sourceActivityId?: string; // referencia ao doc de `workouts`, quando aplicavel
  device?: string;
  quality: HealthSampleQuality;
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
    const id = `${sample.source}_${sample.sourceActivityId || sample.timestamp}_${sample.metricType}`;
    await db.collection(HEALTH_SAMPLES_COLLECTION).doc(id).set({
      ...sample,
      id,
      createdAt: new Date().toISOString()
    }, { merge: true });
  } catch (err) {
    console.error('[HealthDataLayer] Falha ao gravar amostra (nao-fatal):', err);
  }
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
  if (typeof params.distanceKm === 'number' && params.distanceKm > 0) {
    gravacoes.push(gravarAmostraSaude({ ...base, metricType: 'distance_km', value: params.distanceKm, unit: 'km' }));
  }
  if (typeof params.durationMin === 'number' && params.durationMin > 0) {
    gravacoes.push(gravarAmostraSaude({ ...base, metricType: 'duration_min', value: params.durationMin, unit: 'min' }));
  }

  await Promise.all(gravacoes);
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
  return snap.docs.map((d) => d.data() as HealthSample);
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

/** O que esta camada realmente grava hoje (Fase 1) -- ver wearable-sync-service.ts. */
export const metricsGravadasHoje: HealthMetricType[] = [
  'heart_rate_avg', 'heart_rate_max', 'calories_active', 'distance_km', 'duration_min'
];
