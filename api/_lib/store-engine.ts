import { createHash } from 'node:crypto';
import { db } from './common.js';
import { AsaasClient } from './asaas-client.js';
import { materializeCatalogue } from '../_data/store-catalog.js';
import type {
  PhysicalOrder,
  PhysicalOrderItemSnapshot,
  PhysicalProduct,
  PhysicalShippingAddress,
  ProductPricing,
  PublicPhysicalProduct,
  PublicStoreDrop,
  RewardCoinTransaction,
  StoreDrop,
  StoreDropStatus,
  StoreShippingMode,
} from '../../src/types.js';

type PricingInput = Partial<Omit<ProductPricing, 'supplierCost'>> & { cashPrice?: number | null };
type ProductConfigurationInput = {
  productStatus?: PhysicalProduct['productStatus'];
  supplierId?: string | null;
  supplierSku?: string | null;
  gtin?: string | null;
  currentSupplierCost?: number | null;
  minimumOrderQuantity?: number | null;
  leadTime?: string | null;
  publicDescription?: string | null;
  publicHighlights?: string[];
  cashPrice?: number | null;
  coinDiscountPrice?: number | null;
  coinDiscountAmount?: number | null;
  commercialStock?: number;
  dropStock?: number;
  displayOrder?: number;
  active?: boolean;
  storeVisible?: boolean;
  published?: boolean;
  canPurchaseWithCash?: boolean;
  canPurchaseWithCoinsDiscount?: boolean;
  /** Legacy fields accepted only to finish the data migration. */
  canPurchaseWithMoney?: boolean;
  canRedeemWithCoins?: boolean;
  canUseCoinsPlusMoney?: boolean;
  coinPrice?: number | null;
  cashTopUp?: number | null;
};

const MAX_ORDER_QUANTITY = 10;
const CATALOGUE_VERSION = 9;
const DROP_STATUSES: StoreDropStatus[] = ['DRAFT', 'SCHEDULED', 'ACTIVE', 'SOLD_OUT', 'ENDED', 'CANCELLED'];
const SHIPPING_MODES: StoreShippingMode[] = ['CUSTOMER_PAID', 'INVICTUS_SUBSIDIZED', 'SPONSORED', 'FREE_SHIPPING_CAMPAIGN'];

const money = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
const nullableMoney = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const integer = (value: unknown, fallback = 0): number => typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : fallback;
const positiveInteger = (value: unknown, fallback: number | null = null): number | null => typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback;
const roundMoney = (value: number): number => Math.round(value * 100) / 100;
const nowIso = (): string => new Date().toISOString();

function toIso(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function hashKey(...parts: string[]): string {
  return createHash('sha256').update(parts.join(':')).digest('hex').slice(0, 40);
}

function normalizeShippingMode(value: unknown): StoreShippingMode {
  if (value === 'FREE') return 'FREE_SHIPPING_CAMPAIGN';
  if (value === 'PAID_PENDING') return 'CUSTOMER_PAID';
  return SHIPPING_MODES.includes(value as StoreShippingMode) ? value as StoreShippingMode : 'CUSTOMER_PAID';
}

function normalizeDropStatus(value: unknown, startsAt: string, endsAt: string, active?: boolean): StoreDropStatus {
  if (DROP_STATUSES.includes(value as StoreDropStatus)) return value as StoreDropStatus;
  const now = Date.now();
  if (Date.parse(endsAt) < now) return 'ENDED';
  if (active) return Date.parse(startsAt) <= now ? 'ACTIVE' : 'SCHEDULED';
  return 'DRAFT';
}

function defaultPricing(supplierCost: number | null): ProductPricing {
  return {
    cashPrice: null,
    supplierCost,
    estimatedShippingCost: null,
    packagingCost: null,
    taxRate: null,
    paymentFeePercent: null,
    paymentFeeFixed: null,
    otherVariableCost: null,
    subsidyCost: null,
    desiredMarginPercent: null,
    calculatedSuggestedPrice: null,
    estimatedProfit: null,
    estimatedMarginPercent: null,
    markup: null,
    supplierCostAtLastPricing: null,
    lastCalculatedAt: null,
  };
}

/** Normalizes documents created before the store model migration. */
function normalizeProduct(data: Record<string, any>, productId?: string): PhysicalProduct {
  const supplierCost = nullableMoney(data.currentSupplierCost);
  const rawPricing = data.pricing && typeof data.pricing === 'object' ? data.pricing : {};
  const pricing = { ...defaultPricing(supplierCost), ...rawPricing } as ProductPricing;
  const cashPrice = nullableMoney(pricing.cashPrice);
  const coinDiscountPrice = nullableMoney(data.coinDiscountPrice ?? rawPricing.coinDiscountPrice);
  const coinDiscountAmount = positiveInteger(data.coinDiscountAmount ?? rawPricing.coinDiscountAmount);
  const rawImages = data.images && typeof data.images === 'object' ? data.images : {};
  return {
    ...data,
    productId: productId || String(data.productId || ''),
    productStatus: data.productStatus || 'DRAFT',
    developmentStatus: data.developmentStatus || 'PRODUCT_DEVELOPMENT_PENDING',
    gtin: typeof data.gtin === 'string' ? data.gtin : null,
    barcodeType: data.barcodeType || (data.gtin ? 'EAN13' : null),
    supplierDescription: data.supplierDescription ?? null,
    publicDescription: data.publicDescription ?? null,
    supplierClaims: Array.isArray(data.supplierClaims) ? data.supplierClaims : [],
    publicHighlights: Array.isArray(data.publicHighlights) ? data.publicHighlights : [],
    regularSupplierCost: nullableMoney(data.regularSupplierCost),
    currentSupplierCost: supplierCost,
    promotionMinimumQuantity: positiveInteger(data.promotionMinimumQuantity),
    currency: 'BRL',
    active: data.active !== false,
    storeVisible: data.storeVisible !== false,
    published: data.published !== false,
    displayOrder: integer(data.displayOrder),
    canPurchaseWithCash: typeof data.canPurchaseWithCash === 'boolean' ? data.canPurchaseWithCash : Boolean(data.canPurchaseWithMoney),
    canPurchaseWithCoinsDiscount: typeof data.canPurchaseWithCoinsDiscount === 'boolean' ? data.canPurchaseWithCoinsDiscount : Boolean(data.canUseCoinsPlusMoney && coinDiscountPrice && coinDiscountAmount),
    coinDiscountPrice,
    coinDiscountAmount,
    commercialStock: integer(data.commercialStock),
    dropStock: integer(data.dropStock),
    reservedCommercialStock: integer(data.reservedCommercialStock),
    reservedDropStock: integer(data.reservedDropStock),
    images: { primary: rawImages.primary ?? null, thumbnail: rawImages.thumbnail ?? rawImages.primary ?? null, gallery: Array.isArray(rawImages.gallery) ? rawImages.gallery : [] },
    imageStatus: data.imageStatus || 'PENDING',
    pricing: { ...pricing, cashPrice, supplierCost },
    createdAt: typeof data.createdAt === 'string' ? data.createdAt : nowIso(),
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : nowIso(),
  } as PhysicalProduct;
}

function normalizeDrop(id: string, data: Record<string, any>): StoreDrop {
  const startsAt = typeof data.startsAt === 'string' ? data.startsAt : '';
  const endsAt = typeof data.endsAt === 'string' ? data.endsAt : '';
  const productId = typeof data.productId === 'string' ? data.productId : Array.isArray(data.productIds) && typeof data.productIds[0] === 'string' ? data.productIds[0] : undefined;
  const initialStock = integer(data.initialStock ?? data.dropStock);
  const reservedStock = integer(data.reservedStock ?? data.reservedDropStock);
  const availableStock = integer(data.availableStock, Math.max(0, initialStock - reservedStock));
  return {
    id,
    name: typeof data.name === 'string' ? data.name : 'Drop Invictus',
    productId,
    productIds: Array.isArray(data.productIds) ? data.productIds : productId ? [productId] : [],
    coinPrice: positiveInteger(data.coinPrice),
    initialStock,
    availableStock,
    reservedStock,
    limitPerUser: positiveInteger(data.limitPerUser, 1) || 1,
    startsAt,
    endsAt,
    status: normalizeDropStatus(data.status, startsAt, endsAt, data.active === true),
    shippingMode: normalizeShippingMode(data.shippingMode),
    maxExposure: nullableMoney(data.maxExposure),
    maxBudget: nullableMoney(data.maxBudget ?? data.budgetLimit),
    image: typeof data.image === 'string' ? data.image : null,
    active: data.active === true,
    freightSubsidy: money(data.freightSubsidy),
    packagingCost: money(data.packagingCost),
    fulfillmentCost: money(data.fulfillmentCost),
    otherCosts: money(data.otherCosts),
    createdAt: typeof data.createdAt === 'string' ? data.createdAt : nowIso(),
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : nowIso(),
  };
}

function dropTargetsProduct(drop: StoreDrop, productId: string): boolean {
  return drop.productId === productId || Boolean(drop.productIds?.includes(productId));
}

function dropAvailableStock(drop: StoreDrop): number {
  if (drop.availableStock !== undefined) return Math.max(0, integer(drop.availableStock));
  return Math.max(0, integer(drop.initialStock) - integer(drop.reservedStock));
}

function dropIsOpen(drop: StoreDrop, timestamp = Date.now()): boolean {
  const starts = Date.parse(drop.startsAt);
  const ends = Date.parse(drop.endsAt);
  return (drop.status === 'ACTIVE' || drop.active === true) && Number.isFinite(starts) && Number.isFinite(ends) && starts <= timestamp && ends >= timestamp;
}

function publicDrop(drop: StoreDrop): PublicStoreDrop {
  return {
    id: drop.id,
    name: drop.name,
    productId: drop.productId,
    coinPrice: drop.coinPrice,
    availableStock: dropAvailableStock(drop),
    limitPerUser: drop.limitPerUser,
    startsAt: drop.startsAt,
    endsAt: drop.endsAt,
    status: drop.status,
    shippingMode: drop.shippingMode,
  };
}

export function calculateProductPricing(supplierCost: number, input: PricingInput): ProductPricing {
  const cashPrice = nullableMoney(input.cashPrice);
  const estimatedShippingCost = nullableMoney(input.estimatedShippingCost);
  const packagingCost = nullableMoney(input.packagingCost);
  const taxRate = nullableMoney(input.taxRate);
  const paymentFeePercent = nullableMoney(input.paymentFeePercent);
  const paymentFeeFixed = nullableMoney(input.paymentFeeFixed);
  const otherVariableCost = nullableMoney(input.otherVariableCost);
  const subsidyCost = nullableMoney(input.subsidyCost);
  const desiredMarginPercent = nullableMoney(input.desiredMarginPercent);
  const percentageCosts = cashPrice === null ? 0 : cashPrice * ((taxRate || 0) + (paymentFeePercent || 0)) / 100;
  const estimatedTotalCost = money(supplierCost) + money(estimatedShippingCost) + money(packagingCost) + money(paymentFeeFixed) + money(otherVariableCost) + money(subsidyCost) + percentageCosts;
  const estimatedProfit = cashPrice === null ? null : cashPrice - estimatedTotalCost;
  const estimatedMarginPercent = cashPrice && estimatedProfit !== null ? estimatedProfit / cashPrice * 100 : null;
  const markup = cashPrice !== null && supplierCost > 0 ? cashPrice / supplierCost : null;
  const fixedCosts = money(supplierCost) + money(estimatedShippingCost) + money(packagingCost) + money(paymentFeeFixed) + money(otherVariableCost) + money(subsidyCost);
  const denominator = 1 - ((taxRate || 0) + (paymentFeePercent || 0)) / 100 - (desiredMarginPercent || 0) / 100;
  const calculatedSuggestedPrice = desiredMarginPercent !== null && denominator > 0 ? fixedCosts / denominator : null;
  return { cashPrice, supplierCost, estimatedShippingCost, packagingCost, taxRate, paymentFeePercent, paymentFeeFixed, otherVariableCost, subsidyCost, desiredMarginPercent, calculatedSuggestedPrice, estimatedProfit, estimatedMarginPercent, markup, supplierCostAtLastPricing: supplierCost, lastCalculatedAt: nowIso() };
}

export function isValidGtin13(value: string | null | undefined): boolean {
  if (!value || !/^\d{13}$/.test(value)) return false;
  const digits = value.split('').map(Number);
  const sum = digits.slice(0, 12).reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 1 : 3), 0);
  return (10 - (sum % 10)) % 10 === digits[12];
}

