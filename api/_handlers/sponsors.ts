import { VercelRequest, VercelResponse } from '@vercel/node';
import { cors, verifyAuth } from '../_lib/common.js';
import { SponsorEngine } from '../_lib/sponsor-engine.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;

  const auth = await verifyAuth(req);
  if (!auth) {
    return res.status(401).json({ success: false, error: 'Sessão inválida ou expirada.' });
  }

  const action = (req.query.action || req.body.action) as string;

  try {
    if (req.method === 'GET') {
      const challenges = await SponsorEngine.getActiveChallenges();
      return res.status(200).json({ success: true, challenges });
    }

    if (req.method === 'POST' && action === 'join') {
      const { challengeId } = req.body;
      if (!challengeId) throw new Error('ID do desafio patrocinado é obrigatório.');

      const result = await SponsorEngine.joinChallenge(auth.uid, String(challengeId));
      return res.status(200).json({ success: true, message: result.message });
    }

    return res.status(400).json({ success: false, error: 'Ação de patrocinador não suportada.' });
  } catch (err: any) {
    console.error('[Sponsors Handler Error]:', err);
    return res.status(400).json({ success: false, error: err.message || 'Erro ao processar desafios patrocinados.' });
  }
}
