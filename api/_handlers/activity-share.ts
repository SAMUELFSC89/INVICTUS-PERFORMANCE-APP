import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHash } from 'node:crypto';
import { cors, db } from '../_lib/common.js';
import { verifyStrictAuth } from '../_lib/strict-auth.js';
import { createActivityShareGrant, revokeActivityShareGrant } from '../_lib/share-access.js';

const SHARE_RATE_WINDOW_MS = 60_000;
const SHARE_RATE_MAX = 20;

function rateLimitDocumentId(userId: string): string {
  return `activity_share_${createHash('sha256').update(userId).digest('hex')}`;
}

async function consumeShareRateLimit(userId: string): Promise<boolean> {
  const ref = db.collection('api_rate_limits').doc(rateLimitDocumentId(userId));
  const now = Date.now();
  return db.runTransaction(async (transaction: any) => {
    const snap = await transaction.get(ref);
    const data = snap.exists ? snap.data() || {} : {};
    const windowStartedAt = Number(data.windowStartedAt) || 0;
    const count = Math.max(0, Number(data.count) || 0);

    if (!windowStartedAt || now - windowStartedAt >= SHARE_RATE_WINDOW_MS) {
      transaction.set(ref, {
        scope: 'activity-share',
        userId,
        windowStartedAt: now,
        count: 1,
        updatedAt: new Date(now).toISOString(),
      }, { merge: true });
      return true;
    }

    if (count >= SHARE_RATE_MAX) return false;
    transaction.set(ref, {
      count: count + 1,
      updatedAt: new Date(now).toISOString(),
    }, { merge: true });
    return true;
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');

  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' });

  const auth = await verifyStrictAuth(req);
  if (!auth) return res.status(401).json({ error: 'Autenticação necessária.' });

  try {
    if (!await consumeShareRateLimit(auth.uid)) {
      return res.status(429).json({ error: 'Muitas operações de compartilhamento. Tente novamente em instantes.' });
    }

    const action = req.body?.action === 'revoke' ? 'revoke' : 'create';
    if (action === 'revoke') {
      const token = String(req.body?.token || '').trim();
      if (!/^[A-Za-z0-9_-]{24,128}$/.test(token)) {
        return res.status(400).json({ error: 'Compartilhamento inválido.' });
      }
      const revoked = await revokeActivityShareGrant(auth.uid, token);
      if (!revoked) return res.status(404).json({ error: 'Compartilhamento não encontrado.' });
      return res.status(200).json({ success: true, revoked: true });
    }

    const activityId = String(req.body?.activityId || '').trim();
    if (!/^[A-Za-z0-9_-]{1,160}$/.test(activityId)) {
      return res.status(400).json({ error: 'Atividade inválida.' });
    }

    const grant = await createActivityShareGrant(auth.uid, activityId);
    return res.status(201).json({ token: grant.token, activityId: grant.activityId });
  } catch (error: any) {
    const message = String(error?.message || '');
    return res.status(/não encontrada/i.test(message) ? 404 : 500).json({
      error: /não encontrada/i.test(message) ? message : 'Não foi possível concluir o compartilhamento agora.',
    });
  }
}
