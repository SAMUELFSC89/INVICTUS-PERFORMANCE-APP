const INACTIVE_STATES = new Set([
  'deleted',
  'deletado',
  'excluido',
  'excluído',
  'blocked',
  'bloqueado',
  'banned',
  'banido',
  'suspended',
  'suspenso',
  'account_deleted',
  'deletion_completed',
]);

export function isInactiveAccountState(userData: unknown): boolean {
  if (!userData || typeof userData !== 'object') return true;
  const data = userData as Record<string, unknown>;
  const states = [data.status, data.accountStatus, data.lifecycleStatus]
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim().toLowerCase());

  return Boolean(
    data.isBlocked === true
    || data.isBanned === true
    || data.isSuspended === true
    || data.isDeleted === true
    || data.deleted === true
    || data.accountDeleted === true
    || data.disabled === true
    || data.tombstone === true
    || data.deletedAt
    || data.accountDeletedAt
    || states.some((state) => INACTIVE_STATES.has(state))
  );
}

export function isActiveAccountState(userData: unknown): boolean {
  return !isInactiveAccountState(userData);
}
