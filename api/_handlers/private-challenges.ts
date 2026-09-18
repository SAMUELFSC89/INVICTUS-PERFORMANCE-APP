import { createHash } from 'node:crypto';
import { VercelRequest, VercelResponse } from '@vercel/node';
import { db, cors, verifyAuth } from '../_lib/common.js';
import { isProUser } from '../_lib/entitlement.js';
import { isActiveAccountState } from '../_lib/account-state.js';
import { computePrivateChallengeIGAForWindow } from '../_lib/private-challenge-iga.js';

const MAX_STAKE_AMOUNT = 2000;

type CoinWallet = {
  userId?: string;
  balance?: number;
  lifetimeEarned?: number;
  lifetimeSpent?: number;
  updatedAt?: string;
};

function emptyWallet(userId: string): CoinWallet {
  return { userId, balance: 0, lifetimeEarned: 0, lifetimeSpent: 0, updatedAt: new Date().toISOString() };
}

function coinTransactionId(userId: string, idempotencyKey: string): string {
  const digest = createHash('sha256').update(`${userId}\u0000${idempotencyKey}`).digest('hex');
  return `coin_${digest}`;
}

function normalizeStake(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return 0;
  const amount = Number(value);
  if (!Number.isFinite(amount) || !Number.isInteger(amount) || amount < 0 || amount > MAX_STAKE_AMOUNT) return null;
  return amount;
}

