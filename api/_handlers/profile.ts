import { VercelRequest, VercelResponse } from '@vercel/node';
import { db, cors, verifyAuth } from '../_lib/common.js';
import { isActiveAccountState } from '../_lib/account-state.js';

function computeSearchKeywords(name: string): string[] {
  const normalized = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
  const keywords = new Set<string>();
  normalized.split(/\s+/).forEach(part => {
    for (let i = 1; i <= part.length; i++) keywords.add(part.substring(0, i));
  });
  for (let i = 1; i <= normalized.length; i++) keywords.add(normalized.substring(0, i));
  return Array.from(keywords).slice(0, 100);
}

function generateServerReferralCode(uid: string): string {
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${uid.substring(0, 4).toUpperCase()}-${random}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;

  const action = String(req.query.action || req.body?.action || '').trim();
  if (action) return handleAuthenticatedProfileAction(req, res, action);

  const userId = req.query.id as string;
  if (!userId) return res.status(400).json({ error: 'ID do usuário obrigatório.' });

  try {
    const userSnap = await db.collection('users').doc(userId).get();
    const data = userSnap.exists ? userSnap.data() : null;
    // Gate 1: não cacheamos perfil público. Assim exclusão/bloqueio produz
    // efeito imediato e nunca fica exposto por alguns minutos numa instância quente.
    if (!userSnap.exists || !isActiveAccountState(data)) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }

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
      profileLikesCount: Array.isArray(data?.profileLikes) ? data.profileLikes.length : 0,
    };
    return res.json(publicProfile);
  } catch (error: any) {
    const errorMsg = error.message || '';
    const isQuotaError = errorMsg.includes('RESOURCE_EXHAUSTED') || errorMsg.includes('Quota limit exceeded');
    console.error('Profile API Error:', error);
    if (isQuotaError) {
      return res.status(429).json({
        error: 'Servidor sob alta carga. Tente novamente em alguns instantes.',
        code: 'QUOTA_EXHAUSTED',
        fallback: true,
      });
    }
    return res.status(500).json({ error: 'Não foi possível carregar o perfil público.' });
  }
}

