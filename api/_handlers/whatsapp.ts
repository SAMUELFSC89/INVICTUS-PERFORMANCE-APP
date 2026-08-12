import { cors, verifyAuth } from '../_lib/common.js';

export default async function handler(req: any, res: any) {
  if (cors(req, res)) return;

  const auth = await verifyAuth(req);
  if (!auth) {
    return res.status(401).json({ error: 'Autenticação necessária.' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  const { to, message, type } = req.body;

  console.log(`[WhatsApp API] Mock sending message to ${to}: ${message}`);

  return res.status(200).json({ 
    success: true, 
    message: 'Mock message sent',
    to,
    type
  });
}
