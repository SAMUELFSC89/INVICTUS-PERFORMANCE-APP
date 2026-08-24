import { VercelRequest, VercelResponse } from '@vercel/node';
import { cors, verifyAuth } from '../_lib/common.js';
import { WithdrawalEngine } from '../_lib/withdrawal-engine.js';

/**
 * Compatibilidade para clientes antigos. Toda solicitação passa agora pelo
 * mesmo motor financeiro de /financial, que usa a carteira canônica, valida
 * antifraude e aplica idempotência/limite diário em uma transação atômica.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Método não permitido.' });
  }

  const auth = await verifyAuth(req);
  if (!auth) {
    return res.status(401).json({ success: false, error: 'Não autorizado. Sessão inválida.' });
  }

  const { amount, pixKey, pixKeyType, requestId, deviceId } = req.body || {};
  if (typeof requestId !== 'string' || !requestId.trim()) {
    return res.status(400).json({ success: false, error: 'requestId é obrigatório para evitar saques duplicados.' });
  }

  try {
    const withdrawal = await WithdrawalEngine.requestWithdrawal({
      userId: auth.uid,
      amount: Number(amount),
      pixKey: typeof pixKey === 'string' ? pixKey : '',
      pixKeyType,
      deviceId: typeof deviceId === 'string' ? deviceId : undefined,
      requestId
    });
    return res.status(200).json({
      success: true,
      status: withdrawal.status,
      withdrawal,
      message: 'Solicitação de saque registrada com segurança.'
    });
  } catch (error: any) {
    console.error('[Wallet Redeem] Falha ao registrar saque:', error);
    return res.status(400).json({
      success: false,
      error: error?.message || 'Não foi possível registrar a solicitação de saque.'
    });
  }
}
