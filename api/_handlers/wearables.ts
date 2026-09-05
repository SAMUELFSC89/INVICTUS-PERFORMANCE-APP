import { VercelRequest, VercelResponse } from '@vercel/node';
import { createHash } from 'node:crypto';
import { cors, db, verifyAuth } from '../_lib/common.js';
import { processarLoteWearable, WearableActivityPayload } from '../_lib/wearable-sync-service.js';
import { registrarAmostrasPassivas, HealthMetricType, HealthSampleSource, HealthSampleInput } from '../_lib/health-data-layer.js';
import { deriveProvenanceStatus, HealthProvenance } from '../_lib/health-confidence-engine.js';
import { applyUserDeclaredDeviceFromList, getUserDeviceDeclarations } from '../_lib/health-device-registry.js';
import { sanitizeWorkoutHealthRecord } from '../_lib/workout-health-record.js';

const ALLOWED_PERMISSION_VALUES = new Set([
  'read_heart_rate',
  'read_resting_heart_rate',
  'read_heart_rate_variability',
  'read_steps',
  'read_distance',
  'read_calories',
  'read_workouts',
  'read_sleep',
  'read_weight',
  'read_oxygen_saturation',
  'read_respiratory_rate',
  'read_vo2_max',
  'read_blood_pressure',
  'read_blood_glucose',
  'read_body_temperature',
  'read_body_composition',
  'read_total_calories',
  'read_exercise_time',
  'read_hydration',
  'read_mindfulness'
]);

type WearableConfigPayload = {
  healthConnectConnected?: unknown;
  healthConnectPermissions?: unknown;
  appleHealthConnected?: unknown;
  appleHealthPermissions?: unknown;
  autoSync?: unknown;
};

