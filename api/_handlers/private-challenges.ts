import { VercelRequest, VercelResponse } from '@vercel/node';
import { db, cors, verifyAuth } from '../_lib/common.js';
import { isProUser } from '../_lib/entitlement.js';

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
 *
 * FIX DE PRIVACIDADE (achado da auditoria): antes, esta função devolvia TODOS
 * os desafios privados de TODOS os usuários — incluindo o inviteCode — para
 * qualquer chamador autenticado. Agora só retorna desafios em que o usuário
 * é o criador ou já é membro.
 */
async function handleListChallenges(_req: VercelRequest, res: VercelResponse, userId: string) {
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

  // Now reload all private challenges to filter down to the ones this user can see
  const allChallengesSnap = await challengesRef.orderBy('createdAt', 'desc').get();
  const challengesList: any[] = [];

  for (const challengeDoc of allChallengesSnap.docs) {
    const cData = challengeDoc.data();
    const challengeId = challengeDoc.id;

    // Visibilidade: só o criador ou quem já é membro pode ver o desafio.
    // (checagem rápida antes de carregar membros, para não vazar nada)
    const isCreator = cData.creatorId === userId;

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

    const isCurrentUserMember = members.some(m => m.userId === userId);

    // Só inclui na resposta se o usuário puder ver este desafio.
    if (!isCreator && !isCurrentUserMember) {
      continue;
    }

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
      isMember: isCurrentUserMember,
      members,
      // Campos legados (só existem em desafios criados antes da migração
      // que removeu dinheiro do recurso; ver tarefa #125). Mantidos apenas
      // para exibir o histórico real de quem participou desses desafios —
      // não são usados por nenhum desafio novo.
      isLegacyMoneyChallenge: typeof cData.entryFee === 'number' && cData.entryFee > 0,
      entryFee: cData.entryFee,
      netPrizePool: cData.netPrizePool
    });
  }

  return res.status(200).json({ success: true, challenges: challengesList });
}

/**
 * Creates a new private challenge.
 *
 * Desafios privados agora são um BENEFÍCIO DO PLANO PRO, sem nenhum valor em
 * dinheiro envolvido: sem taxa de entrada, sem pool, sem prêmio em R$. Apenas
 * reconhecimento (badge/destaque) para quem terminar em 1º lugar.
 */
