import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, CalendarDays, Coins, PackageCheck, ShieldCheck, ShoppingBag, Truck } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { InvictusLogo } from '../components/InvictusLogo';
import { ProductImage } from '../components/ProductImage';
import { auth } from '../firebase';
import type { PublicPhysicalProduct } from '../types';
import './StoreProductDetail.css';
import './StoreProductComingSoon.css';

type ProductPayload = { product?: PublicPhysicalProduct; error?: string };
const cash = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function StoreProductDetail() {
  const navigate = useNavigate();
  const { productId = '' } = useParams();
  const [product, setProduct] = useState<PublicPhysicalProduct | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const token = await auth.currentUser?.getIdToken();
        if (!token) throw new Error('Sessão inválida.');
        const query = new URLSearchParams({ action: 'product', productId });
        const response = await fetch(`/api/store?${query}`, { headers: { Authorization: `Bearer ${token}` } });
        const data: ProductPayload = await response.json();
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

  const packageLabel = product ? [product.flavor, product.weight ? `${product.weight}${product.weightUnit || ''}` : null, product.package].filter(Boolean).join(' • ') : '';
  const cashPending = product?.cashPrice === null;
  const discountAvailable = Boolean(product?.canPurchaseWithCoinsDiscount && product.coinDiscountPrice !== null && product.coinDiscountAmount !== null);

  return createPortal(
    <main className="product-detail-screen">
      <div className="product-detail-page">
        <header className="product-detail-header">
          <button onClick={() => navigate('/store')} aria-label="Voltar para a loja"><ArrowLeft /></button>
          <div><InvictusLogo size={42} /><span><b>INVICTUS</b><small>PERFORMANCE</small></span></div>
          <span />
        </header>

        {loading ? <p className="product-detail-message">Carregando produto…</p> : error || !product ? <section className="product-detail-error"><ShoppingBag /><h1>PRODUTO INDISPONÍVEL</h1><p>{error}</p><button onClick={() => navigate('/store')}>VOLTAR PARA A LOJA</button></section> : <>
          <section className="product-detail-hero">
            <ProductImage images={product.images} imageStatus={product.imageStatus} name={product.name} variant="detail" />
            <div className="product-detail-copy">
              <span className="product-detail-category">{product.category.toUpperCase()}</span>
              <h1>{product.name}</h1>
              <p className="product-detail-brand">{product.brand}{packageLabel ? ` • ${packageLabel}` : ''}</p>
              <p className="product-detail-description">{product.publicDescription?.trim() || (product.productStatus === 'COMING_SOON' ? 'Produto oficial Invictus Performance em desenvolvimento.' : 'As informações oficiais deste produto estão sendo preparadas.')}</p>
              {product.publicHighlights.length ? <ul>{product.publicHighlights.map(item => <li key={item}><PackageCheck />{item}</li>)}</ul> : null}
              {product.gtin ? <small>GTIN {product.gtin}</small> : null}
            </div>
          </section>

          {product.productStatus === 'COMING_SOON' ? <section className="product-detail-coming"><PackageCheck /><span><b>EM BREVE</b><p>Este produto faz parte da futura linha própria Invictus Performance. Compra e resgate serão liberados somente após aprovação comercial.</p></span><button disabled>EM BREVE</button></section> : <section className="product-detail-options">
            <article>
              <ShoppingBag />
              <span>COMPRA NORMAL</span>
              <strong>{cashPending ? 'PREÇO A DEFINIR' : cash(product.cashPrice!)}</strong>
              <p>{cashPending ? 'O valor de venda ainda será definido.' : product.commercialAvailability === 'AVAILABLE' ? 'Disponível para compra.' : 'Estoque comercial indisponível.'}</p>
              <button disabled={!product.availableForPurchase} onClick={() => navigate(`/store/product/${product.productId}/checkout?mode=money`)}>{product.availableForPurchase ? 'COMPRAR AGORA' : 'EM PREPARAÇÃO'}</button>
            </article>
            <article>
              <Coins />
              <span>COMPRA COM DESCONTO</span>
              <strong>{discountAvailable ? `${cash(product.coinDiscountPrice!)} + ${product.coinDiscountAmount!.toLocaleString('pt-BR')} Coins` : 'DESCONTO A DEFINIR'}</strong>
              <p>{discountAvailable ? 'Pague uma parte em dinheiro e use Coins para liberar o preço reduzido.' : 'A opção de desconto ainda está sendo configurada.'}</p>
              <button disabled={!product.availableForPurchase || !discountAvailable} onClick={() => navigate(`/store/product/${product.productId}/checkout?mode=discount`)}>{product.availableForPurchase && discountAvailable ? 'USAR DESCONTO' : 'EM PREPARAÇÃO'}</button>
            </article>
            <article>
              <Coins />
              <span>DROP 100% COINS</span>
              <strong>{product.drop?.coinPrice ? `${product.drop.coinPrice.toLocaleString('pt-BR')} COINS` : 'DROP A DEFINIR'}</strong>
              <p>{product.dropState === 'OPEN' ? 'Drop aberto para resgate.' : product.nextDropAt ? `Próximo Drop: ${new Date(product.nextDropAt).toLocaleString('pt-BR')}` : 'Nenhum Drop aberto para este produto.'}</p>
              <button disabled={!product.availableForDrop} onClick={() => navigate(`/store/product/${product.productId}/checkout?mode=drop`)}>{product.availableForDrop ? 'RESGATAR NO DROP' : 'DROP EM PREPARAÇÃO'}</button>
            </article>
          </section>}

          <section className="product-detail-assurances">
            <article><Coins /><b>COINS CONQUISTADOS</b><span>Não são vendidos nem convertidos em dinheiro.</span></article>
            <article><CalendarDays /><b>DROPS CONTROLADOS</b><span>Período e estoque exclusivos para cada Drop.</span></article>
            <article><Truck /><b>FRETE NO CHECKOUT</b><span>Calculado antes da confirmação do pedido.</span></article>
            <article><ShieldCheck /><b>PEDIDO RASTREÁVEL</b><span>Status acompanhado dentro do aplicativo.</span></article>
          </section>
        </>}
      </div>
    </main>,
    document.body,
  );
}
