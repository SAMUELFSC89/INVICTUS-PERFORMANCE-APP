let mockDb: any;

jest.mock('../_lib/common', () => ({
  get db() { return mockDb; },
  FieldValue: { serverTimestamp: () => ({ __serverTimestamp: true }) },
}));
jest.mock('../_lib/season-prize-engine', () => ({
  getOrInitCurrentSeasonWindow: jest.fn(),
  calcularProximaJanela: jest.fn(),
}));

import {
  activateOpenPlan,
  fetchRevenueCatPerformanceEntitlement,
  grantProAccessAfterApprovedPayment,
  revokeProAccess,
  type VerifiedPerformanceEntitlement,
} from '../_lib/payments-service';
import { isProUser } from '../_lib/entitlement';

type Stored = Record<string, any>;

function createDb(initial: Record<string, Stored>) {
  const store = new Map<string, Stored>(Object.entries(initial));
  let generatedId = 0;
  let failNextCommit = false;

  const snapshot = (value: Stored | undefined) => ({
    exists: value !== undefined,
    data: () => value,
  });
  const ref = (collection: string, id: string) => {
    const key = `${collection}/${id}`;
    return {
      key,
      id,
      get: async () => snapshot(store.get(key)),
      set: async (value: Stored, options?: { merge?: boolean }) => {
        store.set(key, options?.merge ? { ...(store.get(key) || {}), ...value } : { ...value });
      },
      update: async (value: Stored) => {
        if (!store.has(key)) throw new Error(`missing ${key}`);
        store.set(key, { ...store.get(key), ...value });
      },
    };
  };

  const database = {
    store,
    failNextTransactionCommit: () => { failNextCommit = true; },
    collection: (collection: string) => ({
      doc: (id?: string) => ref(collection, id || `generated-${++generatedId}`),
    }),
    runTransaction: async (callback: (transaction: any) => Promise<any>) => {
      const writes: Array<{ target: any; value: Stored; merge: boolean }> = [];
      const transaction = {
        get: async (target: any) => snapshot(store.get(target.key)),
        set: (target: any, value: Stored, options?: { merge?: boolean }) => {
          writes.push({ target, value, merge: options?.merge === true });
        },
      };
      const result = await callback(transaction);
      if (failNextCommit) {
        failNextCommit = false;
        throw new Error('simulated transaction commit failure');
      }
      for (const { target, value, merge } of writes) {
        store.set(target.key, merge ? { ...(store.get(target.key) || {}), ...value } : { ...value });
      }
      return result;
    },
  };
  return database;
}

const NOW = '2026-09-06T12:00:00.000Z';
const FUTURE = '2026-10-06T12:00:00.000Z';

function activeEntitlement(overrides: Partial<VerifiedPerformanceEntitlement> = {}): VerifiedPerformanceEntitlement {
  return {
    active: true,
    status: 'active',
    productId: 'invictus.performance.monthly',
    purchasedAt: '2026-09-06T10:00:00.000Z',
    expiresAt: FUTURE,
    gracePeriodExpiresAt: null,
    providerObservedAt: NOW,
    transactionId: 'store-tx-1',
    store: 'PLAY_STORE',
    environment: 'PRODUCTION',
    periodType: 'NORMAL',
    willRenew: true,
    ...overrides,
  };
}

