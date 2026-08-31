import { db } from './common.js';
import { materializeCatalogue } from '../_data/store-catalog.js';
import type { PhysicalOrder, PhysicalOrderItemSnapshot, PhysicalProduct, PhysicalShippingAddress, ProductPricing, PublicPhysicalProduct, RewardCoinTransaction, StoreDrop } from '../../src/types.js';

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
  coinPrice?: number | null;
  cashTopUp?: number | null;
  commercialStock?: number;
  dropStock?: number;
  displayOrder?: number;
  active?: boolean;
  storeVisible?: boolean;
  published?: boolean;
  canPurchaseWithMoney?: boolean;
  canRedeemWithCoins?: boolean;
  canUseCoinsPlusMoney?: boolean;
};
const money = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
const nullableMoney = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;

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
  return { cashPrice, supplierCost, estimatedShippingCost, packagingCost, taxRate, paymentFeePercent, paymentFeeFixed, otherVariableCost, subsidyCost, desiredMarginPercent, calculatedSuggestedPrice, estimatedProfit, estimatedMarginPercent, markup, supplierCostAtLastPricing: supplierCost, lastCalculatedAt: new Date().toISOString() };
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
  if (product.pricing.cashPrice === null) pending.push('CASH_PRICE');
  if (product.coinPrice === null) pending.push('COIN_PRICE');
  if (product.commercialStock <= 0 && product.dropStock <= 0) pending.push('STOCK');
  if (product.shippingWeight === null || product.packageLengthCm === null || product.packageWidthCm === null || product.packageHeightCm === null) pending.push('LOGISTICS');
  if (product.pricing.lastCalculatedAt === null) pending.push('PRICING');
  return pending;
}

