import { randomUUID } from 'node:crypto';
import { VercelRequest, VercelResponse } from '@vercel/node';
import { cors, db, verifyAuth } from '../_lib/common.js';
import { WalletEngine } from '../_lib/wallet-engine.js';
import { WithdrawalEngine } from '../_lib/withdrawal-engine.js';
import { criarPresenceCheck } from '../_lib/presence-check-service.js';
import { hasActiveAdminAuthority } from '../_lib/admin-authority.js';

const ALLOWED_PIX_KEY_TYPES = new Set(['cpf', 'email', 'phone', 'random']);
const SANDBOX_WITHDRAWAL_TEST_CREDIT = 20;
const SANDBOX_WITHDRAWAL_TEST_KEY = 'withdrawal-r20-2026-09';

function money(value: unknown): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function isStrictAsaasSandbox(): boolean {
  const environment = String(process.env.ASAAS_ENVIRONMENT || '').trim().toLowerCase();
  const baseUrl = String(process.env.ASAAS_API_BASE_URL || '').trim().toLowerCase();
  return environment === 'sandbox' && (!baseUrl || baseUrl.includes('sandbox'));
}

/**
 * One-shot test balance for the authenticated administrator while Asaas is in
 * Sandbox. It is deliberately impossible to execute in production and is
 * idempotent per user/test key.
 */
async function ensureSandboxWithdrawalTestCredit(userId: string): Promise<boolean> {
  if (!isStrictAsaasSandbox()) return false;

  const userRef = db.collection('users').doc(userId);
  const walletRef = db.collection('wallets').doc(userId);
  const markerRef = db.collection('sandbox_financial_test_credits').doc(`${userId}_${SANDBOX_WITHDRAWAL_TEST_KEY}`);
  const txRef = db.collection('iv_transactions').doc(`tx_sandbox_${SANDBOX_WITHDRAWAL_TEST_KEY}_${userId}`);
  const now = new Date().toISOString();

  return db.runTransaction(async (transaction: any) => {
    const [userSnap, walletSnap, markerSnap] = await Promise.all([
      transaction.get(userRef),
      transaction.get(walletRef),
      transaction.get(markerRef),
    ]);

    if (!userSnap.exists || !hasActiveAdminAuthority(userSnap.data() || {})) return false;
    if (markerSnap.exists) return false;

    const userData = userSnap.data() || {};
    const wallet = walletSnap.exists ? walletSnap.data() || {} : {};
    const previousRedeemable = walletSnap.exists
      ? Math.max(0, Number(wallet.redeemableBalance) || 0)
      : Math.max(0, Number(userData.walletBalance) || 0);
    const ecosystemBalance = Math.max(0, Number(wallet.ecosystemBalance) || 0);
    const promotionalBalance = Math.max(0, Number(wallet.promotionalBalance) || 0);
    const blockedBalance = Math.max(0, Number(wallet.blockedBalance) || 0);
    const redeemableBalance = money(previousRedeemable + SANDBOX_WITHDRAWAL_TEST_CREDIT);

    transaction.set(walletRef, {
      userId,
      redeemableBalance,
      ecosystemBalance,
      promotionalBalance,
      blockedBalance,
      totalBalance: money(redeemableBalance + ecosystemBalance + promotionalBalance),
      updatedAt: now,
    }, { merge: true });

    transaction.create(txRef, {
      id: txRef.id,
      userId,
      amount: SANDBOX_WITHDRAWAL_TEST_CREDIT,
      category: 'redeemable',
      type: 'credit',
      origin: 'sandbox_test',
      destination: 'Wallet Invictus',
      description: 'Crédito único de R$ 20,00 para teste de saque PIX no Asaas Sandbox',
      idempotencyKey: SANDBOX_WITHDRAWAL_TEST_KEY,
      createdAt: now,
    });

    transaction.create(markerRef, {
      userId,
      amount: SANDBOX_WITHDRAWAL_TEST_CREDIT,
      testKey: SANDBOX_WITHDRAWAL_TEST_KEY,
      environment: 'sandbox',
      transactionId: txRef.id,
      createdAt: now,
    });

    return true;
  });
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
      const sandboxTestCreditApplied = await ensureSandboxWithdrawalTestCredit(auth.uid);
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
        sandboxTestCreditApplied,
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
