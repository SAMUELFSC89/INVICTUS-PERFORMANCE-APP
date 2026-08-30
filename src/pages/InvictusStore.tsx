import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Box, ChevronRight, Coins, Gift, History, PackageOpen, Plus, ShieldCheck, ShoppingBag, Sparkles, Trophy, UserRound } from 'lucide-react';
import { InvictusLogo } from '../components/InvictusLogo';
import { auth } from '../firebase';
import { useUser } from '../UserContext';
import type { RewardCoinTransaction, RewardCoinWallet, StoreItem } from '../types';
import './InvictusStore.css';

export function InvictusStore() {
  const navigate = useNavigate();
  const { user } = useUser();
  const [items, setItems] = useState<StoreItem[]>([]);
  const [wallet, setWallet] = useState<RewardCoinWallet | null>(null);
  const [transactions, setTransactions] = useState<RewardCoinTransaction[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { (async () => { try { const token = await auth.currentUser?.getIdToken(); if (!token) throw new Error('Sessão inválida.'); const response = await fetch('/api/store', { headers: { Authorization: `Bearer ${token}` } }); const data = await response.json(); if (!response.ok || !data.success) throw new Error(data.error || 'Não foi possível carregar a loja.'); setItems(Array.isArray(data.items) ? data.items : []); setWallet(data.coinWallet || null); setTransactions(Array.isArray(data.coinTransactions) ? data.coinTransactions : []); } catch (reason: any) { setError(reason.message); } finally { setLoading(false); } })(); }, []);

  return createPortal(<main className="store-screen"><div className="store-page">
    <header className="store-header"><button onClick={() => navigate('/profile')} aria-label="Voltar ao perfil"><ArrowLeft /></button><div><InvictusLogo size={45} /><b>INVICTUS</b><small>PERFORMANCE</small></div><button className="store-avatar" onClick={() => navigate('/profile')}>{user?.photoURL ? <img src={user.photoURL} alt="" /> : <UserRound />}</button></header>
    <section className="store-intro"><div><h1>LOJA <span>INVICTUS</span></h1><p>Treine. Conquiste. Resgate.</p><small>Seus Invictus Coins poderão virar recompensas.</small></div><aside><Coins /><span>SEUS COINS</span><b>{wallet ? wallet.balance.toLocaleString('pt-BR') : '—'}</b><button onClick={() => setShowHistory(value => !value)}><History /> HISTÓRICO <ChevronRight /></button></aside></section>
    {showHistory ? <section className="store-history"><h2>HISTÓRICO DE COINS</h2>{transactions.length ? transactions.map(transaction => <article key={transaction.id}><Coins /><span><b>{transaction.description}</b><small>{new Date(transaction.createdAt).toLocaleDateString('pt-BR')}</small></span><strong>{transaction.type === 'credit' ? '+' : '-'}{transaction.amount}</strong></article>) : <p>Nenhuma movimentação de Invictus Coins registrada.</p>}</section> : null}
    <section className="store-banner"><Sparkles /><div><small>EM PREPARAÇÃO</small><h2>TREINE MAIS.<br/><span>CONQUISTE MAIS.</span></h2><p>Acumule Invictus Coins completando desafios válidos. O catálogo oficial será publicado aqui.</p></div></section>
    <div className="store-title"><h2>PRODUTOS</h2><span>CATÁLOGO EM PREPARAÇÃO</span></div>
    {error ? <p className="store-error">{error}</p> : loading ? <p className="store-loading">Carregando loja…</p> : items.length === 0 ? <section className="store-empty"><PackageOpen /><h2>NOVAS RECOMPENSAS EM BREVE</h2><p>Os produtos oficiais ainda estão sendo definidos. Nenhum item fictício foi exibido e nenhum resgate está disponível no momento.</p></section> : <section className="store-products">{items.map(item => <article key={item.id}>{item.iconUrl ? <img src={item.iconUrl} alt="" /> : <Box />}<h3>{item.name}</h3><p>{item.description}</p><strong><Coins /> {item.priceCoins.toLocaleString('pt-BR')}</strong></article>)}</section>}
    <section className="store-info"><article><Coins /><b>COMO GANHAR</b><span>Conclua desafios validados</span></article><article><Gift /><b>RESGATE</b><span>Produtos oficiais na loja</span></article><article><ShieldCheck /><b>SEM DINHEIRO</b><span>Coins não são sacáveis</span></article><article><ShoppingBag /><b>CATÁLOGO REAL</b><span>Somente itens publicados</span></article></section>
  </div><nav className="store-footer"><button onClick={() => navigate('/')}><InvictusLogo size={24} /><span>Início</span></button><button onClick={() => navigate('/championships')}><Trophy /><span>Campeonatos</span></button><button className="is-plus" onClick={() => navigate('/musculacao')} aria-label="Abrir construção do treino"><Plus /></button><button onClick={() => navigate('/challenges')}><ShieldCheck /><span>Desafios</span></button><button className="is-active" onClick={() => navigate('/profile')}><UserRound /><span>Perfil</span></button></nav></main>, document.body);
}
