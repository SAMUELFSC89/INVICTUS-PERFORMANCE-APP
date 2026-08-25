import { VercelRequest, VercelResponse } from '@vercel/node';
import { cors, db, verifyAuth } from '../_lib/common.js';

const ALLOWED_PERMISSION_VALUES = new Set([
  'read_heart_rate',
  'read_steps',
  'read_distance',
  'read_calories',
  'read_workouts'
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