export function getPublicationGaps(product: PhysicalProduct): string[] {
  if (product.productStatus === 'COMING_SOON') {
    const pending: string[] = [];
    if (!product.supplierId) pending.push('FORNECEDOR');
    if (product.currentSupplierCost === null) pending.push('CUSTO');
    if (product.pricing.cashPrice === null || product.coinPrice === null) pending.push('PREÇO');
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
  const cashReady = product.canPurchaseWithMoney && product.pricing.cashPrice !== null && product.pricing.cashPrice > 0;
  const coinReady = product.canRedeemWithCoins && product.coinPrice !== null && product.coinPrice > 0;
  if (!cashReady && !coinReady) gaps.push('configuração comercial');
  return gaps;
}

export function productPublicView(product: PhysicalProduct, drop: any | null): PublicPhysicalProduct {
  const availableCommercialStock = Math.max(0, money(product.commercialStock) - money(product.reservedCommercialStock));
  const availableDropStock = Math.max(0, money(product.dropStock) - money(product.reservedDropStock));
  const now = Date.now();
  const startsAt = drop?.startsAt ? Date.parse(drop.startsAt) : NaN;
  const endsAt = drop?.endsAt ? Date.parse(drop.endsAt) : NaN;
  const dropOpen = Boolean(drop?.active) && Number.isFinite(startsAt) && Number.isFinite(endsAt) && startsAt <= now && endsAt >= now;
  const nextDropAt = Number.isFinite(startsAt) && startsAt > now ? drop.startsAt : null;
  const dropState: PublicPhysicalProduct['dropState'] = !product.canRedeemWithCoins ? 'UNAVAILABLE' : availableDropStock <= 0 ? 'SOLD_OUT' : dropOpen ? 'OPEN' : 'UPCOMING';
  const { developmentStatus: _developmentStatus, supplierId: _supplierId, supplierCode: _supplierCode, supplierSku: _supplierSku, supplierName: _supplierName, supplierDescription: _supplierDescription, supplierClaims: _supplierClaims, gtinCandidate: _gtinCandidate, boxGtinCandidate: _boxGtinCandidate, regularSupplierCost: _regularSupplierCost, currentSupplierCost: _currentSupplierCost, minimumOrderQuantity: _minimumOrderQuantity, leadTime: _leadTime, promotionMinimumQuantity: _promotionMinimumQuantity, promotionStartAt: _promotionStartAt, promotionEndAt: _promotionEndAt, availability: _availability, lastCostUpdate: _lastCostUpdate, commercialStock: _commercialStock, dropStock: _dropStock, reservedCommercialStock: _reservedCommercialStock, reservedDropStock: _reservedDropStock, adminPending: _adminPending, pricing, ...safe } = product;
  return { ...safe, cashPrice: pricing.cashPrice, availableForPurchase: Boolean(product.canPurchaseWithMoney && pricing.cashPrice && availableCommercialStock > 0), availableForDrop: dropState === 'OPEN' && Boolean(product.coinPrice && availableDropStock > 0), commercialAvailability: availableCommercialStock > 0 ? 'AVAILABLE' : 'UNAVAILABLE', dropState, nextDropAt };
}

export class StoreEngine {
  static async ensureRealCatalogue(): Promise<{ created: number; existing: number; total: number }> {
    if (!db) throw new Error('Database not initialized');
    const products = materializeCatalogue();
    const markerRef = db.collection('system_config').doc('store_catalogue_v1');
    const marker = await markerRef.get();
    if (marker.exists && marker.data()?.version === 6 && marker.data()?.total === products.length) return { created: 0, existing: products.length, total: products.length };
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
      if (snapshot.exists) {
        existing += 1;
        const existingData = snapshot.data() || {};
        const seededImages = product.imageStatus === 'READY' && (existingData.imageStatus !== 'READY' || !existingData.images?.primary?.includes('/assets/store/products/catalog/'))
          ? { images: product.images, imageStatus: product.imageStatus }
          : {};
        const commerciallyActive = existingData.productStatus === 'ACTIVE' && (existingData.pricing?.cashPrice > 0 || existingData.coinPrice > 0);
        await ref.set({
          name: product.name,
          normalizedName,
          brand: product.brand,
          category: product.category,
          subcategory: product.subcategory,
          flavor: product.flavor,
          weight: product.weight,
          weightUnit: product.weightUnit,
          package: product.package,
          supplierCode: product.supplierCode,
          boxGtin: product.boxGtin,
          gtin: product.gtin,
          gtinCandidate: product.gtinCandidate ?? null,
          barcodeType: product.barcodeType,
          boxGtinCandidate: product.boxGtinCandidate ?? null,
          supplierDescription: product.supplierDescription,
          regularSupplierCost: existingData.regularSupplierCost ?? product.regularSupplierCost,
          promotionMinimumQuantity: existingData.promotionMinimumQuantity ?? product.promotionMinimumQuantity,
          active: true,
          storeVisible: true,
          published: true,
          productStatus: commerciallyActive ? 'ACTIVE' : product.productStatus,
          developmentStatus: product.developmentStatus,
          displayOrder: product.displayOrder,
          adminPending: product.adminPending,
          minimumOrderQuantity: existingData.minimumOrderQuantity ?? product.minimumOrderQuantity,
          leadTime: existingData.leadTime ?? product.leadTime,
          currentSupplierCost: existingData.currentSupplierCost ?? product.currentSupplierCost,
          pricing: { ...product.pricing, ...(existingData.pricing || {}), supplierCost: existingData.pricing?.supplierCost ?? product.currentSupplierCost },
          shippingWeight: existingData.shippingWeight ?? product.shippingWeight,
          shippingWeightUnit: existingData.shippingWeightUnit ?? product.shippingWeightUnit,
          packageLengthCm: existingData.packageLengthCm ?? product.packageLengthCm,
          packageWidthCm: existingData.packageWidthCm ?? product.packageWidthCm,
          packageHeightCm: existingData.packageHeightCm ?? product.packageHeightCm,
          ...seededImages,
          updatedAt: new Date().toISOString(),
        }, { merge: true });
      } else {
        await ref.create({ ...product, normalizedName });
        created += 1;
      }

      if (product.supplierCode) {
        await db.collection('supplierProducts').doc(`catalogue_${product.productId}`).set({
          productId: product.productId,
          supplierId: product.supplierId,
          supplierCode: product.supplierCode,
          gtin: product.gtin,
          gtinCandidate: product.gtinCandidate ?? null,
          boxGtin: product.boxGtin ?? null,
          boxGtinCandidate: product.boxGtinCandidate ?? null,
          currentSupplierCost: product.currentSupplierCost,
          currency: product.currency,
          source: 'SUPPLIER_CATALOG',
          updatedAt: new Date().toISOString(),
        }, { merge: true });
      }

      if (product.currentSupplierCost !== null) {
        const historyRef = db.collection('productCostHistory').doc(costHistoryDocumentId(product.productId, product.currentSupplierCost));
        const history = await historyRef.get();
        if (!history.exists) await historyRef.create({
          productId: product.productId,
          supplierId: product.supplierId,
          oldCost: null,
          newCost: product.currentSupplierCost,
          changedAt: new Date().toISOString(),
          source: 'SUPPLIER_CATALOG',
          promotion: Boolean(product.promotionMinimumQuantity),
          promotionMinimumQuantity: product.promotionMinimumQuantity,
        });
      }
    }
    await markerRef.set({ version: 6, total: products.length, updatedAt: new Date().toISOString() }, { merge: true });
    return { created, existing, total: products.length };
  }

  static async getActiveDrop(): Promise<any | null> {
    if (!db) return null;
    const snapshot = await db.collection('store_drops').where('active', '==', true).limit(10).get();
    const now = Date.now();
    const drops = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })).filter((drop: any) => Date.parse(drop.endsAt || '') >= now);
    return drops.sort((a: any, b: any) => {
      const aOpen = Date.parse(a.startsAt || '') <= now ? 0 : 1;
      const bOpen = Date.parse(b.startsAt || '') <= now ? 0 : 1;
      return aOpen - bOpen || Date.parse(a.startsAt || '') - Date.parse(b.startsAt || '');
    })[0] || null;
  }

  static async getPublicProducts(): Promise<PublicPhysicalProduct[]> {
    if (!db) return [];
    const [snapshot, drop] = await Promise.all([db.collection('products').where('active', '==', true).get(), this.getActiveDrop()]);
    return snapshot.docs.map(doc => doc.data() as PhysicalProduct).filter(product => product.storeVisible && product.published).sort((a, b) => a.displayOrder - b.displayOrder).map(product => productPublicView(product, drop));
  }

  static async getPublicProduct(productId: string): Promise<PublicPhysicalProduct | null> {
    if (!db) return null;
    const [snapshot, drop] = await Promise.all([db.collection('products').doc(productId).get(), this.getActiveDrop()]);
    if (!snapshot.exists) return null;
    const product = snapshot.data() as PhysicalProduct;
    if (!product.active || !product.storeVisible || !product.published) return null;
    return productPublicView(product, drop);
  }

  static async getAdminProducts(): Promise<Array<PhysicalProduct & { publicationGaps: string[] }>> {
    if (!db) return materializeCatalogue().map(product => ({ ...product, adminPending: getAdminPending(product), publicationGaps: getPublicationGaps(product) }));
    const snapshot = await db.collection('products').get();
    return snapshot.docs.map(doc => doc.data() as PhysicalProduct).sort((a, b) => a.displayOrder - b.displayOrder).map(product => ({ ...product, adminPending: getAdminPending(product), publicationGaps: getPublicationGaps(product) }));
  }

  static async updatePricing(productId: string, input: PricingInput): Promise<PhysicalProduct> {
    if (!db) throw new Error('Database not initialized');
    const ref = db.collection('products').doc(productId);
    const snapshot = await ref.get();
    if (!snapshot.exists) throw new Error('Produto não encontrado.');
    const product = snapshot.data() as PhysicalProduct;
    if (product.currentSupplierCost === null) throw new Error('Defina o custo do fornecedor antes da precificação.');
    const pricing = calculateProductPricing(product.currentSupplierCost, input);
    const canPurchaseWithMoney = Boolean(pricing.cashPrice && pricing.cashPrice > 0);
    const productStatus = pricing.cashPrice !== null && product.productStatus === 'READY_FOR_PRICING' ? 'READY_FOR_REVIEW' : product.productStatus;
    const updated = { ...product, pricing, canPurchaseWithMoney, productStatus };
    const adminPending = getAdminPending(updated);
    await ref.set({ pricing, canPurchaseWithMoney, productStatus, adminPending, updatedAt: new Date().toISOString() }, { merge: true });
    return { ...updated, adminPending };
  }

  static async updateSupplierCost(productId: string, newCost: number, source: string): Promise<void> {
    if (!db) throw new Error('Database not initialized');
    if (!Number.isFinite(newCost) || newCost < 0) throw new Error('Custo inválido.');
    const ref = db.collection('products').doc(productId);
    await db.runTransaction(async transaction => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) throw new Error('Produto não encontrado.');
      const product = snapshot.data() as PhysicalProduct;
      if (product.currentSupplierCost === newCost) return;
      transaction.create(db.collection('productCostHistory').doc(), { productId, supplierId: product.supplierName || null, oldCost: product.currentSupplierCost, newCost, changedAt: new Date().toISOString(), source, promotion: Boolean(product.promotionMinimumQuantity), promotionMinimumQuantity: product.promotionMinimumQuantity });
      transaction.update(ref, { currentSupplierCost: newCost, 'pricing.supplierCost': newCost, lastCostUpdate: new Date().toISOString(), updatedAt: new Date().toISOString() });
    });
  }

  static async updateProductConfiguration(productId: string, input: ProductConfigurationInput): Promise<PhysicalProduct> {
    if (!db) throw new Error('Database not initialized');
    const ref = db.collection('products').doc(productId);
    const snapshot = await ref.get();
    if (!snapshot.exists) throw new Error('Produto não encontrado.');
    const product = snapshot.data() as PhysicalProduct;
    const integer = (value: unknown, fallback: number) => typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : fallback;
    const optionalPrice = (value: unknown, fallback: number | null) => value === null ? null : typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
    const publicDescription = input.publicDescription === null ? null : typeof input.publicDescription === 'string' ? input.publicDescription.trim().slice(0, 4000) || null : product.publicDescription;
    const publicHighlights = Array.isArray(input.publicHighlights)
      ? input.publicHighlights.filter(item => typeof item === 'string').map(item => item.trim()).filter(Boolean).slice(0, 8).map(item => item.slice(0, 180))
      : product.publicHighlights;
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
    const coinPrice = optionalPrice(input.coinPrice, product.coinPrice);
    const cashTopUp = optionalPrice(input.cashTopUp, product.cashTopUp);
    const commercialStock = integer(input.commercialStock, product.commercialStock);
    const dropStock = integer(input.dropStock, product.dropStock);
    if (commercialStock < product.reservedCommercialStock) throw new Error('Estoque comercial não pode ser menor que o estoque reservado.');
    if (dropStock < product.reservedDropStock) throw new Error('Estoque do Drop não pode ser menor que o estoque reservado.');
    const canPurchaseWithMoney = Boolean(input.canPurchaseWithMoney && product.pricing.cashPrice && product.pricing.cashPrice > 0);
    const canRedeemWithCoins = Boolean(input.canRedeemWithCoins && coinPrice && coinPrice > 0);
    const canUseCoinsPlusMoney = Boolean(input.canUseCoinsPlusMoney && canRedeemWithCoins && cashTopUp && cashTopUp > 0);
    const requestedStatus = input.productStatus === 'ACTIVE'
      ? 'ACTIVE'
      : product.productStatus === 'DRAFT' && gtin && currentSupplierCost !== null
        ? 'READY_FOR_PRICING'
        : product.productStatus;
    if (requestedStatus === 'ACTIVE' && product.productStatus !== 'ACTIVE') {
      const activationReady = supplierId && supplierSku && gtin && currentSupplierCost !== null && minimumOrderQuantity && leadTime && publicDescription && (commercialStock > 0 || dropStock > 0) && (product.pricing.cashPrice !== null || coinPrice !== null) && product.imageStatus === 'READY' && product.images.primary && product.pricing.lastCalculatedAt;
      if (!activationReady) throw new Error('Preencha fornecedor, custo, descrição pública, preço, estoque, EAN/SKU, imagens e precificação antes de ativar.');
    }
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
      coinPrice,
      cashTopUp,
      commercialStock,
      dropStock,
      displayOrder: integer(input.displayOrder, product.displayOrder),
      active: typeof input.active === 'boolean' ? input.active : product.active,
      storeVisible: typeof input.storeVisible === 'boolean' ? input.storeVisible : product.storeVisible,
      published: typeof input.published === 'boolean' ? input.published : product.published,
      canPurchaseWithMoney,
      canRedeemWithCoins,
      canUseCoinsPlusMoney,
      updatedAt: new Date().toISOString(),
    };
    if (currentSupplierCost !== product.currentSupplierCost) changes.pricing = { ...product.pricing, supplierCost: currentSupplierCost, supplierCostAtLastPricing: null, lastCalculatedAt: null };
    changes.adminPending = getAdminPending({ ...product, ...changes, pricing: changes.pricing || product.pricing } as PhysicalProduct);
    await db.runTransaction(async transaction => {
      if (currentSupplierCost !== product.currentSupplierCost) {
        transaction.create(db.collection('productCostHistory').doc(), { productId, supplierId, oldCost: product.currentSupplierCost, newCost: currentSupplierCost, changedAt: new Date().toISOString(), source: 'admin-development', promotion: false, promotionMinimumQuantity: null });
      }
      transaction.set(ref, changes, { merge: true });
    });
    return { ...product, ...changes };
  }

  static calculateDropExposure(product: PhysicalProduct, extras: { freightSubsidy?: number; packaging?: number; otherCosts?: number } = {}) {
    return Math.max(0, product.dropStock) * money(product.currentSupplierCost) + money(extras.freightSubsidy) + money(extras.packaging) + money(extras.otherCosts);
  }

  static async getAdminDrops(): Promise<Array<StoreDrop & { maximumExposure: number }>> {
    if (!db) throw new Error('Database not initialized');
    const [dropsSnapshot, productsSnapshot] = await Promise.all([db.collection('store_drops').get(), db.collection('products').get()]);
    const products = new Map(productsSnapshot.docs.map(doc => [doc.id, doc.data() as PhysicalProduct]));
    return dropsSnapshot.docs.map(doc => {
      const drop = { id: doc.id, ...doc.data() } as StoreDrop;
      const productExposure = drop.productIds.reduce((total, productId) => {
        const product = products.get(productId);
        return total + (product ? Math.max(0, product.dropStock) * money(product.currentSupplierCost) : 0);
      }, 0);
      return { ...drop, maximumExposure: productExposure + money(drop.freightSubsidy) + money(drop.packagingCost) + money(drop.otherCosts) };
    }).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  }

  static async saveDrop(input: Partial<StoreDrop>): Promise<StoreDrop> {
    if (!db) throw new Error('Database not initialized');
    const name = typeof input.name === 'string' ? input.name.trim().slice(0, 120) : '';
    const startsAt = typeof input.startsAt === 'string' ? new Date(input.startsAt).toISOString() : '';
    const endsAt = typeof input.endsAt === 'string' ? new Date(input.endsAt).toISOString() : '';
    if (!name || !startsAt || !endsAt || Date.parse(endsAt) <= Date.parse(startsAt)) throw new Error('Nome e período válido são obrigatórios.');
    const productIds = Array.isArray(input.productIds) ? [...new Set(input.productIds.filter(id => typeof id === 'string' && id.length <= 128))] : [];
    if (!productIds.length) throw new Error('Selecione pelo menos um produto para o Drop.');
    const allProducts = await Promise.all(productIds.map(id => db.collection('products').doc(id).get()));
    if (allProducts.some(snapshot => !snapshot.exists)) throw new Error('O Drop contém um produto inexistente.');
    const active = input.active === true;
    const currentId = typeof input.id === 'string' && /^drop_[a-zA-Z0-9_-]+$/.test(input.id) ? input.id : `drop_${Date.now().toString(36)}`;
    if (active) {
      const existing = await db.collection('store_drops').where('active', '==', true).get();
      const overlap = existing.docs.some(doc => doc.id !== currentId && Date.parse(doc.data().startsAt || '') < Date.parse(endsAt) && Date.parse(doc.data().endsAt || '') > Date.parse(startsAt));
      if (overlap) throw new Error('Já existe um Drop ativo sobreposto neste período.');
    }
    const now = new Date().toISOString();
    const ref = db.collection('store_drops').doc(currentId);
    const previous = await ref.get();
    const drop: StoreDrop = { id: currentId, name, startsAt, endsAt, active, shippingMode: input.shippingMode === 'FREE' ? 'FREE' : 'PAID_PENDING', productIds, freightSubsidy: money(input.freightSubsidy), packagingCost: money(input.packagingCost), otherCosts: money(input.otherCosts), createdAt: previous.exists ? previous.data()?.createdAt || now : now, updatedAt: now };
    await ref.set(drop, { merge: false });
    return drop;
  }

  static async redeemWithCoins(params: { userId: string; productId: string; quantity: number; address: PhysicalShippingAddress; idempotencyKey: string }): Promise<{ order: PhysicalOrder; duplicated: boolean }> {
    if (!db) throw new Error('Database not initialized');
    const quantity = Number(params.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) throw new Error('Quantidade inválida.');
    if (!params.idempotencyKey?.trim()) throw new Error('Chave de idempotência obrigatória.');
    const address = this.validateAddress(params.address);
    const activeDrop = await this.getActiveDrop();
    if (!activeDrop) throw new Error('Nenhum Drop está configurado.');
    if (activeDrop.shippingMode !== 'FREE') throw new Error('O frete deste Drop ainda não foi configurado.');
    const safeKey = Buffer.from(`${params.userId}:${params.idempotencyKey}`).toString('base64url').slice(0, 150);
    const orderId = `store_coin_${safeKey}`;
    const orderRef = db.collection('physicalOrders').doc(orderId);
    const itemRef = db.collection('physicalOrderItems').doc(`${orderId}_${params.productId}`);
    const walletRef = db.collection('reward_coin_wallets').doc(params.userId);
    const productRef = db.collection('products').doc(params.productId);
    const dropRef = db.collection('store_drops').doc(activeDrop.id);
    const coinTransactionRef = db.collection('reward_coin_transactions').doc(`coin_store_${safeKey}`);
    let duplicated = false;

    await db.runTransaction(async transaction => {
      const [existingOrder, productSnapshot, walletSnapshot, dropSnapshot] = await Promise.all([
        transaction.get(orderRef), transaction.get(productRef), transaction.get(walletRef), transaction.get(dropRef),
      ]);
      if (existingOrder.exists) { duplicated = true; return; }
      if (!productSnapshot.exists) throw new Error('Produto não encontrado.');
      const product = productSnapshot.data() as PhysicalProduct;
      const drop = dropSnapshot.data() || {};
      const nowMs = Date.now();
      if (!dropSnapshot.exists || drop.active !== true || Date.parse(drop.startsAt || '') > nowMs || Date.parse(drop.endsAt || '') < nowMs) throw new Error('Este Drop não está aberto.');
      if (Array.isArray(drop.productIds) && !drop.productIds.includes(product.productId)) throw new Error('Produto indisponível neste Drop.');
      if (product.productStatus !== 'ACTIVE' || !product.gtin || product.currentSupplierCost === null || !product.active || !product.published || !product.canRedeemWithCoins || !product.coinPrice) throw new Error('Produto indisponível para resgate.');
      const availableDropStock = product.dropStock - product.reservedDropStock;
      if (availableDropStock < quantity) throw new Error('Estoque do Drop insuficiente.');
      const totalCoinAmount = product.coinPrice * quantity;
      const wallet = walletSnapshot.exists ? walletSnapshot.data() || {} : {};
      const balance = Math.max(0, Number(wallet.balance) || 0);
      if (balance < totalCoinAmount) throw new Error('Saldo de Invictus Coins insuficiente.');
      const createdAt = new Date().toISOString();
      const order: PhysicalOrder = { orderId, userId: params.userId, status: 'PROCESSING', paymentMethod: 'COINS', totalCashAmount: 0, totalCoinAmount, shippingAmount: 0, address, dropId: activeDrop.id, idempotencyKey: params.idempotencyKey, createdAt, updatedAt: createdAt };
      const item: PhysicalOrderItemSnapshot = { productId: product.productId, name: product.name, gtin: product.gtin, quantity, unitPrice: 0, supplierCostSnapshot: product.currentSupplierCost, coinAmountUsed: totalCoinAmount, cashAmount: 0, shippingAmount: 0 };
      const coinTransaction: RewardCoinTransaction = { id: coinTransactionRef.id, userId: params.userId, amount: totalCoinAmount, type: 'debit', origin: 'store_purchase', ledgerType: 'STORE_PURCHASE', description: `Resgate na Loja Invictus: ${product.name}`, idempotencyKey: params.idempotencyKey, createdAt };
      transaction.update(productRef, { reservedDropStock: product.reservedDropStock + quantity, updatedAt: createdAt });
      transaction.set(walletRef, { userId: params.userId, balance: balance - totalCoinAmount, lifetimeEarned: Math.max(0, Number(wallet.lifetimeEarned) || 0), lifetimeSpent: Math.max(0, Number(wallet.lifetimeSpent) || 0) + totalCoinAmount, updatedAt: createdAt }, { merge: true });
      transaction.create(orderRef, order);
      transaction.create(itemRef, { orderId, userId: params.userId, ...item });
      transaction.create(coinTransactionRef, coinTransaction);
    });
    const orderSnapshot = await orderRef.get();
    return { order: orderSnapshot.data() as PhysicalOrder, duplicated };
  }

  static async getMyPhysicalOrders(userId: string): Promise<Array<PhysicalOrder & { items: Array<Omit<PhysicalOrderItemSnapshot, 'supplierCostSnapshot'>> }>> {
    if (!db) throw new Error('Database not initialized');
    const [ordersSnapshot, itemsSnapshot] = await Promise.all([db.collection('physicalOrders').where('userId', '==', userId).get(), db.collection('physicalOrderItems').where('userId', '==', userId).get()]);
    const itemsByOrder = new Map<string, Array<Omit<PhysicalOrderItemSnapshot, 'supplierCostSnapshot'>>>();
    for (const itemDocument of itemsSnapshot.docs) {
      const { supplierCostSnapshot: _supplierCostSnapshot, orderId, userId: _userId, ...safeItem } = itemDocument.data() as PhysicalOrderItemSnapshot & { orderId: string; userId: string };
      itemsByOrder.set(orderId, [...(itemsByOrder.get(orderId) || []), safeItem]);
    }
    return ordersSnapshot.docs.map(doc => doc.data() as PhysicalOrder).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50).map(order => ({ ...order, items: itemsByOrder.get(order.orderId) || [] }));
  }

  static async getAdminOrders(): Promise<Array<PhysicalOrder & { items: PhysicalOrderItemSnapshot[] }>> {
    if (!db) throw new Error('Database not initialized');
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
    const allowed: Record<PhysicalOrder['status'], PhysicalOrder['status'][]> = { PENDING_PAYMENT: ['CANCELLED'], PAID: ['PROCESSING', 'CANCELLED', 'REFUNDED'], PROCESSING: ['SHIPPED', 'CANCELLED'], SHIPPED: ['DELIVERED'], DELIVERED: [], CANCELLED: [], REFUNDED: [] };
    const orderRef = db.collection('physicalOrders').doc(orderId);
    const itemsSnapshot = await db.collection('physicalOrderItems').where('orderId', '==', orderId).get();
    const items = itemsSnapshot.docs.map(doc => doc.data() as PhysicalOrderItemSnapshot);
    await db.runTransaction(async transaction => {
      const orderSnapshot = await transaction.get(orderRef);
      if (!orderSnapshot.exists) throw new Error('Pedido não encontrado.');
      const order = orderSnapshot.data() as PhysicalOrder;
      if (order.status === nextStatus) return;
      if (!allowed[order.status]?.includes(nextStatus)) throw new Error(`Transição inválida: ${order.status} → ${nextStatus}.`);
      const now = new Date().toISOString();
      const productRefs = items.map(item => db.collection('products').doc(item.productId));
      const productSnapshots = await Promise.all(productRefs.map(ref => transaction.get(ref)));
      const isCoinCancellation = nextStatus === 'CANCELLED' && order.paymentMethod === 'COINS';
      const walletRef = isCoinCancellation ? db.collection('reward_coin_wallets').doc(order.userId) : null;
      const refundRef = isCoinCancellation ? db.collection('reward_coin_transactions').doc(`coin_store_refund_${order.orderId}`) : null;
      const walletSnapshot = walletRef ? await transaction.get(walletRef) : null;
      const refundSnapshot = refundRef ? await transaction.get(refundRef) : null;
      if (nextStatus === 'SHIPPED') {
        if (!trackingCode?.trim()) throw new Error('Código de rastreio obrigatório para marcar como enviado.');
        productSnapshots.forEach((snapshot, index) => {
          if (!snapshot.exists) throw new Error('Produto do pedido não encontrado.');
          const product = snapshot.data() as PhysicalProduct;
          const quantity = items[index].quantity;
          if (product.reservedDropStock < quantity || product.dropStock < quantity) throw new Error('Reserva de estoque inconsistente.');
          transaction.update(productRefs[index], { dropStock: product.dropStock - quantity, reservedDropStock: product.reservedDropStock - quantity, updatedAt: now });
        });
      }
      if (isCoinCancellation && walletRef && refundRef && walletSnapshot && refundSnapshot) {
        productSnapshots.forEach((snapshot, index) => {
          if (!snapshot.exists) throw new Error('Produto do pedido não encontrado.');
          const product = snapshot.data() as PhysicalProduct;
          const quantity = items[index].quantity;
          if (product.reservedDropStock < quantity) throw new Error('Reserva de estoque inconsistente.');
          transaction.update(productRefs[index], { reservedDropStock: product.reservedDropStock - quantity, updatedAt: now });
        });
        const wallet = walletSnapshot.data() || {};
        if (!refundSnapshot.exists) {
          transaction.set(walletRef, { userId: order.userId, balance: Math.max(0, Number(wallet.balance) || 0) + order.totalCoinAmount, lifetimeEarned: Math.max(0, Number(wallet.lifetimeEarned) || 0), lifetimeSpent: Math.max(0, (Number(wallet.lifetimeSpent) || 0) - order.totalCoinAmount), updatedAt: now }, { merge: true });
          const refund: RewardCoinTransaction = { id: refundRef.id, userId: order.userId, amount: order.totalCoinAmount, type: 'credit', origin: 'store_purchase', ledgerType: 'STORE_REFUND', description: `Estorno do pedido ${order.orderId}`, idempotencyKey: `refund:${order.orderId}`, createdAt: now };
          transaction.create(refundRef, refund);
        }
      }
      transaction.update(orderRef, { status: nextStatus, trackingCode: nextStatus === 'SHIPPED' ? trackingCode!.trim().slice(0, 100) : order.trackingCode || null, shippedAt: nextStatus === 'SHIPPED' ? now : order.shippedAt || null, deliveredAt: nextStatus === 'DELIVERED' ? now : order.deliveredAt || null, cancelledAt: nextStatus === 'CANCELLED' ? now : order.cancelledAt || null, updatedAt: now });
    });
  }

  private static validateAddress(value: PhysicalShippingAddress): PhysicalShippingAddress {
    const text = (input: unknown, max: number) => typeof input === 'string' ? input.trim().slice(0, max) : '';
    const address: PhysicalShippingAddress = { recipientName: text(value?.recipientName, 120), postalCode: text(value?.postalCode, 9).replace(/\D/g, ''), street: text(value?.street, 180), number: text(value?.number, 30), complement: text(value?.complement, 100) || null, district: text(value?.district, 100), city: text(value?.city, 100), state: text(value?.state, 2).toUpperCase() };
    if (!address.recipientName || address.postalCode.length !== 8 || !address.street || !address.number || !address.district || !address.city || !/^[A-Z]{2}$/.test(address.state)) throw new Error('Endereço de entrega incompleto ou inválido.');
    return address;
  }
}
