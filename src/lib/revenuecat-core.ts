export const PERFORMANCE_ENTITLEMENT_ID = 'invictus_performance_pro';

export interface PerformanceSubscriptionOffer {
  packageIdentifier: string;
  productIdentifier: string;
  price: number;
  priceString: string;
  currencyCode: string;
  subscriptionPeriod: string | null;
}

export interface PerformancePurchaseResult {
  active: boolean;
  productIdentifier: string;
  expiresAt: string;
}

export interface RevenueCatStoreProductLike {
  identifier: string;
  price: number;
  priceString: string;
  currencyCode: string;
  subscriptionPeriod: string | null;
}

export interface RevenueCatPackageLike {
  identifier: string;
  product: RevenueCatStoreProductLike;
}

export interface RevenueCatCustomerInfoLike {
  entitlements: {
    active: Record<string, {
      isActive: boolean;
      productIdentifier: string;
      expirationDate: string | null;
      expirationDateMillis: number | null;
    }>;
  };
}

export interface RevenueCatSdkLike {
  isConfigured(): Promise<{ isConfigured: boolean }>;
  setLogLevel(options: { level: unknown }): Promise<void>;
  configure(options: { apiKey: string; appUserID: string }): Promise<void>;
  getAppUserID(): Promise<{ appUserID: string }>;
  logIn(options: { appUserID: string }): Promise<unknown>;
  logOut(): Promise<unknown>;
  getOfferings(): Promise<{
    current: { availablePackages: RevenueCatPackageLike[] } | null;
  }>;
  getProducts(options: { productIdentifiers: string[] }): Promise<{
    products: RevenueCatStoreProductLike[];
  }>;
  purchasePackage(options: { aPackage: RevenueCatPackageLike }): Promise<{
    customerInfo: RevenueCatCustomerInfoLike;
  }>;
  purchaseStoreProduct(options: { product: RevenueCatStoreProductLike }): Promise<{
    customerInfo: RevenueCatCustomerInfoLike;
  }>;
  restorePurchases(): Promise<{ customerInfo: RevenueCatCustomerInfoLike }>;
}

export interface RevenueCatStoreConfiguration {
  apiKey: string;
  packageIdentifier: string;
  productIdentifier: string;
}

interface RevenueCatClientOptions {
  sdk: RevenueCatSdkLike;
  isNativePlatform: () => boolean;
  getPlatform: () => string;
  getStoreConfiguration: (platform: string) => RevenueCatStoreConfiguration;
  logLevel: unknown;
  now?: () => number;
}

type PurchaseTarget =
  | { kind: 'package'; aPackage: RevenueCatPackageLike }
  | { kind: 'product'; product: RevenueCatStoreProductLike };

function nativeOnlyError(): Error {
  return new Error('A assinatura do Plano Performance só pode ser gerenciada pelo aplicativo instalado (Android ou iOS).');
}

/**
 * Wrapper serializado do SDK. A fila protege configure/login, consulta da loja,
 * compra e restore para impedir troca de identidade no meio de uma operação.
 */