describe('provisionamento de assinatura', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date(NOW));
    mockDb = createDb({
      'payment_orders/order-performance': {
        orderId: 'order-performance',
        userId: 'user-A',
        planId: 'invictus_performance',
        status: 'pending',
        paymentStatus: 'pending',
        provisionStatus: 'pending',
        createdAt: '2026-09-06T09:00:00.000Z',
      },
      'users/user-A': {
        subscriptionTier: 'open',
        isSubscribed: false,
        premium: false,
      },
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('aplica pedido, entitlement e perfil na mesma transação usando datas/produto/preço do provedor', async () => {
    await grantProAccessAfterApprovedPayment(
      'order-performance',
      'store-tx-1',
      'revenuecat_webhook',
      {
        entitlement: activeEntitlement(),
        eventId: 'event-1',
        eventType: 'INITIAL_PURCHASE',
        amount: 7.99,
        currency: 'USD',
      }
    );

    expect(mockDb.store.get('payment_orders/order-performance')).toMatchObject({
      status: 'approved',
      paymentStatus: 'approved',
      provisionStatus: 'applied',
      amount: 7.99,
      currency: 'USD',
      productId: 'invictus.performance.monthly',
      transactionId: 'store-tx-1',
      expiresAt: FUTURE,
    });
    expect(mockDb.store.get('user_entitlements/user-A_invictus_performance')).toMatchObject({
      status: 'active',
      productId: 'invictus.performance.monthly',
      expiresAt: FUTURE,
    });
    const profile = mockDb.store.get('users/user-A');
    expect(profile).toMatchObject({
      subscriptionTier: 'performance',
      isSubscribed: true,
      premium: true,
      performance: true,
      isPro: true,
      expiresAt: FUTURE,
    });
    expect(isProUser(profile, Date.parse(NOW))).toBe(true);
    expect(mockDb.store.get('webhook_events/event-1')).toMatchObject({
      status: 'processed',
      outcome: 'provisioned',
      amount: 7.99,
      currency: 'USD',
      productId: 'invictus.performance.monthly',
      transactionId: 'store-tx-1',
      expiresAt: FUTURE,
    });
  });

  test('Plano Open não passa pelo concessor PRO e grava todas as flags pagas como falsas', async () => {
    mockDb.store.set('payment_orders/order-open', {
      orderId: 'order-open', userId: 'user-A', planId: 'invictus_open', status: 'pending',
    });

    await expect(grantProAccessAfterApprovedPayment(
      'order-open',
      'open-payment',
      'open_activation',
      { entitlement: activeEntitlement() }
    )).rejects.toThrow('não corresponde ao Plano Performance');

    await activateOpenPlan('order-open', 'open-payment', 'open_activation');
    const profile = mockDb.store.get('users/user-A');
    expect(profile).toMatchObject({
      subscriptionTier: 'open',
      currentPlan: 'open',
      isSubscribed: false,
      premium: false,
      performance: false,
      isPro: false,
      plan: 'open',
      proStatus: 'inactive',
    });
    expect(isProUser(profile, Date.parse(NOW))).toBe(false);
  });

  test('reativar Open não derruba uma assinatura Performance canônica ainda vigente', async () => {
    await grantProAccessAfterApprovedPayment(
      'order-performance', 'store-tx-1', 'verify', { entitlement: activeEntitlement() }
    );
    mockDb.store.set('payment_orders/order-open', {
      orderId: 'order-open', userId: 'user-A', planId: 'invictus_open', status: 'pending',
    });

    await activateOpenPlan('order-open', 'open-payment', 'open_activation');

    const profile = mockDb.store.get('users/user-A');
    expect(profile).toMatchObject({ subscriptionTier: 'performance', isSubscribed: true, isPro: true });
    expect(isProUser(profile, Date.parse(NOW))).toBe(true);
  });

  test('revogação limpa sinais legados de PRO atomicamente', async () => {
    await grantProAccessAfterApprovedPayment(
      'order-performance', 'store-tx-1', 'verify', { entitlement: activeEntitlement() }
    );
    const expired = activeEntitlement({
      active: false,
      status: 'expired',
      expiresAt: '2026-09-06T11:00:00.000Z',
      providerObservedAt: '2026-09-06T12:01:00.000Z',
      willRenew: false,
    });

    await revokeProAccess(
      'order-performance', 'store-tx-1', 'expired', 'webhook', 'expirada', { entitlement: expired }
    );

    const profile = mockDb.store.get('users/user-A');
    expect(profile).toMatchObject({
      subscriptionTier: 'open',
      currentPlan: 'open',
      isSubscribed: false,
      premium: false,
      performance: false,
      isPro: false,
      plan: 'open',
      proStatus: 'expired',
    });
    expect(isProUser(profile, Date.parse(NOW))).toBe(false);
    expect(mockDb.store.get('payment_orders/order-performance')).toMatchObject({
      paymentStatus: 'expired',
      provisionStatus: 'revoked',
    });
  });

  test('reembolso registra eventAmount/refundAmount sem sobrescrever amount da compra', async () => {
    mockDb.store.set('payment_orders/order-performance', {
      ...mockDb.store.get('payment_orders/order-performance'),
      amount: 31.47,
    });
    await revokeProAccess(
      'order-performance',
      'store-tx-1',
      'refunded',
      'revenuecat_webhook',
      'refund do suporte',
      {
        entitlement: activeEntitlement({
          active: false,
          status: 'refunded',
          expiresAt: NOW,
          providerObservedAt: '2026-09-06T12:01:00.000Z',
          willRenew: false,
        }),
        eventId: 'refund-event',
        eventType: 'CANCELLATION',
        eventAmount: -31.47,
        refundAmount: -31.47,
        amount: null,
        currency: 'BRL',
      },
    );

    expect(mockDb.store.get('payment_orders/order-performance')).toMatchObject({
      amount: 31.47,
      refundAmount: -31.47,
      status: 'refunded',
    });
    expect(mockDb.store.get('webhook_events/refund-event')).toMatchObject({
      amount: null,
      eventAmount: -31.47,
      refundAmount: -31.47,
      currency: 'BRL',
      status: 'processed',
    });
  });

  test('valor informativo zero de lifecycle não zera amount positivo do pedido', async () => {
    mockDb.store.set('payment_orders/order-performance', {
      ...mockDb.store.get('payment_orders/order-performance'),
      amount: 31.47,
    });
    await revokeProAccess(
      'order-performance',
      'store-tx-1',
      'expired',
      'revenuecat_webhook',
      'expiração',
      {
        entitlement: activeEntitlement({
          active: false,
          status: 'expired',
          expiresAt: NOW,
          providerObservedAt: '2026-09-06T12:01:00.000Z',
          willRenew: false,
        }),
        eventId: 'expiration-zero-event',
        eventType: 'EXPIRATION',
        eventAmount: 0,
        amount: null,
        currency: 'BRL',
      },
    );

    expect(mockDb.store.get('payment_orders/order-performance').amount).toBe(31.47);
    expect(mockDb.store.get('webhook_events/expiration-zero-event')).toMatchObject({
      amount: null,
      eventAmount: 0,
    });
  });

  test('INITIAL_PURCHASE gratuito preserva amount zero como cobrança legítima', async () => {
    await grantProAccessAfterApprovedPayment(
      'order-performance',
      'trial-tx',
      'revenuecat_webhook',
      {
        entitlement: activeEntitlement({ transactionId: 'trial-tx' }),
        eventId: 'free-trial-event',
        eventType: 'INITIAL_PURCHASE',
        eventOccurredAt: NOW,
        eventTransactionId: 'trial-tx',
        eventAmount: 0,
        amount: 0,
        currency: 'BRL',
      },
    );

    expect(mockDb.store.get('payment_orders/order-performance')).toMatchObject({
      amount: 0,
      amountSource: 'revenuecat_webhook',
    });
    expect(mockDb.store.get('webhook_events/free-trial-event')).toMatchObject({
      amount: 0,
      eventAmount: 0,
    });
  });

  test('snapshot ativo antigo não reabre entitlement já expirado por observação mais nova', async () => {
    mockDb.store.set('users/user-A', {
      subscriptionTier: 'open',
      proEntitlement: {
        tier: 'performance', status: 'expired', expiresAt: NOW,
        providerObservedAt: '2026-09-06T12:05:00.000Z',
      },
    });
    mockDb.store.set('payment_orders/order-performance', {
      ...mockDb.store.get('payment_orders/order-performance'),
      providerObservedAt: '2026-09-06T12:05:00.000Z',
      provisionStatus: 'revoked',
    });

    const result = await grantProAccessAfterApprovedPayment(
      'order-performance',
      'old-renewal',
      'revenuecat_webhook',
      {
        entitlement: activeEntitlement({ providerObservedAt: '2026-09-06T12:00:00.000Z' }),
        eventId: 'old-event',
        eventType: 'RENEWAL',
      }
    );

    expect(result.stale).toBe(true);
    expect(mockDb.store.get('users/user-A').subscriptionTier).toBe('open');
    expect(mockDb.store.get('payment_orders/order-performance').provisionStatus).toBe('revoked');
    expect(mockDb.store.get('webhook_events/old-event')).toMatchObject({ outcome: 'ignored_stale_snapshot' });
  });

  test('TRANSFER out impede que snapshot REST atrasado reabra a origem', async () => {
    const transferSnapshot = activeEntitlement({
      active: false,
      status: 'revoked',
      providerObservedAt: '2026-09-06T12:01:00.000Z',
      willRenew: false,
    });
    await revokeProAccess(
      'order-performance',
      'transferred-tx',
      'revoked',
      'revenuecat_webhook',
      'assinatura transferida para outra conta',
      {
        entitlement: transferSnapshot,
        eventId: 'transfer-out-event',
        eventType: 'TRANSFER',
        transferDirection: 'source',
        transferOccurredAt: '2026-09-06T12:00:00.000Z',
        eventTransactionId: 'transferred-tx',
      },
    );

    expect(mockDb.store.get('users/user-A')).toMatchObject({
      subscriptionTier: 'open',
      lastTransferOutAt: '2026-09-06T12:00:00.000Z',
    });
    expect(mockDb.store.get('payment_orders/order-performance')).toMatchObject({
      provisionStatus: 'revoked',
      lastTransferOutAt: '2026-09-06T12:00:00.000Z',
    });

    const delayedRestSnapshot = activeEntitlement({
      purchasedAt: '2026-09-06T10:00:00.000Z',
      providerObservedAt: '2026-09-06T12:02:00.000Z',
    });
    const delayed = await grantProAccessAfterApprovedPayment(
      'order-performance', 'transferred-tx', 'store_android', { entitlement: delayedRestSnapshot },
    );
    expect(delayed.stale).toBe(true);
    expect(mockDb.store.get('users/user-A').subscriptionTier).toBe('open');

    const sameReceiptWithFuturePurchaseDate = await grantProAccessAfterApprovedPayment(
      'order-performance',
      'transferred-tx',
      'store_android',
      { entitlement: activeEntitlement({
        // Algumas respostas do App Store projetam purchase_date no futuro; o
        // mesmo transactionId ainda é o recibo que saiu desta conta.
        purchasedAt: '2026-09-06T12:05:00.000Z',
        providerObservedAt: '2026-09-06T12:04:00.000Z',
        transactionId: 'transferred-tx',
      }) },
    );
    expect(sameReceiptWithFuturePurchaseDate.stale).toBe(true);
    expect(mockDb.store.get('users/user-A').subscriptionTier).toBe('open');

    const nextReceiptReadByVerify = activeEntitlement({
      purchasedAt: '2026-09-06T12:05:00.000Z',
      providerObservedAt: '2026-09-06T12:06:00.000Z',
      transactionId: 'new-store-tx',
    });
    const verifyWithoutPurchaseEvent = await grantProAccessAfterApprovedPayment(
      'order-performance',
      'new-store-tx',
      'store_android',
      { entitlement: nextReceiptReadByVerify },
    );
    expect(verifyWithoutPurchaseEvent.stale).toBe(true);
    expect(mockDb.store.get('users/user-A').subscriptionTier).toBe('open');

    const newPurchase = await grantProAccessAfterApprovedPayment(
      'order-performance',
      'new-store-tx',
      'revenuecat_webhook',
      {
        entitlement: nextReceiptReadByVerify,
        eventId: 'new-purchase-event',
        eventType: 'INITIAL_PURCHASE',
        eventOccurredAt: '2026-09-06T12:05:00.000Z',
        eventTransactionId: 'new-store-tx',
      },
    );
    expect(newPurchase.stale).not.toBe(true);
    expect(mockDb.store.get('users/user-A')).toMatchObject({
      subscriptionTier: 'performance',
      lastTransferOutAt: null,
      lastTransferOutTransactionId: null,
      lastTransferOutTransactionIds: [],
    });
  });

  test('TRANSFER destination posterior supera cutoff mesmo com purchase_date original antiga', async () => {
    await revokeProAccess(
      'order-performance',
      'transferred-out-tx',
      'revoked',
      'revenuecat_webhook',
      'assinatura transferida para fora',
      {
        entitlement: activeEntitlement({
          active: false,
          status: 'revoked',
          providerObservedAt: '2026-09-06T12:01:00.000Z',
          willRenew: false,
        }),
        eventId: 'transfer-out-event',
        eventType: 'TRANSFER',
        transferDirection: 'source',
        transferOccurredAt: '2026-09-06T12:00:00.000Z',
        eventTransactionId: 'transferred-out-tx',
      },
    );

    const oldDestination = await grantProAccessAfterApprovedPayment(
      'order-performance',
      'old-transfer-in-tx',
      'revenuecat_webhook',
      {
        entitlement: activeEntitlement({
          purchasedAt: '2026-09-01T10:00:00.000Z',
          providerObservedAt: '2026-09-06T12:02:00.000Z',
          transactionId: 'old-transfer-in-tx',
        }),
        eventId: 'old-transfer-in-event',
        eventType: 'TRANSFER',
        transferDirection: 'destination',
        transferOccurredAt: '2026-09-06T11:59:00.000Z',
        eventTransactionId: 'old-transfer-in-tx',
      },
    );
    expect(oldDestination.stale).toBe(true);
    expect(mockDb.store.get('users/user-A').subscriptionTier).toBe('open');

    const destination = await grantProAccessAfterApprovedPayment(
      'order-performance',
      'new-transfer-in-tx',
      'revenuecat_webhook',
      {
        entitlement: activeEntitlement({
          // A data pertence ao recibo original e, por isso, antecede o cutoff.
          purchasedAt: '2026-09-01T10:00:00.000Z',
          providerObservedAt: '2026-09-06T12:06:00.000Z',
          transactionId: 'new-transfer-in-tx',
        }),
        eventId: 'new-transfer-in-event',
        eventType: 'TRANSFER',
        transferDirection: 'destination',
        transferOccurredAt: '2026-09-06T12:05:00.000Z',
        eventTransactionId: 'new-transfer-in-tx',
      },
    );

    expect(destination.stale).not.toBe(true);
    expect(mockDb.store.get('users/user-A')).toMatchObject({
      subscriptionTier: 'performance',
      lastTransferInAt: '2026-09-06T12:05:00.000Z',
      lastTransferOutAt: null,
      lastTransferOutTransactionId: null,
    });
    expect(mockDb.store.get('payment_orders/order-performance')).toMatchObject({
      provisionStatus: 'applied',
      lastTransferInAt: '2026-09-06T12:05:00.000Z',
      lastTransferOutAt: null,
      lastTransferOutTransactionId: null,
    });
  });

  test('TRANSFER source sem transaction_id preserva receipt canônico para bloquear REST atrasado', async () => {
    mockDb.store.set('payment_orders/order-performance', {
      ...mockDb.store.get('payment_orders/order-performance'),
      status: 'approved',
      paymentStatus: 'approved',
      provisionStatus: 'applied',
      transactionId: 'transferred-store-tx',
      providerObservedAt: '2026-09-06T11:59:00.000Z',
    });
    mockDb.store.set('users/user-A', {
      ...mockDb.store.get('users/user-A'),
      subscriptionTier: 'performance',
      isSubscribed: true,
      isPro: true,
      proEntitlement: {
        status: 'active',
        transactionId: 'transferred-store-tx',
        expiresAt: FUTURE,
        providerObservedAt: '2026-09-06T11:59:00.000Z',
      },
    });

    await revokeProAccess(
      'order-performance',
      'transfer-event-without-tx',
      'revoked',
      'revenuecat_webhook',
      'TRANSFER oficial sem transaction_id',
      {
        entitlement: activeEntitlement({
          active: false,
          status: 'revoked',
          transactionId: null,
          providerObservedAt: '2026-09-06T12:01:00.000Z',
          willRenew: false,
        }),
        eventId: 'transfer-event-without-tx',
        eventType: 'TRANSFER',
        transferDirection: 'source',
        transferOccurredAt: '2026-09-06T12:00:00.000Z',
      },
    );

    expect(mockDb.store.get('payment_orders/order-performance')).toMatchObject({
      transactionId: 'transferred-store-tx',
      lastTransferOutTransactionId: 'transferred-store-tx',
      lastTransferOutTransactionIds: expect.arrayContaining([
        'transferred-store-tx', 'transfer-event-without-tx',
      ]),
    });

    const delayed = await grantProAccessAfterApprovedPayment(
      'order-performance',
      'transferred-store-tx',
      'store_ios',
      { entitlement: activeEntitlement({
        transactionId: 'transferred-store-tx',
        purchasedAt: '2026-09-06T12:05:00.000Z',
        providerObservedAt: '2026-09-06T12:02:00.000Z',
      }) },
    );
    expect(delayed.stale).toBe(true);
    expect(mockDb.store.get('users/user-A').subscriptionTier).toBe('open');
  });

  test('TRANSFER source revoga mesmo contra providerObservedAt concorrente posterior', async () => {
    await grantProAccessAfterApprovedPayment(
      'order-performance',
      'store-tx-1',
      'verify',
      { entitlement: activeEntitlement({ providerObservedAt: '2026-09-06T12:10:00.000Z' }) },
    );

    const result = await revokeProAccess(
      'order-performance',
      'transferred-tx',
      'revoked',
      'revenuecat_webhook',
      'transferência autoritativa da origem',
      {
        entitlement: activeEntitlement({
          active: false,
          status: 'revoked',
          providerObservedAt: '2026-09-06T12:05:00.000Z',
          willRenew: false,
        }),
        eventId: 'authoritative-transfer-out',
        eventType: 'TRANSFER',
        transferDirection: 'source',
        transferOccurredAt: '2026-09-06T12:06:00.000Z',
        eventTransactionId: 'transferred-tx',
      },
    );

    expect(result.stale).toBe(false);
    expect(mockDb.store.get('users/user-A')).toMatchObject({
      subscriptionTier: 'open',
      lastTransferOutAt: '2026-09-06T12:06:00.000Z',
      lastTransferOutTransactionId: 'store-tx-1',
      lastTransferOutTransactionIds: expect.arrayContaining(['store-tx-1', 'transferred-tx']),
    });
    expect(mockDb.store.get('payment_orders/order-performance')).toMatchObject({
      provisionStatus: 'revoked',
      lastTransferOutAt: '2026-09-06T12:06:00.000Z',
    });
  });

  test('TRANSFER source antigo não revoga depois de um transfer-in mais novo', async () => {
    mockDb.store.set('users/user-A', {
      ...mockDb.store.get('users/user-A'),
      subscriptionTier: 'performance',
      isSubscribed: true,
      isPro: true,
      premium: true,
      lastTransferInAt: '2026-09-06T12:10:00.000Z',
      proEntitlement: {
        status: 'active',
        providerObservedAt: '2026-09-06T12:11:00.000Z',
        expiresAt: FUTURE,
      },
    });
    mockDb.store.set('payment_orders/order-performance', {
      ...mockDb.store.get('payment_orders/order-performance'),
      status: 'approved',
      paymentStatus: 'approved',
      provisionStatus: 'applied',
      providerObservedAt: '2026-09-06T12:11:00.000Z',
      lastTransferInAt: '2026-09-06T12:10:00.000Z',
    });

    const result = await revokeProAccess(
      'order-performance',
      'old-transfer-out-tx',
      'revoked',
      'revenuecat_webhook',
      'entrega antiga fora de ordem',
      {
        entitlement: activeEntitlement({
          active: false,
          status: 'revoked',
          providerObservedAt: '2026-09-06T12:20:00.000Z',
          willRenew: false,
        }),
        eventId: 'old-transfer-out',
        eventType: 'TRANSFER',
        transferDirection: 'source',
        transferOccurredAt: '2026-09-06T12:05:00.000Z',
        eventTransactionId: 'old-transfer-out-tx',
      },
    );

    expect(result.stale).toBe(true);
    expect(mockDb.store.get('users/user-A')).toMatchObject({
      subscriptionTier: 'performance',
      isPro: true,
      lastTransferInAt: '2026-09-06T12:10:00.000Z',
    });
    expect(mockDb.store.get('users/user-A').lastTransferOutAt).toBeUndefined();
    expect(mockDb.store.get('webhook_events/old-transfer-out')).toMatchObject({
      status: 'processed',
      outcome: 'ignored_superseded_transfer_out',
    });
  });

  test('TRANSFER source atrasado não apaga INITIAL_PURCHASE posterior já comprovada', async () => {
    await grantProAccessAfterApprovedPayment(
      'order-performance',
      'new-purchase-tx',
      'revenuecat_webhook',
      {
        entitlement: activeEntitlement({
          transactionId: 'new-purchase-tx',
          purchasedAt: '2026-09-06T12:05:00.000Z',
          providerObservedAt: '2026-09-06T12:06:00.000Z',
        }),
        eventId: 'new-purchase-event',
        eventType: 'INITIAL_PURCHASE',
        eventOccurredAt: '2026-09-06T12:05:00.000Z',
        eventTransactionId: 'new-purchase-tx',
      },
    );
    expect(mockDb.store.get('users/user-A')).toMatchObject({
      subscriptionTier: 'performance',
      lastRevenueCatPurchaseEventAt: '2026-09-06T12:05:00.000Z',
      lastRevenueCatPurchaseEventType: 'INITIAL_PURCHASE',
      lastRevenueCatPurchaseEventTransactionId: 'new-purchase-tx',
    });

    const delayedTransfer = await revokeProAccess(
      'order-performance',
      'delayed-transfer-event',
      'revoked',
      'revenuecat_webhook',
      'TRANSFER T1 entregue depois da compra T2',
      {
        entitlement: activeEntitlement({
          active: false,
          status: 'revoked',
          transactionId: null,
          providerObservedAt: '2026-09-06T12:10:00.000Z',
          willRenew: false,
        }),
        eventId: 'delayed-transfer-event',
        eventType: 'TRANSFER',
        transferDirection: 'source',
        transferOccurredAt: '2026-09-06T12:00:00.000Z',
      },
    );

    expect(delayedTransfer.stale).toBe(true);
    expect(mockDb.store.get('users/user-A')).toMatchObject({
      subscriptionTier: 'performance',
      isPro: true,
      lastRevenueCatPurchaseEventTransactionId: 'new-purchase-tx',
    });
    expect(mockDb.store.get('webhook_events/delayed-transfer-event')).toMatchObject({
      status: 'processed', outcome: 'ignored_superseded_transfer_out',
    });
  });

  test('o mesmo event.id é idempotente e não duplica auditoria', async () => {
    const context = {
      entitlement: activeEntitlement(),
      eventId: 'same-event',
      eventType: 'RENEWAL',
    };
    await grantProAccessAfterApprovedPayment('order-performance', 'store-tx-1', 'webhook', context);
    const auditCount = [...mockDb.store.keys()].filter((key) => key.startsWith('payment_audit_logs/')).length;

    const repeated = await grantProAccessAfterApprovedPayment('order-performance', 'store-tx-1', 'webhook', context);

    expect(repeated.duplicate).toBe(true);
    expect([...mockDb.store.keys()].filter((key) => key.startsWith('payment_audit_logs/'))).toHaveLength(auditCount);
  });

  test('falha de commit deixa provisionamento recuperável e o retry aplica o benefício', async () => {
    mockDb.failNextTransactionCommit();
    await expect(grantProAccessAfterApprovedPayment(
      'order-performance', 'store-tx-1', 'verify', { entitlement: activeEntitlement() }
    )).rejects.toThrow('simulated transaction commit failure');

    expect(mockDb.store.get('users/user-A')).toMatchObject({ subscriptionTier: 'open', premium: false });
    expect(mockDb.store.get('payment_orders/order-performance')).toMatchObject({
      status: 'processing', paymentStatus: 'approved', provisionStatus: 'retryable_error',
    });

    await grantProAccessAfterApprovedPayment(
      'order-performance', 'store-tx-1', 'verify_retry', { entitlement: activeEntitlement() }
    );
    expect(mockDb.store.get('payment_orders/order-performance')).toMatchObject({
      status: 'approved', paymentStatus: 'approved', provisionStatus: 'applied',
    });
    expect(mockDb.store.get('users/user-A')).toMatchObject({ subscriptionTier: 'performance', isPro: true });
  });

  test('grant, revoke e Open nunca recriam perfil ausente ou tombstonado', async () => {
    mockDb.store.delete('users/user-A');
    await expect(grantProAccessAfterApprovedPayment(
      'order-performance', 'store-tx-1', 'webhook', { entitlement: activeEntitlement() }
    )).rejects.toMatchObject({ code: 'BILLING_USER_UNAVAILABLE' });
    expect(mockDb.store.has('users/user-A')).toBe(false);
    expect(mockDb.store.has('user_entitlements/user-A_invictus_performance')).toBe(false);
    expect(mockDb.store.get('payment_orders/order-performance')).toMatchObject({
      status: 'pending', paymentStatus: 'pending', provisionStatus: 'pending',
    });

    mockDb.store.set('users/user-A', { deleted: true, deletedAt: NOW });
    await expect(revokeProAccess(
      'order-performance', 'store-tx-1', 'expired', 'webhook', 'perfil apagado',
      { entitlement: activeEntitlement({ active: false, status: 'expired', expiresAt: NOW }) }
    )).rejects.toMatchObject({ code: 'BILLING_USER_UNAVAILABLE' });
    expect(mockDb.store.get('users/user-A')).toEqual({ deleted: true, deletedAt: NOW });

    mockDb.store.set('payment_orders/order-open', {
      orderId: 'order-open', userId: 'user-A', planId: 'invictus_open', status: 'pending',
    });
    await expect(activateOpenPlan('order-open', 'open-payment', 'open')).rejects.toMatchObject({
      code: 'BILLING_USER_UNAVAILABLE',
    });
    expect(mockDb.store.has('user_entitlements/user-A_invictus_open')).toBe(false);
  });

  test('dedupe pode usar event.id+UID sem perder o ID original do provedor', async () => {
    await grantProAccessAfterApprovedPayment(
      'order-performance',
      'store-tx-1',
      'revenuecat_webhook',
      {
        entitlement: activeEntitlement(),
        eventId: 'provider-event',
        eventDocumentId: 'provider-event__dXNlci1B',
        eventType: 'TRANSFER',
        transferDirection: 'destination',
      }
    );

    expect(mockDb.store.get('webhook_events/provider-event__dXNlci1B')).toMatchObject({
      eventId: 'provider-event',
      providerEventId: 'provider-event',
      eventDocumentId: 'provider-event__dXNlci1B',
      transferDirection: 'destination',
      status: 'processed',
    });
    expect(mockDb.store.has('webhook_events/provider-event')).toBe(false);
  });

  test('grant recusa SANDBOX por padrão mesmo que o snapshot esteja marcado ativo', async () => {
    delete process.env.REVENUECAT_ALLOWED_ENVIRONMENTS;
    await expect(grantProAccessAfterApprovedPayment(
      'order-performance',
      'store-tx-1',
      'verify',
      { entitlement: activeEntitlement({ environment: 'SANDBOX' }) }
    )).rejects.toThrow('entitlement RevenueCat ativo');
    expect(mockDb.store.get('payment_orders/order-performance')).toMatchObject({ status: 'pending' });
    expect(mockDb.store.get('users/user-A')).toMatchObject({ subscriptionTier: 'open' });
  });
});

