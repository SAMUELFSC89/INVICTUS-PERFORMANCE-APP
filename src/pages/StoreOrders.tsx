import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, ArrowLeft, Box, CheckCircle2, ChevronDown, ChevronUp, Clock3, Coins, Copy, ExternalLink, MapPin, PackageCheck, RefreshCw, Truck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { auth } from '../firebase';
import { copyTextToClipboard } from '../lib/clipboard';
import { getStoreFinancialState } from '../lib/storeFinancialState';
import type { PhysicalOrder, PhysicalOrderItemSnapshot } from '../types';
import './StoreOrders.css';

type PublicItem = Omit<PhysicalOrderItemSnapshot, 'supplierCostSnapshot'>;
type PublicOrder = PhysicalOrder & { items: PublicItem[] };
type OrdersPayload = { orders?: PublicOrder[]; error?: string };
type OrderPayload = { order?: PublicOrder; error?: string };
type ResumePaymentPayload = OrderPayload & { payment?: { provider: string; paymentId: string; invoiceUrl: string | null; qrCode: NonNullable<PhysicalOrder['paymentQrCode']> } };
type CancelOrderPayload = OrderPayload & { pending?: boolean; financialOperation?: { operation?: string; state?: string } | null };

const orderStatus: Record<PhysicalOrder['status'], string> = {
  PENDING_PAYMENT: 'Aguardando pagamento',
  PAID: 'Pagamento aprovado',
  PROCESSING: 'Em preparação',
  SHIPPED: 'Enviado',
  DELIVERED: 'Entregue',
  CANCELLED: 'Cancelado',
  REFUNDED: 'Reembolsado',
};
const liveStatuses = new Set<PhysicalOrder['status']>(['PENDING_PAYMENT', 'PAID', 'PROCESSING', 'SHIPPED']);
const cash = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const StatusIcon = ({ value }: { value: PhysicalOrder['status'] }) => value === 'DELIVERED' ? <CheckCircle2 /> : value === 'SHIPPED' ? <Truck /> : value === 'PROCESSING' || value === 'PAID' ? <PackageCheck /> : <Clock3 />;

function dateTime(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('pt-BR');
}

function paymentMethod(value: PhysicalOrder['paymentMethod']) {
  if (value === 'COINS') return 'Invictus Coins';
  if (value === 'COINS_PLUS_MONEY') return 'PIX + Coins';
  return 'PIX';
}

function qrImageSource(value: string) {
  return value.startsWith('data:') ? value : `data:image/png;base64,${value}`;
}

async function authenticatedJson<T>(url: string, init?: RequestInit): Promise<T> {
  await auth.authStateReady();
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Sessão inválida.');
  const response = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init?.headers || {}) } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Não foi possível carregar os pedidos.');
  return data as T;
}

