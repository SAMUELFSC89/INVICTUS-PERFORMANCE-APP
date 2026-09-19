import { VercelRequest, VercelResponse } from '@vercel/node';
import { db, cors, verifyAuth } from '../_lib/common.js';
import { isProUser } from '../_lib/entitlement.js';
import { isActiveAccountState } from '../_lib/account-state.js';
import { coinTransactionId } from '../_lib/reward-coin-engine.js';
import { computeUserScoreForWindow } from '../_lib/igaService.js';
import { RewardCoinTransaction, RewardCoinWallet } from '../../src/types.js';

/**
 * Aposta em Invictus Coins nos desafios privados (moeda virtual do app, sem
 * valor em dinheiro -- não confundir com o `entryFee` legado em R$, que
 * continua permanentemente aposentado; ver private-challenge-money-retired
 * no arquivo de testes). Teto de sanidade por participante.
 */
const MAX_STAKE_AMOUNT = 2000;

function emptyWallet(userId: string): RewardCoinWallet {
  return { userId, balance: 0, lifetimeEarned: 0, lifetimeSpent: 0, updatedAt: new Date().toISOString() };
}

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

  // Load all non-completed/non-cancelled challenges to check for expiration.
  // IMPORTANT: a rota normal nunca liquida dinheiro legado. Desafios antigos
  // com entryFee ficam reservados para a migração administrativa dedicada,
  // que é auditável, protegida e idempotente.
  const activeAndFormingSnap = await challengesRef
    .where('status', 'in', ['forming', 'active'])
    .get();

  for (const challengeDoc of activeAndFormingSnap.docs) {
    const challenge = challengeDoc.data();
    if (challenge.endDate && challenge.endDate < nowISO) {
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
        joinedAt: m.joinedAt,
        stakePaid: Math.max(0, Number(m.stakeAmount) || 0)
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
      resultStatus: cData.resultStatus || null,
      resultReason: cData.resultReason || null,
      // Aposta em Invictus Coins (moeda virtual do app). 0/ausente = desafio
      // livre/simbólico, comportamento idêntico ao de sempre.
      stakeAmount: Math.max(0, Number(cData.stakeAmount) || 0),
      potTotal: Math.max(0, Number(cData.potTotal) || 0),
      extendedOnce: cData.extendedOnce === true,
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
  const { title, durationDays, description, stakeAmount } = req.body;

  if (!title || !durationDays) {
    return res.status(400).json({ error: 'Parâmetros título e duração são obrigatórios.' });
  }

  const durationNum = Number(durationDays);
  if (![7, 15, 30].includes(durationNum)) {
    return res.status(400).json({ error: 'Duração aceita apenas 7, 15 ou 30 dias.' });
  }

  // Aposta em Invictus Coins (moeda virtual do app): opcional, 0 por padrão.
  // Continua sendo um desafio livre/simbólico se nada for informado.
  const stakeNum = stakeAmount === undefined || stakeAmount === null || stakeAmount === '' ? 0 : Number(stakeAmount);
  if (!Number.isFinite(stakeNum) || !Number.isInteger(stakeNum) || stakeNum < 0 || stakeNum > MAX_STAKE_AMOUNT) {
    return res.status(400).json({ error: `A aposta deve ser um número inteiro de Invictus Coins entre 0 e ${MAX_STAKE_AMOUNT}.` });
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

  if (stakeNum > 0 && !isActiveAccountState(userData)) {
    return res.status(403).json({ error: 'Conta inativa não pode apostar Invictus Coins.' });
  }

  await db.runTransaction(async (transaction) => {
    const challengeRef = db.collection('private_challenges').doc(challengeId);
    const memberRef = db.collection('private_challenge_members').doc(`${userId}_${challengeId}`);

    let stakeTxId: string | null = null;
    if (stakeNum > 0) {
      // Escrow da aposta do criador: debita agora, dentro da MESMA transação
      // que cria o desafio -- ou os dois acontecem juntos, ou nenhum acontece.
      const walletRef = db.collection('reward_coin_wallets').doc(userId);
      const walletSnap = await transaction.get(walletRef);
      const wallet = walletSnap.exists ? (walletSnap.data() as RewardCoinWallet) : emptyWallet(userId);
      const balance = Math.max(0, Number(wallet.balance) || 0);
      if (balance < stakeNum) {
        throw new Error('Saldo de Invictus Coins insuficiente para esta aposta.');
      }
      stakeTxId = coinTransactionId(userId, `private_challenge_stake_${challengeId}`);
      const txRef = db.collection('reward_coin_transactions').doc(stakeTxId);
      const createdAt = now.toISOString();
      const coinTransaction: RewardCoinTransaction = {
        id: stakeTxId,
        userId,
        amount: stakeNum,
        type: 'debit',
        origin: 'private_challenge_stake',
        ledgerType: 'PRIVATE_CHALLENGE_STAKE',
        description: `Aposta ao criar o desafio privado "${title}"`,
        idempotencyKey: `private_challenge_stake_${challengeId}`,
        balanceBefore: balance,
        balanceAfter: balance - stakeNum,
        createdAt,
      };
      transaction.create(txRef, coinTransaction);
      transaction.set(walletRef, {
        userId,
        balance: balance - stakeNum,
        lifetimeEarned: Math.max(0, Number(wallet.lifetimeEarned) || 0),
        lifetimeSpent: Math.max(0, Number(wallet.lifetimeSpent) || 0) + stakeNum,
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
      status: 'forming', // vira 'active' assim que o 2º participante entrar
      createdAt: now.toISOString(),
      startDate: now.toISOString(),
      endDate: endDate.toISOString(),
      updatedAt: now.toISOString(),
      stakeAmount: stakeNum,
      potTotal: stakeNum,
      extendedOnce: false
    });

    // Enroll Creator as the first member
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
      stakeTxId
    });
  });

  return res.status(200).json({ success: true, challengeId, inviteCode, stakeAmount: stakeNum });
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

  const stakeNum = Math.max(0, Number(cData.stakeAmount) || 0);
  if (stakeNum > 0 && !isActiveAccountState(userData)) {
    return res.status(403).json({ error: 'Conta inativa não pode apostar Invictus Coins.' });
  }

  const now = new Date();

  await db.runTransaction(async (transaction) => {
    let stakeTxId: string | null = null;
    if (stakeNum > 0) {
      // Escrow da aposta de quem entra: debita agora, na MESMA transação que
      // registra a entrada no desafio -- ou os dois acontecem juntos, ou
      // nenhum acontece.
      const walletRef = db.collection('reward_coin_wallets').doc(userId);
      const walletSnap = await transaction.get(walletRef);
      const wallet = walletSnap.exists ? (walletSnap.data() as RewardCoinWallet) : emptyWallet(userId);
      const balance = Math.max(0, Number(wallet.balance) || 0);
      if (balance < stakeNum) {
        throw new Error('Saldo de Invictus Coins insuficiente para esta aposta.');
      }
      stakeTxId = coinTransactionId(userId, `private_challenge_stake_${challengeId}`);
      const txRef = db.collection('reward_coin_transactions').doc(stakeTxId);
      const createdAt = now.toISOString();
      const coinTransaction: RewardCoinTransaction = {
        id: stakeTxId,
        userId,
        amount: stakeNum,
        type: 'debit',
        origin: 'private_challenge_stake',
        ledgerType: 'PRIVATE_CHALLENGE_STAKE',
        description: `Aposta ao entrar no desafio privado "${cData.title}"`,
        idempotencyKey: `private_challenge_stake_${challengeId}`,
        balanceBefore: balance,
        balanceAfter: balance - stakeNum,
        createdAt,
      };
      transaction.create(txRef, coinTransaction);
      transaction.set(walletRef, {
        userId,
        balance: balance - stakeNum,
        lifetimeEarned: Math.max(0, Number(wallet.lifetimeEarned) || 0),
        lifetimeSpent: Math.max(0, Number(wallet.lifetimeSpent) || 0) + stakeNum,
        updatedAt: createdAt,
      }, { merge: true });
    }

    // Status é 'active' assim que houver pelo menos 2 participantes
    transaction.update(challengeDoc.ref, {
      status: 'active',
      updatedAt: now.toISOString(),
      ...(stakeNum > 0 ? { potTotal: Math.max(0, Number(cData.potTotal) || 0) + stakeNum } : {})
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
      stakeTxId
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

  return res.status(200).json({ success: true, challengeId, stakeAmount: stakeNum });
}

/**
 * Handles expiration and completion/cancellation of a challenge.
 *
 * Desafios privados atuais nunca envolvem dinheiro. Qualquer documento legado
 * com entryFee > 0 é deliberadamente ignorado aqui e só pode ser encerrado pela
 * migração administrativa `migrate-legacy-private-challenges`, que existe para
 * devolver o valor original aos participantes com trilha de auditoria.
 *
 * Isso é intencional: abrir/listar desafios é uma ação comum do usuário e nunca
 * pode funcionar como gatilho de settlement financeiro legado.
 */
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

  // ---- RAMO COM APOSTA EM COINS: precisa de um vencedor determinístico para
  // saber a quem pagar o pote, então NUNCA reusa o "sem vencedor simbólico"
  // do ramo livre abaixo (lá é aceitável não coroar ninguém; aqui não, tem
  // Coins reais dos participantes em jogo). Ver processStakedChallengeExpiration.
  const stakeNum = Math.max(0, Number(challenge.stakeAmount) || 0);
  if (stakeNum > 0) {
    await processStakedChallengeExpiration(challengeId, challengeRef, challenge, now);
    return;
  }

  const membersSnap = await db.collection('private_challenge_members')
    .where('challengeId', '==', challengeId)
    .get();

  const members = membersSnap.docs.map(mDoc => mDoc.data());
  const isMinParticipantsMet = members.length >= 2;

  // ---- RAMO ATUAL: sem dinheiro, só reconhecimento ----
  if (!isMinParticipantsMet) {
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

  // Não existe hoje writer vivo para `private_challenge_members.points`.
  // Até uma regra oficial de pontuação/desempate ser implementada, nunca
  // inventamos campeão por ordem de leitura do Firestore. Score zero ou
  // empate no topo encerram o período sem vencedor simbólico.
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

  await db.runTransaction(async (transaction) => {
    transaction.update(challengeRef, {
      status: 'completed',
      winnerId: winner.userId,
      winnerName: winner.userName || 'Atleta',
      winnerPhoto: winner.userPhoto || '',
      resultStatus: 'WINNER_CONFIRMED',
      resultReason: 'UNIQUE_POSITIVE_TOP_SCORE',
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

/**
 * Encerramento de um desafio privado COM aposta em Invictus Coins.
 *
 * Regras (definidas com o dono do produto):
 * - mesmo critério de pontuação IGA de todo o resto do app (ver
 *   `computeUserScoreForWindow`), aplicado à janela [startDate, endDate]
 *   do próprio desafio -- não ao placar simbólico incremental de
 *   `private_challenge_members.points` (que não tem writer vivo hoje);
 * - vencedor único com placar positivo leva o pote inteiro (todas as
 *   apostas somadas);
 * - empate no topo (incluindo "todo mundo zerado") estende o desafio em
 *   1 dia, UMA ÚNICA VEZ, pra dar chance de alguém decidir. Se persistir
 *   depois da extensão, o pote é dividido em partes iguais entre quem
 *   empatou no topo (nunca fica Coins de participante preso no limbo);
 * - menos de 2 participantes ao expirar: cancela e devolve a aposta de
 *   quem entrou (normalmente só o criador).
 *
 * Toda movimentação de Coins usa `transaction.create()` num ID determinístico
 * por (challengeId[, userId]) -- se por algum motivo esta função rodar em
 * paralelo pra o mesmo desafio (ex: duas pessoas abrindo a lista de desafios
 * ao mesmo tempo), a segunda tentativa falha ao tentar criar o mesmo
 * documento de transação em vez de pagar/reembolsar em dobro.
 */
async function processStakedChallengeExpiration(
  challengeId: string,
  challengeRef: FirebaseFirestore.DocumentReference,
  challenge: FirebaseFirestore.DocumentData,
  now: Date,
) {
  const membersSnap = await db.collection('private_challenge_members')
    .where('challengeId', '==', challengeId)
    .get();
  const members = membersSnap.docs.map(mDoc => mDoc.data());
  const potTotal = Math.max(0, Number(challenge.potTotal) || 0);

  if (members.length < 2) {
    console.log(`[Private Challenges][Stake] Cancelling staked challenge ${challengeId} (below 2 participants) and refunding stakes.`);
    await db.runTransaction(async (transaction) => {
      const freshSnap = await transaction.get(challengeRef);
      const fresh = freshSnap.data();
      if (!fresh || ['completed', 'cancelled'].includes(fresh.status)) return; // já processado
      for (const member of members) {
        const refundAmount = Math.max(0, Number(member.stakeAmount) || 0);
        if (refundAmount <= 0) continue;
        const refundTxId = coinTransactionId(member.userId, `private_challenge_refund_${challengeId}`);
        const walletRef = db.collection('reward_coin_wallets').doc(member.userId);
        const walletSnap = await transaction.get(walletRef);
        const wallet = walletSnap.exists ? (walletSnap.data() as RewardCoinWallet) : emptyWallet(member.userId);
        const balance = Math.max(0, Number(wallet.balance) || 0);
        const createdAt = now.toISOString();
        const refundTx: RewardCoinTransaction = {
          id: refundTxId,
          userId: member.userId,
          amount: refundAmount,
          type: 'credit',
          origin: 'private_challenge_refund',
          ledgerType: 'PRIVATE_CHALLENGE_REFUND',
          description: `Reembolso da aposta -- desafio privado "${challenge.title}" cancelado (menos de 2 participantes)`,
          idempotencyKey: `private_challenge_refund_${challengeId}`,
          balanceBefore: balance,
          balanceAfter: balance + refundAmount,
          createdAt,
        };
        transaction.create(db.collection('reward_coin_transactions').doc(refundTxId), refundTx);
        transaction.set(walletRef, {
          userId: member.userId,
          balance: balance + refundAmount,
          lifetimeEarned: Math.max(0, Number(wallet.lifetimeEarned) || 0),
          lifetimeSpent: Math.max(0, Number(wallet.lifetimeSpent) || 0),
          updatedAt: createdAt,
        }, { merge: true });
      }
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
  const scored = await Promise.all(members.map(async (member) => ({
    member,
    score: Math.max(0, (await computeUserScoreForWindow(member.userId, startDate, endDate)).average || 0),
  })));
  const topScore = scored.reduce((max, entry) => Math.max(max, entry.score), 0);
  const topEntries = scored.filter(entry => entry.score === topScore);

  if (topEntries.length === 1 && topScore > 0) {
    const winner = topEntries[0].member;
    console.log(`[Private Challenges][Stake] Paying out staked challenge ${challengeId}. Champion: ${winner.userId}, pot: ${potTotal} coins.`);
    await db.runTransaction(async (transaction) => {
      const freshSnap = await transaction.get(challengeRef);
      const fresh = freshSnap.data();
      if (!fresh || ['completed', 'cancelled'].includes(fresh.status)) return; // já processado

      if (potTotal > 0) {
        const payoutTxId = coinTransactionId(winner.userId, `private_challenge_payout_${challengeId}`);
        const walletRef = db.collection('reward_coin_wallets').doc(winner.userId);
        const walletSnap = await transaction.get(walletRef);
        const wallet = walletSnap.exists ? (walletSnap.data() as RewardCoinWallet) : emptyWallet(winner.userId);
        const balance = Math.max(0, Number(wallet.balance) || 0);
        const createdAt = now.toISOString();
        const payoutTx: RewardCoinTransaction = {
          id: payoutTxId,
          userId: winner.userId,
          amount: potTotal,
          type: 'credit',
          origin: 'private_challenge_payout',
          ledgerType: 'PRIVATE_CHALLENGE_PAYOUT',
          description: `Prêmio por vencer o desafio privado "${challenge.title}"`,
          idempotencyKey: `private_challenge_payout_${challengeId}`,
          balanceBefore: balance,
          balanceAfter: balance + potTotal,
          createdAt,
        };
        transaction.create(db.collection('reward_coin_transactions').doc(payoutTxId), payoutTx);
        transaction.set(walletRef, {
          userId: winner.userId,
          balance: balance + potTotal,
          lifetimeEarned: Math.max(0, Number(wallet.lifetimeEarned) || 0) + potTotal,
          lifetimeSpent: Math.max(0, Number(wallet.lifetimeSpent) || 0),
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

      const feedRef = db.collection('elite_feed').doc();
      transaction.set(feedRef, {
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

  // Empate no topo (ou ninguém pontuou): dá uma chance a mais antes de
  // dividir o pote, exatamente como combinado ("empate estende 1 dia").
  if (!challenge.extendedOnce) {
    console.log(`[Private Challenges][Stake] Tie at the top for challenge ${challengeId} -- extending by 1 day (first and only extension).`);
    await db.runTransaction(async (transaction) => {
      const freshSnap = await transaction.get(challengeRef);
      const fresh = freshSnap.data();
      if (!fresh || ['completed', 'cancelled'].includes(fresh.status) || fresh.extendedOnce === true) return; // já processado ou já estendido
      const newEndDate = new Date(new Date(fresh.endDate).getTime() + 24 * 60 * 60 * 1000);
      transaction.set(challengeRef, {
        endDate: newEndDate.toISOString(),
        extendedOnce: true,
        updatedAt: now.toISOString(),
      }, { merge: true });
    });
    return;
  }

  // Já foi estendido uma vez e o empate persistiu (ou continua todo mundo
  // zerado): divide o pote em partes iguais entre quem empatou no topo, pra
  // Coins de ninguém ficarem presos indefinidamente.
  console.log(`[Private Challenges][Stake] Persistent tie for challenge ${challengeId} after extension -- splitting pot ${potTotal} coins among ${topEntries.length} member(s).`);
  const base = topEntries.length > 0 ? Math.floor(potTotal / topEntries.length) : 0;
  const remainder = topEntries.length > 0 ? potTotal - base * topEntries.length : 0;
  const sortedTopEntries = [...topEntries].sort((a, b) => String(a.member.userId).localeCompare(String(b.member.userId)));

  await db.runTransaction(async (transaction) => {
    const freshSnap = await transaction.get(challengeRef);
    const fresh = freshSnap.data();
    if (!fresh || ['completed', 'cancelled'].includes(fresh.status)) return; // já processado

    for (let i = 0; i < sortedTopEntries.length; i += 1) {
      const share = base + (i < remainder ? 1 : 0);
      if (share <= 0) continue;
      const { member } = sortedTopEntries[i];
      const splitTxId = coinTransactionId(member.userId, `private_challenge_refund_${challengeId}`);
      const walletRef = db.collection('reward_coin_wallets').doc(member.userId);
      const walletSnap = await transaction.get(walletRef);
      const wallet = walletSnap.exists ? (walletSnap.data() as RewardCoinWallet) : emptyWallet(member.userId);
      const balance = Math.max(0, Number(wallet.balance) || 0);
      const createdAt = now.toISOString();
      const splitTx: RewardCoinTransaction = {
        id: splitTxId,
        userId: member.userId,
        amount: share,
        type: 'credit',
        origin: 'private_challenge_refund',
        ledgerType: 'PRIVATE_CHALLENGE_REFUND',
        description: `Pote dividido -- empate persistente no desafio privado "${challenge.title}"`,
        idempotencyKey: `private_challenge_refund_${challengeId}`,
        balanceBefore: balance,
        balanceAfter: balance + share,
        createdAt,
      };
      transaction.create(db.collection('reward_coin_transactions').doc(splitTxId), splitTx);
      transaction.set(walletRef, {
        userId: member.userId,
        balance: balance + share,
        lifetimeEarned: Math.max(0, Number(wallet.lifetimeEarned) || 0),
        lifetimeSpent: Math.max(0, Number(wallet.lifetimeSpent) || 0),
        updatedAt: createdAt,
      }, { merge: true });
    }

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
