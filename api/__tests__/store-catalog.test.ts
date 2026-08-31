import { describe, expect, it } from '@jest/globals';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { INVICTUS_COMING_SOON_CATALOGUE, REAL_STORE_CATALOGUE, materializeCatalogue } from '../_data/store-catalog.js';
import { calculateProductPricing, costHistoryDocumentId, getAdminPending, getPublicationGaps, isValidGtin13, productPublicView } from '../_lib/store-engine.js';

describe('Loja Invictus - catálogo e precificação', () => {
  it('mantém 21 produtos reais, IDs internos e GTINs validados únicos', () => {
    const products = REAL_STORE_CATALOGUE;
    const validatedGtins = products.map(product => product.gtin).filter(Boolean);
    expect(products).toHaveLength(21);
    expect(new Set(products.map(product => product.productId)).size).toBe(21);
    expect(new Set(validatedGtins).size).toBe(16);
    expect(validatedGtins.every(gtin => isValidGtin13(gtin))).toBe(true);
    expect(products.every(product => product.productId !== product.gtin)).toBe(true);
    expect(products.map(product => product.displayOrder)).toEqual([...Array(21)].map((_, index) => index + 1));
  });

  it('preserva códigos de 13 dígitos com checksum inválido apenas como candidatos', () => {
    const candidates = REAL_STORE_CATALOGUE.filter(product => product.gtinCandidate);
    expect(candidates.map(product => product.gtinCandidate)).toEqual(['7898530531588', '7898593050680']);
    expect(candidates.every(product => product.gtin === null && product.productStatus === 'DRAFT')).toBe(true);
    expect(candidates.every(product => product.adminPending?.includes('GTIN_PENDING_VERIFICATION'))).toBe(true);
  });

  it('preserva os códigos e descrições do Santo Hábito sem promovê-los a GTIN inválido', () => {
    const products = REAL_STORE_CATALOGUE.filter(product => product.brand === 'Santo Hábito');
    expect(products).toHaveLength(3);
    expect(products.map(product => product.supplierCode)).toEqual(['70341689646', '70341689684', '70341689653']);
    expect(products.every(product => product.gtin === null && product.currentSupplierCost === null)).toBe(true);
    expect(products.every(product => product.productStatus === 'DRAFT')).toBe(true);
    expect(products.every(product => product.supplierDescription?.startsWith('SANTO HABITO AZ'))).toBe(true);
    expect(products.every(product => product.adminPending?.includes('GTIN_PENDING_VERIFICATION'))).toBe(true);
  });

  it('reutiliza os quatro DermUp existentes e complementa códigos de fornecedor e caixa', () => {
    const dermUp = REAL_STORE_CATALOGUE.filter(product => product.productId.startsWith('prd_dermup_'));
    expect(dermUp).toHaveLength(4);
    expect(new Set(dermUp.map(product => product.gtin)).size).toBe(4);
    expect(dermUp.every(product => product.supplierCode && product.boxGtin)).toBe(true);
  });

  it('mantém os 10 produtos próprios como desenvolvimento pendente sem dados inventados', () => {
    const products = INVICTUS_COMING_SOON_CATALOGUE;
    expect(products).toHaveLength(10);
    expect(new Set(products.map(product => product.productId)).size).toBe(10);
    expect(products.every(product => product.brand === 'Invictus Performance')).toBe(true);
    expect(products.every(product => product.productStatus === 'COMING_SOON' && product.developmentStatus === 'PRODUCT_DEVELOPMENT_PENDING')).toBe(true);
    expect(products.every(product => product.supplierId === null && product.supplierSku === null && product.gtin === null)).toBe(true);
    expect(products.every(product => product.currentSupplierCost === null && product.pricing.cashPrice === null && product.coinPrice === null)).toBe(true);
    expect(products.every(product => product.commercialStock === 0 && product.dropStock === 0)).toBe(true);
    expect(products.every(product => !product.canPurchaseWithMoney && !product.canRedeemWithCoins && !product.canUseCoinsPlusMoney)).toBe(true);
    expect(products.every(product => product.imageStatus === 'READY' && product.images.primary?.startsWith('/assets/store/products/own-brand/') && product.images.gallery.length === 0)).toBe(true);
    expect(new Set(products.map(product => product.category))).toEqual(new Set(['Vestuário', 'Acessórios']));
  });

  it('não cria preço, Coin Price, estoque ou imagem que não foram fornecidos', () => {
    const products = materializeCatalogue();
    expect(products.every(product => product.pricing.cashPrice === null)).toBe(true);
    expect(products.every(product => product.coinPrice === null)).toBe(true);
    expect(products.every(product => product.commercialStock === 0 && product.dropStock === 0)).toBe(true);
    expect(REAL_STORE_CATALOGUE.every(product => product.imageStatus === 'READY' && product.images.primary)).toBe(true);
  });

  it('associa todos os assets reais a arquivos existentes no projeto', () => {
    for (const product of REAL_STORE_CATALOGUE) {
      expect(existsSync(join(process.cwd(), 'public', product.images.primary!))).toBe(true);
      for (const asset of product.images.gallery) expect(existsSync(join(process.cwd(), 'public', asset))).toBe(true);
    }
  });

  it('materializa 21 produtos reais e 10 itens futuros, todos com IDs únicos', () => {
    const products = materializeCatalogue();
    expect(products).toHaveLength(31);
    expect(new Set(products.map(product => product.productId)).size).toBe(31);
  });

  it('calcula margem e markup sem confundir os conceitos', () => {
    const pricing = calculateProductPricing(50, { cashPrice: 100, estimatedShippingCost: 5, packagingCost: 2, taxRate: 10, paymentFeePercent: 5, paymentFeeFixed: 1, otherVariableCost: 2, subsidyCost: 0, desiredMarginPercent: 20 });
    expect(pricing.estimatedProfit).toBe(25);
    expect(pricing.estimatedMarginPercent).toBe(25);
    expect(pricing.markup).toBe(2);
    expect(pricing.calculatedSuggestedPrice).toBeCloseTo(92.3077, 3);
  });

  it('identifica lacunas sem impedir a visibilidade de prévia solicitada', () => {
    const product = materializeCatalogue()[0];
    expect(product.published).toBe(true);
    expect(getPublicationGaps(product)).toEqual(expect.arrayContaining(['descrição pública', 'configuração comercial']));
    expect(getPublicationGaps(product)).not.toContain('imagem principal');
  });

  it('preserva a ordem comercial aprovada', () => {
    expect(REAL_STORE_CATALOGUE[0].gtin).toBe('7896311763498');
    expect(REAL_STORE_CATALOGUE[13].gtin).toBe('7898593053779');
    expect(REAL_STORE_CATALOGUE[20].gtin).toBeNull();
    expect(REAL_STORE_CATALOGUE[20].gtinCandidate).toBe('7898593050680');
  });

  it('não expõe custo nem dados do fornecedor na representação pública', () => {
    const publicProduct = productPublicView(materializeCatalogue()[0], null) as unknown as Record<string, unknown>;
    expect(publicProduct).not.toHaveProperty('currentSupplierCost');
    expect(publicProduct).not.toHaveProperty('regularSupplierCost');
    expect(publicProduct).not.toHaveProperty('supplierCode');
    expect(publicProduct).not.toHaveProperty('supplierDescription');
    expect(publicProduct).not.toHaveProperty('pricing');
    expect(publicProduct).not.toHaveProperty('adminPending');
    expect(publicProduct.cashPrice).toBeNull();
  });

  it('gera histórico de custo idempotente para a mesma combinação de produto e custo', () => {
    expect(costHistoryDocumentId('prd_example', 58.77)).toBe('supplier_catalog_prd_example_5877');
    expect(costHistoryDocumentId('prd_example', 58.77)).toBe(costHistoryDocumentId('prd_example', 58.77));
    expect(costHistoryDocumentId('prd_example', 58.78)).not.toBe(costHistoryDocumentId('prd_example', 58.77));
  });

  it('recalcula pendências administrativas sem depender do estado salvo', () => {
    const pending = getAdminPending(materializeCatalogue()[15]);
    expect(pending).toEqual(expect.arrayContaining(['SUPPLIER', 'SUPPLIER_SKU', 'GTIN_PENDING_VERIFICATION', 'SUPPLIER_COST', 'PUBLIC_DESCRIPTION', 'CASH_PRICE', 'COIN_PRICE', 'STOCK', 'LOGISTICS', 'PRICING']));
    expect(pending).not.toContain('IMAGES');
  });
});
