import type { PhysicalProduct } from '../../src/types.js';

type CatalogueSeed = Omit<PhysicalProduct, 'createdAt' | 'updatedAt'>;

const pricing = (supplierCost: number | null): CatalogueSeed['pricing'] => ({
  cashPrice: null, supplierCost, estimatedShippingCost: null, packagingCost: null, taxRate: null,
  paymentFeePercent: null, paymentFeeFixed: null, otherVariableCost: null, subsidyCost: null,
  desiredMarginPercent: null, calculatedSuggestedPrice: null, estimatedProfit: null,
  estimatedMarginPercent: null, markup: null, supplierCostAtLastPricing: null, lastCalculatedAt: null,
});

const base = (data: {
  productId: string; gtin: string | null; name: string; brand: string;
  category?: 'Suplementos' | 'Bem-estar e Nutrição'; subcategory: string;
  currentSupplierCost: number | null; displayOrder: number; image: string; gallery?: string[];
  supplierCode?: string; gtinCandidate?: string; boxGtin?: string; boxGtinCandidate?: string; flavor?: string; weight?: number; package?: string;
  regularSupplierCost?: number; promotionMinimumQuantity?: number; supplierDescription?: string;
  productStatus?: CatalogueSeed['productStatus'];
}): CatalogueSeed => {
  const status = data.productStatus ?? (data.gtin && data.currentSupplierCost !== null ? 'READY_FOR_PRICING' : 'DRAFT');
  const image = `/assets/store/products/catalog/${data.image}`;
  return {
    productId: data.productId,
    productStatus: status,
    developmentStatus: status === 'DRAFT' ? 'PRODUCT_DEVELOPMENT_PENDING' : 'READY',
    supplierId: null,
    supplierCode: data.supplierCode ?? null,
    supplierSku: null,
    supplierName: null,
    gtin: data.gtin,
    gtinCandidate: data.gtinCandidate ?? null,
    boxGtin: data.boxGtin ?? null,
    boxGtinCandidate: data.boxGtinCandidate ?? null,
    barcodeType: data.gtin ? 'EAN13' : null,
    name: data.name,
    brand: data.brand,
    category: data.category ?? 'Suplementos',
    subcategory: data.subcategory,
    flavor: data.flavor ?? null,
    weight: data.weight ?? null,
    weightUnit: data.weight ? 'g' : null,
    package: data.package ?? null,
    supplierDescription: data.supplierDescription ?? null,
    publicDescription: null,
    supplierClaims: [],
    publicHighlights: [],
    regularSupplierCost: data.regularSupplierCost ?? null,
    currentSupplierCost: data.currentSupplierCost,
    minimumOrderQuantity: null,
    leadTime: null,
    promotionMinimumQuantity: data.promotionMinimumQuantity ?? null,
    promotionStartAt: null,
    promotionEndAt: null,
    availability: null,
    lastCostUpdate: null,
    currency: 'BRL',
    active: true,
    storeVisible: true,
    published: true,
    displayOrder: data.displayOrder,
    canPurchaseWithMoney: false,
    canRedeemWithCoins: false,
    canUseCoinsPlusMoney: false,
    coinPrice: null,
    cashTopUp: null,
    commercialStock: 0,
    dropStock: 0,
    reservedCommercialStock: 0,
    reservedDropStock: 0,
    images: { primary: image, thumbnail: image, gallery: (data.gallery ?? []).map(file => `/assets/store/products/catalog/${file}`) },
    imageStatus: 'READY',
    adminPending: [
      ...(!data.gtin ? ['GTIN_PENDING_VERIFICATION'] : []),
      ...(data.currentSupplierCost === null ? ['SUPPLIER_COST'] : []),
      'CASH_PRICE', 'COIN_PRICE', 'COMMERCIAL_STOCK', 'LOGISTICS',
    ],
    shippingWeight: null,
    shippingWeightUnit: null,
    packageLengthCm: null,
    packageWidthCm: null,
    packageHeightCm: null,
    pricing: pricing(data.currentSupplierCost),
  };
};

