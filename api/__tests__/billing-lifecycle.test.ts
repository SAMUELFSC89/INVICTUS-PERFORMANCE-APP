import { billingAccountStatusPatch } from '../_lib/billing-lifecycle';

describe('billing lifecycle ownership', () => {
  test('active profiles may receive the subscription display status', () => {
    expect(billingAccountStatusPatch({ status: 'active' }, 'PRO_ATIVO')).toEqual({ status: 'PRO_ATIVO' });
    expect(billingAccountStatusPatch({ accountStatus: 'active' }, 'OPEN_ATIVO')).toEqual({ status: 'OPEN_ATIVO' });
  });

  test.each([
    { status: 'suspended' },
    { status: 'blocked' },
    { accountStatus: 'banned' },
    { lifecycleStatus: 'suspended' },
    { isBlocked: true },
    { isBanned: true },
    { isSuspended: true },
    { disabled: true },
    { tombstone: true },
    { deletedAt: '2026-09-15T00:00:00.000Z' },
    { deletionStatus: 'completed' },
  ])('billing cannot overwrite inactive account status %#', (profile) => {
    expect(billingAccountStatusPatch(profile, 'PRO_ATIVO')).toEqual({});
    expect(billingAccountStatusPatch(profile, 'OPEN_ATIVO')).toEqual({});
  });
});