export function costHistoryDocumentId(productId: string, supplierCost: number): string {
  return `supplier_catalog_${productId}_${Math.round(supplierCost * 100)}`;
}

export function getAdminPending(product: PhysicalProduct): string[] {
  const pending: string[] = [];
  if (!product.supplierId) pending.push('SUPPLIER');
  if (!product.supplierSku) pending.push('SUPPLIER_SKU');
  if (!isValidGtin13(product.gtin)) pending.push('GTIN_PENDING_VERIFICATION');
  if (product.currentSupplierCost === null) pending.push('SUPPLIER_COST');
  if (!product.publicDescription?.trim()) pending.push('PUBLIC_DESCRIPTION');
  if (product.imageStatus !== 'READY' || !product.images.primary) pending.push('IMAGES');
  if (!product.canPurchaseWithCash || product.pricing.cashPrice === null) pending.push('CASH_PRICE');
  if (!product.canPurchaseWithCoinsDiscount || product.coinDiscountPrice === null || product.coinDiscountAmount === null) pending.push('COIN_DISCOUNT');
  if (product.commercialStock <= 0 && product.dropStock <= 0) pending.push('STOCK');
  if (product.shippingWeight === null || product.packageLengthCm === null || product.packageWidthCm === null || product.packageHeightCm === null) pending.push('LOGISTICS');
  if (product.pricing.lastCalculatedAt === null) pending.push('PRICING');
  for (const item of product.adminPending || []) if (item === 'GTIN_DIVERGENCE_REVIEW' && !pending.includes(item)) pending.push(item);
  return pending;
}

export function getPublicationGaps(product: PhysicalProduct): string[] {
  if (product.productStatus === 'COMING_SOON') {
    const pending: string[] = [];
    if (!product.supplierId) pending.push('FORNECEDOR');
    if (product.currentSupplierCost === null) pending.push('CUSTO');
    if (!product.pricing.cashPrice || !product.coinDiscountPrice || !product.coinDiscountAmount) pending.push('PREÇO');
    if (product.commercialStock <= 0 && product.dropStock <= 0) pending.push('ESTOQUE');
    if (!product.gtin || !product.supplierSku) pending.push('EAN/SKU');
    if (product.imageStatus !== 'READY' || !product.images.primary) pending.push('IMAGENS');
    if (product.pricing.lastCalculatedAt === null) pending.push('PRECIFICAÇÃO');
    return pending;
  }
  const gaps: string[] = [];
  if (!product.name?.trim()) gaps.push('nome');
  if (!isValidGtin13(product.gtin)) gaps.push('GTIN válido');
  if (!product.category) gaps.push('categoria');
  if (product.currentSupplierCost === null || product.currentSupplierCost < 0) gaps.push('custo');
  if (!product.publicDescription?.trim()) gaps.push('descrição pública');
  if (product.imageStatus !== 'READY' || !product.images?.primary) gaps.push('imagem principal');
  const cashReady = product.canPurchaseWithCash && product.pricing.cashPrice !== null && product.pricing.cashPrice > 0;
  const discountReady = product.canPurchaseWithCoinsDiscount && product.coinDiscountPrice !== null && product.coinDiscountAmount !== null && product.coinDiscountPrice > 0 && product.coinDiscountAmount > 0;
  if (!cashReady && !discountReady) gaps.push('configuração comercial');
  return gaps;
}

export function productPublicView(product: PhysicalProduct, drop: StoreDrop | null): PublicPhysicalProduct {
  const relevantDrop = drop && dropTargetsProduct(drop, product.productId) ? drop : null;
  const availableCommercialStock = Math.max(0, money(product.commercialStock) - money(product.reservedCommercialStock));
  const availableDropStock = relevantDrop ? dropAvailableStock(relevantDrop) : 0;
  const now = Date.now();
  const startsAt = relevantDrop?.startsAt ? Date.parse(relevantDrop.startsAt) : NaN;
  const dropOpen = relevantDrop ? dropIsOpen(relevantDrop, now) : false;
  const nextDropAt = Number.isFinite(startsAt) && startsAt > now ? relevantDrop?.startsAt || null : null;
  const hasDropPrice = Boolean(relevantDrop?.coinPrice && relevantDrop.coinPrice > 0);
  const dropState: PublicPhysicalProduct['dropState'] = !relevantDrop || product.productStatus !== 'ACTIVE' || !hasDropPrice ? 'UNAVAILABLE' : availableDropStock <= 0 || relevantDrop.status === 'SOLD_OUT' ? 'SOLD_OUT' : dropOpen ? 'OPEN' : 'UPCOMING';
  const cashPrice = product.pricing?.cashPrice ?? null;
  const canPurchaseWithCash = Boolean(product.canPurchaseWithCash && cashPrice !== null && cashPrice > 0);
  const canPurchaseWithCoinsDiscount = Boolean(product.canPurchaseWithCoinsDiscount && product.coinDiscountPrice !== null && product.coinDiscountAmount !== null && product.coinDiscountPrice > 0 && product.coinDiscountAmount > 0);
  const {
    developmentStatus: _developmentStatus,
    supplierId: _supplierId,
    supplierCode: _supplierCode,
    supplierSku: _supplierSku,
    supplierName: _supplierName,
    supplierDescription: _supplierDescription,
    supplierClaims: _supplierClaims,
    gtinCandidate: _gtinCandidate,
    boxGtinCandidate: _boxGtinCandidate,
    regularSupplierCost: _regularSupplierCost,
    currentSupplierCost: _currentSupplierCost,
    minimumOrderQuantity: _minimumOrderQuantity,
    leadTime: _leadTime,
    promotionMinimumQuantity: _promotionMinimumQuantity,
    promotionStartAt: _promotionStartAt,
    promotionEndAt: _promotionEndAt,
    availability: _availability,
    lastCostUpdate: _lastCostUpdate,
    commercialStock: _commercialStock,
    dropStock: _dropStock,
    reservedCommercialStock: _reservedCommercialStock,
    reservedDropStock: _reservedDropStock,
    adminPending: _adminPending,
    pricing: _pricing,
    canPurchaseWithMoney: _canPurchaseWithMoney,
    canRedeemWithCoins: _canRedeemWithCoins,
    canUseCoinsPlusMoney: _canUseCoinsPlusMoney,
    coinPrice: _coinPrice,
    cashTopUp: _cashTopUp,
    ...safe
  } = product;
  return {
    ...safe,
    canPurchaseWithCash,
    canPurchaseWithCoinsDiscount,
    coinDiscountPrice: canPurchaseWithCoinsDiscount ? product.coinDiscountPrice : null,
    coinDiscountAmount: canPurchaseWithCoinsDiscount ? product.coinDiscountAmount : null,
    cashPrice,
    availableForPurchase: product.productStatus === 'ACTIVE' && canPurchaseWithCash && availableCommercialStock > 0,
    availableForDrop: dropState === 'OPEN' && availableDropStock > 0,
    commercialAvailability: availableCommercialStock > 0 ? 'AVAILABLE' : 'UNAVAILABLE',
    dropState,
    nextDropAt,
    drop: relevantDrop ? publicDrop(relevantDrop) : null,
  };
}

