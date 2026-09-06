import {
  createRevenueCatClient,
  type RevenueCatCustomerInfoLike,
  type RevenueCatPackageLike,
  type RevenueCatSdkLike,
  type RevenueCatStoreConfiguration,
} from './revenuecat-core';

const NOW = Date.parse('2026-09-06T12:00:00.000Z');
const FUTURE = '2026-10-06T12:00:00.000Z';

function aPackage(
  identifier: string,
  productIdentifier: string,
  priceString = 'R$ 29,90',
  currencyCode = 'BRL',
  subscriptionPeriod = 'P1M'
): RevenueCatPackageLike {
  return {
    identifier,
    product: {
      identifier: productIdentifier,
      price: 29.9,
      priceString,
      currencyCode,
      subscriptionPeriod,
    },
  };
}

function customerInfo(productIdentifier: string): RevenueCatCustomerInfoLike {
  return {
    entitlements: {
      active: {
        performance: {
          isActive: true,
          productIdentifier,
          expirationDate: FUTURE,
          expirationDateMillis: Date.parse(FUTURE),
        },
      },
    },
  };
}

function setup(configurationOverrides: Partial<RevenueCatStoreConfiguration> = {}) {
  let configured = false;
  let currentUser = '';
  let packages = [
    aPackage('$rc_annual', 'performance.annual', 'US$ 99.99', 'USD', 'P1Y'),
    aPackage('$rc_monthly', 'performance.monthly'),
  ];

  const sdk: jest.Mocked<RevenueCatSdkLike> = {
    isConfigured: jest.fn(async () => ({ isConfigured: configured })),
    setLogLevel: jest.fn(async (_options: { level: unknown }) => undefined),
    configure: jest.fn(async ({ appUserID }) => { configured = true; currentUser = appUserID; }),
    getAppUserID: jest.fn(async () => ({ appUserID: currentUser })),
    logIn: jest.fn(async ({ appUserID }) => { currentUser = appUserID; return {}; }),
    logOut: jest.fn(async () => { currentUser = '$RCAnonymousID:generated'; return {}; }),
    getOfferings: jest.fn(async () => ({ current: { availablePackages: packages } })),
    purchasePackage: jest.fn(async ({ aPackage: selected }) => ({ customerInfo: customerInfo(selected.product.identifier) })),
    restorePurchases: jest.fn(async () => ({ customerInfo: customerInfo('performance.monthly') })),
  };
  const configuration: RevenueCatStoreConfiguration = {
    apiKey: 'public-android-key',
    packageIdentifier: '$rc_monthly',
    productIdentifier: 'performance.monthly',
    ...configurationOverrides,
  };
  const client = createRevenueCatClient({
    sdk,
    isNativePlatform: () => true,
    getPlatform: () => 'android',
    getStoreConfiguration: () => configuration,
    logLevel: 'WARN',
    now: () => NOW,
  });

  return {
    client,
    sdk,
    setPackages: (next: RevenueCatPackageLike[]) => { packages = next; },
    setCurrentUser: (uid: string) => { configured = true; currentUser = uid; },
    getCurrentUser: () => currentUser,
  };
}

