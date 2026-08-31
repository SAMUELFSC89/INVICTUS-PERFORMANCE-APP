import { useEffect, useState } from 'react';
import { AlertTriangle, Check, Coins, Image, Package, RefreshCw, Save } from 'lucide-react';
import { auth } from '../firebase';
import type { PhysicalProduct, ProductPricing } from '../types';
import './AdminStorePricing.css';
import './AdminStoreProductExtras.css';
import './AdminStoreDevelopment.css';

type AdminProduct = PhysicalProduct & { publicationGaps: string[] };
const productStatusLabel: Record<PhysicalProduct['productStatus'], string> = {
  DRAFT: 'RASCUNHO', READY_FOR_PRICING: 'AGUARDANDO PRECIFICAÇÃO', READY_FOR_REVIEW: 'AGUARDANDO REVISÃO',
  ACTIVE: 'ATIVO', INACTIVE: 'INATIVO', COMING_SOON: 'EM DESENVOLVIMENTO',
};
const pendingLabel: Record<string, string> = {
  SUPPLIER: 'fornecedor', SUPPLIER_SKU: 'SKU do fornecedor', GTIN_PENDING_VERIFICATION: 'GTIN/EAN validado',
  SUPPLIER_COST: 'custo do fornecedor', PUBLIC_DESCRIPTION: 'descrição pública', IMAGES: 'imagens',
  CASH_PRICE: 'preço em dinheiro', COIN_PRICE: 'Coin Price', STOCK: 'estoque', LOGISTICS: 'peso e dimensões logísticas',
  PRICING: 'cálculo de precificação',
};
const fields: Array<[keyof ProductPricing, string, string]> = [
  ['cashPrice', 'Preço de venda', 'R$'], ['estimatedShippingCost', 'Frete estimado por unidade', 'R$'],
  ['packagingCost', 'Embalagem', 'R$'], ['taxRate', 'Impostos', '%'],
  ['paymentFeePercent', 'Taxa do gateway', '%'], ['paymentFeeFixed', 'Taxa fixa do gateway', 'R$'],
  ['otherVariableCost', 'Outros custos variáveis', 'R$'], ['subsidyCost', 'Subsídio Invictus', 'R$'],
  ['desiredMarginPercent', 'Margem líquida desejada', '%'],
];

async function request(action: string, init?: RequestInit) {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Sessão inválida.');
  const response = await fetch(`/api/store?action=${action}`, { ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init?.headers || {}) } });
  const data = await response.json();
  if (!response.ok || !data.success) throw new Error(data.error || 'Falha na Loja Admin.');
  return data;
}

