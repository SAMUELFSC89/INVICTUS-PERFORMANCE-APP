import { useEffect, useState } from 'react';
import { Ban, CheckCircle2, PackageCheck, RefreshCw, Truck } from 'lucide-react';
import { auth } from '../firebase';
import type { PhysicalOrder, PhysicalOrderItemSnapshot } from '../types';
import './AdminStoreOrders.css';

type AdminOrder = PhysicalOrder & { items: PhysicalOrderItemSnapshot[] };
const statusLabel: Record<PhysicalOrder['status'], string> = { PENDING_PAYMENT: 'Aguardando pagamento', PAID: 'Pago', PROCESSING: 'Em preparação', SHIPPED: 'Enviado', DELIVERED: 'Entregue', CANCELLED: 'Cancelado', REFUNDED: 'Reembolsado' };
async function request(action: string, init?: RequestInit) { const token = await auth.currentUser?.getIdToken(); if (!token) throw new Error('Sessão inválida.'); const response = await fetch(`/api/store?action=${action}`, { ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init?.headers || {}) } }); const data = await response.json(); if (!response.ok || !data.success) throw new Error(data.error || 'Falha ao atualizar pedido.'); return data; }

export function AdminStoreOrders() {
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [tracking, setTracking] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const load = async () => { setError(null); try { const data = await request('admin-orders'); setOrders(data.orders || []); } catch (reason: any) { setError(reason.message); } };
  useEffect(() => { void load(); }, []);
  const changeStatus = async (order: AdminOrder, status: PhysicalOrder['status']) => { setBusy(true); setError(null); try { await request('update-order-status', { method: 'POST', body: JSON.stringify({ orderId: order.orderId, status, trackingCode: tracking[order.orderId] || '' }) }); setMessage(`Pedido atualizado para: ${statusLabel[status]}.`); await load(); } catch (reason: any) { setError(reason.message); } finally { setBusy(false); } };
  return <div className="admin-orders"><header><div><h1>PEDIDOS DA LOJA</h1><p>Fulfillment, rastreio, entrega e cancelamento auditável.</p></div><button onClick={load}><RefreshCw />ATUALIZAR</button></header>{error ? <p className="admin-orders-error">{error}</p> : null}{message ? <p className="admin-orders-message">{message}</p> : null}<section>{orders.length ? orders.map(order => <article key={order.orderId}><header><div><PackageCheck /><span><b>{order.orderId}</b><small>{new Date(order.createdAt).toLocaleString('pt-BR')} · {order.userId}</small></span></div><em className={`is-${order.status.toLowerCase()}`}>{statusLabel[order.status]}</em></header><div className="admin-orders-items">{order.items.map(item => <p key={item.productId}><span>{item.quantity} × {item.name}</span><small>GTIN {item.gtin} · custo snapshot R$ {item.supplierCostSnapshot.toFixed(2)}</small></p>)}</div><footer><span>{order.paymentMethod === 'COINS' ? `${order.totalCoinAmount.toLocaleString('pt-BR')} Coins` : order.totalCashAmount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>{order.status === 'PROCESSING' ? <><input value={tracking[order.orderId] || ''} onChange={event => setTracking(current => ({ ...current, [order.orderId]: event.target.value }))} placeholder="Código de rastreio" /><button disabled={busy} onClick={() => changeStatus(order, 'SHIPPED')}><Truck />MARCAR ENVIADO</button><button className="is-danger" disabled={busy} onClick={() => changeStatus(order, 'CANCELLED')}><Ban />CANCELAR E ESTORNAR</button></> : null}{order.status === 'SHIPPED' ? <button disabled={busy} onClick={() => changeStatus(order, 'DELIVERED')}><CheckCircle2 />MARCAR ENTREGUE</button> : null}</footer></article>) : <p className="admin-orders-empty">Nenhum pedido físico registrado.</p>}</section></div>;
}
