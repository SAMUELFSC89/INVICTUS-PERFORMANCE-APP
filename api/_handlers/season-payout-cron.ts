import { VercelRequest, VercelResponse } from '@vercel/node';
import { timingSafeEqual } from 'crypto';
import { cors } from '../_lib/common.js';
import { runDailySeasonCheck } from '../_lib/season-prize-engine.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;
  // Vercel Cron dispara GET com Authorization: Bearer <CRON_SECRET>; POST é
  // aceito para execução manual autenticada.
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Método não permitido.' });
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error('[SEASON_PAYOUT_CRON] CRON_SECRET não configurado; execução recusada.');
    return res.status(503).json({ success: false, message: 'Serviço temporariamente indisponível.' });
  }

  const authHeader = req.headers['authorization'];
  const customSecretHeader = req.headers['x-cron-secret'];
  const rawAuthorization = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  const rawCustomSecret = Array.isArray(customSecretHeader) ? customSecretHeader[0] : customSecretHeader;
  const providedSecret = rawAuthorization?.startsWith('Bearer ')
    ? rawAuthorization.slice(7).trim()
    : (rawCustomSecret || rawAuthorization || '').trim();

  const matches = providedSecret.length === cronSecret.length
    && timingSafeEqual(Buffer.from(providedSecret), Buffer.from(cronSecret));
  if (!matches) {
    return res.status(401).json({ success: false, message: 'Não autorizado.' });
  }

  try {
    const result = await runDailySeasonCheck();
    return res.status(200).json({ success: true, result });
  } catch (error: any) {
    console.error('[SEASON_PAYOUT_CRON] Error running season payout check:', error);
    return res.status(500).json({ success: false, message: 'Erro interno ao executar a rotina.' });
  }
}
