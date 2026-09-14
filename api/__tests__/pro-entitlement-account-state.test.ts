import { isProUser } from '../_lib/entitlement';

const NOW = new Date('2026-09-14T12:00:00.000Z');
const FUTURE = '2026-10-14T12:00:00.000Z';

function activePro(extra: Record<string, unknown> = {}) {
  return {
    role: 'user',
    proEntitlement: {
      version: 1,
      entitlementId: 'invictus_performance_pro',
      tier: 'performance',
      provider: 'revenuecat',
      status: 'active',
      productId: 'invictus_performance_monthly',
      providerObservedAt: '2026-09-14T10:00:00.000Z',
      expiresAt: FUTURE,
    },
    ...extra,
  };
}

describe('isProUser — canonical account lifecycle', () => {
  test('active canonical entitlement remains PRO', () => {
    expect(isProUser(activePro(), NOW)).toBe(true);
  });

  test.each([
    { isDeleted: true },
    { deleted: true },
    { accountDeleted: true },
    { disabled: true },
    { tombstone: true },
    { deletedAt: '2026-09-14T11:00:00.000Z' },
    { accountDeletedAt: '2026-09-14T11:00:00.000Z' },
    { lifecycleStatus: 'suspended' },
    { lifecycleStatus: 'excluído' },
    { deletionStatus: 'completed' },
    { accountStatus: 'bloqueado' },
    { status: 'banido' },
  ])('terminal/restricted state cannot retain PRO: %j', (state) => {
    expect(isProUser(activePro(state), NOW)).toBe(false);
  });

  test('active admin keeps full PRO without RevenueCat', () => {
    expect(isProUser({ role: 'admin' }, NOW)).toBe(true);
  });

  test('restricted admin cannot use role to bypass lifecycle', () => {
    expect(isProUser({ role: 'admin', deletionStatus: 'completed' }, NOW)).toBe(false);
  });
});
