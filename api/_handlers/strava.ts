import express from 'express';
import { db, cors, verifyAuth, FieldValue } from '../_lib/common.js';
import { StravaApi } from '../_lib/strava-api.js';
import { SyncService } from '../_lib/sync-service.js';

const router = express.Router();

const STRAVA_CLIENT_ID = process.env.STRAVA_CLIENT_ID;
const STRAVA_CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET;
const STRAVA_REDIRECT_URI = process.env.STRAVA_REDIRECT_URI && process.env.STRAVA_REDIRECT_URI.includes('sem-desculpa.vercel.app')
  ? process.env.STRAVA_REDIRECT_URI.replace('sem-desculpa.vercel.app', 'www.invictusperformance.app.br')
  : process.env.STRAVA_REDIRECT_URI;
const STRAVA_VERIFY_TOKEN = process.env.STRAVA_VERIFY_TOKEN || process.env.STRAVA_WEBHOOK_SECRET;

// 1. Rewrite middleware to support unified query-based / body-based actions (for backwards compatibility)
router.use((req: any, res: any, next: any) => {
  if (cors(req, res)) return;
  
  // Adicione logs temporários exatamente como solicitado antes da lógica de decisão
  console.log(req.method);
  console.log(req.path);
  console.log(req.query);
  console.log(req.body);
  console.log(req.params);

  const path = req.path || '';

  // O middleware de compatibilidade NÃO deve executar para as rotas diretas
  const isDirectRoute = [
    '/auth',
    '/callback',
    '/status',
    '/sync',
    '/disconnect',
    '/refresh',
    '/webhook'
  ].includes(path) ||
  path.endsWith('/auth') ||
  path.endsWith('/callback') ||
  path.endsWith('/status') ||
  path.endsWith('/sync') ||
  path.endsWith('/disconnect') ||
  path.endsWith('/refresh') ||
  path.endsWith('/webhook');

  if (isDirectRoute) {
    console.log('[Strava Decisão] Rota direta detectada. Ignorando compatibilidade para:', path);
    return next();
  }

  // A compatibilidade antiga deve executar SOMENTE quando realmente existir req.query.stravaAction ou req.body.stravaAction
  const hasStravaAction = !!(req.query?.stravaAction || req.body?.stravaAction);

  if (hasStravaAction) {
    const action =
      req.body?.stravaAction ??
      req.query?.stravaAction ??
      req.params?.action;
    
    if (action && (path === '/' || path === '/app' || path === '')) {
      console.log(`[Strava Decisão] Compatibilidade antiga: reescrevendo url para /${action}`);
      req.url = `/${action}`;
    }
  } else {
    console.log('[Strava Decisão] Nenhuma chave stravaAction encontrada na query ou body. Mantendo rota original.');
  }

  next();
});

// Middleware for user authentication
const requireUserAuth = async (req: any, res: any, next: any) => {
  try {
    const auth = await verifyAuth(req);
    if (!auth) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    req.userId = auth.uid;
    next();
  } catch (error: any) {
    console.error('[Strava requireUserAuth Error]:', error);
    return res.status(401).json({ error: 'Authentication failed' });
  }
};

// --- Webhook Validation (GET /webhook) ---
router.get('/webhook', (req: any, res: any) => {
  const verifyToken = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  
  console.log('[Strava Webhook Validation] Received request:', req.query);
  if (verifyToken === STRAVA_VERIFY_TOKEN) {
    return res.status(200).json({ 'hub.challenge': challenge });
  }
  console.warn('[Strava Webhook Validation] Verification failed. Tokens mismatch:', { verifyToken, expected: STRAVA_VERIFY_TOKEN });
  return res.status(403).json({ error: 'Webhook verification failed' });
});

