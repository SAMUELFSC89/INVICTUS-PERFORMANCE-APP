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
import type { HealthSample, HealthDataType } from 'capgo-capacitor-health';

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
  | 'heart_rate' | 'heart_rate_resting' | 'hrv_rmssd' | 'hrv_sdnn'
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
  normalizationVersion: 2;
  aggregation: 'daily_total' | 'sleep_session' | 'sample';
  localDate?: string;
  timeZone?: string;
  derivedFrom?: string[];
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

export interface HealthReadDiagnostic {
  dataType: string;
  metricType: string;
  status: 'ok' | 'empty' | 'error' | 'denied';
  count: number;
  error?: string;
}

export interface HealthVitalsDiagnostics {
  since: string;
  until: string;
  reads: HealthReadDiagnostic[];
  failedTypes: string[];
  emptyTypes: string[];
  readComplete?: boolean;
}

export interface HealthPermissionSnapshot {
  readAuthorized: string[];
  readDenied: string[];
  readStatusKnown?: boolean;
  historyAccessAuthorized?: boolean;
  historyAccessAvailable?: boolean;
}

const COMMON_READ_TYPES = [
  'heartRate', 'restingHeartRate', 'heartRateVariability', 'sleep', 'weight', 'steps',
  'calories', 'totalCalories', 'distance', 'distanceCycling',
  'respiratoryRate', 'oxygenSaturation', 'vo2Max', 'bloodPressure',
  'bodyFat', 'mindfulness', 'dietaryWater', 'workouts'
] as const;

// Android basalCalories is kcal/day, which our energy-total metric cannot
// represent. Glucose, temperature, height, floors and dietary energy have no
// user-facing consumer: neither ask for access nor collect them silently.
const IOS_ONLY_READ_TYPES = ['exerciseTime', 'appleStandHour', 'basalCalories'] as const;

function readTypes() {
  return Capacitor.getPlatform() === 'ios'
    ? [...COMMON_READ_TYPES, ...IOS_ONLY_READ_TYPES]
    : [...COMMON_READ_TYPES];
}

function sampleId(metricType: VitalMetricType, startDate: string, endDate: string, platformId?: string, sourceId?: string, value?: number) {
  // A Health Connect HeartRateRecord owns many timestamped points under one
  // metadata.id. Keep the native record ID for provenance, but persist each
  // point separately. Existing iOS UUIDs and all other metric IDs stay stable.
  if (metricType === 'heart_rate' && Capacitor.getPlatform() === 'android') {
    return `hr-point:v1:${JSON.stringify([startDate, endDate, value, platformId || sourceId || 'health'])}`;
  }
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
    normalizationVersion: 2,
    aggregation: 'sample',
    metricType, value, unit,
    timestamp: sample.endDate,
    startDate: sample.startDate,
    endDate: sample.endDate,
    sourceId: sample.sourceId,
    platformId: sample.platformId,
    sampleId: sampleId(metricType, sample.startDate, sample.endDate, sample.platformId, sample.sourceId, value),
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

// Calendar dates are stored separately from instants. Noon-to-noon windows
// keep the segments of an overnight sleep together, including DST changes.
const calendarFormatters = new Map<string, Intl.DateTimeFormat>();
function calendarParts(at: number, timeZone: string) {
  let formatter = calendarFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
    });
    calendarFormatters.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(new Date(at));
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function calendarDay(at: number, timeZone: string): string {
  const p = calendarParts(at, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

function nextCalendarDay(day: string): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
}

function localHourInstant(day: string, hour: number, timeZone: string): number {
  const target = Date.parse(`${day}T${String(hour).padStart(2, '0')}:00:00Z`);
  let result = target;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const p = calendarParts(result, timeZone);
    const represented = Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);
    const difference = target - represented;
    result += difference;
    if (difference === 0) break;
  }
  return result;
}

