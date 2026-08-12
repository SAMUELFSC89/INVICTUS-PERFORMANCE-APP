import { VercelRequest, VercelResponse } from '@vercel/node';
import { db, cors, verifyAuth, FieldValue } from '../_lib/common.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;

  const auth = await verifyAuth(req);
  if (!auth) return res.status(401).json({ error: 'Não autorizado.' });

  const action = (req.query.action || req.body.action) as string;

  try {
    if (!db) {
      return res.status(500).json({ error: 'Banco de dados não disponível.' });
    }

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

/**
 * Lists challenges, updating any that have completed or expired.
 */
async function handleListChallenges(req: VercelRequest, res: VercelResponse, userId: string) {
  const challengesRef = db.collection('private_challenges');
  const now = new Date();
  const nowISO = now.toISOString();

  // Load all non-completed/non-cancelled challenges to check for expiration
  const activeAndFormingSnap = await challengesRef
    .where('status', 'in', ['forming', 'active'])
    .get();

  for (const challengeDoc of activeAndFormingSnap.docs) {
    const challenge = challengeDoc.data();
    if (challenge.endDate && challenge.endDate < nowISO) {
      // Challenge has expired! Process it
      await processChallengeExpiration(challengeDoc.id);
    }
  }

  // Now reload all private challenges for the response
  const allChallengesSnap = await challengesRef.orderBy('createdAt', 'desc').get();
  const challengesList: any[] = [];

  for (const challengeDoc of allChallengesSnap.docs) {
    const cData = challengeDoc.data();
    const challengeId = challengeDoc.id;

    // Load members of this challenge to build custom ranking
    const membersSnap = await db.collection('private_challenge_members')
      .where('challengeId', '==', challengeId)
      .get();

    const members = membersSnap.docs.map(mDoc => {
      const m = mDoc.data();
      return {
        userId: m.userId,
        userName: m.userName || 'Atleta',
        userPhoto: m.userPhoto || '',
        points: m.points || 0,
        workoutsCount: m.workoutsCount || 0,
        joinedAt: m.joinedAt
      };
    }).sort((a, b) => b.points - a.points); // Sort by highest score/points

    // Check if the current user is a member
    const isCurrentUserMember = members.some(m => m.userId === userId);

    challengesList.push({
      id: challengeId,
      title: cData.title,
      description: cData.description || '',
      creatorId: cData.creatorId,
      creatorName: cData.creatorName,
      creatorPhoto: cData.creatorPhoto,
      inviteCode: cData.inviteCode,
      durationDays: cData.durationDays,
      entryFee: cData.entryFee,
      status: cData.status,
      createdAt: cData.createdAt,
      startDate: cData.startDate,
      endDate: cData.endDate,
      totalPool: cData.totalPool,
      netPrizePool: cData.netPrizePool,
      platformFee: cData.platformFee,
      participantsCount: members.length,
      winnerId: cData.winnerId || null,
      winnerName: cData.winnerName || null,
      winnerPhoto: cData.winnerPhoto || null,
      isMember: isCurrentUserMember,
      members
    });
  }

  return res.status(200).json({ success: true, challenges: challengesList });
}

/**
 * Creates a new private challenge.
 */
async function handleCreateChallenge(req: VercelRequest, res: VercelResponse, userId: string) {
  const { title, durationDays, entryFee, description } = req.body;

  if (!title || !durationDays || entryFee === undefined) {
    return res.status(400).json({ error: 'Parâmetros título, duração e taxa de entrada são obrigatórios.' });
  }

  const durationNum = Number(durationDays);
  if (![7, 15, 30].includes(durationNum)) {
    return res.status(400).json({ error: 'Duração aceita apenas 7, 15 ou 30 dias.' });
  }

  const feeNum = Number(entryFee);
  if (feeNum < 30 || feeNum > 1000) {
    return res.status(400).json({ error: 'O valor do desafio deve ser entre R$ 30 e R$ 1.000.' });
  }

  // Get user profile for creator details and wallet deduction
  const userRef = db.collection('users').doc(userId);
  const userSnap = await userRef.get();
  if (!userSnap.exists) {
    return res.status(404).json({ error: 'Perfil do usuário não encontrado.' });
  }

  const userData = userSnap.data() || {};
  const currentBalance = userData.walletBalance !== undefined ? Number(userData.walletBalance) : 0;

  if (currentBalance < feeNum) {
    return res.status(400).json({
      error: `Saldo insuficiente para criar o desafio e pagar a taxa de R$ ${feeNum.toFixed(2)}. Saldo disponível: R$ ${currentBalance.toFixed(2)}.`
    });
  }

  // Generate unique 6-character Invite Code
  const inviteCode = Math.random().toString(36).substring(2, 8).toUpperCase();

  const now = new Date();
  const endDate = new Date(now.getTime() + durationNum * 24 * 60 * 60 * 1000);

  const challengeId = db.collection('private_challenges').doc().id;

  // Perform transactional creation & wallet balance deduction
  await db.runTransaction(async (transaction) => {
    // 1. Deduct Creator's entry fee
    transaction.update(userRef, {
      walletBalance: FieldValue.increment(-feeNum)
    });

    // 2. Record transaction log if entryFee was positive
    if (feeNum > 0) {
      const txRef = db.collection('walletTransactions').doc();
      transaction.set(txRef, {
        id: txRef.id,
        userId,
        type: 'challenge_entry',
        amount: feeNum,
        previousBalance: currentBalance,
        newBalance: currentBalance - feeNum,
        createdAt: now.toISOString(),
        status: 'approved',
        description: `Taxa de entrada: ${title}`
      });
    }

    // 3. Create Challenge
    const totalPool = feeNum;
    const netPrizePool = totalPool * 0.70;
    const platformFee = totalPool * 0.30;
    
    // Status is 'forming' initially. Once netPrizePool >= 100, we mark status as 'active'!
    const isMinPrizeMet = netPrizePool >= 100;
    const status = isMinPrizeMet ? 'active' : 'forming';

    const challengeRef = db.collection('private_challenges').doc(challengeId);
    transaction.set(challengeRef, {
      title,
      description: description || '',
      creatorId: userId,
      creatorName: userData.displayName || 'Atleta',
      creatorPhoto: userData.photoURL || '',
      inviteCode,
      durationDays: durationNum,
      entryFee: feeNum,
      status, 
      createdAt: now.toISOString(),
      startDate: now.toISOString(),
      endDate: endDate.toISOString(),
      totalPool,
      netPrizePool,
      platformFee,
      updatedAt: now.toISOString()
    });

    // 4. Enroll Creator as the first member
    const memberRef = db.collection('private_challenge_members').doc(`${userId}_${challengeId}`);
    transaction.set(memberRef, {
      userId,
      userName: userData.displayName || 'Atleta',
      userPhoto: userData.photoURL || '',
      challengeId,
      points: 0,
      workoutsCount: 0,
      joinedAt: now.toISOString(),
      updatedAt: now.toISOString()
    });
  });

  return res.status(200).json({ success: true, challengeId, inviteCode });
}

/**
 * Enrolls a user in a private challenge using an invitation code.
 */
async function handleJoinChallenge(req: VercelRequest, res: VercelResponse, userId: string) {
  const { inviteCode } = req.body;

  if (!inviteCode) {
    return res.status(400).json({ error: 'Código de convite é obrigatório.' });
  }

  // Find the challenge by invite code
  const uppercaseCode = inviteCode.trim().toUpperCase();
  const challengeQuerySnap = await db.collection('private_challenges')
    .where('inviteCode', '==', uppercaseCode)
    .limit(1)
    .get();

  if (challengeQuerySnap.empty) {
    return res.status(404).json({ error: 'Desafio não encontrado com este código de convite.' });
  }

  const challengeDoc = challengeQuerySnap.docs[0];
  const challengeId = challengeDoc.id;
  const cData = challengeDoc.data();

  if (['completed', 'cancelled'].includes(cData.status)) {
    return res.status(400).json({ error: 'Este desafio privado já foi finalizado ou cancelado.' });
  }

  // Check if they are already enrolled
  const memberRef = db.collection('private_challenge_members').doc(`${userId}_${challengeId}`);
  const memberSnap = await memberRef.get();
  if (memberSnap.exists) {
    return res.status(400).json({ error: 'Você já faz parte deste desafio privado!' });
  }

  // Get user profile details for fee payment
  const userRef = db.collection('users').doc(userId);
  const userSnap = await userRef.get();
  if (!userSnap.exists) {
    return res.status(404).json({ error: 'Perfil do usuário não encontrado.' });
  }

  const userData = userSnap.data() || {};
  const currentBalance = userData.walletBalance !== undefined ? Number(userData.walletBalance) : 0;
  const entryFee = Number(cData.entryFee);

  if (currentBalance < entryFee) {
    return res.status(400).json({
      error: `Saldo insuficiente para pagar a taxa de entrada de R$ ${entryFee.toFixed(2)}. Saldo disponível: R$ ${currentBalance.toFixed(2)}.`
    });
  }

  const now = new Date();

  // Join in a secure transaction
  await db.runTransaction(async (transaction) => {
    // 1. Deduct athlete balance
    transaction.update(userRef, {
      walletBalance: FieldValue.increment(-entryFee)
    });

    // 2. Add transaction history if entryFee was positive
    if (entryFee > 0) {
      const txRef = db.collection('walletTransactions').doc();
      transaction.set(txRef, {
        id: txRef.id,
        userId,
        type: 'challenge_entry',
        amount: entryFee,
        previousBalance: currentBalance,
        newBalance: currentBalance - entryFee,
        createdAt: now.toISOString(),
        status: 'approved',
        description: `Taxa de entrada: ${cData.title}`
      });
    }

    // 3. Update Challenge stats details
    const newTotalPool = (cData.totalPool || 0) + entryFee;
    const newNetPrizePool = newTotalPool * 0.70;
    const newPlatformFee = newTotalPool * 0.30;
    
    // Status is 'active' as soon as at least 2 participants are joined
    const newStatus = 'active';

    transaction.update(challengeDoc.ref, {
      totalPool: newTotalPool,
      netPrizePool: newNetPrizePool,
      platformFee: newPlatformFee,
      status: newStatus,
      updatedAt: now.toISOString()
    });

    // 4. Register new member
    transaction.set(memberRef, {
      userId,
      userName: userData.displayName || 'Atleta',
      userPhoto: userData.photoURL || '',
      challengeId,
      points: 0,
      workoutsCount: 0,
      joinedAt: now.toISOString(),
      updatedAt: now.toISOString()
    });

    // 5. Place entry on public elite feed to stimulate friendly banter
    const feedRef = db.collection('elite_feed').doc();
    transaction.set(feedRef, {
      userId,
      userName: userData.displayName || 'Atleta',
      userPhoto: userData.photoURL || '',
      text: `aceitou o desafio privado ${cData.title}! 💥`,
      type: 'join',
      timestamp: now.toISOString()
    });
  });

  return res.status(200).json({ success: true, challengeId });
}

/**
 * Handles expiration and completion/cancellation of a challenge.
 */
async function processChallengeExpiration(challengeId: string) {
  const challengeRef = db.collection('private_challenges').doc(challengeId);
  const challengeSnap = await challengeRef.get();
  if (!challengeSnap.exists) return;

  const challenge = challengeSnap.data()!;
  if (['completed', 'cancelled'].includes(challenge.status)) return;

  const now = new Date();

  // Load all challenge members
  const membersSnap = await db.collection('private_challenge_members')
    .where('challengeId', '==', challengeId)
    .get();

  const members = membersSnap.docs.map(mDoc => mDoc.data());

  // Determine if minimum participants requirement was met (Minimum: 2 participants)
  const entryFee = challenge.entryFee || 0;
  const netPrizePool = challenge.netPrizePool || 0;
  const isMinParticipantsMet = members.length >= 2;

  if (!isMinParticipantsMet) {
    // ---- CANCEL AND REFUND EVERYONE ----
    console.log(`[Private Challenges] Cancelling challenge ${challengeId} because participants count ${members.length} is below 2.`);
    
    await db.runTransaction(async (transaction) => {
      // 1. All reads first
      const userSnapsMap = new Map<string, any>();
      for (const member of members) {
        const uRef = db.collection('users').doc(member.userId);
        const uSnap = await transaction.get(uRef);
        if (uSnap.exists) {
          userSnapsMap.set(member.userId, uSnap.data());
        }
      }

      // 2. All writes after
      transaction.update(challengeRef, {
        status: 'cancelled',
        updatedAt: now.toISOString()
      });

      for (const member of members) {
        const uId = member.userId;
        const uData = userSnapsMap.get(uId);
        
        if (uData) {
          const uRef = db.collection('users').doc(uId);
          const oldBalance = uData.walletBalance !== undefined ? Number(uData.walletBalance) : 0;
          
          transaction.update(uRef, {
            walletBalance: FieldValue.increment(entryFee)
          });

          // Write refund log
          if (entryFee > 0) {
            const txRef = db.collection('walletTransactions').doc();
            transaction.set(txRef, {
              id: txRef.id,
              userId: uId,
              type: 'challenge_refund',
              amount: entryFee,
              previousBalance: oldBalance,
              newBalance: oldBalance + entryFee,
              createdAt: now.toISOString(),
              status: 'approved',
              description: `Estorno (Cancelamento): ${challenge.title}`
            });
          }
        }
      }
    });

  } else {
    // ---- COMPLETE AND AWARD TOP 1 ----
    console.log(`[Private Challenges] Completing challenge ${challengeId}. Distributing R$ ${netPrizePool} to TOP 1.`);

    // Sort members to find the absolute CHAMPION (highest points)
    const sortedMembers = [...members].sort((a, b) => (b.points || 0) - (a.points || 0));
    
    if (sortedMembers.length === 0) {
      // No participants? Cancel it
      await challengeRef.set({ status: 'cancelled', updatedAt: now.toISOString() }, { merge: true });
      return;
    }

    const winner = sortedMembers[0];
    const winnerId = winner.userId;

    await db.runTransaction(async (transaction) => {
      // 1. All reads first
      const winnerUserRef = db.collection('users').doc(winnerId);
      const winnerUserSnap = await transaction.get(winnerUserRef);

      // 2. All writes after
      transaction.update(challengeRef, {
        status: 'completed',
        winnerId: winnerId,
        winnerName: winner.userName || 'Atleta',
        winnerPhoto: winner.userPhoto || '',
        updatedAt: now.toISOString()
      });

      if (winnerUserSnap.exists) {
        const wData = winnerUserSnap.data()!;
        const oldBalance = wData.walletBalance !== undefined ? Number(wData.walletBalance) : 0;

        transaction.update(winnerUserRef, {
          walletBalance: FieldValue.increment(netPrizePool)
        });

        // Write winner prize transaction log
        const txRef = db.collection('walletTransactions').doc();
        transaction.set(txRef, {
          id: txRef.id,
          userId: winnerId,
          type: 'challenge_prize',
          amount: netPrizePool,
          previousBalance: oldBalance,
          newBalance: oldBalance + netPrizePool,
          createdAt: now.toISOString(),
          status: 'approved',
          description: `Premiação 1º Lugar: ${challenge.title}`
        });
      }

      // 3. Make post in the general social feed to announce the victory
      const feedRef = db.collection('elite_feed').doc();
      transaction.set(feedRef, {
        userId: winnerId,
        userName: winner.userName || 'Atleta',
        userPhoto: winner.userPhoto || '',
        text: `venceu o desafio privado "${challenge.title}" e faturou R$ ${netPrizePool.toFixed(2)}!! 🏆💥`,
        type: 'join', // triggers celebratory styling
        timestamp: now.toISOString()
      });
    });
  }
}
