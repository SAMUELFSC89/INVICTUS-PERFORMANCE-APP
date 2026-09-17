import { randomUUID } from 'node:crypto';
import { VercelRequest, VercelResponse } from '@vercel/node';
import { cors, verifyAuth } from '../_lib/common.js';
import { WalletEngine } from '../_lib/wallet-engine.js';
import { WithdrawalEngine } from '../_lib/withdrawal-engine.js';
import { criarPresenceCheck } from '../_lib/presence-check-service.js';

const ALLOWED_PIX_KEY_TYPES = new Set(['cpf', 'email', 'phone', 'random']);

function money(value: unknown): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

/**
 * Carteira financeira exclusiva para premiações oficiais em dinheiro.
 *
 * Invictus Coins continuam isolados e sem valor monetário; esta rota só expõe
 * `redeemableBalance`, que é alimentado por settlement de campeonato/temporada
 * elegível. Todo saque exige uma nova prova de presença antes de reservar saldo.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;
  const auth = await verifyAuth(req);
  if (!auth) return res.status(401).json({ success: false, error: 'Sessão inválida ou expirada.' });

  try {
    if (req.method === 'GET') {
      const [wallet, withdrawals, config] = await Promise.all([
        WalletEngine.getWallet(auth.uid),
        WithdrawalEngine.getUserWithdrawals(auth.uid),
        WithdrawalEngine.getConfig(),
      ]);

      return res.json({
        success: true,
        wallet: {
          redeemableBalance: money(wallet.redeemableBalance),
          blockedBalance: money(wallet.blockedBalance),
          updatedAt: wallet.updatedAt,
        },
        withdrawals,
        config: {
          enabled: config.enabled,
          minWithdrawalAmount: money(config.minWithdrawalAmount),
          maxDailyWithdrawalAmount: money(config.maxDailyWithdrawalAmount),
        },
        cashSource: 'official_prizes_only',
        coinsWithdrawable: false,
      });
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ success: false, error: 'Método não permitido.' });
    }

    const action = String(req.body?.action || '').trim();
    if (action !== 'request-withdrawal') {
      return res.status(400).json({ success: false, error: 'Ação financeira inválida.' });
    }

    const amount = money(req.body?.amount);
    const pixKey = String(req.body?.pixKey || '').trim();
    const pixKeyType = String(req.body?.pixKeyType || '').trim();

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ success: false, error: 'Informe um valor de saque válido.' });
    }
    if (!pixKey || pixKey.length > 200) {
      return res.status(400).json({ success: false, error: 'Informe uma chave PIX válida.' });
    }
    if (!ALLOWED_PIX_KEY_TYPES.has(pixKeyType)) {
      return res.status(400).json({ success: false, error: 'Tipo de chave PIX inválido.' });
    }

    const [wallet, config] = await Promise.all([
      WalletEngine.getWallet(auth.uid),
      WithdrawalEngine.getConfig(),
    ]);
    if (!config.enabled) {
      return res.status(409).json({ success: false, error: 'Saques PIX estão temporariamente desativados.' });
    }
    if (amount < money(config.minWithdrawalAmount)) {
      return res.status(400).json({
        success: false,
        error: `O saque mínimo é de R$ ${money(config.minWithdrawalAmount).toFixed(2)}.`,
      });
    }
    if (amount > money(config.maxDailyWithdrawalAmount)) {
      return res.status(400).json({
        success: false,
        error: `O limite diário por solicitação é de R$ ${money(config.maxDailyWithdrawalAmount).toFixed(2)}.`,
      });
    }
    if (amount > money(wallet.redeemableBalance)) {
      return res.status(400).json({
        success: false,
        error: `Saldo de prêmio insuficiente. Disponível: R$ ${money(wallet.redeemableBalance).toFixed(2)}.`,
      });
    }

    const requestId = `withdraw_${randomUUID().replace(/-/g, '')}`;
    const presence = await criarPresenceCheck({
      userId: auth.uid,
      actionType: 'withdrawal',
      payload: {
        amount,
        pixKey,
        pixKeyType,
        requestId,
      },
      minutosValidade: 10,
    });

    return res.status(201).json({
      success: true,
      presenceCheckRequired: true,
      presenceCheckId: presence.presenceCheckId,
      livenessPrompt: presence.livenessPrompt,
      userMessage: 'Confirme sua identidade para criar a solicitação de saque do prêmio.',
    });
  } catch (error: any) {
    console.error('[Financial Prize Wallet] Error:', error);
    return res.status(500).json({
      success: false,
      error: error?.message || 'Não foi possível carregar ou processar a carteira de premiações.',
    });
  }
}