export const REAL_STORE_CATALOGUE: CatalogueSeed[] = [
  base({ productId:'prd_creatina_integral_150', supplierCode:'20912', gtin:'7896311763498', name:'Creatina Hardcore Reload 150g', brand:'Integralmédica', subcategory:'Creatina', weight:150, currentSupplierCost:23.34, displayOrder:1, image:'integral-creatina-150.jpg' }),
  base({ productId:'prd_creatina_max_150', supplierCode:'21571', gtin:'7898920041455', name:'Creatina 150g', brand:'Max Titanium', subcategory:'Creatina', weight:150, currentSupplierCost:28.34, displayOrder:2, image:'max-creatina-150.png' }),
  base({ productId:'prd_creatina_integral_300', supplierCode:'20137', gtin:'7896311708314', name:'Creatina Hardcore Reload 300g', brand:'Integralmédica', subcategory:'Creatina', weight:300, currentSupplierCost:42.50, displayOrder:3, image:'integral-creatina-300.png' }),
  base({ productId:'prd_creatina_max_300', supplierCode:'21573', gtin:'7898920041448', name:'Creatina 300g', brand:'Max Titanium', subcategory:'Creatina', weight:300, currentSupplierCost:44.63, displayOrder:4, image:'max-creatina-300.png' }),
  base({ productId:'prd_creatina_max_7belo_300', supplierCode:'23460', gtin:'7899941208841', name:'Creatina 300g 7 Belo', brand:'Max Titanium', subcategory:'Creatina', flavor:'Framboesa / 7 Belo', weight:300, currentSupplierCost:45.84, displayOrder:5, image:'max-creatina-7belo.jpg' }),
  base({ productId:'prd_crisp_integral_avela_12x45', gtin:'7896311760862', name:'Protein Crisp Bar Avelã 12 x 45g', brand:'Integralmédica', subcategory:'Barras', flavor:'Avelã', package:'12 unidades x 45g', currentSupplierCost:79.73, displayOrder:6, image:'integral-crisp-avela.png' }),
  base({ productId:'prd_crisp_integral_brownie_12x45', gtin:'7896311775712', name:'Protein Crisp Bar Brownie de Chocolate 12 x 45g', brand:'Integralmédica', subcategory:'Barras', flavor:'Brownie de Chocolate', package:'12 unidades x 45g', currentSupplierCost:79.73, displayOrder:7, image:'integral-crisp-brownie.jpg' }),
  base({ productId:'prd_whey_max_chocolate_900', gtin:'7899941207721', name:'100% Whey Double Tasty Chocolate 900g', brand:'Max Titanium', subcategory:'Proteínas', flavor:'Chocolate', weight:900, regularSupplierCost:140.64, currentSupplierCost:126.58, promotionMinimumQuantity:4, displayOrder:8, image:'max-whey-chocolate.jpg' }),
  base({ productId:'prd_whey_max_morango_900', gtin:'7899941207738', name:'100% Whey Double Tasty Morango 900g', brand:'Max Titanium', subcategory:'Proteínas', flavor:'Morango', weight:900, regularSupplierCost:140.64, currentSupplierCost:126.58, promotionMinimumQuantity:4, displayOrder:9, image:'max-whey-morango.jpg' }),
  base({ productId:'prd_whey_integral_gelato_907', gtin:'7896311777310', name:'Whey 100% Pure Refil Gelato di Latte 900g', brand:'Integralmédica', subcategory:'Proteínas', flavor:'Gelato di Latte', weight:900, currentSupplierCost:123.23, displayOrder:10, image:'integral-whey-gelato-900.webp' }),
  base({ productId:'prd_dermup_cacau_450', supplierCode:'00010865', boxGtin:'17898593050294', gtin:'7898593050297', name:'DermUp Beauty Whey 450g Cacau', brand:'Maxinutri', subcategory:'Proteínas', flavor:'Cacau', weight:450, currentSupplierCost:184.93, displayOrder:11, image:'dermup-cacau-450.png' }),
  base({ productId:'prd_dermup_baunilha_450', supplierCode:'00010874', boxGtin:'17898593050317', gtin:'7898593050310', name:'DermUp Beauty Whey 450g Baunilha', brand:'Maxinutri', subcategory:'Proteínas', flavor:'Baunilha', weight:450, currentSupplierCost:184.93, displayOrder:12, image:'dermup-baunilha-450.png' }),
  base({ productId:'prd_dermup_pistache_450', supplierCode:'00010866', boxGtin:'17898593050324', gtin:'7898593050327', name:'DermUp Beauty Whey 450g Pistache', brand:'Maxinutri', subcategory:'Proteínas', flavor:'Pistache', weight:450, currentSupplierCost:184.93, displayOrder:13, image:'dermup-pistache-450.png' }),
  base({ productId:'prd_dermup_pistache_12x30', supplierCode:'00015770', boxGtin:'17898593053776', gtin:'7898593053779', name:'DermUp Beauty Whey 12 x 30g Pistache', brand:'Maxinutri', subcategory:'Proteínas', flavor:'Pistache', package:'12 unidades x 30g', currentSupplierCost:145.25, displayOrder:14, image:'dermup-pistache-12x30.png' }),
  base({ productId:'prd_maxinutri_calcium_maxx_k2_60', supplierCode:'00015192', gtin:null, gtinCandidate:'7898530531588', boxGtinCandidate:'17898593051585', name:'Calcium Maxx K2 60 comprimidos', brand:'Maxinutri', category:'Bem-estar e Nutrição', subcategory:'Vitaminas e Minerais', package:'60 comprimidos', currentSupplierCost:58.77, displayOrder:15, image:'calcium-maxx-k2-60.png' }),
  base({ productId:'prd_santo_habito_az_homem_60', supplierCode:'70341689646', gtin:null, name:'Santo Hábito AZ Homem Exclusiv 60 cápsulas', brand:'Santo Hábito', category:'Bem-estar e Nutrição', subcategory:'Vitaminas e Minerais', package:'60 cápsulas', currentSupplierCost:null, displayOrder:16, image:'santo-habito-az-homem-60.png', gallery:['santo-habito-az-homem-60-alt.png'], supplierDescription:'SANTO HABITO AZ HOMEM EXCLUSIV 60 CAPSULAS' }),
  base({ productId:'prd_santo_habito_az_mulher_homem_pack', supplierCode:'70341689684', gtin:null, name:'Santo Hábito AZ Mulher + AZ Homem 60 cápsulas', brand:'Santo Hábito', category:'Bem-estar e Nutrição', subcategory:'Vitaminas e Minerais', package:'Pack AZ Mulher + AZ Homem, 60 cápsulas cada', currentSupplierCost:null, displayOrder:17, image:'santo-habito-az-mulher-homem-pack.png', supplierDescription:'SANTO HABITO AZ MULHER + AZ HOMEM 60 CAPSULAS' }),
  base({ productId:'prd_santo_habito_az_mulher_60', supplierCode:'70341689653', gtin:null, name:'Santo Hábito AZ Mulher Exclusiv 60 cápsulas', brand:'Santo Hábito', category:'Bem-estar e Nutrição', subcategory:'Vitaminas e Minerais', package:'60 cápsulas', currentSupplierCost:null, displayOrder:18, image:'santo-habito-az-mulher-60.png', supplierDescription:'SANTO HABITO AZ MULHER EXCLUSIV 60 CAPSULAS' }),
  base({ productId:'prd_vila_santa_parrilla_alho_700', supplierCode:'00014580', boxGtin:'17898593255767', gtin:'7898593255760', name:'Sal Rosa do Himalaia Parrilla com Alho 700g', brand:'Vila Santa', category:'Bem-estar e Nutrição', subcategory:'Temperos', flavor:'Alho', weight:700, currentSupplierCost:14.86, displayOrder:19, image:'vila-santa-parrilla-alho-700.png' }),
  base({ productId:'prd_vila_santa_parrilla_chimichurri_700', supplierCode:'00014579', boxGtin:'17898593255774', gtin:'7898593255777', name:'Sal Rosa do Himalaia Parrilla com Chimichurri 700g', brand:'Vila Santa', category:'Bem-estar e Nutrição', subcategory:'Temperos', flavor:'Chimichurri', weight:700, currentSupplierCost:14.12, displayOrder:20, image:'vila-santa-parrilla-chimichurri-700.png' }),
  base({ productId:'prd_maxinutri_dimag_400_60', supplierCode:'00011517', gtin:null, gtinCandidate:'7898593050680', boxGtinCandidate:'17898593050687', name:'DIMAG Di-Magnésio Malato 400mg 60 cápsulas', brand:'Maxinutri', category:'Bem-estar e Nutrição', subcategory:'Vitaminas e Minerais', package:'60 cápsulas', currentSupplierCost:30.69, displayOrder:21, image:'maxinutri-dimag-400-60.png' }),
];

