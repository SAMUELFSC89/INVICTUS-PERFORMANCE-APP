import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Bell, CalendarDays, ChevronRight, Coins, Gift, Info, PackageOpen, Plus, ShieldCheck, ShoppingBag, Trophy, Truck, UserRound } from 'lucide-react';
import { InvictusLogo } from '../components/InvictusLogo';
import { ProductImage } from '../components/ProductImage';
import { auth } from '../firebase';
import type { PublicPhysicalProduct, RewardCoinTransaction, RewardCoinWallet } from '../types';
import './InvictusStore.css';
import './InvictusStoreExtras.css';
import './InvictusStoreMobile.css';

type StorePayload = { products?: PublicPhysicalProduct[]; activeDrop?: { id:string; name:string|null; productId?:string|null; coinPrice?:number|null; availableStock?:number|null; limitPerUser?:number|null; startsAt:string|null; endsAt:string|null; status?:string|null } | null; coinWallet?:RewardCoinWallet; coinTransactions?:RewardCoinTransaction[]; error?:string };
const CATEGORIES = ['Todos','Suplementos','Bem-estar e Nutrição','Vestuário','Acessórios','Nutrição','Combos'] as const;
const cash = (value:number) => value.toLocaleString('pt-BR',{style:'currency',currency:'BRL'});

