import verifyPurchaseHandler from '../_handlers/payments-verify-purchase';
import { db, verifyAuth } from '../_lib/common';
import {
  activateOpenPlan,
  fetchRevenueCatPerformanceEntitlement,
  grantProAccessAfterApprovedPayment,
  logPaymentAudit,
  revokeProAccess,
} from '../_lib/payments-service';

jest.mock('../_lib/common', () => ({
  db: { collection: jest.fn(), runTransaction: jest.fn() },
  cors: jest.fn(() => false),
  verifyAuth: jest.fn(),
}));
jest.mock('../_lib/payments-service', () => ({
  BillingUserUnavailableError: class BillingUserUnavailableError extends Error {
    code = 'BILLING_USER_UNAVAILABLE';
    constructor(public userId: string) { super(`missing ${userId}`); }
  },
  activateOpenPlan: jest.fn(),
  fetchRevenueCatPerformanceEntitlement: jest.fn(),
  grantProAccessAfterApprovedPayment: jest.fn(),
  isBillingUserProfileAvailable: jest.fn((profile: any) => Boolean(profile) && profile.deleted !== true),
  isBillingUserUnavailableError: jest.fn((error: any) => error?.code === 'BILLING_USER_UNAVAILABLE'),
  isRevenueCatEnvironmentAllowed: jest.fn((environment: unknown) => {
    const configured = (process.env.REVENUECAT_ALLOWED_ENVIRONMENTS || 'PRODUCTION')
      .split(',').map((value) => value.trim().toUpperCase());
    return typeof environment === 'string' && configured.includes(environment.toUpperCase());
  }),
  logPaymentAudit: jest.fn(),
  revokeProAccess: jest.fn(),
}));

type Stored = Record<string, any>;
let store: Map<string, Stored>;

function snapshot(value: Stored | undefined) {
  return { exists: value !== undefined, data: () => value };
}

function response() {
  const res: any = {
    statusCode: 0,
    body: undefined,
    status: jest.fn((code: number) => { res.statusCode = code; return res; }),
    json: jest.fn((body: any) => { res.body = body; return res; }),
  };
  return res;
}

function request(body: Record<string, unknown>) {
  return { method: 'POST', headers: { authorization: 'Bearer token' }, body } as any;
}

const activeSnapshot = {
  active: true,
  status: 'active',
  productId: 'invictus.performance.monthly',
  purchasedAt: '2026-09-01T00:00:00.000Z',
  expiresAt: '2026-10-01T00:00:00.000Z',
  gracePeriodExpiresAt: null,
  providerObservedAt: '2026-09-06T12:00:00.000Z',
  transactionId: 'real-store-transaction',
  store: 'PLAY_STORE',
  environment: 'PRODUCTION',
  periodType: 'NORMAL',
  willRenew: true,
};

function canonicalPro(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    entitlementId: 'performance',
    tier: 'performance',
    provider: 'revenuecat',
    status: 'active',
    productId: 'invictus.performance.monthly',
    providerObservedAt: '2026-09-06T12:00:00.000Z',
    expiresAt: '2026-11-01T00:00:00.000Z',
    ...overrides,
  };
}

function installDbMock() {
  (db.collection as jest.Mock).mockImplementation((collection: string) => ({
    doc: (id: string) => {
      const key = `${collection}/${id}`;
      return {
        key,
        get: async () => snapshot(store.get(key)),
        set: async (data: Stored, options?: { merge?: boolean }) => {
          store.set(key, options?.merge ? { ...(store.get(key) || {}), ...data } : { ...data });
        },
      };
    },
  }));
  (db.runTransaction as jest.Mock).mockImplementation(async (callback: (transaction: any) => Promise<any>) => {
    const writes: Array<{ target: any; data: Stored; merge: boolean }> = [];
    const result = await callback({
      get: async (target: any) => snapshot(store.get(target.key)),
      set: (target: any, data: Stored, options?: { merge?: boolean }) => {
        writes.push({ target, data, merge: options?.merge === true });
      },
    });
    for (const write of writes) {
      store.set(write.target.key, write.merge
        ? { ...(store.get(write.target.key) || {}), ...write.data }
        : { ...write.data });
    }
    return result;
  });
}