const comingSoon = (data: { productId: string; name: string; category: 'Vestuário' | 'Acessórios'; subcategory: string; displayOrder: number; imageSlug: string }): CatalogueSeed => ({
  productId: data.productId, productStatus: 'COMING_SOON', developmentStatus: 'PRODUCT_DEVELOPMENT_PENDING',
  supplierId: null, supplierCode: null, supplierSku: null, supplierName: null, gtin: null, gtinCandidate: null, boxGtin: null, boxGtinCandidate: null,
  barcodeType: null, name: data.name, brand: 'Invictus Performance', category: data.category,
  subcategory: data.subcategory, flavor: null, weight: null, weightUnit: null, package: null,
  supplierDescription: null, publicDescription: null, supplierClaims: [], publicHighlights: [],
  regularSupplierCost: null, currentSupplierCost: null, minimumOrderQuantity: null, leadTime: null,
  promotionMinimumQuantity: null, promotionStartAt: null, promotionEndAt: null, availability: null,
  lastCostUpdate: null, currency: 'BRL', active: true, storeVisible: true, published: true,
  displayOrder: data.displayOrder, canPurchaseWithMoney: false, canRedeemWithCoins: false,
  canUseCoinsPlusMoney: false, coinPrice: null, cashTopUp: null, commercialStock: 0, dropStock: 0,
  reservedCommercialStock: 0, reservedDropStock: 0,
  images: { primary: `/assets/store/products/own-brand/${data.imageSlug}.png`, thumbnail: `/assets/store/products/own-brand/${data.imageSlug}.png`, gallery: [] },
  imageStatus: 'READY',
  adminPending: ['FORNECEDOR', 'CUSTO', 'PREÇO', 'ESTOQUE', 'EAN/SKU', 'PRECIFICAÇÃO'],
  shippingWeight: null, shippingWeightUnit: null, packageLengthCm: null, packageWidthCm: null,
  packageHeightCm: null, pricing: pricing(null),
});

