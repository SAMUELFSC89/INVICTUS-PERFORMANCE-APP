import type { VercelRequest, VercelResponse } from '@vercel/node';
import { cors, db } from './_lib/common.js';
import { StravaApi } from './_lib/strava-api.js';
import { SyncService } from './_lib/sync-service.js';

function firstQueryValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? String(value[0] || '') : String(value || '');
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

  try {
    const athleteSnap = await db.collection('strava_athletes').doc(ownerId).get();
    if (!athleteSnap.exists) {
      return res.status(200).json({ success: true, ignored: true });
    }

    const userId = String(athleteSnap.data()?.userId || '').trim();
    if (!userId) {
      return res.status(200).json({ success: true, ignored: true });
    }

    const strava = new StravaApi(userId);
    const activity = await strava.fetchActivity(objectId);
    await SyncService.processStravaActivity(userId, activity);
    return res.status(200).json({ success: true });
  } catch (error: any) {
    console.error(`[Strava Webhook] Falha ao processar atividade ${objectId}:`, error?.message || error);
    // Não devolva 200 em erro transitório: o Strava deve poder reenviar.
    return res.status(503).json({ success: false, retryable: true });
  }
}
