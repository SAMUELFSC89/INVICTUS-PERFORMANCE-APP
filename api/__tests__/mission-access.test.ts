import {
  preserveMissionAccessSnapshot,
  resolveExternalMissionAccessSnapshot,
  resolveMissionAccessSnapshot,
} from '../_lib/mission-access';

describe('mission access snapshot', () => {
  const receivedAt = new Date('2026-09-06T12:00:00.000Z');
  const canonicalPro = (overrides: Record<string, unknown> = {}) => ({
    version: 1,
    entitlementId: 'performance',
    tier: 'performance',
    provider: 'revenuecat',
    status: 'active',
    productId: 'invictus.performance.monthly',
    purchasedAt: '2026-08-01T10:00:00.000Z',
    expiresAt: '2026-10-05T10:00:00.000Z',
    providerObservedAt: '2026-09-06T11:59:00.000Z',
    ...overrides,
  });

  test('upgrade atual não transforma backfill anterior em progresso PRO', () => {
    const snapshot = resolveExternalMissionAccessSnapshot({
      proEntitlement: canonicalPro({ purchasedAt: '2026-09-05T10:00:00.000Z' }),
    }, true, '2026-08-20T10:00:00.000Z', receivedAt);
    expect(snapshot.missionAccessTier).toBe('free');
  });

  test('atividade ocorrida dentro do intervalo autoritativo mantém acesso PRO após downgrade', () => {
    const snapshot = resolveExternalMissionAccessSnapshot({
      subscriptionTier: 'open',
      premium: false,
      proEntitlement: canonicalPro({
        status: 'expired',
        expiresAt: '2026-09-01T10:00:00.000Z',
      }),
    }, true, '2026-08-20T10:00:00.000Z', receivedAt);
    expect(snapshot.missionAccessTier).toBe('pro');
  });

  test('grace antigo não amplia entitlement expirado e refund/revoke falham fechado', () => {
    const expired = resolveExternalMissionAccessSnapshot({
      subscriptionTier: 'open',
      proEntitlement: canonicalPro({
        status: 'expired',
        expiresAt: '2026-09-01T10:00:00.000Z',
        gracePeriodExpiresAt: '2026-09-30T10:00:00.000Z',
      }),
    }, true, '2026-09-02T10:00:00.000Z', receivedAt);
    expect(expired.missionAccessTier).toBe('free');

    for (const status of ['refunded', 'revoked']) {
      const snapshot = resolveExternalMissionAccessSnapshot({
        subscriptionTier: 'open',
        proEntitlement: canonicalPro({ status }),
      }, true, '2026-08-20T10:00:00.000Z', receivedAt);
      expect(snapshot.missionAccessTier).toBe('free');
    }
  });

  test('backfill antigo sem prova de ativação falha fechado apenas para PRO', () => {
    const snapshot = resolveExternalMissionAccessSnapshot({
      subscriptionTier: 'performance', subscriptionStatus: 'active_premium', premium: true,
    }, true, '2026-08-20T10:00:00.000Z', receivedAt);
    expect(snapshot.missionAccessTier).toBe('unknown');
  });

  test('ignora datas históricas que eram editáveis pelo cliente', () => {
    const snapshot = resolveExternalMissionAccessSnapshot({
      subscriptionTier: 'performance',
      subscriptionStatus: 'active_premium',
      expiresAt: '2026-10-05T10:00:00.000Z',
      performanceActivatedAt: '2026-01-01T00:00:00.000Z',
      subscriptionStartedAt: '2026-01-01T00:00:00.000Z',
    }, true, '2026-08-20T10:00:00.000Z', receivedAt);
    expect(snapshot.missionAccessTier).toBe('unknown');
  });

  test('atividade recente pode usar o plano atual e timestamp futuro é desconhecido', () => {
    expect(resolveExternalMissionAccessSnapshot({
      proEntitlement: canonicalPro(),
    }, true, '2026-09-06T10:00:00.000Z', receivedAt).missionAccessTier).toBe('pro');
    expect(resolveExternalMissionAccessSnapshot({
      subscriptionTier: 'performance', subscriptionStatus: 'active_premium',
      expiresAt: '2026-10-05T10:00:00.000Z', premium: true,
    }, true, '2026-09-07T10:00:00.000Z', receivedAt).missionAccessTier).toBe('unknown');
  });

  test('retry completa unknown, mas nunca recalcula free/pro já congelado', () => {
    const unknown = resolveMissionAccessSnapshot(null, false, receivedAt);
    const pro = resolveMissionAccessSnapshot({
      proEntitlement: canonicalPro(),
    }, true, receivedAt);
    expect(preserveMissionAccessSnapshot(unknown, pro).missionAccessTier).toBe('pro');
    expect(preserveMissionAccessSnapshot({ ...unknown, missionAccessTier: 'free' }, pro).missionAccessTier).toBe('free');
  });

  test('flags legadas de uma conta Open nunca concedem missões PRO', () => {
    const snapshot = resolveMissionAccessSnapshot({
      subscriptionTier: 'open',
      subscriptionStatus: 'active_basic',
      isSubscribed: true,
      premium: true,
      isPro: true,
    }, true, receivedAt);
    expect(snapshot.missionAccessTier).toBe('free');
  });
});
