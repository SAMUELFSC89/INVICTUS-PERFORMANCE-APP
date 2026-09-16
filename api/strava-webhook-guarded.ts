import { randomUUID } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { cors, db } from './_lib/common.js';
import { consumeDistributedRateLimit } from './_lib/distributed-rate-limit.js';
import { StravaApi } from './_lib/strava-api.js';
import { SyncService } from './_lib/sync-service.js';

const STRAVA_PROVIDER_LEASE_MS = 90_000;

function firstQueryValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? String(value[0] || '') : String(value || '');
}

function timestampMillis(value: unknown): number | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof (value as any)?.toMillis === 'function') {
    const millis = Number((value as any).toMillis());
    return Number.isFinite(millis) ? millis : null;
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

async function reserveProviderLease(userId: string): Promise<{ acquired: boolean; token?: string; missing?: boolean }> {
  const ref = db.collection('strava_connections').doc(userId);
  const now = Date.now();
  const token = randomUUID();
  return db.runTransaction(async (transaction: any) => {
    const snap = await transaction.get(ref);
    if (!snap.exists) return { acquired: false, missing: true };
    const data = snap.data() || {};
    const leaseUntil = timestampMillis(data.activitiesFetchLeaseUntil);
    if (leaseUntil !== null && leaseUntil > now) return { acquired: false };
    transaction.update(ref, {
      activitiesFetchLeaseToken: token,
      activitiesFetchLeaseUntil: new Date(now + STRAVA_PROVIDER_LEASE_MS).toISOString(),
    });
    return { acquired: true, token };
  });
}

async function releaseProviderLease(userId: string, token: string) {
  const ref = db.collection('strava_connections').doc(userId);
  await db.runTransaction(async (transaction: any) => {
    const snap = await transaction.get(ref);
    if (!snap.exists || snap.data()?.activitiesFetchLeaseToken !== token) return;
    transaction.update(ref, {
      activitiesFetchLeaseToken: null,
      activitiesFetchLeaseUntil: null,
    });
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (cors(req, res)) return;

  if (req.method === 'GET') {
    const expectedVerifyToken = process.env.STRAVA_VERIFY_TOKEN?.trim()
      || process.env.STRAVA_WEBHOOK_SECRET?.trim();
    if (!expectedVerifyToken) {
      console.error('[Strava Webhook] Token de verificação ausente; challenge recusado por segurança.');
      return res.status(503).json({ error: 'Webhook temporariamente indisponível.' });
    }

    const receivedVerifyToken = firstQueryValue(req.query['hub.verify_token']);
    const challenge = firstQueryValue(req.query['hub.challenge']);
    if (receivedVerifyToken !== expectedVerifyToken || !challenge) {
      return res.status(403).json({ error: 'Webhook verification failed' });
    }
    return res.status(200).json({ 'hub.challenge': challenge });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido.' });
  }

  // subscription_id não é um segredo, mas é a amarração do evento à assinatura
  // registrada no nosso backend. Ausência da configuração nunca pode significar
  // "aceitar qualquer assinatura".
  const expectedSubscriptionId = process.env.STRAVA_SUBSCRIPTION_ID?.trim();
  if (!expectedSubscriptionId) {
    console.error('[Strava Webhook] STRAVA_SUBSCRIPTION_ID ausente; evento recusado por segurança.');
    return res.status(503).json({ error: 'Webhook temporariamente indisponível.' });
  }

  const event = req.body && typeof req.body === 'object' ? req.body : {};
  if (String(event.subscription_id || '') !== expectedSubscriptionId) {
    return res.status(403).json({ error: 'Webhook não autorizado.' });
  }

  const objectType = String(event.object_type || '');
  const aspectType = String(event.aspect_type || '');
  if (objectType !== 'activity' || aspectType !== 'create') {
    return res.status(200).json({ success: true, ignored: true });
  }

  const ownerId = String(event.owner_id || '');
  const objectId = String(event.object_id || '');
  if (!/^[0-9]+$/.test(ownerId) || !/^[0-9]+$/.test(objectId)) {
    return res.status(400).json({ error: 'Evento Strava inválido.' });
  }

  // Strava não assina o payload com HMAC. Mesmo depois de validar o
  // subscription_id, limitamos de forma distribuída quantos eventos de um
  // mesmo owner podem disparar lookup/token/fetch externo por minuto.
  const providerQuota = await consumeDistributedRateLimit({
    scope: 'strava_webhook_owner',
    subjectId: ownerId,
    windowMs: 60_000,
    maxRequests: 30,
  });
  if (!providerQuota.allowed) {
    res.setHeader('Retry-After', String(providerQuota.retryAfterSeconds));
    return res.status(providerQuota.reason === 'store_unavailable' ? 503 : 429).json({
      success: false,
      retryable: true,
      error: providerQuota.reason === 'store_unavailable'
        ? 'Webhook temporariamente indisponível.'
        : 'Muitos eventos recebidos para este atleta.',
    });
  }

  let leasedUserId = '';
  let leaseToken = '';
  try {
    const athleteSnap = await db.collection('strava_athletes').doc(ownerId).get();
    if (!athleteSnap.exists) {
      return res.status(200).json({ success: true, ignored: true });
    }

    const userId = String(athleteSnap.data()?.userId || '').trim();
    if (!userId) {
      return res.status(200).json({ success: true, ignored: true });
    }

    // Compartilha a mesma lease usada pelo sync manual (#145). Isso impede que
    // webhook e /sync renovem simultaneamente o mesmo refresh token rotativo.
    const lease = await reserveProviderLease(userId);
    if (lease.missing) {
      return res.status(200).json({ success: true, ignored: true });
    }
    if (!lease.acquired || !lease.token) {
      res.setHeader('Retry-After', '30');
      return res.status(503).json({ success: false, retryable: true, error: 'Sincronização Strava já em andamento.' });
    }
    leasedUserId = userId;
    leaseToken = lease.token;

    const strava = new StravaApi(userId);
    const activity = await strava.fetchActivity(objectId);
    await SyncService.processStravaActivity(userId, activity);
    return res.status(200).json({ success: true });
  } catch (error: any) {
    console.error(`[Strava Webhook] Falha ao processar atividade ${objectId}:`, error?.message || error);
    // Não devolva 200 em erro transitório: o Strava deve poder reenviar.
    return res.status(503).json({ success: false, retryable: true });
  } finally {
    if (leasedUserId && leaseToken) {
      await releaseProviderLease(leasedUserId, leaseToken).catch((error: any) => {
        console.warn('[Strava Webhook] Falha ao liberar lease do provedor:', error?.message || error);
      });
    }
  }
}
