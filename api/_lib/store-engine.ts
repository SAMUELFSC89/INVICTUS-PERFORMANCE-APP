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
const PAYMENT_RESERVATION_MINUTES = 30;
const PAYMENT_CREATION_LEASE_MS = 2 * 60 * 1000;
const FINANCIAL_OPERATION_LEASE_MS = 2 * 60 * 1000;
const DROP_STATUSES: StoreDropStatus[] = ['DRAFT', 'SCHEDULED', 'ACTIVE', 'SOLD_OUT', 'ENDED', 'CANCELLED'];
const SHIPPING_MODES: StoreShippingMode[] = ['CUSTOMER_PAID', 'INVICTUS_SUBSIDIZED', 'SPONSORED', 'FREE_SHIPPING_CAMPAIGN'];

type StorePaymentState =
  | 'PENDING'
  | 'CREATING'
  | 'AWAITING_PAYMENT'
  | 'PAID'
  | 'PAID_AFTER_CANCELLATION'
  | 'AMOUNT_MISMATCH'
  | 'CANCELLATION_REQUESTED'
  | 'CANCELLED'
  | 'OVERDUE'
  | 'REFUND_REQUESTED'
  | 'REFUND_IN_PROGRESS'
  | 'PARTIALLY_REFUNDED'
  | 'REFUNDED'
  | 'REFUND_FAILED'
  | 'CHARGEBACK_REQUESTED'
  | 'FAILED';

type StoreOrderRecord = Omit<PhysicalOrder, 'paymentStatus' | 'cancellationStatus' | 'refundStatus'> & {
  requestFingerprint?: string;
  paymentIntentId?: string;
  paymentStatus?: StorePaymentState;
  paymentExpiresAt?: string | null;
  paymentCreatedAt?: string | null;
  paymentPaidAt?: string | null;
  paymentReceivedAmount?: number | null;
  paymentCreationState?: 'IDLE' | 'CREATING' | 'UNCERTAIN' | 'READY' | 'FAILED';
  paymentCreationLock?: string | null;
  paymentCreationLockExpiresAt?: string | null;
  paymentCreationError?: string | null;
  paymentQrStatus?: 'PENDING' | 'READY' | 'ERROR';
  paymentQrError?: string | null;
  lastPaymentEvent?: string | null;
  lastPaymentEventAt?: string | null;
  lastPaymentEventId?: string | null;
  lastPaymentEventOccurredAt?: string | null;
  cancellationStatus?: 'NONE' | 'REQUESTED' | 'RECONCILIATION_PENDING' | 'CONFIRMED' | 'FAILED';
  cancellationReason?: 'ADMIN' | 'EXPIRATION' | 'USER' | 'SYSTEM' | null;
  cancellationRequestedAt?: string | null;
  refundStatus?: 'NONE' | 'REQUESTED' | 'IN_PROGRESS' | 'PARTIAL' | 'RECONCILIATION_PENDING' | 'CONFIRMED' | 'FAILED';
  refundReason?: 'ADMIN' | 'EXPIRATION' | 'USER' | 'SYSTEM' | null;
  refundRequestedAt?: string | null;
  financialOperationId?: string | null;
  financialOperationLockExpiresAt?: string | null;
  financialOperationError?: string | null;
  financialReviewRequired?: boolean;
  financialReviewReason?: 'ORPHAN_PAYMENT' | 'PAYMENT_AMOUNT_MISMATCH' | 'PAYMENT_DURING_CANCELLATION' | 'FINANCIAL_TRANSITION_FAILED' | null;
  financialActionRequired?: 'REFUND' | 'RETURN_REVIEW' | 'CHARGEBACK_REVIEW' | null;
  expirationStatus?: 'NONE' | 'REQUESTED' | 'RECONCILIATION_PENDING' | 'COMPLETED' | 'FAILED';
  orphanPaymentReconciliationIds?: string[];
};

type StorePaymentCompensationRecord = {
  compensationId: string;
  orderId: string;
  userId: string;
  paymentId: string;
  canonicalPaymentId: string | null;
  operation: 'CANCEL_OR_REFUND';
  state: 'PENDING' | 'RECONCILIATION_PENDING' | 'REFUND_IN_PROGRESS' | 'CONFIRMED';
  attempts: number;
  lockExpiresAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string | null;
};

export type StorePaymentResult = {
  provider: string;
  paymentId: string;
  invoiceUrl: string | null;
  qrCode: { encodedImage?: string; payload?: string; expirationDate?: string };
};

export type StoreCancellationResult = {
  orderId: string;
  operation: 'NONE' | 'CANCEL' | 'REFUND';
  state: 'CONFIRMED' | 'PENDING' | 'FAILED';
  duplicated: boolean;
};

export type StoreExpirationSweepResult = {
  scanned: number;
  expired: number;
  skipped: number;
  failed: number;
  hasMore: boolean;
  errors: Array<{ orderId: string; message: string }>;
};

export type StorePaymentWebhookContext = {
  eventId?: string | null;
  eventAt?: string | number | null;
  externalReference?: string | null;
};

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

function operationError(message: string, statusCode: number, retryable = false): Error & { statusCode: number; retryable: boolean } {
  return Object.assign(new Error(message), { statusCode, retryable });
}

function cancellationOrRefundPending(order: StoreOrderRecord): boolean {
  return ['REQUESTED', 'RECONCILIATION_PENDING'].includes(order.cancellationStatus || 'NONE')
    || ['REQUESTED', 'IN_PROGRESS', 'PARTIAL', 'RECONCILIATION_PENDING'].includes(order.refundStatus || 'NONE')
    || ['REQUESTED', 'RECONCILIATION_PENDING'].includes(order.expirationStatus || 'NONE');
}

function assertPaymentCanResume(order: StoreOrderRecord): void {
  if (cancellationOrRefundPending(order)) {
    throw operationError('O cancelamento ou estorno deste pedido ainda está em reconciliação. Aguarde a confirmação financeira.', 409, true);
  }
  if (order.financialReviewReason === 'PAYMENT_AMOUNT_MISMATCH' || order.paymentStatus === 'AMOUNT_MISMATCH') {
    throw operationError('Este pagamento exige revisão financeira e não pode ser retomado.', 409, false);
  }
}

function assertFulfillmentAllowed(order: StoreOrderRecord, nextStatus: PhysicalOrder['status']): void {
  if (!['PROCESSING', 'SHIPPED', 'DELIVERED'].includes(nextStatus)) return;
  const blockedPaymentStates: StorePaymentState[] = ['PENDING', 'CREATING', 'AWAITING_PAYMENT', 'PAID_AFTER_CANCELLATION', 'AMOUNT_MISMATCH', 'CANCELLATION_REQUESTED', 'CANCELLED', 'OVERDUE', 'REFUND_REQUESTED', 'REFUND_IN_PROGRESS', 'PARTIALLY_REFUNDED', 'REFUNDED', 'REFUND_FAILED', 'CHARGEBACK_REQUESTED', 'FAILED'];
  if (order.financialReviewRequired || Boolean(order.financialActionRequired) || Boolean(order.financialOperationError) || Boolean(order.orphanPaymentReconciliationIds?.length) || blockedPaymentStates.includes(order.paymentStatus || 'PENDING') || cancellationOrRefundPending(order)) {
    throw operationError('Fulfillment bloqueado até a situação financeira do pedido ser reconciliada.', 409, false);
  }
}

