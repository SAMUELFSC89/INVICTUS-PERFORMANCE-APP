import { randomUUID } from 'node:crypto';
import { VercelRequest, VercelResponse } from '@vercel/node';
import { cors, db, verifyAuth, getAuth, app, FieldValue } from '../_lib/common.js';
import { WalletEngine } from '../_lib/wallet-engine.js';
import { WithdrawalEngine } from '../_lib/withdrawal-engine.js';
import { hasActiveAdminAuthority } from '../_lib/admin-authority.js';
import {
  checkPhoneVerification,
  hashVerifiedPhone,
  maskPhone,
  normalizeBrazilianPhone,
  samePhoneHash,
  startPhoneVerification,
} from '../_lib/identity-verification-service.js';

const ALLOWED_PIX_KEY_TYPES = new Set(['cpf', 'email', 'phone', 'random']);
const SANDBOX_WITHDRAWAL_TEST_CREDIT = 20;
const SANDBOX_WITHDRAWAL_TEST_KEY = 'withdrawal-r20-2026-09';
const WITHDRAWAL_OTP_TTL_MS = 10 * 60 * 1000;
const WITHDRAWAL_OTP_MAX_ATTEMPTS = 5;

type AccountIdentity = {
  emailVerified: boolean;
  phoneVerified: boolean;
  cpfVerified: boolean;
  phone: string;
};

function money(value: unknown): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function isStrictAsaasSandbox(): boolean {
  const environment = String(process.env.ASAAS_ENVIRONMENT || '').trim().toLowerCase();
  const baseUrl = String(process.env.ASAAS_API_BASE_URL || '').trim().toLowerCase();
  return environment === 'sandbox' && (!baseUrl || baseUrl.includes('sandbox'));
}

async function loadIdentity(userId: string): Promise<AccountIdentity> {
  const [profileSnap, authUser] = await Promise.all([
    db.collection('users').doc(userId).get(),
    getAuth(app).getUser(userId),
  ]);
  if (!profileSnap.exists) throw new Error('Perfil da conta não encontrado.');
  const profile = profileSnap.data() || {};
  const rawPhone = String(profile.phoneNumberNormalized || profile.phoneNumber || '');
  let phone = '';
  try { phone = rawPhone ? normalizeBrazilianPhone(rawPhone) : ''; } catch { phone = ''; }
  return {
    emailVerified: authUser.emailVerified === true,
    phoneVerified: profile.phoneVerified === true && Boolean(phone) && samePhoneHash(phone, profile.phoneVerifiedHash),
    cpfVerified: profile.cpfVerified === true && profile.cpfReceitaRegular === true && String(profile.cpfReceitaStatus || '').trim().toUpperCase() === 'REGULAR',
    phone,
  };
}

function identityReady(identity: AccountIdentity): boolean {
  return identity.emailVerified && identity.phoneVerified && identity.cpfVerified;
}