// --- Webhook Event (POST /webhook) ---
router.post('/webhook', async (req: any, res: any) => {
  const event = req.body;
  console.log('[Strava Webhook] Event received:', event);

  // We only care about new activities
  if (event.object_type === 'activity' && event.aspect_type === 'create') {
    const athleteId = event.owner_id.toString();
    try {
      const athleteSnap = await db.collection('strava_athletes').doc(athleteId).get();
      
      if (athleteSnap.exists) {
        const userId = athleteSnap.data()?.userId;
        if (userId) {
          // Check primary source wearable configuration
          const configSnap = await db.collection('wearable_configs').doc(userId).get();
          if (configSnap.exists) {
            const config = configSnap.data();
            if (config) {
              if (config.appleHealthConnected) {
                console.log(`[WEBHOOK] IGNORING event for user ${userId} because Apple Health (iOS) is connected.`);
                return res.status(200).json({ success: true, message: 'Ignored: Apple Health (iOS) connected.' });
              }
              if (config.healthConnectConnected) {
                console.log(`[WEBHOOK] IGNORING event for user ${userId} because Health Connect (Android) is connected.`);
                return res.status(200).json({ success: true, message: 'Ignored: Health Connect (Android) connected.' });
              }
            }
          }

          const strava = new StravaApi(userId);
          const activity = await strava.fetchActivity(event.object_id);
          await SyncService.processStravaActivity(userId, activity);
          console.log(`[Strava Webhook] Successfully processed activity ${event.object_id} for user ${userId}`);
        } else {
          console.warn(`[Strava Webhook] Athlete found but userId is missing for athleteId: ${athleteId}`);
        }
      } else {
        console.log(`[Strava Webhook] Athlete ID ${athleteId} not registered in our system.`);
      }
    } catch (e: any) {
      console.error(`[Strava Webhook] Error processing activity ${event.object_id}:`, e);
    }
  }

  return res.status(200).json({ success: true });
});

// Helper to safely determine the external host and protocol, especially inside proxy/container environments like Cloud Run
function getRequestHostAndProtocol(req: any) {
  let host = (req.headers['x-forwarded-host'] as string) || req.headers.host || 'invictusperformance.app.br';
  let protocol = (req.headers['x-forwarded-proto'] as string) || 'https';
  
  // Robust fallback: parse from Referer header if present
  if (req.headers.referer) {
    try {
      const refUrl = new URL(req.headers.referer);
      // Only override if current host is local/container-bound, and the referer is a real domain
      if ((host.includes('localhost') || host.includes('127.0.0.1')) && !refUrl.host.includes('localhost') && !refUrl.host.includes('127.0.0.1')) {
        host = refUrl.host;
        protocol = refUrl.protocol.replace(':', '');
      }
    } catch (e) {
      console.warn('[Strava Host Helper] Failed to parse referer:', e);
    }
  }
  
  return { host, protocol };
}

// --- Callback Handler (GET /callback) ---
router.get('/callback', async (req: any, res: any) => {
  try {
    const { code, state } = req.query;
    if (!state) return res.status(400).json({ error: 'State (userId) missing' });

    const stateStr = state as string;
    const parts = stateStr.split('__');
    const userId = parts[0];
    const returnPath = parts[1] || '/profile';

    console.log('[Strava Callback] Received code:', code, 'and state (userId):', userId, 'returnPath:', returnPath);

    if (!code) return res.status(400).json({ error: 'Code missing' });
    if (!userId) return res.status(400).json({ error: 'State (userId) missing' });

    if (!STRAVA_CLIENT_ID || !STRAVA_CLIENT_SECRET) {
      return res.status(400).json({ error: 'Credenciais do Strava não configuradas no servidor. Verifique STRAVA_CLIENT_ID e STRAVA_CLIENT_SECRET.' });
    }

    const response = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: STRAVA_CLIENT_ID,
        client_secret: STRAVA_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code'
      })
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Strava token exchange failed: ${err}`);
    }

    const data = await response.json();
    console.log("===== CALLBACK RESPONSE =====");
    console.log(JSON.stringify(data, null, 2));

    const strava = new StravaApi(userId);
    await strava.saveConnection(data);

    const saved =
    await db
    .collection("strava_connections")
    .doc(userId)
    .get();

    console.log(
    "===== FIRESTORE SAVED =====");

    console.log(saved.data());

    // Trigger initial historical import (async)
    manualSyncInternal(strava).catch(err => {
      console.warn('[Strava Callback] Initial historical sync completed with warning/error:', err.message || err);
    });

    const { host, protocol } = getRequestHostAndProtocol(req);
    const fallbackUrl = `${protocol}://${host}`;
    
    let appUrl = process.env.APP_URL || fallbackUrl;
    appUrl = appUrl.replace(/\/$/, '');
    
    if (appUrl.includes('sem-desculpa.vercel.app')) {
      appUrl = appUrl.replace('sem-desculpa.vercel.app', 'www.invictusperformance.app.br');
    }
    
    console.log('[Strava Callback] Successfully connected. Redirecting to:', `${appUrl}${returnPath}?strava=connected`);
    return res.redirect(`${appUrl}${returnPath}?strava=connected`);
  } catch (error: any) {
    console.error('[Strava Callback Error]:', error);
    return res.status(500).json({ error: error.message || 'Error exchanging tokens' });
  }
});

