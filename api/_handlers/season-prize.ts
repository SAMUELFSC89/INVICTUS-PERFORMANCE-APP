import { VercelRequest, VercelResponse } from '@vercel/node';
import { cors, verifyAuth } from '../_lib/common.js';

/**
 * A antiga temporada paga foi encerrada e a UI foi migrada para Campeonatos.
 * Este endpoint permanece apenas como tombstone autenticado para impedir que
 * clientes antigos apresentem pote/premiação de um motor que não faz mais parte
 * do produto atual.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;

  const auth = await verifyAuth(req);
  if (!auth) return res.status(401).json({ error: 'Nao autenticado' });

  return res.status(410).json({
    success: false,
    code: 'PAID_SEASON_DISABLED',
    error: 'A antiga temporada paga foi encerrada. Consulte os Campeonatos atuais.',
  });
}
