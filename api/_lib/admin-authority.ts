const DISABLED_ADMIN_STATES = new Set([
  'deleted',
  'blocked',
  'banned',
  'suspended',
  'account_deleted',
  'deletion_completed',
]);

const COMPLETED_DELETION_STATES = new Set([
  'completed',
  'deleted',
  'deletion_completed',
]);

function normalizedState(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/**
 * Autoridade administrativa exige um perfil atual, ativo e não punido.
 * O token identifica o usuário, mas o documento do Firestore é a fonte
 * revogável usada em cada requisição administrativa.
 */
export function hasActiveAdminAuthority(userData: unknown): boolean {
  if (!userData || typeof userData !== 'object') return false;
  const data = userData as Record<string, unknown>;
  if (data.role !== 'admin') return false;

  if (
    data.isBlocked === true
    || data.isBanned === true
    || data.isSuspended === true
    || data.isDeleted === true
    || data.deleted === true
    || data.accountDeleted === true
    || data.disabled === true
    || data.tombstone === true
    || Boolean(data.deletedAt)
    || Boolean(data.accountDeletedAt)
  ) return false;

  const states = [data.status, data.accountStatus, data.lifecycleStatus]
    .map(normalizedState)
    .filter(Boolean);
  if (states.some((state) => DISABLED_ADMIN_STATES.has(state))) return false;

  return !COMPLETED_DELETION_STATES.has(normalizedState(data.deletionStatus));
}
