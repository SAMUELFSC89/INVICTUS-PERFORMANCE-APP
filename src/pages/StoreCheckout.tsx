import { FormEvent, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, CheckCircle2, Coins, LockKeyhole, MapPin, PackageCheck, Truck } from 'lucide-react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ProductImage } from '../components/ProductImage';
import { auth } from '../firebase';
import type { PhysicalOrder, PhysicalShippingAddress, PublicPhysicalProduct } from '../types';
import './StoreCheckout.css';

type Payload = { product?: PublicPhysicalProduct; order?: PhysicalOrder; error?: string };
const emptyAddress: PhysicalShippingAddress = { recipientName: '', postalCode: '', street: '', number: '', complement: '', district: '', city: '', state: '' };

export function StoreCheckout() {
  const navigate = useNavigate();
  const { productId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const mode = searchParams.get('mode') === 'coins' ? 'coins' : 'money';
  const [product, setProduct] = useState<PublicPhysicalProduct | null>(null);
  const [address, setAddress] = useState<PhysicalShippingAddress>(emptyAddress);
  const [quantity, setQuantity] = useState(1);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<PhysicalOrder | null>(null);

  const authenticatedRequest = async (url: string, init?: RequestInit) => {
    const token = await auth.currentUser?.getIdToken();
    if (!token) throw new Error('Sessão inválida.');
    return fetch(url, { ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init?.headers || {}) } });
  };
  useEffect(() => { let active = true; (async () => { try { const query = new URLSearchParams({ action: 'product', productId }); const response = await authenticatedRequest(`/api/store?${query}`); const data: Payload = await response.json(); if (!response.ok || !data.product) throw new Error(data.error || 'Produto indisponível.'); if (active) setProduct(data.product); } catch (reason: any) { if (active) setError(reason.message); } finally { if (active) setLoading(false); } })(); return () => { active = false; }; }, [productId]);
  const totalCoins = useMemo(() => product?.coinPrice ? product.coinPrice * quantity : null, [product?.coinPrice, quantity]);
  const updateAddress = (key: keyof PhysicalShippingAddress, value: string) => setAddress(current => ({ ...current, [key]: value }));
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError(null);
    if (mode === 'money') { setError('O gateway do checkout físico ainda não foi configurado. Nenhuma cobrança foi criada.'); return; }
    setSubmitting(true);
    try {
      const idempotencyKey = crypto.randomUUID();
      const response = await authenticatedRequest('/api/store?action=redeem-with-coins', { method: 'POST', body: JSON.stringify({ productId, quantity, address, idempotencyKey }) });
      const data: Payload = await response.json();
      if (!response.ok || !data.order) throw new Error(data.error || 'Não foi possível concluir o resgate.');
      setOrder(data.order);
    } catch (reason: any) { setError(reason.message); } finally { setSubmitting(false); }
  };

  return createPortal(<main className="store-checkout-screen"><div className="store-checkout-page"><header><button onClick={() => navigate(`/store/product/${productId}`)}><ArrowLeft /></button><div><b>CHECKOUT INVICTUS</b><span>{mode === 'coins' ? 'RESGATE COM COINS' : 'COMPRA DE PRODUTO FÍSICO'}</span></div><LockKeyhole /></header>
    {loading ? <p className="store-checkout-message">Carregando…</p> : order ? <section className="store-checkout-success"><CheckCircle2 /><h1>RESGATE CONFIRMADO</h1><p>Seu pedido entrou em processamento. Você poderá acompanhar as próximas etapas pelo histórico da Loja.</p><b>PEDIDO {order.orderId}</b><button onClick={() => navigate('/store')}>VOLTAR PARA A LOJA</button></section> : !product ? <section className="store-checkout-success"><PackageCheck /><h1>PRODUTO INDISPONÍVEL</h1><p>{error}</p></section> : <form onSubmit={submit}>
      <section className="store-checkout-product"><ProductImage images={product.images} imageStatus={product.imageStatus} name={product.name} /><div><small>{product.category}</small><h1>{product.name}</h1><p>{product.brand}</p><label>Quantidade <input type="number" min="1" max="10" value={quantity} onChange={event => setQuantity(Math.max(1, Math.min(10, Number(event.target.value) || 1)))} /></label></div></section>
      <section className="store-checkout-address"><h2><MapPin />ENDEREÇO DE ENTREGA</h2><div><label>Nome do destinatário<input required value={address.recipientName} onChange={event => updateAddress('recipientName', event.target.value)} /></label><label>CEP<input required inputMode="numeric" maxLength={9} value={address.postalCode} onChange={event => updateAddress('postalCode', event.target.value)} /></label><label className="is-wide">Rua<input required value={address.street} onChange={event => updateAddress('street', event.target.value)} /></label><label>Número<input required value={address.number} onChange={event => updateAddress('number', event.target.value)} /></label><label>Complemento<input value={address.complement || ''} onChange={event => updateAddress('complement', event.target.value)} /></label><label>Bairro<input required value={address.district} onChange={event => updateAddress('district', event.target.value)} /></label><label>Cidade<input required value={address.city} onChange={event => updateAddress('city', event.target.value)} /></label><label>UF<input required maxLength={2} value={address.state} onChange={event => updateAddress('state', event.target.value.toUpperCase())} /></label></div></section>
      <section className="store-checkout-summary"><h2>RESUMO</h2><p><span>Produto</span><b>{quantity} × {product.name}</b></p><p><span>{mode === 'coins' ? 'Total em Coins' : 'Total em dinheiro'}</span><b>{mode === 'coins' ? totalCoins?.toLocaleString('pt-BR') || 'A definir' : product.cashPrice?.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) || 'A definir'}</b></p><p><span>Frete</span><b>{mode === 'coins' ? 'Conforme regra do Drop' : 'A calcular'}</b></p><small><Truck />Nenhum valor adicional será criado sem aparecer nesta etapa.</small></section>
      {error ? <p className="store-checkout-error">{error}</p> : null}<button className="store-checkout-submit" disabled={submitting || (mode === 'coins' ? !product.availableForDrop : !product.availableForPurchase)}>{submitting ? 'PROCESSANDO…' : mode === 'coins' ? 'CONFIRMAR RESGATE' : 'CONTINUAR PARA PAGAMENTO'}</button>
    </form>}
  </div></main>, document.body);
}
