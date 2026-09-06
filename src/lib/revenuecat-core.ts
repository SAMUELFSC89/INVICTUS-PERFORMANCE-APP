export const PERFORMANCE_ENTITLEMENT_ID = 'performance';

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

export interface RevenueCatPackageLike {
  identifier: string;
  product: {
    identifier: string;
    price: number;
    priceString: string;
    currencyCode: string;
    subscriptionPeriod: string | null;
  };
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
  purchasePackage(options: { aPackage: RevenueCatPackageLike }): Promise<{
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

function nativeOnlyError(): Error {
  return new Error('A assinatura do Plano Performance só pode ser gerenciada pelo aplicativo instalado (Android ou iOS).');
}

/**
 * Wrapper serializado do SDK. A fila não protege apenas configure/logIn: ela
 * inclui getOfferings, purchase e restore, impedindo logout/troca de UID no
 * meio de uma operação de loja.
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
        // Troca direta é a recomendação da RevenueCat: logOut antes criaria um
        // usuário anônimo intermediário capaz de receber a compra.
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
      if (!selected) {
        throw new Error(`O pacote Performance configurado (${configuration.packageIdentifier}) não está disponível nesta loja.`);
      }
    } else {
      selected = packages.find((candidate) => candidate.product.identifier === configuration.productIdentifier);
      if (!selected) {
        throw new Error(`O produto Performance configurado (${configuration.productIdentifier}) não está disponível nesta loja.`);
      }
    }

    if (configuration.productIdentifier && selected.product.identifier !== configuration.productIdentifier) {
      throw new Error(`O pacote ${selected.identifier} não contém o produto Performance esperado (${configuration.productIdentifier}).`);
    }
    return selected;
  }

  async function loadPackage(
    configuration: RevenueCatStoreConfiguration
  ): Promise<RevenueCatPackageLike> {
    const offerings = await options.sdk.getOfferings();
    if (!offerings.current) {
      throw new Error('Nenhuma oferta de assinatura está disponível no momento. Tente novamente mais tarde.');
    }
    return selectPerformancePackage(offerings.current.availablePackages, configuration);
  }

  function toOffer(aPackage: RevenueCatPackageLike): PerformanceSubscriptionOffer {
    return {
      packageIdentifier: aPackage.identifier,
      productIdentifier: aPackage.product.identifier,
      price: aPackage.product.price,
      priceString: aPackage.product.priceString,
      currencyCode: aPackage.product.currencyCode,
      subscriptionPeriod: aPackage.product.subscriptionPeriod,
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
      const selected = await loadPackage(configuration);
      await assertSdkUser(uid);
      return toOffer(selected);
    });
  }

  async function purchasePerformanceSubscription(firebaseUid: string): Promise<PerformancePurchaseResult> {
    const uid = checkedUid(firebaseUid);
    const platform = nativePlatform();
    const configuration = storeConfiguration(platform, true);
    return enqueueSdkOperation(async () => {
      await ensureSdkUser(uid, configuration);
      const selected = await loadPackage(configuration);
      await assertSdkUser(uid);
      const { customerInfo } = await options.sdk.purchasePackage({ aPackage: selected });
      await assertSdkUser(uid);
      return toPurchaseResult(customerInfo, selected.product.identifier);
    });
  }

  async function restorePerformanceSubscription(firebaseUid: string): Promise<PerformancePurchaseResult> {
    const uid = checkedUid(firebaseUid);
    const platform = nativePlatform();
    // Restore só precisa da chave da plataforma. Package/product atuais podem
    // ter sido removidos da offering enquanto um SKU legado segue válido.
    const configuration = storeConfiguration(platform, false);
    return enqueueSdkOperation(async () => {
      await ensureSdkUser(uid, configuration);
      const { customerInfo } = await options.sdk.restorePurchases();
      await assertSdkUser(uid);
      // Restore pode devolver um SKU antigo que não faz mais parte da oferta
      // atual. O cliente valida apenas a entitlement Performance vigente; o
      // backend valida o productIdentifier real contra sua allowlist.
      return toPurchaseResult(customerInfo);
    });
  }

  async function disconnectRevenueCat(): Promise<void> {
    if (!options.isNativePlatform()) return;
    // Este app usa exclusivamente Firebase UIDs próprios. `logOut()` criaria
    // um `$RCAnonymousID` capaz de receber/transferir o recibo entre sessões.
    // Enfileirar um no-op drena operações em voo; o próximo login troca A→B
    // diretamente via `logIn({ appUserID: B })`.
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