export function StoreOrders() {
  const navigate = useNavigate();
  const [orders, setOrders] = useState<PublicOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<{ orderId: string; message: string } | null>(null);
  const [actionNotice, setActionNotice] = useState<{ orderId: string; message: string } | null>(null);
  const [cancellingOrderId, setCancellingOrderId] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const ordersRequestInFlight = useRef(false);
  const detailRequestsInFlight = useRef(new Set<string>());

  const loadOrders = useCallback(async ({ initial = false }: { initial?: boolean } = {}) => {
    if (ordersRequestInFlight.current) return;
    ordersRequestInFlight.current = true;
    if (initial) setLoading(true);
    else setRefreshing(true);
    try {
      const data = await authenticatedJson<OrdersPayload>('/api/store?action=my-orders');
      if (!mountedRef.current) return;
      setOrders(Array.isArray(data.orders) ? data.orders : []);
      setError(null);
      setRefreshError(null);
      setLastUpdatedAt(new Date());
    } catch (reason: any) {
      if (!mountedRef.current) return;
      const message = reason?.message || 'Não foi possível carregar os pedidos.';
      if (initial) setError(message);
      else setRefreshError(message);
    } finally {
      ordersRequestInFlight.current = false;
      if (mountedRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  const loadOrderDetail = useCallback(async (orderId: string) => {
    if (detailRequestsInFlight.current.has(orderId)) return;
    detailRequestsInFlight.current.add(orderId);
    setDetailLoading(orderId);
    setDetailError(null);
    try {
      const query = new URLSearchParams({ action: 'payment-status', orderId });
      const data = await authenticatedJson<OrderPayload>(`/api/store?${query}`);
      if (!data.order) throw new Error('Pedido não encontrado.');
      if (!mountedRef.current) return;
      setOrders(current => current.map(order => order.orderId === orderId ? { ...data.order!, items: data.order!.items || order.items } : order));
      setLastUpdatedAt(new Date());
    } catch (reason: any) {
      if (mountedRef.current) setDetailError({ orderId, message: reason?.message || 'Não foi possível atualizar os detalhes.' });
    } finally {
      detailRequestsInFlight.current.delete(orderId);
      if (mountedRef.current) setDetailLoading(current => current === orderId ? null : current);
    }
  }, []);

  const resumePayment = useCallback(async (orderId: string) => {
    if (detailRequestsInFlight.current.has(orderId)) return;
    detailRequestsInFlight.current.add(orderId);
    setDetailLoading(orderId);
    setDetailError(null);
    try {
      const data = await authenticatedJson<ResumePaymentPayload>('/api/store?action=resume-payment', { method: 'POST', body: JSON.stringify({ orderId }) });
      if (!data.order || !data.payment) throw new Error('Não foi possível recuperar os dados do PIX.');
      if (!mountedRef.current) return;
      setOrders(current => current.map(order => order.orderId === orderId ? {
        ...data.order!,
        items: data.order!.items || order.items,
        paymentProvider: data.payment!.provider,
        paymentReference: data.payment!.paymentId,
        paymentInvoiceUrl: data.payment!.invoiceUrl,
        paymentQrCode: data.payment!.qrCode,
      } : order));
      setLastUpdatedAt(new Date());
    } catch (reason: any) {
      if (mountedRef.current) setDetailError({ orderId, message: reason?.message || 'Não foi possível recuperar os dados do PIX.' });
    } finally {
      detailRequestsInFlight.current.delete(orderId);
      if (mountedRef.current) setDetailLoading(current => current === orderId ? null : current);
    }
  }, []);

  const cancelOrder = useCallback(async (order: PublicOrder) => {
    const financial = getStoreFinancialState(order);
    if (!financial.canCancelPendingOrder) {
      setExpandedOrderId(order.orderId);
      setDetailError({ orderId: order.orderId, message: financial.buyerMessage || 'Este pedido não pode ser cancelado enquanto a situação financeira estiver em análise.' });
      return;
    }
    const orderId = order.orderId;
    if (!window.confirm('Cancelar este pedido pendente? A cobrança PIX será cancelada e as reservas serão liberadas com segurança.')) return;
    setExpandedOrderId(orderId);
    setCancellingOrderId(orderId);
    setDetailError(null);
    setActionNotice(null);
    try {
      const data = await authenticatedJson<CancelOrderPayload>('/api/store?action=cancel-order', { method: 'POST', body: JSON.stringify({ orderId }) });
      if (!data.order) throw new Error('Não foi possível obter o pedido após o cancelamento.');
      if (!mountedRef.current) return;
      setOrders(current => current.map(order => order.orderId === orderId ? { ...data.order!, items: data.order!.items || order.items } : order));
      setActionNotice({
        orderId,
        message: data.pending || data.financialOperation?.state === 'PENDING'
          ? 'Cancelamento solicitado. O status será atualizado assim que a operação for confirmada.'
          : 'Pedido cancelado e reservas liberadas.',
      });
      setLastUpdatedAt(new Date());
    } catch (reason: any) {
      if (mountedRef.current) setDetailError({ orderId, message: reason?.message || 'Não foi possível cancelar o pedido.' });
    } finally {
      if (mountedRef.current) setCancellingOrderId(current => current === orderId ? null : current);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void loadOrders({ initial: true });
    return () => { mountedRef.current = false; };
  }, [loadOrders]);

  const hasLiveOrders = useMemo(() => orders.some(order => liveStatuses.has(order.status)), [orders]);

  useEffect(() => {
    if (!hasLiveOrders) return;
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void loadOrders();
    };
    const interval = window.setInterval(refreshWhenVisible, 15_000);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [hasLiveOrders, loadOrders]);

  const openDetails = (orderId: string) => {
    setExpandedOrderId(current => current === orderId ? null : orderId);
    if (expandedOrderId !== orderId) void loadOrderDetail(orderId);
  };

  const resumePix = (order: PublicOrder) => {
    const financial = getStoreFinancialState(order);
    setExpandedOrderId(order.orderId);
    if (!financial.canResumePix) {
      setDetailError({ orderId: order.orderId, message: financial.buyerMessage || 'O PIX está bloqueado enquanto a situação financeira é conciliada.' });
      return;
    }
    void resumePayment(order.orderId);
  };

  const manualRefresh = () => {
    void loadOrders();
    if (expandedOrderId) void loadOrderDetail(expandedOrderId);
  };

  const copyValue = async (value: string, key: string) => {
    const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : null;
    const result = await copyTextToClipboard(value, clipboard);
    if (result.ok) {
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey(current => current === key ? null : current), 1800);
    } else if ('message' in result) {
      setDetailError({ orderId: key.split(':')[1] || '', message: result.message });
    }
  };

  return createPortal(<main className="store-orders-screen"><div className="store-orders-page">
    <header>
      <button type="button" onClick={() => navigate('/store')} aria-label="Voltar para a loja"><ArrowLeft /></button>
      <div><h1>MEUS PEDIDOS</h1><p>Acompanhe compras e resgates da Loja Invictus.</p></div>
      <button type="button" className="store-orders-refresh" onClick={manualRefresh} disabled={loading || refreshing} aria-label="Atualizar pedidos" title="Atualizar pedidos"><RefreshCw className={refreshing ? 'is-spinning' : ''} /></button>
    </header>

    <div className="store-orders-sync" aria-live="polite">
      <span><RefreshCw />{hasLiveOrders ? 'Atualização automática a cada 15 segundos' : 'Atualização manual disponível'}</span>
      {lastUpdatedAt ? <small>Atualizado às {lastUpdatedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</small> : null}
    </div>

    {refreshError && !loading ? <aside className="store-orders-refresh-error" role="alert"><span>{refreshError}</span><button type="button" onClick={manualRefresh}>TENTAR NOVAMENTE</button></aside> : null}

    {loading ? <p className="store-orders-message">Carregando pedidos…</p> : error ? <section className="store-orders-error" role="alert"><Box /><h2>NÃO FOI POSSÍVEL CARREGAR</h2><p>{error}</p><button type="button" onClick={() => void loadOrders({ initial: true })}>TENTAR NOVAMENTE</button></section> : orders.length === 0 ? <section className="store-orders-empty"><Box /><h2>NENHUM PEDIDO AINDA</h2><p>Suas compras e resgates aparecerão aqui.</p><button type="button" onClick={() => navigate('/store')}>EXPLORAR A LOJA</button></section> : <section className="store-orders-list">
      {orders.map(order => {
        const expanded = expandedOrderId === order.orderId;
        const pixPayload = order.paymentQrCode?.payload;
        const pixImage = order.paymentQrCode?.encodedImage;
        const paymentExpiresAt = order.paymentQrCode?.expirationDate || order.paymentDueAt;
        const pendingPayment = order.status === 'PENDING_PAYMENT' && order.paymentMethod !== 'COINS';
        const financial = getStoreFinancialState(order);
        const showTracking = order.status === 'SHIPPED' || order.status === 'DELIVERED' || Boolean(order.trackingCode);
        const detailPanelId = `store-order-detail-${order.orderId}`;
        return <article key={order.orderId} className={`store-orders-card is-${order.status.toLowerCase()}`}>
          <header><span role="status" aria-live="polite"><StatusIcon value={order.status} /><b>{orderStatus[order.status]}</b></span><small>{dateTime(order.createdAt)}</small></header>
          {order.items.map(item => <div className="store-orders-item" key={`${order.orderId}-${item.productId}`}><PackageCheck /><span><b>{item.name}</b><small>Quantidade: {item.quantity}{item.discountMode === 'COINS_DISCOUNT' ? ` · ${item.coinAmountUsed.toLocaleString('pt-BR')} Coins no desconto` : ''}</small></span></div>)}
          {financial.needsAttention ? <aside className="store-orders-financial-alert" role="status"><AlertTriangle /><span><b>ATENÇÃO FINANCEIRA</b><small>{financial.buyerMessage}</small></span></aside> : null}
          <footer><span>Pedido {order.orderId}</span><b>{order.paymentMethod === 'COINS' ? <><Coins />{order.totalCoinAmount.toLocaleString('pt-BR')} Coins</> : <>{cash(order.totalCashAmount)}{order.totalCoinAmount ? <> + <Coins />{order.totalCoinAmount.toLocaleString('pt-BR')} Coins</> : null}</>}</b></footer>
          <section className="store-orders-card-actions">
            {financial.canResumePix ? <button type="button" className="is-primary" onClick={() => resumePix(order)} disabled={detailLoading === order.orderId || cancellingOrderId === order.orderId} aria-expanded={expanded} aria-controls={detailPanelId}>{detailLoading === order.orderId ? <><RefreshCw className="is-spinning" />RECUPERANDO PIX…</> : 'RETOMAR PIX'}</button> : null}
            {financial.canCancelPendingOrder ? <button type="button" className="is-danger" onClick={() => void cancelOrder(order)} disabled={cancellingOrderId === order.orderId || detailLoading === order.orderId}>{cancellingOrderId === order.orderId ? <><RefreshCw className="is-spinning" />CANCELANDO…</> : 'CANCELAR PEDIDO'}</button> : null}
            <button type="button" onClick={() => openDetails(order.orderId)} aria-expanded={expanded} aria-controls={detailPanelId}>{expanded ? <><ChevronUp />OCULTAR DETALHES</> : <><ChevronDown />VER DETALHES</>}</button>
          </section>

          {expanded ? <section className="store-orders-detail" id={detailPanelId}>
            <div className="store-orders-detail-heading"><div><small>DETALHES DO PEDIDO</small><h2>{orderStatus[order.status]}</h2></div><button type="button" onClick={() => void loadOrderDetail(order.orderId)} disabled={detailLoading === order.orderId || cancellingOrderId === order.orderId}><RefreshCw className={detailLoading === order.orderId ? 'is-spinning' : ''} />ATUALIZAR</button></div>
            {detailError?.orderId === order.orderId ? <p className="store-orders-detail-error" role="alert">{detailError.message}</p> : null}
            {actionNotice?.orderId === order.orderId ? <p className="store-orders-action-notice" role="status">{actionNotice.message}</p> : null}

            <section className={`store-orders-financial ${financial.needsAttention ? 'is-attention' : ''}`} aria-label="Situação financeira do pedido">
              <div className="store-orders-financial-heading"><span><small>SITUAÇÃO FINANCEIRA</small><h3>{financial.paymentLabel}</h3></span>{financial.needsAttention ? <AlertTriangle /> : <CheckCircle2 />}</div>
              <div className="store-orders-financial-grid">
                <div><small>PAGAMENTO</small><b>{financial.paymentLabel}</b></div>
                <div><small>CANCELAMENTO</small><b>{financial.cancellationLabel}</b></div>
                <div><small>ESTORNO</small><b>{financial.refundLabel}</b></div>
                <div><small>REVISÃO</small><b>{financial.reviewLabel}</b></div>
                <div className="is-wide"><small>AÇÃO FINANCEIRA</small><b>{financial.actionLabel}</b></div>
              </div>
              {financial.buyerMessage ? <p>{financial.buyerMessage}</p> : null}
              {order.financialOperationError ? <p className="store-orders-financial-error">Detalhe: {order.financialOperationError}</p> : null}
            </section>

            {financial.canShowPix ? <section className="store-orders-pix">
              <h3>CONCLUIR PAGAMENTO PIX</h3>
              <p>Use os dados já salvos nesta cobrança. A tela atualizará o status automaticamente após a confirmação.</p>
              {pixImage ? <img className="store-orders-qr" src={qrImageSource(pixImage)} alt={`QR Code PIX do pedido ${order.orderId}`} /> : null}
              {pixPayload ? <><code>{pixPayload}</code><button type="button" onClick={() => void copyValue(pixPayload, `pix:${order.orderId}`)}><Copy />{copiedKey === `pix:${order.orderId}` ? 'COPIADO' : 'COPIAR PIX'}</button></> : null}
              {order.paymentInvoiceUrl ? <a href={order.paymentInvoiceUrl} target="_blank" rel="noreferrer"><ExternalLink />ABRIR COBRANÇA</a> : null}
              {paymentExpiresAt ? <small>Válido até {dateTime(paymentExpiresAt)}</small> : null}
              {!pixPayload && !order.paymentInvoiceUrl ? <><p className="store-orders-pix-unavailable">Os dados do PIX ainda não estão disponíveis neste pedido. Recupere a cobrança canônica para tentar novamente sem criar outro pagamento.</p><button type="button" onClick={() => void resumePayment(order.orderId)} disabled={detailLoading === order.orderId}><RefreshCw className={detailLoading === order.orderId ? 'is-spinning' : ''} />RECUPERAR PIX</button></> : null}
            </section> : null}
            {pendingPayment && !financial.canShowPix ? <section className="store-orders-pix-blocked" role="alert"><AlertTriangle /><div><h3>PIX BLOQUEADO</h3><p>{financial.buyerMessage || 'A cobrança não pode ser exibida até a conciliação financeira deste pedido.'}</p></div></section> : null}

            {showTracking ? <section className="store-orders-tracking">
              <Truck />
              <div><small>RASTREAMENTO</small>{order.trackingCode ? <><strong>{order.trackingCode}</strong><button type="button" onClick={() => void copyValue(order.trackingCode!, `tracking:${order.orderId}`)}><Copy />{copiedKey === `tracking:${order.orderId}` ? 'COPIADO' : 'COPIAR CÓDIGO'}</button></> : <p>O pedido foi enviado, mas o código de rastreio ainda não foi informado.</p>}</div>
            </section> : null}

            <section className="store-orders-detail-grid">
              <div><small>FORMA DE PAGAMENTO</small><b>{paymentMethod(order.paymentMethod)}</b></div>
              <div><small>FRETE</small><b>{order.shippingAmount > 0 ? cash(order.shippingAmount) : 'Sem custo'}</b></div>
              <div><small>ÚLTIMA ATUALIZAÇÃO</small><b>{dateTime(order.updatedAt)}</b></div>
              {order.shippedAt ? <div><small>ENVIADO EM</small><b>{dateTime(order.shippedAt)}</b></div> : null}
              {order.deliveredAt ? <div><small>ENTREGUE EM</small><b>{dateTime(order.deliveredAt)}</b></div> : null}
              {order.cancelledAt ? <div><small>CANCELADO EM</small><b>{dateTime(order.cancelledAt)}</b></div> : null}
            </section>

            <section className="store-orders-address"><MapPin /><div><small>ENTREGA PARA</small><b>{order.address.recipientName}</b><p>{order.address.street}, {order.address.number}{order.address.complement ? ` · ${order.address.complement}` : ''}<br />{order.address.district} · {order.address.city}/{order.address.state}<br />CEP {order.address.postalCode}</p></div></section>
          </section> : null}
        </article>;
      })}
    </section>}
  </div></main>, document.body);
}
