import { VercelRequest, VercelResponse } from '@vercel/node';
import { cors } from '../_lib/common.js';
import { WithdrawalEngine } from '../_lib/withdrawal-engine.js';

/**
 * Webhook do Asaas: recebe eventos de transferência PIX (TRANSFER_DONE,
 * TRANSFER_FAILED, TRANSFER_CANCELLED etc.) e mantém o status real do saque
 * sincronizado no Firestore, incluindo o estorno automático em caso de falha.
 *
 * Configurar em: Asaas > Integrações > Webhooks
 * URL: https://<seu-dominio>/api/payments/asaas-webhook
 * Token de acesso (header asaas-access-token): mesmo valor de ASAAS_WEBHOOK_TOKEN
 * configurado como variável de ambiente no Vercel (gere uma string aleatória longa).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido.' });
  }

  const expectedToken = process.env.ASAAS_WEBHOOK_TOKEN;
  const receivedToken = req.headers['asaas-access-token'];
  if (expectedToken && receivedToken !== expectedToken) {
    console.warn('[Asaas Webhook] Requisição rejeitada: token de acesso inválido ou ausente.');
    return res.status(401).json({ error: 'Não autorizado.' });
  }

  try {
    const event = req.body?.event as string;
    const transfer = req.body?.transfer;

    if (!event || !transfer || !transfer.id) {
      return res.status(400).json({ error: 'Payload de evento de transferência ausente.' });
    }

    console.log('[Asaas Webhook] Evento recebido: ' + event + ' para transferência ' + transfer.id + ' (status: ' + transfer.status + ')');

    await WithdrawalEngine.handleAsaasTransferWebhook(
      transfer.id,
      event,
      transfer.status,
      transfer.failReason
    );

    return res.status(200).json({ received: true });
  } catch (error: any) {
    console.error('[Asaas Webhook Error]', error);
    return res.status(500).json({ error: 'Erro interno ao processar webhook do Asaas.', details: error.message });
  }
}