function confirmedFinancialStateUpdates(order: StoreOrderRecord, operation: 'CANCEL' | 'REFUND'): Record<string, unknown> {
  const updates: Record<string, unknown> = operation === 'CANCEL'
    ? { paymentStatus: 'CANCELLED', cancellationStatus: 'CONFIRMED' }
    : { paymentStatus: 'REFUNDED', refundStatus: 'CONFIRMED' };
  updates.financialOperationLockExpiresAt = null;
  if (operation === 'REFUND' && ['REQUESTED', 'RECONCILIATION_PENDING'].includes(order.cancellationStatus || 'NONE')) updates.cancellationStatus = 'CONFIRMED';
  if (['REQUESTED', 'RECONCILIATION_PENDING'].includes(order.expirationStatus || 'NONE')) updates.expirationStatus = 'COMPLETED';

  const strongerReview = Boolean(order.orphanPaymentReconciliationIds?.length)
    || order.paymentStatus === 'CHARGEBACK_REQUESTED'
    || order.paymentStatus === 'PARTIALLY_REFUNDED'
    || order.refundStatus === 'PARTIAL'
    || order.financialActionRequired === 'CHARGEBACK_REVIEW';
  const resolvedReasons = operation === 'REFUND'
    ? ['FINANCIAL_TRANSITION_FAILED', 'PAYMENT_AMOUNT_MISMATCH', 'PAYMENT_DURING_CANCELLATION']
    : ['FINANCIAL_TRANSITION_FAILED'];
  if (!strongerReview && (!order.financialReviewRequired || resolvedReasons.includes(order.financialReviewReason || ''))) {
    updates.financialReviewRequired = false;
    updates.financialReviewReason = null;
    updates.financialActionRequired = null;
    updates.financialOperationError = null;
  }
  return updates;
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

function selectDropForProduct(drops: StoreDrop[], productId: string, includeSoldOut = false, timestamp = Date.now()): StoreDrop | null {
  const acceptedStatuses: StoreDropStatus[] = includeSoldOut ? ['ACTIVE', 'SCHEDULED', 'SOLD_OUT'] : ['ACTIVE', 'SCHEDULED'];
  return drops
    .filter(drop => dropTargetsProduct(drop, productId) && acceptedStatuses.includes(drop.status || 'DRAFT') && Date.parse(drop.endsAt) >= timestamp)
    .sort((left, right) => {
      const leftPriority = dropIsOpen(left, timestamp) ? 0 : left.status === 'SCHEDULED' ? 1 : 2;
      const rightPriority = dropIsOpen(right, timestamp) ? 0 : right.status === 'SCHEDULED' ? 1 : 2;
      return leftPriority - rightPriority || Date.parse(left.startsAt) - Date.parse(right.startsAt) || left.id.localeCompare(right.id);
    })[0] || null;
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
  private static readonly paymentCreationFlights = new Map<string, Promise<StorePaymentResult>>();

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
    return selectDropForProduct(drops, productId);
  }

  private static async getAllDrops(): Promise<StoreDrop[]> {
    if (!db) return [];
    const snapshot = await db.collection('store_drops').get();
    return snapshot.docs.map(doc => normalizeDrop(doc.id, doc.data() || {}));
  }

  static async getPublicProducts(): Promise<PublicPhysicalProduct[]> {
    if (!db) return [];
    const [snapshot, drops] = await Promise.all([db.collection('products').where('active', '==', true).get(), this.getAllDrops()]);
    return snapshot.docs
      .map(doc => normalizeProduct(doc.data() || {}, doc.id))
      .filter(product => product.storeVisible && product.published)
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map(product => productPublicView(product, selectDropForProduct(drops, product.productId, true)));
  }

  static async getPublicProduct(productId: string): Promise<PublicPhysicalProduct | null> {
    if (!db) return null;
    const [snapshot, drops] = await Promise.all([db.collection('products').doc(productId).get(), this.getAllDrops()]);
    if (!snapshot.exists) return null;
    const product = normalizeProduct(snapshot.data() || {}, productId);
    if (!product.active || !product.storeVisible || !product.published) return null;
    return productPublicView(product, selectDropForProduct(drops, productId, true));
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
    const token = hashKey(params.userId, params.idempotencyKey.trim(), 'COINS');
    const orderId = `store_drop_${token}`;
    const orderRef = db.collection('physicalOrders').doc(orderId);
    const requestFingerprint = hashKey(params.productId, String(quantity), JSON.stringify(address));
    const existingBeforeDrop = await orderRef.get();
    if (existingBeforeDrop.exists) {
      const existing = existingBeforeDrop.data() as StoreOrderRecord;
      if (existing.userId !== params.userId || existing.paymentMethod !== 'COINS' || (existing.requestFingerprint && existing.requestFingerprint !== requestFingerprint)) throw new Error('A chave de idempotência já foi usada em outro resgate.');
      return { order: existing as unknown as PhysicalOrder, duplicated: true };
    }
    // Compatibilidade com pedidos criados antes de o ID da intenção deixar de
    // depender do Drop. A consulta acontece antes de revalidar janela/estoque.
    const legacyOrders = await db.collection('physicalOrders').where('userId', '==', params.userId).get();
    const legacyMatch = legacyOrders.docs
      .map(document => document.data() as StoreOrderRecord)
      .find(order => order.paymentMethod === 'COINS' && order.idempotencyKey === params.idempotencyKey.trim());
    if (legacyMatch) {
      const legacyItems = await db.collection('physicalOrderItems').where('orderId', '==', legacyMatch.orderId).get();
      const item = legacyItems.docs.map(document => document.data() as PhysicalOrderItemSnapshot).find(candidate => candidate.productId === params.productId);
      const sameLegacyPayload = legacyMatch.requestFingerprint
        ? legacyMatch.requestFingerprint === requestFingerprint
        : Boolean(item && item.quantity === quantity && JSON.stringify(legacyMatch.address) === JSON.stringify(address));
      if (!sameLegacyPayload) throw new Error('A chave de idempotência já foi usada em outro resgate.');
      return { order: legacyMatch as unknown as PhysicalOrder, duplicated: true };
    }
    const drop = await this.getActiveDropForProduct(params.productId);
    if (!drop) throw new Error('Nenhum Drop aberto para este produto.');
    if (drop.shippingMode === 'CUSTOMER_PAID' && this.getDefaultShippingAmount() > 0) throw new Error('O frete deste Drop ainda precisa ser subsidiado ou configurado como campanha grátis.');
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
      if (existingOrder.exists) {
        const existing = existingOrder.data() as StoreOrderRecord;
        if (existing.userId !== params.userId || existing.paymentMethod !== 'COINS' || (existing.requestFingerprint && existing.requestFingerprint !== requestFingerprint)) throw new Error('A chave de idempotência já foi usada em outro resgate.');
        duplicated = true;
        return;
      }
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
      const order: StoreOrderRecord = { orderId, userId: params.userId, status: 'PROCESSING', paymentMethod: 'COINS', totalCashAmount: 0, totalCoinAmount, shippingAmount: 0, address, dropId: currentDrop.id, idempotencyKey: params.idempotencyKey.trim(), requestFingerprint, paymentProvider: null, paymentReference: null, paymentStatus: 'PAID', coinReservationStatus: 'CONSUMED', shippingMode: currentDrop.shippingMode, createdAt, updatedAt: createdAt };
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
    const requestFingerprint = hashKey(params.productId, String(quantity), JSON.stringify(address));
    let duplicated = false;

    await db.runTransaction(async transaction => {
      const [existingOrder, productSnapshot, walletSnapshot, holdSnapshot] = await Promise.all([transaction.get(orderRef), transaction.get(productRef), transaction.get(walletRef), transaction.get(coinHoldRef)]);
      if (existingOrder.exists) {
        const existing = existingOrder.data() as StoreOrderRecord;
        if (existing.userId !== params.userId || existing.paymentMethod !== params.paymentMethod || (existing.requestFingerprint && existing.requestFingerprint !== requestFingerprint)) throw new Error('A chave de idempotência já foi usada em outra compra.');
        duplicated = true;
        return;
      }
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
      const expiration = new Date(Date.now() + PAYMENT_RESERVATION_MINUTES * 60 * 1000).toISOString();
      const order: StoreOrderRecord = { orderId, userId: params.userId, status: 'PENDING_PAYMENT', paymentMethod: params.paymentMethod, totalCashAmount, totalCoinAmount, shippingAmount, address, dropId: null, idempotencyKey: params.idempotencyKey.trim(), requestFingerprint, paymentIntentId: orderId, paymentProvider: null, paymentReference: null, paymentStatus: 'PENDING', paymentExpiresAt: expiration, paymentCreationState: 'IDLE', paymentQrStatus: 'PENDING', cancellationStatus: 'NONE', refundStatus: 'NONE', expirationStatus: 'NONE', coinReservationStatus: useDiscount ? 'HELD' : 'NONE', coinReservationExpiresAt: useDiscount ? expiration : null, shippingMode: 'CUSTOMER_PAID', createdAt, updatedAt: createdAt };
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

  static async createPaymentForOrder(userId: string, orderId: string): Promise<StorePaymentResult> {
    const flightKey = `${userId}:${orderId}`;
    const existingFlight = this.paymentCreationFlights.get(flightKey);
    if (existingFlight) return existingFlight;
    const flight = this.createPaymentForOrderOnce(userId, orderId);
    this.paymentCreationFlights.set(flightKey, flight);
    try {
      return await flight;
    } finally {
      if (this.paymentCreationFlights.get(flightKey) === flight) this.paymentCreationFlights.delete(flightKey);
    }
  }

  private static async createPaymentForOrderOnce(userId: string, orderId: string): Promise<StorePaymentResult> {
    if (!db) throw new Error('Database not initialized');
    const orderRef = db.collection('physicalOrders').doc(orderId);
    const ownershipSnapshot = await orderRef.get();
    if (!ownershipSnapshot.exists) throw new Error('Pedido não encontrado.');
    if ((ownershipSnapshot.data() as StoreOrderRecord).userId !== userId) throw new Error('Pedido não pertence ao usuário autenticado.');
    await this.expirePendingOrder(orderId, userId);
    await this.reconcilePendingOrphanPayments(orderId);
    const initialSnapshot = await orderRef.get();
    if (!initialSnapshot.exists) throw new Error('Pedido não encontrado.');
    const initialOrder = initialSnapshot.data() as StoreOrderRecord;
    if (initialOrder.status !== 'PENDING_PAYMENT') throw new Error('Este pedido não aguarda pagamento.');
    assertPaymentCanResume(initialOrder);
    if (initialOrder.paymentReference) {
      const refreshed = await orderRef.get();
      const refreshedOrder = refreshed.data() as StoreOrderRecord;
      assertPaymentCanResume(refreshedOrder);
      return this.loadCanonicalPaymentQr(orderRef, refreshedOrder);
    }

    const profileSnapshot = await db.collection('users').doc(userId).get();
    const profile = profileSnapshot.data() || {};
    if (!profileSnapshot.exists || !profile.cpf) throw new Error('Complete seu CPF no perfil para gerar o pagamento PIX.');

    const lockToken = hashKey(orderId, userId, nowIso(), String(Math.random()));
    const lockExpiresAt = new Date(Date.now() + PAYMENT_CREATION_LEASE_MS).toISOString();
    let mode: 'CREATE' | 'WAIT' | 'EXISTING' = 'CREATE';
    let claimedOrder = initialOrder;
    await db.runTransaction(async transaction => {
      const snapshot = await transaction.get(orderRef);
      if (!snapshot.exists) throw new Error('Pedido não encontrado.');
      const order = snapshot.data() as StoreOrderRecord;
      claimedOrder = order;
      if (order.userId !== userId) throw new Error('Pedido não pertence ao usuário autenticado.');
      if (order.status !== 'PENDING_PAYMENT') throw new Error('Este pedido não aguarda pagamento.');
      assertPaymentCanResume(order);
      if (order.paymentReference) {
        mode = 'EXISTING';
        return;
      }
      const liveLease = Date.parse(order.paymentCreationLockExpiresAt || '') > Date.now();
      if ((order.paymentCreationState === 'CREATING' || order.paymentCreationState === 'UNCERTAIN') && liveLease && order.paymentCreationLock !== lockToken) {
        mode = 'WAIT';
        return;
      }
      mode = 'CREATE';
      transaction.update(orderRef, {
        paymentIntentId: order.paymentIntentId || orderId,
        paymentStatus: 'CREATING',
        paymentCreationState: 'CREATING',
        paymentCreationLock: lockToken,
        paymentCreationLockExpiresAt: lockExpiresAt,
        paymentCreationError: null,
        updatedAt: nowIso(),
      });
    });

    const resolvedMode: string = mode;
    if (resolvedMode === 'EXISTING') return this.loadCanonicalPaymentQr(orderRef, claimedOrder);
    if (resolvedMode === 'WAIT') {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
        const current = await orderRef.get();
        const currentOrder = current.data() as StoreOrderRecord;
        if (current.exists && currentOrder.paymentReference) {
          assertPaymentCanResume(currentOrder);
          return this.loadCanonicalPaymentQr(orderRef, currentOrder);
        }
        if (!current.exists || (currentOrder.paymentCreationState !== 'CREATING' && currentOrder.paymentCreationState !== 'UNCERTAIN')) break;
      }
      if (typeof AsaasClient.buscarCobrancaPorReferenciaExterna === 'function') {
        const recovered = await AsaasClient.buscarCobrancaPorReferenciaExterna(claimedOrder.paymentIntentId || orderId);
        if (recovered) {
          let recoveredOrder = claimedOrder;
          await db.runTransaction(async transaction => {
            const snapshot = await transaction.get(orderRef);
            if (!snapshot.exists) throw new Error('Pedido não encontrado.');
            const current = snapshot.data() as StoreOrderRecord;
            if (current.status !== 'PENDING_PAYMENT' || current.userId !== userId) throw new Error('Este pedido não aguarda pagamento.');
            assertPaymentCanResume(current);
            recoveredOrder = { ...current, paymentProvider: current.paymentProvider || 'asaas', paymentReference: current.paymentReference || recovered.id, paymentInvoiceUrl: current.paymentReference ? current.paymentInvoiceUrl || null : recovered.invoiceUrl || null, paymentStatus: 'AWAITING_PAYMENT', paymentCreationState: 'READY', paymentCreationLock: null, paymentCreationLockExpiresAt: null };
            transaction.update(orderRef, { paymentProvider: recoveredOrder.paymentProvider, paymentReference: recoveredOrder.paymentReference, paymentInvoiceUrl: recoveredOrder.paymentInvoiceUrl, paymentStatus: 'AWAITING_PAYMENT', paymentCreationState: 'READY', paymentCreationLock: null, paymentCreationLockExpiresAt: null, paymentCreationError: null, updatedAt: nowIso() });
          });
          return this.loadCanonicalPaymentQr(orderRef, recoveredOrder);
        }
      }
      const error = new Error('A cobrança PIX ainda está sendo criada. Tente novamente em instantes.') as Error & { recoverable?: boolean };
      error.recoverable = true;
      throw error;
    }

    const dueAt = toIso(claimedOrder.paymentExpiresAt) || toIso(claimedOrder.coinReservationExpiresAt) || new Date(Date.now() + PAYMENT_RESERVATION_MINUTES * 60 * 1000).toISOString();
    let candidate: Awaited<ReturnType<typeof AsaasClient.criarCobrancaPix>> | null = null;
    let candidateWasCreated = false;
    try {
      if (typeof AsaasClient.buscarCobrancaPorReferenciaExterna === 'function') {
        candidate = await AsaasClient.buscarCobrancaPorReferenciaExterna(claimedOrder.paymentIntentId || orderId);
      }
      if (!candidate) {
        const customerId = await AsaasClient.criarOuObterCliente({ nome: profile.name || profile.displayName || 'Atleta Invictus', cpf: String(profile.cpf), email: profile.email, referenciaExterna: userId });
        candidate = await AsaasClient.criarCobrancaPix({ clienteId: customerId, valor: claimedOrder.totalCashAmount, descricao: `Loja Invictus - pedido ${claimedOrder.orderId}`, referenciaExterna: claimedOrder.paymentIntentId || orderId, vencimento: new Date(dueAt).toISOString().slice(0, 10) });
        candidateWasCreated = true;
      }
    } catch (error: any) {
      const uncertaintyExpiresAt = new Date(Date.now() + PAYMENT_CREATION_LEASE_MS).toISOString();
      await db.runTransaction(async transaction => {
        const snapshot = await transaction.get(orderRef);
        if (!snapshot.exists) return;
        const current = snapshot.data() as StoreOrderRecord;
        if (!current.paymentReference && current.paymentCreationLock === lockToken) transaction.update(orderRef, { paymentStatus: 'FAILED', paymentCreationState: 'UNCERTAIN', paymentCreationLock: lockToken, paymentCreationLockExpiresAt: uncertaintyExpiresAt, paymentCreationError: String(error?.message || 'Falha ao criar cobrança PIX.').slice(0, 500), updatedAt: nowIso() });
      });
      throw error;
    }

    let canonicalOrder: StoreOrderRecord = claimedOrder;
    try {
      await db.runTransaction(async transaction => {
        const snapshot = await transaction.get(orderRef);
        if (!snapshot.exists) throw new Error('Pedido não encontrado.');
        const current = snapshot.data() as StoreOrderRecord;
        if (current.userId !== userId) throw new Error('Pedido não pertence ao usuário autenticado.');
        if (current.status !== 'PENDING_PAYMENT') throw new Error('Este pedido não aguarda pagamento.');
        assertPaymentCanResume(current);
        const paymentReference = current.paymentReference || candidate!.id;
        const paymentInvoiceUrl = current.paymentReference ? current.paymentInvoiceUrl || null : candidate!.invoiceUrl || null;
        canonicalOrder = { ...current, paymentProvider: current.paymentProvider || 'asaas', paymentReference, paymentInvoiceUrl, paymentDueAt: dueAt, paymentCreatedAt: current.paymentCreatedAt || nowIso(), paymentStatus: 'AWAITING_PAYMENT', paymentCreationState: 'READY', paymentCreationLock: null, paymentCreationLockExpiresAt: null, paymentCreationError: null, paymentQrStatus: current.paymentQrStatus || 'PENDING' };
        transaction.update(orderRef, { paymentProvider: canonicalOrder.paymentProvider, paymentReference, paymentInvoiceUrl, paymentDueAt: dueAt, paymentCreatedAt: canonicalOrder.paymentCreatedAt, paymentStatus: 'AWAITING_PAYMENT', paymentCreationState: 'READY', paymentCreationLock: null, paymentCreationLockExpiresAt: null, paymentCreationError: null, paymentQrStatus: canonicalOrder.paymentQrStatus, updatedAt: nowIso() });
      });
    } catch (error) {
      if (candidateWasCreated && typeof AsaasClient.cancelarCobranca === 'function') {
        const latest = await orderRef.get();
        const latestOrder = latest.exists ? latest.data() as StoreOrderRecord : claimedOrder;
        await this.reconcileOrphanPayment(latestOrder, candidate.id, latestOrder.paymentReference || null, 'CANONICAL_PERSISTENCE_FAILED');
      }
      throw error;
    }

    if (canonicalOrder.paymentReference !== candidate.id && typeof AsaasClient.cancelarCobranca === 'function') {
      await this.reconcileOrphanPayment(canonicalOrder, candidate.id, canonicalOrder.paymentReference || null, 'CONCURRENT_PAYMENT_CREATION');
    }
    return this.loadCanonicalPaymentQr(orderRef, canonicalOrder);
  }

  private static async reconcilePendingOrphanPayments(orderId: string): Promise<void> {
    if (!db) throw new Error('Database not initialized');
    const snapshot = await db.collection('storePaymentCompensations').where('orderId', '==', orderId).limit(10).get();
    for (const document of snapshot.docs) {
      const compensation = document.data() as StorePaymentCompensationRecord;
      if (compensation.state === 'CONFIRMED') continue;
      const orderSnapshot = await db.collection('physicalOrders').doc(orderId).get();
      if (!orderSnapshot.exists) return;
      await this.reconcileOrphanPayment(orderSnapshot.data() as StoreOrderRecord, compensation.paymentId, compensation.canonicalPaymentId, 'RETRY');
    }
  }

  private static async reconcilePendingPaymentCompensations(requestedLimit = 20): Promise<void> {
    if (!db) throw new Error('Database not initialized');
    const limit = Math.min(50, Math.max(1, Math.trunc(Number(requestedLimit) || 20)));
    const [cancellationSnapshot, refundSnapshot] = await Promise.all([
      db.collection('storePaymentCompensations').where('state', '==', 'RECONCILIATION_PENDING').limit(limit).get(),
      db.collection('storePaymentCompensations').where('state', '==', 'REFUND_IN_PROGRESS').limit(limit).get(),
    ]);
    const pending = new Map<string, StorePaymentCompensationRecord>();
    for (const document of [...cancellationSnapshot.docs, ...refundSnapshot.docs]) pending.set(document.id, document.data() as StorePaymentCompensationRecord);
    const selected = [...pending.values()].slice(0, limit);
    for (let offset = 0; offset < selected.length; offset += 5) {
      await Promise.allSettled(selected.slice(offset, offset + 5).map(async compensation => {
        const orderSnapshot = await db!.collection('physicalOrders').doc(compensation.orderId).get();
        if (!orderSnapshot.exists) return;
        await this.reconcileOrphanPayment(orderSnapshot.data() as StoreOrderRecord, compensation.paymentId, compensation.canonicalPaymentId, 'GLOBAL_RETRY');
      }));
    }
  }

  private static async completeOrphanPaymentCompensation(orderId: string, paymentId: string): Promise<void> {
    if (!db) throw new Error('Database not initialized');
    const compensationId = `store_payment_compensation_${hashKey(orderId, paymentId)}`;
    const compensationRef = db.collection('storePaymentCompensations').doc(compensationId);
    const orderRef = db.collection('physicalOrders').doc(orderId);
    await db.runTransaction(async transaction => {
      const [orderSnapshot, compensationSnapshot] = await Promise.all([transaction.get(orderRef), transaction.get(compensationRef)]);
      if (!orderSnapshot.exists) return;
      const order = orderSnapshot.data() as StoreOrderRecord;
      const previous = compensationSnapshot.exists ? compensationSnapshot.data() as StorePaymentCompensationRecord : null;
      const remaining = (order.orphanPaymentReconciliationIds || []).filter(id => id !== compensationId);
      const now = nowIso();
      transaction.set(compensationRef, {
        compensationId,
        orderId,
        userId: order.userId,
        paymentId,
        canonicalPaymentId: previous?.canonicalPaymentId || order.paymentReference || null,
        operation: 'CANCEL_OR_REFUND',
        state: 'CONFIRMED',
        attempts: Math.max(1, Number(previous?.attempts) || 0),
        lockExpiresAt: null,
        lastError: null,
        createdAt: previous?.createdAt || now,
        resolvedAt: now,
        updatedAt: now,
      }, { merge: true });
      const updates: Record<string, unknown> = { orphanPaymentReconciliationIds: remaining, updatedAt: nowIso() };
      const otherFinancialBlock = ['CHARGEBACK_REQUESTED', 'PARTIALLY_REFUNDED', 'AMOUNT_MISMATCH', 'PAID_AFTER_CANCELLATION'].includes(order.paymentStatus || '')
        || cancellationOrRefundPending(order)
        || (order.financialActionRequired && order.financialActionRequired !== 'REFUND');
      if (!remaining.length && order.financialReviewReason === 'ORPHAN_PAYMENT' && !otherFinancialBlock) {
        updates.financialReviewRequired = false;
        updates.financialReviewReason = null;
        updates.financialActionRequired = null;
        updates.financialOperationError = null;
      }
      transaction.update(orderRef, updates);
    });
  }

  private static async reconcileOrphanPayment(order: StoreOrderRecord, paymentId: string, canonicalPaymentId: string | null, source: string): Promise<'CONFIRMED' | 'PENDING'> {
    if (!db) throw new Error('Database not initialized');
    if (!paymentId || paymentId === canonicalPaymentId) return 'CONFIRMED';
    const compensationId = `store_payment_compensation_${hashKey(order.orderId, paymentId)}`;
    const compensationRef = db.collection('storePaymentCompensations').doc(compensationId);
    const orderRef = db.collection('physicalOrders').doc(order.orderId);
    const lockExpiresAt = new Date(Date.now() + FINANCIAL_OPERATION_LEASE_MS).toISOString();
    let execute = true;
    let lookupOnly = false;
    let alreadyCompensated = false;
    let attemptNumber = 0;
    await db.runTransaction(async transaction => {
      const [freshOrderSnapshot, compensationSnapshot] = await Promise.all([transaction.get(orderRef), transaction.get(compensationRef)]);
      if (!freshOrderSnapshot.exists) throw new Error('Pedido da cobrança órfã não encontrado.');
      const freshOrder = freshOrderSnapshot.data() as StoreOrderRecord;
      const compensation = compensationSnapshot.exists ? compensationSnapshot.data() as StorePaymentCompensationRecord : null;
      const liveLock = Date.parse(compensation?.lockExpiresAt || '') > Date.now();
      if (compensation?.state === 'CONFIRMED' || (compensation?.state === 'RECONCILIATION_PENDING' && liveLock) || (compensation?.state === 'REFUND_IN_PROGRESS' && liveLock)) {
        alreadyCompensated = compensation?.state === 'CONFIRMED';
        execute = false;
        return;
      }
      lookupOnly = compensation?.state === 'REFUND_IN_PROGRESS';
      const now = nowIso();
      attemptNumber = Math.max(0, Number(compensation?.attempts) || 0) + 1;
      const record: StorePaymentCompensationRecord & { source: string } = {
        compensationId,
        orderId: order.orderId,
        userId: freshOrder.userId,
        paymentId,
        canonicalPaymentId,
        operation: 'CANCEL_OR_REFUND',
        state: lookupOnly ? 'REFUND_IN_PROGRESS' : 'RECONCILIATION_PENDING',
        attempts: attemptNumber,
        lockExpiresAt,
        lastError: null,
        source,
        createdAt: compensation?.createdAt || now,
        updatedAt: now,
        resolvedAt: compensation?.resolvedAt || null,
      };
      transaction.set(compensationRef, record, { merge: true });
      const pendingIds = [...new Set([...(freshOrder.orphanPaymentReconciliationIds || []), compensationId])];
      transaction.update(orderRef, { orphanPaymentReconciliationIds: pendingIds, updatedAt: now });
    });
    if (!execute) return alreadyCompensated ? 'CONFIRMED' : 'PENDING';

    let failure: unknown = null;
    if (!lookupOnly) {
      try {
        const cancelled = await AsaasClient.cancelarCobranca(paymentId);
        if (cancelled.deleted === true || ['CANCELLED', 'DELETED'].includes(String(cancelled.status || '').toUpperCase())) {
          await this.completeOrphanPaymentCompensation(order.orderId, paymentId);
          return 'CONFIRMED';
        }
        failure = new Error(`Cancelamento não confirmado pelo provedor (${cancelled.status || 'sem status'}).`);
      } catch (error) {
        failure = error;
      }
    }

    let providerPayment: Awaited<ReturnType<typeof AsaasClient.obterCobranca>> | null = null;
    try {
      providerPayment = await AsaasClient.obterCobranca(paymentId);
    } catch (error) {
      failure = failure || error;
    }
    const providerStatus = String(providerPayment?.status || '').toUpperCase();
    if (providerPayment?.raw?.deleted === true || ['CANCELLED', 'DELETED', 'REFUNDED'].includes(providerStatus)) {
      await this.completeOrphanPaymentCompensation(order.orderId, paymentId);
      return 'CONFIRMED';
    }
    if (['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH', 'REFUND_REQUESTED', 'REFUND_IN_PROGRESS', 'PARTIALLY_REFUNDED'].includes(providerStatus)) {
      try {
        if (!['REFUND_REQUESTED', 'REFUND_IN_PROGRESS', 'PARTIALLY_REFUNDED'].includes(providerStatus)) {
          await AsaasClient.estornarPagamento(paymentId, { valor: providerPayment?.value, descricao: `Compensação da cobrança não canônica do pedido ${order.orderId}` });
        }
        const now = nowIso();
        let completedConcurrently = false;
        await db.runTransaction(async transaction => {
          const [compensationSnapshot, freshOrderSnapshot] = await Promise.all([transaction.get(compensationRef), transaction.get(orderRef)]);
          if (!compensationSnapshot.exists || !freshOrderSnapshot.exists) return;
          const currentCompensation = compensationSnapshot.data() as StorePaymentCompensationRecord;
          if (currentCompensation.state === 'CONFIRMED') {
            completedConcurrently = true;
            return;
          }
          if (currentCompensation.attempts !== attemptNumber) return;
          const freshOrder = freshOrderSnapshot.data() as StoreOrderRecord;
          transaction.set(compensationRef, { state: 'REFUND_IN_PROGRESS', lockExpiresAt: null, lastError: null, updatedAt: now }, { merge: true });
          const strongerReview = freshOrder.paymentStatus === 'CHARGEBACK_REQUESTED' || freshOrder.refundStatus === 'PARTIAL' || freshOrder.financialActionRequired === 'CHARGEBACK_REVIEW';
          transaction.update(orderRef, {
            financialReviewRequired: true,
            ...(strongerReview ? {} : { financialReviewReason: 'ORPHAN_PAYMENT', financialActionRequired: 'REFUND', financialOperationError: `A cobrança não canônica ${paymentId} está em estorno.` }),
            updatedAt: now,
          });
        });
        return completedConcurrently ? 'CONFIRMED' : 'PENDING';
      } catch (error) {
        failure = error;
      }
    }
    const message = String((failure as any)?.message || `Cobrança não canônica ${paymentId} requer reconciliação.`).slice(0, 500);
    const now = nowIso();
    let completedConcurrently = false;
    await db.runTransaction(async transaction => {
      const [compensationSnapshot, freshOrderSnapshot] = await Promise.all([transaction.get(compensationRef), transaction.get(orderRef)]);
      if (!compensationSnapshot.exists || !freshOrderSnapshot.exists) return;
      const currentCompensation = compensationSnapshot.data() as StorePaymentCompensationRecord;
      if (currentCompensation.state === 'CONFIRMED') {
        completedConcurrently = true;
        return;
      }
      if (currentCompensation.attempts !== attemptNumber) return;
      const freshOrder = freshOrderSnapshot.data() as StoreOrderRecord;
      transaction.set(compensationRef, { state: lookupOnly ? 'REFUND_IN_PROGRESS' : 'RECONCILIATION_PENDING', lockExpiresAt, lastError: message, updatedAt: now }, { merge: true });
      const strongerReview = freshOrder.paymentStatus === 'CHARGEBACK_REQUESTED' || freshOrder.refundStatus === 'PARTIAL' || freshOrder.financialActionRequired === 'CHARGEBACK_REVIEW';
      transaction.update(orderRef, {
        financialReviewRequired: true,
        ...(strongerReview ? {} : { financialReviewReason: 'ORPHAN_PAYMENT', financialActionRequired: 'REFUND', financialOperationError: message }),
        updatedAt: now,
      });
    });
    return completedConcurrently ? 'CONFIRMED' : 'PENDING';
  }

  private static async loadCanonicalPaymentQr(orderRef: any, order: StoreOrderRecord): Promise<StorePaymentResult> {
    if (!order.paymentReference) throw new Error('Cobrança canônica não encontrada para o pedido.');
    assertPaymentCanResume(order);
    if (order.paymentQrCode?.payload) return { provider: order.paymentProvider || 'asaas', paymentId: order.paymentReference, invoiceUrl: order.paymentInvoiceUrl || null, qrCode: order.paymentQrCode };
    try {
      const qrCode = await AsaasClient.obterQrCodePix(order.paymentReference);
      const qrExpiration = toIso(qrCode.expirationDate);
      const currentExpiration = toIso(order.paymentExpiresAt) || toIso(order.coinReservationExpiresAt);
      const effectiveExpiration = qrExpiration && currentExpiration && Date.parse(qrExpiration) < Date.parse(currentExpiration) ? qrExpiration : currentExpiration || qrExpiration;
      const updates: Record<string, unknown> = { paymentQrCode: qrCode, paymentQrStatus: 'READY', paymentQrError: null, updatedAt: nowIso() };
      if (effectiveExpiration) {
        updates.paymentExpiresAt = effectiveExpiration;
        updates.paymentDueAt = effectiveExpiration;
        if (order.totalCoinAmount > 0 && order.coinReservationStatus === 'HELD') updates.coinReservationExpiresAt = effectiveExpiration;
      }
      await db!.runTransaction(async transaction => {
        const snapshot: any = await transaction.get(orderRef);
        if (!snapshot.exists) return;
        const current = snapshot.data() as StoreOrderRecord;
        if (current.paymentReference !== order.paymentReference || current.status !== 'PENDING_PAYMENT') throw operationError('O pedido mudou de estado enquanto o PIX era recuperado.', 409, true);
        assertPaymentCanResume(current);
        transaction.update(orderRef, { ...updates, paymentStatus: 'AWAITING_PAYMENT' });
      });
      return { provider: order.paymentProvider || 'asaas', paymentId: order.paymentReference, invoiceUrl: order.paymentInvoiceUrl || null, qrCode };
    } catch (error: any) {
      await db!.runTransaction(async transaction => {
        const snapshot: any = await transaction.get(orderRef);
        if (!snapshot.exists) return;
        const current = snapshot.data() as StoreOrderRecord;
        if (current.paymentReference !== order.paymentReference || current.status !== 'PENDING_PAYMENT') return;
        assertPaymentCanResume(current);
        transaction.update(orderRef, { paymentQrStatus: 'ERROR', paymentQrError: String(error?.message || 'Falha ao obter QR Code PIX.').slice(0, 500), paymentStatus: 'AWAITING_PAYMENT', updatedAt: nowIso() });
      });
      throw error;
    }
  }

  static async handleStorePaymentWebhook(paymentId: string, event: string, paidValue?: number, context: StorePaymentWebhookContext = {}): Promise<{ found: boolean; status?: string; retryable?: boolean }> {
    if (!db || !paymentId) return { found: false };
    const search = await db.collection('physicalOrders').where('paymentReference', '==', paymentId).limit(1).get();
    let orderRef: any = search.empty ? null : search.docs[0].ref;
    let paymentReferenceConflict = false;
    const externalReference = typeof context.externalReference === 'string' ? context.externalReference.trim().slice(0, 240) : '';
    if (!orderRef && externalReference) {
      let externalSnapshot: any = null;
      if (/^[a-zA-Z0-9_-]{1,240}$/.test(externalReference)) {
        const directSnapshot = await db.collection('physicalOrders').doc(externalReference).get();
        if (directSnapshot.exists && (directSnapshot.data()?.orderId === externalReference || directSnapshot.data()?.paymentIntentId === externalReference)) externalSnapshot = directSnapshot;
      }
      if (!externalSnapshot) {
        const byIntent = await db.collection('physicalOrders').where('paymentIntentId', '==', externalReference).limit(1).get();
        if (!byIntent.empty) externalSnapshot = byIntent.docs[0];
      }
      if (externalSnapshot) {
        orderRef = externalSnapshot.ref;
      }
    }
    if (!orderRef) return { found: false };
    const normalizedEvent = String(event || '').toUpperCase();
    const rawEventId = typeof context.eventId === 'string' ? context.eventId.trim().slice(0, 500) : '';
    const numericEventAt = typeof context.eventAt === 'number' && Number.isFinite(context.eventAt) ? context.eventAt < 10_000_000_000 ? context.eventAt * 1000 : context.eventAt : Number.NaN;
    const occurredAt = Number.isFinite(numericEventAt) ? new Date(numericEventAt).toISOString() : toIso(context.eventAt);
    const eventIdentity = rawEventId || `${paymentId}:${normalizedEvent}:${occurredAt || 'legacy'}`;
    const eventRef = db.collection('storePaymentEvents').doc(`store_payment_event_${hashKey(eventIdentity)}`);
    const approved = normalizedEvent === 'PAYMENT_RECEIVED' || normalizedEvent === 'PAYMENT_CONFIRMED';
    const paymentStateByEvent: Partial<Record<string, StorePaymentState>> = {
      PAYMENT_OVERDUE: 'OVERDUE',
      PAYMENT_DELETED: 'CANCELLED',
      PAYMENT_REFUND_IN_PROGRESS: 'REFUND_IN_PROGRESS',
      PAYMENT_PARTIALLY_REFUNDED: 'PARTIALLY_REFUNDED',
      PAYMENT_REFUNDED: 'REFUNDED',
      PAYMENT_REFUND_DENIED: 'REFUND_FAILED',
      PAYMENT_CHARGEBACK_REQUESTED: 'CHARGEBACK_REQUESTED',
      PAYMENT_CHARGEBACK_DISPUTE: 'CHARGEBACK_REQUESTED',
      PAYMENT_AWAITING_CHARGEBACK_REVERSAL: 'CHARGEBACK_REQUESTED',
    };
    if (!approved && !paymentStateByEvent[normalizedEvent]) return { found: true, status: 'ignored' };
    const currentSnapshot = await orderRef.get();
    if (!currentSnapshot.exists) return { found: true, status: 'missing' };
    const currentOrder = currentSnapshot.data() as StoreOrderRecord;
    const numericPaidValue = Number(paidValue);
    const validPaidValue = typeof paidValue === 'number' && Number.isFinite(paidValue) && paidValue >= 0;
    const paymentValueMismatch = approved && (!validPaidValue || Math.abs(numericPaidValue - currentOrder.totalCashAmount) > 0.01);
    paymentReferenceConflict = Boolean(currentOrder.paymentReference && currentOrder.paymentReference !== paymentId);
    let storedOrder = currentOrder;
    let staleEvent = false;
    let paymentRequiresRefund = false;
    await db.runTransaction(async transaction => {
      const [orderSnapshot, eventSnapshot]: any[] = await Promise.all([transaction.get(orderRef), transaction.get(eventRef)]);
      if (!orderSnapshot.exists) throw new Error('Pedido não encontrado.');
      const order = orderSnapshot.data() as StoreOrderRecord;
      storedOrder = order;
      if (eventSnapshot.exists) {
        const storedEvent = eventSnapshot.data() || {};
        staleEvent = storedEvent.ignoredAsStale === true;
        paymentReferenceConflict = storedEvent.paymentReferenceConflict === true;
        paymentRequiresRefund = storedEvent.requiresCompensatingRefund === true;
        return;
      }
      const now = nowIso();
      const eventOccurredAt = occurredAt || now;
      if (order.paymentReference && order.paymentReference !== paymentId) {
        paymentReferenceConflict = true;
        transaction.create(eventRef, { eventId: rawEventId || null, paymentId, orderId: order.orderId, userId: order.userId, event: normalizedEvent, value: paidValue ?? null, expectedValue: order.totalCashAmount, amountMismatch: paymentValueMismatch, externalReference: externalReference || null, occurredAt: eventOccurredAt, receivedAt: now, ignoredAsStale: false, paymentReferenceConflict: true, ignoredReason: 'NON_CANONICAL_PAYMENT' });
        transaction.update(orderRef, { financialReviewRequired: true, financialReviewReason: 'ORPHAN_PAYMENT', financialActionRequired: 'REFUND', financialOperationError: `Cobrança não canônica recebida: ${paymentId}.`, updatedAt: now });
        return;
      }
      const previousOccurredAt = Date.parse(order.lastPaymentEventOccurredAt || '');
      staleEvent = Boolean(occurredAt && Number.isFinite(previousOccurredAt) && Date.parse(occurredAt) < previousOccurredAt);
      if (staleEvent) {
        transaction.create(eventRef, { eventId: rawEventId || null, paymentId, orderId: order.orderId, userId: order.userId, event: normalizedEvent, value: paidValue ?? null, expectedValue: order.totalCashAmount, amountMismatch: paymentValueMismatch, externalReference: externalReference || null, occurredAt: eventOccurredAt, receivedAt: now, ignoredAsStale: true });
        return;
      }
      if (paymentValueMismatch) {
        const mismatchUpdates: Record<string, unknown> = {
          paymentStatus: 'AMOUNT_MISMATCH',
          paymentPaidAt: now,
          paymentReceivedAmount: validPaidValue ? numericPaidValue : null,
          financialReviewRequired: true,
          financialReviewReason: 'PAYMENT_AMOUNT_MISMATCH',
          financialActionRequired: 'REFUND',
          financialOperationError: `Valor recebido (${validPaidValue ? numericPaidValue.toFixed(2) : 'ausente ou inválido'}) diverge do pedido (${order.totalCashAmount.toFixed(2)}).`,
          updatedAt: now,
        };
        if (!order.paymentReference) {
          mismatchUpdates.paymentProvider = order.paymentProvider || 'asaas';
          mismatchUpdates.paymentReference = paymentId;
          mismatchUpdates.paymentIntentId = order.paymentIntentId || externalReference || order.orderId;
          mismatchUpdates.paymentCreationState = 'READY';
          mismatchUpdates.paymentCreationLock = null;
          mismatchUpdates.paymentCreationLockExpiresAt = null;
        }
        if (!staleEvent) {
          mismatchUpdates.lastPaymentEvent = normalizedEvent;
          mismatchUpdates.lastPaymentEventAt = now;
          mismatchUpdates.lastPaymentEventId = rawEventId || null;
          mismatchUpdates.lastPaymentEventOccurredAt = eventOccurredAt;
        }
        paymentRequiresRefund = validPaidValue && numericPaidValue > 0;
        transaction.create(eventRef, { eventId: rawEventId || null, paymentId, orderId: order.orderId, userId: order.userId, event: normalizedEvent, value: paidValue ?? null, expectedValue: order.totalCashAmount, amountMismatch: true, externalReference: externalReference || null, occurredAt: eventOccurredAt, receivedAt: now, ignoredAsStale: staleEvent, requiresFinancialReview: true, requiresCompensatingRefund: paymentRequiresRefund });
        transaction.update(orderRef, mismatchUpdates);
        return;
      }
      const cancellationPendingAtApproval = approved && order.status !== 'CANCELLED' && order.status !== 'REFUNDED'
        && (['REQUESTED', 'RECONCILIATION_PENDING'].includes(order.cancellationStatus || 'NONE') || ['REQUESTED', 'RECONCILIATION_PENDING'].includes(order.expirationStatus || 'NONE'));
      const shouldConsumeHold = approved && order.status === 'PENDING_PAYMENT' && order.totalCoinAmount > 0;
      const walletRef = shouldConsumeHold ? db.collection('reward_coin_wallets').doc(order.userId) : null;
      const holdRef = shouldConsumeHold ? db.collection('reward_coin_transactions').doc(`coin_store_discount_hold_${hashKey(order.userId, order.idempotencyKey, order.paymentMethod)}`) : null;
      const walletSnapshot = walletRef ? await transaction.get(walletRef) : null;
      const holdSnapshot = holdRef ? await transaction.get(holdRef) : null;
      const updates: Record<string, unknown> = { lastPaymentEvent: normalizedEvent, lastPaymentEventAt: now, lastPaymentEventId: rawEventId || null, lastPaymentEventOccurredAt: eventOccurredAt, updatedAt: now };
      if (!order.paymentReference) {
        updates.paymentProvider = order.paymentProvider || 'asaas';
        updates.paymentReference = paymentId;
        updates.paymentIntentId = order.paymentIntentId || externalReference || order.orderId;
        updates.paymentCreationState = 'READY';
        updates.paymentCreationLock = null;
        updates.paymentCreationLockExpiresAt = null;
      }
      if (cancellationPendingAtApproval) {
        paymentRequiresRefund = true;
        updates.status = order.status === 'PENDING_PAYMENT' ? 'PAID' : order.status;
        updates.paymentStatus = 'PAID_AFTER_CANCELLATION';
        updates.paymentPaidAt = now;
        updates.paymentReceivedAmount = Number.isFinite(numericPaidValue) ? numericPaidValue : order.totalCashAmount;
        updates.paymentQrCode = null;
        updates.coinReservationStatus = order.totalCoinAmount > 0 ? 'CONSUMED' : 'NONE';
        updates.cancellationStatus = 'RECONCILIATION_PENDING';
        if (['REQUESTED', 'RECONCILIATION_PENDING'].includes(order.expirationStatus || 'NONE')) updates.expirationStatus = 'RECONCILIATION_PENDING';
        updates.financialReviewRequired = true;
        updates.financialReviewReason = 'PAYMENT_DURING_CANCELLATION';
        updates.financialActionRequired = 'REFUND';
        updates.financialOperationError = 'Pagamento confirmado enquanto o cancelamento estava em andamento; estorno obrigatório.';
      } else if (approved && order.status === 'PENDING_PAYMENT') {
        updates.status = 'PAID';
        updates.paymentStatus = 'PAID';
        updates.paymentPaidAt = now;
        updates.paymentReceivedAmount = Number.isFinite(numericPaidValue) ? numericPaidValue : order.totalCashAmount;
        updates.paymentQrCode = null;
        updates.coinReservationStatus = order.totalCoinAmount > 0 ? 'CONSUMED' : 'NONE';
        updates.expirationStatus = order.expirationStatus || 'NONE';
        updates.cancellationStatus = order.cancellationStatus || 'NONE';
      } else if (approved && (order.status === 'CANCELLED' || order.status === 'REFUNDED')) {
        if (order.paymentStatus !== 'REFUNDED' && order.refundStatus !== 'CONFIRMED') {
          paymentRequiresRefund = true;
          updates.paymentStatus = 'PAID_AFTER_CANCELLATION';
          updates.paymentPaidAt = now;
          updates.paymentReceivedAmount = Number.isFinite(numericPaidValue) ? numericPaidValue : order.totalCashAmount;
          updates.financialReviewRequired = true;
          updates.financialReviewReason = 'PAYMENT_DURING_CANCELLATION';
          updates.financialActionRequired = 'REFUND';
        }
      } else if (approved) {
        const refundInFlight = order.refundStatus && order.refundStatus !== 'NONE' && order.refundStatus !== 'FAILED';
        if (!refundInFlight) updates.paymentStatus = 'PAID';
        updates.paymentPaidAt = order.paymentPaidAt || now;
      } else {
        const state = paymentStateByEvent[normalizedEvent]!;
        const terminalRefund = order.paymentStatus === 'REFUNDED' || order.refundStatus === 'CONFIRMED';
        const paidOrder = order.status !== 'PENDING_PAYMENT' && order.paymentStatus === 'PAID';
        const stalePrePaymentEvent = paidOrder && (normalizedEvent === 'PAYMENT_OVERDUE' || normalizedEvent === 'PAYMENT_DELETED');
        const staleRefundProgress = terminalRefund && ['PAYMENT_REFUND_IN_PROGRESS', 'PAYMENT_PARTIALLY_REFUNDED', 'PAYMENT_REFUND_DENIED'].includes(normalizedEvent);
        if (normalizedEvent !== 'PAYMENT_DELETED' && !stalePrePaymentEvent && !staleRefundProgress) updates.paymentStatus = state;
        if (normalizedEvent === 'PAYMENT_DELETED') {
          if (order.status === 'PENDING_PAYMENT') {
            updates.paymentStatus = 'CANCELLED';
            updates.cancellationStatus = 'RECONCILIATION_PENDING';
            if (['REQUESTED', 'RECONCILIATION_PENDING'].includes(order.expirationStatus || 'NONE')) updates.expirationStatus = 'RECONCILIATION_PENDING';
          } else if (order.status === 'CANCELLED') {
            updates.paymentStatus = 'CANCELLED';
            updates.cancellationStatus = 'CONFIRMED';
            if (['REQUESTED', 'RECONCILIATION_PENDING'].includes(order.expirationStatus || 'NONE')) updates.expirationStatus = 'COMPLETED';
          } else {
            updates.financialReviewRequired = true;
            updates.financialReviewReason = order.financialReviewReason || 'FINANCIAL_TRANSITION_FAILED';
            updates.financialActionRequired = order.financialActionRequired || 'RETURN_REVIEW';
            updates.financialOperationError = 'Cancelamento do gateway recebido após o pedido sair da espera de pagamento.';
          }
        }
        if (normalizedEvent === 'PAYMENT_REFUND_IN_PROGRESS' && !terminalRefund) updates.refundStatus = 'IN_PROGRESS';
        if (normalizedEvent === 'PAYMENT_PARTIALLY_REFUNDED' && !terminalRefund) {
          updates.refundStatus = 'PARTIAL';
          updates.financialReviewRequired = true;
          updates.financialActionRequired = 'RETURN_REVIEW';
        }
        if (normalizedEvent === 'PAYMENT_REFUNDED') updates.refundStatus = ['PENDING_PAYMENT', 'PAID', 'PROCESSING'].includes(order.status) ? 'RECONCILIATION_PENDING' : 'CONFIRMED';
        if (normalizedEvent === 'PAYMENT_REFUND_DENIED' && !terminalRefund) {
          updates.refundStatus = 'FAILED';
          updates.financialReviewRequired = true;
          updates.financialOperationError = 'O provedor negou o estorno solicitado.';
        }
        if (normalizedEvent.startsWith('PAYMENT_CHARGEBACK')) {
          updates.financialReviewRequired = true;
          updates.financialActionRequired = 'CHARGEBACK_REVIEW';
        }
      }
      if (shouldConsumeHold) {
        if (!walletSnapshot?.exists || !holdSnapshot?.exists) throw new Error('Reserva de Coins do pedido não encontrada.');
        const wallet = walletSnapshot.data() || {};
        const hold = holdSnapshot.data() || {};
        if (hold.metadata?.status !== 'CONSUMED') {
          transaction.update(walletRef!, { lifetimeSpent: Math.max(0, Number(wallet.lifetimeSpent) || 0) + order.totalCoinAmount, updatedAt: now });
          transaction.update(holdRef!, { metadata: { ...(hold.metadata || {}), status: 'CONSUMED', consumedAt: now } });
        }
      }
      transaction.create(eventRef, { eventId: rawEventId || null, paymentId, orderId: order.orderId, userId: order.userId, event: normalizedEvent, value: paidValue ?? null, externalReference: externalReference || null, occurredAt: eventOccurredAt, receivedAt: now, ignoredAsStale: false, paymentReferenceConflict });
      transaction.update(orderRef, updates);
    });

    if (paymentReferenceConflict) {
      if (normalizedEvent === 'PAYMENT_DELETED' || normalizedEvent === 'PAYMENT_REFUNDED') {
        await this.completeOrphanPaymentCompensation(storedOrder.orderId, paymentId);
      } else {
        await this.reconcileOrphanPayment(storedOrder, paymentId, storedOrder.paymentReference || null, 'NON_CANONICAL_WEBHOOK');
      }
      return { found: true, status: 'non_canonical_payment_review_required' };
    }
    if (staleEvent) return { found: true, status: 'stale_event_ignored' };
    const postTransactionSnapshot = await orderRef.get();
    if (postTransactionSnapshot.exists) storedOrder = postTransactionSnapshot.data() as StoreOrderRecord;
    const mismatchRefundAmountKnown = storedOrder.financialReviewReason === 'PAYMENT_AMOUNT_MISMATCH'
      && typeof storedOrder.paymentReceivedAmount === 'number'
      && Number.isFinite(storedOrder.paymentReceivedAmount)
      && storedOrder.paymentReceivedAmount > 0;
    const requiresCompensatingRefund = paymentRequiresRefund
      || storedOrder.paymentStatus === 'PAID_AFTER_CANCELLATION'
      || (storedOrder.paymentStatus === 'AMOUNT_MISMATCH' && mismatchRefundAmountKnown)
      || (storedOrder.financialActionRequired === 'REFUND' && (storedOrder.financialReviewReason === 'PAYMENT_DURING_CANCELLATION' || mismatchRefundAmountKnown));
    if (requiresCompensatingRefund) {
      try {
        const refund = await this.requestOrderCancellation(storedOrder.orderId, 'SYSTEM', 'REFUNDED');
        const refundSnapshot = await orderRef.get();
        const refundOrder = refundSnapshot.exists ? refundSnapshot.data() as StoreOrderRecord : null;
        const uncertainRequest = refund.state === 'PENDING'
          && refundOrder?.refundStatus === 'REQUESTED'
          && Boolean(refundOrder.financialOperationError)
          && Date.parse(refundOrder.financialOperationLockExpiresAt || '') > Date.now();
        return { found: true, status: paymentValueMismatch || storedOrder.financialReviewReason === 'PAYMENT_AMOUNT_MISMATCH' ? 'amount_mismatch_refund_pending' : 'paid_during_cancellation_refund_pending', retryable: refund.state === 'FAILED' || uncertainRequest };
      } catch (error: any) {
        let convergedConcurrently = false;
        await db.runTransaction(async transaction => {
          const latestSnapshot: any = await transaction.get(orderRef as any);
          if (!latestSnapshot.exists) return;
          const latest = latestSnapshot.data() as StoreOrderRecord;
          convergedConcurrently = latest.refundStatus === 'CONFIRMED' && ['CANCELLED', 'REFUNDED', 'SHIPPED', 'DELIVERED'].includes(latest.status);
          if (convergedConcurrently) return;
          const strongerReview = latest.paymentStatus === 'CHARGEBACK_REQUESTED' || latest.refundStatus === 'PARTIAL' || latest.financialActionRequired === 'CHARGEBACK_REVIEW';
          transaction.update(orderRef, {
            financialReviewRequired: true,
            ...(strongerReview ? {} : { financialActionRequired: 'REFUND', financialOperationError: String(error?.message || 'Falha ao solicitar estorno compensatório.').slice(0, 500) }),
            updatedAt: nowIso(),
          });
        });
        if (convergedConcurrently) return { found: true, status: 'refunded' };
        return { found: true, status: paymentValueMismatch ? 'amount_mismatch_refund_failed' : 'paid_during_cancellation_refund_failed', retryable: true };
      }
    }
    if (storedOrder.financialReviewReason === 'PAYMENT_AMOUNT_MISMATCH' && !mismatchRefundAmountKnown) {
      return { found: true, status: 'amount_missing_review_required' };
    }
    if (approved) return { found: true, status: storedOrder.status === 'CANCELLED' || storedOrder.status === 'REFUNDED' ? 'paid_after_cancellation' : 'paid' };
    const shouldFinalizeCancellation = normalizedEvent === 'PAYMENT_DELETED' && storedOrder.status === 'PENDING_PAYMENT';
    const shouldFinalizeRefund = normalizedEvent === 'PAYMENT_REFUNDED' && ['PENDING_PAYMENT', 'PAID', 'PROCESSING'].includes(storedOrder.status);
    if (shouldFinalizeCancellation || shouldFinalizeRefund) {
      const financialOperation: 'CANCEL' | 'REFUND' = shouldFinalizeCancellation ? 'CANCEL' : 'REFUND';
      try {
        await this.finalizeConfirmedFinancialOperation(storedOrder.orderId, financialOperation);
      } catch (error: any) {
        let convergedConcurrently = false;
        await db.runTransaction(async transaction => {
          const latestSnapshot: any = await transaction.get(orderRef as any);
          if (!latestSnapshot.exists) return;
          const latest = latestSnapshot.data() as StoreOrderRecord;
          convergedConcurrently = financialOperation === 'CANCEL'
            ? latest.status === 'CANCELLED' && latest.cancellationStatus === 'CONFIRMED'
            : (latest.status === 'CANCELLED' || latest.status === 'REFUNDED' || latest.status === 'SHIPPED' || latest.status === 'DELIVERED') && latest.refundStatus === 'CONFIRMED';
          if (convergedConcurrently) return;
          const paidWonCancellation = financialOperation === 'CANCEL' && latest.status !== 'PENDING_PAYMENT' && latest.status !== 'CANCELLED';
          const strongerRefundState = financialOperation === 'REFUND'
            && (latest.paymentStatus === 'CHARGEBACK_REQUESTED' || latest.paymentStatus === 'PARTIALLY_REFUNDED' || latest.refundStatus === 'PARTIAL');
          transaction.update(orderRef, {
            ...(financialOperation === 'CANCEL' ? { cancellationStatus: 'RECONCILIATION_PENDING' } : strongerRefundState ? {} : { refundStatus: 'RECONCILIATION_PENDING' }),
            financialReviewRequired: true,
            financialReviewReason: paidWonCancellation ? 'PAYMENT_DURING_CANCELLATION' : latest.financialReviewReason || 'FINANCIAL_TRANSITION_FAILED',
            financialActionRequired: paidWonCancellation ? 'REFUND' : latest.financialActionRequired || 'RETURN_REVIEW',
            financialOperationError: String(error?.message || 'Falha ao conciliar evento financeiro.').slice(0, 500),
            updatedAt: nowIso(),
          });
        });
        if (convergedConcurrently) return { found: true, status: financialOperation === 'CANCEL' ? 'cancelled' : 'refunded' };
        return { found: true, status: 'financial_reconciliation_pending', retryable: true };
      }
    }
    if (normalizedEvent === 'PAYMENT_OVERDUE' && storedOrder.status === 'PENDING_PAYMENT') {
      try {
        const cancellation = await this.requestOrderCancellation(storedOrder.orderId, 'EXPIRATION', 'CANCELLED');
        return { found: true, status: cancellation.state === 'CONFIRMED' ? 'cancelled' : 'cancellation_pending' };
      } catch (error: any) {
        let convergedConcurrently = false;
        await db.runTransaction(async transaction => {
          const latestSnapshot: any = await transaction.get(orderRef as any);
          if (!latestSnapshot.exists) return;
          const latest = latestSnapshot.data() as StoreOrderRecord;
          convergedConcurrently = latest.status === 'CANCELLED' && latest.cancellationStatus === 'CONFIRMED';
          if (convergedConcurrently || latest.status !== 'PENDING_PAYMENT') return;
          transaction.update(orderRef, { financialReviewRequired: true, financialOperationError: String(error?.message || 'Falha ao cancelar cobrança vencida.').slice(0, 500), updatedAt: nowIso() });
        });
        if (convergedConcurrently) return { found: true, status: 'cancelled' };
        return { found: true, status: 'overdue_cancellation_failed', retryable: Boolean(error?.retryable) };
      }
    }
    if (normalizedEvent === 'PAYMENT_REFUNDED' && (storedOrder.status === 'SHIPPED' || storedOrder.status === 'DELIVERED')) {
      await orderRef.update({ financialReviewRequired: true, financialActionRequired: 'RETURN_REVIEW', updatedAt: nowIso() });
    }
    return { found: true, status: String(paymentStateByEvent[normalizedEvent] || 'recorded').toLowerCase() };
  }

  static async getPhysicalOrder(userId: string, orderId: string): Promise<(PhysicalOrder & { items: Array<Omit<PhysicalOrderItemSnapshot, 'supplierCostSnapshot'>> }) | null> {
    if (!db) return null;
    let orderSnapshot = await db.collection('physicalOrders').doc(orderId).get();
    if (!orderSnapshot.exists || orderSnapshot.data()?.userId !== userId) return null;
    await this.expirePendingOrder(orderId, userId).catch(() => false);
    orderSnapshot = await db.collection('physicalOrders').doc(orderId).get();
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
    let ordersSnapshot = await db.collection('physicalOrders').where('userId', '==', userId).get();
    const expiredOrders = ordersSnapshot.docs
      .map(doc => doc.data() as StoreOrderRecord)
      .filter(order => {
        const explicitExpiration = Date.parse(order.paymentExpiresAt || order.coinReservationExpiresAt || '');
        const createdAt = Date.parse(order.createdAt || '');
        const expiration = Number.isFinite(explicitExpiration) ? explicitExpiration : Number.isFinite(createdAt) ? createdAt + PAYMENT_RESERVATION_MINUTES * 60 * 1000 : Number.NaN;
        return order.status === 'PENDING_PAYMENT' && Number.isFinite(expiration) && expiration <= Date.now();
      });
    if (expiredOrders.length) {
      await Promise.all(expiredOrders.map(order => this.expirePendingOrder(order.orderId, userId).catch(() => false)));
      ordersSnapshot = await db.collection('physicalOrders').where('userId', '==', userId).get();
    }
    const itemsSnapshot = await db.collection('physicalOrderItems').where('userId', '==', userId).get();
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

  static async updateOrderStatus(orderId: string, nextStatus: PhysicalOrder['status'], trackingCode?: string): Promise<StoreCancellationResult | void> {
    if (nextStatus === 'CANCELLED' || nextStatus === 'REFUNDED') return this.requestOrderCancellation(orderId, 'ADMIN', nextStatus);
    return this.applyOrderStatusTransition(orderId, nextStatus, trackingCode);
  }

  static async cancelPendingOrder(userId: string, orderId: string): Promise<StoreCancellationResult> {
    if (!db) throw new Error('Database not initialized');
    if (!orderId?.trim()) throw new Error('Identificador do pedido ausente.');
    const snapshot = await db.collection('physicalOrders').doc(orderId).get();
    if (!snapshot.exists || snapshot.data()?.userId !== userId) throw new Error('Pedido não encontrado.');
    const order = snapshot.data() as StoreOrderRecord;
    if (order.status !== 'PENDING_PAYMENT' && order.status !== 'CANCELLED') throw new Error('Somente pedidos aguardando pagamento podem ser cancelados pelo comprador.');
    return this.requestOrderCancellation(orderId, 'USER', 'CANCELLED', userId);
  }

  /**
   * Varredura global usada pelo cron. As três consultas cobrem pedidos novos,
   * reservas de Coins legadas e pedidos anteriores ao campo de expiração. O
   * lote e a concorrência são limitados para não pressionar Firestore/Asaas.
   */
  static async expirePendingOrders(requestedLimit = 50): Promise<StoreExpirationSweepResult> {
    if (!db) throw new Error('Database not initialized');
    const limit = Math.min(100, Math.max(1, Math.trunc(Number(requestedLimit) || 50)));
    await this.reconcilePendingPaymentCompensations(Math.min(limit, 50));
    const queryLimit = limit + 1;
    const now = nowIso();
    const legacyCutoff = new Date(Date.now() - PAYMENT_RESERVATION_MINUTES * 60 * 1000).toISOString();
    const orders = db.collection('physicalOrders');
    const [paymentExpirySnapshot, coinExpirySnapshot, legacySnapshot] = await Promise.all([
      orders.where('status', '==', 'PENDING_PAYMENT').where('paymentExpiresAt', '<=', now).orderBy('paymentExpiresAt', 'asc').limit(queryLimit).get(),
      orders.where('status', '==', 'PENDING_PAYMENT').where('coinReservationExpiresAt', '<=', now).orderBy('coinReservationExpiresAt', 'asc').limit(queryLimit).get(),
      orders.where('status', '==', 'PENDING_PAYMENT').where('createdAt', '<=', legacyCutoff).orderBy('createdAt', 'asc').limit(queryLimit).get(),
    ]);
    const candidates = new Map<string, StoreOrderRecord>();
    for (const snapshot of [paymentExpirySnapshot, coinExpirySnapshot, legacySnapshot]) {
      for (const document of snapshot.docs) candidates.set(document.id, document.data() as StoreOrderRecord);
    }
    const expirationOf = (order: StoreOrderRecord): number => {
      const explicit = toIso(order.paymentExpiresAt) || toIso(order.coinReservationExpiresAt);
      const created = toIso(order.createdAt);
      return explicit ? Date.parse(explicit) : created ? Date.parse(created) + PAYMENT_RESERVATION_MINUTES * 60 * 1000 : Number.POSITIVE_INFINITY;
    };
    const due = [...candidates.values()]
      .filter(order => order.status === 'PENDING_PAYMENT' && expirationOf(order) <= Date.now())
      .sort((left, right) => expirationOf(left) - expirationOf(right) || left.orderId.localeCompare(right.orderId));
    const selected = due.slice(0, limit);
    let expired = 0;
    let skipped = 0;
    let failed = 0;
    const errors: StoreExpirationSweepResult['errors'] = [];
    const concurrency = 5;
    for (let offset = 0; offset < selected.length; offset += concurrency) {
      const chunk = selected.slice(offset, offset + concurrency);
      const outcomes = await Promise.all(chunk.map(async order => {
        try {
          return await this.expirePendingOrder(order.orderId) ? 'expired' as const : 'skipped' as const;
        } catch (error: any) {
          errors.push({ orderId: order.orderId, message: String(error?.message || 'Falha ao expirar pedido.').slice(0, 500) });
          return 'failed' as const;
        }
      }));
      expired += outcomes.filter(outcome => outcome === 'expired').length;
      skipped += outcomes.filter(outcome => outcome === 'skipped').length;
      failed += outcomes.filter(outcome => outcome === 'failed').length;
    }
    const queryWasTruncated = [paymentExpirySnapshot, coinExpirySnapshot, legacySnapshot]
      .some(snapshot => snapshot.docs.length >= queryLimit);
    return { scanned: selected.length, expired, skipped, failed, hasMore: due.length > selected.length || queryWasTruncated, errors };
  }

  static async expirePendingOrder(orderId: string, expectedUserId?: string): Promise<boolean> {
    if (!db) throw new Error('Database not initialized');
    const orderRef = db.collection('physicalOrders').doc(orderId);
    const snapshot = await orderRef.get();
    if (!snapshot.exists) return false;
    const order = snapshot.data() as StoreOrderRecord;
    if (expectedUserId && order.userId !== expectedUserId) throw new Error('Pedido não pertence ao usuário autenticado.');
    if (order.status !== 'PENDING_PAYMENT') return false;
    const createdAt = toIso(order.createdAt);
    const expiresAt = toIso(order.paymentExpiresAt) || toIso(order.coinReservationExpiresAt) || (createdAt ? new Date(Date.parse(createdAt) + PAYMENT_RESERVATION_MINUTES * 60 * 1000).toISOString() : null);
    if (!expiresAt || Date.parse(expiresAt) > Date.now()) return false;
    try {
      const result = await this.requestOrderCancellation(orderId, 'EXPIRATION', 'CANCELLED');
      return result.state === 'CONFIRMED';
    } catch (error: any) {
      const latest = await orderRef.get();
      if (latest.exists && latest.data()?.status === 'CANCELLED') return true;
      if (latest.exists && latest.data()?.status !== 'PENDING_PAYMENT') return false;
      await db.runTransaction(async transaction => {
        const currentSnapshot = await transaction.get(orderRef);
        if (!currentSnapshot.exists) return;
        const current = currentSnapshot.data() as StoreOrderRecord;
        if (current.status !== 'PENDING_PAYMENT') return;
        const reconciliationPending = current.cancellationStatus === 'RECONCILIATION_PENDING'
          || current.refundStatus === 'RECONCILIATION_PENDING'
          || current.expirationStatus === 'RECONCILIATION_PENDING';
        transaction.update(orderRef, {
          expirationStatus: reconciliationPending ? 'RECONCILIATION_PENDING' : 'FAILED',
          financialOperationError: String(error?.message || 'Falha ao expirar pedido.').slice(0, 500),
          updatedAt: nowIso(),
        });
      });
      throw error;
    }
  }

  private static async updateFinancialOperationState(
    orderId: string,
    operationId: string,
    deriveUpdates: (order: StoreOrderRecord) => Record<string, unknown> | null,
  ): Promise<boolean> {
    if (!db) throw new Error('Database not initialized');
    const orderRef = db.collection('physicalOrders').doc(orderId);
    let updated = false;
    await db.runTransaction(async transaction => {
      const snapshot = await transaction.get(orderRef);
      if (!snapshot.exists) return;
      const order = snapshot.data() as StoreOrderRecord;
      if (order.financialOperationId !== operationId) return;
      const updates = deriveUpdates(order);
      if (!updates) return;
      transaction.update(orderRef, { ...updates, updatedAt: nowIso() });
      updated = true;
    });
    return updated;
  }

  private static async finalizeConfirmedFinancialOperation(orderId: string, operation: 'CANCEL' | 'REFUND'): Promise<void> {
    if (!db) throw new Error('Database not initialized');
    const snapshot = await db.collection('physicalOrders').doc(orderId).get();
    if (!snapshot.exists) throw new Error('Pedido não encontrado.');
    const order = snapshot.data() as StoreOrderRecord;
    if (operation === 'REFUND' && (order.paymentStatus === 'CHARGEBACK_REQUESTED' || order.paymentStatus === 'PARTIALLY_REFUNDED' || order.refundStatus === 'PARTIAL')) {
      throw operationError('Uma atualização financeira mais recente exige revisão antes de concluir o estorno.', 503, true);
    }
    if (operation === 'REFUND' && order.paymentStatus !== 'REFUNDED' && order.refundStatus !== 'CONFIRMED') {
      throw operationError('A confirmação do estorno ainda não está registrada no pedido.', 503, true);
    }
    let targetStatus: PhysicalOrder['status'];
    if (operation === 'CANCEL') {
      if (order.status !== 'PENDING_PAYMENT' && order.status !== 'CANCELLED') {
        throw operationError('O pagamento venceu a corrida com o cancelamento; o pedido exige estorno.', 503, true);
      }
      targetStatus = 'CANCELLED';
    } else if (order.status === 'PENDING_PAYMENT') {
      targetStatus = 'CANCELLED';
    } else if (order.status === 'PAID' || order.status === 'PROCESSING') {
      targetStatus = 'REFUNDED';
    } else {
      targetStatus = order.status;
    }
    await this.applyOrderStatusTransition(
      orderId,
      targetStatus,
      undefined,
      {},
      order.status,
      operation,
    );
  }

  private static async applyProviderCancellationConfirmation(
    orderId: string,
    operationId: string,
    reason: 'ADMIN' | 'EXPIRATION' | 'USER' | 'SYSTEM',
  ): Promise<'CONFIRMED' | 'PAYMENT_WON'> {
    if (!db) throw new Error('Database not initialized');
    let paymentWon = false;
    const updated = await this.updateFinancialOperationState(orderId, operationId, order => {
      if (order.status === 'CANCELLED' && order.cancellationStatus === 'CONFIRMED') return null;
      const paidState = order.status !== 'PENDING_PAYMENT'
        || ['PAID', 'PAID_AFTER_CANCELLATION', 'AMOUNT_MISMATCH', 'REFUND_REQUESTED', 'REFUND_IN_PROGRESS', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(order.paymentStatus || 'PENDING');
      if (paidState) {
        paymentWon = true;
        return {
          cancellationStatus: 'RECONCILIATION_PENDING',
          cancellationReason: order.cancellationReason || reason,
          financialOperationLockExpiresAt: null,
          financialReviewRequired: true,
          financialReviewReason: 'PAYMENT_DURING_CANCELLATION',
          financialActionRequired: 'REFUND',
          financialOperationError: 'O pagamento venceu a corrida com o cancelamento; estorno obrigatório.',
          ...(reason === 'EXPIRATION' ? { expirationStatus: 'RECONCILIATION_PENDING' } : {}),
        };
      }
      return {
        paymentStatus: 'CANCELLED',
        cancellationStatus: 'RECONCILIATION_PENDING',
        cancellationReason: order.cancellationReason || reason,
        financialOperationLockExpiresAt: null,
        ...(reason === 'EXPIRATION' ? { expirationStatus: 'RECONCILIATION_PENDING' } : {}),
      };
    });
    if (!updated) {
      const latestSnapshot = await db.collection('physicalOrders').doc(orderId).get();
      if (!latestSnapshot.exists) throw new Error('Pedido não encontrado.');
      const latest = latestSnapshot.data() as StoreOrderRecord;
      if (latest.status === 'CANCELLED' && latest.cancellationStatus === 'CONFIRMED') return 'CONFIRMED';
      if (latest.status !== 'PENDING_PAYMENT' || latest.financialActionRequired === 'REFUND') return 'PAYMENT_WON';
      throw operationError('Não foi possível registrar a confirmação do cancelamento no pedido atual.', 503, true);
    }
    if (paymentWon) return 'PAYMENT_WON';
    try {
      await this.finalizeConfirmedFinancialOperation(orderId, 'CANCEL');
      return 'CONFIRMED';
    } catch (error: any) {
      await this.updateFinancialOperationState(orderId, operationId, order => {
        if (order.status === 'CANCELLED' && order.cancellationStatus === 'CONFIRMED') return null;
        return {
          paymentStatus: order.paymentStatus === 'CANCELLED' ? 'CANCELLED' : order.paymentStatus,
          cancellationStatus: 'RECONCILIATION_PENDING',
          financialReviewRequired: true,
          financialReviewReason: order.financialReviewReason || 'FINANCIAL_TRANSITION_FAILED',
          financialActionRequired: order.financialActionRequired || 'RETURN_REVIEW',
          financialOperationError: String(error?.message || 'Falha ao aplicar o cancelamento confirmado.').slice(0, 500),
          financialOperationLockExpiresAt: null,
        };
      });
      throw operationError(`O cancelamento foi confirmado pelo gateway, mas a baixa local precisa ser repetida: ${String(error?.message || error).slice(0, 300)}`, 503, true);
    }
  }

  private static async requestOrderCancellation(orderId: string, reason: 'ADMIN' | 'EXPIRATION' | 'USER' | 'SYSTEM', requestedStatus: 'CANCELLED' | 'REFUNDED', expectedUserId?: string): Promise<StoreCancellationResult> {
    if (!db) throw new Error('Database not initialized');
    const orderRef = db.collection('physicalOrders').doc(orderId);
    const initialSnapshot = await orderRef.get();
    if (!initialSnapshot.exists) throw new Error('Pedido não encontrado.');
    const initialOrder = initialSnapshot.data() as StoreOrderRecord;
    if (expectedUserId && initialOrder.userId !== expectedUserId) throw new Error('Pedido não encontrado.');
    const terminalOrderNeedsRefund = (initialOrder.status === 'CANCELLED' || initialOrder.status === 'REFUNDED')
      && initialOrder.refundStatus !== 'CONFIRMED'
      && (initialOrder.financialActionRequired === 'REFUND'
        || ['PAYMENT_AMOUNT_MISMATCH', 'PAYMENT_DURING_CANCELLATION'].includes(initialOrder.financialReviewReason || '')
        || ['REQUESTED', 'IN_PROGRESS', 'PARTIAL', 'RECONCILIATION_PENDING', 'FAILED'].includes(initialOrder.refundStatus || 'NONE')
        || ['PAID_AFTER_CANCELLATION', 'AMOUNT_MISMATCH', 'REFUND_REQUESTED', 'REFUND_IN_PROGRESS', 'PARTIALLY_REFUNDED', 'REFUNDED', 'REFUND_FAILED'].includes(initialOrder.paymentStatus || ''));
    if ((initialOrder.status === 'CANCELLED' || initialOrder.status === 'REFUNDED') && !terminalOrderNeedsRefund) return { orderId, operation: 'NONE', state: 'CONFIRMED', duplicated: true };
    if (reason === 'USER' && initialOrder.status !== 'PENDING_PAYMENT') throw new Error('Somente pedidos aguardando pagamento podem ser cancelados pelo comprador.');
    if (initialOrder.status === 'SHIPPED' || initialOrder.status === 'DELIVERED') throw new Error('Pedido enviado não pode ser cancelado sem fluxo de devolução.');

    const cancellationReconciliation = ['RECONCILIATION_PENDING', 'CONFIRMED'].includes(initialOrder.cancellationStatus || 'NONE')
      && initialOrder.paymentStatus === 'CANCELLED'
      && (initialOrder.status === 'PENDING_PAYMENT' || initialOrder.status === 'CANCELLED');
    const refundReconciliation = ['RECONCILIATION_PENDING', 'CONFIRMED'].includes(initialOrder.refundStatus || 'NONE')
      && initialOrder.paymentStatus === 'REFUNDED';
    if (cancellationReconciliation || refundReconciliation) {
      try {
        await this.finalizeConfirmedFinancialOperation(orderId, cancellationReconciliation ? 'CANCEL' : 'REFUND');
        return { orderId, operation: cancellationReconciliation ? 'CANCEL' : 'REFUND', state: 'CONFIRMED', duplicated: true };
      } catch (error: any) {
        let convergedConcurrently = false;
        await db.runTransaction(async transaction => {
          const latestSnapshot = await transaction.get(orderRef);
          if (!latestSnapshot.exists) return;
          const latest = latestSnapshot.data() as StoreOrderRecord;
          const converged = cancellationReconciliation
            ? latest.status === 'CANCELLED' && latest.cancellationStatus === 'CONFIRMED'
            : latest.refundStatus === 'CONFIRMED' && (latest.status === 'CANCELLED' || latest.status === 'REFUNDED' || latest.status === 'SHIPPED' || latest.status === 'DELIVERED');
          if (converged) {
            convergedConcurrently = true;
            return;
          }
          const strongerRefundState = refundReconciliation
            && (latest.paymentStatus === 'CHARGEBACK_REQUESTED' || latest.paymentStatus === 'PARTIALLY_REFUNDED' || latest.refundStatus === 'PARTIAL');
          transaction.update(orderRef, {
            ...(cancellationReconciliation ? { cancellationStatus: 'RECONCILIATION_PENDING' } : strongerRefundState ? {} : { refundStatus: 'RECONCILIATION_PENDING' }),
            financialReviewRequired: true,
            financialReviewReason: latest.financialReviewReason || 'FINANCIAL_TRANSITION_FAILED',
            financialActionRequired: latest.financialActionRequired || 'RETURN_REVIEW',
            financialOperationError: String(error?.message || error).slice(0, 500),
            updatedAt: nowIso(),
          });
        });
        if (convergedConcurrently) return { orderId, operation: cancellationReconciliation ? 'CANCEL' : 'REFUND', state: 'CONFIRMED', duplicated: true };
        throw operationError(`A operação financeira foi confirmada, mas a aplicação local ainda precisa ser reconciliada: ${String(error?.message || error).slice(0, 300)}`, 503, true);
      }
    }

    const hasGatewayPayment = initialOrder.totalCashAmount > 0 && Boolean(initialOrder.paymentReference);
    if (!hasGatewayPayment) {
      const completionUpdates: Record<string, unknown> = requestedStatus === 'REFUNDED'
        ? { paymentStatus: 'REFUNDED', refundStatus: 'CONFIRMED', refundReason: reason }
        : { paymentStatus: 'CANCELLED', cancellationStatus: 'CONFIRMED', cancellationReason: reason };
      if (reason === 'EXPIRATION') completionUpdates.expirationStatus = 'COMPLETED';
      try {
        await this.applyOrderStatusTransition(orderId, requestedStatus, undefined, completionUpdates, initialOrder.status === 'PENDING_PAYMENT' ? 'PENDING_PAYMENT' : undefined);
        return { orderId, operation: 'NONE', state: 'CONFIRMED', duplicated: false };
      } catch (error) {
        const latest = await orderRef.get();
        if (latest.exists && (latest.data()?.status === 'CANCELLED' || latest.data()?.status === 'REFUNDED')) return { orderId, operation: 'NONE', state: 'CONFIRMED', duplicated: true };
        throw error;
      }
    }

    const explicitRefundRequired = requestedStatus === 'REFUNDED'
      || initialOrder.financialActionRequired === 'REFUND'
      || initialOrder.refundStatus && initialOrder.refundStatus !== 'NONE'
      || typeof initialOrder.paymentReceivedAmount === 'number'
      || ['PAID', 'PAID_AFTER_CANCELLATION', 'AMOUNT_MISMATCH', 'REFUND_REQUESTED', 'REFUND_IN_PROGRESS', 'PARTIALLY_REFUNDED', 'REFUNDED', 'REFUND_FAILED'].includes(initialOrder.paymentStatus || 'PENDING');
    const operation: 'CANCEL' | 'REFUND' = initialOrder.status === 'PENDING_PAYMENT' && !explicitRefundRequired ? 'CANCEL' : 'REFUND';
    const operationId = `store_financial_${hashKey(orderId, initialOrder.paymentReference!, operation)}`;
    const lockExpiresAt = new Date(Date.now() + FINANCIAL_OPERATION_LEASE_MS).toISOString();
    let duplicated = false;
    let execute = true;
    let alreadyConfirmed = false;
    let paymentWonRace = false;
    let providerConfirmedNeedsReconciliation = false;
    let reconcileBeforeMutation = false;
    let pollAcceptedRefund = false;
    await db.runTransaction(async transaction => {
      const snapshot = await transaction.get(orderRef);
      if (!snapshot.exists) throw new Error('Pedido não encontrado.');
      const order = snapshot.data() as StoreOrderRecord;
      if (expectedUserId && order.userId !== expectedUserId) throw new Error('Pedido não encontrado.');
      if (reason === 'USER' && order.status !== 'PENDING_PAYMENT') throw new Error('Somente pedidos aguardando pagamento podem ser cancelados pelo comprador.');
      if (operation === 'CANCEL' && (order.status !== 'PENDING_PAYMENT' || ['PAID', 'PAID_AFTER_CANCELLATION', 'AMOUNT_MISMATCH', 'REFUND_REQUESTED', 'REFUND_IN_PROGRESS', 'REFUNDED'].includes(order.paymentStatus || 'PENDING'))) {
        execute = false;
        paymentWonRace = true;
        return;
      }
      const status = operation === 'CANCEL' ? order.cancellationStatus : order.refundStatus;
      const confirmed = status === 'CONFIRMED';
      const terminalStillNeedsRefund = operation === 'REFUND'
        && (order.status === 'CANCELLED' || order.status === 'REFUNDED')
        && order.refundStatus !== 'CONFIRMED'
        && (order.financialActionRequired === 'REFUND'
          || ['REQUESTED', 'IN_PROGRESS', 'PARTIAL', 'RECONCILIATION_PENDING', 'FAILED'].includes(order.refundStatus || 'NONE')
          || ['PAID_AFTER_CANCELLATION', 'AMOUNT_MISMATCH', 'REFUND_REQUESTED', 'REFUND_IN_PROGRESS', 'PARTIALLY_REFUNDED', 'REFUNDED', 'REFUND_FAILED'].includes(order.paymentStatus || ''));
      const locallyConverged = operation === 'CANCEL'
        ? order.status === 'CANCELLED' && order.cancellationStatus === 'CONFIRMED'
        : order.refundStatus === 'CONFIRMED' && (order.status === 'CANCELLED' || order.status === 'REFUNDED' || order.status === 'SHIPPED' || order.status === 'DELIVERED');
      if (locallyConverged || ((order.status === 'CANCELLED' || order.status === 'REFUNDED') && !terminalStillNeedsRefund && !confirmed)) {
        duplicated = true;
        execute = false;
        alreadyConfirmed = true;
        return;
      }
      if (confirmed) {
        duplicated = true;
        execute = false;
        providerConfirmedNeedsReconciliation = true;
        return;
      }
      const liveLease = Date.parse(order.financialOperationLockExpiresAt || '') > Date.now();
      const acceptedRefund = operation === 'REFUND' && status === 'IN_PROGRESS';
      const partialRefund = operation === 'REFUND' && status === 'PARTIAL';
      const requestInFlight = status === 'REQUESTED' && liveLease;
      if (acceptedRefund) {
        duplicated = true;
        execute = false;
        pollAcceptedRefund = !liveLease;
        if (!order.financialOperationId) transaction.update(orderRef, { financialOperationId: operationId, refundReason: order.refundReason || reason, updatedAt: nowIso() });
        return;
      }
      if (partialRefund || requestInFlight) {
        duplicated = true;
        execute = false;
        return;
      }
      reconcileBeforeMutation = status === 'REQUESTED';
      const updates: Record<string, unknown> = {
        paymentStatus: operation === 'CANCEL' ? 'CANCELLATION_REQUESTED' : 'REFUND_REQUESTED',
        financialOperationId: operationId,
        financialOperationLockExpiresAt: lockExpiresAt,
        financialOperationError: null,
        updatedAt: nowIso(),
      };
      if (operation === 'CANCEL') {
        updates.cancellationStatus = 'REQUESTED';
        updates.cancellationReason = order.cancellationReason || reason;
        updates.cancellationRequestedAt = order.cancellationRequestedAt || nowIso();
      } else {
        updates.refundStatus = 'REQUESTED';
        updates.refundReason = order.refundReason || reason;
        updates.refundRequestedAt = order.refundRequestedAt || nowIso();
      }
      if (reason === 'EXPIRATION') updates.expirationStatus = 'REQUESTED';
      transaction.update(orderRef, updates);
    });
    if (paymentWonRace) {
      return this.requestOrderCancellation(orderId, reason === 'USER' || reason === 'EXPIRATION' ? 'SYSTEM' : reason, 'REFUNDED');
    }
    if (providerConfirmedNeedsReconciliation) {
      try {
        await this.finalizeConfirmedFinancialOperation(orderId, operation);
        return { orderId, operation, state: 'CONFIRMED', duplicated: true };
      } catch (error: any) {
        let convergedConcurrently = false;
        await db.runTransaction(async transaction => {
          const latestSnapshot = await transaction.get(orderRef);
          if (!latestSnapshot.exists) return;
          const latest = latestSnapshot.data() as StoreOrderRecord;
          const converged = operation === 'CANCEL'
            ? latest.status === 'CANCELLED' && latest.cancellationStatus === 'CONFIRMED'
            : latest.refundStatus === 'CONFIRMED' && (latest.status === 'CANCELLED' || latest.status === 'REFUNDED');
          if (converged) {
            convergedConcurrently = true;
            return;
          }
          const strongerRefundState = operation === 'REFUND'
            && (latest.paymentStatus === 'CHARGEBACK_REQUESTED' || latest.paymentStatus === 'PARTIALLY_REFUNDED' || latest.refundStatus === 'PARTIAL');
          transaction.update(orderRef, {
            ...(operation === 'CANCEL' ? { cancellationStatus: 'RECONCILIATION_PENDING' } : strongerRefundState ? {} : { refundStatus: 'RECONCILIATION_PENDING' }),
            financialReviewRequired: true,
            financialReviewReason: latest.financialReviewReason || 'FINANCIAL_TRANSITION_FAILED',
            financialActionRequired: latest.financialActionRequired || 'RETURN_REVIEW',
            financialOperationError: String(error?.message || error).slice(0, 500),
            updatedAt: nowIso(),
          });
        });
        if (convergedConcurrently) return { orderId, operation, state: 'CONFIRMED', duplicated: true };
        throw operationError(`A operação financeira foi confirmada, mas a aplicação local ainda precisa ser reconciliada: ${String(error?.message || error).slice(0, 300)}`, 503, true);
      }
    }
    if (pollAcceptedRefund) {
      let providerPayment: Awaited<ReturnType<typeof AsaasClient.obterCobranca>>;
      try {
        providerPayment = await AsaasClient.obterCobranca(initialOrder.paymentReference!);
      } catch (error: any) {
        await this.updateFinancialOperationState(orderId, operationId, order => ({
          financialOperationError: `Falha ao consultar o estorno em andamento: ${String(error?.message || error).slice(0, 400)}`,
          financialOperationLockExpiresAt: new Date(Date.now() + FINANCIAL_OPERATION_LEASE_MS).toISOString(),
          financialReviewRequired: order.financialReviewRequired || false,
        }));
        throw operationError('Não foi possível consultar o estorno em andamento.', 503, true);
      }
      const providerStatus = String(providerPayment.status || '').toUpperCase();
      if (providerStatus === 'REFUNDED') {
        const reconciliation = await this.handleStorePaymentWebhook(initialOrder.paymentReference!, 'PAYMENT_REFUNDED', undefined, { eventId: `poll_${operationId}_refunded`, eventAt: nowIso(), externalReference: initialOrder.paymentIntentId || orderId });
        if (reconciliation.retryable) throw operationError('O estorno foi confirmado, mas a baixa local ainda precisa ser repetida.', 503, true);
        const reconciledSnapshot = await orderRef.get();
        const reconciled = reconciledSnapshot.exists ? reconciledSnapshot.data() as StoreOrderRecord : null;
        if (!reconciled || reconciled.refundStatus !== 'CONFIRMED' || !['CANCELLED', 'REFUNDED', 'SHIPPED', 'DELIVERED'].includes(reconciled.status)) throw operationError('O estorno confirmado ainda não convergiu no pedido.', 503, true);
        return { orderId, operation, state: 'CONFIRMED', duplicated: true };
      }
      if (providerStatus === 'PARTIALLY_REFUNDED') {
        await this.updateFinancialOperationState(orderId, operationId, order => {
          if (order.refundStatus === 'CONFIRMED' || order.paymentStatus === 'REFUNDED') return null;
          return { refundStatus: 'PARTIAL', paymentStatus: 'PARTIALLY_REFUNDED', financialOperationLockExpiresAt: null, financialOperationError: 'O provedor confirmou apenas estorno parcial.', financialReviewRequired: true, financialActionRequired: 'RETURN_REVIEW' };
        });
      } else {
        await this.updateFinancialOperationState(orderId, operationId, order => ({
          financialOperationLockExpiresAt: null,
          financialOperationError: null,
          refundStatus: order.refundStatus === 'REQUESTED' ? 'IN_PROGRESS' : order.refundStatus || 'IN_PROGRESS',
          paymentStatus: order.paymentStatus === 'REFUND_REQUESTED' ? 'REFUND_IN_PROGRESS' : order.paymentStatus,
        }));
      }
      return { orderId, operation, state: 'PENDING', duplicated: true };
    }
    if (!execute) return { orderId, operation, state: alreadyConfirmed ? 'CONFIRMED' : 'PENDING', duplicated };

    if (reconcileBeforeMutation) {
      let providerPayment: Awaited<ReturnType<typeof AsaasClient.obterCobranca>>;
      try {
        providerPayment = await AsaasClient.obterCobranca(initialOrder.paymentReference!);
      } catch (error: any) {
        const retryAfter = new Date(Date.now() + FINANCIAL_OPERATION_LEASE_MS).toISOString();
        await this.updateFinancialOperationState(orderId, operationId, order => ({
          ...(operation === 'CANCEL' ? { cancellationStatus: 'REQUESTED' } : { refundStatus: 'REQUESTED' }),
          paymentStatus: operation === 'CANCEL' ? 'CANCELLATION_REQUESTED' : 'REFUND_REQUESTED',
          financialOperationLockExpiresAt: retryAfter,
          financialOperationError: `Resultado ainda incerto no provedor: ${String(error?.message || 'falha de rede').slice(0, 400)}`,
          ...(reason === 'EXPIRATION' ? { expirationStatus: order.expirationStatus || 'REQUESTED' } : {}),
        }));
        throw operationError('Não foi possível reconciliar a operação financeira ainda incerta.', 503, true);
      }
      const providerStatus = String(providerPayment.status || '').toUpperCase();
      if (operation === 'CANCEL' && (providerPayment.raw?.deleted === true || providerStatus === 'CANCELLED' || providerStatus === 'DELETED')) {
        const outcome = await this.applyProviderCancellationConfirmation(orderId, operationId, reason);
        if (outcome === 'PAYMENT_WON') return this.requestOrderCancellation(orderId, 'SYSTEM', 'REFUNDED');
        return { orderId, operation, state: 'CONFIRMED', duplicated: true };
      }
      if (operation === 'CANCEL' && ['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH'].includes(providerStatus)) {
        const result = await this.handleStorePaymentWebhook(initialOrder.paymentReference!, 'PAYMENT_CONFIRMED', providerPayment.value, { eventId: `reconcile_${operationId}_paid`, eventAt: nowIso(), externalReference: initialOrder.paymentIntentId || orderId });
        if (result.retryable) throw operationError('O pagamento confirmado ainda precisa de reconciliação financeira.', 503, true);
        return { orderId, operation: 'REFUND', state: 'PENDING', duplicated: true };
      }
      if (operation === 'REFUND' && providerStatus === 'REFUNDED') {
        const result = await this.handleStorePaymentWebhook(initialOrder.paymentReference!, 'PAYMENT_REFUNDED', undefined, { eventId: `reconcile_${operationId}_refunded`, eventAt: nowIso(), externalReference: initialOrder.paymentIntentId || orderId });
        if (result.retryable) throw operationError('O estorno foi confirmado, mas a baixa local ainda precisa ser repetida.', 503, true);
        const reconciledSnapshot = await orderRef.get();
        const reconciled = reconciledSnapshot.exists ? reconciledSnapshot.data() as StoreOrderRecord : null;
        if (!reconciled || reconciled.refundStatus !== 'CONFIRMED' || !['CANCELLED', 'REFUNDED', 'SHIPPED', 'DELIVERED'].includes(reconciled.status)) throw operationError('O estorno confirmado ainda não convergiu no pedido.', 503, true);
        return { orderId, operation, state: 'CONFIRMED', duplicated: true };
      }
      if (operation === 'REFUND' && ['REFUND_REQUESTED', 'REFUND_IN_PROGRESS', 'PARTIALLY_REFUNDED'].includes(providerStatus)) {
        const partial = providerStatus === 'PARTIALLY_REFUNDED';
        await this.updateFinancialOperationState(orderId, operationId, order => {
          if (order.refundStatus === 'CONFIRMED' || order.paymentStatus === 'REFUNDED') return null;
          return {
            refundStatus: partial ? 'PARTIAL' : 'IN_PROGRESS',
            paymentStatus: partial ? 'PARTIALLY_REFUNDED' : 'REFUND_IN_PROGRESS',
            financialOperationLockExpiresAt: null,
            financialOperationError: partial ? 'O provedor confirmou apenas estorno parcial.' : null,
            financialReviewRequired: partial || order.financialReviewRequired || false,
            financialActionRequired: partial ? 'RETURN_REVIEW' : order.financialActionRequired || null,
          };
        });
        return { orderId, operation, state: 'PENDING', duplicated: true };
      }
    }

    try {
      if (operation === 'CANCEL') {
        const response = await AsaasClient.cancelarCobranca(initialOrder.paymentReference!);
        const cancellationResponseStatus = String(response.status || '').toUpperCase();
        const confirmed = response.deleted === true || cancellationResponseStatus === 'CANCELLED' || cancellationResponseStatus === 'DELETED';
        if (!confirmed) {
          let paymentWon = false;
          await this.updateFinancialOperationState(orderId, operationId, order => {
            paymentWon = order.status !== 'PENDING_PAYMENT' || ['PAID', 'PAID_AFTER_CANCELLATION', 'AMOUNT_MISMATCH', 'REFUND_REQUESTED', 'REFUND_IN_PROGRESS', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(order.paymentStatus || 'PENDING');
            if (paymentWon) return null;
            return { cancellationStatus: 'REQUESTED', paymentStatus: 'CANCELLATION_REQUESTED', financialOperationLockExpiresAt: null };
          });
          if (paymentWon) return this.requestOrderCancellation(orderId, 'SYSTEM', 'REFUNDED');
          return { orderId, operation, state: 'PENDING', duplicated: false };
        }
        const outcome = await this.applyProviderCancellationConfirmation(orderId, operationId, reason);
        if (outcome === 'PAYMENT_WON') return this.requestOrderCancellation(orderId, 'SYSTEM', 'REFUNDED');
        return { orderId, operation, state: 'CONFIRMED', duplicated: false };
      }

      const refundValue = typeof initialOrder.paymentReceivedAmount === 'number' && Number.isFinite(initialOrder.paymentReceivedAmount)
        ? initialOrder.paymentReceivedAmount
        : initialOrder.totalCashAmount;
      const refundResponse = await AsaasClient.estornarPagamento(initialOrder.paymentReference!, { valor: refundValue, descricao: `Estorno do pedido ${orderId}` });
      const refundResponseStatus = String(refundResponse.status || '').toUpperCase();
      const partialRefund = refundResponseStatus === 'PARTIALLY_REFUNDED';
      await this.updateFinancialOperationState(orderId, operationId, order => {
        if (order.refundStatus === 'CONFIRMED' || order.paymentStatus === 'REFUNDED') return null;
        if (order.paymentStatus === 'CHARGEBACK_REQUESTED' || order.refundStatus === 'PARTIAL') return null;
        return {
          refundStatus: partialRefund ? 'PARTIAL' : 'IN_PROGRESS',
          paymentStatus: partialRefund ? 'PARTIALLY_REFUNDED' : 'REFUND_IN_PROGRESS',
          financialOperationLockExpiresAt: null,
          financialOperationError: partialRefund ? 'O provedor confirmou apenas estorno parcial.' : null,
          financialReviewRequired: partialRefund || order.financialReviewRequired || false,
          financialActionRequired: partialRefund ? 'RETURN_REVIEW' : order.financialActionRequired || null,
        };
      });
      return { orderId, operation, state: 'PENDING', duplicated: false };
    } catch (error: any) {
      const stateAfterFailureSnapshot = await orderRef.get();
      const stateAfterFailure = stateAfterFailureSnapshot.exists ? stateAfterFailureSnapshot.data() as StoreOrderRecord : null;
      const providerAlreadyConfirmed = operation === 'CANCEL'
        ? stateAfterFailure?.paymentStatus === 'CANCELLED' && stateAfterFailure?.cancellationStatus === 'RECONCILIATION_PENDING'
        : stateAfterFailure?.paymentStatus === 'REFUNDED' && stateAfterFailure?.refundStatus === 'RECONCILIATION_PENDING';
      if (error?.retryable && providerAlreadyConfirmed) throw error;
      let providerPayment: Awaited<ReturnType<typeof AsaasClient.obterCobranca>> | null = null;
      let providerLookupFailed = false;
      if (typeof AsaasClient.obterCobranca === 'function') {
        try {
          providerPayment = await AsaasClient.obterCobranca(initialOrder.paymentReference!);
        } catch {
          providerLookupFailed = true;
        }
      }
      const providerStatus = String(providerPayment?.status || '').toUpperCase();
      const providerCancellationConfirmed = operation === 'CANCEL' && (providerPayment?.raw?.deleted === true || providerStatus === 'CANCELLED' || providerStatus === 'DELETED');
      if (providerCancellationConfirmed) {
        const outcome = await this.applyProviderCancellationConfirmation(orderId, operationId, reason);
        if (outcome === 'PAYMENT_WON') return this.requestOrderCancellation(orderId, 'SYSTEM', 'REFUNDED');
        return { orderId, operation, state: 'CONFIRMED', duplicated: false };
      }
      if (operation === 'REFUND' && providerStatus === 'REFUNDED') {
        const reconciliation = await this.handleStorePaymentWebhook(initialOrder.paymentReference!, 'PAYMENT_REFUNDED', undefined, { eventId: `reconcile_${operationId}_refunded`, eventAt: nowIso(), externalReference: initialOrder.paymentIntentId || orderId });
        if (reconciliation.retryable) throw operationError('O estorno foi confirmado, mas a baixa local ainda precisa ser repetida.', 503, true);
        const reconciledSnapshot = await orderRef.get();
        const reconciled = reconciledSnapshot.exists ? reconciledSnapshot.data() as StoreOrderRecord : null;
        if (!reconciled || reconciled.refundStatus !== 'CONFIRMED' || !['CANCELLED', 'REFUNDED', 'SHIPPED', 'DELIVERED'].includes(reconciled.status)) throw operationError('O estorno confirmado ainda não convergiu no pedido.', 503, true);
        return { orderId, operation, state: 'CONFIRMED', duplicated: false };
      }
      if (operation === 'REFUND' && ['REFUND_REQUESTED', 'REFUND_IN_PROGRESS', 'PARTIALLY_REFUNDED'].includes(providerStatus)) {
        const partial = providerStatus === 'PARTIALLY_REFUNDED';
        await this.updateFinancialOperationState(orderId, operationId, order => {
          if (order.refundStatus === 'CONFIRMED' || order.paymentStatus === 'REFUNDED') return null;
          return { refundStatus: partial ? 'PARTIAL' : 'IN_PROGRESS', paymentStatus: partial ? 'PARTIALLY_REFUNDED' : 'REFUND_IN_PROGRESS', financialOperationLockExpiresAt: null, financialOperationError: partial ? 'O provedor confirmou apenas estorno parcial.' : null, financialReviewRequired: partial || order.financialReviewRequired || false, financialActionRequired: partial ? 'RETURN_REVIEW' : order.financialActionRequired || null };
        });
        return { orderId, operation, state: 'PENDING', duplicated: false };
      }
      if (operation === 'CANCEL' && ['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH'].includes(providerStatus)) {
        const reconciliation = await this.handleStorePaymentWebhook(initialOrder.paymentReference!, 'PAYMENT_CONFIRMED', providerPayment?.value, { eventId: `reconcile_${operationId}_paid`, eventAt: nowIso(), externalReference: initialOrder.paymentIntentId || orderId });
        if (reconciliation.retryable) throw operationError('O pagamento confirmado durante o cancelamento ainda precisa de estorno.', 503, true);
        return { orderId, operation: 'REFUND', state: 'PENDING', duplicated: true };
      }
      const latestSnapshot = await orderRef.get();
      const latestOrder = latestSnapshot.exists ? latestSnapshot.data() as StoreOrderRecord : null;
      const locallyConverged = operation === 'CANCEL'
        ? latestOrder?.status === 'CANCELLED' && latestOrder?.cancellationStatus === 'CONFIRMED'
        : latestOrder?.refundStatus === 'CONFIRMED' && Boolean(latestOrder && ['CANCELLED', 'REFUNDED', 'SHIPPED', 'DELIVERED'].includes(latestOrder.status));
      if (locallyConverged) return { orderId, operation, state: 'CONFIRMED', duplicated: true };
      const paidDuringCancellation = operation === 'CANCEL' && latestOrder && (latestOrder.status !== 'PENDING_PAYMENT' || ['PAID', 'PAID_AFTER_CANCELLATION', 'AMOUNT_MISMATCH', 'REFUND_REQUESTED', 'REFUND_IN_PROGRESS', 'REFUNDED'].includes(latestOrder.paymentStatus || 'PENDING'));
      if (paidDuringCancellation) {
        await this.updateFinancialOperationState(orderId, operationId, order => ({
          cancellationStatus: 'RECONCILIATION_PENDING',
          cancellationReason: order.cancellationReason || reason,
          financialOperationLockExpiresAt: null,
          financialReviewRequired: true,
          financialReviewReason: 'PAYMENT_DURING_CANCELLATION',
          financialActionRequired: 'REFUND',
          financialOperationError: 'Pagamento confirmado durante tentativa de cancelamento; estorno obrigatório.',
          ...(reason === 'EXPIRATION' ? { expirationStatus: 'RECONCILIATION_PENDING' } : {}),
        }));
        return this.requestOrderCancellation(orderId, 'SYSTEM', 'REFUNDED');
      }
      if (providerLookupFailed) {
        const retryAfter = new Date(Date.now() + FINANCIAL_OPERATION_LEASE_MS).toISOString();
        await this.updateFinancialOperationState(orderId, operationId, order => ({
          ...(operation === 'CANCEL' ? { cancellationStatus: 'REQUESTED' } : { refundStatus: 'REQUESTED' }),
          paymentStatus: operation === 'CANCEL' ? 'CANCELLATION_REQUESTED' : 'REFUND_REQUESTED',
          financialOperationLockExpiresAt: retryAfter,
          financialOperationError: `Resultado incerto no provedor: ${String(error?.message || 'falha de rede').slice(0, 400)}`,
          expirationStatus: reason === 'EXPIRATION' ? order.expirationStatus || 'REQUESTED' : order.expirationStatus || 'NONE',
        }));
        throw operationError('O resultado da operação financeira está incerto e precisa ser reconciliado.', 503, true);
      }
      await this.updateFinancialOperationState(orderId, operationId, order => {
        const terminal = operation === 'CANCEL'
          ? order.status === 'CANCELLED' && order.cancellationStatus === 'CONFIRMED'
          : order.refundStatus === 'CONFIRMED';
        if (terminal) return null;
        return {
          ...(operation === 'CANCEL' ? { cancellationStatus: 'FAILED' } : { refundStatus: 'FAILED' }),
          paymentStatus: operation === 'CANCEL' ? 'FAILED' : 'REFUND_FAILED',
          financialOperationLockExpiresAt: null,
          financialOperationError: String(error?.message || 'Falha no provedor financeiro.').slice(0, 500),
          expirationStatus: reason === 'EXPIRATION' ? 'FAILED' : order.expirationStatus || 'NONE',
        };
      });
      throw error;
    }
  }

  private static async applyOrderStatusTransition(
    orderId: string,
    nextStatus: PhysicalOrder['status'],
    trackingCode?: string,
    financialUpdates: Record<string, unknown> = {},
    requiredCurrentStatus?: PhysicalOrder['status'],
    confirmedFinancialOperation?: 'CANCEL' | 'REFUND',
  ): Promise<void> {
    if (!db) throw new Error('Database not initialized');
    const allowed: Record<PhysicalOrder['status'], PhysicalOrder['status'][]> = { PENDING_PAYMENT: ['CANCELLED'], PAID: ['PROCESSING', 'CANCELLED', 'REFUNDED'], PROCESSING: ['SHIPPED', 'CANCELLED', 'REFUNDED'], SHIPPED: ['DELIVERED'], DELIVERED: [], CANCELLED: [], REFUNDED: [] };
    const orderRef = db.collection('physicalOrders').doc(orderId);
    const itemsSnapshot = await db.collection('physicalOrderItems').where('orderId', '==', orderId).get();
    const items = itemsSnapshot.docs.map(doc => doc.data() as PhysicalOrderItemSnapshot);
    await db.runTransaction(async transaction => {
      const orderSnapshot = await transaction.get(orderRef);
      if (!orderSnapshot.exists) throw new Error('Pedido não encontrado.');
      const order = orderSnapshot.data() as StoreOrderRecord;
      assertFulfillmentAllowed(order, nextStatus);
      if (requiredCurrentStatus && order.status !== requiredCurrentStatus) throw new Error(`O pedido mudou de estado durante a operação: ${order.status}.`);
      if (confirmedFinancialOperation === 'REFUND' && (order.paymentStatus === 'CHARGEBACK_REQUESTED' || order.paymentStatus === 'PARTIALLY_REFUNDED' || order.refundStatus === 'PARTIAL')) {
        throw operationError('Uma atualização financeira mais recente exige revisão antes de concluir o estorno.', 503, true);
      }
      const effectiveFinancialUpdates = confirmedFinancialOperation
        ? { ...financialUpdates, ...confirmedFinancialStateUpdates(order, confirmedFinancialOperation) }
        : financialUpdates;
      if (order.status === nextStatus) {
        if (Object.keys(effectiveFinancialUpdates).length) transaction.update(orderRef, { ...effectiveFinancialUpdates, updatedAt: nowIso() });
        return;
      }
      if (!allowed[order.status]?.includes(nextStatus)) throw new Error(`Transição inválida: ${order.status} → ${nextStatus}.`);
      const now = nowIso();
      const productRefs = items.map(item => db.collection('products').doc(item.productId));
      const productSnapshots = await Promise.all(productRefs.map(ref => transaction.get(ref)));
      const dropRef = order.dropId ? db.collection('store_drops').doc(order.dropId) : null;
      const dropSnapshot = dropRef ? await transaction.get(dropRef) : null;
      const shouldRelease = nextStatus === 'CANCELLED' || nextStatus === 'REFUNDED';
      const canReleaseStock = shouldRelease && order.status !== 'SHIPPED' && order.status !== 'DELIVERED';
      const hasCoinReservation = order.totalCoinAmount > 0 && order.coinReservationStatus !== 'RELEASED' && order.coinReservationStatus !== 'REFUNDED';
      const walletRef = shouldRelease && hasCoinReservation ? db.collection('reward_coin_wallets').doc(order.userId) : null;
      const refundRef = shouldRelease && hasCoinReservation ? db.collection('reward_coin_transactions').doc(`coin_store_refund_${order.orderId}`) : null;
      const holdRef = shouldRelease && hasCoinReservation ? db.collection('reward_coin_transactions').doc(`coin_store_discount_hold_${hashKey(order.userId, order.idempotencyKey, order.paymentMethod)}`) : null;
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

      if (shouldRelease && hasCoinReservation && walletRef && refundRef && walletSnapshot && refundSnapshot && !refundSnapshot.exists) {
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

      const releasedCoinStatus = hasCoinReservation && shouldRelease ? order.coinReservationStatus === 'CONSUMED' ? 'REFUNDED' : 'RELEASED' : order.coinReservationStatus || 'NONE';
      transaction.update(orderRef, { ...effectiveFinancialUpdates, status: nextStatus, coinReservationStatus: releasedCoinStatus, trackingCode: nextStatus === 'SHIPPED' ? trackingCode!.trim().slice(0, 100) : order.trackingCode || null, shippedAt: nextStatus === 'SHIPPED' ? now : order.shippedAt || null, deliveredAt: nextStatus === 'DELIVERED' ? now : order.deliveredAt || null, cancelledAt: nextStatus === 'CANCELLED' ? now : order.cancelledAt || null, updatedAt: now });
    });
  }

  private static validateAddress(value: PhysicalShippingAddress): PhysicalShippingAddress {
    const text = (input: unknown, max: number) => typeof input === 'string' ? input.trim().slice(0, max) : '';
    const address: PhysicalShippingAddress = { recipientName: text(value?.recipientName, 120), postalCode: text(value?.postalCode, 9).replace(/\D/g, ''), street: text(value?.street, 180), number: text(value?.number, 30), complement: text(value?.complement, 100) || null, district: text(value?.district, 100), city: text(value?.city, 100), state: text(value?.state, 2).toUpperCase() };
    if (!address.recipientName || address.postalCode.length !== 8 || !address.street || !address.number || !address.district || !address.city || !/^[A-Z]{2}$/.test(address.state)) throw new Error('Endereço de entrega incompleto ou inválido.');
    return address;
  }
}