export const INVICTUS_COMING_SOON_CATALOGUE: CatalogueSeed[] = [
  comingSoon({ productId: 'prd_invictus_moletom', name: 'Moletom Invictus Performance', category: 'Vestuário', subcategory: 'Moletom', displayOrder: 22, imageSlug: 'moletom-invictus' }),
  comingSoon({ productId: 'prd_invictus_regata', name: 'Regata Invictus Performance', category: 'Vestuário', subcategory: 'Regata', displayOrder: 23, imageSlug: 'regata-invictus' }),
  comingSoon({ productId: 'prd_invictus_camiseta', name: 'Camiseta Invictus Performance', category: 'Vestuário', subcategory: 'Camiseta', displayOrder: 24, imageSlug: 'camiseta-invictus' }),
  comingSoon({ productId: 'prd_invictus_calca_moletom', name: 'Calça de Moletom Invictus Performance', category: 'Vestuário', subcategory: 'Calça', displayOrder: 25, imageSlug: 'calca-moletom-invictus' }),
  comingSoon({ productId: 'prd_invictus_strap', name: 'Strap Invictus Performance', category: 'Acessórios', subcategory: 'Strap', displayOrder: 26, imageSlug: 'strap-invictus' }),
  comingSoon({ productId: 'prd_invictus_cinta_treino', name: 'Cinta de Treino Invictus Performance', category: 'Acessórios', subcategory: 'Cinta de treino', displayOrder: 27, imageSlug: 'cinta-invictus' }),
  comingSoon({ productId: 'prd_invictus_coqueteleira', name: 'Coqueteleira Invictus Performance', category: 'Acessórios', subcategory: 'Coqueteleira', displayOrder: 28, imageSlug: 'coqueteleira-invictus' }),
  comingSoon({ productId: 'prd_invictus_munhequeira', name: 'Munhequeira Invictus Performance', category: 'Acessórios', subcategory: 'Munhequeira', displayOrder: 29, imageSlug: 'munhequeira-invictus' }),
  comingSoon({ productId: 'prd_invictus_bone', name: 'Boné Invictus Performance', category: 'Acessórios', subcategory: 'Boné', displayOrder: 30, imageSlug: 'bone-invictus' }),
  comingSoon({ productId: 'prd_invictus_meia', name: 'Meia Invictus Performance', category: 'Acessórios', subcategory: 'Meia', displayOrder: 31, imageSlug: 'meia-invictus' }),
];

export const STORE_CATALOGUE: CatalogueSeed[] = [...REAL_STORE_CATALOGUE, ...INVICTUS_COMING_SOON_CATALOGUE];

export function materializeCatalogue(now = new Date().toISOString()): PhysicalProduct[] {
  return STORE_CATALOGUE.map(product => ({ ...product, createdAt: now, updatedAt: now }));
}
