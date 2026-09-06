import { FormEvent, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, ArrowLeft, CheckCircle2, Coins, Copy, ExternalLink, LockKeyhole, MapPin, PackageCheck, Truck } from 'lucide-react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ProductImage } from '../components/ProductImage';
import { auth } from '../firebase';
import { copyTextToClipboard } from '../lib/clipboard';
import { attachOrderToCheckoutIntent, clearCheckoutIntent, getOrCreateCheckoutIntent, readCheckoutIntent, type CheckoutMode } from '../lib/storeCheckoutIntent';
import { getStoreFinancialState } from '../lib/storeFinancialState';
import type { PhysicalOrder, PhysicalShippingAddress, PublicPhysicalProduct } from '../types';
import './StoreCheckout.css';

type PaymentPayload = { provider: string; paymentId: string; invoiceUrl: string | null; qrCode: { encodedImage?: string; payload?: string; expirationDate?: string } };
type Payload = { product?: PublicPhysicalProduct; order?: PhysicalOrder; payment?: PaymentPayload; error?: string };

const emptyAddress: PhysicalShippingAddress = { recipientName: '', postalCode: '', street: '', number: '', complement: '', district: '', city: '', state: '' };
const cash = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function readMode(value: string | null): CheckoutMode {
  return value === 'discount' || value === 'drop' ? value : 'money';
}

