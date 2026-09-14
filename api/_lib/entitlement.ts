import { hasActiveAdminAuthority } from './admin-authority.js';

export type ProEntitlementStatus =
  | 'active'
  | 'grace_period'
  | 'expired'
  | 'refunded'
  | 'revoked'
  | 'inactive';

export interface CanonicalProEntitlement {
  version?: unknown;
  entitlementId?: string;
  tier?: string;
  provider?: string;
  status?: ProEntitlementStatus | string;
  productId?: unknown;
  purchasedAt?: unknown;
  expiresAt?: unknown;
  gracePeriodExpiresAt?: unknown;
  providerObservedAt?: unknown;
}

const PRO_TIERS = new Set(['performance', 'pro', 'invictus_performance']);
const ACTIVE_STATUSES = new Set(['active', 'active_premium']);
const GRACE_STATUSES = new Set(['grace', 'grace_period']);

function normalizedString(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/** Valida a proveniência da projeção, independentemente do estado atual. */
export function isCanonicalProEntitlement(
  value: unknown,
): value is CanonicalProEntitlement & { productId: string } {
  if (!value || typeof value !== 'object') return false;
  const entitlement = value as CanonicalProEntitlement;
  return entitlement.version === 1
    && new Set(['invictus_performance_pro', 'performance']).has(normalizedString(entitlement.entitlementId))
    && normalizedString(entitlement.provider) === 'revenuecat'
    && typeof entitlement.productId === 'string'
    && Boolean(entitlement.productId.trim())
    && entitlementDateToMillis(entitlement.providerObservedAt) !== null;
}

/**
 * Converts the date shapes used by the API, browser SDK and Firestore into an
 * epoch. Invalid/missing dates deliberately return null so a broken projection
 * cannot accidentally unlock paid functionality.
 */
export function entitlementDateToMillis(value: unknown): number | null {
  if (value instanceof Date) {
    const millis = value.getTime();
    return Number.isFinite(millis) ? millis : null;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'string' && value.trim()) {
    const millis = Date.parse(value);
    return Number.isFinite(millis) ? millis : null;
  }

  if (value && typeof value === 'object') {
    const firestoreDate = value as { toMillis?: () => number; toDate?: () => Date; _seconds?: unknown };
    if (typeof firestoreDate.toMillis === 'function') {
      const millis = firestoreDate.toMillis();
      return Number.isFinite(millis) ? millis : null;
    }
    if (typeof firestoreDate.toDate === 'function') {
      return entitlementDateToMillis(firestoreDate.toDate());
    }
    if (typeof firestoreDate._seconds === 'number') {
      const millis = firestoreDate._seconds * 1000;
      return Number.isFinite(millis) ? millis : null;
    }
  }

  return null;
}

/**
 * Política canônica de acesso PRO.
 *
 * Contas administrativas ativas recebem acesso funcional completo para teste e
 * operação, sem exigir uma compra RevenueCat. Para usuários comuns, campos
 * legados (`isPro`, `premium`, `isSubscribed`, `subscriptionTier` etc.) nunca
 * concedem acesso. Somente a projeção canônica completa, gravada pelo backend
 * após validar a RevenueCat, pode abrir o gate pago.
 */
export function isProUser(userData: any, at: Date | number = Date.now()): boolean {
  if (!userData || typeof userData !== 'object') return false;
  const accountStatus = normalizedString(userData.accountStatus || userData.status);
  if (userData.isBlocked === true || userData.isBanned === true || userData.isSuspended === true
    || accountStatus === 'deleted' || accountStatus === 'blocked' || accountStatus === 'banned'
    || accountStatus === 'suspended') return false;

  if (hasActiveAdminAuthority(userData)) return true;

  const entitlement = userData.proEntitlement as CanonicalProEntitlement | undefined;
  if (!isCanonicalProEntitlement(entitlement)) return false;

  // O shape/proveniência também fazem parte do contrato. Isso impede que um
  // perfil legado contaminado seja promovido apenas por campos top-level.
  const tier = normalizedString(entitlement.tier);
  if (!PRO_TIERS.has(tier)) return false;

  const status = normalizedString(entitlement.status);
  if (!ACTIVE_STATUSES.has(status) && !GRACE_STATUSES.has(status)) return false;

  const checkAt = at instanceof Date ? at.getTime() : at;
  if (!Number.isFinite(checkAt)) return false;

  const expirationValue = GRACE_STATUSES.has(status)
    ? entitlement.gracePeriodExpiresAt ?? entitlement.expiresAt
    : entitlement.expiresAt;
  const expiration = entitlementDateToMillis(expirationValue);

  return expiration !== null && expiration > checkAt;
}
