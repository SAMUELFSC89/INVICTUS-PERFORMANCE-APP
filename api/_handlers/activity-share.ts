import type { VercelRequest, VercelResponse } from '@vercel/node';
import { cors } from '../_lib/common.js';
import { verifyStrictAuth } from '../_lib/strict-auth.js';
import { createActivityShareGrant } from '../_lib/share-access.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' });

  const auth = await verifyStrictAuth(req);
  if (!auth) return res.status(401).json({ error: 'Autenticação necessária.' });

  const activityId = String(req.body?.activityId || '').trim();
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(activityId)) {
    return res.status(400).json({ error: 'Atividade inválida.' });
  }

  try {
    const grant = await createActivityShareGrant(auth.uid, activityId);
    return res.status(201).json({ token: grant.token, activityId: grant.activityId });
  } catch (error: any) {
    const message = String(error?.message || '');
    return res.status(/não encontrada/i.test(message) ? 404 : 500).json({
      error: /não encontrada/i.test(message) ? message : 'Não foi possível criar o compartilhamento agora.',
    });
  }
}