async function handleCreateChallenge(req: VercelRequest, res: VercelResponse, userId: string) {
  const { title, durationDays, description } = req.body;

  if (!title || !durationDays) {
    return res.status(400).json({ error: 'Parâmetros título e duração são obrigatórios.' });
  }

  const durationNum = Number(durationDays);
  if (![7, 15, 30].includes(durationNum)) {
    return res.status(400).json({ error: 'Duração aceita apenas 7, 15 ou 30 dias.' });
  }

  // Get user profile for creator details + checagem de plano PRO
  const userRef = db.collection('users').doc(userId);
  const userSnap = await userRef.get();
  if (!userSnap.exists) {
    return res.status(404).json({ error: 'Perfil do usuário não encontrado.' });
  }

  const userData = userSnap.data() || {};

  if (!isProUser(userData)) {
    return res.status(403).json({
      error: 'Desafios privados são exclusivos para assinantes PRO. Assine o Invictus PRO para criar um desafio.'
    });
  }

  // Generate unique 6-character Invite Code
  const inviteCode = Math.random().toString(36).substring(2, 8).toUpperCase();

  const now = new Date();
  const endDate = new Date(now.getTime() + durationNum * 24 * 60 * 60 * 1000);

  const challengeId = db.collection('private_challenges').doc().id;

  await db.runTransaction(async (transaction) => {
    const challengeRef = db.collection('private_challenges').doc(challengeId);
    transaction.set(challengeRef, {
      title,
      description: description || '',
      creatorId: userId,
      creatorName: userData.displayName || 'Atleta',
      creatorPhoto: userData.photoURL || '',
      inviteCode,
      durationDays: durationNum,
      status: 'forming', // vira 'active' assim que o 2º participante entrar
      createdAt: now.toISOString(),
      startDate: now.toISOString(),
      endDate: endDate.toISOString(),
      updatedAt: now.toISOString()
    });

    // Enroll Creator as the first member
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

  // Defesa extra: se por algum motivo este ainda for um desafio legado com
  // dinheiro (antes da migração da tarefa #125), bloqueia a entrada em vez
  // de cobrar taxa — o modelo com dinheiro foi descontinuado.
  if (typeof cData.entryFee === 'number' && cData.entryFee > 0) {
    return res.status(400).json({
      error: 'Este desafio usa o modelo antigo (com taxa em dinheiro) e está sendo encerrado. Peça ao criador para abrir um novo desafio PRO, sem custo.'
    });
  }

  // Check if they are already enrolled
  const memberRef = db.collection('private_challenge_members').doc(`${userId}_${challengeId}`);
  const memberSnap = await memberRef.get();
  if (memberSnap.exists) {
    return res.status(400).json({ error: 'Você já faz parte deste desafio privado!' });
  }

  // Get user profile details + checagem de plano PRO
  const userRef = db.collection('users').doc(userId);
  const userSnap = await userRef.get();
  if (!userSnap.exists) {
    return res.status(404).json({ error: 'Perfil do usuário não encontrado.' });
  }

  const userData = userSnap.data() || {};

  if (!isProUser(userData)) {
    return res.status(403).json({
      error: 'Desafios privados são exclusivos para assinantes PRO. Assine o Invictus PRO para participar.'
    });
  }

  const now = new Date();

  await db.runTransaction(async (transaction) => {
    // Status é 'active' assim que houver pelo menos 2 participantes
    transaction.update(challengeDoc.ref, {
      status: 'active',
      updatedAt: now.toISOString()
    });

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

    // Entrada no feed público, sem qualquer menção a dinheiro
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
 *
 * Desafios criados a partir da migração da tarefa #125 nunca têm entryFee,
 * então sempre caem no ramo "sem dinheiro" abaixo. O ramo legado é mantido
 * apenas como rede de segurança para qualquer documento antigo que ainda não
 * tenha passado pela migração de estorno (não apagamos nem alteramos essa
 * lógica financeira até a migração confirmar que não há mais consumidores —
 * regra #5 do usuário).
 */
async function processChallengeExpiration(challengeId: string) {
  const challengeRef = db.collection('private_challenges').doc(challengeId);
  const challengeSnap = await challengeRef.get();
  if (!challengeSnap.exists) return;

  const challenge = challengeSnap.data()!;
  if (['completed', 'cancelled'].includes(challenge.status)) return;

  const now = new Date();
  const isLegacyMoneyChallenge = typeof challenge.entryFee === 'number' && challenge.entryFee > 0;

  const membersSnap = await db.collection('private_challenge_members')
    .where('challengeId', '==', challengeId)
    .get();

  const members = membersSnap.docs.map(mDoc => mDoc.data());
  const isMinParticipantsMet = members.length >= 2;

  if (isLegacyMoneyChallenge) {
    // ---- RAMO LEGADO: preserva o comportamento financeiro original ----
    // (FieldValue precisa ser importado localmente aqui pois o restante do
    // arquivo não usa mais operações monetárias)
    const { FieldValue } = await import('../_lib/common.js');
    const entryFee = challenge.entryFee || 0;
    const netPrizePool = challenge.netPrizePool || 0;

    if (!isMinParticipantsMet) {
      console.log(`[Private Challenges][LEGACY] Cancelling challenge ${challengeId} (below 2 participants).`);
      await db.runTransaction(async (transaction) => {
        const userSnapsMap = new Map<string, any>();
        for (const member of members) {
          const uRef = db.collection('users').doc(member.userId);
          const uSnap = await transaction.get(uRef);
          if (uSnap.exists) userSnapsMap.set(member.userId, uSnap.data());
        }

        transaction.update(challengeRef, { status: 'cancelled', updatedAt: now.toISOString() });

        for (const member of members) {
          const uData = userSnapsMap.get(member.userId);
          if (!uData) continue;
          const uRef = db.collection('users').doc(member.userId);
          const oldBalance = uData.walletBalance !== undefined ? Number(uData.walletBalance) : 0;
          transaction.update(uRef, { walletBalance: FieldValue.increment(entryFee) });
          if (entryFee > 0) {
            const txRef = db.collection('walletTransactions').doc();
            transaction.set(txRef, {
              id: txRef.id,
              userId: member.userId,
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
      });
    } else {
      const sortedMembers = [...members].sort((a, b) => (b.points || 0) - (a.points || 0));
      if (sortedMembers.length === 0) {
        await challengeRef.set({ status: 'cancelled', updatedAt: now.toISOString() }, { merge: true });
        return;
      }
      const winner = sortedMembers[0];
      console.log(`[Private Challenges][LEGACY] Completing challenge ${challengeId}. Distributing R$ ${netPrizePool} to TOP 1.`);
      await db.runTransaction(async (transaction) => {
        const winnerUserRef = db.collection('users').doc(winner.userId);
        const winnerUserSnap = await transaction.get(winnerUserRef);

        transaction.update(challengeRef, {
          status: 'completed',
          winnerId: winner.userId,
          winnerName: winner.userName || 'Atleta',
          winnerPhoto: winner.userPhoto || '',
          updatedAt: now.toISOString()
        });

        if (winnerUserSnap.exists) {
          const wData = winnerUserSnap.data()!;
          const oldBalance = wData.walletBalance !== undefined ? Number(wData.walletBalance) : 0;
          transaction.update(winnerUserRef, { walletBalance: FieldValue.increment(netPrizePool) });
          const txRef = db.collection('walletTransactions').doc();
          transaction.set(txRef, {
            id: txRef.id,
            userId: winner.userId,
            type: 'challenge_prize',
            amount: netPrizePool,
            previousBalance: oldBalance,
            newBalance: oldBalance + netPrizePool,
            createdAt: now.toISOString(),
            status: 'approved',
            description: `Premiação 1º Lugar: ${challenge.title}`
          });
        }

        const feedRef = db.collection('elite_feed').doc();
        transaction.set(feedRef, {
          userId: winner.userId,
          userName: winner.userName || 'Atleta',
          userPhoto: winner.userPhoto || '',
          text: `venceu o desafio privado "${challenge.title}" e faturou R$ ${netPrizePool.toFixed(2)}!! 🏆💥`,
          type: 'join',
          timestamp: now.toISOString()
        });
      });
    }
    return;
  }

  // ---- RAMO NOVO: sem dinheiro, só reconhecimento ----
  if (!isMinParticipantsMet) {
    console.log(`[Private Challenges] Cancelling challenge ${challengeId} (below 2 participants, no money involved).`);
    await challengeRef.set({ status: 'cancelled', updatedAt: now.toISOString() }, { merge: true });
    return;
  }

  const sortedMembers = [...members].sort((a, b) => (b.points || 0) - (a.points || 0));
  if (sortedMembers.length === 0) {
    await challengeRef.set({ status: 'cancelled', updatedAt: now.toISOString() }, { merge: true });
    return;
  }

  const winner = sortedMembers[0];
  console.log(`[Private Challenges] Completing challenge ${challengeId}. Champion: ${winner.userId}.`);

  await db.runTransaction(async (transaction) => {
    transaction.update(challengeRef, {
      status: 'completed',
      winnerId: winner.userId,
      winnerName: winner.userName || 'Atleta',
      winnerPhoto: winner.userPhoto || '',
      updatedAt: now.toISOString()
    });

    const feedRef = db.collection('elite_feed').doc();
    transaction.set(feedRef, {
      userId: winner.userId,
      userName: winner.userName || 'Atleta',
      userPhoto: winner.userPhoto || '',
      text: `venceu o desafio privado "${challenge.title}"! 🏆💥`,
      type: 'join',
      timestamp: now.toISOString()
    });
  });
}
