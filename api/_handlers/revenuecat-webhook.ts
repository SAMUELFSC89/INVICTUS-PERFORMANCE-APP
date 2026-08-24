import { VercelRequest, VercelResponse } from '@vercel/node';
import { timingSafeEqual } from 'crypto';
import { db, cors } from '../_lib/common.js';
import { grantProAccessAfterApprovedPayment, revokeProAccess } from '../_lib/payments-service.js';

/**
 * Webhook da RevenueCat: recebe eventos de ciclo de vida da assinatura do Plano
 * Performance (renovação, cancelamento de auto-renovação, expiração, problema de
 * cobrança) e mantém o Firestore sincronizado automaticamente, mesmo com o app fechado.
 *
 * Configurar em: RevenueCat Dashboard > Project Settings > Integrations > Webhooks
 *   URL: https://<seu-dominio>/api/payments/revenuecat-webhook
 *   Authorization header value: Bearer <REVENUECAT_WEBHOOK_AUTH_TOKEN>
 * O mesmo valor de REVENUECAT_WEBHOOK_AUTH_TOKEN deve ser configurado como variável
 * de ambiente no Vercel (gere uma string aleatória longa, é só um segredo compartilhado).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido.' });
  }

  // Autenticação do webhook: a RevenueCat envia o header Authorization com o valor
  // configurado no dashboard. Nunca processamos eventos sem essa validação.
  const expectedToken = process.env.REVENUECAT_WEBHOOK_AUTH_TOKEN?.trim();
  const authorization = req.headers['authorization'];
  const authHeader = Array.isArray(authorization) ? authorization[0] : authorization;
  const receivedToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const tokenMatches = Boolean(expectedToken)
    && receivedToken.length === expectedToken!.length
    && timingSafeEqual(Buffer.from(receivedToken), Buffer.from(expectedToken!));
  if (!tokenMatches) {
    console.warn('[RevenueCat Webhook] Requisição rejeitada: token de autorização inválido ou ausente.');
    return res.status(401).json({ error: 'Não autorizado.' });
  }

  try {
    const event = req.body?.event;
    if (!event) {
      return res.status(400).json({ error: 'Payload de evento ausente.' });
    }

    const eventType = event.type as string;
    const firebaseUid = event.app_user_id as string;
    const entitlementIds = (event.entitlement_ids || []) as string[];

    console.log(`[RevenueCat Webhook] Evento recebido: ${eventType} para usuário ${firebaseUid}`);

    // Só nos importamos com a entitlement "performance" — o Plano Open não usa loja.
    if (!entitlementIds.includes('performance')) {
      return res.status(200).json({ received: true, ignored: true, reason: 'Evento não relacionado à entitlement performance.' });
    }

    const orderId = `order_performance_${firebaseUid}`;
    const paymentId = event.id ? String(event.id) : `rc_${eventType}_${Date.now()}`;

    switch (eventType) {
      // Compra inicial, renovação automática, reativação de auto-renovação ou troca
      // de produto (upgrade/downgrade) — em todos esses casos o usuário deve manter
      // ou recuperar o acesso Performance.
      case 'INITIAL_PURCHASE':
      case 'RENEWAL':
      case 'UNCANCELLATION':
      case 'PRODUCT_CHANGE': {
        const orderRef = db.collection('payment_orders').doc(orderId);
        const orderSnap = await orderRef.get();
        const now = new Date();
        const platform = event.store === 'PLAY_STORE' ? 'android' : event.store === 'APP_STORE' ? 'ios' : 'android';

        if (!orderSnap.exists) {
          await orderRef.set({
            orderId,
            userId: firebaseUid,
            planId: 'invictus_performance',
            amount: 49.90,
            currency: 'BRL',
            status: 'pending',
            provider: 'revenuecat',
            purchaseToken: paymentId,
            transactionId: paymentId,
            platform,
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
          });
        } else {
          // Reabre o pedido para que grantProAccessAfterApprovedPayment não pule a
          // renovação (a função ignora pedidos que já estão com status "approved").
          await orderRef.update({ status: 'pending', updatedAt: now.toISOString() });
        }

        const result = await grantProAccessAfterApprovedPayment(orderId, paymentId, 'revenuecat_webhook');
        console.log(`[RevenueCat Webhook] Acesso Performance concedido/renovado para ${firebaseUid}`, result);
        break;
      }

      // A assinatura de fato expirou (o usuário perdeu o acesso na loja). Diferente de
      // CANCELLATION (que só desliga a auto-renovação, mas mantém acesso até o fim do
      // período já pago), aqui é seguro revogar imediatamente.
      case 'EXPIRATION': {
        const orderRef = db.collection('payment_orders').doc(orderId);
        const orderSnap = await orderRef.get();

        if (!orderSnap.exists) {
          console.warn(`[RevenueCat Webhook] Nenhum pedido encontrado para revogar (${orderId}). Ignorando.`);
          break;
        }

        await revokeProAccess(orderId, paymentId, 'expired', 'revenuecat_webhook', 'Assinatura expirada na loja (evento EXPIRATION da RevenueCat).');
        console.log(`[RevenueCat Webhook] Acesso Performance revogado para ${firebaseUid} (expiração)`);
        break;
      }

      // CANCELLATION: usuário desligou a auto-renovação, mas ainda tem acesso até o
      // fim do período vigente (a EXPIRATION chegará depois, se ele não reativar).
      // BILLING_ISSUE: falha temporária de cobrança; a loja tenta novamente sozinha.
      // Em ambos os casos apenas registramos, sem revogar acesso na hora.
      case 'CANCELLATION':
      case 'BILLING_ISSUE':
        console.log(`[RevenueCat Webhook] Evento ${eventType} registrado para ${firebaseUid}. Acesso mantido até expiração real.`);
        break;

      default:
        console.log(`[RevenueCat Webhook] Evento ${eventType} recebido mas não requer ação.`);
    }

    return res.status(200).json({ received: true });
  } catch (error: any) {
    console.error('[RevenueCat Webhook Error]', error);
    return res.status(500).json({ error: 'Erro interno ao processar webhook da RevenueCat.' });
  }
}
