import {
  isActiveAccountState,
  isDeletedAccountState,
  isInactiveAccountState,
} from '../_lib/account-state';

describe('account-state', () => {
  test('accepts a normal active profile', () => {
    const profile = { status: 'Ativo', isBlocked: false, isBanned: false, isSuspended: false };
    expect(isActiveAccountState(profile)).toBe(true);
    expect(isInactiveAccountState(profile)).toBe(false);
    expect(isDeletedAccountState(profile)).toBe(false);
  });

  test.each([
    { isBlocked: true },
    { isBanned: true },
    { isSuspended: true },
    { disabled: true },
    { status: 'blocked' },
    { accountStatus: 'banned' },
    { lifecycleStatus: 'suspended' },
  ])('rejects inactive profile %#', (profile) => {
    expect(isInactiveAccountState(profile)).toBe(true);
    expect(isActiveAccountState(profile)).toBe(false);
  });

  test.each([
    { isDeleted: true },
    { deleted: true },
    { accountDeleted: true },
    { tombstone: true },
    { deletedAt: '2026-09-14T00:00:00.000Z' },
    { accountDeletedAt: '2026-09-14T00:00:00.000Z' },
    { status: 'deleted' },
    { accountStatus: 'account_deleted' },
    { lifecycleStatus: 'deletion_completed' },
  ])('detects deleted profile %#', (profile) => {
    expect(isDeletedAccountState(profile)).toBe(true);
    expect(isInactiveAccountState(profile)).toBe(true);
    expect(isActiveAccountState(profile)).toBe(false);
  });

  test('fails closed for missing profile data', () => {
    expect(isActiveAccountState(null)).toBe(false);
    expect(isInactiveAccountState(undefined)).toBe(true);
    expect(isDeletedAccountState(null)).toBe(true);
  });
});
