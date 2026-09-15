import { VercelRequest, VercelResponse } from '@vercel/node';
import { cors } from '../_lib/common.js';

/**
 * A temporada paga antiga foi aposentada em favor de /championships.
 *
 * Mantemos o endpoint como tombstone para que chamadas antigas falhem de forma
 * explícita e auditável, sem executar qualquer settlement financeiro. Os dados
 * históricos (season_inscriptions / season_payouts / settlements) continuam no
 * Firestore para conciliação administrativa.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Método não permitido.' });
  }

  return res.status(410).json({
    success: false,
    code: 'PAID_SEASON_PAYOUT_DISABLED',
    message: 'A premiação automática da antiga temporada paga foi encerrada. Use o fluxo atual de Campeonatos.',
  });
}
