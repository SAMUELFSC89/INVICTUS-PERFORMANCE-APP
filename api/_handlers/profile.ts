import { VercelRequest, VercelResponse } from '@vercel/node';
import { db, cors, verifyAuth } from '../_lib/common.js';
import NodeCache from 'node-cache';

const cache = new NodeCache({ stdTTL: 300 }); // Cache for 5 minutes

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;
  
  const userId = req.query.id as string;
  if (!userId) return res.status(400).json({ error: 'ID do usuário obrigatório.' });

  const cacheKey = `profile_${userId}`;
  const cached = cache.get(cacheKey);
  if (cached) return res.json(cached);

  try {
    if (!db) return res.status(500).json({ error: 'Falha na inicialização do banco de dados.' });

    const userSnap = await db.collection('users').doc(userId).get();
    if (!userSnap.exists) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }

    const data = userSnap.data();
    
    // Select ONLY public fields to avoid PII leak
    const publicProfile = {
      uid: userSnap.id,
      displayName: data?.displayName,
      photoURL: data?.photoURL,
      bio: data?.bio,
      city: data?.city,
      state: data?.state,
      streak: data?.streak,
      score: data?.score,
      league: data?.league,
      gymName: data?.gymName,
      gymId: data?.gymId,
      positions: data?.positions,
      achievements: data?.achievements,
      profileLikes: data?.profileLikes || []
    };

    cache.set(cacheKey, publicProfile);
    return res.json(publicProfile);
  } catch (error: any) {
    const errorMsg = error.message || '';
    const isQuotaError = errorMsg.includes('RESOURCE_EXHAUSTED') || errorMsg.includes('Quota limit exceeded');
    
    console.error('Profile API Error:', error);
    
    if (isQuotaError) {
      return res.status(429).json({
        error: 'Servidor sob alta carga. Tente novamente em alguns instantes.',
        code: 'QUOTA_EXHAUSTED',
        fallback: true
      });
    }

    return res.status(500).json({ error: error.message });
  }
}
