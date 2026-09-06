import type { PhysicalOrder } from '../types';

type FinancialOrder = Pick<PhysicalOrder,
  | 'status'
  | 'paymentMethod'
  | 'totalCashAmount'
  | 'totalCoinAmount'
  | 'paymentStatus'
  | 'coinReservationStatus'
  | 'cancellationStatus'
  | 'refundStatus'
  | 'financialReviewRequired'
  | 'financialActionRequired'
  | 'financialOperationError'
>;

const paymentLabels: Record<string, string> = {
  PENDING: 'Pagamento pendente',
  CREATING: 'Criando cobrança',
  AWAITING_PAYMENT: 'Aguardando pagamento PIX',
  PAID: 'Pagamento confirmado',
  PAID_AFTER_CANCELLATION: 'Pagamento confirmado após cancelamento',
  AMOUNT_MISMATCH: 'Valor recebido divergente',
  CANCELLATION_REQUESTED: 'Cancelamento da cobrança solicitado',
  CANCELLED: 'Cobrança cancelada',
  OVERDUE: 'Cobrança vencida',
  FAILED: 'Falha financeira',
  REFUND_REQUESTED: 'Estorno solicitado',
  REFUND_IN_PROGRESS: 'Estorno em processamento',
  PARTIALLY_REFUNDED: 'Estorno parcial',
  REFUNDED: 'Estorno confirmado',
  REFUND_FAILED: 'Falha no estorno',
  CHARGEBACK_REQUESTED: 'Chargeback em análise',
};

const cancellationLabels: Record<string, string> = {
  NONE: 'Nenhum cancelamento em andamento',
  REQUESTED: 'Cancelamento solicitado',
  RECONCILIATION_PENDING: 'Cancelamento aguardando conciliação',
  CONFIRMED: 'Cancelamento confirmado',
  FAILED: 'Falha ao cancelar a cobrança',
};

const refundLabels: Record<string, string> = {
  NONE: 'Nenhum estorno em andamento',
  REQUESTED: 'Estorno solicitado',
  IN_PROGRESS: 'Estorno em processamento',
  RECONCILIATION_PENDING: 'Estorno aguardando conciliação',
  PARTIAL: 'Estorno parcial',
  CONFIRMED: 'Estorno confirmado',
  FAILED: 'Falha no estorno',
};

const actionLabels: Record<string, string> = {
  REFUND: 'Estorno financeiro necessário',
  RETURN_REVIEW: 'Revisão de devolução necessária',
  CHARGEBACK_REVIEW: 'Revisão de chargeback necessária',
};

function normalized(value?: string | null) {
  return String(value || '').trim().toUpperCase();
}

function fallbackPaymentLabel(order: FinancialOrder) {
  if (order.paymentMethod === 'COINS') return 'Pagamento com Invictus Coins';
  if (order.status === 'PENDING_PAYMENT') return 'Pagamento ainda não confirmado';
  if (order.status === 'REFUNDED') return 'Pedido reembolsado';
  if (order.status === 'CANCELLED') return 'Pedido cancelado';
  return 'Situação financeira não informada';
}

function unknownLabel(value: string) {
  return value.toLocaleLowerCase('pt-BR').replaceAll('_', ' ');
}

