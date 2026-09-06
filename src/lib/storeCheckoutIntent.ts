import type { PhysicalShippingAddress } from '../types';

export type CheckoutMode = 'money' | 'discount' | 'drop';

export type CheckoutIntentInput = {
  userId: string;
  productId: string;
  mode: CheckoutMode;
  quantity: number;
  address: PhysicalShippingAddress;
  dropId?: string | null;
};

export type CheckoutIntent = CheckoutIntentInput & {
  version: 1;
  fingerprint: string;
  idempotencyKey: string;
  createdAt: string;
  orderId?: string;
};

export type CheckoutIntentScope = Pick<CheckoutIntentInput, 'userId' | 'productId' | 'mode'>;
export type CheckoutIntentStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const checkoutIntentPrefix = 'invictus.store.checkout-intent.v1';

export function normalizeCheckoutAddress(address: PhysicalShippingAddress): PhysicalShippingAddress {
  const text = (value: string | null | undefined, max: number) => String(value || '').trim().slice(0, max);
  return {
    recipientName: text(address.recipientName, 120),
    postalCode: text(address.postalCode, 9).replace(/\D/g, ''),
    street: text(address.street, 180),
    number: text(address.number, 30),
    complement: text(address.complement, 100) || null,
    district: text(address.district, 100),
    city: text(address.city, 100),
    state: text(address.state, 2).toUpperCase(),
  };
}

export function checkoutIntentFingerprint(input: CheckoutIntentInput) {
  return JSON.stringify({
    productId: input.productId,
    mode: input.mode,
    quantity: input.quantity,
    dropId: input.dropId || null,
    address: normalizeCheckoutAddress(input.address),
  });
}

export function checkoutIntentStorageKey(scope: CheckoutIntentScope) {
  return `${checkoutIntentPrefix}:${scope.userId}:${scope.mode}:${scope.productId}`;
}

export function readCheckoutIntent(storage: CheckoutIntentStorage, scope: CheckoutIntentScope): CheckoutIntent | null {
  try {
    const stored = storage.getItem(checkoutIntentStorageKey(scope));
    if (!stored) return null;
    const intent = JSON.parse(stored) as CheckoutIntent;
    if (intent.version !== 1 || intent.userId !== scope.userId || intent.productId !== scope.productId || intent.mode !== scope.mode || !intent.idempotencyKey || !intent.fingerprint || !intent.address) return null;
    return intent;
  } catch {
    return null;
  }
}

export function persistCheckoutIntent(storage: CheckoutIntentStorage, intent: CheckoutIntent) {
  try {
    storage.setItem(checkoutIntentStorageKey(intent), JSON.stringify(intent));
  } catch {
    throw new Error('Não foi possível proteger esta tentativa no dispositivo. Libere o armazenamento do app e tente novamente.');
  }
}

function isSameIntent(current: CheckoutIntent | null, expected: CheckoutIntent) {
  return current?.idempotencyKey === expected.idempotencyKey && current.fingerprint === expected.fingerprint;
}

export function attachOrderToCheckoutIntent(storage: CheckoutIntentStorage, intent: CheckoutIntent, orderId: string) {
  const current = readCheckoutIntent(storage, intent);
  if (!isSameIntent(current, intent)) return false;
  persistCheckoutIntent(storage, { ...current!, orderId });
  return true;
}

export function getOrCreateCheckoutIntent(
  storage: CheckoutIntentStorage,
  input: CheckoutIntentInput,
  createIdempotencyKey: () => string,
  now: () => string = () => new Date().toISOString(),
) {
  const normalizedInput: CheckoutIntentInput = { ...input, address: normalizeCheckoutAddress(input.address), dropId: input.dropId || null };
  const fingerprint = checkoutIntentFingerprint(normalizedInput);
  const existing = readCheckoutIntent(storage, normalizedInput);
  if (existing?.fingerprint === fingerprint) return existing;

  const intent: CheckoutIntent = {
    ...normalizedInput,
    version: 1,
    fingerprint,
    idempotencyKey: createIdempotencyKey(),
    createdAt: now(),
  };
  // This write is deliberately synchronous and happens before the caller may POST.
  persistCheckoutIntent(storage, intent);
  return intent;
}

export function clearCheckoutIntent(storage: CheckoutIntentStorage, intent: CheckoutIntent) {
  try {
    const current = readCheckoutIntent(storage, intent);
    if (!isSameIntent(current, intent)) return false;
    storage.removeItem(checkoutIntentStorageKey(intent));
    return true;
  } catch {
    // A stale key is safer than deleting the only record of an uncertain request.
    return false;
  }
}
