import { Capacitor } from '@capacitor/core';
// #12: importado via alias npm 'capgo-capacitor-health' (aponta pro mesmo
// pacote @capgo/capacitor-health), NAO pelo nome real do pacote. Motivo,
// em 2 rodadas de erro real no Codemagic:
//
// 1ª falha: "Conflicting identity for capacitor-health" -- o SPM usa o
// ULTIMO SEGMENTO DO CAMINHO local (node_modules/<pasta>) como identidade
// de pacote quando referenciado por path, e o npm instala
// "@capgo/capacitor-health" numa pasta cujo ultimo segmento e literalmente
// "capacitor-health", igual a pasta do plugin do mley. Tentativa 1 usou o
// alias 'capgo-health-vitals' pra resolver isso.
//
// 2ª falha (causada pela tentativa 1): "product 'CapgoHealthVitals' ...
// not found in package 'CapgoHealthVitals'". O `cap sync ios` do Capacitor
// gera o Package.swift agregador (CapApp-SPM) assumindo, por CONVENCAO,
// que o nome do "product" de cada plugin e o PascalCase do nome da
// dependencia local no package.json -- ele nao le o Package.swift real do
// plugin pra descobrir o nome verdadeiro. 'capgo-health-vitals' virou
// "CapgoHealthVitals", mas o product real dentro do pacote da Capgo se
// chama "CapgoCapacitorHealth" (conferido no Package.swift oficial,
// Cap-go/capacitor-health) -- descasou.
//
// Fix: o alias tem que ser o PascalCase EXATO do product real, então usei
// 'capgo-capacitor-health' (-> "CapgoCapacitorHealth"), que também
// continua com ultimo segmento diferente de "capacitor-health" (resolve a
// 1ª falha) e agora bate com o nome real do product (resolve a 2ª).
import { Health as CapgoHealth } from 'capgo-capacitor-health';

// Leitura de métricas passivas de atividade, condicionamento e bem-estar via
// @capgo/capacitor-health -- plugin DIFERENTE do "capacitor-health" (mley)
// usado por AppleHealthProvider/HealthConnectProvider para treinos.
//
// Por que dois plugins em vez de trocar um pelo outro: o Capgo tem API mais
// limpa e cobre HRV/FC repouso/sono/peso, que o mley nunca exps -- mas o
// `queryWorkouts()` do Capgo NAO devolve rota GPS nem serie de FC por treino
// (confirmado na definicao oficial do plugin, tipo `Workout` sem campos
// `route`/`heartRate`). O mley devolve os dois (`w.route`, `w.heartRate`),
// e e exatamente disso que o antifraude depende pra nao tratar toda corrida
// de wearable como "sem GPS" (fix #248). Trocar o mley pelo Capgo pra
// atividades regrediria o #248. Os dois plugins coexistem de proposito: mley
// = ingestao de treino (fetchActivities/querySessionMetrics, intocado),
// Capgo = vitais passivas (este arquivo, novo).
//
// Vitais aqui NAO alimentam o SecurityPipeline nem o IGA -- vao direto pra
// Health Data Layer (health_samples) via action 'sync-vitals'. Ver
// api/_lib/health-data-layer.ts::registrarAmostrasPassivas.

export type VitalMetricType =
  | 'heart_rate' | 'heart_rate_resting' | 'hrv_rmssd'
  | 'sleep_duration_min' | 'weight_kg' | 'steps_daily'
  | 'calories_active' | 'calories_total' | 'calories_basal'
  | 'distance_km' | 'distance_cycling_km'
  | 'respiratory_rate' | 'oxygen_saturation' | 'vo2max_estimate'
  | 'blood_pressure_systolic' | 'blood_pressure_diastolic'
  | 'blood_glucose' | 'body_temperature' | 'height_cm'
  | 'flights_climbed' | 'exercise_duration_min' | 'body_fat_percent'
  | 'mindfulness_duration_min' | 'stand_hours' | 'hydration_l'
  | 'dietary_energy_kcal';

