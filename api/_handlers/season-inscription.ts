import { VercelRequest, VercelResponse } from '@vercel/node';
import { cors, verifyAuth } from '../_lib/common.js';

/** Rota legada da antiga temporada paga, agora encerrada. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;
  const auth = await verifyAuth(req);
  if (!auth) return res.status(401).json({ success: false, error: 'Não autenticado.' });

  return res.status(410).json({
    success: false,
    code: 'PAID_SEASON_DISABLED',
    error: 'A antiga temporada paga foi encerrada. O campeonato gratuito continua disponível; campeonatos pagos de musculação e cardio estão EM BREVE.'
  });
}
