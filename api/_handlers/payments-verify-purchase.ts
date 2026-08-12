import { VercelRequest, VercelResponse } from '@vercel/node';
import { db, cors, verifyAuth } from '../_lib/common.js';
import { grantProAccessAfterApprovedPayment, revokeProAccess, logPaymentAudit } from '../_lib/payments-service.js';

// URL base da API REST da RevenueCat (usada para checar assinaturas reais do Plano Performance).
const REVENUECAT_API_URL = 'https://api.revenuecat.com/v1';

interface RevenueCatEntitlement {
  expires_date: string | null;
  product_identifier: string;
  purchase_date: string;
}

interface RevenueCatSubscriberResponse {
  subscriber?: {
    entitlements?: Record<string, RevenueCatEntitlement>;
  };
}

/**
 * Verifica no backend da RevenueCat (fonte da verdade, nunca no cliente) se o usuário
 * possui a entitlement "performance" ativa. Isso substitui a validação simulada anterior,
 * que confiava cegamente em um campo "scenario" enviado pelo próprio app.
 */
async function checkPerformanceEntitlementActive(firebaseUid: string): Promise<{ active: boolean; raw: RevenueCatSubscriberResponse | null; error?: string }> {
  const secretKey = process.env.REVENUECAT_SECRET_API_KEY;
  if (!secretKey) {
    return { active: false, raw: null, error: 'REVENUECAT_SECRET_API_KEY não configurada no servidor.' };
  }

  const response = await fetch(`${REVENUECAT_API_URL}/subscribers/${encodeURIComponent(firebaseUid)}`, {
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    if (response.status === 404) {
      // Usuário ainda não tem nenhum registro na RevenueCat (nunca comprou).
      return { active: false, raw: null };
    }
    const text = await response.text().catch(() => '');
    return { active: false, raw: null, error: `RevenueCat respondeu ${response.status}: ${text}` };
  }

  const data = (await response.json()) as RevenueCatSubscriberResponse;
  const entitlement = data.subscriber?.entitlements?.performance;

  if (!entitlement) {
    return { active: false, raw: data };
  }

  const isActive = !entitlement.expires_date || new Date(entitlement.expires_date).getTime() > Date.now();
  return { active: isActive, raw: data };
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

  const { planId, platform } = req.body;

  if (!planId || !platform) {
    return res.status(400).json({ error: 'Parâmetros obrigatórios ausentes: planId e platform são necessários.' });
  }

  if (planId !== 'invictus_open' && planId !== 'invictus_performance') {
    return res.status(400).json({ error: 'Plano inválido especificado.' });
  }

  if (platform !== 'android' && platform !== 'ios') {
    return res.status(400).json({ error: 'Plataforma inválida especificada.' });
  }

  const tokenOrTxId = `${planId}_${authUser.uid}_${Date.now()}`;
  const orderId = `order_${platform}_${tokenOrTxId.substring(0, 40)}`;

  try {
    const now = new Date();
    const amount = planId === 'invictus_performance' ? 49.90 : 0;

    // Create the payment order record
    const orderDoc = {
      orderId,
      userId: authUser.uid,
      planId,
      amount,
      currency: 'BRL',
      status: 'pending',
      provider: platform,
      purchaseToken: tokenOrTxId,
      transactionId: tokenOrTxId,
      platform,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };

    await db.collection('payment_orders').doc(orderId).set(orderDoc);

    await logPaymentAudit({
      userId: authUser.uid,
      orderId,
      paymentId: tokenOrTxId,
      previousStatus: 'none',
      newStatus: 'pending',
      eventSource: `store_${platform}`,
      action: 'checkout_created',
      reason: planId === 'invictus_open'
        ? 'Ativação do Plano Open gratuito solicitada.'
        : `Verificação de assinatura do Plano Performance solicitada (${platform === 'android' ? 'Google Play' : 'App Store'}).`
    });

    // 2. PLANO OPEN: gratuito, liberação imediata, sem loja envolvida.
    if (planId === 'invictus_open') {
      const result = await grantProAccessAfterApprovedPayment(orderId, tokenOrTxId, `store_${platform}`);

      return res.status(200).json({
        success: true,
        status: 'approved',
        orderId,
        message: 'Plano Open ativado com sucesso!',
        details: result
      });
    }

    // 3. PLANO PERFORMANCE: validação real e obrigatória contra a RevenueCat.
    // Nunca confiamos em nenhum dado enviado pelo cliente aqui — a fonte da verdade
    // é a assinatura ativa reportada pela RevenueCat para este usuário.
    const verification = await checkPerformanceEntitlementActive(authUser.uid);

    if (verification.error) {
      console.error('[Store Verification] Erro ao consultar RevenueCat:', verification.error);
      await db.collection('payment_orders').doc(orderId).update({ status: 'error', updatedAt: new Date().toISOString() });
      return res.status(502).json({ error: 'Não foi possível confirmar a assinatura com a loja no momento. Tente novamente em instantes.' });
    }

    if (!verification.active) {
      await db.collection('payment_orders').doc(orderId).update({ status: 'rejected', updatedAt: new Date().toISOString() });

      await logPaymentAudit({
        userId: authUser.uid,
        orderId,
        paymentId: tokenOrTxId,
        previousStatus: 'pending',
        newStatus: 'rejected',
        eventSource: `store_${platform}`,
        action: 'payment_rejected',
        reason: 'Nenhuma assinatura ativa do Plano Performance foi encontrada na RevenueCat para este usuário.'
      });

      return res.status(402).json({
        error: 'Nenhuma assinatura ativa do Plano Performance foi encontrada. Finalize a compra na loja antes de tentar novamente.'
      });
    }

    console.log(`[Store Verification] Assinatura Performance confirmada via RevenueCat para ${authUser.uid}`);
    const result = await grantProAccessAfterApprovedPayment(orderId, tokenOrTxId, `store_${platform}`);

    return res.status(200).json({
      success: true,
      status: 'approved',
      orderId,
      message: 'Assinatura do Plano Performance confirmada e ativada com sucesso!',
      details: result
    });

  } catch (error: any) {
    console.error('[Store Verification Error]', error);
    return res.status(500).json({
      error: 'Erro interno ao validar compra nas lojas oficiais de aplicativos.',
      details: error.message
    });
  }
}
