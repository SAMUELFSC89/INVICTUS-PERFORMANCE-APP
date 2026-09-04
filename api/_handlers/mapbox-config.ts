import { VercelRequest, VercelResponse } from '@vercel/node';
import { cors, verifyAuth } from '../_lib/common.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método não permitido.' });
  const user = await verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'Autenticação necessária.' });

  // Esta rota so existe para alimentar o Mapbox GL JS RODANDO NO CLIENTE
  // (LiveTrackingMap.tsx) quando o token embutido no build esta vazio -- o
  // que sempre acontece no app iOS/Android hoje, porque o codemagic.yaml nao
  // injeta VITE_MAPBOX_MOBILE_TOKEN/VITE_MAPBOX_WEB_TOKEN no `npm run build`.
  // Isso e diferente de api/activity-map.ts: ali o proprio servidor chama o
  // Mapbox e controla o header Referer, entao o token com restricao de URL
  // do site (MAPBOX_PUBLIC_TOKEN) e o certo. Aqui quem chama o Mapbox depois
  // e o navegador/WebView do usuario, cuja origem real pode ser
  // "capacitor://localhost" (app nativo) e nunca vai bater com uma
  // restricao de URL pensada para o dominio do site -- o pedido do mapa
  // sairia 403 mesmo com um token valido em mãos. Por isso preferimos aqui
  // o token mobile, que nao tem restricao de URL cadastrada e funciona de
  // qualquer origem (web incluida).
  const token = String(
    process.env.VITE_MAPBOX_MOBILE_TOKEN ||
    process.env.MAPBOX_PUBLIC_TOKEN ||
    process.env.VITE_MAPBOX_WEB_TOKEN ||
    process.env.MAPBOX_ACCESS_TOKEN || ''
  ).trim();
  if (!token.startsWith('pk.')) {
    return res.status(503).json({ error: 'Token público do Mapbox não configurado.' });
  }
  res.setHeader('Cache-Control', 'private, max-age=3600');
  return res.status(200).json({ token });
}
