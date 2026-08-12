import { VercelRequest, VercelResponse } from '@vercel/node';
import { cors, verifyAuth } from '../_lib/common.js';
import { WalletEngine } from '../_lib/wallet-engine.js';
import { ConversionEngine } from '../_lib/conversion-engine.js';
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
      const config = await ConversionEngine.getConfig();
      const brlEquivalent = ConversionEngine.coinsToBrl(wallet.redeemableBalance, config.coinsPerBrl);

      return res.status(200).json({
        success: true,
        wallet,
        config: {
          coinsPerBrl: config.coinsPerBrl,
          minWithdrawalCoins: config.minWithdrawalCoins,
          maxDailyWithdrawalCoins: config.maxDailyWithdrawalCoins,
          enabled: config.enabled
        },
        brlEquivalent
      });
    }

    // 2. GET Transactions Ledger
    if (req.method === 'GET' && action === 'transactions') {
      const limit = Number(req.query.limit) || 50;
      const transactions = await WalletEngine.getTransactions(auth.uid, limit);
      return res.status(200).json({ success: true, transactions });
    }

    // 3. GET/POST Convert Preview
    if (action === 'convert') {
      const coinsAmount = Number(req.query.coins || req.body.coins || 0);
      const config = await ConversionEngine.getConfig();
      const brl = ConversionEngine.coinsToBrl(coinsAmount, config.coinsPerBrl);
      return res.status(200).json({
        success: true,
        coinsAmount,
        brlAmount: brl,
        rate: config.coinsPerBrl
      });
    }

    // 4. POST Request PIX Withdrawal
    if (req.method === 'POST' && (action === 'withdraw' || req.url.includes('/withdraw'))) {
      const { coinsAmount, pixKey, pixKeyType, deviceId } = req.body;
      const withdrawal = await WithdrawalEngine.requestWithdrawal({
        userId: auth.uid,
        coinsAmount: Number(coinsAmount),
        pixKey: String(pixKey),
        pixKeyType: pixKeyType || 'cpf',
        deviceId
      });

      return res.status(200).json({
        success: true,
        message: 'Solicitação de saque via PIX enviada com sucesso! O valor de IV Coins foi retido em segurança durante a análise.',
        withdrawal
      });
    }

    // 5. GET User Withdrawals List
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
