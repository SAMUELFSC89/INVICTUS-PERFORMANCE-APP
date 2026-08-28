import { VercelRequest, VercelResponse } from '@vercel/node';
import { cors, verifyAuth } from '../_lib/common.js';
import { WalletEngine } from '../_lib/wallet-engine.js';
import { WithdrawalEngine } from '../_lib/withdrawal-engine.js';
import { criarPresenceCheck } from '../_lib/presence-check-service.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;

  const auth = await verifyAuth(req);
  if (!auth) {
    return res.status(401).json({ success: false, error: 'Sessão inválida ou expirada.' });
  }

  const action = (req.query.action || req.body.action) as string;

  try {
    // 1. GET Wallet Summary
    if (req.method === 'GET' && (!action || action === 'summary')) {
      const wallet = await WalletEngine.getWallet(auth.uid);
      const config = await WithdrawalEngine.getConfig();

      return res.status(200).json({
        success: true,
        wallet,
        config: {
          minWithdrawalAmount: config.minWithdrawalAmount,
          maxDailyWithdrawalAmount: config.maxDailyWithdrawalAmount,
          enabled: config.enabled
        }
      });
    }

    // 2. GET Transactions Ledger
    if (req.method === 'GET' && action === 'transactions') {
      const limit = Number(req.query.limit) || 50;
      const transactions = await WalletEngine.getTransactions(auth.uid, limit);
      return res.status(200).json({ success: true, transactions });
    }

    // 3. POST Request PIX Withdrawal (amount is in R$ / Reais directly)
    //
    // Dinheiro real saindo: antes de chamar WithdrawalEngine.requestWithdrawal,
    // exige confirmacao de presenca por selfie -- mesmo mecanismo do check-in
    // de academia e da inscricao de campeonatos (ver
    // api/_lib/presence-check-service.ts). O saque so e de fato solicitado
    // depois, em api/_handlers/validate-presence.ts (actionType 'withdrawal'),
    // apos a selfie ser aprovada.
    if (req.method === 'POST' && (action === 'withdraw' || req.url.includes('/withdraw'))) {
      const { amount, pixKey, pixKeyType, deviceId, requestId } = req.body;

      const { presenceCheckId, livenessPrompt } = await criarPresenceCheck({
        userId: auth.uid,
        actionType: 'withdrawal',
        payload: {
          amount: Number(amount),
          pixKey: typeof pixKey === 'string' ? pixKey : '',
          pixKeyType: pixKeyType || 'cpf',
          deviceId,
          requestId: typeof requestId === 'string' ? requestId : `wd_${auth.uid}_${Date.now()}`
        },
      });

      return res.status(200).json({
        success: true,
        presenceCheckRequired: true,
        presenceCheckId,
        livenessPrompt,
        message: 'Confirme sua presença por selfie para concluir a solicitação de saque via PIX.'
      });
    }

    // 4. GET User Withdrawals List
    if (req.method === 'GET' && action === 'withdrawals') {
      const withdrawals = await WithdrawalEngine.getUserWithdrawals(auth.uid);
      return res.status(200).json({ success: true, withdrawals });
    }

    return res.status(400).json({ success: false, error: 'Ação financeira não informada ou inválida.' });
  } catch (err: any) {
    console.error('[Financial Handler Error]:', err);
    return res.status(400).json({ success: false, error: err.message || 'Erro ao processar operação financeira.' });
  }
}