export function InvictusStore() {
  const navigate = useNavigate();
  const [products, setProducts] = useState<PublicPhysicalProduct[]>([]);
  const [wallet, setWallet] = useState<RewardCoinWallet | null>(null);
  const [transactions, setTransactions] = useState<RewardCoinTransaction[]>([]);
  const [activeDrop, setActiveDrop] = useState<StorePayload['activeDrop']>(null);
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>('Todos');
  const [showHistory, setShowHistory] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { (async () => { try { const token = await auth.currentUser?.getIdToken(); if (!token) throw new Error('Sessão inválida.'); const response = await fetch('/api/store', { headers: { Authorization: `Bearer ${token}` } }); const data:StorePayload = await response.json(); if (!response.ok) throw new Error(data.error || 'Não foi possível carregar a loja.'); setProducts(Array.isArray(data.products) ? data.products : []); setWallet(data.coinWallet || null); setTransactions(Array.isArray(data.coinTransactions) ? data.coinTransactions : []); setActiveDrop(data.activeDrop || null); } catch (reason:any) { setError(reason.message); } finally { setLoading(false); } })(); }, []);
  const visible = useMemo(() => products.filter(product => category === 'Todos' || product.category === category), [products, category]);
  const nextDropLabel = activeDrop?.startsAt && Number.isFinite(Date.parse(activeDrop.startsAt)) ? new Date(activeDrop.startsAt).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}) : 'A definir';

  return createPortal(<main className="store-screen"><div className="store-page">
    <header className="store-header"><span /><div><InvictusLogo size={45} /><b>INVICTUS</b><small>PERFORMANCE</small></div><button onClick={() => navigate('/notifications')} aria-label="Notificações"><Bell /></button></header>
    <section className="store-overview"><button className="store-coins" onClick={() => setShowHistory(value => !value)}><span>SEUS COINS</span><strong>{wallet ? wallet.balance.toLocaleString('pt-BR') : '—'} <Coins /></strong><small>Seu empenho. Suas conquistas.</small><ChevronRight /></button><article className="store-drop"><span>PRÓXIMO DROP</span><strong>{activeDrop?.name || 'Em preparação'}</strong><b>{nextDropLabel}</b><CalendarDays /><button onClick={() => setShowInfo(true)}>VER DROP <ChevronRight /></button></article></section>
    {showHistory ? <section className="store-history"><h2>HISTÓRICO DE COINS</h2>{transactions.length ? transactions.map(transaction => <article key={transaction.id}><Coins /><span><b>{transaction.description}</b><small>{new Date(transaction.createdAt).toLocaleDateString('pt-BR')}</small></span><strong>{transaction.type === 'credit' ? '+' : '-'}{transaction.amount.toLocaleString('pt-BR')}</strong></article>) : <p>Nenhuma movimentação de Invictus Coins registrada.</p>}</section> : null}
    <section className="store-intro"><div><h1>LOJA INVICTUS</h1><p>Resgate produtos exclusivos, Drops limitados e recompensas com seus Invictus Coins.</p></div><div className="store-intro-actions"><button onClick={() => navigate('/store/orders')}>MEUS PEDIDOS <PackageOpen /></button><button onClick={() => setShowInfo(true)}>COMO FUNCIONA <Info /></button></div></section>
    <nav className="store-categories" aria-label="Categorias da loja">{CATEGORIES.map(item => <button key={item} className={item === category ? 'is-active' : ''} onClick={() => setCategory(item)}>{item.toUpperCase()}</button>)}</nav>
    {error ? <p className="store-error">{error}</p> : loading ? <p className="store-loading">Carregando catálogo…</p> : visible.length === 0 ? <section className="store-empty"><PackageOpen /><h2>NENHUM PRODUTO NESTA CATEGORIA</h2><p>Os produtos desta categoria ainda não foram cadastrados.</p></section> : <section className="store-products">{visible.map(product => <article key={product.productId} className={product.productStatus === 'COMING_SOON' ? 'is-coming-soon' : ''}><ProductImage images={product.images} imageStatus={product.imageStatus} name={product.name} /><h3>{product.name}</h3><p>{product.brand}{product.weight ? ` • ${product.weight}${product.weightUnit || ''}` : product.package ? ` • ${product.package}` : ''}</p>{product.productStatus === 'COMING_SOON' ? <><strong className="store-coming-soon">EM BREVE</strong><button className="store-coming-cta" disabled>EM BREVE</button></> : <><strong className="store-cash">{product.cashPrice !== null && product.canPurchaseWithCash ? cash(product.cashPrice) : 'PREÇO A DEFINIR'}</strong>{product.canPurchaseWithCoinsDiscount && product.coinDiscountPrice !== null && product.coinDiscountAmount !== null ? <small className="store-coin-discount"><Coins /> {cash(product.coinDiscountPrice)} + {product.coinDiscountAmount.toLocaleString('pt-BR')} Coins</small> : null}{product.drop ? <small className={`store-drop-state is-${product.dropState.toLowerCase()}`}>{product.dropState === 'OPEN' ? `DROP: ${product.drop.coinPrice?.toLocaleString('pt-BR') || '—'} COINS` : product.dropState === 'SOLD_OUT' ? 'DROP ESGOTADO' : product.dropState === 'UPCOMING' ? 'DISPONÍVEL NO PRÓXIMO DROP' : 'DROP EM PREPARAÇÃO'}</small> : null}<button className="store-detail" onClick={() => navigate(`/store/product/${product.productId}`)}>VER PRODUTO <ChevronRight /></button></>}</article>)}</section>}
    <section className="store-info"><article><Truck /><b>FRETE CONFIGURÁVEL</b><span>Calculado no checkout</span></article><article><Coins /><b>PRODUTOS EXCLUSIVOS</b><span>Coins não são vendidos</span></article><article><Gift /><b>DROPS LIMITADOS</b><span>Estoque reservado</span></article><article><ShieldCheck /><b>100% SEGURO</b><span>Pedidos rastreáveis</span></article></section>
  </div><nav className="store-footer"><button onClick={() => navigate('/')}><InvictusLogo size={24} /><span>Início</span></button><button onClick={() => navigate('/championships')}><Trophy /><span>Campeonatos</span></button><button className="is-plus" onClick={() => navigate('/activity')} aria-label="Escolher modalidade"><Plus /></button><button onClick={() => navigate('/challenges')}><ShieldCheck /><span>Desafios</span></button><button className="is-active" onClick={() => navigate('/profile')}><UserRound /><span>Perfil</span></button></nav>
  {showInfo ? <div className="store-modal" role="dialog" aria-modal="true" onClick={() => setShowInfo(false)}><section onClick={event => event.stopPropagation()}><ShoppingBag /><h2>COMO FUNCIONA</h2><p>Produtos publicados podem ser comprados normalmente quando houver preço e estoque comercial. Resgates com Coins acontecem somente durante Drops e usam um estoque separado.</p><p>Invictus Coins são recompensas do ecossistema, não possuem valor em dinheiro, não são vendidas e não podem ser sacadas.</p><button onClick={() => setShowInfo(false)}>ENTENDI</button></section></div> : null}
  </main>, document.body);
}
