import { randomUUID } from 'node:crypto';
import { VercelRequest, VercelResponse } from '@vercel/node';
import { cors, db, verifyAuth, getAuth, app } from '../_lib/common.js';
import { WalletEngine } from '../_lib/wallet-engine.js';
import { WithdrawalEngine } from '../_lib/withdrawal-engine.js';
import { hasActiveAdminAuthority } from '../_lib/admin-authority.js';
import { maskPhone, normalizeBrazilianPhone } from '../_lib/identity-verification-service.js';
import { logEvent } from '../_lib/observability.js';

const ALLOWED_PIX_KEY_TYPES = new Set(['cpf', 'email', 'phone', 'random']);
// #saque-automatico: identifica no reviewerId/log de auditoria que o
// pagamento foi disparado pelo próprio fluxo de solicitação, sem um admin
// humano ter clicado em "processar" -- ver decisão do usuário em 18/09/2026:
// só 'pending' (antifraude passou, score >=80) vira automático; 'under_review'
// (score <80) continua exigindo aprovação manual como antes.
const AUTO_WITHDRAWAL_REVIEWER_ID = 'system_auto_asaas';
const SANDBOX_WITHDRAWAL_TEST_CREDIT = 20;
const SANDBOX_WITHDRAWAL_TEST_KEY = 'withdrawal-r20-2026-09';
const PHONE_REAUTH_MAX_AGE_SECONDS = 5 * 60;

// #238: por decisão explícita do usuário em 18/09/2026, a verificação de
// identidade (e-mail + telefone) e a reautenticação por telefone a cada
// saque PARARAM DE BLOQUEAR a solicitação de saque -- só temporariamente,
// para permitir testar o fluxo de saque enquanto o bug do RecaptchaVerifier
// no app nativo (#237) é validado num build novo. O status de verificação
// continua sendo calculado e exibido normalmente no perfil/carteira
// (identityReady() e identityPayload() não mudaram); só a trava no momento
// do saque foi desligada. Trocar para `true` reativa as duas exigências.
const ENFORCE_IDENTITY_FOR_WITHDRAWAL = false;

type AccountIdentity = {
  emailVerified: boolean;
  phoneVerified: boolean;
  cpfVerified: boolean;
  phone: string;
};

type FinancialError = Error & { code?: string };

function money(value: unknown): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function isStrictAsaasSandbox(): boolean {
  const environment = String(process.env.ASAAS_ENVIRONMENT || '').trim().toLowerCase();
  const baseUrl = String(process.env.ASAAS_API_BASE_URL || '').trim().toLowerCase();
  return environment === 'sandbox' && (!baseUrl || baseUrl.includes('sandbox'));
}

function financialError(code: string, message: string): FinancialError {
  const error = new Error(message) as FinancialError;
  error.code = code;
  return error;
}

async function loadIdentity(userId: string): Promise<AccountIdentity> {
  const [profileSnap, authUser] = await Promise.all([
    db.collection('users').doc(userId).get(),
    getAuth(app).getUser(userId),
  ]);
  const profile = profileSnap.exists ? profileSnap.data() || {} : {};

  let phone = '';
  try {
    phone = authUser.phoneNumber ? normalizeBrazilianPhone(authUser.phoneNumber) : '';
  } catch {
    phone = '';
  }

  return {
    emailVerified: authUser.emailVerified === true,
    phoneVerified: Boolean(phone),
    cpfVerified: profileSnap.exists
      && profile.cpfVerified === true
      && profile.cpfReceitaRegular === true
      && String(profile.cpfReceitaStatus || '').trim().toUpperCase() === 'REGULAR',
    phone,
  };
}

