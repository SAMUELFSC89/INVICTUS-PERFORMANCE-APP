import { VercelRequest, VercelResponse } from '@vercel/node';
import { createHash } from 'node:crypto';
import { cors, db, verifyAuth } from '../_lib/common.js';
import { processarLoteWearable, WearableActivityPayload } from '../_lib/wearable-sync-service.js';
import { registrarAmostrasPassivas, HealthMetricType, HealthSampleSource } from '../_lib/health-data-layer.js';
import { deriveProvenanceStatus, HealthProvenance } from '../_lib/health-confidence-engine.js';
import { applyUserDeclaredDeviceFromList, getUserDeviceDeclarations } from '../_lib/health-device-registry.js';

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

    const checkpoints = Array.isArray(a.checkpoints)
      ? (a.checkpoints as unknown[])
          .filter((p): p is { latitude: unknown; longitude: unknown } => !!p && typeof p === 'object')
          .map((p) => ({ latitude: Number((p as any).latitude), longitude: Number((p as any).longitude) }))
          .filter((p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude))
      : undefined;

    validas.push({
      source: a.source as 'apple_health' | 'health_connect',
      sourceActivityId: a.sourceActivityId,
      activityType: a.activityType,
      startTime: a.startTime,
      durationSeconds,
      distanceMeters: Number.isFinite(Number(a.distanceMeters)) ? Number(a.distanceMeters) : undefined,
      calories: Number.isFinite(Number(a.calories)) ? Number(a.calories) : undefined,
      averageHeartRate: Number.isFinite(Number(a.averageHeartRate)) ? Number(a.averageHeartRate) : undefined,
      maxHeartRate: Number.isFinite(Number(a.maxHeartRate)) ? Number(a.maxHeartRate) : undefined,
      checkpoints: checkpoints && checkpoints.length > 0 ? checkpoints : undefined
    });
  }
  return validas;
}

// Métricas passivas de atividade, condicionamento e bem-estar lidas via
// @capgo/capacitor-health (HealthVitalsProvider) -- distinto do payload de
// atividades acima, que continua vindo do "capacitor-health" (mley).
const VITAL_METRIC_TYPES = new Set([
  'heart_rate', 'heart_rate_resting', 'hrv_rmssd', 'sleep_duration_min', 'weight_kg', 'steps_daily',
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

type VitalPayload = { metricType: HealthMetricType; value: number; unit: string; timestamp: string; startDate?: string; endDate?: string; sampleId?: string; sourceId?: string; platformId?: string; device?: string; provenance: HealthProvenance };

function safeText(value: unknown, max = 160): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined;
}

function hashLocalIdentifier(value: unknown): string | undefined {
  const normalized = safeText(value, 200);
  return normalized ? `sha256:${createHash('sha256').update(normalized).digest('hex')}` : undefined;
}

function sanitizarVitais(input: unknown, source: HealthSampleSource): VitalPayload[] {
  if (!Array.isArray(input)) return [];
  const validas: VitalPayload[] = [];
  for (const item of input.slice(0, MAX_VITAIS_POR_SYNC)) {
    if (!item || typeof item !== 'object') continue;
    const a = item as Record<string, unknown>;
    if (!VITAL_METRIC_TYPES.has(String(a.metricType))) continue;
    const value = Number(a.value);
    if (!Number.isFinite(value) || value <= 0) continue;
    if (typeof a.unit !== 'string' || !a.unit) continue;
    if (typeof a.timestamp !== 'string' || isNaN(new Date(a.timestamp).getTime())) continue;
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
      timestamp: a.timestamp,
      startDate: typeof a.startDate === 'string' && !isNaN(new Date(a.startDate).getTime()) ? a.startDate : a.timestamp,
      endDate: typeof a.endDate === 'string' && !isNaN(new Date(a.endDate).getTime()) ? a.endDate : a.timestamp,
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

  // #248: ingestão real de HealthKit/Health Connect. O cliente só leu do
  // aparelho (WearableManager.syncAll) -- quem decide se aquilo pontua é o
  // SecurityPipeline aqui, atividade por atividade, mesmo pipeline que
  // treino manual/check-in/corrida GPS/Strava já passam.
  if (action === 'sync') {
    const atividades = sanitizarAtividades(req.body?.activities);
    if (atividades.length === 0) {
      const now = new Date().toISOString();
      await configRef.set({ lastSyncTime: now, updatedAt: now }, { merge: true }).catch(() => undefined);
      return res.status(200).json({ syncedCount: 0, duplicatesSkipped: 0, blockedCount: 0, logs: [], lastSyncTime: now });
    }

    try {
      const { resultados, syncedCount, duplicatesSkipped, blockedCount } = await processarLoteWearable(auth.uid, atividades);
      const now = new Date().toISOString();
      try {
        await configRef.set({ lastSyncTime: now, updatedAt: now }, { merge: true });
      } catch (writeErr) {
        console.warn('[Wearables Handler] Aviso ao atualizar lastSyncTime:', writeErr);
      }
      return res.status(200).json({
        syncedCount,
        duplicatesSkipped,
        blockedCount,
        lastSyncTime: now,
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
    const source: HealthSampleSource = req.body?.source === 'health_connect' ? 'health_connect' : 'apple_health';
    const vitais = sanitizarVitais(req.body?.vitals, source);
    const finalBatch = req.body?.finalBatch !== false;
    if (vitais.length === 0) {
      const now = new Date().toISOString();
      if (finalBatch) await configRef.set({ lastVitalsSyncTime: now, updatedAt: now }, { merge: true }).catch(() => undefined);
      return res.status(200).json({ savedCount: 0, lastVitalsSyncTime: finalBatch ? now : undefined });
    }
    try {
      const declarations = await getUserDeviceDeclarations(auth.uid).catch(() => []);
      const enrichedVitals = vitais.map((sample) => ({
        ...sample,
        provenance: applyUserDeclaredDeviceFromList(sample.provenance, sample.timestamp, declarations)
      }));
      const savedCount = await registrarAmostrasPassivas({ userId: auth.uid, source, amostras: enrichedVitals });
      const now = new Date().toISOString();
      if (finalBatch) await configRef.set({ lastVitalsSyncTime: now, updatedAt: now }, { merge: true });
      return res.status(200).json({ savedCount, lastVitalsSyncTime: finalBatch ? now : undefined });
    } catch (err: any) {
      console.error('[Wearables Handler] Falha ao sincronizar vitais:', err);
      return res.status(500).json({ error: 'Não foi possível sincronizar os dados de saúde agora.' });
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
