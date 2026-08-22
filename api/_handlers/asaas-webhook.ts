import { VercelRequest, VercelResponse } from '@vercel/node';
import { cors } from '../_lib/common.js';
import { WithdrawalEngine } from '../_lib/withdrawal-engine.js';
import { confirmarInscricaoPorPagamento } from '../_lib/inscricao-service.js';

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

    // ------------------------------------------------------------------
    // ENTRADA DE DINHEIRO: pagamento de inscrição na temporada.
    // O Asaas envia eventos PAYMENT_* para cobranças e TRANSFER_* para
    // transferências. Antes este webhook só entendia o segundo grupo.
    // ------------------------------------------------------------------
    const payment = req.body?.payment;
    if (event && payment && payment.id) {
      const confirmado = event === 'PAYMENT_RECEIVED' || event === 'PAYMENT_CONFIRMED';

      console.log('[Asaas Webhook] Evento de cobrança: ' + event + ' para pagamento ' + payment.id + ' (status: ' + payment.status + ')');

      if (confirmado) {
        const resultado = await confirmarInscricaoPorPagamento(payment.id, payment.value);
        return res.status(200).json({ received: true, inscricao: resultado });
      }

      // Outros eventos de cobrança (vencida, estornada) não mudam inscrição
      // paga -- ficam registrados no log para investigação.
      return res.status(200).json({ received: true, ignorado: event });
    }

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
