import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Box, CheckCircle2, Clock3, Coins, PackageCheck, Truck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { auth } from '../firebase';
import type { PhysicalOrder, PhysicalOrderItemSnapshot } from '../types';
import './StoreOrders.css';

type PublicItem = Omit<PhysicalOrderItemSnapshot, 'supplierCostSnapshot'>;
type PublicOrder = PhysicalOrder & { items: PublicItem[] };
const status: Record<PhysicalOrder['status'], string> = { PENDING_PAYMENT: 'Aguardando pagamento', PAID: 'Pagamento aprovado', PROCESSING: 'Em preparação', SHIPPED: 'Enviado', DELIVERED: 'Entregue', CANCELLED: 'Cancelado', REFUNDED: 'Reembolsado' };
const StatusIcon = ({ value }: { value: PhysicalOrder['status'] }) => value === 'DELIVERED' ? <CheckCircle2 /> : value === 'SHIPPED' ? <Truck /> : value === 'PROCESSING' || value === 'PAID' ? <PackageCheck /> : <Clock3 />;

export function StoreOrders() {
  const navigate = useNavigate();
  const [orders, setOrders] = useState<PublicOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { (async () => { try { const token = await auth.currentUser?.getIdToken(); if (!token) throw new Error('Sessão inválida.'); const response = await fetch('/api/store?action=my-orders', { headers: { Authorization: `Bearer ${token}` } }); const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Não foi possível carregar os pedidos.'); setOrders(data.orders || []); } catch (reason: any) { setError(reason.message); } finally { setLoading(false); } })(); }, []);
  return createPortal(<main className="store-orders-screen"><div className="store-orders-page"><header><button onClick={() => navigate('/store')}><ArrowLeft /></button><div><h1>MEUS PEDIDOS</h1><p>Acompanhe compras e resgates da Loja Invictus.</p></div><Box /></header>{loading ? <p className="store-orders-message">Carregando pedidos…</p> : error ? <p className="store-orders-error">{error}</p> : orders.length === 0 ? <section className="store-orders-empty"><Box /><h2>NENHUM PEDIDO AINDA</h2><p>Suas compras e resgates aparecerão aqui.</p><button onClick={() => navigate('/store')}>EXPLORAR A LOJA</button></section> : <section className="store-orders-list">{orders.map(order => <article key={order.orderId}><header><span><StatusIcon value={order.status} /><b>{status[order.status]}</b></span><small>{new Date(order.createdAt).toLocaleString('pt-BR')}</small></header>{order.items.map(item => <div key={`${order.orderId}-${item.productId}`}><PackageCheck /><span><b>{item.name}</b><small>Quantidade: {item.quantity}{item.discountMode === 'COINS_DISCOUNT' ? ` · ${item.coinAmountUsed.toLocaleString('pt-BR')} Coins no desconto` : ''}</small></span></div>)}<footer><span>Pedido {order.orderId}</span><b>{order.paymentMethod === 'COINS' ? <><Coins />{order.totalCoinAmount.toLocaleString('pt-BR')} Coins</> : <>{order.totalCashAmount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}{order.totalCoinAmount ? <> + <Coins />{order.totalCoinAmount.toLocaleString('pt-BR')} Coins</> : null}</>}</b></footer></article>)}</section>}</div></main>, document.body);
}
