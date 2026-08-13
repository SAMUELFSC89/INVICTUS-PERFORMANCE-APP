import { VercelRequest, VercelResponse } from '@vercel/node';
import { cors, verifyAuth } from '../_lib/common.js';
import { WalletEngine } from '../_lib/wallet-engine.js';
import { WithdrawalEngine } from '../_lib/withdrawal-engine.js';

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
    if (req.method === 'POST' && (action === 'withdraw' || req.url.includes('/withdraw'))) {
      const { amount, pixKey, pixKeyType, deviceId } = req.body;
      const withdrawal = await WithdrawalEngine.requestWithdrawal({
        userId: auth.uid,
        amount: Number(amount),
        pixKey: String(pixKey),
        pixKeyType: pixKeyType || 'cpf',
        deviceId
      });

      return res.status(200).json({
        success: true,
        message: 'Solicitação de saque via PIX enviada com sucesso! O valor foi retido em segurança durante a análise.',
        withdrawal
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