function booleanOrUndefined(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function safePermissions(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return [...new Set(value.filter((item): item is string =>
    typeof item === 'string' && ALLOWED_PERMISSION_VALUES.has(item)
  ))];
}

const FONTES_PERMITIDAS = new Set(['apple_health', 'health_connect']);
// #248: teto por sincronizacao -- uma primeira sincronizacao apos meses sem
// conectar pode trazer muitas atividades de uma vez. Isso nao e limite de
// produto, e protecao contra payload gigante/abusivo numa unica chamada; o
// cliente pode sincronizar de novo para pegar o restante (usa lastSyncTime).
const MAX_ATIVIDADES_POR_SYNC = 50;
const ACTIVITY_TELEMETRY_VERSION = 2;
const MIN_BPM = 30;
const MAX_BPM = 240;
const MAX_AMOSTRAS_FC_POR_ATIVIDADE = 12000;
const TOLERANCIA_AMOSTRA_FC_MS = 5 * 60 * 1000;
const HEALTH_VITALS_VERSION = 2;

type WearableHeartRateSamplePayload = {
  timestamp: string;
  bpm: number;
};

type WearableCheckpointPayload = {
  latitude: number;
  longitude: number;
  timestamp?: string;
};

/**
 * Valida a curva de FC sem inventar pontos. O app pode normalizar o formato,
 * mas o servidor continua sendo a última barreira antes de persistir dados
 * biométricos: timestamps reais, faixa fisiologicamente plausível, janela da
 * atividade e deduplicação por instante.
 */
function sanitizarSerieCardiaca(
  input: unknown,
  startTime: string,
  durationSeconds: number
): WearableHeartRateSamplePayload[] | undefined {
  if (!Array.isArray(input)) return undefined;

  const startMs = new Date(startTime).getTime();
  const endMs = startMs + durationSeconds * 1000;
  const byTimestamp = new Map<string, WearableHeartRateSamplePayload>();

  for (const item of input) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as Record<string, unknown>;
    const rawTimestamp = raw.timestamp ?? raw.startDate ?? raw.date ?? raw.time;
    const timestamp = typeof rawTimestamp === 'string' ? new Date(rawTimestamp) : null;
    const bpm = Number(raw.bpm ?? raw.value ?? raw.heartRate);
    if (!timestamp || !Number.isFinite(timestamp.getTime())) continue;
    if (!Number.isFinite(bpm) || bpm < MIN_BPM || bpm > MAX_BPM) continue;
    if (timestamp.getTime() < startMs - TOLERANCIA_AMOSTRA_FC_MS
      || timestamp.getTime() > endMs + TOLERANCIA_AMOSTRA_FC_MS) continue;

    const iso = timestamp.toISOString();
    if (!byTimestamp.has(iso)) {
      byTimestamp.set(iso, { timestamp: iso, bpm: Math.round(bpm * 10) / 10 });
    }
  }

  const sorted = [...byTimestamp.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  if (sorted.length <= MAX_AMOSTRAS_FC_POR_ATIVIDADE) return sorted.length ? sorted : undefined;

  // Limita o payload mantendo o começo, o fim e a distribuição temporal.
  const reduced: WearableHeartRateSamplePayload[] = [];
  const lastIndex = sorted.length - 1;
  for (let index = 0; index < MAX_AMOSTRAS_FC_POR_ATIVIDADE; index += 1) {
    const sourceIndex = Math.round((index * lastIndex) / (MAX_AMOSTRAS_FC_POR_ATIVIDADE - 1));
    reduced.push(sorted[sourceIndex]);
  }
  return reduced;
}

function numeroPositivo(value: unknown): number | undefined {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : undefined;
}

function bpmResumo(value: unknown): number | undefined {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= MIN_BPM && numeric <= MAX_BPM
    ? Math.round(numeric * 10) / 10
    : undefined;
}

/** Aceita só o que realmente veio do dispositivo, no formato esperado -- não
 * confia em nenhum campo de pontuação/aprovação vindo do cliente (o cliente
 * não pode se autoaprovar, quem decide é o SecurityPipeline no servidor). */
function sanitizarAtividades(input: unknown): WearableActivityPayload[] {
  if (!Array.isArray(input)) return [];
  const validas: WearableActivityPayload[] = [];
  for (const item of input.slice(0, MAX_ATIVIDADES_POR_SYNC)) {
    if (!item || typeof item !== 'object') continue;
    const a = item as Record<string, unknown>;
    if (!FONTES_PERMITIDAS.has(String(a.source))) continue;
    if (typeof a.sourceActivityId !== 'string' || !a.sourceActivityId) continue;
    if (typeof a.activityType !== 'string' || !a.activityType) continue;
    if (typeof a.startTime !== 'string' || isNaN(new Date(a.startTime).getTime())) continue;
    const durationSeconds = Number(a.durationSeconds);
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) continue;

    const heartRateSamples = sanitizarSerieCardiaca(a.heartRateSamples, a.startTime, durationSeconds);
    const heartRateValues = heartRateSamples?.map((sample) => sample.bpm) || [];
    const averageHeartRate = heartRateValues.length > 0
      ? Math.round((heartRateValues.reduce((sum, value) => sum + value, 0) / heartRateValues.length) * 10) / 10
      : bpmResumo(a.averageHeartRate);
    const maxHeartRate = heartRateValues.length > 0
      ? Math.max(...heartRateValues)
      : bpmResumo(a.maxHeartRate);
    const steps = numeroPositivo(a.steps);

    const checkpoints: WearableCheckpointPayload[] | undefined = Array.isArray(a.checkpoints)
      ? (a.checkpoints as unknown[])
          .filter((p): p is { latitude: unknown; longitude: unknown } => !!p && typeof p === 'object')
          .map((p) => {
            const rawTimestamp = (p as any).timestamp;
            const timestamp = typeof rawTimestamp === 'string' && Number.isFinite(new Date(rawTimestamp).getTime())
              ? new Date(rawTimestamp).toISOString()
              : undefined;
            return {
              latitude: Number((p as any).latitude),
              longitude: Number((p as any).longitude),
              ...(timestamp ? { timestamp } : {})
            };
          })
          .filter((p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude))
      : undefined;

    validas.push({
      source: a.source as 'apple_health' | 'health_connect',
      sourceActivityId: a.sourceActivityId,
      activityType: a.activityType,
      startTime: a.startTime,
      durationSeconds,
      distanceMeters: numeroPositivo(a.distanceMeters),
      calories: numeroPositivo(a.calories),
      averageHeartRate,
      maxHeartRate,
      ...(steps !== undefined ? { steps: Math.round(steps) } : {}),
      heartRateSamples,
      checkpoints: checkpoints && checkpoints.length > 0 ? checkpoints : undefined
    });
  }
  return validas;
}

