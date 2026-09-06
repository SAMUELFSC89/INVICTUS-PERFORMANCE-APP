import { isProUser } from '../_lib/entitlement.js';

const NOW = Date.parse('2026-09-06T12:00:00.000Z');
const FUTURE = '2026-10-06T12:00:00.000Z';
const PAST = '2026-09-05T12:00:00.000Z';

function canonicalEntitlement(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    entitlementId: 'performance',
    tier: 'performance',
    provider: 'revenuecat',
    status: 'active',
    productId: 'invictus_performance_monthly',
    purchasedAt: '2026-09-01T12:00:00.000Z',
    expiresAt: FUTURE,
    providerObservedAt: '2026-09-06T11:59:00.000Z',
    ...overrides,
  };
}

describe('política canônica de entitlement PRO', () => {
  test('concede acesso somente para entitlement ativo com expiração futura', () => {
    expect(isProUser({ proEntitlement: canonicalEntitlement() }, NOW)).toBe(true);
  });

  test('nega acesso quando a assinatura já expirou', () => {
    expect(isProUser({
      proEntitlement: canonicalEntitlement({ expiresAt: PAST }),
    }, NOW)).toBe(false);
  });

  test.each(['refunded', 'revoked'])('nega acesso com status %s mesmo que a expiração seja futura', status => {
    expect(isProUser({
      proEntitlement: canonicalEntitlement({ status }),
    }, NOW)).toBe(false);
  });

  test('mantém o acesso durante grace period ainda vigente', () => {
    expect(isProUser({
      proEntitlement: canonicalEntitlement({
        status: 'grace_period',
        expiresAt: PAST,
        gracePeriodExpiresAt: FUTURE,
      }),
    }, NOW)).toBe(true);
  });

  test('nega acesso depois do fim do grace period', () => {
    expect(isProUser({
      proEntitlement: canonicalEntitlement({
        status: 'grace_period',
        expiresAt: FUTURE,
        gracePeriodExpiresAt: PAST,
      }),
    }, NOW)).toBe(false);
  });

  test('Plano Open não vira PRO por flags legadas verdadeiras', () => {
    expect(isProUser({
      subscriptionTier: 'open',
      currentPlan: 'open',
      subscriptionStatus: 'active_basic',
      proStatus: 'active',
      expiresAt: FUTURE,
      isSubscribed: true,
      isPro: true,
      premium: true,
      performance: true,
    }, NOW)).toBe(false);
  });

  test('nega perfil legado forjado mesmo com tier, estado e expiração coerentes', () => {
    expect(isProUser({
      subscriptionTier: 'performance',
      currentPlan: 'performance',
      subscriptionStatus: 'active_premium',
      proStatus: 'active',
      subscriptionExpiresAt: FUTURE,
      expiresAt: FUTURE,
      isSubscribed: true,
      isPro: true,
    }, NOW)).toBe(false);
  });

  test.each([
    ['version', { version: undefined }],
    ['entitlementId', { entitlementId: undefined }],
    ['provider', { provider: undefined }],
    ['productId', { productId: undefined }],
    ['providerObservedAt', { providerObservedAt: undefined }],
  ])('nega entitlement sem proveniência canônica: %s', (_field, override) => {
    expect(isProUser({ proEntitlement: canonicalEntitlement(override) }, NOW)).toBe(false);
  });

  test.each(['isBlocked', 'isBanned', 'isSuspended'])(
    'conta restrita por %s nunca recebe acesso PRO',
    (field) => {
      expect(isProUser({
        [field]: true,
        proEntitlement: canonicalEntitlement(),
      }, NOW)).toBe(false);
    }
  );

  test('conta excluída nunca recebe acesso PRO', () => {
    expect(isProUser({ accountStatus: 'deleted', proEntitlement: canonicalEntitlement() }, NOW)).toBe(false);
  });

  test.each([
    ['ausente', undefined],
    ['vazia', ''],
    ['inválida', 'data-que-nao-existe'],
    ['não finita', Number.NaN],
  ])('falha de modo fechado quando a expiração é %s', (_label, expiresAt) => {
    expect(isProUser({
      proEntitlement: canonicalEntitlement({ expiresAt }),
    }, NOW)).toBe(false);
  });

  test.each([
    ['toMillis', { toMillis: () => Date.parse(FUTURE) }],
    ['toDate', { toDate: () => new Date(FUTURE) }],
  ])('aceita Timestamp do Firestore representado por %s', (_label, expiresAt) => {
    expect(isProUser({
      proEntitlement: canonicalEntitlement({ expiresAt }),
    }, NOW)).toBe(true);
  });

  test('entitlement canônico revogado prevalece sobre campos legados que ainda dizem PRO', () => {
    expect(isProUser({
      proEntitlement: canonicalEntitlement({ status: 'revoked' }),
      subscriptionTier: 'performance',
      currentPlan: 'performance',
      subscriptionStatus: 'active_premium',
      proStatus: 'active',
      expiresAt: FUTURE,
      isSubscribed: true,
      isPro: true,
      premium: true,
    }, NOW)).toBe(false);
  });

  test('entitlement canônico ativo prevalece sobre campos legados inativos', () => {
    expect(isProUser({
      proEntitlement: canonicalEntitlement(),
      subscriptionTier: 'open',
      currentPlan: 'Nenhum',
      subscriptionStatus: 'inactive',
      proStatus: 'revoked',
      expiresAt: PAST,
      isSubscribed: false,
      isPro: false,
      premium: false,
    }, NOW)).toBe(true);
  });

  test('entitlement canônico incompleto não recorre a campos legados permissivos', () => {
    expect(isProUser({
      proEntitlement: { status: 'active', expiresAt: FUTURE },
      subscriptionTier: 'performance',
      subscriptionStatus: 'active_premium',
      expiresAt: FUTURE,
      isPro: true,
    }, NOW)).toBe(false);
  });
});
