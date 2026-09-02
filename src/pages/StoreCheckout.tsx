import { FormEvent, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, CheckCircle2, Coins, Copy, ExternalLink, LockKeyhole, MapPin, PackageCheck, Truck } from 'lucide-react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ProductImage } from '../components/ProductImage';
import { auth } from '../firebase';
import type { PhysicalOrder, PhysicalShippingAddress, PublicPhysicalProduct } from '../types';
import './StoreCheckout.css';

type CheckoutMode = 'money' | 'discount' | 'drop';
type PaymentPayload = { provider: string; paymentId: string; invoiceUrl: string | null; qrCode: { encodedImage?: string; payload?: string; expirationDate?: string } };
type Payload = { product?: PublicPhysicalProduct; order?: PhysicalOrder; payment?: PaymentPayload; error?: string };
const emptyAddress: PhysicalShippingAddress = { recipientName: '', postalCode: '', street: '', number: '', complement: '', district: '', city: '', state: '' };
const cash = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function readMode(value: string | null): CheckoutMode {
  return value === 'discount' || value === 'drop' ? value : 'money';
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
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<PhysicalOrder | null>(null);
  const [payment, setPayment] = useState<PaymentPayload | null>(null);
  const [copied, setCopied] = useState(false);

  const authenticatedRequest = async (url: string, init?: RequestInit) => {
    const token = await auth.currentUser?.getIdToken();
    if (!token) throw new Error('Sessão inválida.');
    return fetch(url, { ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init?.headers || {}) } });
  };

  useEffect(() => {
    let active = true;
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
      const idempotencyKey = crypto.randomUUID();
      const action = mode === 'drop' ? 'redeem-with-coins' : 'create-cash-order';
      const body = mode === 'drop'
        ? { productId, quantity, address, idempotencyKey }
        : { productId, quantity, address, idempotencyKey, paymentMethod: mode === 'discount' ? 'COINS_PLUS_MONEY' : 'MONEY' };
      const response = await authenticatedRequest(`/api/store?action=${action}`, { method: 'POST', body: JSON.stringify(body) });
      const data: Payload = await response.json();
      if (!response.ok || !data.order) throw new Error(data.error || 'Não foi possível concluir o pedido.');
      setOrder(data.order);
      setPayment(data.payment || null);
    } catch (reason: any) {
      setError(reason?.message || 'Não foi possível concluir o pedido.');
    } finally {
      setSubmitting(false);
    }
  };

  const copyPix = async () => {
    if (!payment?.qrCode.payload) return;
    await navigator.clipboard?.writeText(payment.qrCode.payload);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const success = order && (mode === 'drop' || order.status === 'PAID');
  const canSubmit = mode === 'drop' ? Boolean(product?.availableForDrop) : Boolean(product?.availableForPurchase && (mode === 'money' || (product?.canPurchaseWithCoinsDiscount && product.coinDiscountPrice && product.coinDiscountAmount)));

  return createPortal(<main className="store-checkout-screen"><div className="store-checkout-page"><header><button onClick={() => navigate(`/store/product/${productId}`)}><ArrowLeft /></button><div><b>CHECKOUT INVICTUS</b><span>{title}</span></div><LockKeyhole /></header>
    {loading ? <p className="store-checkout-message">Carregando…</p> : order && success ? <section className="store-checkout-success"><CheckCircle2 /><h1>{mode === 'drop' ? 'RESGATE CONFIRMADO' : 'PAGAMENTO CONFIRMADO'}</h1><p>{mode === 'drop' ? 'Seu pedido entrou em processamento. Você poderá acompanhar as próximas etapas pelo histórico da Loja.' : 'Recebemos o pagamento e reservamos o pedido para preparação.'}</p><b>PEDIDO {order.orderId}</b><button onClick={() => navigate('/store/orders')}>ACOMPANHAR PEDIDO</button><button onClick={() => navigate('/store')}>VOLTAR PARA A LOJA</button></section> : order ? <section className="store-checkout-payment"><CheckCircle2 /><h1>PIX GERADO</h1><p>Finalize o pagamento para confirmar o pedido. As Coins do desconto ficam reservadas por até 30 minutos e só são consumidas após a aprovação.</p><b>{cash(order.totalCashAmount)}</b>{payment?.qrCode.encodedImage ? <img className="store-checkout-qr" src={`data:image/png;base64,${payment.qrCode.encodedImage}`} alt="QR Code PIX" /> : null}<strong>{payment?.qrCode.payload || 'Código PIX indisponível; abra a cobrança pelo link.'}</strong>{payment?.qrCode.payload ? <button onClick={copyPix}><Copy />{copied ? 'COPIADO' : 'COPIAR PIX'}</button> : null}{payment?.invoiceUrl ? <a href={payment.invoiceUrl} target="_blank" rel="noreferrer"><ExternalLink />ABRIR COBRANÇA</a> : null}<small>Depois de pagar, acompanhe a confirmação em Meus pedidos.</small><button onClick={() => navigate('/store/orders')}>IR PARA MEUS PEDIDOS</button></section> : !product ? <section className="store-checkout-success"><PackageCheck /><h1>PRODUTO INDISPONÍVEL</h1><p>{error}</p></section> : <form onSubmit={submit}>
      <section className="store-checkout-product"><ProductImage images={product.images} imageStatus={product.imageStatus} name={product.name} /><div><small>{product.category}</small><h1>{product.name}</h1><p>{product.brand}</p><label>Quantidade <input type="number" min="1" max="10" value={quantity} onChange={event => setQuantity(Math.max(1, Math.min(10, Number(event.target.value) || 1)))} /></label></div></section>
      <section className="store-checkout-address"><h2><MapPin />ENDEREÇO DE ENTREGA</h2><div><label>Nome do destinatário<input required value={address.recipientName} onChange={event => updateAddress('recipientName', event.target.value)} /></label><label>CEP<input required inputMode="numeric" maxLength={9} value={address.postalCode} onChange={event => updateAddress('postalCode', event.target.value)} /></label><label className="is-wide">Rua<input required value={address.street} onChange={event => updateAddress('street', event.target.value)} /></label><label>Número<input required value={address.number} onChange={event => updateAddress('number', event.target.value)} /></label><label>Complemento<input value={address.complement || ''} onChange={event => updateAddress('complement', event.target.value)} /></label><label>Bairro<input required value={address.district} onChange={event => updateAddress('district', event.target.value)} /></label><label>Cidade<input required value={address.city} onChange={event => updateAddress('city', event.target.value)} /></label><label>UF<input required maxLength={2} value={address.state} onChange={event => updateAddress('state', event.target.value.toUpperCase())} /></label></div></section>
      <section className="store-checkout-summary"><h2>RESUMO</h2><p><span>Produto</span><b>{quantity} × {product.name}</b></p>{mode !== 'drop' ? <p><span>{mode === 'discount' ? 'Preço com desconto' : 'Preço normal'}</span><b>{productTotal !== null ? cash(productTotal) : 'A definir'}</b></p> : null}{mode !== 'money' && coinsTotal !== null ? <p><span>{mode === 'drop' ? 'Total do Drop' : 'Coins reservados'}</span><b><Coins />{coinsTotal.toLocaleString('pt-BR')} Coins</b></p> : null}<p><span>Frete</span><b>{mode === 'drop' ? 'Conforme o Drop' : 'Calculado no servidor'}</b></p><small><Truck />O valor final em dinheiro e o estoque são confirmados pelo servidor.</small></section>
      {error ? <p className="store-checkout-error">{error}</p> : null}<button className="store-checkout-submit" disabled={submitting || !canSubmit}>{submitting ? 'PROCESSANDO…' : mode === 'drop' ? 'CONFIRMAR RESGATE' : 'GERAR PAGAMENTO PIX'}</button>
    </form>}
  </div></main>, document.body);
}