export interface VitalSample {
  metricType: VitalMetricType;
  value: number;
  unit: string;
  timestamp: string; // compatibilidade: igual a endDate
  startDate: string;
  endDate: string;
  sourceId?: string;
  platformId?: string;
  sampleId: string;
  device?: string;
  integration: 'APPLE_HEALTH' | 'HEALTH_CONNECT';
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
}

const COMMON_READ_TYPES = [
  'heartRate', 'restingHeartRate', 'heartRateVariability', 'sleep', 'weight', 'steps',
  'calories', 'totalCalories', 'basalCalories', 'distance', 'distanceCycling',
  'respiratoryRate', 'oxygenSaturation', 'vo2Max', 'bloodPressure', 'bloodGlucose', 'bodyTemperature',
  'height', 'flightsClimbed', 'bodyFat', 'mindfulness',
  'dietaryWater', 'dietaryEnergyConsumed', 'workouts'
] as const;

const IOS_ONLY_READ_TYPES = ['exerciseTime', 'appleStandHour'] as const;

function readTypes() {
  return Capacitor.getPlatform() === 'ios'
    ? [...COMMON_READ_TYPES, ...IOS_ONLY_READ_TYPES]
    : [...COMMON_READ_TYPES];
}

function sampleId(metricType: VitalMetricType, startDate: string, endDate: string, platformId?: string, sourceId?: string) {
  return platformId || `${sourceId || 'health'}:${metricType}:${startDate}:${endDate}`;
}

function normalizar(metricType: VitalMetricType, value: number, unit: string, sample: {
  startDate: string; endDate: string; sourceName?: string; sourceId?: string; platformId?: string;
  dataOrigin?: string; recordingMethod?: 'automatic' | 'active' | 'manual' | 'unknown';
  deviceManufacturer?: string; deviceModel?: string; deviceName?: string; deviceType?: string;
  hardwareVersion?: string; firmwareVersion?: string; softwareVersion?: string; localIdentifier?: string;
  sourceVersion?: string; sourceProductType?: string; sourceOperatingSystemVersion?: string;
}): VitalSample {
  return {
    metricType, value, unit,
    timestamp: sample.endDate,
    startDate: sample.startDate,
    endDate: sample.endDate,
    sourceId: sample.sourceId,
    platformId: sample.platformId,
    sampleId: sampleId(metricType, sample.startDate, sample.endDate, sample.platformId, sample.sourceId),
    device: sample.deviceName || [sample.deviceManufacturer, sample.deviceModel].filter(Boolean).join(' ') || sample.sourceName,
    integration: Capacitor.getPlatform() === 'ios' ? 'APPLE_HEALTH' : 'HEALTH_CONNECT',
    dataOrigin: sample.dataOrigin || sample.sourceId,
    applicationName: sample.sourceName,
    recordingMethod: sample.recordingMethod,
    deviceManufacturer: sample.deviceManufacturer,
    deviceModel: sample.deviceModel,
    deviceName: sample.deviceName,
    deviceType: sample.deviceType,
    hardwareVersion: sample.hardwareVersion,
    firmwareVersion: sample.firmwareVersion,
    softwareVersion: sample.softwareVersion,
    localIdentifier: sample.localIdentifier,
    sourceVersion: sample.sourceVersion,
    sourceProductType: sample.sourceProductType,
    sourceOperatingSystemVersion: sample.sourceOperatingSystemVersion
  };
}

function isSupportedPlatform(): boolean {
  const plataforma = Capacitor.getPlatform();
  return Capacitor.isNativePlatform() && (plataforma === 'ios' || plataforma === 'android');
}

function valorValido(valor: unknown): valor is number {
  return typeof valor === 'number' && Number.isFinite(valor) && valor > 0;
}

/**
 * Sono: HealthKit/Health Connect devolvem UM registro por SEGMENTO de estagio
 * (ex.: "asleep" das 23h as 23h40, "awake" das 23h40 as 23h45...), nunca um
 * total pronto. Somamos apenas os segmentos que representam sono real
 * (tudo exceto 'inBed'/'awake'), agrupados pela data (AAAA-MM-DD) do inicio
 * de cada segmento. Isso e uma simplificacao honesta, nao um calculo preciso
 * de "noite": uma sessao de sono que atravessa a meia-noite pode ficar
 * dividida entre duas datas. Preferimos essa aproximacao documentada a
 * inventar uma logica de fuso/corte-as-18h sem confirmar com dado real de
 * device.
 */
