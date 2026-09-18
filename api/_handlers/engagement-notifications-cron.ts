import { timingSafeEqual } from 'node:crypto';
import { VercelRequest, VercelResponse } from '@vercel/node';
import { cors } from '../_lib/common.js';
import { runEngagementRule } from '../_lib/engagement-notification-engine.js';
import { firstWorkoutOfDayReminderRule } from '../_lib/engagement-rules/first-workout-reminder.js';

const RULES = [firstWorkoutOfDayReminderRule];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Método não permitido.' });
  }

  const secret = process.env.CRON_SECRET || '';
  if (!secret) {
    console.error('[ENGAGEMENT_NOTIFICATIONS_CRON] CRON_SECRET não configurado; execução recusada.');
    return res.status(503).json({ success: false, message: 'Serviço temporariamente indisponível.' });
  }
  const authorization = Array.isArray(req.headers.authorization) ? req.headers.authorization[0] : req.headers.authorization;
  const custom = Array.isArray(req.headers['x-cron-secret']) ? req.headers['x-cron-secret'][0] : req.headers['x-cron-secret'];
  const provided = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : String(custom || authorization || '').trim();
  const providedBuffer = Buffer.from(provided);
  const secretBuffer = Buffer.from(secret);
  const allowed = providedBuffer.length === secretBuffer.length && timingSafeEqual(providedBuffer, secretBuffer);
  if (!allowed) return res.status(401).json({ success: false, message: 'Não autorizado.' });

  try {
    const results = [];
    for (const rule of RULES) {
      results.push(await runEngagementRule(rule));
    }
    return res.status(200).json({ success: true, results });
  } catch (error) {
    console.error('[ENGAGEMENT_NOTIFICATIONS_CRON] Falha ao executar regras de engajamento:', error);
    return res.status(500).json({ success: false, message: 'Não foi possível executar as notificações de engajamento.' });
  }
}