// Métricas passivas de atividade, condicionamento e bem-estar lidas via
// @capgo/capacitor-health (HealthVitalsProvider) -- distinto do payload de
// atividades acima, que continua vindo do "capacitor-health" (mley).
const VITAL_METRIC_TYPES = new Set([
  'heart_rate', 'heart_rate_resting', 'hrv_rmssd', 'hrv_sdnn', 'sleep_duration_min', 'weight_kg', 'steps_daily',
  'calories_active', 'calories_total', 'calories_basal', 'distance_km', 'distance_cycling_km',
  'respiratory_rate', 'oxygen_saturation', 'vo2max_estimate', 'blood_glucose', 'body_temperature',
  'blood_pressure_systolic', 'blood_pressure_diastolic',
  'height_cm', 'flights_climbed', 'exercise_duration_min', 'body_fat_percent',
  'mindfulness_duration_min', 'stand_hours', 'hydration_l', 'dietary_energy_kcal'
]);
// Proteção por requisição. O cliente envia lotes de até 500 amostras e só
// avança o cursor depois do último lote, portanto este teto não descarta o
// restante do histórico.
const MAX_VITAIS_POR_SYNC = 800;

type VitalPayload = Omit<HealthSampleInput, 'userId' | 'source' | 'quality'> & { provenance: HealthProvenance };

function safeText(value: unknown, max = 160): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined;
}

function hashLocalIdentifier(value: unknown): string | undefined {
  const normalized = safeText(value, 200);
  return normalized ? `sha256:${createHash('sha256').update(normalized).digest('hex')}` : undefined;
}

const VITAL_UNITS: Partial<Record<HealthMetricType, string>> = {
  heart_rate: 'bpm', heart_rate_resting: 'bpm', hrv_rmssd: 'ms', hrv_sdnn: 'ms', sleep_duration_min: 'min',
  weight_kg: 'kg', steps_daily: 'passos', calories_active: 'kcal', calories_total: 'kcal', calories_basal: 'kcal',
  distance_km: 'km', distance_cycling_km: 'km', respiratory_rate: 'resp/min', oxygen_saturation: '%', vo2max_estimate: 'mL/min/kg',
  blood_glucose: 'mg/dL', body_temperature: '°C', blood_pressure_systolic: 'mmHg', blood_pressure_diastolic: 'mmHg',
  height_cm: 'cm', flights_climbed: 'andares', exercise_duration_min: 'min', body_fat_percent: '%',
  mindfulness_duration_min: 'min', stand_hours: 'h', hydration_l: 'L', dietary_energy_kcal: 'kcal'
};

