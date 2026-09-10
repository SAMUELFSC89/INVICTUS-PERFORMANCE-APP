import { entitlementDateToMillis, hasActiveProEntitlement } from './proEntitlement';

describe('hasActiveProEntitlement', () => {
  const now = Date.parse('2026-09-06T12:00:00.000Z');
  const canonical = (overrides: Record<string, unknown> = {}) => ({
    version: 1,
    entitlementId: 'invictus_performance_pro',
    tier: 'performance',
    provider: 'revenuecat',
    status: 'active',
    productId: 'invictus_performance_monthly',
    providerObservedAt: '2026-09-06T11:59:00.000Z',
    expiresAt: '2026-10-06T12:00:00.000Z',
    ...overrides,
  });

  it('aceita temporariamente o entitlement legado performance', () => {
    expect(hasActiveProEntitlement({
      proEntitlement: canonical({ entitlementId: 'performance' }),
    }, now)).toBe(true);
  });

  it('não trata o Plano Open nem flags legadas isoladas como PRO', () => {
    expect(hasActiveProEntitlement({
      subscriptionTier: 'open',
      subscriptionStatus: 'active_basic',
      isSubscribed: true,
      premium: true,
      isPro: true,
    }, now)).toBe(false);
  });

  it('nega projeção legada mesmo com tier, estado e expiração vigentes', () => {
    expect(hasActiveProEntitlement({
      subscriptionTier: 'performance',
      subscriptionStatus: 'active_premium',
      expiresAt: '2026-10-06T12:00:00.000Z',
    }, now)).toBe(false);

    expect(hasActiveProEntitlement({
      subscriptionTier: 'performance',
      subscriptionStatus: 'active_premium',
    }, now)).toBe(false);

    expect(hasActiveProEntitlement({
      subscriptionTier: 'performance',
      subscriptionStatus: 'active_premium',
      expiresAt: '2026-08-06T12:00:00.000Z',
    }, now)).toBe(false);
  });

  it('prioriza o entitlement canônico sobre projeções legadas conflitantes', () => {
    expect(hasActiveProEntitlement({
      subscriptionTier: 'performance',
      subscriptionStatus: 'active_premium',
      expiresAt: '2026-10-06T12:00:00.000Z',
      proEntitlement: {
        ...canonical({ status: 'revoked' }),
      },
    }, now)).toBe(false);
  });

  it('falha fechado quando o entitlement canônico existe mas está parcial', () => {
    expect(hasActiveProEntitlement({
      subscriptionTier: 'performance',
      subscriptionStatus: 'active_premium',
      expiresAt: '2026-10-06T12:00:00.000Z',
      proEntitlement: { ...canonical(), provider: undefined },
    }, now)).toBe(false);
  });

  it('aceita grace period somente até o limite informado pelo provedor', () => {
    const profile = {
      proEntitlement: {
        ...canonical({ status: 'grace_period' }),
        expiresAt: '2026-09-01T00:00:00.000Z',
        gracePeriodExpiresAt: '2026-09-08T00:00:00.000Z',
      },
    };
    expect(hasActiveProEntitlement(profile, now)).toBe(true);
    expect(hasActiveProEntitlement(profile, Date.parse('2026-09-09T00:00:00.000Z'))).toBe(false);
  });

  it.each(['isBlocked', 'isBanned', 'isSuspended'])(
    'nega acesso quando a conta possui %s',
    (field) => {
      expect(hasActiveProEntitlement({
        [field]: true,
        proEntitlement: {
          ...canonical(),
        },
      }, now)).toBe(false);
    }
  );

  it.each([
    ['version', { version: undefined }],
    ['entitlementId', { entitlementId: undefined }],
    ['provider', { provider: undefined }],
    ['productId', { productId: undefined }],
    ['providerObservedAt', { providerObservedAt: undefined }],
  ])('nega entitlement sem proveniência canônica: %s', (_field, override) => {
    expect(hasActiveProEntitlement({ proEntitlement: canonical(override) }, now)).toBe(false);
  });
});

describe('entitlementDateToMillis', () => {
  it('normaliza Timestamp do Firestore e rejeita datas inválidas', () => {
    expect(entitlementDateToMillis({ toMillis: () => 1234 })).toBe(1234);
    expect(entitlementDateToMillis({ _seconds: 2 })).toBe(2000);
    expect(entitlementDateToMillis('não é data')).toBeNull();
  });
});