describe('RevenueCat client serializado', () => {
  test('primeira oferta configura o UID e seleciona o pacote explícito, não o índice zero', async () => {
    const { client, sdk } = setup();

    await expect(client.getPerformanceSubscriptionOffer('user-A')).resolves.toEqual({
      packageIdentifier: '$rc_monthly',
      productIdentifier: 'performance.monthly',
      price: 29.9,
      priceString: 'R$ 29,90',
      currencyCode: 'BRL',
      subscriptionPeriod: 'P1M',
    });
    expect(sdk.configure).toHaveBeenCalledWith({ apiKey: 'public-android-key', appUserID: 'user-A' });
    expect(sdk.getOfferings).toHaveBeenCalledTimes(1);
  });

  test('falha antes de tocar no SDK quando package e product IDs não foram configurados', async () => {
    const { client, sdk } = setup({ packageIdentifier: '', productIdentifier: '' });

    await expect(client.getPerformanceSubscriptionOffer('user-A')).rejects.toThrow('package ID ou product ID');
    expect(sdk.isConfigured).not.toHaveBeenCalled();
    expect(sdk.getOfferings).not.toHaveBeenCalled();
  });

  test('troca A para B usa logIn direto e termina vinculada a B', async () => {
    const { client, sdk, setCurrentUser, getCurrentUser } = setup();
    setCurrentUser('user-A');

    await client.getPerformanceSubscriptionOffer('user-A');
    await client.getPerformanceSubscriptionOffer('user-B');

    expect(sdk.logOut).not.toHaveBeenCalled();
    expect(sdk.logIn).toHaveBeenCalledWith({ appUserID: 'user-B' });
    expect(getCurrentUser()).toBe('user-B');
  });

  test('logout lógico aguarda a compra, mantém A e o próximo login troca diretamente para B', async () => {
    const { client, sdk, setCurrentUser, getCurrentUser } = setup();
    setCurrentUser('user-A');
    let releasePurchase!: () => void;
    const purchaseGate = new Promise<void>((resolve) => { releasePurchase = resolve; });
    sdk.purchasePackage.mockImplementationOnce(async ({ aPackage: selected }) => {
      await purchaseGate;
      return { customerInfo: customerInfo(selected.product.identifier) };
    });

    const purchase = client.purchasePerformanceSubscription('user-A');
    while (sdk.purchasePackage.mock.calls.length === 0) await Promise.resolve();
    const disconnect = client.disconnectRevenueCat();
    await Promise.resolve();
    expect(sdk.logOut).not.toHaveBeenCalled();

    releasePurchase();
    await expect(purchase).resolves.toMatchObject({ active: true, productIdentifier: 'performance.monthly' });
    await disconnect;
    expect(sdk.logOut).not.toHaveBeenCalled();
    expect(getCurrentUser()).toBe('user-A');

    await client.getPerformanceSubscriptionOffer('user-B');
    expect(sdk.logIn).toHaveBeenCalledWith({ appUserID: 'user-B' });
    expect(getCurrentUser()).toBe('user-B');
  });

  test('verifica o mesmo UID imediatamente depois da compra e falha fechado se o SDK mudou', async () => {
    const { client, sdk, setCurrentUser } = setup();
    setCurrentUser('user-A');
    sdk.purchasePackage.mockImplementationOnce(async ({ aPackage: selected }) => {
      setCurrentUser('user-B');
      return { customerInfo: customerInfo(selected.product.identifier) };
    });

    await expect(client.purchasePerformanceSubscription('user-A')).rejects.toThrow('identidade da loja mudou');
  });

  test('valida que o package ID contém exatamente o product ID configurado', async () => {
    const { client, sdk } = setup({ productIdentifier: 'different-product' });

    await expect(client.purchasePerformanceSubscription('user-A')).rejects.toThrow('não contém o produto Performance esperado');
    expect(sdk.purchasePackage).not.toHaveBeenCalled();
  });

  test('restore é serializado, verifica produto/expiração e não chama purchasePackage', async () => {
    const { client, sdk } = setup();

    await expect(client.restorePerformanceSubscription('user-A')).resolves.toEqual({
      active: true,
      productIdentifier: 'performance.monthly',
      expiresAt: FUTURE,
    });
    expect(sdk.restorePurchases).toHaveBeenCalledTimes(1);
    expect(sdk.getOfferings).not.toHaveBeenCalled();
    expect(sdk.purchasePackage).not.toHaveBeenCalled();
  });

  test('restore aceita SKU Performance legado fora da oferta atual e devolve o ID real', async () => {
    const { client, sdk } = setup();
    sdk.restorePurchases.mockResolvedValueOnce({
      customerInfo: customerInfo('performance.legacy.annual'),
    });

    await expect(client.restorePerformanceSubscription('user-A')).resolves.toEqual({
      active: true,
      productIdentifier: 'performance.legacy.annual',
      expiresAt: FUTURE,
    });
    expect(sdk.getOfferings).not.toHaveBeenCalled();
  });

  test('restore não depende do package/product atuais quando a chave da plataforma existe', async () => {
    const { client, sdk } = setup({ packageIdentifier: '', productIdentifier: '' });

    await expect(client.restorePerformanceSubscription('user-A')).resolves.toMatchObject({
      active: true,
      productIdentifier: 'performance.monthly',
    });
    expect(sdk.restorePurchases).toHaveBeenCalledTimes(1);
    expect(sdk.getOfferings).not.toHaveBeenCalled();
  });

  test('configure no navegador é no-op e oferta permanece exclusivamente nativa', async () => {
    const { sdk } = setup();
    const webClient = createRevenueCatClient({
      sdk,
      isNativePlatform: () => false,
      getPlatform: () => 'web',
      getStoreConfiguration: () => ({ apiKey: '', packageIdentifier: '', productIdentifier: '' }),
      logLevel: 'WARN',
    });

    await expect(webClient.configureRevenueCat('user-A')).resolves.toBeUndefined();
    await expect(webClient.getPerformanceSubscriptionOffer('user-A')).rejects.toThrow('aplicativo instalado');
    expect(sdk.isConfigured).not.toHaveBeenCalled();
  });
});
