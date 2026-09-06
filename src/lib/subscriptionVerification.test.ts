import {
  clearPendingSubscriptionVerification,
  createPendingSubscriptionVerification,
  isTerminalInactiveSubscription,
  isSubscriptionProvisioned,
  readPendingSubscriptionVerification,
  savePendingSubscriptionVerification,
  subscriptionVerificationStorageKey,
  type SubscriptionVerificationStorage,
} from './subscriptionVerification';

function memoryStorage(): SubscriptionVerificationStorage & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  };
}

describe('pending subscription verification', () => {
  it('persiste e lê a confirmação da loja isolada por UID', () => {
    const storage = memoryStorage();
    const pending = createPendingSubscriptionVerification({
      uid: ' user-A ',
      platform: 'android',
      operation: 'purchase',
      productIdentifier: ' performance.monthly ',
      packageIdentifier: ' monthly ',
      storeCompletedAt: '2026-09-06T12:00:00.000Z',
    });

    expect(savePendingSubscriptionVerification(pending, storage)).toBe(true);
    expect(readPendingSubscriptionVerification('user-A', storage)).toEqual({
      version: 1,
      uid: 'user-A',
      platform: 'android',
      operation: 'purchase',
      productIdentifier: 'performance.monthly',
      packageIdentifier: 'monthly',
      storeCompletedAt: '2026-09-06T12:00:00.000Z',
    });
    expect(readPendingSubscriptionVerification('user-B', storage)).toBeNull();
  });

  it('não aceita payload persistido malformado ou pertencente a outro usuário', () => {
    const storage = memoryStorage();
    storage.setItem(subscriptionVerificationStorageKey('user-A'), JSON.stringify({
      version: 1,
      uid: 'user-B',
      platform: 'android',
      operation: 'purchase',
      productIdentifier: 'performance.monthly',
      storeCompletedAt: '2026-09-06T12:00:00.000Z',
    }));
    expect(readPendingSubscriptionVerification('user-A', storage)).toBeNull();

    storage.setItem(subscriptionVerificationStorageKey('user-A'), '{invalid json');
    expect(readPendingSubscriptionVerification('user-A', storage)).toBeNull();
  });

  it('limpa somente a intenção do UID solicitado', () => {
    const storage = memoryStorage();
    const make = (uid: string) => createPendingSubscriptionVerification({
      uid,
      platform: 'ios',
      operation: 'restore',
      productIdentifier: 'performance.annual',
      storeCompletedAt: '2026-09-06T12:00:00.000Z',
    });
    savePendingSubscriptionVerification(make('user-A'), storage);
    savePendingSubscriptionVerification(make('user-B'), storage);

    expect(clearPendingSubscriptionVerification('user-A', storage)).toBe(true);
    expect(readPendingSubscriptionVerification('user-A', storage)).toBeNull();
    expect(readPendingSubscriptionVerification('user-B', storage)).not.toBeNull();
  });
});

describe('isSubscriptionProvisioned', () => {
  const success = {
    success: true,
    status: 'approved',
    accessGranted: true,
    provisionStatus: 'applied',
  };

  it('aceita somente a resposta forte de benefício aplicado', () => {
    expect(isSubscriptionProvisioned(success)).toBe(true);
  });

  it.each([
    null,
    {},
    { ...success, success: false },
    { ...success, status: 'processing' },
    { ...success, accessGranted: false },
    { ...success, provisionStatus: 'retryable_error' },
    { success: 'true', status: 'approved', accessGranted: true, provisionStatus: 'applied' },
  ])('rejeita falso sucesso %#', (payload) => {
    expect(isSubscriptionProvisioned(payload)).toBe(false);
  });
});

describe('isTerminalInactiveSubscription', () => {
  it.each(['expired', 'refunded', 'revoked'])('aceita estado terminal %s', (entitlementStatus) => {
    expect(isTerminalInactiveSubscription({
      code: 'PERFORMANCE_ENTITLEMENT_INACTIVE',
      entitlementStatus,
      retryable: false,
      accessGranted: false,
    })).toBe(true);
  });

  it.each([
    null,
    {},
    { code: 'PERFORMANCE_ENTITLEMENT_INACTIVE', entitlementStatus: 'inactive', retryable: true, accessGranted: false },
    { code: 'PERFORMANCE_ENTITLEMENT_INACTIVE', entitlementStatus: 'expired', retryable: true, accessGranted: false },
    { code: 'PERFORMANCE_ENTITLEMENT_INACTIVE', entitlementStatus: 'expired', retryable: false, accessGranted: true },
  ])('não limpa intenção em resposta recuperável ou malformada %#', (payload) => {
    expect(isTerminalInactiveSubscription(payload)).toBe(false);
  });
});
