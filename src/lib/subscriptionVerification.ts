export type SubscriptionStorePlatform = 'android' | 'ios';
export type SubscriptionStoreOperation = 'purchase' | 'restore';

export interface PendingSubscriptionVerification {
  version: 1;
  uid: string;
  platform: SubscriptionStorePlatform;
  operation: SubscriptionStoreOperation;
  productIdentifier: string;
  packageIdentifier?: string;
  storeCompletedAt: string;
}

export type SubscriptionVerificationStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const STORAGE_PREFIX = 'invictus:subscription-verification:v1:';

function browserStorage(): SubscriptionVerificationStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function subscriptionVerificationStorageKey(uid: string): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(uid.trim())}`;
}

export function createPendingSubscriptionVerification(input: {
  uid: string;
  platform: SubscriptionStorePlatform;
  operation: SubscriptionStoreOperation;
  productIdentifier: string;
  packageIdentifier?: string | null;
  storeCompletedAt?: string;
}): PendingSubscriptionVerification {
  const uid = input.uid.trim();
  const productIdentifier = input.productIdentifier.trim();
  const packageIdentifier = input.packageIdentifier?.trim() || undefined;
  const storeCompletedAt = input.storeCompletedAt || new Date().toISOString();

  if (!uid) throw new Error('Não foi possível registrar a confirmação: usuário ausente.');
  if (!productIdentifier) throw new Error('A loja não informou qual produto foi confirmado.');
  if (!Number.isFinite(Date.parse(storeCompletedAt))) {
    throw new Error('A loja retornou uma data de confirmação inválida.');
  }

  return {
    version: 1,
    uid,
    platform: input.platform,
    operation: input.operation,
    productIdentifier,
    ...(packageIdentifier ? { packageIdentifier } : {}),
    storeCompletedAt,
  };
}

function isPendingSubscriptionVerification(value: unknown, uid: string): value is PendingSubscriptionVerification {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return record.version === 1
    && record.uid === uid
    && (record.platform === 'android' || record.platform === 'ios')
    && (record.operation === 'purchase' || record.operation === 'restore')
    && typeof record.productIdentifier === 'string'
    && record.productIdentifier.trim().length > 0
    && (record.packageIdentifier === undefined || typeof record.packageIdentifier === 'string')
    && typeof record.storeCompletedAt === 'string'
    && Number.isFinite(Date.parse(record.storeCompletedAt));
}

export function readPendingSubscriptionVerification(
  uid: string,
  storage: SubscriptionVerificationStorage | null = browserStorage(),
): PendingSubscriptionVerification | null {
  const normalizedUid = uid.trim();
  if (!normalizedUid || !storage) return null;

  try {
    const raw = storage.getItem(subscriptionVerificationStorageKey(normalizedUid));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isPendingSubscriptionVerification(parsed, normalizedUid) ? parsed : null;
  } catch {
    return null;
  }
}

export function savePendingSubscriptionVerification(
  pending: PendingSubscriptionVerification,
  storage: SubscriptionVerificationStorage | null = browserStorage(),
): boolean {
  if (!storage || !isPendingSubscriptionVerification(pending, pending.uid)) return false;
  try {
    storage.setItem(subscriptionVerificationStorageKey(pending.uid), JSON.stringify(pending));
    return true;
  } catch {
    return false;
  }
}

export function clearPendingSubscriptionVerification(
  uid: string,
  storage: SubscriptionVerificationStorage | null = browserStorage(),
): boolean {
  const normalizedUid = uid.trim();
  if (!normalizedUid || !storage) return false;
  try {
    storage.removeItem(subscriptionVerificationStorageKey(normalizedUid));
    return true;
  } catch {
    return false;
  }
}

/** Só considera concluído o contrato forte emitido após aplicar o benefício. */
export function isSubscriptionProvisioned(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const record = payload as Record<string, unknown>;
  return record.success === true
    && record.status === 'approved'
    && record.accessGranted === true
    && record.provisionStatus === 'applied';
}

/**
 * O servidor usa este contrato somente quando a fonte autoritativa confirma
 * que não há mais uma compra ativa a provisionar. Nesse caso a intenção local
 * antiga deve ser descartada para não impedir uma nova assinatura legítima.
 */
export function isTerminalInactiveSubscription(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const record = payload as Record<string, unknown>;
  return record.code === 'PERFORMANCE_ENTITLEMENT_INACTIVE'
    && record.accessGranted === false
    && record.retryable === false
    && ['expired', 'refunded', 'revoked'].includes(String(record.entitlementStatus || '').toLowerCase());
}
