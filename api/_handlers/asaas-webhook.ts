import { VercelRequest, VercelResponse } from '@vercel/node';
import { timingSafeEqual } from 'crypto';
import { cors } from '../_lib/common.js';
import { WithdrawalEngine } from '../_lib/withdrawal-engine.js';
import {
  confirmarInscricaoPorPagamento,
  registrarEventoFinanceiroInscricaoTemporada,
  type SeasonPaymentRiskEvent,
} from '../_lib/inscricao-service.js';
import {
  confirmarInscricaoChampionshipPorPagamento,
  marcarInscricaoChampionshipComoReembolsada,
} from '../_lib/championship-inscription-service.js';
import { StoreEngine } from '../_lib/store-engine.js';

const SEASON_PAYMENT_RISK_EVENTS = new Set<SeasonPaymentRiskEvent>([
  'PAYMENT_REFUNDED',
  'PAYMENT_PARTIALLY_REFUNDED',
  'PAYMENT_REFUND_IN_PROGRESS',
  'PAYMENT_RECEIVED_IN_CASH_UNDONE',
  'PAYMENT_CHARGEBACK_REQUESTED',
  'PAYMENT_CHARGEBACK_DISPUTE',
  'PAYMENT_AWAITING_CHARGEBACK_REVERSAL',
]);

/**
 * Webhook do Asaas: recebe eventos de cobrança e de transferência PIX e mantém
 * o estado financeiro canônico no Firestore. Confirmações de inscrições só
 * liberam elegibilidade após validar paymentId, valor, externalReference e
 * lifecycle da conta; estornos/chargebacks suspendem a elegibilidade.
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

    const payment = req.body?.payment;
    if (event && payment && payment.id) {
      const confirmado = event === 'PAYMENT_RECEIVED'
        || event === 'PAYMENT_CONFIRMED'
        || event === 'PAYMENT_REFUND_DENIED';

      console.log('[Asaas Webhook] Evento de cobrança: ' + event + ' para pagamento ' + payment.id + ' (status: ' + payment.status + ')');

      // A loja física também usa o Asaas. O pedido é localizado primeiro para
      // impedir que um pagamento de produto seja interpretado como inscrição.
      const resultadoLoja = await StoreEngine.handleStorePaymentWebhook(payment.id, event, payment.value, {
        eventId: req.body?.id,
        eventAt: req.body?.dateCreated,
        externalReference: payment.externalReference,
      });
      if (resultadoLoja.found) {
        return res.status(resultadoLoja.retryable ? 503 : 200).json({ received: !resultadoLoja.retryable, retryable: Boolean(resultadoLoja.retryable), loja: resultadoLoja });
      }

      if (confirmado) {
        // Temporada usa o externalReference determinístico da própria inscrição.
        // Só se ela não reconhecer o pagamento tentamos campeonato.
        const resultadoTemporada = await confirmarInscricaoPorPagamento(
          payment.id,
          payment.value,
          payment.externalReference,
        );
        if (resultadoTemporada.encontrada) {
          return res.status(200).json({ received: true, inscricao: resultadoTemporada });
        }
        const resultadoChampionship = await confirmarInscricaoChampionshipPorPagamento(payment.id, payment.value);
        return res.status(200).json({ received: true, inscricao: resultadoChampionship });
      }

      if (SEASON_PAYMENT_RISK_EVENTS.has(event as SeasonPaymentRiskEvent)) {
        const resultadoTemporada = await registrarEventoFinanceiroInscricaoTemporada(
          payment.id,
          event as SeasonPaymentRiskEvent,
          payment.externalReference,
          payment.value,
        );
        if (resultadoTemporada.encontrada) {
          return res.status(200).json({ received: true, inscricao: resultadoTemporada });
        }

        // Compatibilidade do campeonato enquanto o mesmo hardening financeiro
        // é aplicado ao seu serviço abaixo: os eventos terminais já suportados
        // continuam sendo tratados sem abrir uma segunda interpretação.
        if (event === 'PAYMENT_REFUNDED' || event === 'PAYMENT_CHARGEBACK_REQUESTED') {
          const resultadoChampionship = await marcarInscricaoChampionshipComoReembolsada(payment.id);
          if (resultadoChampionship.encontrada) {
            return res.status(200).json({ received: true, inscricao: resultadoChampionship });
          }
        }
      }

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
      transfer.failReason,
      transfer.externalReference,
      transfer.value
    );

    return res.status(200).json({ received: true });
  } catch (error: any) {
    console.error('[Asaas Webhook Error]', error);
    return res.status(500).json({ error: 'Erro interno ao processar webhook do Asaas.' });
  }
}
