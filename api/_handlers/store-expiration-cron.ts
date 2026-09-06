import { timingSafeEqual } from 'node:crypto';
import { VercelRequest, VercelResponse } from '@vercel/node';
import { cors } from '../_lib/common.js';
import { StoreEngine } from '../_lib/store-engine.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Método não permitido.' });
  }

  const secret = process.env.CRON_SECRET || '';
  if (!secret) {
    console.error('[STORE_EXPIRATION_CRON] CRON_SECRET não configurado; execução recusada.');
    return res.status(503).json({ success: false, message: 'Serviço temporariamente indisponível.' });
  }
  const authorization = Array.isArray(req.headers.authorization) ? req.headers.authorization[0] : req.headers.authorization;
  const custom = Array.isArray(req.headers['x-cron-secret']) ? req.headers['x-cron-secret'][0] : req.headers['x-cron-secret'];
  const provided = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : String(custom || authorization || '').trim();
  const providedBuffer = Buffer.from(provided);
  const secretBuffer = Buffer.from(secret);
  const allowed = providedBuffer.length === secretBuffer.length && timingSafeEqual(providedBuffer, secretBuffer);
  if (!allowed) return res.status(401).json({ success: false, message: 'Não autorizado.' });

  const limit = Math.min(100, Math.max(1, Math.trunc(Number(req.query?.limit || req.body?.limit) || 50)));
  try {
    const result = await StoreEngine.expirePendingOrders(limit);
    return res.status(200).json({ success: true, result });
  } catch (error) {
    console.error('[STORE_EXPIRATION_CRON] Falha na varredura de pedidos pendentes:', error);
    return res.status(500).json({ success: false, message: 'Não foi possível executar a expiração de pedidos.' });
  }
}