function identityReady(identity: AccountIdentity): boolean {
  // CPF/Serpro fica fora do gate temporariamente (credenciais Serpro ainda
  // não configuradas em produção) -- decisão explícita do usuário em
  // 17/09/2026. cpfVerified continua computado e exposto no payload pra não
  // perder o dado nem quebrar a tela de identidade; só não bloqueia mais o
  // saque. Reativar assim que a Consulta CPF v3 da Serpro estiver contratada.
  return identity.emailVerified && identity.phoneVerified;
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
 * Cada saque exige uma autenticação Firebase recente especificamente pelo
 * telefone já vinculado à conta. O SMS/código é validado pelo Firebase no
 * cliente; o servidor nunca recebe nem armazena o código. Aqui revalidamos a
 * assinatura do ID token, auth_time, provider e número antes de reservar saldo.
 */
async function requireFreshFirebasePhoneReauth(req: VercelRequest, userId: string, expectedPhone: string): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    throw financialError('PHONE_REAUTH_REQUIRED', 'Confirme seu telefone novamente para continuar o saque.');
  }

  const token = authHeader.slice('Bearer '.length).trim();
  const decoded = await getAuth(app).verifyIdToken(token, true);
  if (decoded.uid !== userId) {
    throw financialError('PHONE_REAUTH_REQUIRED', 'A confirmação de telefone não pertence a esta conta.');
  }

  const provider = String(decoded.firebase?.sign_in_provider || '');
  const secondFactor = String(decoded.firebase?.sign_in_second_factor || '');
  const usedPhoneFactor = provider === 'phone' || secondFactor === 'phone';
  const authTime = Number(decoded.auth_time || 0);
  const ageSeconds = Math.floor(Date.now() / 1000) - authTime;
  if (!usedPhoneFactor || !Number.isFinite(ageSeconds) || ageSeconds < -30 || ageSeconds > PHONE_REAUTH_MAX_AGE_SECONDS) {
    throw financialError('PHONE_REAUTH_REQUIRED', 'Digite um novo código enviado ao seu telefone para autorizar este saque.');
  }

  let tokenPhone = '';
  try {
    tokenPhone = decoded.phone_number ? normalizeBrazilianPhone(decoded.phone_number) : '';
  } catch {
    tokenPhone = '';
  }
  if (!tokenPhone || tokenPhone !== expectedPhone) {
    throw financialError('PHONE_REAUTH_REQUIRED', 'O telefone usado na confirmação não corresponde ao telefone verificado da conta.');
  }
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
  const pixKeyType = String(body?.pixKeyType || '').trim() as 'cpf' | 'email' | 'phone' | 'random';

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
 * Invictus Coins continuam isolados e sem valor monetário. Quando
 * ENFORCE_IDENTITY_FOR_WITHDRAWAL === true, o saque exige e-mail + telefone
 * confirmados e uma reautenticação por telefone nova a cada solicitação
 * (atualmente desligado -- ver comentário #238 acima). CPF/Serpro fica fora
 * do gate por ora independentemente disso (ver identityReady()). Selfie/
 * biometria não participa do PIX.
 *
 * #saque-automatico (decisão do usuário em 18/09/2026): a solicitação que sai
 * com status 'pending' (passou no antifraude, score >=80) é enviada na hora
 * para o Asaas -- não existe mais aprovação manual nesse caminho. Só
 * 'under_review' (score <80, sinal de risco) continua parado esperando um
 * admin aprovar via /api/admin (process-withdrawal-payment), exatamente como
 * já funcionava antes. Se o disparo automático falhar (Asaas fora do ar,
 * etc.), WithdrawalEngine.processPayment já deixa o saque marcado para
 * conciliação (reconciliationRequired) em vez de perder o dinheiro reservado
 * -- o mesmo caminho de erro que a aprovação manual sempre teve.
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
          identityCheckEnabled: ENFORCE_IDENTITY_FOR_WITHDRAWAL,
          paymentEnvironment: isStrictAsaasSandbox() ? 'sandbox' : 'production',
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
    if (action !== 'request-withdrawal') {
      return res.status(400).json({ success: false, error: 'Ação financeira inválida.' });
    }

    const identity = await loadIdentity(auth.uid);
    if (ENFORCE_IDENTITY_FOR_WITHDRAWAL && !identityReady(identity)) {
      return res.status(403).json({
        success: false,
        code: 'IDENTITY_VERIFICATION_REQUIRED',
        error: 'Confirme seu e-mail e telefone antes de solicitar um saque.',
        identity: identityPayload(identity),
      });
    }

    if (ENFORCE_IDENTITY_FOR_WITHDRAWAL) {
      await requireFreshFirebasePhoneReauth(req, auth.uid, identity.phone);
    }
    const withdrawal = await validateWithdrawalInput(auth.uid, req.body);

    const suppliedRequestId = String(req.body?.requestId || '').trim();
    const requestId = /^[a-zA-Z0-9_-]{8,96}$/.test(suppliedRequestId)
      ? suppliedRequestId
      : `withdrawal_${randomUUID().replace(/-/g, '')}`;

    const commitResult = await WithdrawalEngine.requestWithdrawal({
      ...withdrawal,
      userId: auth.uid,
      requestId,
    });

    if (commitResult.status !== 'pending') {
      // 'under_review' (antifraude sinalizou risco) ou um saque idempotente
      // que já existia com outro status: nenhum dos dois dispara pagamento
      // automático. Continua exigindo aprovação manual como hoje.
      return res.status(201).json({
        success: true,
        status: commitResult.status,
        commitResult,
        userMessage: commitResult.status === 'under_review'
          ? 'Solicitação de saque criada e saldo reservado. Sua solicitação entrou em análise de segurança antes do envio para pagamento.'
          : 'Telefone confirmado. Solicitação de saque criada e saldo reservado para processamento do PIX.',
      });
    }

    try {
      const processed = await WithdrawalEngine.processPayment(commitResult.id, AUTO_WITHDRAWAL_REVIEWER_ID);
      await logEvent({
        severity: 'INFO',
        category: 'payment_logs',
        message: `Saque PIX ${processed.id} enviado automaticamente ao Asaas (transferId: ${(processed as any).providerTransferId}) logo após a solicitação, sem aprovação manual.`,
        userId: processed.userId,
        route: '/api/financial',
        details: { withdrawalId: processed.id, amount: processed.amount, providerTransferId: (processed as any).providerTransferId, providerStatus: (processed as any).providerStatus },
      });
      return res.status(201).json({
        success: true,
        status: processed.status,
        commitResult: processed,
        userMessage: 'Telefone confirmado. Solicitação de saque criada e enviada automaticamente para pagamento via PIX.',
      });
    } catch (autoProcessError: any) {
      // A reserva de saldo e a solicitação já foram criadas com sucesso; só o
      // disparo automático para o Asaas falhou (rede, provedor fora do ar,
      // etc.). Não derrubamos a resposta -- processPayment já deixou o saque
      // marcado para conciliação, e o suporte/admin resolve manualmente a
      // partir daí, igual sempre foi tratado nesse caminho de erro.
      console.error('[Financial Prize Wallet] Falha ao disparar pagamento automático no Asaas:', autoProcessError?.message || autoProcessError);
      await logEvent({
        severity: 'WARNING',
        category: 'payment_logs',
        message: `Falha ao enviar automaticamente o saque PIX ${commitResult.id} ao Asaas: ${autoProcessError?.message || autoProcessError}`,
        userId: auth.uid,
        route: '/api/financial',
        details: { withdrawalId: commitResult.id, amount: commitResult.amount },
      }).catch(() => {});
      return res.status(201).json({
        success: true,
        status: commitResult.status,
        commitResult,
        userMessage: 'Telefone confirmado. Solicitação de saque criada e saldo reservado. O envio automático para pagamento está sendo confirmado; se demorar, nossa equipe finaliza manualmente.',
      });
    }
  } catch (error: any) {
    console.error('[Financial Prize Wallet] Error:', error?.message || error);
    if (error?.code === 'PHONE_REAUTH_REQUIRED') {
      return res.status(403).json({ success: false, code: 'PHONE_REAUTH_REQUIRED', error: error.message });
    }
    const message = error?.message || 'Não foi possível carregar ou processar a carteira de premiações.';
    const status = /mínimo|limite|saldo|chave PIX|valor de saque|desativados|Identificador da requisição/i.test(message) ? 400 : 500;
    return res.status(status).json({ success: false, error: message });
  }
}