describe('verificação de compra RevenueCat', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-09-06T12:00:00.000Z'));
    delete process.env.REVENUECAT_ALLOWED_ENVIRONMENTS;
    store = new Map([
      ['users/user-A', { subscriptionTier: 'open', status: 'OPEN_ATIVO' }],
    ]);
    installDbMock();
    (verifyAuth as jest.Mock).mockResolvedValue({ uid: 'user-A' });
    (logPaymentAudit as jest.Mock).mockResolvedValue(undefined);
    (activateOpenPlan as jest.Mock).mockResolvedValue({ success: true });
    (grantProAccessAfterApprovedPayment as jest.Mock).mockResolvedValue({ success: true, stale: false });
    (revokeProAccess as jest.Mock).mockResolvedValue({ success: true, stale: false });
    (fetchRevenueCatPerformanceEntitlement as jest.Mock).mockResolvedValue(activeSnapshot);
  });

  afterEach(() => {
    jest.useRealTimers();
    delete process.env.REVENUECAT_ALLOWED_ENVIRONMENTS;
  });

  test('Plano Open usa ativador próprio e nunca chama concessão PRO', async () => {
    const res = response();
    await verifyPurchaseHandler(request({ planId: 'invictus_open' }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ status: 'approved', provisionStatus: 'applied', accessGranted: true });
    expect(activateOpenPlan).toHaveBeenCalledTimes(1);
    expect(grantProAccessAfterApprovedPayment).not.toHaveBeenCalled();
    expect(fetchRevenueCatPerformanceEntitlement).not.toHaveBeenCalled();
    const storedOrder = [...store.entries()].find(([key]) => key.startsWith('payment_orders/order_open_'))?.[1];
    expect(storedOrder).toMatchObject({ amount: 0, provider: 'internal', paymentStatus: 'pending' });
  });

  test('assinatura ativa provisiona dados reais e não inventa preço', async () => {
    const res = response();
    await verifyPurchaseHandler(request({
      planId: 'invictus_performance',
      platform: 'android',
      productId: 'invictus.performance.monthly',
      packageIdentifier: '$rc_monthly',
    }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      status: 'approved', provisionStatus: 'applied', accessGranted: true,
      productId: activeSnapshot.productId, expiresAt: activeSnapshot.expiresAt,
    });
    expect(grantProAccessAfterApprovedPayment).toHaveBeenCalledWith(
      'order_performance_user-A',
      'real-store-transaction',
      'store_android',
      { entitlement: activeSnapshot },
    );
    expect(store.get('payment_orders/order_performance_user-A')).toMatchObject({
      amount: null,
      currency: null,
      requestedProductId: 'invictus.performance.monthly',
      requestedPackageIdentifier: '$rc_monthly',
    });
  });

  test('nova verificação não rebaixa pedido já aprovado para pending', async () => {
    store.set('payment_orders/order_performance_user-A', {
      orderId: 'order_performance_user-A', userId: 'user-A', planId: 'invictus_performance',
      status: 'approved', paymentStatus: 'approved', provisionStatus: 'applied',
    });
    const res = response();
    await verifyPurchaseHandler(request({ planId: 'invictus_performance', platform: 'android' }), res);

    expect(store.get('payment_orders/order_performance_user-A')).toMatchObject({
      status: 'approved', paymentStatus: 'approved', provisionStatus: 'applied',
    });
  });

  test('stale ativo relê perfil canônico novo e confirma acesso', async () => {
    store.set('users/user-A', {
      subscriptionTier: 'performance',
      proEntitlement: canonicalPro({ productId: 'new-product' }),
    });
    store.set('payment_orders/order_performance_user-A', {
      orderId: 'order_performance_user-A', userId: 'user-A', planId: 'invictus_performance',
      paymentStatus: 'approved', provisionStatus: 'applied',
    });
    (grantProAccessAfterApprovedPayment as jest.Mock).mockResolvedValue({ success: true, stale: true });
    const res = response();
    await verifyPurchaseHandler(request({ planId: 'invictus_performance', platform: 'android' }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      accessGranted: true, provisionStatus: 'applied', productId: 'new-product',
    });
  });

  test('snapshot inativo stale respeita revogação canônica nova sem auditoria de rejeição falsa', async () => {
    store.set('users/user-A', {
      subscriptionTier: 'open',
      proEntitlement: canonicalPro({ status: 'expired', expiresAt: '2026-09-01T00:00:00.000Z' }),
    });
    store.set('payment_orders/order_performance_user-A', {
      orderId: 'order_performance_user-A', userId: 'user-A', planId: 'invictus_performance',
      paymentStatus: 'expired', provisionStatus: 'revoked',
    });
    const oldInactive = { ...activeSnapshot, active: false, status: 'inactive' };
    (fetchRevenueCatPerformanceEntitlement as jest.Mock).mockResolvedValue(oldInactive);
    (revokeProAccess as jest.Mock).mockResolvedValue({ success: true, stale: true });
    const res = response();
    await verifyPurchaseHandler(request({ planId: 'invictus_performance', platform: 'android' }), res);

    expect(res.statusCode).toBe(402);
    expect(res.body).toMatchObject({
      code: 'PERFORMANCE_ENTITLEMENT_INACTIVE', entitlementStatus: 'expired', retryable: false,
      accessGranted: false, provisionStatus: 'revoked',
    });
    expect((logPaymentAudit as jest.Mock).mock.calls.some(([entry]) => entry.action === 'payment_rejected')).toBe(false);
  });

  test('snapshot inativo stale relê entitlement canônico ativo mais novo', async () => {
    store.set('users/user-A', {
      subscriptionTier: 'performance',
      proEntitlement: canonicalPro(),
    });
    store.set('payment_orders/order_performance_user-A', {
      orderId: 'order_performance_user-A', userId: 'user-A', planId: 'invictus_performance',
      paymentStatus: 'approved', provisionStatus: 'applied',
    });
    const oldInactive = { ...activeSnapshot, active: false, status: 'inactive' };
    (fetchRevenueCatPerformanceEntitlement as jest.Mock).mockResolvedValue(oldInactive);
    (revokeProAccess as jest.Mock).mockResolvedValue({ success: true, stale: true });
    const res = response();
    await verifyPurchaseHandler(request({ planId: 'invictus_performance', platform: 'android' }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      accessGranted: true, entitlementStatus: 'active', provisionStatus: 'applied',
    });
    expect((logPaymentAudit as jest.Mock).mock.calls.some(([entry]) => entry.action === 'payment_rejected')).toBe(false);
  });

  test('produto diferente do selecionado falha antes do provisionamento', async () => {
    const res = response();
    await verifyPurchaseHandler(request({
      planId: 'invictus_performance', platform: 'ios', productId: 'different-product',
    }), res);

    expect(res.statusCode).toBe(409);
    expect(grantProAccessAfterApprovedPayment).not.toHaveBeenCalled();
    expect(revokeProAccess).not.toHaveBeenCalled();
  });

  test.each([
    ['expired', false],
    ['refunded', false],
    ['inactive', true],
  ])('estado %s retorna contrato terminal/retryable estruturado', async (status, retryable) => {
    const inactive = { ...activeSnapshot, active: false, status };
    (fetchRevenueCatPerformanceEntitlement as jest.Mock).mockResolvedValue(inactive);
    const res = response();
    await verifyPurchaseHandler(request({ planId: 'invictus_performance', platform: 'android' }), res);

    expect(res.statusCode).toBe(402);
    expect(res.body).toMatchObject({
      code: 'PERFORMANCE_ENTITLEMENT_INACTIVE', entitlementStatus: status, retryable, accessGranted: false,
    });
  });

  test('snapshot SANDBOX ativo não provisiona sem opt-in explícito', async () => {
    (fetchRevenueCatPerformanceEntitlement as jest.Mock).mockResolvedValue({
      ...activeSnapshot, environment: 'SANDBOX', active: true,
    });
    const res = response();
    await verifyPurchaseHandler(request({ planId: 'invictus_performance', platform: 'android' }), res);

    expect(res.statusCode).toBe(402);
    expect(res.body).toMatchObject({ entitlementStatus: 'inactive', retryable: true });
    expect(grantProAccessAfterApprovedPayment).not.toHaveBeenCalled();
    expect(revokeProAccess).not.toHaveBeenCalled();
    expect(store.get('payment_orders/order_performance_user-A')).toMatchObject({
      verificationStatus: 'environment_not_allowed', verifiedEnvironment: 'SANDBOX',
    });
  });

  test('SANDBOX pode ser habilitado explicitamente em ambiente isolado', async () => {
    process.env.REVENUECAT_ALLOWED_ENVIRONMENTS = 'PRODUCTION,SANDBOX';
    const sandbox = { ...activeSnapshot, environment: 'SANDBOX', active: true };
    (fetchRevenueCatPerformanceEntitlement as jest.Mock).mockResolvedValue(sandbox);
    const res = response();
    await verifyPurchaseHandler(request({ planId: 'invictus_performance', platform: 'android' }), res);

    expect(res.statusCode).toBe(200);
    expect(grantProAccessAfterApprovedPayment).toHaveBeenCalledWith(
      expect.any(String), expect.any(String), 'store_android', { entitlement: sandbox },
    );
  });

  test('perfil ausente não é recriado pelo fluxo Open nem Performance', async () => {
    store.delete('users/user-A');
    const res = response();
    await verifyPurchaseHandler(request({ planId: 'invictus_open' }), res);

    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe('BILLING_USER_UNAVAILABLE');
    expect(activateOpenPlan).not.toHaveBeenCalled();
    expect([...store.keys()].some((key) => key.startsWith('payment_orders/'))).toBe(false);
  });

  test('falha temporária da RevenueCat é recuperável e não aprova o pedido', async () => {
    (fetchRevenueCatPerformanceEntitlement as jest.Mock).mockRejectedValue(new Error('upstream unavailable'));
    const res = response();
    await verifyPurchaseHandler(request({ planId: 'invictus_performance', platform: 'android' }), res);

    expect(res.statusCode).toBe(502);
    expect(store.get('payment_orders/order_performance_user-A')).toMatchObject({
      status: 'pending', paymentStatus: 'pending', provisionStatus: 'pending',
      verificationStatus: 'retryable_error',
    });
    expect(grantProAccessAfterApprovedPayment).not.toHaveBeenCalled();
  });
});