function agruparSonoPorNoite(samples: Array<{ sleepState?: string; startDate: string; endDate: string; sourceName?: string; sourceId?: string; platformId?: string }>): VitalSample[] {
  const porNoite = new Map<string, { minutos: number; inicio: string; fim: string; device?: string; sourceId?: string; ids: string[] }>();
  for (const s of samples) {
    if (s.sleepState === 'awake' || s.sleepState === 'inBed') continue;
    const inicio = new Date(s.startDate).getTime();
    const fim = new Date(s.endDate).getTime();
    if (!Number.isFinite(inicio) || !Number.isFinite(fim) || fim <= inicio) continue;
    const minutos = (fim - inicio) / 60000;
    const chave = s.startDate.slice(0, 10);
    const atual = porNoite.get(chave) || { minutos: 0, inicio: s.startDate, fim: s.endDate, device: s.sourceName, sourceId: s.sourceId, ids: [] };
    atual.minutos += minutos;
    if (s.startDate < atual.inicio) atual.inicio = s.startDate;
    if (s.endDate > atual.fim) atual.fim = s.endDate;
    atual.ids.push(s.platformId || `${s.startDate}:${s.endDate}`);
    porNoite.set(chave, atual);
  }
  const resultado: VitalSample[] = [];
  for (const [, dados] of porNoite) {
    if (dados.minutos <= 0) continue;
    resultado.push({ ...normalizar('sleep_duration_min', Math.round(dados.minutos), 'min', {
      startDate: dados.inicio, endDate: dados.fim, sourceName: dados.device, sourceId: dados.sourceId,
      platformId: `sleep:${dados.ids.sort().join('|')}`
    }) });
  }
  return resultado;
}