export function AdminStorePricing() {
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [pricing, setPricing] = useState<Partial<ProductPricing>>({});
  const [configuration, setConfiguration] = useState<Partial<PhysicalProduct>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selected = products.find(product => product.productId === selectedId) || products[0];

  const load = async () => {
    setLoading(true); setError(null);
    try { const data = await request('admin-products'); setProducts(data.products || []); if (!selectedId && data.products?.[0]) setSelectedId(data.products[0].productId); }
    catch (reason: any) { setError(reason.message); } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (!selected) return;
    setPricing(selected.pricing);
    setConfiguration({ productStatus: selected.productStatus, supplierId: selected.supplierId, supplierSku: selected.supplierSku, gtin: selected.gtin, currentSupplierCost: selected.currentSupplierCost, minimumOrderQuantity: selected.minimumOrderQuantity, leadTime: selected.leadTime, publicDescription: selected.publicDescription, publicHighlights: selected.publicHighlights, coinPrice: selected.coinPrice, cashTopUp: selected.cashTopUp, commercialStock: selected.commercialStock, dropStock: selected.dropStock, displayOrder: selected.displayOrder, active: selected.active, storeVisible: selected.storeVisible, published: selected.published, canPurchaseWithMoney: selected.canPurchaseWithMoney, canRedeemWithCoins: selected.canRedeemWithCoins, canUseCoinsPlusMoney: selected.canUseCoinsPlusMoney });
  }, [selected?.productId]);

  const importCatalogue = async () => { setSaving(true); setError(null); try { const data = await request('import-catalogue', { method: 'POST', body: '{}' }); setMessage(`${data.result.created} produtos criados; ${data.result.existing} já existiam.`); await load(); } catch (reason: any) { setError(reason.message); } finally { setSaving(false); } };
  const savePricing = async () => { if (!selected) return; setSaving(true); setError(null); try { await request('update-pricing', { method: 'POST', body: JSON.stringify({ productId: selected.productId, pricing }) }); setMessage('Precificação atualizada.'); await load(); } catch (reason: any) { setError(reason.message); } finally { setSaving(false); } };
  const saveConfiguration = async () => { if (!selected) return; setSaving(true); setError(null); try { await request('update-product-configuration', { method: 'POST', body: JSON.stringify({ productId: selected.productId, configuration }) }); setMessage('Configuração pública, Coins e estoque atualizados.'); await load(); } catch (reason: any) { setError(reason.message); } finally { setSaving(false); } };
  const activateProduct = async () => { if (!selected) return; setSaving(true); setError(null); try { await request('update-product-configuration', { method: 'POST', body: JSON.stringify({ productId: selected.productId, configuration: { ...configuration, productStatus: 'ACTIVE' } }) }); setMessage('Produto aprovado e ativado.'); await load(); } catch (reason: any) { setError(reason.message); } finally { setSaving(false); } };
  const value = (key: keyof ProductPricing) => pricing[key] == null ? '' : String(pricing[key]);
  const update = (key: keyof ProductPricing, raw: string) => setPricing(current => ({ ...current, [key]: raw === '' ? null : Number(raw) }));
  const configNumber = (key: keyof PhysicalProduct) => configuration[key] == null ? '' : String(configuration[key]);
  const updateConfigNumber = (key: keyof PhysicalProduct, raw: string) => setConfiguration(current => ({ ...current, [key]: raw === '' ? null : Number(raw) }));
  const price = selected?.pricing;
  const belowCost = Boolean(price?.cashPrice != null && selected?.currentSupplierCost != null && price.cashPrice <= selected.currentSupplierCost);
  const negative = Boolean(price?.estimatedMarginPercent != null && price.estimatedMarginPercent < 0);
  const costChanged = Boolean(price?.supplierCostAtLastPricing != null && price.supplierCostAtLastPricing !== selected?.currentSupplierCost);

  return <div className="admin-store">
    <header><div><h1>LOJA · PRODUTOS E PRECIFICAÇÃO</h1><p>Custos internos nunca são enviados para a vitrine pública.</p></div><button onClick={importCatalogue} disabled={saving}><RefreshCw />IMPORTAR CATÁLOGO REAL</button></header>
    {error ? <p className="admin-store-error">{error}</p> : null}{message ? <p className="admin-store-message">{message}</p> : null}
    {loading ? <p>Carregando…</p> : <div className="admin-store-layout">
      <aside>{products.map(product => <button key={product.productId} className={product.productId === selected?.productId ? 'is-active' : ''} onClick={() => setSelectedId(product.productId)}><Package /><span><b>{product.name}</b><small>{product.brand} · {product.gtin || 'EAN/SKU pendente'}</small></span>{product.productStatus === 'COMING_SOON' || product.publicationGaps.length ? <AlertTriangle /> : <Check />}</button>)}</aside>
      {selected ? <section className="admin-store-editor">
        <div className="admin-store-product"><span><Package /></span><div><h2>{selected.name}</h2><p>{selected.brand} · {selected.gtin ? `GTIN ${selected.gtin}` : selected.gtinCandidate ? `CÓDIGO INFORMADO ${selected.gtinCandidate} · VALIDAR GTIN` : 'EAN/SKU pendente'}</p>{selected.boxGtinCandidate ? <p>CAIXA INFORMADA {selected.boxGtinCandidate} · VALIDAR GTIN</p> : null}<small>{selected.currentSupplierCost === null ? 'CUSTO PENDENTE' : `CUSTO ATUAL: R$ ${selected.currentSupplierCost.toFixed(2).replace('.', ',')}`}</small></div><div><Image /><b>{selected.imageStatus === 'PENDING' ? 'AGUARDANDO ASSETS' : selected.imageStatus}</b></div></div>
        <div className={`admin-store-status ${selected.productStatus === 'COMING_SOON' || selected.productStatus === 'DRAFT' ? 'is-development' : 'is-ready'}`}><b>{productStatusLabel[selected.productStatus]}</b><span>{selected.developmentStatus === 'PRODUCT_DEVELOPMENT_PENDING' ? 'PRODUCT_DEVELOPMENT_PENDING' : 'READY'}</span></div>
        <div className="admin-store-alerts">{belowCost ? <p><AlertTriangle />PREÇO ABAIXO DO CUSTO</p> : null}{negative ? <p><AlertTriangle />MARGEM NEGATIVA</p> : null}{costChanged ? <p><AlertTriangle />CUSTO DO FORNECEDOR ALTERADO — REVISE O PREÇO</p> : null}{selected.adminPending?.length ? <p className={selected.productStatus === 'COMING_SOON' || selected.productStatus === 'DRAFT' ? 'is-development' : ''}><AlertTriangle />PENDÊNCIAS ADMINISTRATIVAS: {selected.adminPending.map(item => pendingLabel[item] || item).join(', ')}</p> : null}{selected.publicationGaps.length ? <p className={selected.productStatus === 'COMING_SOON' ? 'is-development' : ''}><AlertTriangle />{selected.productStatus === 'COMING_SOON' ? 'PENDÊNCIAS DE DESENVOLVIMENTO' : 'PRODUTO INCOMPLETO'}: {selected.publicationGaps.join(', ')}</p> : null}</div>
        <h3 className="admin-store-section-title">DADOS DE DESENVOLVIMENTO</h3>
        <div className="admin-store-fields">
          <label><span>Fornecedor</span><div><input value={String(configuration.supplierId || '')} onChange={event => setConfiguration(current => ({ ...current, supplierId: event.target.value || null }))} placeholder="ID real do fornecedor" /><b>ID</b></div></label>
          <label><span>SKU do fornecedor</span><div><input value={String(configuration.supplierSku || '')} onChange={event => setConfiguration(current => ({ ...current, supplierSku: event.target.value || null }))} placeholder="SKU real" /><b>SKU</b></div></label>
          <label><span>GTIN/EAN</span><div><input inputMode="numeric" maxLength={13} value={String(configuration.gtin || '')} onChange={event => setConfiguration(current => ({ ...current, gtin: event.target.value.replace(/\D/g, '').slice(0, 13) || null }))} placeholder="13 dígitos" /><b>EAN</b></div></label>
          <label><span>Custo do fornecedor</span><div><input type="number" min="0" step="0.01" value={configNumber('currentSupplierCost')} onChange={event => updateConfigNumber('currentSupplierCost', event.target.value)} /><b>R$</b></div></label>
          <label><span>Pedido mínimo</span><div><input type="number" min="1" step="1" value={configNumber('minimumOrderQuantity')} onChange={event => updateConfigNumber('minimumOrderQuantity', event.target.value)} /><b>un.</b></div></label>
          <label><span>Prazo do fornecedor</span><div><input value={String(configuration.leadTime || '')} onChange={event => setConfiguration(current => ({ ...current, leadTime: event.target.value || null }))} placeholder="Ex.: 15 dias" /><b>Prazo</b></div></label>
        </div>
        <h3 className="admin-store-section-title">PRECIFICAÇÃO EM DINHEIRO</h3>
        <div className="admin-store-fields">{fields.map(([key, label, suffix]) => <label key={key}><span>{label}</span><div><input type="number" min="0" step="0.01" value={value(key)} onChange={event => update(key, event.target.value)} /><b>{suffix}</b></div></label>)}</div>
        <div className="admin-store-results"><article><span>CUSTO TOTAL ESTIMADO</span><b>{price?.estimatedProfit != null && price?.cashPrice != null ? `R$ ${(price.cashPrice - price.estimatedProfit).toFixed(2)}` : '—'}</b></article><article><span>LUCRO ESTIMADO</span><b>{price?.estimatedProfit != null ? `R$ ${price.estimatedProfit.toFixed(2)}` : '—'}</b></article><article><span>MARGEM LÍQUIDA</span><b>{price?.estimatedMarginPercent != null ? `${price.estimatedMarginPercent.toFixed(2)}%` : '—'}</b></article><article><span>MARKUP</span><b>{price?.markup != null ? `${price.markup.toFixed(2)}x` : '—'}</b></article><article><span>PREÇO SUGERIDO</span><b>{price?.calculatedSuggestedPrice != null ? `R$ ${price.calculatedSuggestedPrice.toFixed(2)}` : '—'}</b></article><article><span>COIN PRICE</span><b>{selected.coinPrice === null ? 'NÃO DEFINIDO' : <><Coins />{selected.coinPrice}</>}</b></article></div>
        <button className="admin-store-save" onClick={savePricing} disabled={saving || selected.currentSupplierCost === null}><Save />{selected.currentSupplierCost === null ? 'DEFINA O CUSTO PRIMEIRO' : saving ? 'SALVANDO…' : 'APLICAR PREÇO'}</button>
        <h3 className="admin-store-section-title">VITRINE, COINS E ESTOQUE</h3>
        <div className="admin-store-public"><label><span>Descrição pública</span><textarea value={String(configuration.publicDescription || '')} onChange={event => setConfiguration(current => ({ ...current, publicDescription: event.target.value }))} placeholder="Não invente benefícios ou alegações." /></label><label><span>Destaques públicos (um por linha)</span><textarea value={Array.isArray(configuration.publicHighlights) ? configuration.publicHighlights.join('\n') : ''} onChange={event => setConfiguration(current => ({ ...current, publicHighlights: event.target.value.split('\n') }))} /></label></div>
        <div className="admin-store-fields"><label><span>Coin Price</span><div><input type="number" min="1" step="1" value={configNumber('coinPrice')} onChange={event => updateConfigNumber('coinPrice', event.target.value)} /><b>Coins</b></div></label><label><span>Complemento em dinheiro</span><div><input type="number" min="0" step="0.01" value={configNumber('cashTopUp')} onChange={event => updateConfigNumber('cashTopUp', event.target.value)} /><b>R$</b></div></label><label><span>Estoque comercial</span><div><input type="number" min="0" step="1" value={configNumber('commercialStock')} onChange={event => updateConfigNumber('commercialStock', event.target.value)} /><b>un.</b></div></label><label><span>Estoque do Drop</span><div><input type="number" min="0" step="1" value={configNumber('dropStock')} onChange={event => updateConfigNumber('dropStock', event.target.value)} /><b>un.</b></div></label><label><span>Ordem da vitrine</span><div><input type="number" min="0" step="1" value={configNumber('displayOrder')} onChange={event => updateConfigNumber('displayOrder', event.target.value)} /><b>#</b></div></label></div>
        <div className="admin-store-toggles">{([['active', 'Produto ativo'], ['storeVisible', 'Visível na loja'], ['published', 'Publicado'], ['canPurchaseWithMoney', 'Compra em dinheiro'], ['canRedeemWithCoins', 'Resgate com Coins'], ['canUseCoinsPlusMoney', 'Coins + dinheiro']] as Array<[keyof PhysicalProduct, string]>).map(([key, label]) => <label key={key}><input type="checkbox" checked={Boolean(configuration[key])} onChange={event => setConfiguration(current => ({ ...current, [key]: event.target.checked }))} /><span>{label}</span></label>)}</div>
        <section className="admin-store-images"><Image /><div><b>IMAGENS DO PRODUTO</b><span>Principal: {selected.images.primary ? 'configurada' : 'pendente'} · Thumbnail: {selected.images.thumbnail ? 'configurada' : 'pendente'} · Galeria: {selected.images.gallery.length}</span><small>{selected.imageStatus === 'READY' ? 'Asset oficial associado ao catálogo.' : 'Aguardando asset oficial.'}</small></div></section>
        <button className="admin-store-save" onClick={saveConfiguration} disabled={saving}><Save />{saving ? 'SALVANDO…' : 'SALVAR CONFIGURAÇÃO'}</button>
        {selected.productStatus !== 'ACTIVE' ? <button className="admin-store-activate" onClick={activateProduct} disabled={saving}><Check />APROVAR E ATIVAR APÓS PREENCHER TODAS AS PENDÊNCIAS</button> : null}
      </section> : <section className="admin-store-empty"><Package /><h2>IMPORTE O CATÁLOGO</h2><p>Os 21 produtos reais e os 10 itens futuros serão criados sem dados comerciais inventados.</p></section>}
    </div>}
  </div>;
}
