import { VercelRequest, VercelResponse } from '@vercel/node';
import { cors, db, verifyAuth } from '../_lib/common.js';
import { ScoreEngine } from '../_lib/score-engine/index.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;

  const auth = await verifyAuth(req);
  if (!auth) {
    return res.status(401).json({ error: 'Autenticação necessária.' });
  }

  const userId = (req.query.userId || req.query.id || req.body?.userId) as string;
  if (!userId) {
    return res.status(400).json({ error: 'ID do usuário é obrigatório.' });
  }

  const ownDashboard = userId === auth.uid;
  if (!ownDashboard) {
    const adminSnap = await db.collection('users').doc(auth.uid).get();
    const adminEmails = new Set(['samuelfsc89@gmail.com', 'mucafsc89@gmail.com']);
    const isAdmin = adminSnap.data()?.role === 'admin'
      || adminEmails.has(String(auth.email || '').toLowerCase());
    if (!isAdmin) {
      return res.status(403).json({ error: 'Não é permitido consultar o desempenho de outro usuário.' });
    }
  }

  try {
    const dashboardData = await ScoreEngine.getPerformanceDashboard(userId);
    return res.json(dashboardData);
  } catch (error: any) {
    console.error('[API] Performance Dashboard Error:', error);
    return res.status(500).json({ error: 'Erro ao carregar dashboard de performance.' });
  }
}
