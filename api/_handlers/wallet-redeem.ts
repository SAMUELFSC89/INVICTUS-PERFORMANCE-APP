import { VercelRequest, VercelResponse } from '@vercel/node';
import { cors, verifyAuth } from '../_lib/common.js';

/** Compatibilidade fail-closed para versões antigas do aplicativo. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;
  const auth = await verifyAuth(req);
  if (!auth) return res.status(401).json({ success: false, error: 'Não autorizado. Sessão inválida.' });

  return res.status(410).json({
    success: false,
    code: 'PIX_REDEMPTION_DISABLED',
    error: 'Invictus Coins não possuem valor monetário e não podem ser convertidos ou sacados via PIX.'
  });
}
