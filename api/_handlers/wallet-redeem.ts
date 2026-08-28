import { VercelRequest, VercelResponse } from '@vercel/node';
import { cors, verifyAuth } from '../_lib/common.js';
import { criarPresenceCheck } from '../_lib/presence-check-service.js';

/**
 * Compatibilidade para clientes antigos. Antes de mover dinheiro real
 * (WithdrawalEngine.requestWithdrawal, que so roda depois em
 * api/_handlers/validate-presence.ts, actionType 'withdrawal'), exige
 * confirmacao de presenca por selfie -- mesmo mecanismo usado no check-in de
 * academia e na inscricao de campeonatos (ver api/_lib/presence-check-service.ts).
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
    const { presenceCheckId, livenessPrompt } = await criarPresenceCheck({
      userId: auth.uid,
      actionType: 'withdrawal',
      payload: {
        amount: Number(amount),
        pixKey: typeof pixKey === 'string' ? pixKey : '',
        pixKeyType,
        deviceId: typeof deviceId === 'string' ? deviceId : undefined,
        requestId
      },
    });

    return res.status(200).json({
      success: true,
      presenceCheckRequired: true,
      presenceCheckId,
      livenessPrompt,
      userMessage: 'Confirme sua presença por selfie para processar o saque.'
    });
  } catch (error: any) {
    console.error('[Wallet Redeem] Falha ao iniciar confirmação de presença do saque:', error);
    return res.status(400).json({
      success: false,
      error: error?.message || 'Não foi possível registrar a solicitação de saque.'
    });
  }
}
