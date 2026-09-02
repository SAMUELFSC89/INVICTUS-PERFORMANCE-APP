import { VercelRequest, VercelResponse } from '@vercel/node';
import { timingSafeEqual } from 'crypto';
import { cors } from '../_lib/common.js';
import { WithdrawalEngine } from '../_lib/withdrawal-engine.js';
import { confirmarInscricaoPorPagamento } from '../_lib/inscricao-service.js';
import {
  confirmarInscricaoChampionshipPorPagamento,
  marcarInscricaoChampionshipComoReembolsada,
} from '../_lib/championship-inscription-service.js';
import { StoreEngine } from '../_lib/store-engine.js';

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

  const expectedToken = process.env.ASAAS_WEBHOOK_TOKEN?.trim();
  const headerToken = req.headers['asaas-access-token'];
  const receivedToken = Array.isArray(headerToken) ? headerToken[0] : headerToken;

  // Webhooks financeiros devem falhar fechados: sem segredo configurado, não
  // existe origem confiável para confirmar pagamentos ou movimentar saques.
  if (!expectedToken) {
    console.error('[Asaas Webhook] ASAAS_WEBHOOK_TOKEN ausente; evento recusado por segurança.');
    return res.status(503).json({ error: 'Webhook temporariamente indisponível.' });
  }

  const tokenMatches = typeof receivedToken === 'string'
    && receivedToken.length === expectedToken.length
    && timingSafeEqual(Buffer.from(receivedToken), Buffer.from(expectedToken));

  if (!tokenMatches) {
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

      // A loja física também usa o Asaas. O pedido é localizado pela referência
      // do pagamento antes de tentar interpretar o evento como inscrição.
      const resultadoLoja = await StoreEngine.handleStorePaymentWebhook(payment.id, event, payment.value);
      if (resultadoLoja.found) {
        return res.status(200).json({ received: true, loja: resultadoLoja });
      }

      if (confirmado) {
        // Uma cobranca so pode ser de UMA das duas coisas (inscricao de
        // temporada OU inscricao de campeonato) -- externalReference nunca
        // colide entre os dois, mas a Asaas manda so o payment.id no
        // webhook, entao tentamos temporada primeiro e so caimos pra
        // campeonato se a temporada nao reconhecer esse pagamento.
        const resultadoTemporada = await confirmarInscricaoPorPagamento(payment.id, payment.value);
        if (resultadoTemporada.encontrada) {
          return res.status(200).json({ received: true, inscricao: resultadoTemporada });
        }
        const resultadoChampionship = await confirmarInscricaoChampionshipPorPagamento(payment.id, payment.value);
        return res.status(200).json({ received: true, inscricao: resultadoChampionship });
      }

      if (event === 'PAYMENT_REFUNDED' || event === 'PAYMENT_CHARGEBACK_REQUESTED') {
        // Idem: tenta campeonato (temporada nao tem fluxo de reembolso
        // automatizado ainda -- fica so registrado no log abaixo se nao
        // reconhecido).
        const resultadoChampionship = await marcarInscricaoChampionshipComoReembolsada(payment.id);
        if (resultadoChampionship.encontrada) {
          return res.status(200).json({ received: true, inscricao: resultadoChampionship });
        }
      }

      // Outros eventos de cobrança (vencida, estornada não reconhecida)
      // não mudam inscrição paga -- ficam registrados no log para investigação.
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
    return res.status(500).json({ error: 'Erro interno ao processar webhook do Asaas.' });
  }
}