function abortIfRequested(signal?: AbortSignal) {
  if (signal?.aborted) throw new Error('Sincronização de saúde cancelada.');
}

async function nativeRead<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  abortIfRequested(signal);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Tempo limite de leitura do dispositivo.')), 20000);
        onAbort = () => reject(new Error('Sincronização de saúde cancelada.'));
        signal?.addEventListener('abort', onAbort, { once: true });
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    if (onAbort) signal?.removeEventListener('abort', onAbort);
  }
}

/** A full page is never proof that a period was completely read. */
export async function readCompleteHealthRange(
  dataType: HealthDataType, start: Date, end: Date, limit: number, signal?: AbortSignal
): Promise<HealthSample[]> {
  let requests = 0;
  const visit = async (from: number, to: number): Promise<HealthSample[]> => {
    abortIfRequested(signal);
    if (++requests > 128) throw new Error('Histórico denso: a leitura precisa continuar em uma janela menor.');
    const { samples = [] } = await nativeRead(() => CapgoHealth.readSamples({
      dataType, startDate: new Date(from).toISOString(), endDate: new Date(to).toISOString(), limit, ascending: true
    }), signal);
    if (samples.length < limit) return samples;
    if (to - from <= 1000) throw new Error('Limite de amostras no mesmo instante; histórico ainda incompleto.');
    const middle = Math.floor((from + to) / 2);
    const left = await visit(from, middle);
    const right = await visit(middle, to);
    return [...left, ...right];
  };
  const samples = await visit(start.getTime(), end.getTime());
  // HealthKit can return an interval in both halves of an overlapping query.
  // Android HR series reuse the record's platformId for every point: using
  // only that ID silently reduced an entire curve to its last reading.
  return Array.from(new Map(samples.map((sample) => [
    dataType === 'heartRate'
      ? JSON.stringify([sample.platformId || '', sample.sourceId || '', sample.startDate, sample.endDate, sample.value])
      : sample.platformId || `${sample.sourceId || ''}:${sample.startDate}:${sample.endDate}:${sample.value}:${sample.sleepState || ''}`,
    sample
  ])).values());
}

