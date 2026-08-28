import { VercelRequest, VercelResponse } from '@vercel/node';
import { db, cors, verifyAuth } from '../_lib/common.js';

// Global Process-Level Caching for Scalability (3-minute TTL)
const serverRankingCache = new Map<string, { topUsers: any[]; timestamp: number }>();
const CACHE_TTL = 3 * 60 * 1000; // 3 minutes

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;

  const auth = await verifyAuth(req);
  // Auth is optional for public ranking views

  const level = (req.query.level as string) || 'global';
  const levelId = (req.query.levelId as string) || '';
  const period = (req.query.period as string) || 'all';
  // #104-107: ranking unificado -- Free e Pro competem na mesma lista, um
  // unico criterio de pontuacao (ver src/lib/seasonUtils.ts). O parametro
  // `tier` ainda pode chegar de clientes antigos em cache, mas nao filtra
  // mais nada -- plano vira badge visual no card do usuario, nao um corte de
  // lista. Ver api/_lib/aggregation.ts::updateRankings, que ja gerava o
  // snapshot pre-calculado sem filtro de subscriptionTier.
  const scoreField = period === 'weekly' ? 'weeklyScore' : period === 'monthly' ? 'monthlyScore' : 'score';
  const cacheKey = `${level}_${levelId}_${period}_${scoreField}`;
  const now = Date.now();

  try {
    console.log(`[Ranking API] Query: level=${level}, levelId=${levelId}, period=${period}`);
    
    if (!db) {
      console.error('[Ranking API] Database not initialized');
      return res.status(500).json({ error: 'Falha na inicialização do banco de dados.' });
    }

    // 1. Check process-level cache first
    const cached = serverRankingCache.get(cacheKey);
    if (cached && (now - cached.timestamp < CACHE_TTL)) {
      console.log(`[Ranking API] Serving from in-memory cache for ${cacheKey}`);
      return res.status(200).json({ topUsers: cached.topUsers, cached: true });
    }

    // 2. Attempt to fetch pre-calculated snapshot for global levels (lista unificada, todos os planos)
    if (level === 'global' || level === 'league') {
      const snapshotId = `${level === 'league' ? 'global' : level}_${period}`;
      const snapshotRef = db.collection('aggregated_rankings').doc(snapshotId);
      const snapshotSnap = await snapshotRef.get();

      if (snapshotSnap.exists) {
        const snapshotData = snapshotSnap.data();
        const updatedAt = snapshotData?.updatedAt;
        const updatedAtDate = updatedAt ? new Date(updatedAt) : null;

        if (updatedAtDate) {
          console.log(`[Ranking API] Serving pre-calculated snapshot for ${snapshotId}`);
          const topUsers = snapshotData?.topUsers || [];
          serverRankingCache.set(cacheKey, { topUsers, timestamp: now });
          return res.status(200).json({ topUsers });
        }
      }
    }

    let query: any = db.collection('users');

    if (level === 'league' && levelId) {
      query = query.where('league', '==', levelId);
    } else if (level === 'gym' && levelId) {
      query = query.where('gymId', '==', levelId);
    } else if (level === 'city' && levelId) {
      query = query.where('city', '==', levelId);
    }

    console.log('[Ranking API] Executing query...');
    const snap = await query.orderBy(scoreField, 'desc').limit(500).get();
    console.log(`[Ranking API] Query finished. Found ${snap.size} users.`);

    // Ranking unificado: todos os usuarios da query entram na mesma lista,
    // independente de plano (Free/Pro). Sem limite de 50 -- mostra todos os
    // participantes.
    const topUsers = snap.docs.map((d: any, i: number) => {
      const data = d.data();
      return {
        uid: d.id,
        displayName: data.displayName || 'Atleta',
        photoURL: data.photoURL || '',
        score: data[scoreField] || 0,
        streak: data.streak || 0,
        rank: i + 1,
        isSubscribed: data.isSubscribed || false,
        subscriptionTier: data.subscriptionTier || 'open',
        city: data.city || '',
        gymId: data.gymId || '',
        positions: data.positions || {}
      };
    });

    // Populate the memory cache
    serverRankingCache.set(cacheKey, { topUsers, timestamp: now });

    return res.status(200).json({ topUsers });
  } catch (error: any) {
    const errorMsg = error?.message || '';
    const isQuotaError = errorMsg.includes('RESOURCE_EXHAUSTED') || errorMsg.includes('Quota limit exceeded');
    const isPermissionError = errorMsg.includes('PERMISSION_DENIED') || error?.code === 7 || error?.code === 'permission-denied';
    
    // Safety Net: If Database has transient error, fallback to expired in-memory cache
    const staleCached = serverRankingCache.get(cacheKey);
    if (staleCached) {
      console.warn(`[Ranking API] Serving expired cache for ${cacheKey} due to live db fetch error.`);
      return res.status(200).json({ topUsers: staleCached.topUsers, stale: true });
    }

    if (isPermissionError) {
      console.warn('[Ranking API] Permissão de servidor Firestore pendente de sincronização. Retornando resposta segura.');
      return res.status(200).json({
        topUsers: [],
        message: 'Ranking em atualização.'
      });
    }

    if (isQuotaError) {
       return res.status(429).json({
         error: 'Limite de tráfego excedido temporariamente (Quota).',
         code: 'QUOTA_EXHAUSTED',
         fallback: true,
         topUsers: []
       });
    }

    console.error('Ranking API Error:', error);

    // Check for common index error in Firestore
    const isIndexError = error.message?.includes('index') || error.code === 9;
    
    res.setHeader('Content-Type', 'application/json');
    return res.status(500).json({ 
      error: isIndexError 
        ? 'Erro de Índice: O ranking requer um índice composto no Firestore. Por favor, verifique o console do Firebase.' 
        : (error.message || 'Falha ao carregar ranking'),
      tip: isIndexError ? 'Abra o link de erro no log do servidor para criar o índice automaticamente.' : undefined,
      topUsers: []
    });
  }
}
