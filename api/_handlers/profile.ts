import { VercelRequest, VercelResponse } from '@vercel/node';
import { db, cors, verifyAuth } from '../_lib/common.js';
import NodeCache from 'node-cache';

const cache = new NodeCache({ stdTTL: 300 }); // Cache for 5 minutes

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;

  const action = String(req.query.action || req.body?.action || '').trim();
  if (action) {
    return handleAuthenticatedProfileAction(req, res, action);
  }
  
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
      profileLikesCount: Array.isArray(data?.profileLikes) ? data.profileLikes.length : 0
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

    return res.status(500).json({ error: 'Não foi possível carregar o perfil público.' });
  }
}

/**
 * Operações que antes consultavam/escreviam a coleção users diretamente pelo
 * SDK do cliente. Mantê-las no servidor permite fechar a leitura de CPF e
 * estatísticas privadas nas Firestore Rules.
 */
async function handleAuthenticatedProfileAction(req: VercelRequest, res: VercelResponse, action: string) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido.' });
  }

  const auth = await verifyAuth(req);
  if (!auth) {
    return res.status(401).json({ error: 'Autenticação necessária.' });
  }

  const body = req.body || {};

  if (action === 'check-cpf') {
    const cpf = String(body.cpf || '').replace(/\D/g, '');
    if (cpf.length !== 11) {
      return res.status(400).json({ error: 'CPF inválido.' });
    }

    const snap = await db.collection('users').where('cpf', '==', cpf).limit(2).get();
    const existsForAnotherUser = snap.docs.some((doc) => doc.id !== auth.uid);
    // Deliberadamente devolvemos apenas o booleano: nunca uid, nome ou e-mail
    // de quem já usa o CPF.
    return res.status(200).json({ exists: existsForAnotherUser });
  }

  if (action === 'resolve-referral') {
    const referralCode = String(body.referralCode || '').trim().toUpperCase();
    if (!/^[A-Z0-9-]{4,64}$/.test(referralCode)) {
      return res.status(400).json({ error: 'Código de indicação inválido.' });
    }

    const snap = await db.collection('users')
      .where('referralCode', '==', referralCode)
      .limit(1)
      .get();

    if (snap.empty) {
      return res.status(404).json({ error: 'Código de indicação não encontrado.' });
    }

    const referrer = snap.docs[0];
    if (referrer.id === auth.uid) {
      return res.status(400).json({ error: 'Você não pode usar o próprio código de indicação.' });
    }

    const data = referrer.data() || {};
    return res.status(200).json({
      referrer: {
        uid: referrer.id,
        displayName: String(data.displayName || 'Atleta Invictus')
      }
    });
  }

  if (action === 'create-referral') {
    const referralCode = String(body.referralCode || '').trim().toUpperCase();
    if (!/^[A-Z0-9-]{4,64}$/.test(referralCode)) {
      return res.status(400).json({ error: 'Código de indicação inválido.' });
    }

    const referrerSnap = await db.collection('users')
      .where('referralCode', '==', referralCode)
      .limit(1)
      .get();

    if (referrerSnap.empty) {
      return res.status(404).json({ error: 'Código de indicação não encontrado.' });
    }

    const referrerDoc = referrerSnap.docs[0];
    if (referrerDoc.id === auth.uid) {
      return res.status(400).json({ error: 'Você não pode usar o próprio código de indicação.' });
    }

    const previousReferral = await db.collection('referrals')
      .where('refereeUid', '==', auth.uid)
      .limit(1)
      .get();
    if (!previousReferral.empty) {
      return res.status(409).json({ error: 'Esta conta já possui uma indicação vinculada.' });
    }

    const referralId = `${referrerDoc.id}_${auth.uid}`;
    const referralRef = db.collection('referrals').doc(referralId);
    const refereeRef = db.collection('users').doc(auth.uid);
    const referrerRef = db.collection('users').doc(referrerDoc.id);
    // Índice com ID determinístico evita duas indicações concorrentes para a
    // mesma conta, inclusive em requisições simultâneas.
    const referralIndexRef = db.collection('referral_by_referee').doc(auth.uid);

    await db.runTransaction(async (transaction: any) => {
      const [refereeSnap, currentReferrerSnap, existingIndex] = await Promise.all([
        transaction.get(refereeRef),
        transaction.get(referrerRef),
        transaction.get(referralIndexRef)
      ]);

      if (!refereeSnap.exists) throw new Error('Perfil do usuário não encontrado.');
      if (!currentReferrerSnap.exists) throw new Error('Indicador não encontrado.');
      if (existingIndex.exists) throw new Error('Esta conta já possui uma indicação vinculada.');

      const referee = refereeSnap.data() || {};
      const referrer = currentReferrerSnap.data() || {};
      const currentStats = referrer.referralStats || {};
      const totalReferrals = Number(currentStats.totalReferrals || 0) + 1;

      transaction.create(referralRef, {
        id: referralId,
        referrerUid: referrerDoc.id,
        refereeUid: auth.uid,
        refereeName: String(referee.displayName || 'Atleta Invictus'),
        status: 'pending',
        createdAt: new Date().toISOString()
      });
      transaction.create(referralIndexRef, {
        referralId,
        referrerUid: referrerDoc.id,
        refereeUid: auth.uid,
        createdAt: new Date().toISOString()
      });
      transaction.update(referrerRef, {
        referralStats: { ...currentStats, totalReferrals }
      });
    });

    const referrerData = referrerDoc.data() || {};
    return res.status(201).json({
      success: true,
      referralId,
      referrer: {
        uid: referrerDoc.id,
        displayName: String(referrerData.displayName || 'Atleta Invictus')
      }
    });
  }

  if (action === 'device-token' || action === 'remove-device-token') {
    const token = String(body.token || '').trim();
    const platform = body.platform === 'ios' ? 'ios' : 'android';
    const tokenField = platform === 'ios' ? 'apnsTokens' : 'fcmTokens';
    // Tokens FCM/APNs são opacos, mas têm formato limitado. Não guarde payloads
    // arbitrários, URLs ou textos em um campo que será usado pelo serviço push.
    const validToken = platform === 'ios'
      ? /^[A-Fa-f0-9]{64,256}$/.test(token)
      : /^[A-Za-z0-9:._-]{20,4096}$/.test(token);
    if (!validToken) {
      return res.status(400).json({ error: 'Token de dispositivo inválido.' });
    }

    const profileRef = db.collection('users').doc(auth.uid);
    await db.runTransaction(async (transaction: any) => {
      const profileSnap = await transaction.get(profileRef);
      if (!profileSnap.exists) throw new Error('Perfil do usuário não encontrado.');
      const current = profileSnap.data() || {};
      const tokens = Array.isArray(current[tokenField])
        ? current[tokenField].filter((item: unknown): item is string => typeof item === 'string')
        : [];
      const updatedTokens = action === 'remove-device-token'
        ? tokens.filter((item: string) => item !== token)
        : [...new Set([...tokens, token])].slice(-10);

      transaction.update(profileRef, {
        [tokenField]: updatedTokens,
        pushTokenUpdatedAt: new Date().toISOString()
      });
    });
    return res.status(200).json({
      success: true,
      registered: action === 'device-token',
      platform
    });
  }

  return res.status(400).json({ error: 'Ação de perfil inválida.' });
}
