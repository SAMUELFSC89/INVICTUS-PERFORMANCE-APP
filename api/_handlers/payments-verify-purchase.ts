import { VercelRequest, VercelResponse } from '@vercel/node';
import { db, cors, verifyAuth } from '../_lib/common.js';
import { isProUser } from '../_lib/entitlement.js';
import {
  activateOpenPlan,
  BillingUserUnavailableError,
  fetchRevenueCatPerformanceEntitlement,
  grantProAccessAfterApprovedPayment,
  isBillingUserProfileAvailable,
  isBillingUserUnavailableError,
  isRevenueCatEnvironmentAllowed,
  logPaymentAudit,
  revokeProAccess,
  type VerifiedPerformanceEntitlement,
} from '../_lib/payments-service.js';

const INACTIVE_ENTITLEMENT_MESSAGE = 'Nenhuma assinatura ativa do Plano Performance foi encontrada. Finalize a compra na loja antes de tentar novamente.';

async function preparePaymentOrder(
  orderId: string,
  userId: string,
  planId: 'invictus_open' | 'invictus_performance',
  platform: string,
  tokenOrTxId: string,
  requestedProductId: unknown,
  packageIdentifier: unknown,
  nowIso: string,
) {
  const orderRef = db.collection('payment_orders').doc(orderId);
  const userRef = db.collection('users').doc(userId);
  await db.runTransaction(async (transaction: any) => {
    const [userSnap, orderSnap] = await Promise.all([
      transaction.get(userRef),
      transaction.get(orderRef),
    ]);
    const userData = userSnap.exists ? userSnap.data() : null;
    if (!userSnap.exists || !isBillingUserProfileAvailable(userData)) {
      throw new BillingUserUnavailableError(userId);
    }

    const requestMetadata: Record<string, unknown> = {
      requestedProductId: typeof requestedProductId === 'string' ? requestedProductId : null,
      requestedPackageIdentifier: typeof packageIdentifier === 'string' ? packageIdentifier : null,
      verificationRequestedAt: nowIso,
      updatedAt: nowIso,
    };
    if (orderSnap.exists) {
      const current = orderSnap.data();
      if (current?.userId !== userId || current?.planId !== planId) {
        throw new Error(`Pedido ${orderId} pertence a outro usuário ou plano.`);
      }
      // Metadados de uma nova tentativa são seguros; estados financeiros e de
      // provisionamento nunca voltam a pending por uma leitura concorrente.
      transaction.set(orderRef, requestMetadata, { merge: true });
      return;
    }

    transaction.set(orderRef, {
      orderId,
      userId,
      planId,
      provider: planId === 'invictus_performance' ? 'revenuecat' : 'internal',
      platform,
      amount: planId === 'invictus_open' ? 0 : null,
      currency: planId === 'invictus_open' ? 'BRL' : null,
      status: 'pending',
      paymentStatus: 'pending',
      provisionStatus: 'pending',
      purchaseToken: planId === 'invictus_open' ? tokenOrTxId : null,
      transactionId: planId === 'invictus_open' ? tokenOrTxId : null,
      createdAt: nowIso,
      ...requestMetadata,
    });
  });
  return orderRef;
}

async function readCanonicalPurchaseState(userId: string, orderId: string) {
  const [userSnap, orderSnap] = await Promise.all([
    db.collection('users').doc(userId).get(),
    db.collection('payment_orders').doc(orderId).get(),
  ]);
  const userData = userSnap.exists ? userSnap.data() : null;
  const orderData = orderSnap.exists ? orderSnap.data() || {} : {};
  const accessGranted = Boolean(
    userSnap.exists
      && isBillingUserProfileAvailable(userData)
      && isProUser(userData)
  );
  const entitlement = userData?.proEntitlement || {};
  return {
    accessGranted,
    status: accessGranted ? 'approved' : orderData.paymentStatus || orderData.status || 'rejected',
    paymentStatus: accessGranted ? 'approved' : orderData.paymentStatus || orderData.status || 'rejected',
    provisionStatus: accessGranted ? 'applied' : orderData.provisionStatus || 'revoked',
    entitlementStatus: typeof entitlement.status === 'string' ? entitlement.status : 'inactive',
    productId: typeof entitlement.productId === 'string' ? entitlement.productId : null,
    expiresAt: entitlement.expiresAt || null,
  };
}

