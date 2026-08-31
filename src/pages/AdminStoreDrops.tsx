import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Coins, Package, Plus, Save, ShieldAlert } from 'lucide-react';
import { auth } from '../firebase';
import type { PhysicalProduct, StoreDrop } from '../types';
import './AdminStoreDrops.css';

type AdminProduct = PhysicalProduct & { publicationGaps: string[] };
type AdminDrop = StoreDrop & { maximumExposure: number };
const emptyDrop = (): Partial<StoreDrop> => ({ name: '', startsAt: '', endsAt: '', active: false, shippingMode: 'PAID_PENDING', productIds: [], freightSubsidy: 0, packagingCost: 0, otherCosts: 0 });
const localDate = (value?: string) => value ? new Date(value).toISOString().slice(0, 16) : '';
const money = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

async function request(action: string, init?: RequestInit) {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Sessão inválida.');
  const response = await fetch(`/api/store?action=${action}`, { ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init?.headers || {}) } });
  const data = await response.json();
  if (!response.ok || !data.success) throw new Error(data.error || 'Falha ao configurar Drops.');
  return data;
}

export function AdminStoreDrops() {
  const [drops, setDrops] = useState<AdminDrop[]>([]);
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [draft, setDraft] = useState<Partial<StoreDrop>>(emptyDrop());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const load = async () => { try { const [dropData, productData] = await Promise.all([request('admin-drops'), request('admin-products')]); setDrops(dropData.drops || []); setProducts(productData.products || []); } catch (reason: any) { setError(reason.message); } };
  useEffect(() => { void load(); }, []);
  const selectedProducts = useMemo(() => new Set(draft.productIds || []), [draft.productIds]);
  const estimatedExposure = useMemo(() => products.filter(product => selectedProducts.has(product.productId)).reduce((sum, product) => sum + product.dropStock * product.currentSupplierCost, 0) + Number(draft.freightSubsidy || 0) + Number(draft.packagingCost || 0) + Number(draft.otherCosts || 0), [products, selectedProducts, draft.freightSubsidy, draft.packagingCost, draft.otherCosts]);
  const chooseDrop = (drop: AdminDrop) => setDraft({ ...drop, startsAt: localDate(drop.startsAt), endsAt: localDate(drop.endsAt) });
  const toggleProduct = (productId: string) => setDraft(current => ({ ...current, productIds: (current.productIds || []).includes(productId) ? (current.productIds || []).filter(id => id !== productId) : [...(current.productIds || []), productId] }));
  const save = async () => { setSaving(true); setError(null); try { await request('save-drop', { method: 'POST', body: JSON.stringify({ drop: { ...draft, startsAt: draft.startsAt ? new Date(draft.startsAt).toISOString() : '', endsAt: draft.endsAt ? new Date(draft.endsAt).toISOString() : '' } }) }); setMessage('Drop salvo e exposição recalculada.'); await load(); } catch (reason: any) { setError(reason.message); } finally { setSaving(false); } };

  return <div className="admin-drops"><header><div><h1>DROPS DA LOJA</h1><p>Calendário, estoque reservado e exposição financeira interna.</p></div><button onClick={() => setDraft(emptyDrop())}><Plus />NOVO DROP</button></header>{error ? <p className="admin-drops-error">{error}</p> : null}{message ? <p className="admin-drops-message">{message}</p> : null}<div className="admin-drops-layout"><aside><h2>CALENDÁRIO</h2>{drops.length ? drops.map(drop => <button key={drop.id} onClick={() => chooseDrop(drop)}><CalendarDays /><span><b>{drop.name}</b><small>{new Date(drop.startsAt).toLocaleString('pt-BR')} — {drop.active ? 'ATIVO' : 'INATIVO'}</small><em>Exposição: {money(drop.maximumExposure)}</em></span></button>) : <p>Nenhum Drop configurado.</p>}</aside><section className="admin-drops-editor"><label>Nome<input value={draft.name || ''} onChange={event => setDraft(current => ({ ...current, name: event.target.value }))} /></label><div className="admin-drops-dates"><label>Início<input type="datetime-local" value={draft.startsAt || ''} onChange={event => setDraft(current => ({ ...current, startsAt: event.target.value }))} /></label><label>Fim<input type="datetime-local" value={draft.endsAt || ''} onChange={event => setDraft(current => ({ ...current, endsAt: event.target.value }))} /></label></div><div className="admin-drops-options"><label><input type="checkbox" checked={draft.active === true} onChange={event => setDraft(current => ({ ...current, active: event.target.checked }))} />Drop ativo</label><label>Frete<select value={draft.shippingMode || 'PAID_PENDING'} onChange={event => setDraft(current => ({ ...current, shippingMode: event.target.value as StoreDrop['shippingMode'] }))}><option value="PAID_PENDING">Pendente de configuração</option><option value="FREE">Grátis/subsidiado</option></select></label></div><h2>PRODUTOS E ESTOQUE DO DROP</h2><div className="admin-drops-products">{products.map(product => <label key={product.productId} className={selectedProducts.has(product.productId) ? 'is-selected' : ''}><input type="checkbox" checked={selectedProducts.has(product.productId)} onChange={() => toggleProduct(product.productId)} /><Package /><span><b>{product.name}</b><small>{product.dropStock} un. · custo {money(product.currentSupplierCost)}</small></span></label>)}</div><h2>CUSTOS INTERNOS DO DROP</h2><div className="admin-drops-costs"><label>Subsídio de frete<input type="number" min="0" step="0.01" value={draft.freightSubsidy || 0} onChange={event => setDraft(current => ({ ...current, freightSubsidy: Number(event.target.value) }))} /></label><label>Embalagem<input type="number" min="0" step="0.01" value={draft.packagingCost || 0} onChange={event => setDraft(current => ({ ...current, packagingCost: Number(event.target.value) }))} /></label><label>Outros custos<input type="number" min="0" step="0.01" value={draft.otherCosts || 0} onChange={event => setDraft(current => ({ ...current, otherCosts: Number(event.target.value) }))} /></label></div><article className="admin-drops-exposure"><ShieldAlert /><span>EXPOSIÇÃO MÁXIMA DO DROP<b>{money(estimatedExposure)}</b><small>Estoque do Drop × custo atual + custos adicionais.</small></span></article><p className="admin-drops-note"><Coins />O preço em Coins permanece configurado por produto e não representa conversão pública em reais.</p><button className="admin-drops-save" onClick={save} disabled={saving}><Save />{saving ? 'SALVANDO…' : 'SALVAR DROP'}</button></section></div></div>;
}
