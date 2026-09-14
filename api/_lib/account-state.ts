const DELETED_STATES = new Set([
  'deleted',
  'deletado',
  'excluido',
  'excluído',
  'account_deleted',
  'deletion_completed',
]);

const INACTIVE_STATES = new Set([
  ...DELETED_STATES,
  'blocked',
  'bloqueado',
  'banned',
  'banido',
  'suspended',
  'suspenso',
]);

function normalizedStates(data: Record<string, unknown>): string[] {
  return [data.status, data.accountStatus, data.lifecycleStatus]
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim().toLowerCase());
}

export function isDeletedAccountState(userData: unknown): boolean {
  if (!userData || typeof userData !== 'object') return true;
  const data = userData as Record<string, unknown>;
  return Boolean(
    data.isDeleted === true
    || data.deleted === true
    || data.accountDeleted === true
    || data.tombstone === true
    || data.deletedAt
    || data.accountDeletedAt
    || normalizedStates(data).some((state) => DELETED_STATES.has(state))
  );
}

export function isInactiveAccountState(userData: unknown): boolean {
  if (!userData || typeof userData !== 'object') return true;
  const data = userData as Record<string, unknown>;
  return Boolean(
    isDeletedAccountState(data)
    || data.isBlocked === true
    || data.isBanned === true
    || data.isSuspended === true
    || data.disabled === true
    || normalizedStates(data).some((state) => INACTIVE_STATES.has(state))
  );
}

export function isActiveAccountState(userData: unknown): boolean {
  return !isInactiveAccountState(userData);
}