export const HealthVitalsProvider = {
  async isAvailable(): Promise<boolean> {
    if (!isSupportedPlatform()) return false;
    try {
      const { available } = await CapgoHealth.isAvailable();
      return available;
    } catch (error) {
      console.warn('[HealthVitalsProvider] isAvailable falhou:', error);
      return false;
    }
  },

  async requestPermissions(): Promise<boolean> {
    if (!isSupportedPlatform()) return false;
    try {
      const status = await CapgoHealth.requestAuthorization({ read: readTypes(), requestHistoryAccess: true });
      // Assim como no HealthKit do mley, o iOS nao confirma negacao de
      // leitura com certeza -- so tratamos como concedido se pelo menos um
      // tipo apareceu como autorizado.
      return Array.isArray(status.readAuthorized) && status.readAuthorized.length > 0;
    } catch (error) {
      console.error('[HealthVitalsProvider] Erro ao solicitar permissões:', error);
      return false;
    }
  },

  async fetchVitals(since: Date): Promise<VitalSample[]> {
    if (!isSupportedPlatform()) return [];
    const startDate = since.toISOString();
    const endDate = new Date().toISOString();
    const amostras: VitalSample[] = [];

    const rawSpecs = [
      ['heartRate', 'heart_rate', 'bpm', 10000], ['restingHeartRate', 'heart_rate_resting', 'bpm', 500],
      ['heartRateVariability', 'hrv_rmssd', 'ms', 300], ['weight', 'weight_kg', 'kg', 100],
      ['respiratoryRate', 'respiratory_rate', 'resp/min', 300], ['oxygenSaturation', 'oxygen_saturation', '%', 300],
      ['vo2Max', 'vo2max_estimate', 'mL/min/kg', 100], ['bloodGlucose', 'blood_glucose', 'mg/dL', 200],
      ['bodyTemperature', 'body_temperature', '°C', 200], ['height', 'height_cm', 'cm', 50],
      ['flightsClimbed', 'flights_climbed', 'andares', 500], ['exerciseTime', 'exercise_duration_min', 'min', 500],
      ['bodyFat', 'body_fat_percent', '%', 100], ['mindfulness', 'mindfulness_duration_min', 'min', 500],
      ['appleStandHour', 'stand_hours', 'h', 500], ['dietaryWater', 'hydration_l', 'L', 500],
      ['dietaryEnergyConsumed', 'dietary_energy_kcal', 'kcal', 500],
      // Estes tipos não aceitam queryAggregated no Health Connect. Ler as
      // amostras funciona nas duas plataformas e mantém origem/data/hora.
      ['totalCalories', 'calories_total', 'kcal', 2000], ['basalCalories', 'calories_basal', 'kcal', 1000],
      ['distanceCycling', 'distance_cycling_km', 'km', 2000]
    ] as const;
    for (const [dataType, metricType, unit, limit] of rawSpecs) {
      if (Capacitor.getPlatform() !== 'ios' && (dataType === 'exerciseTime' || dataType === 'appleStandHour')) continue;
      try {
        const { samples } = await CapgoHealth.readSamples({ dataType, startDate, endDate, limit, ascending: true });
        for (const s of samples || []) {
          if (!valorValido(s.value)) continue;
          const value = dataType === 'distanceCycling' ? s.value / 1000 : s.value;
          amostras.push(normalizar(metricType, Math.round(value * 100) / 100, unit, s));
        }
      } catch (error) {
        console.warn(`[HealthVitalsProvider] Falha ao ler ${dataType}:`, error);
      }
    }

    try {
      const { samples } = await CapgoHealth.readSamples({ dataType: 'bloodPressure', startDate, endDate, limit: 200, ascending: true });
      for (const s of samples || []) {
        if (valorValido(s.systolic)) amostras.push(normalizar('blood_pressure_systolic', Math.round(s.systolic), 'mmHg', s));
        if (valorValido(s.diastolic)) amostras.push(normalizar('blood_pressure_diastolic', Math.round(s.diastolic), 'mmHg', s));
      }
    } catch (error) {
      console.warn('[HealthVitalsProvider] Falha ao ler bloodPressure:', error);
    }

    try {
      const { samples } = await CapgoHealth.readSamples({ dataType: 'sleep', startDate, endDate, limit: 500, ascending: true });
      amostras.push(...agruparSonoPorNoite(samples || []));
    } catch (error) {
      console.warn('[HealthVitalsProvider] Falha ao ler sleep:', error);
    }

    // Passos: usamos queryAggregated (bucket=day, sum) em vez de somar
    // amostras cruas -- e o metodo que o proprio plugin recomenda pra volume
    // alto de dados (steps gera muitas amostras por dia) e evita duplicar
    // contagem se duas fontes reportarem o mesmo intervalo.
    try {
      const { samples } = await CapgoHealth.queryAggregated({ dataType: 'steps', startDate, endDate, bucket: 'day', aggregation: 'sum' });
      for (const s of samples || []) {
        if (!valorValido(s.value)) continue;
        amostras.push(normalizar('steps_daily', Math.round(s.value), 'passos', { startDate: s.startDate, endDate: s.endDate }));
      }
    } catch (error) {
      console.warn('[HealthVitalsProvider] Falha ao ler steps agregados:', error);
    }

    const aggregateSpecs = [
      ['calories', 'calories_active', 'kcal'], ['distance', 'distance_km', 'km']
    ] as const;
    for (const [dataType, metricType, unit] of aggregateSpecs) {
      try {
        const { samples } = await CapgoHealth.queryAggregated({ dataType, startDate, endDate, bucket: 'day', aggregation: 'sum' });
        for (const s of samples || []) {
          if (!valorValido(s.value)) continue;
          const value = dataType.startsWith('distance') ? s.value / 1000 : s.value;
          amostras.push(normalizar(metricType, Math.round(value * 100) / 100, unit, { startDate: s.startDate, endDate: s.endDate }));
        }
      } catch (error) {
        console.warn(`[HealthVitalsProvider] Falha ao agregar ${dataType}:`, error);
      }
    }

    return Array.from(new Map(amostras.map((sample) => [`${sample.metricType}:${sample.sampleId}`, sample])).values());
  }
};