function identityPayload(identity: AccountIdentity) {
  return {
    emailVerified: identity.emailVerified,
    phoneVerified: identity.phoneVerified,
    cpfVerified: identity.cpfVerified,
    ready: identityReady(identity),
    phone: identity.phone ? maskPhone(identity.phone) : '',
  };
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

async function validateWithdrawalInput(userId: string, body: any) {
  const amount = money(body?.amount);
  const pixKey = String(body?.pixKey || '').trim();
  const pixKeyType = String(body?.pixKeyType || '').trim();

  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Informe um valor de saque válido.');
  if (!pixKey || pixKey.length > 200) throw new Error('Informe uma chave PIX válida.');
  if (!ALLOWED_PIX_KEY_TYPES.has(pixKeyType)) throw new Error('Tipo de chave PIX inválido.');

  const [wallet, config] = await Promise.all([
    WalletEngine.getWallet(userId),
    WithdrawalEngine.getConfig(),
  ]);
  if (!config.enabled) throw new Error('Saques PIX estão temporariamente desativados.');
  if (amount < money(config.minWithdrawalAmount)) {
    throw new Error(`O saque mínimo é de R$ ${money(config.minWithdrawalAmount).toFixed(2)}.`);
  }
  if (amount > money(config.maxDailyWithdrawalAmount)) {
    throw new Error(`O limite diário por solicitação é de R$ ${money(config.maxDailyWithdrawalAmount).toFixed(2)}.`);
  }
  if (amount > money(wallet.redeemableBalance)) {
    throw new Error(`Saldo de prêmio insuficiente. Disponível: R$ ${money(wallet.redeemableBalance).toFixed(2)}.`);
  }

  return { amount, pixKey, pixKeyType };
}

/**
 * Carteira financeira exclusiva para premiações oficiais em dinheiro.
 *
 * Invictus Coins continuam isolados e sem valor monetário. Saque financeiro
 * exige conta verificada (e-mail, telefone e CPF/Receita) e um OTP NOVO enviado
 * ao telefone verificado para cada solicitação. Selfie/biometria não participa
 * deste fluxo.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;
  const auth = await verifyAuth(req);
  if (!auth) return res.status(401).json({ success: false, error: 'Sessão inválida ou expirada.' });

  try {
    if (req.method === 'GET') {
      const sandboxTestCreditApplied = await ensureSandboxWithdrawalTestCredit(auth.uid);
      const [wallet, withdrawals, config, identity] = await Promise.all([
        WalletEngine.getWallet(auth.uid),
        WithdrawalEngine.getUserWithdrawals(auth.uid),
        WithdrawalEngine.getConfig(),
        loadIdentity(auth.uid),
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
        identity: identityPayload(identity),
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

    if (action === 'request-withdrawal') {
      const identity = await loadIdentity(auth.uid);
      if (!identityReady(identity)) {
        return res.status(403).json({
          success: false,
          code: 'IDENTITY_VERIFICATION_REQUIRED',
          error: 'Confirme seu e-mail, telefone e CPF antes de solicitar um saque.',
          identity: identityPayload(identity),
        });
      }

      const withdrawal = await validateWithdrawalInput(auth.uid, req.body);
      const otpRequestId = `wotp_${randomUUID().replace(/-/g, '')}`;
      const expiresAt = new Date(Date.now() + WITHDRAWAL_OTP_TTL_MS).toISOString();
      await startPhoneVerification(identity.phone);
      await db.collection('pending_withdrawal_otps').doc(otpRequestId).set({
        userId: auth.uid,
        status: 'pending',
        phoneHash: hashVerifiedPhone(identity.phone),
        withdrawal,
        createdAt: FieldValue.serverTimestamp(),
        expiresAt,
        attempts: 0,
      });

      return res.status(201).json({
        success: true,
        otpRequired: true,
        otpRequestId,
        phone: maskPhone(identity.phone),
        expiresAt,
        userMessage: `Enviamos um código Invictus por SMS para ${maskPhone(identity.phone)}. Digite o código para confirmar o saque.`,
      });
    }

    if (action === 'confirm-withdrawal-otp') {
      const otpRequestId = String(req.body?.otpRequestId || '').trim();
      const code = String(req.body?.code || '').replace(/\D/g, '');
      if (!/^wotp_[a-f0-9]{32}$/i.test(otpRequestId) || code.length < 4 || code.length > 10) {
        return res.status(400).json({ success: false, error: 'Código ou solicitação de saque inválidos.' });
      }

      const identity = await loadIdentity(auth.uid);
      if (!identityReady(identity)) {
        return res.status(403).json({
          success: false,
          code: 'IDENTITY_VERIFICATION_REQUIRED',
          error: 'A verificação da sua conta mudou. Confirme novamente seus dados antes do saque.',
          identity: identityPayload(identity),
        });
      }

      const otpRef = db.collection('pending_withdrawal_otps').doc(otpRequestId);
      const otpSnap = await otpRef.get();
      if (!otpSnap.exists) return res.status(404).json({ success: false, error: 'Confirmação de saque não encontrada. Solicite um novo código.' });
      const otp = otpSnap.data() || {};
      if (otp.userId !== auth.uid) return res.status(403).json({ success: false, error: 'Esta confirmação pertence a outra conta.' });
      if (otp.status === 'completed') return res.status(409).json({ success: false, error: 'Este código já foi utilizado.' });
      if (otp.status !== 'pending') return res.status(409).json({ success: false, error: 'Esta confirmação não está mais disponível.' });
      const attempts = Math.max(0, Number(otp.attempts) || 0);
      if (attempts >= WITHDRAWAL_OTP_MAX_ATTEMPTS) {
        await otpRef.set({ status: 'attempts_exhausted', completedAt: FieldValue.serverTimestamp() }, { merge: true });
        return res.status(429).json({ success: false, error: 'Limite de tentativas atingido. Solicite um novo código para o saque.' });
      }
      const expiresAt = new Date(String(otp.expiresAt || ''));
      if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() < Date.now()) {
        await otpRef.set({ status: 'expired', completedAt: FieldValue.serverTimestamp() }, { merge: true });
        return res.status(400).json({ success: false, error: 'O código expirou. Solicite um novo código para o saque.' });
      }
      if (!samePhoneHash(identity.phone, otp.phoneHash)) {
        await otpRef.set({ status: 'phone_changed', completedAt: FieldValue.serverTimestamp() }, { merge: true });
        return res.status(409).json({ success: false, error: 'O telefone verificado mudou. Solicite um novo código.' });
      }

      const approved = await checkPhoneVerification(identity.phone, code);
      if (!approved) {
        const nextAttempts = attempts + 1;
        await otpRef.set({
          attempts: FieldValue.increment(1),
          lastAttemptAt: FieldValue.serverTimestamp(),
          ...(nextAttempts >= WITHDRAWAL_OTP_MAX_ATTEMPTS ? { status: 'attempts_exhausted', completedAt: FieldValue.serverTimestamp() } : {}),
        }, { merge: true });
        return res.status(nextAttempts >= WITHDRAWAL_OTP_MAX_ATTEMPTS ? 429 : 400).json({
          success: false,
          error: nextAttempts >= WITHDRAWAL_OTP_MAX_ATTEMPTS
            ? 'Limite de tentativas atingido. Solicite um novo código para o saque.'
            : 'Código incorreto ou expirado. Confira o SMS da Invictus e tente novamente.',
        });
      }

      try {
        await db.runTransaction(async (transaction: any) => {
          const fresh = await transaction.get(otpRef);
          const data = fresh.data() || {};
          if (!fresh.exists || data.userId !== auth.uid || data.status !== 'pending') throw new Error('OTP_ALREADY_CLAIMED');
          transaction.update(otpRef, { status: 'processing', confirmedAt: FieldValue.serverTimestamp() });
        });
      } catch (claimError: any) {
        if (claimError?.message === 'OTP_ALREADY_CLAIMED') {
          return res.status(409).json({ success: false, error: 'Este código já está sendo processado ou foi utilizado.' });
        }
        throw claimError;
      }

      try {
        const withdrawalData = otp.withdrawal || {};
        const validated = await validateWithdrawalInput(auth.uid, withdrawalData);
        const commitResult = await WithdrawalEngine.requestWithdrawal({
          ...validated,
          userId: auth.uid,
          requestId: String(withdrawalData.requestId || otpRequestId),
        });
        await otpRef.set({
          status: 'completed',
          completedAt: FieldValue.serverTimestamp(),
          withdrawalId: commitResult?.id || commitResult?.withdrawalId || null,
        }, { merge: true });
        return res.status(201).json({
          success: true,
          otpRequired: false,
          status: 'approved',
          commitResult,
          userMessage: 'Telefone confirmado. Solicitação de saque criada e saldo reservado para processamento do PIX.',
        });
      } catch (commitError) {
        await otpRef.set({ status: 'pending', processingErrorAt: FieldValue.serverTimestamp() }, { merge: true });
        throw commitError;
      }
    }

    return res.status(400).json({ success: false, error: 'Ação financeira inválida.' });
  } catch (error: any) {
    console.error('[Financial Prize Wallet] Error:', error);
    const message = error?.message || 'Não foi possível carregar ou processar a carteira de premiações.';
    const status = /mínimo|limite|saldo|chave PIX|valor de saque|desativados/i.test(message) ? 400 : 500;
    return res.status(status).json({ success: false, error: message });
  }
}
