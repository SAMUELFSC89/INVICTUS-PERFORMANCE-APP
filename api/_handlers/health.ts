import { db, cors, verifyAuth } from '../_lib/common.js';

export default async function handler(req: any, res: any) {
  if (cors(req, res)) return;

  // Liveness público não revela projeto, banco, credenciais ou mensagens do
  // SDK. Um teste real de Firestore exige autenticação administrativa.
  if (req.query?.full !== 'true') {
    return res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
  }

  const auth = await verifyAuth(req);
  if (!auth) return res.status(401).json({ error: 'Autenticação necessária.' });

  const userSnap = await db.collection('users').doc(auth.uid).get();
  const role = userSnap.exists ? userSnap.data()?.role : undefined;
  if (role !== 'admin') {
    return res.status(403).json({ error: 'Acesso administrativo necessário.' });
  }

  let firestoreAvailable = false;

  try {
    await db.collection('_connection_test_').doc('ping').get();
    firestoreAvailable = true;
  } catch {
    // A resposta não deve expor detalhes internos de rede ou credencial.
  }

  return res.status(200).json({
    status: firestoreAvailable ? 'ok' : 'degraded',
    firestoreAvailable,
    timestamp: new Date().toISOString()
  });
}