function inactiveResponsePayload(entitlementStatus: string) {
  return {
    error: INACTIVE_ENTITLEMENT_MESSAGE,
    code: 'PERFORMANCE_ENTITLEMENT_INACTIVE',
    entitlementStatus,
    retryable: entitlementStatus === 'inactive',
    accessGranted: false,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido.' });
  }

  // 1. Verify User Session
  const authUser = await verifyAuth(req);
  if (!authUser) {
    return res.status(401).json({ error: 'Sessão expirada ou inválida. Conecte-se novamente.' });
  }

  const { planId, platform, productId: requestedProductId, packageIdentifier } = req.body || {};

  if (!planId) {
    return res.status(400).json({ error: 'Parâmetro obrigatório ausente: planId.' });
  }

  if (planId !== 'invictus_open' && planId !== 'invictus_performance') {
    return res.status(400).json({ error: 'Plano inválido especificado.' });
  }

  if (planId === 'invictus_performance' && platform !== 'android' && platform !== 'ios') {
    return res.status(400).json({ error: 'Plataforma inválida especificada.' });
  }

  const effectivePlatform = planId === 'invictus_open' ? 'internal' : platform;
  const tokenOrTxId = `${planId}_${authUser.uid}_${Date.now()}`;
  // Pedidos do Plano Performance usam um orderId determinístico (um único pedido "vivo"
  // por usuário) para que o webhook da RevenueCat consiga localizar e renovar o mesmo
  // registro em cada ciclo de cobrança. O Plano Open, por ser gratuito e sem ciclo de
  // renovação, mantém um orderId novo a cada ativação.
  const orderId = planId === 'invictus_performance'
    ? `order_performance_${authUser.uid}`
    : `order_open_${authUser.uid}_${Date.now()}`;

  try {
    const nowIso = new Date().toISOString();
    const orderRef = await preparePaymentOrder(
      orderId,
      authUser.uid,
      planId,
      effectivePlatform,
      tokenOrTxId,
      requestedProductId,
      packageIdentifier,
      nowIso,
    );

    await logPaymentAudit({
      userId: authUser.uid,
      orderId,
      paymentId: tokenOrTxId,
      previousStatus: 'none',
      newStatus: 'pending',
      eventSource: planId === 'invictus_open' ? 'open_activation' : `store_${platform}`,
      action: 'checkout_created',
      reason: planId === 'invictus_open'
        ? 'Ativação do Plano Open gratuito solicitada.'
        : `Verificação de assinatura do Plano Performance solicitada (${platform === 'android' ? 'Google Play' : 'App Store'}).`
    });

    // 2. PLANO OPEN: gratuito, liberação imediata, sem loja envolvida.
    if (planId === 'invictus_open') {
      const result = await activateOpenPlan(orderId, tokenOrTxId, 'open_activation');

      return res.status(200).json({
        success: true,
        status: 'approved',
        paymentStatus: 'approved',
        provisionStatus: 'applied',
        accessGranted: true,
        orderId,
        message: 'Plano Open ativado com sucesso!',
        details: result
      });
    }

    // 3. PLANO PERFORMANCE: validação real e obrigatória contra a RevenueCat.
    // Nunca confiamos em nenhum dado enviado pelo cliente aqui — a fonte da verdade
    // é a assinatura ativa reportada pela RevenueCat para este usuário.
    let entitlement: VerifiedPerformanceEntitlement;
    try {
      entitlement = await fetchRevenueCatPerformanceEntitlement(authUser.uid);
    } catch (verificationError: any) {
      console.error('[Store Verification] Erro ao consultar RevenueCat:', verificationError);
      await orderRef.set({
        verificationStatus: 'retryable_error',
        verificationError: 'RevenueCat temporariamente indisponível.',
        updatedAt: new Date().toISOString(),
      }, { merge: true });
      return res.status(502).json({ error: 'Não foi possível confirmar a assinatura com a loja no momento. Tente novamente em instantes.' });
    }

    // Defesa em profundidade: um produto encontrado em ambiente não permitido
    // não concede nem revoga o estado canônico de produção.
    if (entitlement.productId && !isRevenueCatEnvironmentAllowed(entitlement.environment)) {
      await orderRef.set({
        verificationStatus: 'environment_not_allowed',
        verifiedEnvironment: entitlement.environment,
        updatedAt: new Date().toISOString(),
      }, { merge: true });
      return res.status(402).json({
        ...inactiveResponsePayload('inactive'),
        orderId,
      });
    }

    if (typeof requestedProductId === 'string' && requestedProductId && entitlement.productId && requestedProductId !== entitlement.productId) {
      await orderRef.set({
        verificationStatus: 'product_mismatch',
        verifiedProductId: entitlement.productId,
        updatedAt: new Date().toISOString(),
      }, { merge: true });
      return res.status(409).json({ error: 'O produto confirmado pela loja não corresponde ao pacote selecionado. Atualize as ofertas e tente novamente.' });
    }

    const paymentId = entitlement.transactionId || `rc_verify_${authUser.uid}_${Date.parse(entitlement.providerObservedAt)}`;

    if (!entitlement.active) {
      const rejectedStatus = entitlement.status === 'refunded'
        ? 'refunded'
        : entitlement.status === 'expired' ? 'expired' : 'rejected';
      const revokeResult = await revokeProAccess(
        orderId,
        paymentId,
        rejectedStatus,
        `store_${platform}`,
        'A consulta atual da RevenueCat não contém entitlement Performance vigente.',
        { entitlement }
      );

      if (revokeResult.stale) {
        const current = await readCanonicalPurchaseState(authUser.uid, orderId);
        if (current.accessGranted) {
          return res.status(200).json({
            success: true,
            ...current,
            orderId,
            message: 'A assinatura Performance já está ativa com base no estado mais recente processado.',
          });
        }
        return res.status(402).json({
          ...inactiveResponsePayload(current.entitlementStatus),
          status: current.status,
          paymentStatus: current.paymentStatus,
          provisionStatus: current.provisionStatus,
          orderId,
        });
      }

      await logPaymentAudit({
        userId: authUser.uid,
        orderId,
        paymentId,
        previousStatus: 'pending',
        newStatus: rejectedStatus,
        eventSource: `store_${platform}`,
        action: 'payment_rejected',
        reason: 'Nenhuma assinatura ativa do Plano Performance foi encontrada na RevenueCat para este usuário.'
      });

      return res.status(402).json({
        ...inactiveResponsePayload(entitlement.status),
        orderId,
      });
    }

    console.log(`[Store Verification] Assinatura Performance confirmada via RevenueCat para ${authUser.uid}`);
    const result = await grantProAccessAfterApprovedPayment(
      orderId,
      paymentId,
      `store_${platform}`,
      { entitlement }
    );

    if (result.stale) {
      const current = await readCanonicalPurchaseState(authUser.uid, orderId);
      if (current.accessGranted) {
        return res.status(200).json({
          success: true,
          ...current,
          orderId,
          message: 'A assinatura Performance já está ativa com base no estado mais recente processado.',
        });
      }
      return res.status(402).json({
        ...inactiveResponsePayload(current.entitlementStatus),
        status: current.status,
        paymentStatus: current.paymentStatus,
        provisionStatus: current.provisionStatus,
        orderId,
      });
    }

    return res.status(200).json({
      success: true,
      status: 'approved',
      paymentStatus: 'approved',
      provisionStatus: 'applied',
      accessGranted: true,
      orderId,
      productId: entitlement.productId,
      expiresAt: entitlement.expiresAt,
      message: 'Assinatura do Plano Performance confirmada e ativada com sucesso!',
      details: result
    });

  } catch (error: any) {
    console.error('[Store Verification Error]', error);
    if (isBillingUserUnavailableError(error)) {
      return res.status(409).json({
        error: 'O perfil autenticado não está disponível para aplicar alterações de assinatura.',
        code: 'BILLING_USER_UNAVAILABLE',
      });
    }
    return res.status(500).json({
      error: 'Erro interno ao validar compra nas lojas oficiais de aplicativos.',
      details: error.message
    });
  }
}
