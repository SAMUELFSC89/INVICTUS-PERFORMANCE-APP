import { timingSafeEqual } from 'crypto';
import { VercelRequest, VercelResponse } from '@vercel/node';
import { cors } from '../_lib/common.js';
import { finalizeCommunityGymChampionshipCycle } from '../_lib/championship-scoring-service.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ success: false, message: 'Método não permitido.' });
  const secret = process.env.CRON_SECRET || '';
  const header = Array.isArray(req.headers.authorization) ? req.headers.authorization[0] : req.headers.authorization;
  const custom = Array.isArray(req.headers['x-cron-secret']) ? req.headers['x-cron-secret'][0] : req.headers['x-cron-secret'];
  const provided = header?.startsWith('Bearer ') ? header.slice(7).trim() : String(custom || header || '').trim();
  const allowed = Boolean(secret) && provided.length === secret.length && timingSafeEqual(Buffer.from(provided), Buffer.from(secret));
  if (!allowed) return res.status(401).json({ success: false, message: 'Não autorizado.' });
  const previousMonth = new Date();
  previousMonth.setUTCDate(1);
  previousMonth.setUTCMonth(previousMonth.getUTCMonth() - 1);
  const defaultCycle = previousMonth.toISOString().slice(0, 7);
  const cycleKey = String(req.query?.cycleKey || req.body?.cycleKey || defaultCycle);
  try {
    const result = await finalizeCommunityGymChampionshipCycle(cycleKey);
    return res.status(200).json({ success: true, cycleKey, result });
  } catch (error) {
    console.error('[GYM_CHAMPIONSHIP_PAYOUT]', error);
    return res.status(500).json({ success: false, message: 'Não foi possível concluir a auditoria e a premiação do ciclo.' });
  }
}
