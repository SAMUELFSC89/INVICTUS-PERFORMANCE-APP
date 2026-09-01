import { VercelRequest, VercelResponse } from '@vercel/node';
import { cors, verifyAuth } from '../_lib/common.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método não permitido.' });
  const user = await verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'Autenticação necessária.' });

  const token = String(
    process.env.MAPBOX_PUBLIC_TOKEN ||
    process.env.VITE_MAPBOX_MOBILE_TOKEN ||
    process.env.VITE_MAPBOX_WEB_TOKEN ||
    process.env.MAPBOX_ACCESS_TOKEN || ''
  ).trim();
  if (!token.startsWith('pk.')) {
    return res.status(503).json({ error: 'Token público do Mapbox não configurado.' });
  }
  res.setHeader('Cache-Control', 'private, max-age=3600');
  return res.status(200).json({ token });
}