async function handleAuthenticatedProfileAction(req: VercelRequest, res: VercelResponse, action: string) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' });

  const auth = await verifyAuth(req);
  if (!auth) return res.status(401).json({ error: 'Autenticação necessária.' });

  const body = req.body || {};

  if (action === 'recognize') {
    const targetUserId = String(body.targetUserId || '').trim();
    if (!targetUserId || targetUserId.length > 128) return res.status(400).json({ error: 'Perfil inválido.' });
    if (targetUserId === auth.uid) return res.status(400).json({ error: 'Você não pode reconhecer o próprio perfil.' });

    const targetRef = db.collection('users').doc(targetUserId);
    const result = await db.runTransaction(async transaction => {
      const targetSnap = await transaction.get(targetRef);
      if (!targetSnap.exists || !isActiveAccountState(targetSnap.data())) throw new Error('PROFILE_NOT_FOUND');
      const currentLikes = Array.isArray(targetSnap.data()?.profileLikes)
        ? targetSnap.data()!.profileLikes.filter((value: unknown) => typeof value === 'string')
        : [];
      const alreadyRecognized = currentLikes.includes(auth.uid);
      if (!alreadyRecognized) transaction.update(targetRef, { profileLikes: [...currentLikes, auth.uid] });
      return { alreadyRecognized, count: currentLikes.length + (alreadyRecognized ? 0 : 1) };
    }).catch(error => {
      if (error?.message === 'PROFILE_NOT_FOUND') return null;
      throw error;
    });

    if (!result) return res.status(404).json({ error: 'Perfil não encontrado.' });
    return res.status(200).json({ recognized: true, ...result });
  }

  if (action === 'check-cpf') {
    const cpf = String(body.cpf || '').replace(/\D/g, '');
    if (cpf.length !== 11) return res.status(400).json({ error: 'CPF inválido.' });
    const snap = await db.collection('users').where('cpf', '==', cpf).limit(2).get();
    const existsForAnotherUser = snap.docs.some((doc) => doc.id !== auth.uid);
    return res.status(200).json({ exists: existsForAnotherUser });
  }

  if (action === 'resolve-referral') {
    const referralCode = String(body.referralCode || '').trim().toUpperCase();
    if (!/^[A-Z0-9-]{4,64}$/.test(referralCode)) return res.status(400).json({ error: 'Código de indicação inválido.' });

    const snap = await db.collection('users').where('referralCode', '==', referralCode).limit(1).get();
    if (snap.empty) return res.status(404).json({ error: 'Código de indicação não encontrado.' });

    const referrer = snap.docs[0];
    if (referrer.id === auth.uid) return res.status(400).json({ error: 'Você não pode usar o próprio código de indicação.' });
    const data = referrer.data() || {};
    if (!isActiveAccountState(data)) return res.status(404).json({ error: 'Código de indicação não encontrado.' });
    return res.status(200).json({ referrer: { uid: referrer.id, displayName: String(data.displayName || 'Atleta Invictus') } });
  }

  if (action === 'create-referral') {
    const referralCode = String(body.referralCode || '').trim().toUpperCase();
    if (!/^[A-Z0-9-]{4,64}$/.test(referralCode)) return res.status(400).json({ error: 'Código de indicação inválido.' });

    const referrerSnap = await db.collection('users').where('referralCode', '==', referralCode).limit(1).get();
    if (referrerSnap.empty) return res.status(404).json({ error: 'Código de indicação não encontrado.' });

    const referrerDoc = referrerSnap.docs[0];
    if (referrerDoc.id === auth.uid) return res.status(400).json({ error: 'Você não pode usar o próprio código de indicação.' });
    if (!isActiveAccountState(referrerDoc.data())) return res.status(404).json({ error: 'Código de indicação não encontrado.' });

    const previousReferral = await db.collection('referrals').where('refereeUid', '==', auth.uid).limit(1).get();
    if (!previousReferral.empty) return res.status(409).json({ error: 'Esta conta já possui uma indicação vinculada.' });

    const referralId = `${referrerDoc.id}_${auth.uid}`;
    const referralRef = db.collection('referrals').doc(referralId);
    const refereeRef = db.collection('users').doc(auth.uid);
    const referrerRef = db.collection('users').doc(referrerDoc.id);
    const referralIndexRef = db.collection('referral_by_referee').doc(auth.uid);

    await db.runTransaction(async (transaction: any) => {
      const [refereeSnap, currentReferrerSnap, existingIndex] = await Promise.all([
        transaction.get(refereeRef), transaction.get(referrerRef), transaction.get(referralIndexRef),
      ]);
      if (!refereeSnap.exists || !isActiveAccountState(refereeSnap.data())) throw new Error('Perfil do usuário não encontrado.');
      if (!currentReferrerSnap.exists || !isActiveAccountState(currentReferrerSnap.data())) throw new Error('Indicador não encontrado.');
      if (existingIndex.exists) throw new Error('Esta conta já possui uma indicação vinculada.');

      const referee = refereeSnap.data() || {};
      const referrer = currentReferrerSnap.data() || {};
      const currentStats = referrer.referralStats || {};
      const totalReferrals = Number(currentStats.totalReferrals || 0) + 1;
      transaction.create(referralRef, {
        id: referralId, referrerUid: referrerDoc.id, refereeUid: auth.uid,
        refereeName: String(referee.displayName || 'Atleta Invictus'), status: 'pending', createdAt: new Date().toISOString(),
      });
      transaction.create(referralIndexRef, {
        referralId, referrerUid: referrerDoc.id, refereeUid: auth.uid, createdAt: new Date().toISOString(),
      });
      transaction.update(referrerRef, { referralStats: { ...currentStats, totalReferrals } });
    });

    const referrerData = referrerDoc.data() || {};
    return res.status(201).json({
      success: true,
      referralId,
      referrer: { uid: referrerDoc.id, displayName: String(referrerData.displayName || 'Atleta Invictus') },
    });
  }

  if (action === 'onboard') {
    const deletionTombstone = await db.collection('deleted_users').doc(auth.uid).get();
    if (deletionTombstone.exists) return res.status(403).json({ error: 'Esta conta foi desativada.', code: 'ACCOUNT_DELETED' });

    const displayName = String(body.displayName || '').trim().slice(0, 128) || 'Atleta';
    const cpf = String(body.cpf || '').replace(/\D/g, '');
    if (cpf && cpf.length !== 11) return res.status(400).json({ error: 'CPF inválido.' });
    const birthDate = /^\d{4}-\d{2}-\d{2}$/.test(String(body.birthDate || '')) ? String(body.birthDate) : '';
    const height = Math.min(300, Math.max(0, parseInt(body.height, 10) || 0));
    const weight = Math.min(400, Math.max(0, parseInt(body.weight, 10) || 0));
    const sex = String(body.sex || '').slice(0, 32);
    const weeklyFrequency = String(body.weeklyFrequency || '').slice(0, 32);
    const bodySelfAssessment = String(body.bodySelfAssessment || '').slice(0, 64);
    const objective = String(body.objective || '').slice(0, 64);
    const preferredPlan = body.preferredPlan === 'open' ? 'open' : 'none';
    const city = String(body.city || '').slice(0, 128);
    const state = String(body.state || '').slice(0, 2).toUpperCase();
    const whatsappEnabled = body.whatsappEnabled === true;
    const whatsappDeclared = Object.prototype.hasOwnProperty.call(body, 'whatsappEnabled');
    const phoneNumber = String(body.phoneNumber || '').slice(0, 32);
    const termsVersionAccepted = String(body.termsVersionAccepted || '').slice(0, 32) || 'unknown';

    if (cpf) {
      const dup = await db.collection('users').where('cpf', '==', cpf).limit(2).get();
      if (dup.docs.some((docSnap: any) => docSnap.id !== auth.uid)) return res.status(409).json({ error: 'Este CPF já está em uso por outra conta.' });
    }

    const wantsToComplete = body.termsAccepted === true && Boolean(cpf) && Boolean(birthDate);
    const userRef = db.collection('users').doc(auth.uid);
    const result = await db.runTransaction(async (transaction: any) => {
      const snap = await transaction.get(userRef);
      const existing: any = snap.exists ? (snap.data() || {}) : {};
      if (snap.exists && !isActiveAccountState(existing)) throw new Error('ACCOUNT_INACTIVE');
      if (existing.termsAccepted === true) return { alreadyOnboarded: true, onboardingComplete: true };

      const now = new Date().toISOString();
      const imc = height > 0 && weight > 0 ? weight / ((height / 100) * (height / 100)) : 0;
      const declaredFields: Record<string, unknown> = {
        displayName,
        displayNameLower: displayName.toLowerCase(),
        searchKeywords: computeSearchKeywords(displayName),
        cpf: cpf || existing.cpf || '',
        birthDate: birthDate || existing.birthDate || '',
        age: birthDate ? (new Date().getFullYear() - new Date(birthDate).getFullYear()) : (existing.age || 0),
        height: height || existing.height || 0,
        weight: weight || existing.weight || 0,
        sex: sex || existing.sex || '',
        imc: imc || existing.imc || 0,
        weeklyFrequency: weeklyFrequency || existing.weeklyFrequency || '',
        bodySelfAssessment: bodySelfAssessment || existing.bodySelfAssessment || '',
        objective: objective || existing.objective || '',
        city: city || existing.city || '',
        state: state || existing.state || '',
        whatsappEnabled: whatsappDeclared ? whatsappEnabled : Boolean(existing.whatsappEnabled),
        phoneNumber: phoneNumber || existing.phoneNumber || '',
      };
      const privilegedFields: Record<string, unknown> = {
        uid: auth.uid,
        email: String(auth.email || existing.email || '').toLowerCase(),
        role: existing.role === 'admin' ? 'admin' : 'user',
        isAdmin: false,
        termsAccepted: wantsToComplete ? true : Boolean(existing.termsAccepted),
        createdAt: existing.createdAt || now,
      };

      if (wantsToComplete) {
        Object.assign(privilegedFields, {
          termsVersionAccepted,
          termsAcceptedAt: now,
          plano: preferredPlan === 'open' ? 'Invictus Open' : 'Nenhum',
          currentPlan: preferredPlan === 'open' ? 'invictus_open' : 'Nenhum',
          assinatura: preferredPlan === 'open' ? 'Ativa' : 'Inativa',
          subscriptionStatus: preferredPlan === 'open' ? 'active_basic' : 'inactive',
          status: 'Ativo',
          paymentStatus: 'Não aplicável',
          statusPagamento: 'Não aplicável',
          premium: false,
          performance: false,
          isSubscribed: false,
          subscriptionTier: preferredPlan === 'open' ? 'open' : 'Nenhum',
          league: 'Comunidade Invictus',
          score: 0,
          xp: 0,
          level: 1,
          streak: 0,
          weeklyScore: 0,
          monthlyScore: 0,
          achievements: [],
          lastCheckIn: null,
          positions: { global: 0, city: 0, gym: 0, national: 0, league: 0, region: 0 },
          country: 'Brasil',
          appCredits: 0,
          badges: [],
          referralCode: existing.referralCode || generateServerReferralCode(auth.uid),
          referralStats: existing.referralStats || { totalReferrals: 0, validReferrals: 0, bonusBalance: 0, referralPoints: 0 },
          referralMilestones: existing.referralMilestones || [],
          isBlocked: false,
          isBanned: false,
          infractions: 0,
          profileLikes: [],
          totalActiveDays: 0,
          totalWorkouts: 0,
          walletBalance: 0,
        });
      }

      const finalDoc = { ...existing, ...declaredFields, ...privilegedFields };
      if (snap.exists) transaction.update(userRef, finalDoc);
      else transaction.set(userRef, finalDoc);
      return { alreadyOnboarded: false, onboardingComplete: Boolean(finalDoc.termsAccepted) };
    }).catch((error: any) => {
      if (error?.message === 'ACCOUNT_INACTIVE') return null;
      throw error;
    });

    if (!result) return res.status(403).json({ error: 'Esta conta está inativa.', code: 'ACCOUNT_INACTIVE' });
    return res.status(200).json({ success: true, ...result });
  }

  if (action === 'device-token' || action === 'remove-device-token') {
    const token = String(body.token || '').trim();
    const platform = body.platform === 'ios' ? 'ios' : 'android';
    const tokenField = platform === 'ios' ? 'apnsTokens' : 'fcmTokens';
    const validToken = platform === 'ios'
      ? /^[A-Fa-f0-9]{64,256}$/.test(token)
      : /^[A-Za-z0-9:._-]{20,4096}$/.test(token);
    if (!validToken) return res.status(400).json({ error: 'Token de dispositivo inválido.' });

    const profileRef = db.collection('users').doc(auth.uid);
    const updated = await db.runTransaction(async (transaction: any) => {
      const profileSnap = await transaction.get(profileRef);
      if (!profileSnap.exists || !isActiveAccountState(profileSnap.data())) return false;
      const current = profileSnap.data() || {};
      const tokens = Array.isArray(current[tokenField])
        ? current[tokenField].filter((item: unknown): item is string => typeof item === 'string')
        : [];
      const updatedTokens = action === 'remove-device-token'
        ? tokens.filter((item: string) => item !== token)
        : [...new Set([...tokens, token])].slice(-10);
      transaction.update(profileRef, { [tokenField]: updatedTokens, pushTokenUpdatedAt: new Date().toISOString() });
      return true;
    });
    if (!updated) return res.status(403).json({ error: 'Conta inativa.' });
    return res.status(200).json({ success: true, registered: action === 'device-token', platform });
  }

  return res.status(400).json({ error: 'Ação de perfil inválida.' });
}
