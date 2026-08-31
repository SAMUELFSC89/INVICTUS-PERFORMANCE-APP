import { VercelRequest, VercelResponse } from '@vercel/node';
import { cors, db, verifyAuth } from '../_lib/common.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;

  // Diagnóstico operacional não deve existir publicamente em produção. Para
  // habilitá-lo, além de ENABLE_ENV_CHECK=true, é necessário ser admin.
  if (process.env.ENABLE_ENV_CHECK !== 'true') {
    return res.status(404).json({ error: 'Não encontrado.' });
  }

  const auth = await verifyAuth(req);
  if (!auth) {
    return res.status(401).json({ error: 'Autenticação necessária.' });
  }

  const userSnap = await db.collection('users').doc(auth.uid).get();
  const userData = userSnap.exists ? userSnap.data() : null;
  if (userData?.role !== 'admin') {
    return res.status(403).json({ error: 'Acesso administrativo necessário.' });
  }

  let firestoreAvailable = false;
  try {
    await db.collection('_connection_test_').doc('ping').get();
    firestoreAvailable = true;
  } catch {
    // Não exponha detalhes de credencial, topologia ou mensagens do SDK.
  }

  return res.json({
    ok: firestoreAvailable,
    timestamp: new Date().toISOString()
  });
}
