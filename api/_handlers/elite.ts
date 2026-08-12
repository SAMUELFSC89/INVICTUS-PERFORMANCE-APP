import { VercelRequest, VercelResponse } from '@vercel/node';
import { db, FieldValue, cors, verifyAuth } from '../_lib/common.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;
  
  const { action } = req.query;

  if (req.method === 'POST' && action === 'join-success') {
    const auth = await verifyAuth(req);
    if (!auth) return res.status(401).json({ error: 'Unauthorized' });

    const { userId, seasonId, challengeId, entryFee, userName, userPhoto } = req.body;

    if (!userId || !seasonId || !challengeId) {
      return res.status(400).json({ error: 'Missing parameters' });
    }

    try {
      const batch = db.batch();

      // 1. Update Season Stats
      const seasonRef = db.collection('seasons').doc(seasonId);
      batch.set(seasonRef, {
        athletesCount: FieldValue.increment(1),
        totalPool: FieldValue.increment(entryFee * 0.5) // 50% to pool
      }, { merge: true });

      // 2. Add to Elite Feed
      const feedRef = db.collection('elite_feed').doc();
      batch.set(feedRef, {
        userId,
        userName: userName || 'Atleta',
        userPhoto: userPhoto || '',
        text: `entrou no desafio ${challengeId.split('_')[0]}! 🔥`,
        type: 'join',
        timestamp: new Date().toISOString()
      });

      await batch.commit();
      return res.status(200).json({ success: true });
    } catch (error: any) {
      console.error('[Elite Admin Join Error]', error);
      return res.status(500).json({ error: error.message });
    }
  }

  // Handle other elite actions if needed
  
  return res.status(404).json({ error: 'Action not found' });
}
