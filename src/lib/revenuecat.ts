import { Capacitor } from '@capacitor/core';
import {
  Purchases,
  LOG_LEVEL,
  PRODUCT_CATEGORY,
  type CustomerInfo,
  type PurchasesPackage,
  type PurchasesStoreProduct,
} from '@revenuecat/purchases-capacitor';
import {
  createRevenueCatClient,
  PERFORMANCE_ENTITLEMENT_ID,
  type PerformancePurchaseResult,
  type PerformanceSubscriptionOffer,
  type RevenueCatCustomerInfoLike,
  type RevenueCatPackageLike,
  type RevenueCatStoreProductLike,
} from './revenuecat-core';

/**
 * Integração nativa RevenueCat do Plano Performance.
 *
 * Configuração obrigatória por build:
 * - VITE_REVENUECAT_ANDROID_API_KEY / VITE_REVENUECAT_IOS_API_KEY
 * - ao menos um package ID ou product ID explícito do Performance. Há versões
 *   globais e opcionais por plataforma para projetos com SKUs diferentes.
 */
const REVENUECAT_ANDROID_API_KEY = import.meta.env.VITE_REVENUECAT_ANDROID_API_KEY || '';
const REVENUECAT_IOS_API_KEY = import.meta.env.VITE_REVENUECAT_IOS_API_KEY || '';
const PERFORMANCE_PACKAGE_ID = (import.meta.env.VITE_REVENUECAT_PERFORMANCE_PACKAGE_ID || '').trim();
const PERFORMANCE_PRODUCT_ID = (import.meta.env.VITE_REVENUECAT_PERFORMANCE_PRODUCT_ID || '').trim();
const ANDROID_PERFORMANCE_PACKAGE_ID = (import.meta.env.VITE_REVENUECAT_ANDROID_PERFORMANCE_PACKAGE_ID || '').trim();
const IOS_PERFORMANCE_PACKAGE_ID = (import.meta.env.VITE_REVENUECAT_IOS_PERFORMANCE_PACKAGE_ID || '').trim();
const ANDROID_PERFORMANCE_PRODUCT_ID = (import.meta.env.VITE_REVENUECAT_ANDROID_PERFORMANCE_PRODUCT_ID || '').trim();
const IOS_PERFORMANCE_PRODUCT_ID = (import.meta.env.VITE_REVENUECAT_IOS_PERFORMANCE_PRODUCT_ID || '').trim();

export { PERFORMANCE_ENTITLEMENT_ID };
export type { PerformancePurchaseResult, PerformanceSubscriptionOffer };

const revenueCatClient = createRevenueCatClient({
  sdk: {
    isConfigured: () => Purchases.isConfigured(),
    setLogLevel: ({ level }) => Purchases.setLogLevel({ level: level as LOG_LEVEL }),
    configure: (configuration) => Purchases.configure(configuration),
    getAppUserID: () => Purchases.getAppUserID(),
    logIn: (identity) => Purchases.logIn(identity),
    logOut: () => Purchases.logOut(),
    getOfferings: async () => {
      const offerings = await Purchases.getOfferings();
      return {
        current: offerings.current
          ? { availablePackages: offerings.current.availablePackages as RevenueCatPackageLike[] }
          : null,
      };
    },
    getProducts: async ({ productIdentifiers }) => {
      const result = await Purchases.getProducts({
        productIdentifiers,
        type: PRODUCT_CATEGORY.SUBSCRIPTION,
      });
      return { products: result.products as RevenueCatStoreProductLike[] };
    },
    purchasePackage: async ({ aPackage }) => {
      const result = await Purchases.purchasePackage({ aPackage: aPackage as PurchasesPackage });
      return { customerInfo: result.customerInfo as RevenueCatCustomerInfoLike };
    },
    purchaseStoreProduct: async ({ product }) => {
      const result = await Purchases.purchaseStoreProduct({ product: product as PurchasesStoreProduct });
      return { customerInfo: result.customerInfo as RevenueCatCustomerInfoLike };
    },
    restorePurchases: async () => {
      const result = await Purchases.restorePurchases();
      return { customerInfo: result.customerInfo as CustomerInfo as RevenueCatCustomerInfoLike };
    },
  },
  isNativePlatform: () => Capacitor.isNativePlatform(),
  getPlatform: () => Capacitor.getPlatform(),
  getStoreConfiguration: (platform) => {
    const productIdentifier = platform === 'ios'
      ? IOS_PERFORMANCE_PRODUCT_ID || PERFORMANCE_PRODUCT_ID
      : ANDROID_PERFORMANCE_PRODUCT_ID || PERFORMANCE_PRODUCT_ID;
    const configuredPackageIdentifier = platform === 'ios'
      ? IOS_PERFORMANCE_PACKAGE_ID || PERFORMANCE_PACKAGE_ID
      : ANDROID_PERFORMANCE_PACKAGE_ID || PERFORMANCE_PACKAGE_ID;

    return {
      apiKey: platform === 'ios' ? REVENUECAT_IOS_API_KEY : REVENUECAT_ANDROID_API_KEY,
      packageIdentifier: productIdentifier ? '' : configuredPackageIdentifier,
      productIdentifier,
    };
  },
  logLevel: LOG_LEVEL.WARN,
});

/** Vincula o Firebase UID ao SDK. */
export const configureRevenueCat = revenueCatClient.configureRevenueCat;

/** Retorna preço/período do plano via offering ou, se necessário, pelo SKU direto da loja. */
export const getPerformanceSubscriptionOffer = revenueCatClient.getPerformanceSubscriptionOffer;

/** Compra o plano pela offering atual ou diretamente pelo SKU configurado como fallback. */
export const purchasePerformanceSubscription = revenueCatClient.purchasePerformanceSubscription;

/** Restauração explícita acionada pelo usuário. */
export const restorePerformanceSubscription = revenueCatClient.restorePerformanceSubscription;

/** Drena operações no logout; não cria identidade anônima no SDK. */
export const disconnectRevenueCat = revenueCatClient.disconnectRevenueCat;
