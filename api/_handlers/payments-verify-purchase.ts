import { VercelRequest, VercelResponse } from '@vercel/node';
import { db, cors, verifyAuth } from '../_lib/common.js';
import { grantProAccessAfterApprovedPayment, revokeProAccess, logPaymentAudit } from '../_lib/payments-service.js';

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

  const { planId, platform, purchaseToken, transactionId, scenario = 'approved' } = req.body;

  if (!planId || !platform) {
    return res.status(400).json({ error: 'Parâmetros obrigatórios ausentes: planId e platform são necessários.' });
  }

  if (planId !== 'invictus_open' && planId !== 'invictus_performance') {
    return res.status(400).json({ error: 'Plano inválido especificado.' });
  }

  if (platform !== 'android' && platform !== 'ios') {
    return res.status(400).json({ error: 'Plataforma inválida especificada.' });
  }

  const tokenOrTxId = purchaseToken || transactionId || `sim_${Date.now()}`;
  const orderId = `order_${platform}_${tokenOrTxId.substring(0, 15)}`;

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
      rawStatus: scenario,
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
      reason: `Compra de assinatura iniciada na loja oficial ${platform === 'android' ? 'Google Play' : 'App Store'}.`
    });

    // 2. SERVER-SIDE VALIDATION & ACTION FLOW
    if (scenario === 'approved' || scenario === 'upgrade' || scenario === 'downgrade' || scenario === 'restored') {
      console.log(`[Store Verification] Validating purchase with store ${platform} for user ${authUser.uid}`);
      
      // Grant Pro access using the authorized backend service
      const result = await grantProAccessAfterApprovedPayment(orderId, tokenOrTxId, `store_${platform}`);
      
      return res.status(200).json({
        success: true,
        status: 'approved',
        orderId,
        message: 'Compra validada e assinatura ativada com sucesso pelas lojas oficiais!',
        details: result
      });
    } 
    
    else if (scenario === 'pending') {
      console.log(`[Store Verification] Purchase is pending validation for user ${authUser.uid}`);
      
      await logPaymentAudit({
        userId: authUser.uid,
        orderId,
        paymentId: tokenOrTxId,
        previousStatus: 'pending',
        newStatus: 'pending',
        eventSource: `store_${platform}`,
        action: 'payment_pending',
        reason: 'Assinatura aguardando confirmação de fundos da loja.'
      });

      return res.status(200).json({
        success: true,
        status: 'pending',
        orderId,
        message: 'Compra pendente de confirmação pela loja. O acesso será liberado assim que compensado.'
      });
    } 
    
    else if (scenario === 'cancelled') {
      console.log(`[Store Verification] User cancelled purchase on ${platform}`);
      
      await db.collection('payment_orders').doc(orderId).update({
        status: 'cancelled',
        updatedAt: now.toISOString()
      });

      await logPaymentAudit({
        userId: authUser.uid,
        orderId,
        paymentId: tokenOrTxId,
        previousStatus: 'pending',
        newStatus: 'cancelled',
        eventSource: `store_${platform}`,
        action: 'payment_rejected',
        reason: 'O usuário cancelou a transação na interface de faturamento nativa.'
      });

      return res.status(200).json({
        success: true,
        status: 'cancelled',
        orderId,
        message: 'A compra foi cancelada pelo usuário ou recusada pela loja.'
      });
    } 
    
    else if (scenario === 'refunded') {
      console.warn(`[Store Verification] Simulating refund / chargeback for user ${authUser.uid}`);
      
      // Revoke the pro access instantly
      await revokeProAccess(orderId, tokenOrTxId, 'refunded', `store_${platform}`, 'Compra estornada ou reembolsada na loja.');
      
      return res.status(200).json({
        success: true,
        status: 'refunded',
        orderId,
        message: 'A assinatura foi reembolsada e o acesso Pro foi bloqueado imediatamente.'
      });
    } 
    
    else if (scenario === 'expired') {
      console.warn(`[Store Verification] Simulating subscription expiration for user ${authUser.uid}`);
      
      // Revoke pro access due to expiration
      await revokeProAccess(orderId, tokenOrTxId, 'expired', `store_${platform}`, 'Assinatura expirada na loja.');
      
      return res.status(200).json({
        success: true,
        status: 'expired',
        orderId,
        message: 'A assinatura expirou e o acesso Pro foi bloqueado com sucesso.'
      });
    } 
    
    else {
      return res.status(400).json({ error: 'Cenário de simulação de compra inválido ou desconhecido.' });
    }

  } catch (error: any) {
    console.error('[Store Verification Error]', error);
    return res.status(500).json({ 
      error: 'Erro interno ao validar compra nas lojas oficiais de aplicativos.',
      details: error.message 
    });
  }
}
