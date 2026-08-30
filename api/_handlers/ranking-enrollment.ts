import { VercelRequest, VercelResponse } from '@vercel/node';
import { FieldValue, cors, db, verifyAuth } from '../_lib/common.js';

const CONSENT_VERSION = 'gym-ranking-v1';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;

  const auth = await verifyAuth(req);
  if (!auth) return res.status(401).json({ error: 'Autenticação necessária.' });
  if (!db) return res.status(500).json({ error: 'Banco de dados indisponível.' });

  const enrollmentRef = db.collection('gym_ranking_enrollments').doc(auth.uid);

  if (req.method === 'GET') {
    const snapshot = await enrollmentRef.get();
    const data = snapshot.exists ? snapshot.data() : undefined;
    return res.status(200).json({
      enrolled: data?.enrolled === true,
      gymId: data?.gymId || '',
      consentVersion: data?.consentVersion || null,
      enrolledAt: data?.enrolledAt?.toDate?.()?.toISOString?.() || data?.enrolledAt || null
    });
  }

  if (req.method === 'POST') {
    const userSnapshot = await db.collection('users').doc(auth.uid).get();
    if (!userSnapshot.exists) return res.status(404).json({ error: 'Perfil não encontrado.' });

    const userData = userSnapshot.data() || {};
    const requestedGymId = typeof req.body?.gymId === 'string' ? req.body.gymId.trim() : '';
    const gymId = requestedGymId || String(userData.gymId || '').trim();
    if (!gymId) {
      return res.status(422).json({
        error: 'Defina sua academia no perfil antes de entrar no ranking.'
      });
    }

    await enrollmentRef.set({
      userId: auth.uid,
      gymId,
      enrolled: true,
      consentVersion: CONSENT_VERSION,
      enrolledAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });

    return res.status(200).json({ enrolled: true, gymId, consentVersion: CONSENT_VERSION });
  }

  if (req.method === 'DELETE') {
    await enrollmentRef.set({
      userId: auth.uid,
      enrolled: false,
      withdrawnAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    return res.status(200).json({ enrolled: false });
  }

  res.setHeader('Allow', 'GET, POST, DELETE');
  return res.status(405).json({ error: 'Método não permitido.' });
}
