import express from 'express';
import { randomUUID } from 'crypto';
import { db, cors, verifyAuth } from '../_lib/common.js';
import { StravaApi } from '../_lib/strava-api.js';
import { SyncService } from '../_lib/sync-service.js';

const router = express.Router();

const STRAVA_CLIENT_ID = process.env.STRAVA_CLIENT_ID;
const STRAVA_CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET;
const STRAVA_REDIRECT_URI = process.env.STRAVA_REDIRECT_URI && process.env.STRAVA_REDIRECT_URI.includes('sem-desculpa.vercel.app')
  ? process.env.STRAVA_REDIRECT_URI.replace('sem-desculpa.vercel.app', 'www.invictusperformance.app.br')
  : process.env.STRAVA_REDIRECT_URI;
const STRAVA_VERIFY_TOKEN = process.env.STRAVA_VERIFY_TOKEN || process.env.STRAVA_WEBHOOK_SECRET;

function sanitizeReturnPath(value: unknown): string {
  const candidate = typeof value === 'string' ? value.trim() : '';
  // Nunca aceite URL absoluta, protocolo ou caminho de rede no state OAuth.
  if (!candidate.startsWith('/') || candidate.startsWith('//') || candidate.includes('://')) {
    return '/profile/wearables';
  }
  return /^\/[a-zA-Z0-9_/?=&.-]{0,256}$/.test(candidate) ? candidate : '/profile/wearables';
}

// #250: o app nativo (Capacitor) carrega o bundle local (webDir 'dist', sem
// server.url) -- window.location.assign/uma navegacao comum pra strava.com
// tanto pode ser bloqueada pelo allowNavigation da WebView quanto, mesmo
// quando abre num navegador in-app (Browser.open), nunca devolve o controle
// pro app: strava.com nao conhece nosso esquema de URL, entao so um redirect
// FINAL para um deep link (invictus://, ja registrado no Info.plist/Android
// Manifest) aciona appUrlOpen e fecha o navegador de volta pro app. Na web o
// redirect HTTPS normal continua funcionando (mesma aba do navegador real).
function sanitizeClientPlatform(value: unknown): 'native' | 'web' {
  return value === 'native' ? 'native' : 'web';
}

function buildStravaRedirectUrl(platform: 'native' | 'web', returnPath: string, outcome: 'connected' | 'error'): string {
  if (platform === 'native') {
    return `invictus://strava-callback?strava=${outcome}`;
  }
  let appUrl = process.env.APP_URL || 'https://www.invictusperformance.app.br';
  appUrl = appUrl.replace(/\/$/, '');
  if (appUrl.includes('sem-desculpa.vercel.app')) {
    appUrl = appUrl.replace('sem-desculpa.vercel.app', 'www.invictusperformance.app.br');
  }
  return `${appUrl}${returnPath}?strava=${outcome}`;
}

// 1. Rewrite middleware to support unified query-based / body-based actions (for backwards compatibility)
router.use((req: any, res: any, next: any) => {
  if (cors(req, res)) return;
  
  // Não registre query/body: o fluxo OAuth pode carregar códigos ou tokens.
  console.log('[Strava]', req.method, req.path);

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
  
  if (STRAVA_VERIFY_TOKEN && verifyToken === STRAVA_VERIFY_TOKEN) {
    return res.status(200).json({ 'hub.challenge': challenge });
  }
  console.warn('[Strava Webhook Validation] Verification failed.');
  return res.status(403).json({ error: 'Webhook verification failed' });
});

