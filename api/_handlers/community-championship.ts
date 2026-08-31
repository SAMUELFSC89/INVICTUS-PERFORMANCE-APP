import { VercelRequest, VercelResponse } from '@vercel/node';
import { FieldValue, cors, db, verifyAuth } from '../_lib/common.js';
import { getCommunityGymChampionshipStatus } from '../_lib/championship-scoring-service.js';

const EVENT_ID = 'community_friends_v1';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;
  const auth = await verifyAuth(req);
  if (!auth) return res.status(401).json({ error: 'Autenticação necessária.' });
  if (!db) return res.status(500).json({ error: 'Banco de dados indisponível.' });
  const ref = db.collection('community_championship_enrollments').doc(`${EVENT_ID}_${auth.uid}`);

  if (req.method === 'GET') {
    const [own, count, championship] = await Promise.all([
      ref.get(),
      db.collection('community_championship_enrollments').where('eventId', '==', EVENT_ID).where('status', '==', 'active').count().get(),
      getCommunityGymChampionshipStatus(auth.uid),
    ]);
    return res.status(200).json({ eventId: EVENT_ID, enrolled: own.data()?.status === 'active', participantCount: count.data().count, championship });
  }
  if (req.method === 'POST') {
    await ref.set({ eventId: EVENT_ID, userId: auth.uid, status: 'active', consentVersion: 'community-friends-v1', joinedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return res.status(200).json({ eventId: EVENT_ID, enrolled: true });
  }
  if (req.method === 'DELETE') {
    await ref.set({ status: 'withdrawn', withdrawnAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return res.status(200).json({ eventId: EVENT_ID, enrolled: false });
  }
  res.setHeader('Allow', 'GET, POST, DELETE');
  return res.status(405).json({ error: 'Método não permitido.' });
}