export function createRevenueCatClient(options: RevenueCatClientOptions) {
  let sdkQueue: Promise<void> = Promise.resolve();
  const now = options.now || (() => Date.now());

  function enqueueSdkOperation<T>(operation: () => Promise<T>): Promise<T> {
    const queued = sdkQueue.then(operation, operation);
    sdkQueue = queued.then(() => undefined, () => undefined);
    return queued;
  }

  function nativePlatform(): string {
    if (!options.isNativePlatform()) throw nativeOnlyError();
    const platform = options.getPlatform();
    if (platform !== 'android' && platform !== 'ios') throw nativeOnlyError();
    return platform;
  }

  function checkedUid(firebaseUid: string): string {
    const uid = firebaseUid.trim();
    if (!uid) throw new Error('Não foi possível vincular a compra: usuário não autenticado.');
    return uid;
  }

  function storeConfiguration(platform: string, requireProduct: boolean): RevenueCatStoreConfiguration {
    const configuration = options.getStoreConfiguration(platform);
    if (!configuration.apiKey) {
      throw new Error('Compras indisponíveis: a chave da RevenueCat não está configurada para esta plataforma.');
    }
    if (requireProduct && !configuration.packageIdentifier && !configuration.productIdentifier) {
      throw new Error('Compras indisponíveis: configure explicitamente o package ID ou product ID do Plano Performance.');
    }
    return configuration;
  }

  async function assertSdkUser(uid: string): Promise<void> {
    const { appUserID } = await options.sdk.getAppUserID();
    if (appUserID !== uid) {
      throw new Error('A identidade da loja mudou durante a operação. Nenhuma confirmação de benefício foi enviada.');
    }
  }

  async function ensureSdkUser(uid: string, configuration: RevenueCatStoreConfiguration): Promise<void> {
    const state = await options.sdk.isConfigured();
    if (!state.isConfigured) {
      await options.sdk.setLogLevel({ level: options.logLevel });
      await options.sdk.configure({ apiKey: configuration.apiKey, appUserID: uid });
    } else {
      const { appUserID } = await options.sdk.getAppUserID();
      if (appUserID !== uid) {
        await options.sdk.logIn({ appUserID: uid });
      }
    }
    await assertSdkUser(uid);
  }

  function selectPerformancePackage(
    packages: RevenueCatPackageLike[],
    configuration: RevenueCatStoreConfiguration
  ): RevenueCatPackageLike {
    let selected: RevenueCatPackageLike | undefined;
    if (configuration.packageIdentifier) {
      selected = packages.find((candidate) => candidate.identifier === configuration.packageIdentifier);
    } else if (configuration.productIdentifier) {
      selected = packages.find((candidate) => candidate.product.identifier === configuration.productIdentifier);
    }

    if (!selected) {
      throw new Error('O plano Pro não foi encontrado na offering atual da loja.');
    }
    if (configuration.productIdentifier && selected.product.identifier !== configuration.productIdentifier) {
      throw new Error(`O pacote ${selected.identifier} não contém o produto Performance esperado (${configuration.productIdentifier}).`);
    }
    return selected;
  }

  async function loadDirectProduct(configuration: RevenueCatStoreConfiguration): Promise<RevenueCatStoreProductLike> {
    const productIdentifier = configuration.productIdentifier.trim();
    if (!productIdentifier) {
      throw new Error('A offering atual não está disponível e nenhum product ID do Plano Performance foi configurado para fallback.');
    }
    const { products } = await options.sdk.getProducts({ productIdentifiers: [productIdentifier] });
    const selected = products.find((product) => product.identifier === productIdentifier) || products[0];
    if (!selected) {
      throw new Error(`O produto Performance configurado (${productIdentifier}) não está disponível na loja.`);
    }
    if (selected.identifier !== productIdentifier) {
      throw new Error(`A loja devolveu um produto diferente do Performance esperado (${productIdentifier}).`);
    }
    return selected;
  }

  async function loadPurchaseTarget(configuration: RevenueCatStoreConfiguration): Promise<PurchaseTarget> {
    try {
      const offerings = await options.sdk.getOfferings();
      if (offerings.current) {
        try {
          return { kind: 'package', aPackage: selectPerformancePackage(offerings.current.availablePackages, configuration) };
        } catch (offeringSelectionError) {
          if (!configuration.productIdentifier) throw offeringSelectionError;
        }
      } else if (!configuration.productIdentifier) {
        throw new Error('Nenhuma offering atual está disponível para o Plano Performance.');
      }
    } catch (offeringError) {
      if (!configuration.productIdentifier) throw offeringError;
    }

    return { kind: 'product', product: await loadDirectProduct(configuration) };
  }

  function toOffer(target: PurchaseTarget): PerformanceSubscriptionOffer {
    const product = target.kind === 'package' ? target.aPackage.product : target.product;
    return {
      packageIdentifier: target.kind === 'package' ? target.aPackage.identifier : '',
      productIdentifier: product.identifier,
      price: product.price,
      priceString: product.priceString,
      currencyCode: product.currencyCode,
      subscriptionPeriod: product.subscriptionPeriod,
    };
  }

  function toPurchaseResult(
    customerInfo: RevenueCatCustomerInfoLike,
    expectedProductId?: string
  ): PerformancePurchaseResult {
    const entitlement = customerInfo.entitlements.active[PERFORMANCE_ENTITLEMENT_ID];
    const active = Boolean(
      entitlement?.isActive
        && entitlement.productIdentifier
        && (!expectedProductId || entitlement.productIdentifier === expectedProductId)
        && entitlement.expirationDate
        && entitlement.expirationDateMillis !== null
        && Number.isFinite(entitlement.expirationDateMillis)
        && entitlement.expirationDateMillis > now()
    );
    if (!active || !entitlement?.expirationDate) {
      throw new Error('A loja processou a operação, mas não confirmou uma assinatura Performance vigente para o produto selecionado. Tente novamente em instantes.');
    }
    return {
      active: true,
      productIdentifier: entitlement.productIdentifier,
      expiresAt: entitlement.expirationDate,
    };
  }

  async function configureRevenueCat(firebaseUid: string): Promise<void> {
    if (!options.isNativePlatform()) return;
    const uid = checkedUid(firebaseUid);
    const platform = nativePlatform();
    const configuration = storeConfiguration(platform, false);
    return enqueueSdkOperation(() => ensureSdkUser(uid, configuration));
  }

  async function getPerformanceSubscriptionOffer(firebaseUid: string): Promise<PerformanceSubscriptionOffer> {
    const uid = checkedUid(firebaseUid);
    const platform = nativePlatform();
    const configuration = storeConfiguration(platform, true);
    return enqueueSdkOperation(async () => {
      await ensureSdkUser(uid, configuration);
      const target = await loadPurchaseTarget(configuration);
      await assertSdkUser(uid);
      return toOffer(target);
    });
  }

  async function purchasePerformanceSubscription(firebaseUid: string): Promise<PerformancePurchaseResult> {
    const uid = checkedUid(firebaseUid);
    const platform = nativePlatform();
    const configuration = storeConfiguration(platform, true);
    return enqueueSdkOperation(async () => {
      await ensureSdkUser(uid, configuration);
      const target = await loadPurchaseTarget(configuration);
      await assertSdkUser(uid);
      const productIdentifier = target.kind === 'package'
        ? target.aPackage.product.identifier
        : target.product.identifier;
      const { customerInfo } = target.kind === 'package'
        ? await options.sdk.purchasePackage({ aPackage: target.aPackage })
        : await options.sdk.purchaseStoreProduct({ product: target.product });
      await assertSdkUser(uid);
      return toPurchaseResult(customerInfo, productIdentifier);
    });
  }

  async function restorePerformanceSubscription(firebaseUid: string): Promise<PerformancePurchaseResult> {
    const uid = checkedUid(firebaseUid);
    const platform = nativePlatform();
    const configuration = storeConfiguration(platform, false);
    return enqueueSdkOperation(async () => {
      await ensureSdkUser(uid, configuration);
      const { customerInfo } = await options.sdk.restorePurchases();
      await assertSdkUser(uid);
      return toPurchaseResult(customerInfo);
    });
  }

  async function disconnectRevenueCat(): Promise<void> {
    if (!options.isNativePlatform()) return;
    return enqueueSdkOperation(async () => undefined);
  }

  return {
    configureRevenueCat,
    getPerformanceSubscriptionOffer,
    purchasePerformanceSubscription,
    restorePerformanceSubscription,
    disconnectRevenueCat,
  };
}
