type EntitlementLike = {
  version?: unknown;
  entitlementId?: unknown;
  tier?: unknown;
  provider?: unknown;
  status?: unknown;
  productId?: unknown;
  providerObservedAt?: unknown;
  expiresAt?: unknown;
  gracePeriodExpiresAt?: unknown;
};

const PRO_TIERS = new Set(['performance', 'pro', 'invictus_performance']);
const PRO_ENTITLEMENT_IDS = new Set(['invictus_performance_pro', 'performance']);
const ACTIVE_STATUSES = new Set(['active', 'active_premium']);
const GRACE_STATUSES = new Set(['grace', 'grace_period']);
const DISABLED_ACCOUNT_STATES = new Set([
  'deleted',
  'blocked',
  'banned',
  'suspended',
  'account_deleted',
  'deletion_completed',
]);
const COMPLETED_DELETION_STATES = new Set(['completed', 'deleted', 'deletion_completed']);

function normalized(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function isRestrictedProfile(data: Record<string, unknown>): boolean {
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
  ) return true;

  const states = [data.accountStatus, data.status, data.lifecycleStatus]
    .map(normalized)
    .filter(Boolean);
  if (states.some((state) => DISABLED_ACCOUNT_STATES.has(state))) return true;

  return COMPLETED_DELETION_STATES.has(normalized(data.deletionStatus));
}

export function entitlementDateToMillis(value: unknown): number | null {
  if (value instanceof Date) {
    const millis = value.getTime();
    return Number.isFinite(millis) ? millis : null;
  }

  if (typeof value === 'number') return Number.isFinite(value) ? value : null;

  if (typeof value === 'string' && value.trim()) {
    const millis = Date.parse(value);
    return Number.isFinite(millis) ? millis : null;
  }

  if (value && typeof value === 'object') {
    const timestamp = value as { toMillis?: () => number; toDate?: () => Date; _seconds?: unknown };
    if (typeof timestamp.toMillis === 'function') {
      const millis = timestamp.toMillis();
      return Number.isFinite(millis) ? millis : null;
    }
    if (typeof timestamp.toDate === 'function') return entitlementDateToMillis(timestamp.toDate());
    if (typeof timestamp._seconds === 'number') return timestamp._seconds * 1000;
  }

  return null;
}

/**
 * Política única de acesso PRO no cliente.
 * Contas administrativas ativas recebem acesso funcional completo para teste e
 * operação, sem exigir uma compra RevenueCat. Para usuários comuns, flags
 * legadas isoladas como `isSubscribed`, `premium` e `isPro` nunca bastam para
 * liberar recursos.
 */
export function hasActiveProEntitlement(profile: unknown, at: Date | number = Date.now()): boolean {
  if (!profile || typeof profile !== 'object') return false;

  const data = profile as Record<string, unknown>;
  if (isRestrictedProfile(data)) return false;

  if (normalized(data.role) === 'admin') return true;

  const entitlement = data.proEntitlement && typeof data.proEntitlement === 'object'
    ? data.proEntitlement as EntitlementLike
    : null;
  if (!entitlement
    || entitlement.version !== 1
    || !PRO_ENTITLEMENT_IDS.has(normalized(entitlement.entitlementId))
    || normalized(entitlement.provider) !== 'revenuecat'
    || typeof entitlement.productId !== 'string'
    || !entitlement.productId.trim()
    || entitlementDateToMillis(entitlement.providerObservedAt) === null) return false;

  const tier = normalized(entitlement.tier);
  if (!PRO_TIERS.has(tier)) return false;

  const status = normalized(entitlement.status);
  if (!ACTIVE_STATUSES.has(status) && !GRACE_STATUSES.has(status)) return false;

  const atMillis = at instanceof Date ? at.getTime() : at;
  if (!Number.isFinite(atMillis)) return false;

  const expiration = entitlementDateToMillis(GRACE_STATUSES.has(status)
    ? entitlement.gracePeriodExpiresAt ?? entitlement.expiresAt
    : entitlement.expiresAt);

  return expiration !== null && expiration > atMillis;
}