export class StoreEngine {
  static async ensureRealCatalogue(): Promise<{ created: number; existing: number; total: number }> {
    if (!db) throw new Error('Database not initialized');
    const products = materializeCatalogue();
    const markerRef = db.collection('system_config').doc('store_catalogue_v1');
    const marker = await markerRef.get();
    if (marker.exists && marker.data()?.version === CATALOGUE_VERSION && marker.data()?.total === products.length) return { created: 0, existing: products.length, total: products.length };
    let created = 0;
    let existing = 0;
    for (const product of products) {
      const normalizedName = `${product.brand} ${product.name}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      if (product.gtin) {
        const gtinMatches = await db.collection('products').where('gtin', '==', product.gtin).limit(2).get();
        const conflicting = gtinMatches.docs.find(doc => doc.id !== product.productId);
        if (conflicting) throw new Error(`GTIN duplicado: ${product.gtin}`);
      }
      if (product.supplierCode) {
        const codeMatches = await db.collection('products').where('supplierCode', '==', product.supplierCode).limit(2).get();
        const conflicting = codeMatches.docs.find(doc => doc.id !== product.productId);
        if (conflicting) throw new Error(`Código do fornecedor duplicado: ${product.supplierCode}`);
      }
      const normalizedMatches = await db.collection('products').where('normalizedName', '==', normalizedName).limit(2).get();
      const normalizedConflict = normalizedMatches.docs.find(doc => doc.id !== product.productId);
      if (normalizedConflict) throw new Error(`Produto duplicado por marca e nome: ${product.brand} / ${product.name}`);
      const exactNameMatches = await db.collection('products').where('name', '==', product.name).limit(10).get();
      const exactNameConflict = exactNameMatches.docs.find(doc => doc.id !== product.productId && String(doc.data().brand || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase() === product.brand.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase());
      if (exactNameConflict) throw new Error(`Produto duplicado por marca e nome: ${product.brand} / ${product.name}`);
      const ref = db.collection('products').doc(product.productId);
      const snapshot = await ref.get();
      const currentData = snapshot.exists ? snapshot.data() || {} : {};
      const currentPricing = currentData.pricing && typeof currentData.pricing === 'object' ? currentData.pricing : {};
      const mergedPricing = { ...product.pricing, ...currentPricing, cashPrice: currentPricing.cashPrice ?? product.pricing.cashPrice, supplierCost: currentPricing.supplierCost ?? currentData.currentSupplierCost ?? product.currentSupplierCost };
      const mergedProduct = normalizeProduct({
        ...product,
        ...currentData,
        productId: product.productId,
        name: product.name,
        normalizedName,
        brand: product.brand,
        category: product.category,
        subcategory: product.subcategory,
        supplierCode: product.supplierCode,
        gtin: product.gtin,
        gtinCandidate: product.gtinCandidate ?? currentData.gtinCandidate ?? null,
        boxGtin: product.boxGtin ?? currentData.boxGtin ?? null,
        boxGtinCandidate: product.boxGtinCandidate ?? currentData.boxGtinCandidate ?? null,
        barcodeType: product.barcodeType,
        supplierDescription: product.supplierDescription ?? currentData.supplierDescription ?? null,
        regularSupplierCost: currentData.regularSupplierCost ?? product.regularSupplierCost,
        promotionMinimumQuantity: currentData.promotionMinimumQuantity ?? product.promotionMinimumQuantity,
        productStatus: currentData.productStatus === 'ACTIVE' ? 'ACTIVE' : product.productStatus,
        currentSupplierCost: currentData.currentSupplierCost ?? product.currentSupplierCost,
        canPurchaseWithCash: typeof currentData.canPurchaseWithCash === 'boolean' ? currentData.canPurchaseWithCash : product.canPurchaseWithCash,
        canPurchaseWithCoinsDiscount: typeof currentData.canPurchaseWithCoinsDiscount === 'boolean' ? currentData.canPurchaseWithCoinsDiscount : product.canPurchaseWithCoinsDiscount,
        coinDiscountPrice: currentData.coinDiscountPrice ?? product.coinDiscountPrice,
        coinDiscountAmount: currentData.coinDiscountAmount ?? product.coinDiscountAmount,
        pricing: mergedPricing,
        createdAt: currentData.createdAt || product.createdAt,
        updatedAt: nowIso(),
      });
      mergedProduct.adminPending = getAdminPending({ ...mergedProduct, adminPending: [...(product.adminPending || []), ...(currentData.adminPending || [])] });
      if (snapshot.exists) {
        existing += 1;
        const seededImages = product.imageStatus === 'READY' && (currentData.imageStatus !== 'READY' || !currentData.images?.primary?.includes('/assets/store/products/catalog/'))
          ? { images: product.images, imageStatus: product.imageStatus }
          : {};
        await ref.set({ ...mergedProduct, normalizedName, ...seededImages, updatedAt: nowIso() }, { merge: true });
      } else {
        await ref.create({ ...mergedProduct, normalizedName });
        created += 1;
      }

      if (product.supplierCode) {
        await db.collection('supplierProducts').doc(`catalogue_${product.productId}`).set({ productId: product.productId, supplierId: product.supplierId, supplierCode: product.supplierCode, gtin: product.gtin, gtinCandidate: product.gtinCandidate ?? null, boxGtin: product.boxGtin ?? null, boxGtinCandidate: product.boxGtinCandidate ?? null, currentSupplierCost: product.currentSupplierCost, currency: product.currency, source: 'SUPPLIER_CATALOG', updatedAt: nowIso() }, { merge: true });
      }

      if (product.currentSupplierCost !== null) {
        const historyRef = db.collection('productCostHistory').doc(costHistoryDocumentId(product.productId, product.currentSupplierCost));
        const history = await historyRef.get();
        if (!history.exists) await historyRef.create({ productId: product.productId, supplierId: product.supplierId, oldCost: null, newCost: product.currentSupplierCost, changedAt: nowIso(), source: 'SUPPLIER_CATALOG', promotion: Boolean(product.promotionMinimumQuantity), promotionMinimumQuantity: product.promotionMinimumQuantity });
      }
    }
    await markerRef.set({ version: CATALOGUE_VERSION, total: products.length, updatedAt: nowIso() }, { merge: true });
    return { created, existing, total: products.length };
  }

  static async getActiveDrop(): Promise<StoreDrop | null> {
    if (!db) return null;
    const snapshot = await db.collection('store_drops').get();
    const now = Date.now();
    const drops = snapshot.docs.map(doc => normalizeDrop(doc.id, doc.data() || {})).filter(drop => ['ACTIVE', 'SCHEDULED'].includes(drop.status || '') && Date.parse(drop.endsAt) >= now);
    return drops.sort((a, b) => {
      const aOpen = dropIsOpen(a, now) ? 0 : 1;
      const bOpen = dropIsOpen(b, now) ? 0 : 1;
      return aOpen - bOpen || Date.parse(a.startsAt) - Date.parse(b.startsAt);
    })[0] || null;
  }

  static async getActiveDropForProduct(productId: string): Promise<StoreDrop | null> {
    const drops = await this.getAllDrops();
    const now = Date.now();
    return drops.filter(drop => dropTargetsProduct(drop, productId) && ['ACTIVE', 'SCHEDULED'].includes(drop.status || '') && Date.parse(drop.endsAt) >= now).sort((a, b) => (dropIsOpen(a, now) ? 0 : 1) - (dropIsOpen(b, now) ? 0 : 1) || Date.parse(a.startsAt) - Date.parse(b.startsAt))[0] || null;
  }

  private static async getAllDrops(): Promise<StoreDrop[]> {
    if (!db) return [];
    const snapshot = await db.collection('store_drops').get();
    return snapshot.docs.map(doc => normalizeDrop(doc.id, doc.data() || {}));
  }

  static async getPublicProducts(): Promise<PublicPhysicalProduct[]> {
    if (!db) return [];
    const [snapshot, drop] = await Promise.all([db.collection('products').where('active', '==', true).get(), this.getActiveDrop()]);
    return snapshot.docs.map(doc => normalizeProduct(doc.data() || {}, doc.id)).filter(product => product.storeVisible && product.published).sort((a, b) => a.displayOrder - b.displayOrder).map(product => productPublicView(product, drop));
  }

  static async getPublicProduct(productId: string): Promise<PublicPhysicalProduct | null> {
    if (!db) return null;
    const [snapshot, drop] = await Promise.all([db.collection('products').doc(productId).get(), this.getActiveDrop()]);
    if (!snapshot.exists) return null;
    const product = normalizeProduct(snapshot.data() || {}, productId);
    if (!product.active || !product.storeVisible || !product.published) return null;
    return productPublicView(product, drop);
  }

  static async getAdminProducts(): Promise<Array<PhysicalProduct & { publicationGaps: string[] }>> {
    if (!db) return materializeCatalogue().map(product => ({ ...product, adminPending: getAdminPending(product), publicationGaps: getPublicationGaps(product) }));
    const snapshot = await db.collection('products').get();
    return snapshot.docs.map(doc => normalizeProduct(doc.data() || {}, doc.id)).sort((a, b) => a.displayOrder - b.displayOrder).map(product => ({ ...product, adminPending: getAdminPending(product), publicationGaps: getPublicationGaps(product) }));
  }

  static async updatePricing(productId: string, input: PricingInput): Promise<PhysicalProduct> {
    if (!db) throw new Error('Database not initialized');
    const ref = db.collection('products').doc(productId);
    const snapshot = await ref.get();
    if (!snapshot.exists) throw new Error('Produto não encontrado.');
    const product = normalizeProduct(snapshot.data() || {}, productId);
    if (product.currentSupplierCost === null) throw new Error('Defina o custo do fornecedor antes da precificação.');
    const pricing = calculateProductPricing(product.currentSupplierCost, input);
    const canPurchaseWithCash = Boolean(pricing.cashPrice && pricing.cashPrice > 0);
    const productStatus = pricing.cashPrice !== null && product.productStatus === 'READY_FOR_PRICING' ? 'READY_FOR_REVIEW' : product.productStatus;
    const updated = { ...product, pricing, canPurchaseWithCash, productStatus };
    const adminPending = getAdminPending(updated);
    await ref.set({ pricing, canPurchaseWithCash, productStatus, adminPending, updatedAt: nowIso() }, { merge: true });
    return { ...updated, adminPending };
  }

  static async updateSupplierCost(productId: string, newCost: number, source: string): Promise<void> {
    if (!db) throw new Error('Database not initialized');
    if (!Number.isFinite(newCost) || newCost < 0) throw new Error('Custo inválido.');
    const ref = db.collection('products').doc(productId);
    await db.runTransaction(async transaction => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) throw new Error('Produto não encontrado.');
      const product = normalizeProduct(snapshot.data() || {}, productId);
      if (product.currentSupplierCost === newCost) return;
      transaction.create(db.collection('productCostHistory').doc(), { productId, supplierId: product.supplierId || null, oldCost: product.currentSupplierCost, newCost, changedAt: nowIso(), source, promotion: Boolean(product.promotionMinimumQuantity), promotionMinimumQuantity: product.promotionMinimumQuantity });
      transaction.update(ref, { currentSupplierCost: newCost, 'pricing.supplierCost': newCost, 'pricing.supplierCostAtLastPricing': null, 'pricing.lastCalculatedAt': null, lastCostUpdate: nowIso(), updatedAt: nowIso() });
    });
  }

  static async updateProductConfiguration(productId: string, input: ProductConfigurationInput): Promise<PhysicalProduct> {
    if (!db) throw new Error('Database not initialized');
    const ref = db.collection('products').doc(productId);
    const snapshot = await ref.get();
    if (!snapshot.exists) throw new Error('Produto não encontrado.');
    const product = normalizeProduct(snapshot.data() || {}, productId);
    const optionalPrice = (value: unknown, fallback: number | null) => value === null ? null : typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
    const publicDescription = input.publicDescription === null ? null : typeof input.publicDescription === 'string' ? input.publicDescription.trim().slice(0, 4000) || null : product.publicDescription;
    const publicHighlights = Array.isArray(input.publicHighlights) ? input.publicHighlights.filter(item => typeof item === 'string').map(item => item.trim()).filter(Boolean).slice(0, 8).map(item => item.slice(0, 180)) : product.publicHighlights;
    const optionalText = (value: unknown, fallback: string | null, max: number) => value === null ? null : typeof value === 'string' ? value.trim().slice(0, max) || null : fallback;
    const supplierId = optionalText(input.supplierId, product.supplierId || null, 128);
    const supplierSku = optionalText(input.supplierSku, product.supplierSku || null, 128);
    const gtin = input.gtin === null ? null : typeof input.gtin === 'string' ? input.gtin.replace(/\D/g, '') || null : product.gtin;
    if (gtin && !isValidGtin13(gtin)) throw new Error('GTIN/EAN-13 inválido: verifique os dígitos e o checksum.');
    if (gtin) {
      const matches = await db.collection('products').where('gtin', '==', gtin).limit(2).get();
      if (matches.docs.some(document => document.id !== productId)) throw new Error('GTIN/EAN já vinculado a outro produto.');
    }
    const currentSupplierCost = input.currentSupplierCost === null ? null : typeof input.currentSupplierCost === 'number' && Number.isFinite(input.currentSupplierCost) && input.currentSupplierCost >= 0 ? input.currentSupplierCost : product.currentSupplierCost;
    const minimumOrderQuantity = input.minimumOrderQuantity === null ? null : typeof input.minimumOrderQuantity === 'number' && Number.isInteger(input.minimumOrderQuantity) && input.minimumOrderQuantity > 0 ? input.minimumOrderQuantity : product.minimumOrderQuantity;
    const leadTime = optionalText(input.leadTime, product.leadTime, 120);
    const cashPrice = optionalPrice(input.cashPrice, product.pricing.cashPrice);
    const coinDiscountPrice = optionalPrice(input.coinDiscountPrice, product.coinDiscountPrice);
    const coinDiscountAmount = positiveInteger(input.coinDiscountAmount, product.coinDiscountAmount);
    const commercialStock = integer(input.commercialStock, product.commercialStock);
    const dropStock = integer(input.dropStock, product.dropStock);
    if (commercialStock < product.reservedCommercialStock) throw new Error('Estoque comercial não pode ser menor que o estoque reservado.');
    if (dropStock < product.reservedDropStock) throw new Error('Estoque do Drop não pode ser menor que o estoque reservado.');
    const canPurchaseWithCash = typeof input.canPurchaseWithCash === 'boolean' ? input.canPurchaseWithCash : typeof input.canPurchaseWithMoney === 'boolean' ? input.canPurchaseWithMoney : product.canPurchaseWithCash;
    const canPurchaseWithCoinsDiscount = typeof input.canPurchaseWithCoinsDiscount === 'boolean' ? input.canPurchaseWithCoinsDiscount : product.canPurchaseWithCoinsDiscount;
    if (canPurchaseWithCash && (!cashPrice || cashPrice <= 0)) throw new Error('Informe um preço em dinheiro válido antes de habilitar a compra.');
    if (canPurchaseWithCoinsDiscount && (!coinDiscountPrice || coinDiscountPrice <= 0 || !coinDiscountAmount || coinDiscountAmount <= 0)) throw new Error('Informe preço com desconto e Coins antes de habilitar essa opção.');
    if (canPurchaseWithCoinsDiscount && canPurchaseWithCash && coinDiscountPrice! >= cashPrice!) throw new Error('O preço com Coins precisa ser menor que o preço normal.');
    const requestedStatus = input.productStatus === 'ACTIVE' ? 'ACTIVE' : product.productStatus === 'DRAFT' && gtin && currentSupplierCost !== null ? 'READY_FOR_PRICING' : product.productStatus;
    if (requestedStatus === 'ACTIVE' && product.productStatus !== 'ACTIVE') {
      const activationReady = supplierId && supplierSku && gtin && currentSupplierCost !== null && minimumOrderQuantity && leadTime && publicDescription && (commercialStock > 0 || dropStock > 0) && (canPurchaseWithCash || canPurchaseWithCoinsDiscount) && product.imageStatus === 'READY' && product.images.primary && product.pricing.lastCalculatedAt;
      if (!activationReady) throw new Error('Preencha fornecedor, custo, descrição pública, preço, estoque, EAN/SKU, imagens e precificação antes de ativar.');
    }
    const pricing = currentSupplierCost !== product.currentSupplierCost ? { ...product.pricing, supplierCost: currentSupplierCost, supplierCostAtLastPricing: null, lastCalculatedAt: null } : cashPrice !== product.pricing.cashPrice ? calculateProductPricing(currentSupplierCost || 0, { ...product.pricing, cashPrice }) : { ...product.pricing, cashPrice, supplierCost: currentSupplierCost };
    const changes: Partial<PhysicalProduct> = {
      productStatus: requestedStatus,
      developmentStatus: requestedStatus === 'DRAFT' || requestedStatus === 'COMING_SOON' ? 'PRODUCT_DEVELOPMENT_PENDING' : 'READY',
      supplierId,
      supplierSku,
      gtin,
      barcodeType: gtin ? 'EAN13' : null,
      currentSupplierCost,
      minimumOrderQuantity,
      leadTime,
      publicDescription,
      publicHighlights,
      pricing,
      coinDiscountPrice,
      coinDiscountAmount,
      commercialStock,
      dropStock,
      displayOrder: integer(input.displayOrder, product.displayOrder),
      active: typeof input.active === 'boolean' ? input.active : product.active,
      storeVisible: typeof input.storeVisible === 'boolean' ? input.storeVisible : product.storeVisible,
      published: typeof input.published === 'boolean' ? input.published : product.published,
      canPurchaseWithCash: Boolean(canPurchaseWithCash),
      canPurchaseWithCoinsDiscount: Boolean(canPurchaseWithCoinsDiscount),
      updatedAt: nowIso(),
    };
    changes.adminPending = getAdminPending({ ...product, ...changes, pricing } as PhysicalProduct);
    await db.runTransaction(async transaction => {
      if (currentSupplierCost !== product.currentSupplierCost) transaction.create(db.collection('productCostHistory').doc(), { productId, supplierId, oldCost: product.currentSupplierCost, newCost: currentSupplierCost, changedAt: nowIso(), source: 'admin-development', promotion: false, promotionMinimumQuantity: null });
      transaction.set(ref, changes, { merge: true });
    });
    return { ...product, ...changes } as PhysicalProduct;
  }

  static calculateDropExposure(product: PhysicalProduct, extras: { stock?: number; freightSubsidy?: number; packaging?: number; fulfillment?: number; otherCosts?: number } = {}): number {
    return Math.max(0, extras.stock ?? product.dropStock) * money(product.currentSupplierCost) + money(extras.freightSubsidy) + money(extras.packaging) + money(extras.fulfillment) + money(extras.otherCosts);
  }

  static async getAdminDrops(): Promise<Array<StoreDrop & { maximumExposure: number }>> {
    if (!db) throw new Error('Database not initialized');
    const [dropsSnapshot, productsSnapshot] = await Promise.all([db.collection('store_drops').get(), db.collection('products').get()]);
    const products = new Map(productsSnapshot.docs.map(doc => [doc.id, normalizeProduct(doc.data() || {}, doc.id)]));
    return dropsSnapshot.docs.map(doc => {
      const drop = normalizeDrop(doc.id, doc.data() || {});
      const product = drop.productId ? products.get(drop.productId) : null;
      const exposure = product ? this.calculateDropExposure(product, { stock: drop.initialStock, freightSubsidy: drop.freightSubsidy, packaging: drop.packagingCost, fulfillment: drop.fulfillmentCost, otherCosts: drop.otherCosts }) : 0;
      return { ...drop, maximumExposure: exposure };
    }).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  }

  static async saveDrop(input: Partial<StoreDrop>): Promise<StoreDrop> {
    if (!db) throw new Error('Database not initialized');
    const raw = input as Partial<StoreDrop> & { budgetLimit?: number | null };
    const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 120) : '';
    const startsAt = toIso(raw.startsAt);
    const endsAt = toIso(raw.endsAt);
    if (!name || !startsAt || !endsAt || Date.parse(endsAt) <= Date.parse(startsAt)) throw new Error('Nome e período válido são obrigatórios.');
    const productId = typeof raw.productId === 'string' && raw.productId.trim() ? raw.productId.trim() : Array.isArray(raw.productIds) && typeof raw.productIds[0] === 'string' ? raw.productIds[0] : '';
    if (!productId || productId.length > 128) throw new Error('Selecione um único produto para o Drop.');
    const productRef = db.collection('products').doc(productId);
    const productSnapshot = await productRef.get();
    if (!productSnapshot.exists) throw new Error('O Drop contém um produto inexistente.');
    const product = normalizeProduct(productSnapshot.data() || {}, productId);
    const currentId = typeof raw.id === 'string' && /^drop_[a-zA-Z0-9_-]+$/.test(raw.id) ? raw.id : `drop_${hashKey(name, startsAt, productId).slice(0, 18)}`;
    const existingRef = db.collection('store_drops').doc(currentId);
    const existingSnapshot = await existingRef.get();
    const previous = existingSnapshot.exists ? normalizeDrop(currentId, existingSnapshot.data() || {}) : null;
    const status = normalizeDropStatus(raw.status, startsAt, endsAt, raw.active === true);
    const coinPrice = positiveInteger(raw.coinPrice, previous?.coinPrice || null);
    const requestedStock = positiveInteger(raw.initialStock, previous?.initialStock || integer(product.dropStock));
    const limitPerUser = positiveInteger(raw.limitPerUser, previous?.limitPerUser || 1);
    if (!coinPrice) throw new Error('Informe o preço do Drop em Coins.');
    if (!requestedStock) throw new Error('Informe o estoque inicial do Drop.');
    if (!limitPerUser || limitPerUser > requestedStock) throw new Error('O limite por usuário deve ser maior que zero e não pode superar o estoque.');
    const previousReserved = previous?.reservedStock || 0;
    const previousSold = previous ? Math.max(0, (previous.initialStock || 0) - (previous.availableStock || 0) - previousReserved) : 0;
    if (requestedStock < previousReserved + previousSold) throw new Error('O estoque inicial não pode ficar abaixo do que já foi reservado ou vendido.');
    const availableStock = requestedStock - previousReserved - previousSold;
    const shippingMode = normalizeShippingMode(raw.shippingMode || previous?.shippingMode);
    const freightSubsidy = money(raw.freightSubsidy ?? previous?.freightSubsidy);
    const packagingCost = money(raw.packagingCost ?? previous?.packagingCost);
    const fulfillmentCost = money(raw.fulfillmentCost ?? previous?.fulfillmentCost);
    const otherCosts = money(raw.otherCosts ?? previous?.otherCosts);
    const maxBudget = raw.maxBudget === null || raw.budgetLimit === null ? null : nullableMoney(raw.maxBudget ?? raw.budgetLimit ?? previous?.maxBudget ?? (process.env.STORE_DROP_MAX_BUDGET ? Number(process.env.STORE_DROP_MAX_BUDGET) : null));
    const maxExposure = this.calculateDropExposure(product, { stock: requestedStock, freightSubsidy, packaging: packagingCost, fulfillment: fulfillmentCost, otherCosts });
    if ((status === 'ACTIVE' || status === 'SCHEDULED') && maxBudget !== null && maxExposure > maxBudget) throw new Error(`A exposição máxima (${maxExposure.toFixed(2)}) supera o orçamento do Drop (${maxBudget.toFixed(2)}).`);
    if ((status === 'ACTIVE' || status === 'SCHEDULED') && (!product.active || !product.published || product.productStatus !== 'ACTIVE' || !product.gtin || product.currentSupplierCost === null)) throw new Error('Ative e valide o produto antes de agendar ou abrir um Drop.');
    if ((status === 'ACTIVE' || status === 'SCHEDULED') && shippingMode === 'CUSTOMER_PAID' && this.getDefaultShippingAmount() > 0) throw new Error('Drops 100% Coins precisam usar frete subsidiado, patrocinado ou campanha grátis.');
    const allDrops = await this.getAllDrops();
    const overlaps = allDrops.some(drop => drop.id !== currentId && dropTargetsProduct(drop, productId) && ['ACTIVE', 'SCHEDULED'].includes(drop.status || '') && Date.parse(drop.startsAt) < Date.parse(endsAt) && Date.parse(drop.endsAt) > Date.parse(startsAt));
    if (overlaps) throw new Error('Já existe um Drop do mesmo produto sobreposto neste período.');
    const now = nowIso();
    const drop: StoreDrop = {
      id: currentId,
      name,
      productId,
      productIds: [productId],
      coinPrice,
      initialStock: requestedStock,
      availableStock,
      reservedStock: previousReserved,
      limitPerUser,
      startsAt,
      endsAt,
      status,
      active: status === 'ACTIVE',
      shippingMode,
      maxExposure,
      maxBudget,
      image: typeof raw.image === 'string' ? raw.image.trim().slice(0, 2048) || null : previous?.image || null,
      freightSubsidy,
      packagingCost,
      fulfillmentCost,
      otherCosts,
      createdAt: previous?.createdAt || now,
      updatedAt: now,
    };
    await db.runTransaction(async transaction => {
      const [freshDrop, freshProduct] = await Promise.all([transaction.get(existingRef), transaction.get(productRef)]);
      if (!freshProduct.exists) throw new Error('Produto não encontrado.');
      const liveDrop = freshDrop.exists ? normalizeDrop(currentId, freshDrop.data() || {}) : null;
      if (liveDrop && requestedStock < (liveDrop.reservedStock || 0)) throw new Error('O estoque já reservado não pode ser reduzido.');
      transaction.set(existingRef, drop, { merge: false });
      transaction.update(productRef, { dropStock: requestedStock, reservedDropStock: liveDrop?.reservedStock || 0, updatedAt: now });
    });
    return drop;
  }

  static getDefaultShippingAmount(): number {
    const configured = Number(process.env.STORE_DEFAULT_SHIPPING_AMOUNT);
    return Number.isFinite(configured) && configured >= 0 ? roundMoney(configured) : 0;
  }

  static async redeemWithCoins(params: { userId: string; productId: string; quantity: number; address: PhysicalShippingAddress; idempotencyKey: string }): Promise<{ order: PhysicalOrder; duplicated: boolean }> {
    if (!db) throw new Error('Database not initialized');
    const quantity = Number(params.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_ORDER_QUANTITY) throw new Error('Quantidade inválida.');
    if (!params.idempotencyKey?.trim()) throw new Error('Chave de idempotência obrigatória.');
    const address = this.validateAddress(params.address);
    const drop = await this.getActiveDropForProduct(params.productId);
    if (!drop) throw new Error('Nenhum Drop aberto para este produto.');
    if (drop.shippingMode === 'CUSTOMER_PAID' && this.getDefaultShippingAmount() > 0) throw new Error('O frete deste Drop ainda precisa ser subsidiado ou configurado como campanha grátis.');
    const token = hashKey(params.userId, params.idempotencyKey.trim(), drop.id);
    const orderId = `store_drop_${token}`;
    const orderRef = db.collection('physicalOrders').doc(orderId);
    const itemRef = db.collection('physicalOrderItems').doc(`${orderId}_${params.productId}`);
    const walletRef = db.collection('reward_coin_wallets').doc(params.userId);
    const productRef = db.collection('products').doc(params.productId);
    const dropRef = db.collection('store_drops').doc(drop.id);
    const coinTransactionRef = db.collection('reward_coin_transactions').doc(`coin_drop_redemption_${token}`);
    const redemptionRef = db.collection('store_drop_redemptions').doc(`${drop.id}_${params.userId}`);
    let duplicated = false;

    await db.runTransaction(async transaction => {
      const [existingOrder, productSnapshot, walletSnapshot, dropSnapshot, redemptionSnapshot, coinSnapshot] = await Promise.all([
        transaction.get(orderRef), transaction.get(productRef), transaction.get(walletRef), transaction.get(dropRef), transaction.get(redemptionRef), transaction.get(coinTransactionRef),
      ]);
      if (existingOrder.exists) { duplicated = true; return; }
      if (coinSnapshot.exists) throw new Error('Este resgate já foi processado.');
      if (!productSnapshot.exists || !dropSnapshot.exists) throw new Error('Produto ou Drop não encontrado.');
      const product = normalizeProduct(productSnapshot.data() || {}, params.productId);
      const currentDrop = normalizeDrop(drop.id, dropSnapshot.data() || {});
      const now = Date.now();
      if (!dropTargetsProduct(currentDrop, product.productId) || !dropIsOpen(currentDrop, now)) throw new Error('Este Drop não está aberto.');
      if (currentDrop.status === 'SOLD_OUT' || dropAvailableStock(currentDrop) < quantity) throw new Error('Estoque do Drop insuficiente.');
      if (!currentDrop.coinPrice || currentDrop.coinPrice <= 0) throw new Error('Preço do Drop não configurado.');
      const alreadyRedeemed = integer(redemptionSnapshot.data()?.quantity);
      if (alreadyRedeemed + quantity > (currentDrop.limitPerUser || 1)) throw new Error('O limite deste Drop por usuário foi atingido.');
      if (product.productStatus !== 'ACTIVE' || !product.gtin || product.currentSupplierCost === null || !product.active || !product.published) throw new Error('Produto indisponível para resgate.');
      const exposure = this.calculateDropExposure(product, { stock: currentDrop.initialStock, freightSubsidy: currentDrop.freightSubsidy, packaging: currentDrop.packagingCost, fulfillment: currentDrop.fulfillmentCost, otherCosts: currentDrop.otherCosts });
      if (currentDrop.maxBudget !== null && currentDrop.maxBudget !== undefined && exposure > currentDrop.maxBudget) throw new Error('O orçamento máximo deste Drop foi ultrapassado.');
      const totalCoinAmount = currentDrop.coinPrice * quantity;
      const wallet = walletSnapshot.exists ? walletSnapshot.data() || {} : {};
      const balance = Math.max(0, Number(wallet.balance) || 0);
      if (balance < totalCoinAmount) throw new Error('Saldo de Invictus Coins insuficiente.');
      const createdAt = nowIso();
      const order: PhysicalOrder = { orderId, userId: params.userId, status: 'PROCESSING', paymentMethod: 'COINS', totalCashAmount: 0, totalCoinAmount, shippingAmount: 0, address, dropId: currentDrop.id, idempotencyKey: params.idempotencyKey.trim(), paymentProvider: null, paymentReference: null, coinReservationStatus: 'CONSUMED', shippingMode: currentDrop.shippingMode, createdAt, updatedAt: createdAt };
      const item: PhysicalOrderItemSnapshot = { productId: product.productId, name: product.name, gtin: product.gtin, supplierCode: product.supplierCode || null, image: product.images.primary, quantity, unitPrice: 0, supplierCostSnapshot: product.currentSupplierCost, coinAmountUsed: totalCoinAmount, cashAmount: 0, shippingAmount: 0, cashPriceAtPurchase: 0, discountMode: 'DROP', shippingMode: currentDrop.shippingMode, createdAt };
      const coinTransaction: RewardCoinTransaction = { id: coinTransactionRef.id, userId: params.userId, amount: totalCoinAmount, type: 'debit', origin: 'store_purchase', ledgerType: 'DROP_REDEMPTION', description: `Resgate no Drop ${currentDrop.name}: ${product.name}`, idempotencyKey: params.idempotencyKey.trim(), productId: product.productId, orderId, dropId: currentDrop.id, balanceBefore: balance, balanceAfter: balance - totalCoinAmount, metadata: { status: 'CONSUMED', quantity }, createdAt };
      const currentAvailable = dropAvailableStock(currentDrop);
      const currentReserved = integer(currentDrop.reservedStock);
      transaction.update(dropRef, { availableStock: currentAvailable - quantity, reservedStock: currentReserved + quantity, status: currentAvailable - quantity <= 0 ? 'SOLD_OUT' : currentDrop.status, active: currentAvailable - quantity > 0 && currentDrop.status === 'ACTIVE', updatedAt: createdAt });
      transaction.update(productRef, { dropStock: Math.max(product.dropStock, integer(currentDrop.initialStock)), reservedDropStock: product.reservedDropStock + quantity, updatedAt: createdAt });
      transaction.set(walletRef, { userId: params.userId, balance: balance - totalCoinAmount, lifetimeEarned: Math.max(0, Number(wallet.lifetimeEarned) || 0), lifetimeSpent: Math.max(0, Number(wallet.lifetimeSpent) || 0) + totalCoinAmount, updatedAt: createdAt }, { merge: true });
      transaction.set(redemptionRef, { userId: params.userId, dropId: currentDrop.id, productId: product.productId, quantity: alreadyRedeemed + quantity, updatedAt: createdAt }, { merge: true });
      transaction.create(orderRef, order);
      transaction.create(itemRef, { orderId, userId: params.userId, ...item });
      transaction.create(coinTransactionRef, coinTransaction);
    });
    const orderSnapshot = await orderRef.get();
    return { order: orderSnapshot.data() as PhysicalOrder, duplicated };
  }

  static async createMoneyOrder(params: { userId: string; productId: string; quantity: number; address: PhysicalShippingAddress; paymentMethod: 'MONEY' | 'COINS_PLUS_MONEY'; idempotencyKey: string }): Promise<{ order: PhysicalOrder; duplicated: boolean }> {
    if (!db) throw new Error('Database not initialized');
    const quantity = Number(params.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_ORDER_QUANTITY) throw new Error('Quantidade inválida.');
    if (!params.idempotencyKey?.trim()) throw new Error('Chave de idempotência obrigatória.');
    const address = this.validateAddress(params.address);
    const token = hashKey(params.userId, params.idempotencyKey.trim(), params.paymentMethod);
    const orderId = `store_cash_${token}`;
    const orderRef = db.collection('physicalOrders').doc(orderId);
    const itemRef = db.collection('physicalOrderItems').doc(`${orderId}_${params.productId}`);
    const walletRef = db.collection('reward_coin_wallets').doc(params.userId);
    const productRef = db.collection('products').doc(params.productId);
    const coinHoldRef = db.collection('reward_coin_transactions').doc(`coin_store_discount_hold_${token}`);
    const shippingAmount = this.getDefaultShippingAmount();
    let duplicated = false;

    await db.runTransaction(async transaction => {
      const [existingOrder, productSnapshot, walletSnapshot, holdSnapshot] = await Promise.all([transaction.get(orderRef), transaction.get(productRef), transaction.get(walletRef), transaction.get(coinHoldRef)]);
      if (existingOrder.exists) { duplicated = true; return; }
      if (!productSnapshot.exists) throw new Error('Produto não encontrado.');
      const product = normalizeProduct(productSnapshot.data() || {}, params.productId);
      const cashPrice = product.pricing.cashPrice;
      if (product.productStatus !== 'ACTIVE' || !product.active || !product.published || !product.gtin || product.currentSupplierCost === null || !product.canPurchaseWithCash || !cashPrice || cashPrice <= 0) throw new Error('Produto indisponível para compra em dinheiro.');
      const useDiscount = params.paymentMethod === 'COINS_PLUS_MONEY';
      if (useDiscount && (!product.canPurchaseWithCoinsDiscount || !product.coinDiscountPrice || !product.coinDiscountAmount || product.coinDiscountPrice >= cashPrice)) throw new Error('Desconto com Coins não está disponível para este produto.');
      const availableStock = product.commercialStock - product.reservedCommercialStock;
      if (availableStock < quantity) throw new Error('Estoque comercial insuficiente.');
      const unitCashAmount = useDiscount ? product.coinDiscountPrice! : cashPrice;
      const unitCoinAmount = useDiscount ? product.coinDiscountAmount! : 0;
      const totalCoinAmount = unitCoinAmount * quantity;
      const totalCashAmount = roundMoney(unitCashAmount * quantity + shippingAmount);
      const wallet = walletSnapshot.exists ? walletSnapshot.data() || {} : {};
      const balance = Math.max(0, Number(wallet.balance) || 0);
      if (useDiscount && balance < totalCoinAmount) throw new Error('Saldo de Invictus Coins insuficiente para aplicar o desconto.');
      if (holdSnapshot.exists) throw new Error('Esta reserva de Coins já existe.');
      const createdAt = nowIso();
      const expiration = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      const order: PhysicalOrder = { orderId, userId: params.userId, status: 'PENDING_PAYMENT', paymentMethod: params.paymentMethod, totalCashAmount, totalCoinAmount, shippingAmount, address, dropId: null, idempotencyKey: params.idempotencyKey.trim(), paymentProvider: null, paymentReference: null, coinReservationStatus: useDiscount ? 'HELD' : 'NONE', coinReservationExpiresAt: useDiscount ? expiration : null, shippingMode: 'CUSTOMER_PAID', createdAt, updatedAt: createdAt };
      const item: PhysicalOrderItemSnapshot = { productId: product.productId, name: product.name, gtin: product.gtin, supplierCode: product.supplierCode || null, image: product.images.primary, quantity, unitPrice: unitCashAmount, supplierCostSnapshot: product.currentSupplierCost, coinAmountUsed: totalCoinAmount, cashAmount: roundMoney(unitCashAmount * quantity), shippingAmount, cashPriceAtPurchase: cashPrice, discountMode: useDiscount ? 'COINS_DISCOUNT' : 'NONE', shippingMode: 'CUSTOMER_PAID', createdAt };
      transaction.update(productRef, { reservedCommercialStock: product.reservedCommercialStock + quantity, updatedAt: createdAt });
      if (useDiscount) {
        const hold: RewardCoinTransaction = { id: coinHoldRef.id, userId: params.userId, amount: totalCoinAmount, type: 'debit', origin: 'store_purchase', ledgerType: 'STORE_DISCOUNT', description: `Reserva de desconto com Coins: ${product.name}`, idempotencyKey: params.idempotencyKey.trim(), productId: product.productId, orderId, balanceBefore: balance, balanceAfter: balance - totalCoinAmount, metadata: { status: 'HELD', expiresAt: expiration, quantity }, createdAt };
        transaction.set(walletRef, { userId: params.userId, balance: balance - totalCoinAmount, lifetimeEarned: Math.max(0, Number(wallet.lifetimeEarned) || 0), lifetimeSpent: Math.max(0, Number(wallet.lifetimeSpent) || 0), updatedAt: createdAt }, { merge: true });
        transaction.create(coinHoldRef, hold);
      }
      transaction.create(orderRef, order);
      transaction.create(itemRef, { orderId, userId: params.userId, ...item });
    });
    const orderSnapshot = await orderRef.get();
    return { order: orderSnapshot.data() as PhysicalOrder, duplicated };
  }

  static async createPaymentForOrder(userId: string, orderId: string): Promise<{ provider: string; paymentId: string; invoiceUrl: string | null; qrCode: { encodedImage?: string; payload?: string; expirationDate?: string } }> {
    if (!db) throw new Error('Database not initialized');
    const orderRef = db.collection('physicalOrders').doc(orderId);
    const orderSnapshot = await orderRef.get();
    if (!orderSnapshot.exists) throw new Error('Pedido não encontrado.');
    const order = orderSnapshot.data() as PhysicalOrder;
    if (order.userId !== userId) throw new Error('Pedido não pertence ao usuário autenticado.');
    if (order.status !== 'PENDING_PAYMENT') throw new Error('Este pedido não aguarda pagamento.');
    if (order.paymentReference) {
      const qrCode = await AsaasClient.obterQrCodePix(order.paymentReference);
      return { provider: order.paymentProvider || 'asaas', paymentId: order.paymentReference, invoiceUrl: order.paymentInvoiceUrl || null, qrCode };
    }
    const profileSnapshot = await db.collection('users').doc(userId).get();
    const profile = profileSnapshot.data() || {};
    if (!profileSnapshot.exists || !profile.cpf) throw new Error('Complete seu CPF no perfil para gerar o pagamento PIX.');
    const customerId = await AsaasClient.criarOuObterCliente({ nome: profile.name || profile.displayName || 'Atleta Invictus', cpf: String(profile.cpf), email: profile.email, referenciaExterna: userId });
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 1);
    const charge = await AsaasClient.criarCobrancaPix({ clienteId: customerId, valor: order.totalCashAmount, descricao: `Loja Invictus - pedido ${order.orderId}`, referenciaExterna: order.orderId, vencimento: dueDate.toISOString().slice(0, 10) });
    await db.runTransaction(async transaction => {
      const current = await transaction.get(orderRef);
      if (!current.exists) throw new Error('Pedido não encontrado.');
      const currentOrder = current.data() as PhysicalOrder;
      if (currentOrder.userId !== userId) throw new Error('Pedido não pertence ao usuário autenticado.');
      if (currentOrder.status !== 'PENDING_PAYMENT') throw new Error('Este pedido não aguarda pagamento.');
      if (!currentOrder.paymentReference) transaction.update(orderRef, { paymentProvider: 'asaas', paymentReference: charge.id, paymentInvoiceUrl: charge.invoiceUrl || null, paymentDueAt: dueDate.toISOString(), updatedAt: nowIso() });
    });
    const qrCode = await AsaasClient.obterQrCodePix(charge.id);
    await orderRef.update({ paymentQrCode: qrCode, updatedAt: nowIso() });
    return { provider: 'asaas', paymentId: charge.id, invoiceUrl: charge.invoiceUrl || null, qrCode };
  }

  static async handleStorePaymentWebhook(paymentId: string, event: string, paidValue?: number): Promise<{ found: boolean; status?: string }> {
    if (!db || !paymentId) return { found: false };
    const search = await db.collection('physicalOrders').where('paymentReference', '==', paymentId).limit(1).get();
    if (search.empty) return { found: false };
    const orderRef = search.docs[0].ref;
    const normalizedEvent = String(event || '').toUpperCase();
    const approved = normalizedEvent === 'PAYMENT_RECEIVED' || normalizedEvent === 'PAYMENT_CONFIRMED';
    const failed = ['PAYMENT_OVERDUE', 'PAYMENT_DELETED', 'PAYMENT_REFUNDED', 'PAYMENT_CHARGEBACK_REQUESTED'].includes(normalizedEvent);
    if (!approved && !failed) return { found: true, status: 'ignored' };
    const currentSnapshot = await orderRef.get();
    if (!currentSnapshot.exists) return { found: true, status: 'missing' };
    const currentOrder = currentSnapshot.data() as PhysicalOrder;
    if (approved && paidValue !== undefined && Math.abs(Number(paidValue) - currentOrder.totalCashAmount) > 0.01) throw new Error('Valor recebido diferente do pedido da loja.');
    if (failed) {
      if (currentOrder.status === 'PENDING_PAYMENT') await this.updateOrderStatus(currentOrder.orderId, 'CANCELLED');
      else if (currentOrder.status === 'PAID' || currentOrder.status === 'PROCESSING') await this.updateOrderStatus(currentOrder.orderId, 'REFUNDED');
      return { found: true, status: currentOrder.status === 'PENDING_PAYMENT' ? 'cancelled' : 'refunded' };
    }
    await db.runTransaction(async transaction => {
      const orderSnapshot = await transaction.get(orderRef);
      if (!orderSnapshot.exists) throw new Error('Pedido não encontrado.');
      const order = orderSnapshot.data() as PhysicalOrder;
      if (order.status !== 'PENDING_PAYMENT') return;
      const walletRef = order.totalCoinAmount > 0 ? db.collection('reward_coin_wallets').doc(order.userId) : null;
      const holdRef = order.totalCoinAmount > 0 ? db.collection('reward_coin_transactions').doc(`coin_store_discount_hold_${hashKey(order.userId, order.idempotencyKey, order.paymentMethod)}`) : null;
      const walletSnapshot = walletRef ? await transaction.get(walletRef) : null;
      const holdSnapshot = holdRef ? await transaction.get(holdRef) : null;
      const now = nowIso();
      if (order.totalCoinAmount > 0) {
        if (!walletSnapshot?.exists || !holdSnapshot?.exists) throw new Error('Reserva de Coins do pedido não encontrada.');
        const wallet = walletSnapshot.data() || {};
        const hold = holdSnapshot.data() || {};
        if (hold.metadata?.status !== 'CONSUMED') {
          transaction.update(walletRef!, { lifetimeSpent: Math.max(0, Number(wallet.lifetimeSpent) || 0) + order.totalCoinAmount, updatedAt: now });
          transaction.update(holdRef!, { metadata: { ...(hold.metadata || {}), status: 'CONSUMED', consumedAt: now } });
        }
      }
      transaction.update(orderRef, { status: 'PAID', coinReservationStatus: order.totalCoinAmount > 0 ? 'CONSUMED' : 'NONE', paymentQrCode: null, updatedAt: now });
    });
    return { found: true, status: 'paid' };
  }

  static async getPhysicalOrder(userId: string, orderId: string): Promise<(PhysicalOrder & { items: Array<Omit<PhysicalOrderItemSnapshot, 'supplierCostSnapshot'>> }) | null> {
    if (!db) return null;
    const orderSnapshot = await db.collection('physicalOrders').doc(orderId).get();
    if (!orderSnapshot.exists || orderSnapshot.data()?.userId !== userId) return null;
    const itemSnapshot = await db.collection('physicalOrderItems').where('orderId', '==', orderId).where('userId', '==', userId).get();
    const items = itemSnapshot.docs.map(document => {
      const { supplierCostSnapshot: _supplierCostSnapshot, orderId: _orderId, userId: _userId, ...safeItem } = document.data() as PhysicalOrderItemSnapshot & { orderId: string; userId: string };
      return safeItem;
    });
    return { ...(orderSnapshot.data() as PhysicalOrder), items };
  }

  static async getMyPhysicalOrders(userId: string): Promise<Array<PhysicalOrder & { items: Array<Omit<PhysicalOrderItemSnapshot, 'supplierCostSnapshot'>> }>> {
    if (!db) return [];
    const [ordersSnapshot, itemsSnapshot] = await Promise.all([db.collection('physicalOrders').where('userId', '==', userId).get(), db.collection('physicalOrderItems').where('userId', '==', userId).get()]);
    const itemsByOrder = new Map<string, Array<Omit<PhysicalOrderItemSnapshot, 'supplierCostSnapshot'>>>();
    for (const itemDocument of itemsSnapshot.docs) {
      const { supplierCostSnapshot: _supplierCostSnapshot, orderId, userId: _userId, ...safeItem } = itemDocument.data() as PhysicalOrderItemSnapshot & { orderId: string; userId: string };
      itemsByOrder.set(orderId, [...(itemsByOrder.get(orderId) || []), safeItem]);
    }
    return ordersSnapshot.docs.map(doc => doc.data() as PhysicalOrder).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50).map(order => ({ ...order, items: itemsByOrder.get(order.orderId) || [] }));
  }

  static async getAdminOrders(): Promise<Array<PhysicalOrder & { items: PhysicalOrderItemSnapshot[] }>> {
    if (!db) return [];
    const [ordersSnapshot, itemsSnapshot] = await Promise.all([db.collection('physicalOrders').get(), db.collection('physicalOrderItems').get()]);
    const itemsByOrder = new Map<string, PhysicalOrderItemSnapshot[]>();
    for (const itemDocument of itemsSnapshot.docs) {
      const { orderId, userId: _userId, ...item } = itemDocument.data() as PhysicalOrderItemSnapshot & { orderId: string; userId: string };
      itemsByOrder.set(orderId, [...(itemsByOrder.get(orderId) || []), item]);
    }
    return ordersSnapshot.docs.map(doc => doc.data() as PhysicalOrder).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(order => ({ ...order, items: itemsByOrder.get(order.orderId) || [] }));
  }

  static async updateOrderStatus(orderId: string, nextStatus: PhysicalOrder['status'], trackingCode?: string): Promise<void> {
    if (!db) throw new Error('Database not initialized');
    const allowed: Record<PhysicalOrder['status'], PhysicalOrder['status'][]> = { PENDING_PAYMENT: ['CANCELLED'], PAID: ['PROCESSING', 'CANCELLED', 'REFUNDED'], PROCESSING: ['SHIPPED', 'CANCELLED', 'REFUNDED'], SHIPPED: ['DELIVERED'], DELIVERED: [], CANCELLED: [], REFUNDED: [] };
    const orderRef = db.collection('physicalOrders').doc(orderId);
    const itemsSnapshot = await db.collection('physicalOrderItems').where('orderId', '==', orderId).get();
    const items = itemsSnapshot.docs.map(doc => doc.data() as PhysicalOrderItemSnapshot);
    await db.runTransaction(async transaction => {
      const orderSnapshot = await transaction.get(orderRef);
      if (!orderSnapshot.exists) throw new Error('Pedido não encontrado.');
      const order = orderSnapshot.data() as PhysicalOrder;
      if (order.status === nextStatus) return;
      if (!allowed[order.status]?.includes(nextStatus)) throw new Error(`Transição inválida: ${order.status} → ${nextStatus}.`);
      const now = nowIso();
      const productRefs = items.map(item => db.collection('products').doc(item.productId));
      const productSnapshots = await Promise.all(productRefs.map(ref => transaction.get(ref)));
      const dropRef = order.dropId ? db.collection('store_drops').doc(order.dropId) : null;
      const dropSnapshot = dropRef ? await transaction.get(dropRef) : null;
      const shouldRelease = nextStatus === 'CANCELLED' || nextStatus === 'REFUNDED';
      const canReleaseStock = shouldRelease && order.status !== 'SHIPPED' && order.status !== 'DELIVERED';
      const hasCoinReservation = order.totalCoinAmount > 0 && order.coinReservationStatus !== 'RELEASED' && order.coinReservationStatus !== 'REFUNDED';
      const walletRef = hasCoinReservation ? db.collection('reward_coin_wallets').doc(order.userId) : null;
      const refundRef = hasCoinReservation ? db.collection('reward_coin_transactions').doc(`coin_store_refund_${order.orderId}`) : null;
      const holdRef = hasCoinReservation ? db.collection('reward_coin_transactions').doc(`coin_store_discount_hold_${hashKey(order.userId, order.idempotencyKey, order.paymentMethod)}`) : null;
      const [walletSnapshot, refundSnapshot, holdSnapshot] = await Promise.all([walletRef ? transaction.get(walletRef) : null, refundRef ? transaction.get(refundRef) : null, holdRef ? transaction.get(holdRef) : null]);

      if (nextStatus === 'SHIPPED') {
        if (!trackingCode?.trim()) throw new Error('Código de rastreio obrigatório para marcar como enviado.');
        if (order.dropId) {
          if (!dropSnapshot?.exists || !dropRef) throw new Error('Drop do pedido não encontrado.');
          const drop = normalizeDrop(order.dropId, dropSnapshot.data() || {});
          const quantity = items.reduce((sum, item) => sum + item.quantity, 0);
          const reserved = integer(drop.reservedStock);
          if (reserved < quantity) throw new Error('Reserva do Drop inconsistente.');
          transaction.update(dropRef, { reservedStock: reserved - quantity, updatedAt: now });
        }
        productSnapshots.forEach((snapshot, index) => {
          if (!snapshot.exists) throw new Error('Produto do pedido não encontrado.');
          const product = normalizeProduct(snapshot.data() || {}, items[index].productId);
          const quantity = items[index].quantity;
          if (order.dropId) {
            if (product.reservedDropStock < quantity) throw new Error('Reserva de estoque do Drop inconsistente.');
            transaction.update(productRefs[index], { dropStock: Math.max(0, product.dropStock - quantity), reservedDropStock: product.reservedDropStock - quantity, updatedAt: now });
          } else {
            if (product.reservedCommercialStock < quantity || product.commercialStock < quantity) throw new Error('Reserva de estoque comercial inconsistente.');
            transaction.update(productRefs[index], { commercialStock: product.commercialStock - quantity, reservedCommercialStock: product.reservedCommercialStock - quantity, updatedAt: now });
          }
        });
      }

      if (canReleaseStock) {
        if (order.dropId) {
          if (!dropSnapshot?.exists || !dropRef) throw new Error('Drop do pedido não encontrado.');
          const drop = normalizeDrop(order.dropId, dropSnapshot.data() || {});
          const quantity = items.reduce((sum, item) => sum + item.quantity, 0);
          const reserved = integer(drop.reservedStock);
          if (reserved < quantity) throw new Error('Reserva do Drop inconsistente.');
          transaction.update(dropRef, { availableStock: dropAvailableStock(drop) + quantity, reservedStock: reserved - quantity, status: drop.status === 'SOLD_OUT' ? 'ACTIVE' : drop.status, active: drop.status === 'SOLD_OUT' ? true : drop.active, updatedAt: now });
          productSnapshots.forEach((snapshot, index) => {
            if (!snapshot.exists) throw new Error('Produto do pedido não encontrado.');
            const product = normalizeProduct(snapshot.data() || {}, items[index].productId);
            const quantityForProduct = items[index].quantity;
            if (product.reservedDropStock < quantityForProduct) throw new Error('Reserva de estoque do produto inconsistente.');
            transaction.update(productRefs[index], { reservedDropStock: product.reservedDropStock - quantityForProduct, updatedAt: now });
          });
        } else {
          productSnapshots.forEach((snapshot, index) => {
            if (!snapshot.exists) throw new Error('Produto do pedido não encontrado.');
            const product = normalizeProduct(snapshot.data() || {}, items[index].productId);
            const quantity = items[index].quantity;
            if (product.reservedCommercialStock < quantity) throw new Error('Reserva de estoque comercial inconsistente.');
            transaction.update(productRefs[index], { reservedCommercialStock: product.reservedCommercialStock - quantity, updatedAt: now });
          });
        }
      }

      if (hasCoinReservation && walletRef && refundRef && walletSnapshot && refundSnapshot && !refundSnapshot.exists) {
        if (!walletSnapshot.exists) throw new Error('Carteira de Coins não encontrada para o estorno.');
        const wallet = walletSnapshot.data() || {};
        const wasConsumed = order.coinReservationStatus === 'CONSUMED';
        const refundType = order.dropId ? 'DROP_REFUND' : 'ORDER_REFUND';
        const balance = Math.max(0, Number(wallet.balance) || 0);
        const refund: RewardCoinTransaction = { id: refundRef.id, userId: order.userId, amount: order.totalCoinAmount, type: 'credit', origin: 'store_purchase', ledgerType: refundType, description: `Estorno do pedido ${order.orderId}`, idempotencyKey: `refund:${order.orderId}`, productId: items[0]?.productId || null, orderId: order.orderId, dropId: order.dropId, balanceBefore: balance, balanceAfter: balance + order.totalCoinAmount, metadata: { reason: nextStatus, previousReservationStatus: order.coinReservationStatus }, createdAt: now };
        transaction.set(walletRef, { userId: order.userId, balance: balance + order.totalCoinAmount, lifetimeEarned: Math.max(0, Number(wallet.lifetimeEarned) || 0), lifetimeSpent: Math.max(0, (Number(wallet.lifetimeSpent) || 0) - (wasConsumed ? order.totalCoinAmount : 0)), updatedAt: now }, { merge: true });
        transaction.create(refundRef, refund);
        if (holdSnapshot?.exists && holdRef) transaction.update(holdRef, { metadata: { ...((holdSnapshot.data() || {}).metadata || {}), status: 'RELEASED', releasedAt: now } });
      }

      transaction.update(orderRef, { status: nextStatus, coinReservationStatus: hasCoinReservation && shouldRelease ? 'REFUNDED' : order.coinReservationStatus || 'NONE', trackingCode: nextStatus === 'SHIPPED' ? trackingCode!.trim().slice(0, 100) : order.trackingCode || null, shippedAt: nextStatus === 'SHIPPED' ? now : order.shippedAt || null, deliveredAt: nextStatus === 'DELIVERED' ? now : order.deliveredAt || null, cancelledAt: nextStatus === 'CANCELLED' ? now : order.cancelledAt || null, updatedAt: now });
    });
  }

  private static validateAddress(value: PhysicalShippingAddress): PhysicalShippingAddress {
    const text = (input: unknown, max: number) => typeof input === 'string' ? input.trim().slice(0, max) : '';
    const address: PhysicalShippingAddress = { recipientName: text(value?.recipientName, 120), postalCode: text(value?.postalCode, 9).replace(/\D/g, ''), street: text(value?.street, 180), number: text(value?.number, 30), complement: text(value?.complement, 100) || null, district: text(value?.district, 100), city: text(value?.city, 100), state: text(value?.state, 2).toUpperCase() };
    if (!address.recipientName || address.postalCode.length !== 8 || !address.street || !address.number || !address.district || !address.city || !/^[A-Z]{2}$/.test(address.state)) throw new Error('Endereço de entrega incompleto ou inválido.');
    return address;
  }
}
