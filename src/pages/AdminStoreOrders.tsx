import { useEffect, useState } from 'react';
import { AlertTriangle, Ban, CheckCircle2, PackageCheck, RefreshCw, Truck } from 'lucide-react';
import { auth } from '../firebase';
import { getStoreFinancialState } from '../lib/storeFinancialState';
import type { PhysicalOrder, PhysicalOrderItemSnapshot } from '../types';
import './AdminStoreOrders.css';

type AdminOrder = PhysicalOrder & { items: PhysicalOrderItemSnapshot[] };

const statusLabel: Record<PhysicalOrder['status'], string> = {
  PENDING_PAYMENT: 'Aguardando pagamento',
  PAID: 'Pago',
  PROCESSING: 'Em preparação',
  SHIPPED: 'Enviado',
  DELIVERED: 'Entregue',
  CANCELLED: 'Cancelado',
  REFUNDED: 'Reembolsado',
};

async function request(action: string, init?: RequestInit) {
  await auth.authStateReady();
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Sessão inválida.');
  const response = await fetch(`/api/store?action=${action}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init?.headers || {}) },
  });
  const data = await response.json();
  if (!response.ok || !data.success) throw new Error(data.error || 'Falha ao atualizar pedido.');
  return data;
}

export function AdminStoreOrders() {
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [tracking, setTracking] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    try {
      const data = await request('admin-orders');
      setOrders(data.orders || []);
    } catch (reason: any) {
      setError(reason?.message || 'Não foi possível carregar os pedidos.');
    }
  };

  useEffect(() => { void load(); }, []);

  const changeStatus = async (order: AdminOrder, status: PhysicalOrder['status']) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await request('update-order-status', {
        method: 'POST',
        body: JSON.stringify({ orderId: order.orderId, status, trackingCode: tracking[order.orderId] || '' }),
      });
      if (result.pending) {
        setMessage(result.financialOperation?.operation === 'REFUND'
          ? 'Estorno solicitado ao provedor. O pedido só será marcado como reembolsado após a confirmação financeira.'
          : 'Cancelamento solicitado ao provedor. As reservas serão liberadas somente após a confirmação.');
      } else {
        setMessage(`Pedido atualizado para: ${statusLabel[status]}.`);
      }
      await load();
    } catch (reason: any) {
      setError(reason?.message || 'Não foi possível atualizar o pedido.');
    } finally {
      setBusy(false);
    }
  };

  return <div className="admin-orders">
    <header>
      <div><h1>PEDIDOS DA LOJA</h1><p>Fulfillment, rastreio, entrega e cancelamento auditável.</p></div>
      <button type="button" onClick={() => void load()} disabled={busy}><RefreshCw />ATUALIZAR</button>
    </header>
    {error ? <p className="admin-orders-error" role="alert">{error}</p> : null}
    {message ? <p className="admin-orders-message" role="status">{message}</p> : null}
    <section>
      {orders.length ? orders.map(order => {
        const financial = getStoreFinancialState(order);
        const financialOperationPending = ['REQUESTED', 'RECONCILIATION_PENDING'].includes(financial.cancellationStatus)
          || ['REQUESTED', 'IN_PROGRESS', 'RECONCILIATION_PENDING'].includes(financial.refundStatus)
          || ['CANCELLATION_REQUESTED', 'REFUND_REQUESTED', 'REFUND_IN_PROGRESS'].includes(financial.paymentStatus);
        const financialActionTerminal = financial.cancellationStatus === 'CONFIRMED'
          || financial.refundStatus === 'CONFIRMED'
          || financial.refundStatus === 'PARTIAL'
          || ['CANCELLED', 'PARTIALLY_REFUNDED', 'REFUNDED', 'CHARGEBACK_REQUESTED'].includes(financial.paymentStatus);
        const financialActionDisabled = busy || financialOperationPending || financialActionTerminal;
        const relevantFulfillmentBlock = ['PAID', 'PROCESSING', 'SHIPPED'].includes(order.status) && financial.blocksFulfillment;
        const showFinancialPanel = order.paymentMethod !== 'COINS'
          || Boolean(order.financialReviewRequired)
          || Boolean(order.financialActionRequired)
          || Boolean(order.financialOperationError)
          || (order.totalCoinAmount > 0 && order.coinReservationStatus !== 'CONSUMED')
          || relevantFulfillmentBlock;
        const trackingMissing = !(tracking[order.orderId] || '').trim();

        return <article key={order.orderId}>
          <header>
            <div><PackageCheck /><span><b>{order.orderId}</b><small>{new Date(order.createdAt).toLocaleString('pt-BR')} · {order.userId}</small></span></div>
            <em className={`is-${order.status.toLowerCase()}`}>{statusLabel[order.status]}</em>
          </header>
          <div className="admin-orders-items">
            {order.items.map(item => <p key={item.productId}>
              <span>{item.quantity} × {item.name}</span>
              <small>GTIN {item.gtin || 'não informado'} · custo snapshot R$ {item.supplierCostSnapshot.toFixed(2)}{item.discountMode === 'COINS_DISCOUNT' ? ` · desconto ${item.coinAmountUsed.toLocaleString('pt-BR')} Coins` : ''}</small>
            </p>)}
          </div>

          {showFinancialPanel ? <section className={`admin-orders-financial ${financial.needsAttention || relevantFulfillmentBlock ? 'is-review' : ''}`} aria-label="Situação financeira">
            <div className="admin-orders-financial-heading"><b>SITUAÇÃO FINANCEIRA</b>{financial.needsAttention || relevantFulfillmentBlock ? <AlertTriangle /> : <CheckCircle2 />}</div>
            <div className="admin-orders-financial-grid">
              <span><small>PAGAMENTO</small><strong>{financial.paymentLabel}</strong></span>
              <span><small>CANCELAMENTO</small><strong>{financial.cancellationLabel}</strong></span>
              <span><small>ESTORNO</small><strong>{financial.refundLabel}</strong></span>
              <span><small>REVISÃO</small><strong>{financial.reviewLabel}</strong></span>
              <span><small>AÇÃO</small><strong>{financial.actionLabel}</strong></span>
              {order.totalCoinAmount > 0 ? <span><small>COINS</small><strong>{order.coinReservationStatus === 'CONSUMED' ? 'Consumo confirmado' : `Reserva ${order.coinReservationStatus || 'não informada'}`}</strong></span> : null}
            </div>
            {relevantFulfillmentBlock ? <p className="admin-orders-blocked"><AlertTriangle />{financial.fulfillmentBlockReason || 'Fulfillment bloqueado por situação financeira pendente.'}</p> : null}
            {order.financialOperationError ? <p className="admin-orders-financial-error">Detalhe: {order.financialOperationError}</p> : null}
          </section> : null}

          <footer>
            <span>{order.paymentMethod === 'COINS'
              ? `${order.totalCoinAmount.toLocaleString('pt-BR')} Coins`
              : `${order.totalCashAmount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}${order.totalCoinAmount ? ` + ${order.totalCoinAmount.toLocaleString('pt-BR')} Coins` : ''}`}</span>
            {order.status === 'PAID' ? <>
              <button type="button" disabled={busy || financial.blocksFulfillment} title={financial.blocksFulfillment ? financial.fulfillmentBlockReason || 'Fulfillment bloqueado' : undefined} onClick={() => void changeStatus(order, 'PROCESSING')}><PackageCheck />INICIAR PREPARAÇÃO</button>
              <button type="button" className="is-danger" disabled={financialActionDisabled} onClick={() => void changeStatus(order, 'CANCELLED')}><Ban />SOLICITAR ESTORNO</button>
            </> : null}
            {order.status === 'PENDING_PAYMENT' || order.status === 'PROCESSING' ? <>
              {order.status === 'PROCESSING' ? <>
                <input aria-label={`Código de rastreio do pedido ${order.orderId}`} value={tracking[order.orderId] || ''} onChange={event => setTracking(current => ({ ...current, [order.orderId]: event.target.value }))} placeholder="Código de rastreio" disabled={busy || financial.blocksFulfillment} />
                <button type="button" disabled={busy || financial.blocksFulfillment || trackingMissing} title={financial.blocksFulfillment ? financial.fulfillmentBlockReason || 'Fulfillment bloqueado' : trackingMissing ? 'Informe o código de rastreio' : undefined} onClick={() => void changeStatus(order, 'SHIPPED')}><Truck />MARCAR ENVIADO</button>
              </> : null}
              <button type="button" className="is-danger" disabled={financialActionDisabled} onClick={() => void changeStatus(order, 'CANCELLED')}><Ban />{order.status === 'PENDING_PAYMENT' ? 'CANCELAR COBRANÇA' : 'SOLICITAR ESTORNO'}</button>
            </> : null}
            {order.status === 'SHIPPED' ? <button type="button" disabled={busy || financial.blocksFulfillment} title={financial.blocksFulfillment ? financial.fulfillmentBlockReason || 'Fulfillment bloqueado' : undefined} onClick={() => void changeStatus(order, 'DELIVERED')}><CheckCircle2 />MARCAR ENTREGUE</button> : null}
          </footer>
        </article>;
      }) : <p className="admin-orders-empty">Nenhum pedido físico registrado.</p>}
    </section>
  </div>;
}
