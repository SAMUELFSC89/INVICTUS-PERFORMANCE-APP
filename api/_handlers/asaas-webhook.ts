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
  registrarEventoFinanceiroChampionship,
  type ChampionshipPaymentRiskEvent,
} from '../_lib/championship-inscription-service.js';
import { StoreEngine } from '../_lib/store-engine.js';
import { publishAdminRealtimeSignalSafe } from '../_lib/admin-realtime.js';

const PAYMENT_RISK_EVENTS = new Set<SeasonPaymentRiskEvent & ChampionshipPaymentRiskEvent>([
  'PAYMENT_REFUNDED',
  'PAYMENT_PARTIALLY_REFUNDED',
  'PAYMENT_REFUND_IN_PROGRESS',
  'PAYMENT_RECEIVED_IN_CASH_UNDONE',
  'PAYMENT_CHARGEBACK_REQUESTED',
  'PAYMENT_CHARGEBACK_DISPUTE',
  'PAYMENT_AWAITING_CHARGEBACK_REVERSAL',
]);

/**
 * Webhook financeiro central do Asaas. Inscricoes so ganham elegibilidade apos
 * validar paymentId, valor, externalReference, ordem do evento e lifecycle da
 * conta. Reembolsos/chargebacks removem a elegibilidade de forma idempotente.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido.' });
  }

  const expectedToken = process.env.ASAAS_WEBHOOK_TOKEN?.trim();
  const headerToken = req.headers['asaas-access-token'];
  const receivedToken = Array.isArray(headerToken) ? headerToken[0] : headerToken;

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
      const providerEventAt = req.body?.dateCreated;
      const checkoutSession = String(payment.checkoutSession || payment.checkout?.id || '');
      const confirmado = event === 'PAYMENT_RECEIVED'
        || event === 'PAYMENT_CONFIRMED'
        || event === 'PAYMENT_REFUND_DENIED';

      console.log('[Asaas Webhook] Evento de cobrança: ' + event + ' para pagamento ' + payment.id + ' (status: ' + payment.status + ')');

      const resultadoLoja = await StoreEngine.handleStorePaymentWebhook(payment.id, event, payment.value, {
        eventId: req.body?.id,
        eventAt: providerEventAt,
        externalReference: payment.externalReference,
      });
      if (resultadoLoja.found) {
        publishAdminRealtimeSignalSafe({ type: 'STORE_ORDER_CHANGED', source: 'asaas-webhook' });
        return res.status(resultadoLoja.retryable ? 503 : 200).json({ received: !resultadoLoja.retryable, retryable: Boolean(resultadoLoja.retryable), loja: resultadoLoja });
      }

      if (confirmado) {
        const resultadoTemporada = await confirmarInscricaoPorPagamento(
          payment.id,
          payment.value,
          payment.externalReference,
          providerEventAt,
        );
        if (resultadoTemporada.encontrada) {
          publishAdminRealtimeSignalSafe({ type: 'SYSTEM_CHANGED', source: 'asaas-webhook:season-registration' });
          return res.status(200).json({ received: true, inscricao: resultadoTemporada });
        }

        const resultadoChampionship = await confirmarInscricaoChampionshipPorPagamento(
          payment.id,
          payment.value,
          checkoutSession || undefined,
          payment.externalReference,
          providerEventAt,
        );
        if (resultadoChampionship.encontrada) {
          publishAdminRealtimeSignalSafe({
            type: resultadoChampionship.requerReconciliacao
              ? 'CHAMPIONSHIP_PAYMENT_RECONCILIATION_REQUIRED'
              : 'CHAMPIONSHIP_REGISTRATION_CONFIRMED',
            source: 'asaas-webhook:championship',
          });
        }
        return res.status(200).json({ received: true, inscricao: resultadoChampionship });
      }

      if (PAYMENT_RISK_EVENTS.has(event as SeasonPaymentRiskEvent & ChampionshipPaymentRiskEvent)) {
        const resultadoTemporada = await registrarEventoFinanceiroInscricaoTemporada(
          payment.id,
          event as SeasonPaymentRiskEvent,
          payment.externalReference,
          payment.value,
          providerEventAt,
        );
        if (resultadoTemporada.encontrada) {
          publishAdminRealtimeSignalSafe({ type: 'SYSTEM_CHANGED', source: 'asaas-webhook:season-risk' });
          return res.status(200).json({ received: true, inscricao: resultadoTemporada });
        }

        const resultadoChampionship = await registrarEventoFinanceiroChampionship(
          payment.id,
          event as ChampionshipPaymentRiskEvent,
          checkoutSession || undefined,
          payment.externalReference,
          payment.value,
          providerEventAt,
        );
        if (resultadoChampionship.encontrada) {
          publishAdminRealtimeSignalSafe({ type: 'CHAMPIONSHIP_PAYMENT_RECONCILIATION_REQUIRED', source: 'asaas-webhook:championship-risk' });
          return res.status(200).json({ received: true, inscricao: resultadoChampionship });
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
    publishAdminRealtimeSignalSafe({
      type: String(event).toUpperCase().includes('DONE') || String(transfer.status).toUpperCase() === 'DONE'
        ? 'WITHDRAWAL_PAID'
        : 'WITHDRAWAL_STATUS_CHANGED',
      source: 'asaas-webhook:transfer',
    });

    return res.status(200).json({ received: true });
  } catch (error: any) {
    console.error('[Asaas Webhook Error]', error);
    return res.status(500).json({ error: 'Erro interno ao processar webhook do Asaas.' });
  }
}