function sanitizarVitais(input: unknown, source: HealthSampleSource): VitalPayload[] {
  if (!Array.isArray(input)) return [];
  const validas: VitalPayload[] = [];
  for (const item of input) {
    if (!item || typeof item !== 'object') continue;
    const a = item as Record<string, unknown>;
    if (!VITAL_METRIC_TYPES.has(String(a.metricType))) continue;
    if (typeof a.value !== 'number') continue;
    const value = a.value;
    const zeroAllowed = ['steps_daily', 'calories_active', 'calories_total', 'calories_basal', 'distance_km', 'distance_cycling_km', 'flights_climbed', 'exercise_duration_min', 'hydration_l', 'dietary_energy_kcal', 'mindfulness_duration_min', 'stand_hours'].includes(String(a.metricType));
    if (!Number.isFinite(value) || value < 0 || (value === 0 && !zeroAllowed)) continue;
    if (typeof a.unit !== 'string' || a.unit !== VITAL_UNITS[String(a.metricType) as HealthMetricType]) continue;
    if (typeof a.timestamp !== 'string' || isNaN(new Date(a.timestamp).getTime())) continue;
    const timestamp = new Date(a.timestamp).toISOString();
    if (Date.parse(timestamp) > Date.now() + 5 * 60 * 1000) continue;
    if (a.startDate !== undefined && (typeof a.startDate !== 'string' || !Number.isFinite(Date.parse(a.startDate)))) continue;
    if (a.endDate !== undefined && (typeof a.endDate !== 'string' || !Number.isFinite(Date.parse(a.endDate)))) continue;
    const startDate = typeof a.startDate === 'string' && Number.isFinite(Date.parse(a.startDate)) ? new Date(a.startDate).toISOString() : timestamp;
    const endDate = typeof a.endDate === 'string' && Number.isFinite(Date.parse(a.endDate)) ? new Date(a.endDate).toISOString() : timestamp;
    if (Date.parse(endDate) < Date.parse(startDate)) continue;
    const localDate = typeof a.localDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(a.localDate)
      && Number.isFinite(Date.parse(a.localDate)) ? a.localDate : undefined;
    if (a.localDate !== undefined && (!localDate || new Date(`${localDate}T00:00:00.000Z`).toISOString().slice(0, 10) !== localDate)) continue;
    let timeZone: string | undefined;
    if (typeof a.timeZone === 'string') {
      try { timeZone = new Intl.DateTimeFormat('en-US', { timeZone: a.timeZone }).resolvedOptions().timeZone; }
      catch { continue; }
    }
    const partial: Omit<HealthProvenance, 'status'> = {
      integration: source === 'apple_health' ? 'APPLE_HEALTH' : 'HEALTH_CONNECT',
      dataOrigin: safeText(a.dataOrigin || a.sourceId, 200),
      applicationName: safeText(a.applicationName || a.device),
      recordingMethod: ['automatic', 'active', 'manual', 'unknown'].includes(String(a.recordingMethod)) ? a.recordingMethod as HealthProvenance['recordingMethod'] : 'unknown',
      deviceManufacturer: safeText(a.deviceManufacturer), deviceModel: safeText(a.deviceModel),
      deviceName: safeText(a.deviceName), deviceType: safeText(a.deviceType),
      hardwareVersion: safeText(a.hardwareVersion, 80), firmwareVersion: safeText(a.firmwareVersion, 80),
      softwareVersion: safeText(a.softwareVersion, 80), localIdentifier: hashLocalIdentifier(a.localIdentifier),
      sourceVersion: safeText(a.sourceVersion, 80), sourceProductType: safeText(a.sourceProductType, 120),
      sourceOperatingSystemVersion: safeText(a.sourceOperatingSystemVersion, 80)
    };
    validas.push({
      metricType: a.metricType as HealthMetricType,
      value,
      unit: a.unit,
      timestamp, startDate, endDate, localDate, timeZone,
      normalizationVersion: a.normalizationVersion === 2 ? 2 : 1,
      aggregation: a.aggregation === 'daily_total' || a.aggregation === 'sleep_session' ? a.aggregation : 'sample',
      derivedFrom: Array.isArray(a.derivedFrom) ? a.derivedFrom.filter((x): x is string => typeof x === 'string').slice(0, 100).map(x => x.slice(0, 300)) : undefined,
      sampleId: typeof a.sampleId === 'string' ? a.sampleId.slice(0, 500) : undefined,
      sourceId: typeof a.sourceId === 'string' ? a.sourceId.slice(0, 200) : undefined,
      platformId: typeof a.platformId === 'string' ? a.platformId.slice(0, 300) : undefined,
      device: typeof a.device === 'string' ? a.device.slice(0, 120) : undefined,
      provenance: { ...partial, status: deriveProvenanceStatus(partial) }
    });
  }
  return validas;
}

function defaultConfig(userId: string) {
  const now = new Date().toISOString();
  return {
    userId,
    healthConnectConnected: false,
    healthConnectPermissions: [],
    appleHealthConnected: false,
    appleHealthPermissions: [],
    stravaConnected: false,
    autoSync: true,
    lastSyncTime: null,
    activityTelemetryVersion: 0,
    healthVitalsVersion: 0,
    lastVitalsSyncTime: null,
    createdAt: now,
    updatedAt: now
  };
}