function walletValues(wallet: CoinWallet) {
  return {
    balance: Math.max(0, Number(wallet.balance) || 0),
    lifetimeEarned: Math.max(0, Number(wallet.lifetimeEarned) || 0),
    lifetimeSpent: Math.max(0, Number(wallet.lifetimeSpent) || 0),
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;

  const auth = await verifyAuth(req);
  if (!auth) return res.status(401).json({ error: 'Não autorizado.' });

  const action = String(req.query.action || req.body?.action || 'list');

  try {
    if (!db) return res.status(500).json({ error: 'Banco de dados não disponível.' });

    switch (action) {
      case 'create':
        return await handleCreateChallenge(req, res, auth.uid);
      case 'join':
        return await handleJoinChallenge(req, res, auth.uid);
      case 'list':
      default:
        return await handleListChallenges(req, res, auth.uid);
    }
  } catch (error: any) {
    console.error('[Private Challenges API Error]:', error);
    return res.status(500).json({ error: error.message || 'Erro ao processar requisição de desafios.' });
  }
}

async function handleListChallenges(_req: VercelRequest, res: VercelResponse, userId: string) {
  const challengesRef = db.collection('private_challenges');
  const nowISO = new Date().toISOString();
  const activeAndFormingSnap = await challengesRef.where('status', 'in', ['forming', 'active']).get();

  for (const challengeDoc of activeAndFormingSnap.docs) {
    const challenge = challengeDoc.data();
    if (challenge.endDate && challenge.endDate < nowISO) await processChallengeExpiration(challengeDoc.id);
  }

  const allChallengesSnap = await challengesRef.orderBy('createdAt', 'desc').get();
  const challengesList: any[] = [];

  for (const challengeDoc of allChallengesSnap.docs) {
    const cData = challengeDoc.data();
    const challengeId = challengeDoc.id;
    const isCreator = cData.creatorId === userId;
    const membersSnap = await db.collection('private_challenge_members').where('challengeId', '==', challengeId).get();
    const members = membersSnap.docs.map(mDoc => {
      const m = mDoc.data();
      return {
        userId: m.userId,
        userName: m.userName || 'Atleta',
        userPhoto: m.userPhoto || '',
        points: m.points || 0,
        workoutsCount: m.workoutsCount || 0,
        joinedAt: m.joinedAt,
        stakePaid: Math.max(0, Number(m.stakeAmount) || 0),
      };
    }).sort((a, b) => b.points - a.points);

    const isCurrentUserMember = members.some(m => m.userId === userId);
    if (!isCreator && !isCurrentUserMember) continue;

    challengesList.push({
      id: challengeId,
      title: cData.title,
      description: cData.description || '',
      creatorId: cData.creatorId,
      creatorName: cData.creatorName,
      creatorPhoto: cData.creatorPhoto,
      inviteCode: cData.inviteCode,
      durationDays: cData.durationDays,
      status: cData.status,
      createdAt: cData.createdAt,
      startDate: cData.startDate,
      endDate: cData.endDate,
      participantsCount: members.length,
      winnerId: cData.winnerId || null,
      winnerName: cData.winnerName || null,
      winnerPhoto: cData.winnerPhoto || null,
      resultStatus: cData.resultStatus || null,
      resultReason: cData.resultReason || null,
      stakeAmount: Math.max(0, Number(cData.stakeAmount) || 0),
      potTotal: Math.max(0, Number(cData.potTotal) || 0),
      extendedOnce: cData.extendedOnce === true,
      isMember: isCurrentUserMember,
      members,
      isLegacyMoneyChallenge: typeof cData.entryFee === 'number' && cData.entryFee > 0,
      entryFee: cData.entryFee,
      netPrizePool: cData.netPrizePool,
    });
  }

  return res.status(200).json({ success: true, challenges: challengesList });
}

async function handleCreateChallenge(req: VercelRequest, res: VercelResponse, userId: string) {
  const { title, durationDays, description, stakeAmount } = req.body || {};
  if (!title || !durationDays) return res.status(400).json({ error: 'Parâmetros título e duração são obrigatórios.' });

  const durationNum = Number(durationDays);
  if (![7, 15, 30].includes(durationNum)) return res.status(400).json({ error: 'Duração aceita apenas 7, 15 ou 30 dias.' });
  const stakeNum = normalizeStake(stakeAmount);
  if (stakeNum === null) return res.status(400).json({ error: `A aposta deve ser um número inteiro de Invictus Coins entre 0 e ${MAX_STAKE_AMOUNT}.` });

  const userRef = db.collection('users').doc(userId);
  const userSnap = await userRef.get();
  if (!userSnap.exists) return res.status(404).json({ error: 'Perfil do usuário não encontrado.' });
  const userData = userSnap.data() || {};
  if (!isProUser(userData)) {
    return res.status(403).json({ error: 'Desafios privados são exclusivos para assinantes PRO. Assine o Invictus PRO para criar um desafio.' });
  }
  if (stakeNum > 0 && !isActiveAccountState(userData)) return res.status(403).json({ error: 'Conta inativa não pode apostar Invictus Coins.' });

  const inviteCode = Math.random().toString(36).substring(2, 8).toUpperCase();
  const now = new Date();
  const endDate = new Date(now.getTime() + durationNum * 24 * 60 * 60 * 1000);
  const challengeId = db.collection('private_challenges').doc().id;

  await db.runTransaction(async (transaction: any) => {
    const challengeRef = db.collection('private_challenges').doc(challengeId);
    const memberRef = db.collection('private_challenge_members').doc(`${userId}_${challengeId}`);
    let stakeTxId: string | null = null;

    if (stakeNum > 0) {
      const walletRef = db.collection('reward_coin_wallets').doc(userId);
      const walletSnap = await transaction.get(walletRef);
      const wallet = walletSnap.exists ? (walletSnap.data() as CoinWallet) : emptyWallet(userId);
      const current = walletValues(wallet);
      if (current.balance < stakeNum) throw new Error('Saldo de Invictus Coins insuficiente para esta aposta.');
      stakeTxId = coinTransactionId(userId, `private_challenge_stake_${challengeId}`);
      const createdAt = now.toISOString();
      transaction.create(db.collection('reward_coin_transactions').doc(stakeTxId), {
        id: stakeTxId,
        userId,
        amount: stakeNum,
        type: 'debit',
        origin: 'private_challenge_stake',
        ledgerType: 'PRIVATE_CHALLENGE_STAKE',
        description: `Aposta ao criar o desafio privado "${title}"`,
        idempotencyKey: `private_challenge_stake_${challengeId}`,
        balanceBefore: current.balance,
        balanceAfter: current.balance - stakeNum,
        createdAt,
      });
      transaction.set(walletRef, {
        userId,
        balance: current.balance - stakeNum,
        lifetimeEarned: current.lifetimeEarned,
        lifetimeSpent: current.lifetimeSpent + stakeNum,
        updatedAt: createdAt,
      }, { merge: true });
    }

    transaction.set(challengeRef, {
      title,
      description: description || '',
      creatorId: userId,
      creatorName: userData.displayName || 'Atleta',
      creatorPhoto: userData.photoURL || '',
      inviteCode,
      durationDays: durationNum,
      status: 'forming',
      createdAt: now.toISOString(),
      startDate: now.toISOString(),
      endDate: endDate.toISOString(),
      updatedAt: now.toISOString(),
      stakeAmount: stakeNum,
      potTotal: stakeNum,
      extendedOnce: false,
    });

    transaction.set(memberRef, {
      userId,
      userName: userData.displayName || 'Atleta',
      userPhoto: userData.photoURL || '',
      challengeId,
      points: 0,
      workoutsCount: 0,
      joinedAt: now.toISOString(),
      updatedAt: now.toISOString(),
      stakeAmount: stakeNum,
      stakeTxId,
    });
  });

  return res.status(200).json({ success: true, challengeId, inviteCode, stakeAmount: stakeNum });
}

async function handleJoinChallenge(req: VercelRequest, res: VercelResponse, userId: string) {
  const inviteCode = String(req.body?.inviteCode || '').trim().toUpperCase();
  if (!inviteCode) return res.status(400).json({ error: 'Código de convite é obrigatório.' });

  const challengeQuerySnap = await db.collection('private_challenges').where('inviteCode', '==', inviteCode).limit(1).get();
  if (challengeQuerySnap.empty) return res.status(404).json({ error: 'Desafio não encontrado com este código de convite.' });
  const challengeDoc = challengeQuerySnap.docs[0];
  const challengeId = challengeDoc.id;
  const cData = challengeDoc.data();
  if (['completed', 'cancelled'].includes(cData.status)) return res.status(400).json({ error: 'Este desafio privado já foi finalizado ou cancelado.' });
  if (typeof cData.entryFee === 'number' && cData.entryFee > 0) {
    return res.status(400).json({ error: 'Este desafio usa o modelo antigo (com taxa em dinheiro) e está sendo encerrado. Peça ao criador para abrir um novo desafio PRO, sem custo.' });
  }

  const memberRef = db.collection('private_challenge_members').doc(`${userId}_${challengeId}`);
  if ((await memberRef.get()).exists) return res.status(400).json({ error: 'Você já faz parte deste desafio privado!' });

  const userSnap = await db.collection('users').doc(userId).get();
  if (!userSnap.exists) return res.status(404).json({ error: 'Perfil do usuário não encontrado.' });
  const userData = userSnap.data() || {};
  if (!isProUser(userData)) {
    return res.status(403).json({ error: 'Desafios privados são exclusivos para assinantes PRO. Assine o Invictus PRO para participar.' });
  }
  const stakeNum = Math.max(0, Number(cData.stakeAmount) || 0);
  if (stakeNum > 0 && !isActiveAccountState(userData)) return res.status(403).json({ error: 'Conta inativa não pode apostar Invictus Coins.' });
  const now = new Date();

  await db.runTransaction(async (transaction: any) => {
    const freshChallengeSnap = await transaction.get(challengeDoc.ref);
    if (!freshChallengeSnap.exists) throw new Error('Desafio não encontrado.');
    const freshChallenge = freshChallengeSnap.data() || {};
    if (['completed', 'cancelled'].includes(freshChallenge.status)) throw new Error('Este desafio privado já foi finalizado ou cancelado.');
    const freshStake = Math.max(0, Number(freshChallenge.stakeAmount) || 0);
    if (freshStake !== stakeNum) throw new Error('A regra de aposta deste desafio mudou. Reabra o desafio e tente novamente.');

    let stakeTxId: string | null = null;
    let walletRef: any = null;
    let walletCurrent: ReturnType<typeof walletValues> | null = null;
    if (stakeNum > 0) {
      walletRef = db.collection('reward_coin_wallets').doc(userId);
      const walletSnap = await transaction.get(walletRef);
      const wallet = walletSnap.exists ? (walletSnap.data() as CoinWallet) : emptyWallet(userId);
      walletCurrent = walletValues(wallet);
      if (walletCurrent.balance < stakeNum) throw new Error('Saldo de Invictus Coins insuficiente para esta aposta.');
      stakeTxId = coinTransactionId(userId, `private_challenge_stake_${challengeId}`);
    }

    if (stakeNum > 0 && walletRef && walletCurrent) {
      const createdAt = now.toISOString();
      transaction.create(db.collection('reward_coin_transactions').doc(stakeTxId!), {
        id: stakeTxId,
        userId,
        amount: stakeNum,
        type: 'debit',
        origin: 'private_challenge_stake',
        ledgerType: 'PRIVATE_CHALLENGE_STAKE',
        description: `Aposta ao entrar no desafio privado "${freshChallenge.title}"`,
        idempotencyKey: `private_challenge_stake_${challengeId}`,
        balanceBefore: walletCurrent.balance,
        balanceAfter: walletCurrent.balance - stakeNum,
        createdAt,
      });
      transaction.set(walletRef, {
        userId,
        balance: walletCurrent.balance - stakeNum,
        lifetimeEarned: walletCurrent.lifetimeEarned,
        lifetimeSpent: walletCurrent.lifetimeSpent + stakeNum,
        updatedAt: createdAt,
      }, { merge: true });
    }

    transaction.update(challengeDoc.ref, {
      status: 'active',
      updatedAt: now.toISOString(),
      ...(stakeNum > 0 ? { potTotal: Math.max(0, Number(freshChallenge.potTotal) || 0) + stakeNum } : {}),
    });
    transaction.set(memberRef, {
      userId,
      userName: userData.displayName || 'Atleta',
      userPhoto: userData.photoURL || '',
      challengeId,
      points: 0,
      workoutsCount: 0,
      joinedAt: now.toISOString(),
      updatedAt: now.toISOString(),
      stakeAmount: stakeNum,
      stakeTxId,
    });
    transaction.set(db.collection('elite_feed').doc(), {
      userId,
      userName: userData.displayName || 'Atleta',
      userPhoto: userData.photoURL || '',
      text: `aceitou o desafio privado ${freshChallenge.title}! 💥`,
      type: 'join',
      timestamp: now.toISOString(),
    });
  });

  return res.status(200).json({ success: true, challengeId, stakeAmount: stakeNum });
}

async function processChallengeExpiration(challengeId: string) {
  const challengeRef = db.collection('private_challenges').doc(challengeId);
  const challengeSnap = await challengeRef.get();
  if (!challengeSnap.exists) return;
  const challenge = challengeSnap.data()!;
  if (['completed', 'cancelled'].includes(challenge.status)) return;

  const now = new Date();
  const isLegacyMoneyChallenge = typeof challenge.entryFee === 'number' && challenge.entryFee > 0;
  if (isLegacyMoneyChallenge) {
    console.warn(`[Private Challenges][LEGACY] Challenge ${challengeId} requires admin refund migration; user-facing expiration will not move money.`);
    return;
  }

  const stakeNum = Math.max(0, Number(challenge.stakeAmount) || 0);
  if (stakeNum > 0) {
    await processStakedChallengeExpiration(challengeId, challengeRef, challenge, now);
    return;
  }

  const membersSnap = await db.collection('private_challenge_members').where('challengeId', '==', challengeId).get();
  const members = membersSnap.docs.map(mDoc => mDoc.data());
  if (members.length < 2) {
    console.log(`[Private Challenges] Cancelling challenge ${challengeId} (below 2 participants, no money involved).`);
    await challengeRef.set({ status: 'cancelled', updatedAt: now.toISOString() }, { merge: true });
    return;
  }

  const sortedMembers = [...members].sort((a, b) => (Number(b.points) || 0) - (Number(a.points) || 0));
  if (sortedMembers.length === 0) {
    await challengeRef.set({ status: 'cancelled', updatedAt: now.toISOString() }, { merge: true });
    return;
  }
  const topScore = Math.max(0, Number(sortedMembers[0].points) || 0);
  const topMembers = sortedMembers.filter(member => Math.max(0, Number(member.points) || 0) === topScore);
  if (topScore <= 0 || topMembers.length !== 1) {
    const reason = topScore <= 0 ? 'NO_SCORING_DATA' : 'TOP_SCORE_TIE';
    console.warn(`[Private Challenges] Challenge ${challengeId} completed without deterministic winner (${reason}).`);
    await challengeRef.set({
      status: 'completed',
      winnerId: null,
      winnerName: null,
      winnerPhoto: null,
      resultStatus: 'NO_DETERMINISTIC_WINNER',
      resultReason: reason,
      updatedAt: now.toISOString(),
    }, { merge: true });
    return;
  }

  const winner = topMembers[0];
  console.log(`[Private Challenges] Completing challenge ${challengeId}. Champion: ${winner.userId}.`);
  await db.runTransaction(async (transaction: any) => {
    transaction.update(challengeRef, {
      status: 'completed',
      winnerId: winner.userId,
      winnerName: winner.userName || 'Atleta',
      winnerPhoto: winner.userPhoto || '',
      resultStatus: 'WINNER_CONFIRMED',
      resultReason: 'UNIQUE_POSITIVE_TOP_SCORE',
      updatedAt: now.toISOString(),
    });
    transaction.set(db.collection('elite_feed').doc(), {
      userId: winner.userId,
      userName: winner.userName || 'Atleta',
      userPhoto: winner.userPhoto || '',
      text: `venceu o desafio privado "${challenge.title}"! 🏆💥`,
      type: 'join',
      timestamp: now.toISOString(),
    });
  });
}

async function processStakedChallengeExpiration(
  challengeId: string,
  challengeRef: FirebaseFirestore.DocumentReference,
  challenge: FirebaseFirestore.DocumentData,
  now: Date,
) {
  const membersSnap = await db.collection('private_challenge_members').where('challengeId', '==', challengeId).get();
  const members = membersSnap.docs.map(mDoc => mDoc.data());
  const potTotal = Math.max(0, Number(challenge.potTotal) || 0);

  if (members.length < 2) {
    await db.runTransaction(async (transaction: any) => {
      const freshSnap = await transaction.get(challengeRef);
      const fresh = freshSnap.data();
      if (!fresh || ['completed', 'cancelled'].includes(fresh.status)) return;

      const refundable = members.filter(member => Math.max(0, Number(member.stakeAmount) || 0) > 0);
      const walletRefs = refundable.map(member => db.collection('reward_coin_wallets').doc(member.userId));
      const walletSnaps = await Promise.all(walletRefs.map(ref => transaction.get(ref)));

      refundable.forEach((member, index) => {
        const refundAmount = Math.max(0, Number(member.stakeAmount) || 0);
        const wallet = walletSnaps[index].exists ? (walletSnaps[index].data() as CoinWallet) : emptyWallet(member.userId);
        const current = walletValues(wallet);
        const refundTxId = coinTransactionId(member.userId, `private_challenge_refund_${challengeId}`);
        const createdAt = now.toISOString();
        transaction.create(db.collection('reward_coin_transactions').doc(refundTxId), {
          id: refundTxId,
          userId: member.userId,
          amount: refundAmount,
          type: 'credit',
          origin: 'private_challenge_refund',
          ledgerType: 'PRIVATE_CHALLENGE_REFUND',
          description: `Reembolso da aposta — desafio privado "${challenge.title}" cancelado (menos de 2 participantes)`,
          idempotencyKey: `private_challenge_refund_${challengeId}`,
          balanceBefore: current.balance,
          balanceAfter: current.balance + refundAmount,
          createdAt,
        });
        transaction.set(walletRefs[index], {
          userId: member.userId,
          balance: current.balance + refundAmount,
          lifetimeEarned: current.lifetimeEarned,
          lifetimeSpent: current.lifetimeSpent,
          updatedAt: createdAt,
        }, { merge: true });
      });

      transaction.set(challengeRef, {
        status: 'cancelled',
        resultStatus: 'CANCELLED_BELOW_MIN_PARTICIPANTS',
        resultReason: 'BELOW_MIN_PARTICIPANTS',
        updatedAt: now.toISOString(),
      }, { merge: true });
    });
    return;
  }

  const startDate = new Date(challenge.startDate);
  const endDate = new Date(challenge.endDate);
  const scored = await Promise.all(members.map(async member => ({
    member,
    score: Math.max(0, (await computePrivateChallengeIGAForWindow(member.userId, startDate, endDate)).average || 0),
  })));
  const topScore = scored.reduce((max, entry) => Math.max(max, entry.score), 0);
  const topEntries = scored.filter(entry => entry.score === topScore);

  if (topEntries.length === 1 && topScore > 0) {
    const winner = topEntries[0].member;
    await db.runTransaction(async (transaction: any) => {
      const freshSnap = await transaction.get(challengeRef);
      const fresh = freshSnap.data();
      if (!fresh || ['completed', 'cancelled'].includes(fresh.status)) return;

      let walletRef: any = null;
      let current: ReturnType<typeof walletValues> | null = null;
      if (potTotal > 0) {
        walletRef = db.collection('reward_coin_wallets').doc(winner.userId);
        const walletSnap = await transaction.get(walletRef);
        current = walletValues(walletSnap.exists ? (walletSnap.data() as CoinWallet) : emptyWallet(winner.userId));
      }
      if (potTotal > 0 && walletRef && current) {
        const payoutTxId = coinTransactionId(winner.userId, `private_challenge_payout_${challengeId}`);
        const createdAt = now.toISOString();
        transaction.create(db.collection('reward_coin_transactions').doc(payoutTxId), {
          id: payoutTxId,
          userId: winner.userId,
          amount: potTotal,
          type: 'credit',
          origin: 'private_challenge_payout',
          ledgerType: 'PRIVATE_CHALLENGE_PAYOUT',
          description: `Prêmio por vencer o desafio privado "${challenge.title}"`,
          idempotencyKey: `private_challenge_payout_${challengeId}`,
          balanceBefore: current.balance,
          balanceAfter: current.balance + potTotal,
          createdAt,
        });
        transaction.set(walletRef, {
          userId: winner.userId,
          balance: current.balance + potTotal,
          lifetimeEarned: current.lifetimeEarned + potTotal,
          lifetimeSpent: current.lifetimeSpent,
          updatedAt: createdAt,
        }, { merge: true });
      }
      transaction.set(challengeRef, {
        status: 'completed',
        winnerId: winner.userId,
        winnerName: winner.userName || 'Atleta',
        winnerPhoto: winner.userPhoto || '',
        resultStatus: 'WINNER_CONFIRMED',
        resultReason: 'UNIQUE_POSITIVE_TOP_SCORE',
        updatedAt: now.toISOString(),
      }, { merge: true });
      transaction.set(db.collection('elite_feed').doc(), {
        userId: winner.userId,
        userName: winner.userName || 'Atleta',
        userPhoto: winner.userPhoto || '',
        text: `venceu o desafio privado "${challenge.title}" e levou ${potTotal} Invictus Coins! 🏆💰`,
        type: 'join',
        timestamp: now.toISOString(),
      });
    });
    return;
  }

  if (!challenge.extendedOnce) {
    await db.runTransaction(async (transaction: any) => {
      const freshSnap = await transaction.get(challengeRef);
      const fresh = freshSnap.data();
      if (!fresh || ['completed', 'cancelled'].includes(fresh.status) || fresh.extendedOnce === true) return;
      const newEndDate = new Date(new Date(fresh.endDate).getTime() + 24 * 60 * 60 * 1000);
      transaction.set(challengeRef, {
        endDate: newEndDate.toISOString(),
        extendedOnce: true,
        resultStatus: 'TIE_EXTENDED',
        resultReason: topScore <= 0 ? 'NO_SCORING_DATA' : 'TOP_SCORE_TIE',
        updatedAt: now.toISOString(),
      }, { merge: true });
    });
    return;
  }

  const sortedTopEntries = [...topEntries].sort((a, b) => String(a.member.userId).localeCompare(String(b.member.userId)));
  const base = sortedTopEntries.length ? Math.floor(potTotal / sortedTopEntries.length) : 0;
  const remainder = sortedTopEntries.length ? potTotal - base * sortedTopEntries.length : 0;

  await db.runTransaction(async (transaction: any) => {
    const freshSnap = await transaction.get(challengeRef);
    const fresh = freshSnap.data();
    if (!fresh || ['completed', 'cancelled'].includes(fresh.status)) return;

    const payable = sortedTopEntries.map((entry, index) => ({ entry, share: base + (index < remainder ? 1 : 0) })).filter(item => item.share > 0);
    const walletRefs = payable.map(item => db.collection('reward_coin_wallets').doc(item.entry.member.userId));
    const walletSnaps = await Promise.all(walletRefs.map(ref => transaction.get(ref)));

    payable.forEach((item, index) => {
      const member = item.entry.member;
      const wallet = walletSnaps[index].exists ? (walletSnaps[index].data() as CoinWallet) : emptyWallet(member.userId);
      const current = walletValues(wallet);
      const splitTxId = coinTransactionId(member.userId, `private_challenge_refund_${challengeId}`);
      const createdAt = now.toISOString();
      transaction.create(db.collection('reward_coin_transactions').doc(splitTxId), {
        id: splitTxId,
        userId: member.userId,
        amount: item.share,
        type: 'credit',
        origin: 'private_challenge_refund',
        ledgerType: 'PRIVATE_CHALLENGE_REFUND',
        description: `Pote dividido — empate persistente no desafio privado "${challenge.title}"`,
        idempotencyKey: `private_challenge_refund_${challengeId}`,
        balanceBefore: current.balance,
        balanceAfter: current.balance + item.share,
        createdAt,
      });
      transaction.set(walletRefs[index], {
        userId: member.userId,
        balance: current.balance + item.share,
        lifetimeEarned: current.lifetimeEarned,
        lifetimeSpent: current.lifetimeSpent,
        updatedAt: createdAt,
      }, { merge: true });
    });

    transaction.set(challengeRef, {
      status: 'completed',
      winnerId: null,
      winnerName: null,
      winnerPhoto: null,
      resultStatus: 'SPLIT_ON_PERSISTENT_TIE',
      resultReason: topScore <= 0 ? 'NO_SCORING_DATA' : 'TOP_SCORE_TIE',
      updatedAt: now.toISOString(),
    }, { merge: true });
  });
}
