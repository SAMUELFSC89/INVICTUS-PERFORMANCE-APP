import { VercelRequest, VercelResponse } from '@vercel/node';
import { db, cors, verifyAuth } from '../_lib/common.js';

const STATUS_MESSAGES: Record<string, string> = {
  'approved': 'Pagamento aprovado. Seu acesso ao Invictus foi liberado.',
  'pending': 'Seu pagamento está sendo processado. Assim que for aprovado, seu acesso será liberado.',
  'processing': 'Seu pagamento está sendo processado. Assim que for aprovado, seu acesso será liberado.',
  'rejected': 'Não foi possível aprovar o pagamento. Tente novamente com outro método.',
  'cancelled': 'Não foi possível aprovar o pagamento. Tente novamente com outro método.',
  'refunded': 'O pagamento da assinatura foi estornado.',
  'charged_back': 'O pagamento sofreu chargeback e sua conta está sob revisão.'
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método não permitido.' });
  }

  // 1. Verify Authentication
  const authUser = await verifyAuth(req);
  if (!authUser) {
    return res.status(401).json({ error: 'Sessão expirada. Faça login novamente.' });
  }

  const orderId = (req.query.orderId || (req as any).params?.orderId) as string;

  if (!orderId) {
    return res.status(400).json({ error: 'Identificador do pedido (orderId) ausente.' });
  }

  try {
    // 2. Fetch the order details from Firestore
    console.log(`[Payments Status] Fetching status for orderId: ${orderId}`);
    const orderSnap = await db.collection('payment_orders').doc(orderId).get();

    if (!orderSnap.exists) {
      return res.status(404).json({ error: 'Pedido não encontrado.' });
    }

    const orderData = orderSnap.data();
    if (!orderData) {
      return res.status(404).json({ error: 'Os dados do pedido estão vazios.' });
    }

    // 3. Security Check: prevent reading other user's orders
    if (orderData.userId !== authUser.uid) {
      console.warn(`[Payments Status Block] User ${authUser.uid} tried to read order of user ${orderData.userId}`);
      return res.status(403).json({ error: 'Operação proibida: este pedido pertence a outro usuário.' });
    }

    let status = orderData.status || 'pending';

    const message = STATUS_MESSAGES[status] || 'Status do pagamento desconhecido.';

    return res.status(200).json({
      success: true,
      orderId: orderId,
      planId: orderData.planId,
      amount: orderData.amount,
      status,
      message,
      paidAt: orderData.paidAt || null,
      updatedAt: orderData.updatedAt || null
    });

  } catch (error: any) {
    console.error('[Payments Status Error]', error);
    return res.status(500).json({ error: 'Não foi possível buscar o status do pagamento agora.' });
  }
}
