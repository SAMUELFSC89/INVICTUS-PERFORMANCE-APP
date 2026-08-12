import { VercelRequest, VercelResponse } from '@vercel/node';
import { cors } from '../_lib/common.js';
import { ScoreEngine } from '../_lib/score-engine/index.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;

  const userId = (req.query.userId || req.query.id || req.body?.userId) as string;
  if (!userId) {
    return res.status(400).json({ error: 'ID do usuário é obrigatório.' });
  }

  try {
    const dashboardData = await ScoreEngine.getPerformanceDashboard(userId);
    return res.json(dashboardData);
  } catch (error: any) {
    console.error('[API] Performance Dashboard Error:', error);
    return res.status(500).json({ error: error.message || 'Erro ao carregar dashboard de performance.' });
  }
}