/**
 * Configuração de dispositivos é persistida pelo servidor para impedir que o
 * cliente escreva campos de ranking, saúde ou pontuação em coleções protegidas.
 * A conexão nativa (Apple Health/Health Connect) é uma preferência local; ela
 * não concede sozinha elegibilidade de ranking. Esta é definida apenas por uma
 * ingestão de atividade validada no backend.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;

  const auth = await verifyAuth(req);
  if (!auth) {
    return res.status(401).json({ error: 'Autenticação necessária.' });
  }
  if (req.body?.action === 'refresh-session-heart-rate' && req.method !== 'POST') {
    return res.status(405).json({ error: 'A atualização dos batimentos exige POST.' });
  }

  const configRef = db.collection('wearable_configs').doc(auth.uid);

  if (req.method === 'GET') {
    try {
      const [configSnap, stravaSnap] = await Promise.all([
        configRef.get().catch(() => ({ exists: false, data: () => null })),
        db.collection('strava_connections').doc(auth.uid).get().catch(() => ({ exists: false, data: () => null }))
      ]);
      const current = configSnap.exists ? configSnap.data() : defaultConfig(auth.uid);
      const response = {
        ...current,
        userId: auth.uid,
        // Só o OAuth salvo no servidor define o status do Strava.
        stravaConnected: stravaSnap.exists
      };
      return res.status(200).json({ config: response });
    } catch (err: any) {
      console.warn('[Wearables Handler] Falha ao ler Firestore, usando configuração padrão:', err?.message || err);
      return res.status(200).json({ config: defaultConfig(auth.uid) });
    }
  }

  if (req.method !== 'POST' && req.method !== 'PUT') {
    return res.status(405).json({ error: 'Método não permitido.' });
  }

  const action = String(req.body?.action || 'update-config');

  // Delayed HealthKit/Health Connect samples can enrich the private report
  // after completion. This never revalidates or rescores the workout.
  if (action === 'refresh-session-heart-rate') {
    const workoutId = req.body?.workoutId;
    if (typeof workoutId !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(workoutId)) {
      return res.status(400).json({ error: 'Identificação do treino inválida.' });
    }
    try {
      const result = await db.runTransaction(async transaction => {
        const ref = db.collection('workouts').doc(workoutId);
        const snap = await transaction.get(ref);
        const workout = snap.data();
        if (!snap.exists || workout?.userId !== auth.uid) {
          return { code: 404, body: { error: 'Treino não encontrado.' } };
        }
        const current = sanitizeWorkoutHealthRecord(workout.healthSession);
        if (!current.healthSession) {
          return { code: 409, body: { error: 'Este treino não possui um registro de saúde com horários válidos.' } };
        }
        // All set identities, entered results and interval boundaries come
        // from the stored workout. Extra request fields have no authority.
        const candidate = sanitizeWorkoutHealthRecord({
          ...current.healthSession,
          heartRate: req.body?.heartRate,
          integrity: {
            ...current.healthSession.integrity,
            discardedHeartRateSamples: 0
          }
        });
        const next = candidate.healthSession?.heartRate;
        const previous = current.healthSession.heartRate;
        const usefulNext = next && next.samples.length > 0 && ['available', 'partial'].includes(next.status);
        const usefulPrevious = previous.samples.length > 0 && ['available', 'partial'].includes(previous.status);
        // A denied permission, a delayed empty read, older response or less
        // complete query must never erase already collected evidence.
        if (!usefulNext || (usefulPrevious && (
          Date.parse(next.fetchedAt || '') < Date.parse(previous.fetchedAt || '')
          || next.samples.length < previous.samples.length
          || (previous.status === 'available' && next.status !== 'available')
        ))) {
          return { code: 200, body: current };
        }
        // Keep this allowlist explicit: avgHeartRate, duration, evidence,
        // validationStatus, XP and IGA fields are deliberately absent.
        const update = {
          healthSession: candidate.healthSession!,
          healthSessionStatus: candidate.healthSessionStatus!,
          healthSessionReason: candidate.healthSessionReason ?? null
        };
        transaction.update(ref, update);
        return { code: 200, body: update };
      });
      return res.status(result.code).json(result.body);
    } catch {
      return res.status(503).json({ error: 'Não foi possível atualizar os batimentos agora. As leituras anteriores foram preservadas.', retryable: true });
    }
  }

  // #248: ingestão real de HealthKit/Health Connect. O cliente só leu do
  // aparelho (WearableManager.syncAll) -- quem decide se aquilo pontua é o
  // SecurityPipeline aqui, atividade por atividade, mesmo pipeline que
  // treino manual/check-in/corrida GPS/Strava já passam.
  if (action === 'sync') {
    const atividades = sanitizarAtividades(req.body?.activities);
    const finalBatch = req.body?.finalBatch !== false;
    const readComplete = req.body?.readComplete !== false;
    if (atividades.length === 0) {
      const now = new Date().toISOString();
      await configRef.set({
        lastSyncTime: now,
        ...(finalBatch && readComplete ? { activityTelemetryVersion: ACTIVITY_TELEMETRY_VERSION } : {}),
        updatedAt: now
      }, { merge: true }).catch(() => undefined);
      return res.status(200).json({
        syncedCount: 0,
        duplicatesSkipped: 0,
        blockedCount: 0,
        logs: [],
        lastSyncTime: now,
        activityTelemetryVersion: finalBatch && readComplete ? ACTIVITY_TELEMETRY_VERSION : undefined
      });
    }

    try {
      const { resultados, syncedCount, duplicatesSkipped, blockedCount } = await processarLoteWearable(auth.uid, atividades);
      const now = new Date().toISOString();
      try {
        await configRef.set({
          lastSyncTime: now,
          ...(finalBatch && readComplete ? { activityTelemetryVersion: ACTIVITY_TELEMETRY_VERSION } : {}),
          updatedAt: now
        }, { merge: true });
      } catch (writeErr) {
        console.warn('[Wearables Handler] Aviso ao atualizar lastSyncTime:', writeErr);
      }
      return res.status(200).json({
        syncedCount,
        duplicatesSkipped,
        blockedCount,
        lastSyncTime: now,
        activityTelemetryVersion: finalBatch && readComplete ? ACTIVITY_TELEMETRY_VERSION : undefined,
        logs: resultados
      });
    } catch (err: any) {
      console.error('[Wearables Handler] Falha ao sincronizar atividades:', err);
      return res.status(500).json({ error: 'Não foi possível sincronizar as atividades agora.' });
    }
  }

  // #253: vitais passivas (FC repouso, HRV, sono, peso) via
  // @capgo/capacitor-health. NÃO passam pelo SecurityPipeline -- não são uma
  // alegação competitiva, vão direto pra Health Data Layer. Separado da
  // action 'sync' de propósito (ver HealthVitalsProvider.ts).
  if (action === 'sync-vitals') {
    if (!FONTES_PERMITIDAS.has(req.body?.source)) return res.status(400).json({ error: 'Fonte de saúde inválida.' });
    if (!Array.isArray(req.body?.vitals) || req.body.vitals.length > MAX_VITAIS_POR_SYNC) {
      return res.status(400).json({ error: `Envie um lote de até ${MAX_VITAIS_POR_SYNC} amostras.` });
    }
    const source = req.body.source as HealthSampleSource;
    const vitais = sanitizarVitais(req.body.vitals, source);
    const rejectedCount = req.body.vitals.length - vitais.length;
    // Uma requisição inválida nunca é transformada em sincronização vazia bem sucedida.
    if (rejectedCount > 0) return res.status(422).json({ error: 'O lote contém amostras inválidas. Corrija antes de tentar novamente.', receivedCount: req.body.vitals.length, rejectedCount, savedCount: 0 });
    const finalBatch = req.body?.finalBatch !== false;
    const readComplete = req.body?.readComplete !== false;
    const now = new Date().toISOString();
    const rawWindowEnd = req.body?.syncWindowEnd;
    if (rawWindowEnd !== undefined && (typeof rawWindowEnd !== 'string' || !Number.isFinite(Date.parse(rawWindowEnd)) || Date.parse(rawWindowEnd) > Date.now() + 5 * 60 * 1000)) {
      return res.status(400).json({ error: 'Fim da janela de sincronização inválido.' });
    }
    const syncWindowEnd = typeof rawWindowEnd === 'string' ? new Date(rawWindowEnd).toISOString() : now;
    const version = req.body?.normalizationVersion === 2 || (vitais.length > 0 && vitais.every(a => a.normalizationVersion === 2)) ? HEALTH_VITALS_VERSION : 1;
    try {
      const declarations = await getUserDeviceDeclarations(auth.uid).catch(() => []);
      const enrichedVitals = vitais.map((sample) => ({
        ...sample, provenance: applyUserDeclaredDeviceFromList(sample.provenance, sample.timestamp, declarations)
      }));
      const result = await registrarAmostrasPassivas({ userId: auth.uid, source, amostras: enrichedVitals });
      let cursorResult: { lastVitalsSyncTime: string; lastVitalsSyncBySource: Record<string, string>; healthVitalsVersionBySource: Record<string, number>; healthVitalsVersion: number } | undefined;
      if (finalBatch && readComplete) {
        // Concorrência entre uploads não pode fazer o cursor retroceder.
        cursorResult = await db.runTransaction(async transaction => {
          const current = await transaction.get(configRef);
          const data = current.exists ? current.data() : undefined;
          const previous = data?.lastVitalsSyncTime;
          const next = typeof previous === 'string' && Date.parse(previous) > Date.parse(syncWindowEnd) ? previous : syncWindowEnd;
          const previousSource = data?.lastVitalsSyncBySource?.[source];
          const sourceCursor = typeof previousSource === 'string' && Date.parse(previousSource) > Date.parse(syncWindowEnd) ? previousSource : syncWindowEnd;
          const lastVitalsSyncBySource = { ...(data?.lastVitalsSyncBySource || {}), [source]: sourceCursor };
          const healthVitalsVersion = Math.max(Number(data?.healthVitalsVersion) || 0, version);
          const healthVitalsVersionBySource = { ...(data?.healthVitalsVersionBySource || {}), [source]: Math.max(Number(data?.healthVitalsVersionBySource?.[source]) || 0, version) };
          transaction.set(configRef, { lastVitalsSyncTime: next, lastVitalsSyncBySource, healthVitalsVersionBySource, healthVitalsVersion, updatedAt: now }, { merge: true });
          return { lastVitalsSyncTime: next, lastVitalsSyncBySource, healthVitalsVersionBySource, healthVitalsVersion };
        });
      }
      return res.status(200).json({ ...result, ...(cursorResult || {}) });
    } catch {
      console.error('[Wearables Handler] Falha de persistência de dados de saúde; lote deve ser reenviado.');
      return res.status(503).json({ error: 'Não foi possível confirmar a sincronização. Tente novamente.', retryable: true });
    }
  }

  if (action !== 'update-config') {
    return res.status(400).json({ error: 'Ação de wearable inválida.' });
  }

  try {
    const input = (req.body?.config || req.body || {}) as WearableConfigPayload;
    let current = defaultConfig(auth.uid);
    let stravaConnected = false;

    try {
      const [configSnap, stravaSnap] = await Promise.all([
        configRef.get().catch(() => ({ exists: false, data: () => null })),
        db.collection('strava_connections').doc(auth.uid).get().catch(() => ({ exists: false, data: () => null }))
      ]);
      if (configSnap.exists) {
        current = configSnap.data() as any;
      }
      stravaConnected = stravaSnap.exists;
    } catch (readErr) {
      console.warn('[Wearables Handler] Fallback durante atualização de config:', readErr);
    }

    const updates: Record<string, unknown> = {};

    const healthConnectConnected = booleanOrUndefined(input.healthConnectConnected);
    const appleHealthConnected = booleanOrUndefined(input.appleHealthConnected);
    const autoSync = booleanOrUndefined(input.autoSync);
    const healthConnectPermissions = safePermissions(input.healthConnectPermissions);
    const appleHealthPermissions = safePermissions(input.appleHealthPermissions);

    if (healthConnectConnected !== undefined) updates.healthConnectConnected = healthConnectConnected;
    if (appleHealthConnected !== undefined) updates.appleHealthConnected = appleHealthConnected;
    if (autoSync !== undefined) updates.autoSync = autoSync;
    if (healthConnectPermissions !== undefined) updates.healthConnectPermissions = healthConnectPermissions;
    if (appleHealthPermissions !== undefined) updates.appleHealthPermissions = appleHealthPermissions;

    const finalHealthConnect = (updates.healthConnectConnected ?? current.healthConnectConnected) === true;
    const finalAppleHealth = (updates.appleHealthConnected ?? current.appleHealthConnected) === true;
    const now = new Date().toISOString();
    const anyConnected = finalHealthConnect || finalAppleHealth || stravaConnected;
    const primaryProvider = finalAppleHealth
      ? 'apple_health'
      : finalHealthConnect
        ? 'health_connect'
        : stravaConnected
          ? 'strava'
          : null;

    const config = {
      ...current,
      ...updates,
      userId: auth.uid,
      stravaConnected,
      createdAt: current.createdAt || now,
      updatedAt: now
    };

    // O perfil pode refletir a conexão para a interface.
    try {
      const batch = db.batch();
      batch.set(configRef, config, { merge: true });
      batch.set(db.collection('users').doc(auth.uid), {
        hasSmartwatchConnected: anyConnected,
        smartwatchProvider: primaryProvider,
        wearableUpdatedAt: now
      }, { merge: true });
      await batch.commit();
    } catch (writeErr) {
      console.warn('[Wearables Handler] Aviso ao persistir no Firestore:', writeErr);
    }

    return res.status(200).json({
      config,
      rankingEligibility: 'pending_verified_activity'
    });
  } catch (err: any) {
    console.error('[Wearables Handler Error]:', err);
    return res.status(500).json({ error: 'Erro ao processar configuração de dispositivos.' });
  }
}
