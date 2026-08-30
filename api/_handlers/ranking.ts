import { VercelRequest, VercelResponse } from '@vercel/node';
import { cors, db, verifyAuth } from '../_lib/common.js';

type CachedRanking = { topUsers: any[]; timestamp: number };
const serverRankingCache = new Map<string, CachedRanking>();
const CACHE_TTL = 3 * 60 * 1000;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método não permitido.' });

  const auth = await verifyAuth(req);
  if (!auth) return res.status(401).json({ error: 'Autenticação necessária.' });
  if (!db) return res.status(500).json({ error: 'Banco de dados indisponível.' });

  const period = req.query.period === 'monthly' ? 'monthly' : req.query.period === 'all' ? 'all' : 'weekly';
  const scoreField = period === 'weekly' ? 'weeklyScore' : period === 'monthly' ? 'monthlyScore' : 'score';

  try {
    const ownEnrollmentSnapshot = await db.collection('gym_ranking_enrollments').doc(auth.uid).get();
    const ownEnrollment = ownEnrollmentSnapshot.exists ? ownEnrollmentSnapshot.data() : undefined;
    if (ownEnrollment?.enrolled !== true) {
      return res.status(200).json({
        topUsers: [],
        enrolled: false,
        message: 'Entre voluntariamente no ranking para comparar seu IGA com atletas da sua academia.'
      });
    }

    const gymId = String(ownEnrollment.gymId || '').trim();
    if (!gymId) return res.status(409).json({ topUsers: [], enrolled: false, error: 'Adesão sem academia vinculada.' });

    const cacheKey = `${gymId}_${period}_${scoreField}`;
    const now = Date.now();
    const cached = serverRankingCache.get(cacheKey);
    if (cached && now - cached.timestamp < CACHE_TTL && cached.topUsers.some((entry) => entry.uid === auth.uid)) {
      return res.status(200).json({ topUsers: cached.topUsers, enrolled: true, gymId, cached: true });
    }

    const enrollments = await db.collection('gym_ranking_enrollments')
      .where('gymId', '==', gymId)
      .limit(500)
      .get();

    const userRefs = enrollments.docs
      .filter((entry) => entry.data().enrolled === true)
      .map((entry) => db.collection('users').doc(entry.id));
    const userSnapshots = userRefs.length ? await db.getAll(...userRefs) : [];
    const topUsers = userSnapshots
      .filter((snapshot) => snapshot.exists)
      .map((snapshot) => {
        const data = snapshot.data() || {};
        return {
          uid: snapshot.id,
          displayName: data.displayName || 'Atleta',
          photoURL: data.photoURL || '',
          score: Number(data[scoreField] || 0),
          streak: Number(data.streak || 0),
          isSubscribed: data.isSubscribed === true,
          subscriptionTier: data.subscriptionTier || 'open',
          gymId,
          gymName: data.gymName || data.gym || '',
          positions: data.positions || {}
        };
      })
      .sort((left, right) => right.score - left.score)
      .map((entry, index) => ({ ...entry, rank: index + 1 }));

    serverRankingCache.set(cacheKey, { topUsers, timestamp: now });
    return res.status(200).json({ topUsers, enrolled: true, gymId });
  } catch (error: any) {
    console.error('[Ranking API] Falha ao carregar ranking opt-in:', error);
    const isQuotaError = String(error?.message || '').includes('RESOURCE_EXHAUSTED');
    return res.status(isQuotaError ? 429 : 500).json({
      error: isQuotaError ? 'Ranking temporariamente sobrecarregado.' : 'Falha ao carregar ranking.',
      topUsers: []
    });
  }
}