// --- Initiate Auth (GET /auth) ---
router.get('/auth', requireUserAuth, async (req: any, res: any) => {
  try {
    const userId = req.userId;
    const returnPath = req.query.returnPath || '/profile';
    if (!STRAVA_CLIENT_ID) {
      return res.status(400).json({ error: 'Configuração do Strava ausente no servidor. Defina STRAVA_CLIENT_ID nas variáveis de ambiente.' });
    }
    const { host, protocol } = getRequestHostAndProtocol(req);
    const derivedRedirect = `${protocol}://${host}/api/strava/callback`;
    
    let redirectUri = STRAVA_REDIRECT_URI;
    if (!redirectUri && process.env.APP_URL) {
      const cleanAppUrl = process.env.APP_URL.replace(/\/$/, '');
      redirectUri = `${cleanAppUrl}/api/strava/callback`;
    }
    if (!redirectUri) {
      redirectUri = derivedRedirect;
    }

    const state = `${userId}__${returnPath}`;

    console.log('[Strava GET /auth] Building OAuth URL:', {
      userId,
      returnPath,
      redirectUri,
      client_id: STRAVA_CLIENT_ID
    });

    const scope = 'read,activity:read_all';
    const url = `https://www.strava.com/oauth/authorize?client_id=${STRAVA_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${scope}&state=${state}&approval_prompt=force`;
    return res.json({ url });
  } catch (error: any) {
    console.error('[Strava GET /auth Error]:', error);
    return res.status(500).json({ error: error.message || 'Erro ao iniciar autorização do Strava' });
  }
});

// --- Get Status (GET /status) ---
router.get('/status', requireUserAuth, async (req: any, res: any) => {
  try {
    const userId = req.userId;
    const strava = new StravaApi(userId);
    const conn = await strava.getConnection();
    return res.json({
      connected: !!conn,
      athleteId: conn?.athleteId || null,
      lastSync: conn?.lastSyncAt || null
    });
  } catch (error: any) {
    console.warn('[Strava GET /status Warning]:', error?.message || error);
    return res.status(200).json({
      connected: false,
      athleteId: null,
      lastSync: null,
      warning: 'Não foi possível verificar o status em tempo real'
    });
  }
});

// --- Manual Sync (POST /sync) ---
router.post('/sync', requireUserAuth, async (req: any, res: any) => {
  try {
    const userId = req.userId;
    const strava = new StravaApi(userId);
    const result = await manualSyncInternal(strava);
    return res.json(result);
  } catch (error: any) {
    const errMsg = error.message || '';
    if (errMsg.includes('Forbidden') || errMsg.includes('Unauthorized') || errMsg.includes('Not connected')) {
      console.warn(`[Strava Sync] Connection invalid or revoked for user ${req.userId}:`, errMsg);
      try {
        const strava = new StravaApi(req.userId);
        await strava.deleteConnection();
      } catch (cleanErr) {
        console.warn('Failed to auto-cleanup stale Strava connection:', cleanErr);
      }
      return res.status(400).json({
        success: false,
        error: 'Sua conexão com o Strava expirou ou foi revogada. Por favor, reconecte sua conta do Strava.',
        code: 'STRAVA_AUTH_ERROR'
      });
    }
    console.error('[Strava POST /sync Error]:', error);
    return res.status(500).json({ error: error.message || 'Erro ao sincronizar atividades do Strava' });
  }
});

// --- Disconnect Connection (POST /disconnect) ---
router.post('/disconnect', requireUserAuth, async (req: any, res: any) => {
  try {
    const userId = req.userId;
    const strava = new StravaApi(userId);
    await strava.deleteConnection();
    return res.json({ success: true });
  } catch (error: any) {
    console.error('[Strava POST /disconnect Error]:', error);
    return res.status(500).json({ error: error.message || 'Erro ao desconectar Strava' });
  }
});

// --- Refresh Token (POST /refresh) ---
router.post('/refresh', requireUserAuth, async (req: any, res: any) => {
  const userId = req.userId;
  const strava = new StravaApi(userId);
  try {
    const accessToken = await strava.getAccessToken();
    return res.json({ success: true, refreshed: !!accessToken });
  } catch (err: any) {
    console.error('[Strava POST /refresh Error]:', err);
    return res.status(500).json({ error: err.message || 'Failed to refresh token' });
  }
});

async function manualSyncInternal(strava: StravaApi) {
  const after = Math.floor(Date.now() / 1000) - (60 * 24 * 60 * 60);
  const activities = await strava.fetchActivities(after);
  
  let syncCount = 0;
  for (const act of activities) {
    if (await SyncService.processStravaActivity((strava as any).userId, act)) {
      syncCount++;
    }
  }

  const userId = (strava as any).userId;
  await db.collection('strava_connections').doc(userId).update({
    lastSyncAt: new Date().toISOString()
  });

  return { success: true, syncCount };
}

export default router;