export function getStoreFinancialState(order: FinancialOrder) {
  const paymentStatus = normalized(order.paymentStatus);
  const cancellationStatus = normalized(order.cancellationStatus) || 'NONE';
  const refundStatus = normalized(order.refundStatus) || 'NONE';
  const financialAction = normalized(order.financialActionRequired);

  const cancellationPending = ['REQUESTED', 'RECONCILIATION_PENDING'].includes(cancellationStatus) || paymentStatus === 'CANCELLATION_REQUESTED';
  const refundPending = ['REQUESTED', 'IN_PROGRESS', 'RECONCILIATION_PENDING'].includes(refundStatus)
    || ['REFUND_REQUESTED', 'REFUND_IN_PROGRESS'].includes(paymentStatus);
  const partialRefund = refundStatus === 'PARTIAL' || paymentStatus === 'PARTIALLY_REFUNDED';
  const chargeback = paymentStatus === 'CHARGEBACK_REQUESTED' || financialAction === 'CHARGEBACK_REVIEW';
  const paidAfterCancellation = paymentStatus === 'PAID_AFTER_CANCELLATION';
  const paymentOverdue = paymentStatus === 'OVERDUE';
  const amountMismatch = paymentStatus === 'AMOUNT_MISMATCH';
  const paymentCreationFailure = paymentStatus === 'FAILED'
    && cancellationStatus === 'NONE'
    && refundStatus === 'NONE'
    && order.financialReviewRequired !== true
    && !financialAction
    && !order.financialOperationError;
  const financialFailure = paymentStatus === 'REFUND_FAILED'
    || cancellationStatus === 'FAILED'
    || refundStatus === 'FAILED';
  const reviewRequired = order.financialReviewRequired === true
    || Boolean(financialAction)
    || Boolean(order.financialOperationError)
    || chargeback
    || partialRefund
    || paidAfterCancellation
    || amountMismatch
    || financialFailure;
  const cancellationFinal = cancellationStatus === 'CONFIRMED' || paymentStatus === 'CANCELLED';
  const refundFinal = refundStatus === 'CONFIRMED' || paymentStatus === 'REFUNDED';
  const pixBlocked = cancellationPending || cancellationFinal || refundPending || partialRefund || refundFinal || reviewRequired || paymentOverdue;
  const pendingCashPayment = order.status === 'PENDING_PAYMENT' && order.paymentMethod !== 'COINS';

  const paymentSettled = paymentStatus === 'PAID';
  const coinsSettled = order.totalCoinAmount <= 0 || order.coinReservationStatus === 'CONSUMED';
  const cancellationClear = cancellationStatus === 'NONE';
  const refundClear = refundStatus === 'NONE';
  const blocksFulfillment = !paymentSettled || !coinsSettled || !cancellationClear || !refundClear || reviewRequired;

  let buyerMessage: string | null = null;
  let fulfillmentBlockReason: string | null = null;
  if (cancellationPending) {
    buyerMessage = 'O cancelamento está sendo confirmado. Não pague este PIX enquanto a operação estiver em andamento.';
    fulfillmentBlockReason = 'Cancelamento solicitado; aguarde a confirmação financeira.';
  } else if (refundPending) {
    buyerMessage = 'O estorno está em processamento. Não há um novo pagamento a concluir neste pedido.';
    fulfillmentBlockReason = refundStatus === 'IN_PROGRESS' || paymentStatus === 'REFUND_IN_PROGRESS'
      ? 'Estorno em processamento; não prepare nem envie o pedido.'
      : 'Estorno solicitado; aguarde o provedor.';
  } else if (partialRefund) {
    buyerMessage = 'O provedor confirmou apenas parte do estorno. O pedido está em revisão financeira.';
    fulfillmentBlockReason = 'Estorno parcial; revisão operacional necessária.';
  } else if (chargeback) {
    buyerMessage = 'A cobrança está sob contestação. O pedido permanece em revisão financeira até a conclusão da análise.';
    fulfillmentBlockReason = 'Chargeback em análise; fulfillment bloqueado.';
  } else if (paidAfterCancellation) {
    buyerMessage = 'O pagamento chegou após o cancelamento. A equipe está conciliando o valor antes de qualquer nova etapa.';
    fulfillmentBlockReason = 'Pagamento recebido após cancelamento; revisão financeira necessária.';
  } else if (paymentOverdue) {
    buyerMessage = 'Esta cobrança venceu. Não utilize o QR Code ou o código PIX salvo anteriormente.';
    fulfillmentBlockReason = 'Cobrança vencida; gere ou concilie um novo fluxo antes do fulfillment.';
  } else if (paymentCreationFailure) {
    buyerMessage = 'A tentativa anterior de gerar a cobrança falhou. Você pode recuperar o PIX deste mesmo pedido sem criar outra compra.';
    fulfillmentBlockReason = 'Pagamento não confirmado; fulfillment bloqueado.';
  } else if (cancellationFinal) {
    buyerMessage = 'A cobrança deste pedido foi cancelada. Não utilize dados PIX salvos anteriormente.';
    fulfillmentBlockReason = 'Cobrança cancelada; não avance o pedido.';
  } else if (refundFinal) {
    buyerMessage = 'O estorno foi confirmado. Este pedido não possui pagamento pendente.';
    fulfillmentBlockReason = 'Estorno confirmado; não avance o pedido.';
  } else if (financialFailure) {
    buyerMessage = 'A operação financeira encontrou uma falha e precisa de revisão antes de prosseguir.';
    fulfillmentBlockReason = cancellationStatus === 'FAILED'
      ? 'Falha no cancelamento; revise antes do fulfillment.'
      : 'Falha no estorno ou na cobrança; revise antes do fulfillment.';
  } else if (reviewRequired) {
    buyerMessage = 'Este pedido está em revisão financeira. As ações de pagamento e envio ficam bloqueadas até a análise terminar.';
    fulfillmentBlockReason = 'Fulfillment bloqueado: revisão financeira necessária.';
  } else if (!paymentSettled) {
    fulfillmentBlockReason = 'Pagamento não confirmado; fulfillment bloqueado.';
  } else if (!coinsSettled) {
    fulfillmentBlockReason = 'Consumo de Coins não confirmado; fulfillment bloqueado.';
  } else if (!cancellationClear) {
    fulfillmentBlockReason = 'Situação de cancelamento não conciliada; fulfillment bloqueado.';
  } else if (!refundClear) {
    fulfillmentBlockReason = 'Situação de estorno não conciliada; fulfillment bloqueado.';
  }

  return {
    paymentStatus,
    cancellationStatus,
    refundStatus,
    paymentLabel: paymentStatus ? paymentLabels[paymentStatus] || unknownLabel(paymentStatus) : fallbackPaymentLabel(order),
    cancellationLabel: cancellationLabels[cancellationStatus] || unknownLabel(cancellationStatus),
    refundLabel: refundLabels[refundStatus] || unknownLabel(refundStatus),
    reviewLabel: reviewRequired ? 'Revisão financeira necessária' : 'Sem revisão financeira pendente',
    actionLabel: financialAction ? actionLabels[financialAction] || unknownLabel(financialAction) : 'Nenhuma ação financeira pendente',
    buyerMessage,
    fulfillmentBlockReason,
    reviewRequired,
    needsAttention: Boolean(buyerMessage),
    canShowPix: pendingCashPayment && !pixBlocked,
    canResumePix: pendingCashPayment && !pixBlocked,
    canCancelPendingOrder: pendingCashPayment && !pixBlocked,
    blocksFulfillment,
  };
}