describe('normalização da fonte RevenueCat', () => {
  const originalFetch = global.fetch;
  const originalSecret = process.env.REVENUECAT_SECRET_API_KEY;
  const originalProducts = process.env.REVENUECAT_PERFORMANCE_PRODUCT_IDS;
  const originalProduct = process.env.REVENUECAT_PERFORMANCE_PRODUCT_ID;
  const originalViteProduct = process.env.VITE_REVENUECAT_PERFORMANCE_PRODUCT_ID;
  const originalEnvironments = process.env.REVENUECAT_ALLOWED_ENVIRONMENTS;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date(NOW));
    process.env.REVENUECAT_SECRET_API_KEY = 'secret-key';
    process.env.REVENUECAT_PERFORMANCE_PRODUCT_IDS = 'invictus.performance.monthly';
    delete process.env.REVENUECAT_ALLOWED_ENVIRONMENTS;
  });

  afterEach(() => {
    jest.useRealTimers();
    global.fetch = originalFetch;
    if (originalSecret === undefined) delete process.env.REVENUECAT_SECRET_API_KEY;
    else process.env.REVENUECAT_SECRET_API_KEY = originalSecret;
    if (originalProducts === undefined) delete process.env.REVENUECAT_PERFORMANCE_PRODUCT_IDS;
    else process.env.REVENUECAT_PERFORMANCE_PRODUCT_IDS = originalProducts;
    if (originalProduct === undefined) delete process.env.REVENUECAT_PERFORMANCE_PRODUCT_ID;
    else process.env.REVENUECAT_PERFORMANCE_PRODUCT_ID = originalProduct;
    if (originalViteProduct === undefined) delete process.env.VITE_REVENUECAT_PERFORMANCE_PRODUCT_ID;
    else process.env.VITE_REVENUECAT_PERFORMANCE_PRODUCT_ID = originalViteProduct;
    if (originalEnvironments === undefined) delete process.env.REVENUECAT_ALLOWED_ENVIRONMENTS;
    else process.env.REVENUECAT_ALLOWED_ENVIRONMENTS = originalEnvironments;
  });

  test('usa produto, transação, store e expiração reais sem fabricar duração', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        request_date: NOW,
        subscriber: {
          entitlements: {
            invictus_performance_pro: {
              product_identifier: 'invictus.performance.monthly',
              purchase_date: '2026-09-06T10:00:00Z',
              expires_date: '2026-10-06T12:00:00Z',
            },
          },
          subscriptions: {
            'invictus.performance.monthly': {
              purchase_date: '2026-09-06T10:00:00Z',
              expires_date: '2026-10-06T12:00:00Z',
              store: 'play_store',
              store_transaction_id: 'real-transaction',
              is_sandbox: false,
              period_type: 'NORMAL',
            },
          },
        },
      }),
    }) as any;

    await expect(fetchRevenueCatPerformanceEntitlement('uid/with slash')).resolves.toMatchObject({
      active: true,
      status: 'active',
      productId: 'invictus.performance.monthly',
      transactionId: 'real-transaction',
      store: 'PLAY_STORE',
      expiresAt: FUTURE,
    });
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.revenuecat.com/v1/subscribers/uid%2Fwith%20slash',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer secret-key' }) })
    );
  });

  test('produto fora da allowlist e expiração ausente falham fechados', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        request_date: NOW,
        subscriber: {
          entitlements: { invictus_performance_pro: { product_identifier: 'other-product' } },
          subscriptions: { 'other-product': { expires_date: null } },
        },
      }),
    }) as any;

    await expect(fetchRevenueCatPerformanceEntitlement('user-A')).resolves.toMatchObject({
      active: false,
      status: 'inactive',
      productId: 'other-product',
      expiresAt: null,
    });
  });

  test('recusa consultar entitlement sem allowlist de produto configurada', async () => {
    delete process.env.REVENUECAT_PERFORMANCE_PRODUCT_IDS;
    delete process.env.REVENUECAT_PERFORMANCE_PRODUCT_ID;
    delete process.env.VITE_REVENUECAT_PERFORMANCE_PRODUCT_ID;
    global.fetch = jest.fn() as any;

    await expect(fetchRevenueCatPerformanceEntitlement('user-A')).rejects.toThrow(
      'Nenhum produto Performance da RevenueCat está configurado no servidor.'
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('SANDBOX e ambiente ausente falham fechados por padrão; opt-in explícito libera SANDBOX', async () => {
    const responseFor = (isSandbox: boolean | undefined) => ({
      ok: true,
      status: 200,
      json: async () => ({
        request_date: NOW,
        subscriber: {
          entitlements: {
            invictus_performance_pro: {
              product_identifier: 'invictus.performance.monthly',
              expires_date: FUTURE,
            },
          },
          subscriptions: {
            'invictus.performance.monthly': {
              expires_date: FUTURE,
              ...(isSandbox === undefined ? {} : { is_sandbox: isSandbox }),
            },
          },
        },
      }),
    });

    global.fetch = jest.fn().mockResolvedValueOnce(responseFor(true)) as any;
    await expect(fetchRevenueCatPerformanceEntitlement('user-A')).resolves.toMatchObject({
      active: false, status: 'inactive', environment: 'SANDBOX',
    });

    global.fetch = jest.fn().mockResolvedValueOnce(responseFor(undefined)) as any;
    await expect(fetchRevenueCatPerformanceEntitlement('user-A')).resolves.toMatchObject({
      active: false, status: 'inactive', environment: null,
    });

    process.env.REVENUECAT_ALLOWED_ENVIRONMENTS = 'PRODUCTION,SANDBOX';
    global.fetch = jest.fn().mockResolvedValueOnce(responseFor(true)) as any;
    await expect(fetchRevenueCatPerformanceEntitlement('user-A')).resolves.toMatchObject({
      active: true, status: 'active', environment: 'SANDBOX',
    });
  });

  test('SKU legado restaurado é aceito somente quando consta na allowlist do backend', async () => {
    process.env.REVENUECAT_PERFORMANCE_PRODUCT_IDS = [
      'invictus.performance.monthly',
      'invictus.performance.legacy.annual',
    ].join(',');
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        request_date: NOW,
        subscriber: {
          entitlements: {
            invictus_performance_pro: {
              product_identifier: 'invictus.performance.legacy.annual',
              expires_date: FUTURE,
            },
          },
          subscriptions: {
            'invictus.performance.legacy.annual': {
              expires_date: FUTURE,
              store_transaction_id: 'legacy-restored-transaction',
              is_sandbox: false,
            },
          },
        },
      }),
    }) as any;

    await expect(fetchRevenueCatPerformanceEntitlement('user-A')).resolves.toMatchObject({
      active: true,
      status: 'active',
      productId: 'invictus.performance.legacy.annual',
      transactionId: 'legacy-restored-transaction',
      environment: 'PRODUCTION',
    });
  });
});