// --- Webhook Event (POST /webhook) ---
router.post('/webhook', async (req: any, res: any) => {
  const event = req.body || {};
  const subscriptionId = process.env.STRAVA_SUBSCRIPTION_ID?.trim();
  if (subscriptionId && String(event.subscription_id || '') !== subscriptionId) {
    console.warn('[Strava Webhook] Evento recusado: subscription_id incompatível.');
    return res.status(403).json({ error: 'Webhook não autorizado.' });
  }
  console.log('[Strava Webhook] Evento recebido:', {
    objectType: event.object_type,
    aspectType: event.aspect_type,
    objectId: event.object_id ? String(event.object_id).slice(0, 32) : undefined
  });

  // We only care about new activities
  if (event.object_type === 'activity' && event.aspect_type === 'create') {
    if (!event.owner_id || !event.object_id || !/^[0-9]+$/.test(String(event.owner_id)) || !/^[0-9]+$/.test(String(event.object_id))) {
      return res.status(400).json({ error: 'Evento Strava inválido.' });
    }
    const athleteId = String(event.owner_id);
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

// --- Callback Handler (GET /callback) ---
router.get('/callback', async (req: any, res: any) => {
  // #250: resolvido assim que o state OAuth é lido, para o catch abaixo
  // também poder mandar o app nativo de volta via deep link em vez de deixar
  // o usuário preso numa página de erro em JSON dentro do navegador in-app.
  let resolvedPlatform: 'native' | 'web' = 'web';
  let resolvedReturnPath = '/profile/wearables';
  try {
    const { code, state } = req.query;
    if (!state) return res.status(400).json({ error: 'Estado OAuth inválido ou expirado.' });

    const stateId = String(state);
    if (!/^[a-f0-9]{32}$/i.test(stateId)) {
      return res.status(400).json({ error: 'Estado OAuth inválido ou expirado.' });
    }
    const stateRef = db.collection('oauth_states').doc(stateId);
    const stateData = await db.runTransaction(async (transaction: any) => {
      const stateSnap = await transaction.get(stateRef);
      if (!stateSnap.exists) return null;
      const data = stateSnap.data() || {};
      transaction.delete(stateRef);
      const expiresAt = new Date(String(data.expiresAt || '')).getTime();
      if (!data.userId || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;
      return data;
    });
    if (!stateData) {
      return res.status(400).json({ error: 'Estado OAuth inválido ou expirado.' });
    }
    const userId = String(stateData.userId);
    const returnPath = sanitizeReturnPath(stateData.returnPath);
    const clientPlatform = sanitizeClientPlatform(stateData.clientPlatform);
    resolvedPlatform = clientPlatform;
    resolvedReturnPath = returnPath;

    console.log('[Strava Callback] Recebido retorno OAuth para usuário autenticado previamente.');

    if (!code || !userId) return res.status(400).json({ error: 'Estado OAuth inválido ou expirado.' });

    if (!STRAVA_CLIENT_ID || !STRAVA_CLIENT_SECRET) {
      console.error('[Strava Callback] Credenciais Strava ausentes no servidor.');
      if (clientPlatform === 'native') return res.redirect(buildStravaRedirectUrl('native', returnPath, 'error'));
      return res.status(503).json({ error: 'A conexão com o Strava está indisponível no momento.' });
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
    const strava = new StravaApi(userId);
    await strava.saveConnection(data);

    const saved =
    await db
    .collection("strava_connections")
    .doc(userId)
    .get();

    console.log('[Strava Callback] Conexão persistida:', saved.exists);

    // Trigger initial historical import (async)
    manualSyncInternal(strava).catch(err => {
      console.warn('[Strava Callback] Initial historical sync completed with warning/error:', err.message || err);
    });

    const redirectUrl = buildStravaRedirectUrl(clientPlatform, returnPath, 'connected');
    console.log('[Strava Callback] Successfully connected. Redirecting to:', redirectUrl);
    return res.redirect(redirectUrl);
  } catch (error: any) {
    console.error('[Strava Callback Error]:', error);
    if (resolvedPlatform === 'native') {
      return res.redirect(buildStravaRedirectUrl('native', resolvedReturnPath, 'error'));
    }
    return res.status(500).json({ error: 'Não foi possível concluir a conexão com o Strava.' });
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
    let redirectUri = STRAVA_REDIRECT_URI;
    if (!redirectUri && process.env.APP_URL) {
      const cleanAppUrl = process.env.APP_URL.replace(/\/$/, '');
      redirectUri = `${cleanAppUrl}/api/strava/callback`;
    }
    if (!redirectUri) {
      redirectUri = 'https://www.invictusperformance.app.br/api/strava/callback';
    }

    const state = randomUUID().replace(/-/g, '');
    await db.collection('oauth_states').doc(state).set({
      userId,
      returnPath: sanitizeReturnPath(returnPath),
      provider: 'strava',
      // #250: o cliente (stravaService.authorize) informa se é o app nativo
      // via ?platform=native -- o /callback usa isso pra decidir se devolve
      // o controle por deep link (invictus://) ou por redirect HTTPS normal.
      clientPlatform: sanitizeClientPlatform(req.query.platform),
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString()
    });

    console.log('[Strava GET /auth] Criado state OAuth temporário para Strava.');

    const scope = 'read,activity:read_all';
    const url = `https://www.strava.com/oauth/authorize?client_id=${STRAVA_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${scope}&state=${state}&approval_prompt=force`;
    return res.json({ url });
  } catch (error: any) {
    console.error('[Strava GET /auth Error]:', error);
    return res.status(500).json({ error: 'Não foi possível iniciar a conexão com o Strava.' });
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
    return res.status(500).json({ error: 'Não foi possível sincronizar as atividades do Strava.' });
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
    return res.status(500).json({ error: 'Não foi possível desconectar o Strava.' });
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
    return res.status(500).json({ error: 'Não foi possível atualizar a conexão com o Strava.' });
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