/** Known sleep stages only; a session with unknown stages is not all asleep. */
export function aggregateSleepSamples(samples: HealthSample[], timeZone: string): VitalSample[] {
  type Interval = { start: number; end: number; sample: HealthSample };
  const nights = new Map<string, Interval[]>();
  const asleep = new Set(['asleep', 'rem', 'deep', 'light']);
  for (const sample of samples) {
    const segments = sample.stages?.length
      ? sample.stages.map((stage) => ({ startDate: stage.startDate, endDate: stage.endDate, state: stage.stage }))
      : [{ startDate: sample.startDate, endDate: sample.endDate, state: sample.sleepState }];
    for (const segment of segments) {
      if (!segment.state || !asleep.has(segment.state)) continue;
      let start = Date.parse(segment.startDate);
      const end = Date.parse(segment.endDate);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 48 * 3600000) continue;
      while (start < end) {
        const day = calendarDay(start, timeZone);
        const night = Number(calendarParts(start, timeZone).hour) >= 12 ? nextCalendarDay(day) : day;
        const boundary = localHourInstant(night, 12, timeZone);
        if (boundary <= start) break;
        const clippedEnd = Math.min(end, boundary);
        const intervals = nights.get(night) || [];
        intervals.push({ start, end: clippedEnd, sample });
        nights.set(night, intervals);
        start = clippedEnd;
      }
    }
  }
  const output: VitalSample[] = [];
  for (const [localDate, intervals] of nights) {
    intervals.sort((a, b) => a.start - b.start || a.end - b.end);
    let start = intervals[0].start;
    let end = intervals[0].end;
    let duration = 0;
    for (const interval of intervals.slice(1)) {
      if (interval.start <= end) end = Math.max(end, interval.end);
      else { duration += end - start; start = interval.start; end = interval.end; }
    }
    duration += end - start;
    const origins = new Set(intervals.map(({ sample }) => [
      sample.sourceId, sample.dataOrigin, sample.deviceManufacturer, sample.deviceModel,
      sample.deviceName, sample.localIdentifier, sample.sourceProductType
    ].map((value) => value || '').join(':')));
    const first = intervals[0].sample;
    // A union of different sources must not inherit one device's confidence.
    const metadata = origins.size === 1 ? first : {};
    const beginning = new Date(intervals[0].start).toISOString();
    const finish = new Date(Math.max(...intervals.map((interval) => interval.end))).toISOString();
    output.push({
      ...normalizar('sleep_duration_min', Math.round(duration / 60000), 'min', {
        ...metadata, startDate: beginning, endDate: finish,
        platformId: `sleep:v2:${timeZone}:${localDate}`
      }),
      aggregation: 'sleep_session', localDate, timeZone,
      derivedFrom: Array.from(new Set(intervals.map(({ sample }) => sample.platformId || `${sample.sourceId || 'unknown'}:${sample.startDate}:${sample.endDate}`))).slice(0, 100)
    });
  }
  return output;
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
      const status = await CapgoHealth.requestAuthorization({ read: readTypes(), requestHistoryAccess: false });
      // On iOS this confirms that the request flow completed, not that data
      // is readable. HealthKit deliberately does not disclose read grants.
      return Array.isArray(status.readAuthorized) && status.readAuthorized.length > 0;
    } catch (error) {
      console.error('[HealthVitalsProvider] Erro ao solicitar permissões:', error);
      return false;
    }
  },

  async checkPermissions(): Promise<HealthPermissionSnapshot | null> {
    if (!isSupportedPlatform()) return null;
    try {
      const status = await CapgoHealth.checkAuthorization({ read: readTypes(), requestHistoryAccess: false });
      return {
        readAuthorized: Capacitor.getPlatform() === 'ios' ? [] : Array.isArray(status.readAuthorized) ? status.readAuthorized.map(String) : [],
        readDenied: Capacitor.getPlatform() === 'ios' ? [] : Array.isArray(status.readDenied) ? status.readDenied.map(String) : [],
        readStatusKnown: Capacitor.getPlatform() !== 'ios',
        historyAccessAuthorized: status.historyAccessAuthorized,
        historyAccessAvailable: status.historyAccessAvailable
      };
    } catch (error) {
      console.warn('[HealthVitalsProvider] Não foi possível confirmar as permissões atuais:', error);
      return null;
    }
  },

  async fetchVitals(since: Date): Promise<VitalSample[]> {
    const result = await this.fetchVitalsWithDiagnostics(since);
    return result.samples;
  },

  /**
   * Igual à leitura normal, mas informa por tipo se o HealthKit/Health
   * Connect realmente devolveu amostras. Isso permite diferenciar "não há
   * dados" de "o usuário não autorizou passos/FC" na tela do Invictus.
   */
  async fetchVitalsWithDiagnostics(since: Date, options: { until?: Date; signal?: AbortSignal; permissions?: HealthPermissionSnapshot | null } = {}): Promise<{ samples: VitalSample[]; diagnostics: HealthVitalsDiagnostics }> {
    if (!isSupportedPlatform()) {
      const now = new Date().toISOString();
      return { samples: [], diagnostics: { since: since.toISOString(), until: now, reads: [], failedTypes: [], emptyTypes: [] } };
    }
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const until = options.until || new Date();
    if (!Number.isFinite(since.getTime()) || !Number.isFinite(until.getTime()) || since >= until) throw new Error('Intervalo de saúde inválido.');
    let start = localHourInstant(calendarDay(since.getTime(), timeZone), 0, timeZone);
    if (Capacitor.getPlatform() === 'android') {
      // Without history permission, even a midnight/sleep expansion must stay
      // inside the native 30-day limit. Start at a complete local day with
      // room for the preceding night's 12-hour lookup; never request an
      // unlimited history scope just to round a date.
      const earliestStartWithSleepMargin = until.getTime() - 30 * 86400000 + 12 * 3600000;
      if (start < earliestStartWithSleepMargin) {
        const earliestDay = calendarDay(earliestStartWithSleepMargin, timeZone);
        const midnight = localHourInstant(earliestDay, 0, timeZone);
        const nextDay = new Date(Date.parse(`${earliestDay}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
        start = midnight >= earliestStartWithSleepMargin ? midnight : localHourInstant(nextDay, 0, timeZone);
      }
    }
    const startDate = new Date(start).toISOString();
    const endDate = until.toISOString();
    const denied = new Set(options.permissions?.readStatusKnown ? options.permissions.readDenied : []);
    const shouldRead = (dataType: string, metricType: string) => {
      abortIfRequested(options.signal);
      if (!denied.has(dataType)) return true;
      reads.push({ dataType, metricType, status: 'denied', count: 0 });
      return false;
    };
    const amostras: VitalSample[] = [];
    const reads: HealthReadDiagnostic[] = [];
    const addDiagnostic = (dataType: string, metricType: string, count: number, error?: unknown) => {
      reads.push({
        dataType,
        metricType,
        status: error ? 'error' : count > 0 ? 'ok' : 'empty',
        count,
        ...(error ? { error: error instanceof Error ? error.message.slice(0, 160) : 'Falha de leitura' } : {})
      });
    };

    const rawSpecs = [
      ['heartRate', 'heart_rate', 'bpm', 10000], ['restingHeartRate', 'heart_rate_resting', 'bpm', 500],
      ['heartRateVariability', Capacitor.getPlatform() === 'ios' ? 'hrv_sdnn' : 'hrv_rmssd', 'ms', 300], ['weight', 'weight_kg', 'kg', 100],
      ['respiratoryRate', 'respiratory_rate', 'resp/min', 300], ['oxygenSaturation', 'oxygen_saturation', '%', 300],
      ['vo2Max', 'vo2max_estimate', 'mL/min/kg', 100], ['exerciseTime', 'exercise_duration_min', 'min', 500],
      ['bodyFat', 'body_fat_percent', '%', 100], ['mindfulness', 'mindfulness_duration_min', 'min', 500],
      ['appleStandHour', 'stand_hours', 'h', 500], ['dietaryWater', 'hydration_l', 'L', 500],
      // Estes tipos não aceitam queryAggregated no Health Connect. Ler as
      // amostras funciona nas duas plataformas e mantém origem/data/hora.
      ['totalCalories', 'calories_total', 'kcal', 2000], ['basalCalories', 'calories_basal', 'kcal', 1000],
      ['distanceCycling', 'distance_cycling_km', 'km', 2000]
    ] as const;
    for (const [dataType, metricType, unit, limit] of rawSpecs) {
      if (Capacitor.getPlatform() !== 'ios' && (dataType === 'exerciseTime' || dataType === 'appleStandHour')) continue;
      if (!shouldRead(dataType, metricType)) continue;
      // Android basalCalories is a rate (kcal/day), not accumulated kcal.
      // Keep it out of this energy-total metric until a distinct rate is supported.
      if (dataType === 'basalCalories' && Capacitor.getPlatform() === 'android') continue;
      try {
        const samples = await readCompleteHealthRange(dataType, new Date(startDate), until, limit, options.signal);
        let count = 0;
        for (const s of samples || []) {
          if (!valorValido(s.value)) continue;
          const value = dataType === 'distanceCycling' ? s.value / 1000
            : Capacitor.getPlatform() === 'ios' && (dataType === 'oxygenSaturation' || dataType === 'bodyFat') ? s.value * 100 : s.value;
          amostras.push(normalizar(metricType, Math.round(value * 100) / 100, unit, s));
          count += 1;
        }
        addDiagnostic(dataType, metricType, count);
      } catch (error) {
        addDiagnostic(dataType, metricType, 0, error);
        console.warn(`[HealthVitalsProvider] Falha ao ler ${dataType}:`, error);
      }
    }

    if (shouldRead('bloodPressure', 'blood_pressure')) try {
      const samples = await readCompleteHealthRange('bloodPressure', new Date(startDate), until, 200, options.signal);
      let count = 0;
      for (const s of samples || []) {
        if (valorValido(s.systolic)) { amostras.push(normalizar('blood_pressure_systolic', Math.round(s.systolic), 'mmHg', s)); count += 1; }
        if (valorValido(s.diastolic)) { amostras.push(normalizar('blood_pressure_diastolic', Math.round(s.diastolic), 'mmHg', s)); count += 1; }
      }
      addDiagnostic('bloodPressure', 'blood_pressure', count);
    } catch (error) {
      addDiagnostic('bloodPressure', 'blood_pressure', 0, error);
      console.warn('[HealthVitalsProvider] Falha ao ler bloodPressure:', error);
    }

    if (shouldRead('sleep', 'sleep_duration_min')) try {
      const sleepStart = new Date(new Date(startDate).getTime() - 12 * 3600000);
      const samples = await readCompleteHealthRange('sleep', sleepStart, until, 500, options.signal);
      const sleepSamples = aggregateSleepSamples(samples, timeZone);
      amostras.push(...sleepSamples);
      addDiagnostic('sleep', 'sleep_duration_min', sleepSamples.length);
    } catch (error) {
      addDiagnostic('sleep', 'sleep_duration_min', 0, error);
      console.warn('[HealthVitalsProvider] Falha ao ler sleep:', error);
    }

    const aggregateSpecs = [
      ['steps', 'steps_daily', 'passos'], ['calories', 'calories_active', 'kcal'], ['distance', 'distance_km', 'km']
    ] as const;
    for (const [dataType, metricType, unit] of aggregateSpecs) {
      if (!shouldRead(dataType, metricType)) continue;
      try {
        const { samples = [] } = await nativeRead(() => CapgoHealth.queryAggregated({
          dataType, startDate, endDate, bucket: 'day', aggregation: 'sum'
        }), options.signal);
        let count = 0;
        for (const s of samples) {
          // An observed zero is valid for a daily total. Missing buckets stay absent.
          if (typeof s.value !== 'number' || !Number.isFinite(s.value) || s.value < 0) continue;
          const value = dataType === 'distance' ? s.value / 1000 : s.value;
          const localDate = calendarDay(Date.parse(s.startDate), timeZone);
          amostras.push({
            ...normalizar(metricType, Math.round(value * 100) / 100, unit, {
              startDate: s.startDate, endDate: s.endDate,
              platformId: `daily:v2:${metricType}:${timeZone}:${localDate}`
            }),
            // Today's bucket ends tomorrow; its timestamp must not hide it today.
            timestamp: s.startDate, aggregation: 'daily_total', localDate, timeZone
          });
          count += 1;
        }
        addDiagnostic(dataType, metricType, count);
      } catch (error) {
        addDiagnostic(dataType, metricType, 0, error);
        console.warn(`[HealthVitalsProvider] Falha ao agregar ${dataType}:`, error);
      }
    }
    abortIfRequested(options.signal);

    return {
      samples: Array.from(new Map(amostras.map((sample) => [`${sample.metricType}:${sample.sampleId}`, sample])).values()),
      diagnostics: {
        since: startDate,
        until: endDate,
        reads,
        readComplete: reads.every((read) => read.status !== 'error'),
        failedTypes: reads.filter((read) => read.status === 'error').map((read) => read.dataType),
        emptyTypes: reads.filter((read) => read.status === 'empty').map((read) => read.dataType)
      }
    };
  }
};
