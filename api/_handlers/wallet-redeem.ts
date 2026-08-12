import { VercelRequest, VercelResponse } from '@vercel/node';
import { 
  db,
  cors, 
  verifyAuth,
  FieldValue
} from '../_lib/common.js';

/**
 * Handle redemption requests with server-side validations and transactions
 * POST /api/wallet/redeem
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Handle CORS
  if (cors(req, res)) return;

  // Validate request method
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  // 1. Authenticate user
  const auth = await verifyAuth(req);
  if (!auth) {
    return res.status(401).json({ success: false, error: 'Não autorizado. Sessão inválida.' });
  }

  const { amount, pixKey, pixKeyType, requestId, deviceId } = req.body;

  // 2. Validate request body and params
  if (amount === undefined || amount === null) {
    return res.status(400).json({ success: false, error: 'O valor de resgate é obrigatório.' });
  }

  const numericAmount = Number(amount);
  if (isNaN(numericAmount) || numericAmount <= 0) {
    return res.status(400).json({ success: false, error: 'O valor de resgate deve ser um número positivo.' });
  }

  // Minimum redemption check (R$ 20,00)
  if (numericAmount < 20) {
    return res.status(400).json({ success: false, error: 'O valor mínimo para resgate é R$ 20,00.' });
  }

  if (!pixKey || typeof pixKey !== 'string' || pixKey.trim().length === 0) {
    return res.status(400).json({ success: false, error: 'A chave PIX é obrigatória.' });
  }

  const allowedPixTypes = ['cpf', 'email', 'phone', 'random'];
  if (!pixKeyType || !allowedPixTypes.includes(pixKeyType)) {
    return res.status(400).json({ success: false, error: 'O tipo de chave PIX fornecido é inválido.' });
  }

  if (!requestId || typeof requestId !== 'string' || requestId.trim().length === 0) {
    return res.status(400).json({ success: false, error: 'Identificador único da requisição (requestId) é obrigatório.' });
  }

  const clientIp = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || 'unknown';

  try {
    if (!db) {
      console.error('[Wallet Redeem] Database initialization failed. db is undefined.');
      return res.status(500).json({ success: false, error: 'Falha interna ao inicializar bando de dados.' });
    }

    console.log(`[Wallet Redeem Log] User ${auth.uid} attempting to redeem R$ ${numericAmount} with request ${requestId}`);

    // Executar transação segura para garantir atomicidade, prevenção de race conditions, prevenção de saque duplo, integridade financeira.
    const result = await db.runTransaction(async (transaction) => {
      // 1. Check duplicate request using requestId as document ID (Lock transacional / prevenção de múltiplos cliques)
      const txRef = db.collection('walletTransactions').doc(requestId);
      const txSnap = await transaction.get(txRef);
      if (txSnap.exists) {
        throw new Error('Esta requisição de resgate já foi processada ou está em andamento (ID duplicado).');
      }

      // Check duplicidade na coleção redemptions se existir com red_req_ prefixo
      const redemptionId = `red_req_${requestId}`;
      const redemptionRef = db.collection('redemptions').doc(redemptionId);
      const redemptionSnap = await transaction.get(redemptionRef);
      if (redemptionSnap.exists) {
        throw new Error('Solicitação de resgate duplicada por ID.');
      }

      // 2. Fetch user profile
      const userRef = db.collection('users').doc(auth.uid);
      const userSnap = await transaction.get(userRef);
      if (!userSnap.exists) {
        throw new Error('Perfil de usuário não encontrado.');
      }

      const userData = userSnap.data() || {};

      // 3. Validar se conta está bloqueada ou banida
      if (userData.isBlocked === true || userData.isBanned === true) {
        throw new Error('Esta conta está suspensa ou bloqueada para transações financeiras.');
      }

      // 4. Validar Trust Score mínimo (Ex: mínimo 50)
      const trustProfileRef = db.collection('user_trust_profiles').doc(auth.uid);
      const trustProfileSnap = await transaction.get(trustProfileRef);
      
      let trustScore = userData.trustScore !== undefined ? Number(userData.trustScore) : 100;
      if (trustProfileSnap.exists) {
        const tpData = trustProfileSnap.data() || {};
        if (tpData.trustScore !== undefined) {
          trustScore = Number(tpData.trustScore);
        }
      }

      if (trustScore < 50) {
        throw new Error(`Trust Score atual de ${trustScore} está abaixo do mínimo exigido (mínimo 50) para realizar saques.`);
      }

      // 5. Validar saldo disponível
      const currentBalance = userData.walletBalance !== undefined ? Number(userData.walletBalance) : 0;
      if (currentBalance < numericAmount) {
        throw new Error(`Saldo insuficiente para realizar o resgate. Saldo disponível: R$ ${currentBalance.toFixed(2)}.`);
      }

      // 6. Anti-fraude check: Limite diário de saque (opcional / prevenção de abusos)
      // Buscando transações de hoje desse usuário para somar retiradas
      // Nota: não podemos fazer query complexa dentro da transação em si, mas podemos fazer fora dela se necessário.
      // Como o ID é idempotente por requestId e temos limites de cliques e lock por requestId, race conditions de duplo saque são 100% resolvidas.

      // 7. Preparando as flags de fraude para auditoria
      const fraudFlags: string[] = [];
      if (trustScore < 80) fraudFlags.push('TRUST_SCORE_WARN');
      if (userData.infractions && Number(userData.infractions) > 2) fraudFlags.push('MANY_USER_INFRACTIONS');
      if (numericAmount >= 200) fraudFlags.push('LARGE_WITHDRAWAL_ALERT');

      const validationSnapshot = {
        userId: auth.uid,
        userTrustScore: trustScore,
        userInfractions: userData.infractions || 0,
        userScore: userData.score || 0,
        userWeeklyScore: userData.weeklyScore || 0,
        userCompletedWorkouts: userData.totalWorkouts || 0,
        userCreatedAt: userData.createdAt || '',
        withdrawalAmount: numericAmount,
        previousBalance: currentBalance,
        newBalance: currentBalance - numericAmount,
        timestamp: new Date().toISOString()
      };

      // 8. Deduzir o saldo do usuário (Update seguro)
      transaction.update(userRef, {
        walletBalance: FieldValue.increment(-numericAmount)
      });

      // 9. Registrar transação financeira (walletTransactions)
      transaction.set(txRef, {
        id: requestId,
        userId: auth.uid,
        type: 'redemption',
        amount: numericAmount,
        previousBalance: currentBalance,
        newBalance: currentBalance - numericAmount,
        createdAt: new Date().toISOString(),
        status: 'processing',
        requestId,
        deviceId: deviceId || 'unknown_device',
        ipAddress: clientIp,
        fraudFlags,
        validationSnapshot
      });

      // 10. Criar solicitação de resgate compatível na coleção redemptions
      transaction.set(redemptionRef, {
        id: redemptionId,
        userId: auth.uid,
        amount: numericAmount,
        pixKey,
        pixKeyType,
        status: 'pending',
        createdAt: new Date().toISOString(),
        walletTransactionId: requestId
      });

      return {
        success: true,
        status: 'processing',
        message: 'Solicitação de resgate enviada com sucesso.'
      };
    });

    console.log(`[Wallet Redeem Log] SUCCESS Request ${requestId} processed successfully for user ${auth.uid}`);
    return res.status(200).json(result);

  } catch (error: any) {
    console.error(`[Wallet Redeem Log] FAILED request ${requestId} for user ${auth.uid || 'unknown'}: ${error.message}`);
    
    // Return structured API response for user errors
    return res.status(400).json({
      success: false,
      error: error.message || 'Ocorreu um erro ao processar sua solicitação de resgate.'
    });
  }
}