function newIdempotencyKey() {
  return globalThis.crypto?.randomUUID?.() || `checkout-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function paymentFromOrder(order: PhysicalOrder): PaymentPayload | null {
  if (!order.paymentReference && !order.paymentInvoiceUrl && !order.paymentQrCode) return null;
  return {
    provider: order.paymentProvider || 'asaas',
    paymentId: order.paymentReference || '',
    invoiceUrl: order.paymentInvoiceUrl || null,
    qrCode: order.paymentQrCode || {},
  };
}

async function authenticatedRequest(url: string, init?: RequestInit) {
  await auth.authStateReady();
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Sessão inválida.');
  return fetch(url, { ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init?.headers || {}) } });
}

export function StoreCheckout() {
  const navigate = useNavigate();
  const { productId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const mode = readMode(searchParams.get('mode'));
  const [product, setProduct] = useState<PublicPhysicalProduct | null>(null);
  const [address, setAddress] = useState<PhysicalShippingAddress>(emptyAddress);
  const [quantity, setQuantity] = useState(1);
  const [loading, setLoading] = useState(true);
  const [restoringIntent, setRestoringIntent] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<PhysicalOrder | null>(null);
  const [payment, setPayment] = useState<PaymentPayload | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setProduct(null);
    setError(null);
    (async () => {
      try {
        const query = new URLSearchParams({ action: 'product', productId });
        const response = await authenticatedRequest(`/api/store?${query}`);
        const data: Payload = await response.json();
        if (!response.ok || !data.product) throw new Error(data.error || 'Produto indisponível.');
        if (active) setProduct(data.product);
      } catch (reason: any) {
        if (active) setError(reason?.message || 'Não foi possível carregar o produto.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [productId]);

  useEffect(() => {
    let active = true;
    setRestoringIntent(true);
    (async () => {
      try {
        await auth.authStateReady();
        if (!active) return;
        const userId = auth.currentUser?.uid;
        if (!userId) return;
        setOrder(null);
        setPayment(null);
        const savedIntent = readCheckoutIntent(window.localStorage, { userId, productId, mode });
        if (!savedIntent) return;

        setQuantity(savedIntent.quantity);
        setAddress(savedIntent.address);
        if (savedIntent.orderId) {
          try {
            const query = new URLSearchParams({ action: 'payment-status', orderId: savedIntent.orderId! });
            const response = await authenticatedRequest(`/api/store?${query}`);
            const data: Payload = await response.json();
            if (!response.ok || !data.order) throw new Error(data.error || 'Não foi possível retomar o pedido.');
            if (!active) return;
            setOrder(data.order);
            setPayment(paymentFromOrder(data.order));
            if (data.order.status !== 'PENDING_PAYMENT') {
              clearCheckoutIntent(window.localStorage, savedIntent);
            }
          } catch (reason: any) {
            if (active) setError(reason?.message || 'Não foi possível retomar o pedido. Tente novamente.');
          }
        }
      } catch (reason: any) {
        if (active) setError(reason?.message || 'Não foi possível restaurar sua tentativa. Tente novamente.');
      } finally {
        if (active) setRestoringIntent(false);
      }
    })();

    return () => { active = false; };
  }, [mode, productId]);

  const unitCash = mode === 'discount' ? product?.coinDiscountPrice : product?.cashPrice;
  const unitCoins = mode === 'discount' ? product?.coinDiscountAmount : mode === 'drop' ? product?.drop?.coinPrice : null;
  const productTotal = useMemo(() => unitCash ? unitCash * quantity : null, [unitCash, quantity]);
  const coinsTotal = useMemo(() => unitCoins ? unitCoins * quantity : null, [unitCoins, quantity]);
  const title = mode === 'drop' ? 'RESGATE NO DROP' : mode === 'discount' ? 'COMPRA COM DESCONTO' : 'COMPRA EM DINHEIRO';

  const updateAddress = (key: keyof PhysicalShippingAddress, value: string) => setAddress(current => ({ ...current, [key]: value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const userId = auth.currentUser?.uid;
      if (!userId) throw new Error('Sessão inválida.');
      const intent = getOrCreateCheckoutIntent(window.localStorage, { userId, productId, mode, quantity, address, dropId: mode === 'drop' ? product?.drop?.id : null }, newIdempotencyKey);
      const action = mode === 'drop' ? 'redeem-with-coins' : 'create-cash-order';
      const body = mode === 'drop'
        ? { productId, quantity, address: intent.address, idempotencyKey: intent.idempotencyKey }
        : { productId, quantity, address: intent.address, idempotencyKey: intent.idempotencyKey, paymentMethod: mode === 'discount' ? 'COINS_PLUS_MONEY' : 'MONEY' };
      const response = await authenticatedRequest(`/api/store?action=${action}`, { method: 'POST', body: JSON.stringify(body) });
      const data: Payload = await response.json();
      if (!response.ok || !data.order) throw new Error(data.error || 'Não foi possível concluir o pedido.');
      setOrder(data.order);
      setPayment(data.payment || paymentFromOrder(data.order));
      if (data.order.status === 'PENDING_PAYMENT') {
        attachOrderToCheckoutIntent(window.localStorage, intent, data.order.orderId);
      } else {
        clearCheckoutIntent(window.localStorage, intent);
      }
    } catch (reason: any) {
      setError(reason?.message || 'Não foi possível concluir o pedido.');
    } finally {
      setSubmitting(false);
    }
  };

  const copyPix = async () => {
    if (!payment?.qrCode.payload) return;
    setCopied(false);
    setCopyError(null);
    const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : null;
    const result = await copyTextToClipboard(payment.qrCode.payload, clipboard);
    if ('message' in result) {
      setCopyError(result.message);
      return;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const financial = order ? getStoreFinancialState(order) : null;
  const success = order && ['PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED'].includes(order.status);
  const interrupted = order && (order.status === 'CANCELLED' || order.status === 'REFUNDED');
  const canSubmit = mode === 'drop' ? Boolean(product?.availableForDrop) : Boolean(product?.availableForPurchase && (mode === 'money' || (product?.canPurchaseWithCoinsDiscount && product.coinDiscountPrice && product.coinDiscountAmount)));

  return createPortal(<main className="store-checkout-screen"><div className="store-checkout-page"><header><button type="button" aria-label="Voltar para o produto" onClick={() => navigate(`/store/product/${productId}`)}><ArrowLeft /></button><div><b>CHECKOUT INVICTUS</b><span>{title}</span></div><LockKeyhole /></header>
    {loading || restoringIntent ? <p className="store-checkout-message">{restoringIntent ? 'Retomando sua tentativa…' : 'Carregando…'}</p> : order && financial && (financial.needsAttention || Boolean(success && financial.blocksFulfillment)) && (!interrupted || financial.reviewRequired) ? <section className="store-checkout-financial-block" role="alert"><AlertTriangle /><h1>{order.status === 'PENDING_PAYMENT' ? 'PAGAMENTO INDISPONÍVEL' : 'PEDIDO EM REVISÃO FINANCEIRA'}</h1><p>{financial.buyerMessage || financial.fulfillmentBlockReason || 'A situação financeira ainda não foi confirmada.'}</p><div className="store-checkout-financial-grid"><span><small>PAGAMENTO</small><b>{financial.paymentLabel}</b></span><span><small>CANCELAMENTO</small><b>{financial.cancellationLabel}</b></span><span><small>ESTORNO</small><b>{financial.refundLabel}</b></span><span><small>REVISÃO</small><b>{financial.reviewLabel}</b></span><span className="is-wide"><small>AÇÃO FINANCEIRA</small><b>{financial.actionLabel}</b></span></div>{order.financialOperationError ? <p className="store-checkout-financial-error">Detalhe: {order.financialOperationError}</p> : null}<b>PEDIDO {order.orderId}</b><button onClick={() => navigate('/store/orders')}>{financial.canResumePix ? 'RECUPERAR PIX EM MEUS PEDIDOS' : 'ACOMPANHAR EM MEUS PEDIDOS'}</button><button className="is-secondary" onClick={() => navigate('/store')}>VOLTAR PARA A LOJA</button></section> : order && success ? <section className="store-checkout-success"><CheckCircle2 /><h1>{mode === 'drop' ? 'RESGATE CONFIRMADO' : 'PAGAMENTO CONFIRMADO'}</h1><p>{mode === 'drop' ? 'Seu pedido entrou em processamento. Você poderá acompanhar as próximas etapas pelo histórico da Loja.' : 'Recebemos o pagamento e reservamos o pedido para preparação.'}</p><b>PEDIDO {order.orderId}</b><button onClick={() => navigate('/store/orders')}>ACOMPANHAR PEDIDO</button><button onClick={() => navigate('/store')}>VOLTAR PARA A LOJA</button></section> : order && interrupted ? <section className="store-checkout-success is-interrupted"><PackageCheck /><h1>PEDIDO {order.status === 'REFUNDED' ? 'REEMBOLSADO' : 'CANCELADO'}</h1><p>Este pedido não está mais aguardando pagamento. Consulte o histórico para ver os dados atualizados.</p><b>PEDIDO {order.orderId}</b><button onClick={() => navigate('/store/orders')}>VER MEUS PEDIDOS</button><button onClick={() => navigate('/store')}>VOLTAR PARA A LOJA</button></section> : order && financial?.canShowPix ? <section className="store-checkout-payment"><CheckCircle2 /><h1>PIX GERADO</h1><p>Finalize o pagamento para confirmar o pedido. As Coins do desconto ficam reservadas por até 30 minutos e só são consumidas após a aprovação.</p><b>{cash(order.totalCashAmount)}</b>{payment?.qrCode.encodedImage ? <img className="store-checkout-qr" src={`data:image/png;base64,${payment.qrCode.encodedImage}`} alt="QR Code PIX" /> : null}<strong>{payment?.qrCode.payload || 'Código PIX indisponível; abra a cobrança pelo link.'}</strong>{payment?.qrCode.payload ? <button onClick={() => void copyPix()}><Copy />{copied ? 'COPIADO' : 'COPIAR PIX'}</button> : null}{copyError ? <p className="store-checkout-copy-error" role="alert">{copyError}</p> : null}{payment?.invoiceUrl ? <a href={payment.invoiceUrl} target="_blank" rel="noreferrer"><ExternalLink />ABRIR COBRANÇA</a> : null}<small>Depois de pagar, acompanhe a confirmação em Meus pedidos.</small><button onClick={() => navigate('/store/orders')}>IR PARA MEUS PEDIDOS</button></section> : order ? <section className="store-checkout-financial-block" role="alert"><AlertTriangle /><h1>PIX NÃO DISPONÍVEL</h1><p>A situação atual deste pedido não permite exibir ou copiar a cobrança. Consulte os dados atualizados em Meus pedidos.</p><b>PEDIDO {order.orderId}</b><button onClick={() => navigate('/store/orders')}>VER MEUS PEDIDOS</button></section> : !product ? <section className="store-checkout-success" role="alert"><PackageCheck /><h1>PRODUTO INDISPONÍVEL</h1><p>{error}</p></section> : <form onSubmit={submit}>
      <section className="store-checkout-product"><ProductImage images={product.images} imageStatus={product.imageStatus} name={product.name} /><div><small>{product.category}</small><h1>{product.name}</h1><p>{product.brand}</p><label>Quantidade <input type="number" min="1" max="10" value={quantity} onChange={event => setQuantity(Math.max(1, Math.min(10, Number(event.target.value) || 1)))} /></label></div></section>
      <section className="store-checkout-address"><h2><MapPin />ENDEREÇO DE ENTREGA</h2><div><label>Nome do destinatário<input required value={address.recipientName} onChange={event => updateAddress('recipientName', event.target.value)} /></label><label>CEP<input required inputMode="numeric" maxLength={9} value={address.postalCode} onChange={event => updateAddress('postalCode', event.target.value)} /></label><label className="is-wide">Rua<input required value={address.street} onChange={event => updateAddress('street', event.target.value)} /></label><label>Número<input required value={address.number} onChange={event => updateAddress('number', event.target.value)} /></label><label>Complemento<input value={address.complement || ''} onChange={event => updateAddress('complement', event.target.value)} /></label><label>Bairro<input required value={address.district} onChange={event => updateAddress('district', event.target.value)} /></label><label>Cidade<input required value={address.city} onChange={event => updateAddress('city', event.target.value)} /></label><label>UF<input required maxLength={2} value={address.state} onChange={event => updateAddress('state', event.target.value.toUpperCase())} /></label></div></section>
      <section className="store-checkout-summary"><h2>RESUMO</h2><p><span>Produto</span><b>{quantity} × {product.name}</b></p>{mode !== 'drop' ? <p><span>{mode === 'discount' ? 'Preço com desconto' : 'Preço normal'}</span><b>{productTotal !== null ? cash(productTotal) : 'A definir'}</b></p> : null}{mode !== 'money' && coinsTotal !== null ? <p><span>{mode === 'drop' ? 'Total do Drop' : 'Coins reservados'}</span><b><Coins />{coinsTotal.toLocaleString('pt-BR')} Coins</b></p> : null}<p><span>Frete</span><b>{mode === 'drop' ? 'Conforme o Drop' : 'Calculado no servidor'}</b></p><small><Truck />O valor final em dinheiro e o estoque são confirmados pelo servidor.</small></section>
      {error ? <p className="store-checkout-error" role="alert">{error}</p> : null}<button className="store-checkout-submit" disabled={submitting || !canSubmit}>{submitting ? 'PROCESSANDO…' : mode === 'drop' ? 'CONFIRMAR RESGATE' : 'GERAR PAGAMENTO PIX'}</button>
    </form>}
  </div></main>, document.body);
}
