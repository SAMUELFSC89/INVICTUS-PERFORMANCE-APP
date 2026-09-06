import webhookHandler from '../_handlers/revenuecat-webhook';
import { db } from '../_lib/common';
import {
  fetchRevenueCatPerformanceEntitlement,
  grantProAccessAfterApprovedPayment,
  revokeProAccess,
} from '../_lib/payments-service';

jest.mock('../_lib/common', () => ({
  db: { collection: jest.fn(), runTransaction: jest.fn() },
  cors: jest.fn(() => false),
}));
jest.mock('../_lib/payments-service', () => ({
  BillingUserUnavailableError: class BillingUserUnavailableError extends Error {
    code = 'BILLING_USER_UNAVAILABLE';
    constructor(public userId: string) { super(`missing ${userId}`); }
  },
  fetchRevenueCatPerformanceEntitlement: jest.fn(),
  grantProAccessAfterApprovedPayment: jest.fn(),
  isBillingUserProfileAvailable: jest.fn((profile: any) => Boolean(profile)
    && profile.deleted !== true && !profile.deletedAt && profile.tombstone !== true),
  isBillingUserUnavailableError: jest.fn((error: any) => error?.code === 'BILLING_USER_UNAVAILABLE'),
  isRevenueCatEnvironmentAllowed: jest.fn((environment: unknown) => {
    const allowed = (process.env.REVENUECAT_ALLOWED_ENVIRONMENTS || 'PRODUCTION')
      .split(',').map((value) => value.trim().toUpperCase());
    return typeof environment === 'string' && allowed.includes(environment.toUpperCase());
  }),
  revokeProAccess: jest.fn(),
}));

const TOKEN = 'webhook-secret-with-enough-entropy';
const NOW = Date.parse('2026-09-06T12:00:00.000Z');
const FUTURE = Date.parse('2026-10-01T00:00:00.000Z');
type Stored = Record<string, any>;
let store: Map<string, Stored>;
let transactionQueue: Promise<unknown>;
let snapshotByUser: Record<string, Stored>;

function eventKey(eventId: string, transferUserId?: string) {
  return transferUserId
    ? `webhook_events/${eventId}__${Buffer.from(transferUserId).toString('base64url')}`
    : `webhook_events/${eventId}`;
}

function snapshot(value: Stored | undefined) {
  return { exists: value !== undefined, data: () => value };
}

function response() {
  const res: any = {
    statusCode: 0,
    body: undefined,
    status: jest.fn((code: number) => { res.statusCode = code; return res; }),
    json: jest.fn((body: any) => { res.body = body; return res; }),
  };
  return res;
}

function request(eventOverrides: Record<string, unknown> = {}, authorization = `Bearer ${TOKEN}`) {
  return {
    method: 'POST',
    headers: { authorization },
    body: {
      event: {
        id: 'event-1',
        type: 'RENEWAL',
        app_user_id: 'firebase-user-A',
        original_app_user_id: 'firebase-user-A',
        aliases: ['firebase-user-A'],
        entitlement_ids: ['performance'],
        transaction_id: 'store-transaction-1',
        product_id: 'invictus.performance.monthly',
        store: 'PLAY_STORE',
        environment: 'PRODUCTION',
        event_timestamp_ms: NOW,
        expiration_at_ms: FUTURE,
        price_in_purchased_currency: 31.47,
        currency: 'brl',
        ...eventOverrides,
      },
    },
  } as any;
}

const activeSnapshot = {
  active: true,
  status: 'active',
  productId: 'invictus.performance.monthly',
  purchasedAt: '2026-09-01T00:00:00.000Z',
  expiresAt: '2026-10-01T00:00:00.000Z',
  gracePeriodExpiresAt: null,
  providerObservedAt: '2026-09-06T12:00:00.000Z',
  transactionId: 'store-transaction-1',
  store: 'PLAY_STORE',
  environment: 'PRODUCTION',
  periodType: 'NORMAL',
  willRenew: true,
};

function installDbMock() {
  (db.collection as jest.Mock).mockImplementation((collection: string) => ({
    doc: (id: string) => {
      const key = `${collection}/${id}`;
      return {
        key,
        get: async () => snapshot(store.get(key)),
        set: async (data: Stored, options?: { merge?: boolean }) => {
          store.set(key, options?.merge ? { ...(store.get(key) || {}), ...data } : { ...data });
        },
      };
    },
  }));
  (db.runTransaction as jest.Mock).mockImplementation((callback: (transaction: any) => Promise<any>) => {
    const run = transactionQueue.then(async () => {
      const writes: Array<{ target: any; data: Stored; merge: boolean }> = [];
      const result = await callback({
        get: async (target: any) => snapshot(store.get(target.key)),
        set: (target: any, data: Stored, options?: { merge?: boolean }) => {
          writes.push({ target, data, merge: options?.merge === true });
        },
      });
      for (const write of writes) {
        store.set(write.target.key, write.merge
          ? { ...(store.get(write.target.key) || {}), ...write.data }
          : { ...write.data });
      }
      return result;
    });
    transactionQueue = run.then(() => undefined, () => undefined);
    return run;
  });
}

function installProvisioningMocks() {
  (grantProAccessAfterApprovedPayment as jest.Mock).mockImplementation(async (
    orderId: string, _paymentId: string, _source: string, context: any,
  ) => {
    const key = `webhook_events/${context.eventDocumentId}`;
    if (store.get(key)?.status === 'processed') return { success: true, duplicate: true };
    store.set(`payment_orders/${orderId}`, {
      ...(store.get(`payment_orders/${orderId}`) || {}),
      status: 'approved', paymentStatus: 'approved', provisionStatus: 'applied',
    });
    store.set(key, {
      ...(store.get(key) || {}),
      eventId: context.eventId,
      providerEventId: context.eventId,
      userId: orderId.replace('order_performance_', ''),
      status: 'processed',
      outcome: 'provisioned',
      transferDirection: context.transferDirection || null,
      amount: context.amount ?? null,
      eventAmount: context.eventAmount ?? null,
      refundAmount: context.refundAmount ?? null,
    });
    return { success: true, duplicate: false, stale: false };
  });
  (revokeProAccess as jest.Mock).mockImplementation(async (
    orderId: string, _paymentId: string, status: string, _source: string, _reason: string, context: any,
  ) => {
    const key = `webhook_events/${context.eventDocumentId}`;
    if (store.get(key)?.status === 'processed') return { success: true, duplicate: true };
    store.set(`payment_orders/${orderId}`, {
      ...(store.get(`payment_orders/${orderId}`) || {}),
      status, paymentStatus: status, provisionStatus: 'revoked',
      ...(typeof context.refundAmount === 'number' ? { refundAmount: context.refundAmount } : {}),
    });
    store.set(key, {
      ...(store.get(key) || {}),
      eventId: context.eventId,
      providerEventId: context.eventId,
      userId: orderId.replace('order_performance_', ''),
      status: 'processed',
      outcome: 'revoked',
      transferDirection: context.transferDirection || null,
      amount: context.amount ?? null,
      eventAmount: context.eventAmount ?? null,
      refundAmount: context.refundAmount ?? null,
    });
    return { success: true, duplicate: false, stale: false };
  });
}

describe('RevenueCat webhook', () => {
  const previousToken = process.env.REVENUECAT_WEBHOOK_AUTH_TOKEN;
  const previousEnvironments = process.env.REVENUECAT_ALLOWED_ENVIRONMENTS;
  const previousMaxAttempts = process.env.REVENUECAT_RECONCILIATION_MAX_ATTEMPTS;
  const previousMaxAge = process.env.REVENUECAT_RECONCILIATION_MAX_AGE_MS;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date(NOW));
    process.env.REVENUECAT_WEBHOOK_AUTH_TOKEN = TOKEN;
    delete process.env.REVENUECAT_ALLOWED_ENVIRONMENTS;
    delete process.env.REVENUECAT_RECONCILIATION_MAX_ATTEMPTS;
    delete process.env.REVENUECAT_RECONCILIATION_MAX_AGE_MS;
    store = new Map([
      ['users/firebase-user-A', { status: 'OPEN_ATIVO', subscriptionTier: 'open' }],
    ]);
    snapshotByUser = { 'firebase-user-A': activeSnapshot };
    transactionQueue = Promise.resolve();
    installDbMock();
    installProvisioningMocks();
    (fetchRevenueCatPerformanceEntitlement as jest.Mock).mockImplementation(async (userId: string) => (
      snapshotByUser[userId] || { ...activeSnapshot, active: false, status: 'inactive', productId: null }
    ));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  afterAll(() => {
    if (previousToken === undefined) delete process.env.REVENUECAT_WEBHOOK_AUTH_TOKEN;
    else process.env.REVENUECAT_WEBHOOK_AUTH_TOKEN = previousToken;
    if (previousEnvironments === undefined) delete process.env.REVENUECAT_ALLOWED_ENVIRONMENTS;
    else process.env.REVENUECAT_ALLOWED_ENVIRONMENTS = previousEnvironments;
    if (previousMaxAttempts === undefined) delete process.env.REVENUECAT_RECONCILIATION_MAX_ATTEMPTS;
    else process.env.REVENUECAT_RECONCILIATION_MAX_ATTEMPTS = previousMaxAttempts;
    if (previousMaxAge === undefined) delete process.env.REVENUECAT_RECONCILIATION_MAX_AGE_MS;
    else process.env.REVENUECAT_RECONCILIATION_MAX_AGE_MS = previousMaxAge;
  });

  test('rejeita token incorreto sem consultar nem gravar dados', async () => {
    const res = response();
    await webhookHandler(request({}, 'Bearer incorrect'), res);
    expect(res.statusCode).toBe(401);
    expect(fetchRevenueCatPerformanceEntitlement).not.toHaveBeenCalled();
    expect(db.collection).not.toHaveBeenCalled();
  });

  test.each([
    ['id', { id: '' }],
    ['type', { type: '' }],
    ['identidade', { app_user_id: '', original_app_user_id: '', aliases: [] }],
  ])('exige %s', async (_field, overrides) => {
    const res = response();
    await webhookHandler(request(overrides), res);
    expect(res.statusCode).toBe(400);
    expect(fetchRevenueCatPerformanceEntitlement).not.toHaveBeenCalled();
  });

  test('ignora entitlement alheia sem consultar o assinante', async () => {
    const res = response();
    await webhookHandler(request({ entitlement_ids: ['other'] }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.ignored).toBe(true);
    expect(fetchRevenueCatPerformanceEntitlement).not.toHaveBeenCalled();
  });

  test('PRODUCTION é padrão e SANDBOX exige opt-in explícito', async () => {
    const denied = response();
    await webhookHandler(request({ environment: 'SANDBOX' }), denied);
    expect(denied.statusCode).toBe(200);
    expect(denied.body.ignored).toBe(true);
    expect(fetchRevenueCatPerformanceEntitlement).not.toHaveBeenCalled();

    process.env.REVENUECAT_ALLOWED_ENVIRONMENTS = 'PRODUCTION,SANDBOX';
    snapshotByUser['firebase-user-A'] = { ...activeSnapshot, environment: 'SANDBOX' };
    const allowed = response();
    await webhookHandler(request({ environment: 'SANDBOX' }), allowed);
    expect(allowed.statusCode).toBe(200);
    expect(grantProAccessAfterApprovedPayment).toHaveBeenCalled();
  });

  test('retorna idempotentemente pela chave global event.id em evento normal', async () => {
    store.set(eventKey('event-1'), {
      eventId: 'event-1', userId: 'firebase-user-A', status: 'processed',
    });
    const res = response();
    await webhookHandler(request(), res);
    expect(res.body).toMatchObject({ received: true, duplicate: true });
    expect(fetchRevenueCatPerformanceEntitlement).not.toHaveBeenCalled();
  });

  test('EXPIRATION de período antigo mantém acesso quando existe compra ativa posterior', async () => {
    const res = response();
    await webhookHandler(request({
      type: 'EXPIRATION',
      transaction_id: 'old-store-transaction',
      purchased_at_ms: Date.parse('2026-08-01T00:00:00.000Z'),
      expiration_at_ms: Date.parse('2026-08-31T00:00:00.000Z'),
      // A emissão pode ser antecipada no App Store e não participa da decisão.
      event_timestamp_ms: NOW,
    }), res);

    expect(res.statusCode).toBe(200);
    expect(grantProAccessAfterApprovedPayment).toHaveBeenCalledWith(
      'order_performance_firebase-user-A',
      'old-store-transaction',
      'revenuecat_webhook',
      expect.objectContaining({
        eventId: 'event-1', eventType: 'EXPIRATION', amount: null, eventAmount: 31.47, currency: 'BRL',
        entitlement: activeSnapshot,
      }),
    );
    expect(revokeProAccess).not.toHaveBeenCalled();
  });

  test('RENEWAL antigo não reativa quando sua validade já passou e snapshot está expirado', async () => {
    const expiredSnapshot = {
      ...activeSnapshot, active: false, status: 'expired', expiresAt: '2026-09-01T00:00:00.000Z', willRenew: false,
    };
    snapshotByUser['firebase-user-A'] = expiredSnapshot;
    const res = response();
    await webhookHandler(request({ type: 'RENEWAL', expiration_at_ms: Date.parse('2026-09-01T00:00:00.000Z') }), res);

    expect(res.statusCode).toBe(200);
    expect(revokeProAccess).toHaveBeenCalledWith(
      'order_performance_firebase-user-A',
      'store-transaction-1',
      'expired',
      'revenuecat_webhook',
      expect.stringContaining('RENEWAL'),
      expect.objectContaining({ entitlement: expiredSnapshot, eventId: 'event-1' }),
    );
    expect(grantProAccessAfterApprovedPayment).not.toHaveBeenCalled();
  });

  test('REFUND atual com REST ainda ativo fica pending_reconciliation e pede retry', async () => {
    const res = response();
    await webhookHandler(request({ type: 'REFUND', event_timestamp_ms: NOW }), res);

    expect(res.statusCode).toBe(500);
    expect(res.body.retryable).toBe(true);
    expect(store.get(eventKey('event-1'))).toMatchObject({
      status: 'pending_reconciliation', outcome: 'provider_snapshot_not_yet_consistent',
    });
    expect(grantProAccessAfterApprovedPayment).not.toHaveBeenCalled();
    expect(revokeProAccess).not.toHaveBeenCalled();
  });

  test('CANCELLATION CUSTOMER_SUPPORT negativo concilia como refund sem alterar a cobrança', async () => {
    store.set('payment_orders/order_performance_firebase-user-A', {
      orderId: 'order_performance_firebase-user-A',
      userId: 'firebase-user-A',
      planId: 'invictus_performance',
      amount: 31.47,
      status: 'approved',
      paymentStatus: 'approved',
      provisionStatus: 'applied',
    });
    const refundRequest = request({
      type: 'CANCELLATION',
      cancel_reason: 'CUSTOMER_SUPPORT',
      price_in_purchased_currency: -31.47,
      purchased_at_ms: Date.parse('2026-09-01T00:00:00.000Z'),
      expiration_at_ms: FUTURE,
    });

    const first = response();
    await webhookHandler(refundRequest, first);
    expect(first.statusCode).toBe(500);
    expect(store.get(eventKey('event-1'))).toMatchObject({
      status: 'pending_reconciliation',
      eventAmount: -31.47,
      refundAmount: -31.47,
      currency: 'BRL',
    });

    snapshotByUser['firebase-user-A'] = {
      ...activeSnapshot,
      active: false,
      status: 'refunded',
      providerObservedAt: '2026-09-06T12:01:00.000Z',
      willRenew: false,
    };
    const second = response();
    await webhookHandler(refundRequest, second);

    expect(second.statusCode).toBe(200);
    expect(revokeProAccess).toHaveBeenCalledWith(
      'order_performance_firebase-user-A',
      'store-transaction-1',
      'refunded',
      'revenuecat_webhook',
      expect.stringContaining('-31.47 BRL'),
      expect.objectContaining({
        amount: null,
        eventAmount: -31.47,
        refundAmount: -31.47,
      }),
    );
    expect(store.get('payment_orders/order_performance_firebase-user-A')).toMatchObject({
      amount: 31.47,
      refundAmount: -31.47,
    });
    expect(store.get(eventKey('event-1'))).toMatchObject({
      status: 'processed',
      eventAmount: -31.47,
      refundAmount: -31.47,
    });
  });

  test('CANCELLATION com preço negativo é refund mesmo quando cancel_reason não vem', async () => {
    const res = response();
    await webhookHandler(request({
      type: 'CANCELLATION',
      cancel_reason: undefined,
      price_in_purchased_currency: -9.99,
      purchased_at_ms: Date.parse('2026-09-01T00:00:00.000Z'),
      expiration_at_ms: FUTURE,
    }), res);

    expect(res.statusCode).toBe(500);
    expect(store.get(eventKey('event-1'))).toMatchObject({
      status: 'pending_reconciliation',
      eventAmount: -9.99,
      refundAmount: -9.99,
    });
    expect(grantProAccessAfterApprovedPayment).not.toHaveBeenCalled();
  });

  test('preço null permanece null no audit em vez de virar zero', async () => {
    const res = response();
    await webhookHandler(request({
      type: 'CANCELLATION',
      cancel_reason: 'UNSUBSCRIBE_DETECTED',
      price_in_purchased_currency: null,
      price: null,
    }), res);

    expect(res.statusCode).toBe(200);
    expect(grantProAccessAfterApprovedPayment).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      'revenuecat_webhook',
      expect.objectContaining({ amount: null, eventAmount: null, refundAmount: null }),
    );
    expect(store.get(eventKey('event-1'))).toMatchObject({
      amount: null, eventAmount: null, refundAmount: null,
    });
  });

  test.each([
    ['CANCELLATION', 'UNSUBSCRIBE_DETECTED', activeSnapshot, 'grant'],
    ['EXPIRATION', undefined, {
      ...activeSnapshot,
      active: false,
      status: 'expired',
      expiresAt: '2026-09-06T11:00:00.000Z',
      willRenew: false,
    }, 'revoke'],
  ])('%s com preço informativo zero preserva payment_orders.amount', async (
    type, cancelReason, providerSnapshot, expectedAction,
  ) => {
    store.set('payment_orders/order_performance_firebase-user-A', {
      orderId: 'order_performance_firebase-user-A',
      userId: 'firebase-user-A',
      planId: 'invictus_performance',
      amount: 31.47,
      status: 'approved',
      paymentStatus: 'approved',
      provisionStatus: 'applied',
    });
    snapshotByUser['firebase-user-A'] = providerSnapshot as Stored;
    const res = response();
    await webhookHandler(request({
      type,
      cancel_reason: cancelReason,
      price_in_purchased_currency: 0,
      ...(type === 'EXPIRATION' ? { expiration_at_ms: Date.parse('2026-09-06T11:00:00.000Z') } : {}),
    }), res);

    expect(res.statusCode).toBe(200);
    expect(store.get('payment_orders/order_performance_firebase-user-A').amount).toBe(31.47);
    expect(store.get(eventKey('event-1'))).toMatchObject({ eventAmount: 0, amount: null });
    if (expectedAction === 'grant') expect(grantProAccessAfterApprovedPayment).toHaveBeenCalled();
    else expect(revokeProAccess).toHaveBeenCalled();
  });

  test('event_timestamp antigo sozinho não transforma REFUND atual em old_event', async () => {
    const res = response();
    await webhookHandler(request({
      type: 'REFUND',
      transaction_id: 'store-transaction-1',
      purchased_at_ms: Date.parse('2026-09-01T00:00:00.000Z'),
      expiration_at_ms: FUTURE,
      event_timestamp_ms: Date.parse('2026-08-01T00:00:00.000Z'),
    }), res);

    expect(res.statusCode).toBe(500);
    expect(store.get(eventKey('event-1'))).toMatchObject({
      status: 'pending_reconciliation', attempts: 1,
    });
    expect(grantProAccessAfterApprovedPayment).not.toHaveBeenCalled();
  });

  test('RENEWAL atual com REST ainda expirado fica pendente para retry', async () => {
    snapshotByUser['firebase-user-A'] = {
      ...activeSnapshot, active: false, status: 'expired', expiresAt: '2026-09-01T00:00:00.000Z',
    };
    const res = response();
    await webhookHandler(request({ type: 'RENEWAL', expiration_at_ms: FUTURE }), res);

    expect(res.statusCode).toBe(500);
    expect(store.get(eventKey('event-1'))).toMatchObject({ status: 'pending_reconciliation' });
    expect(grantProAccessAfterApprovedPayment).not.toHaveBeenCalled();
    expect(revokeProAccess).not.toHaveBeenCalled();
  });

  test.each(['RENEWAL', 'SUBSCRIPTION_EXTENDED'])(
    '%s ativo aguarda quando o REST ainda mostra validade anterior à do evento',
    async (type) => {
      const res = response();
      await webhookHandler(request({
        type,
        expiration_at_ms: Date.parse('2026-11-01T00:00:00.000Z'),
      }), res);

      expect(res.statusCode).toBe(500);
      expect(store.get(eventKey('event-1'))).toMatchObject({
        status: 'pending_reconciliation', attempts: 1,
      });
      expect(grantProAccessAfterApprovedPayment).not.toHaveBeenCalled();
    },
  );

  test('INITIAL_PURCHASE aguarda enquanto REST ainda expõe transactionId anterior', async () => {
    const res = response();
    await webhookHandler(request({
      type: 'INITIAL_PURCHASE',
      transaction_id: 'new-store-transaction',
    }), res);

    expect(res.statusCode).toBe(500);
    expect(store.get(eventKey('event-1'))).toMatchObject({
      status: 'pending_reconciliation', attempts: 1,
    });
    expect(grantProAccessAfterApprovedPayment).not.toHaveBeenCalled();
  });

  test('divergência converge pelo snapshot REST ao atingir o limite de tentativas', async () => {
    process.env.REVENUECAT_RECONCILIATION_MAX_ATTEMPTS = '2';
    snapshotByUser['firebase-user-A'] = {
      ...activeSnapshot,
      active: false,
      status: 'expired',
      expiresAt: '2026-09-01T00:00:00.000Z',
      willRenew: false,
    };
    const webhookRequest = request({ type: 'RENEWAL', expiration_at_ms: FUTURE });

    const first = response();
    await webhookHandler(webhookRequest, first);
    expect(first.statusCode).toBe(500);
    expect(store.get(eventKey('event-1'))).toMatchObject({ attempts: 1, status: 'pending_reconciliation' });

    const second = response();
    await webhookHandler(webhookRequest, second);
    expect(second.statusCode).toBe(200);
    expect(revokeProAccess).toHaveBeenCalledWith(
      'order_performance_firebase-user-A',
      'store-transaction-1',
      'expired',
      'revenuecat_webhook',
      expect.any(String),
      expect.objectContaining({ eventId: 'event-1' }),
    );
    expect(store.get(eventKey('event-1'))?.status).toBe('processed');
  });

  test('divergência também converge ao expirar a janela máxima', async () => {
    process.env.REVENUECAT_RECONCILIATION_MAX_ATTEMPTS = '100';
    process.env.REVENUECAT_RECONCILIATION_MAX_AGE_MS = '1000';
    const webhookRequest = request({
      type: 'REFUND',
      purchased_at_ms: Date.parse('2026-09-01T00:00:00.000Z'),
      expiration_at_ms: FUTURE,
    });

    const first = response();
    await webhookHandler(webhookRequest, first);
    expect(first.statusCode).toBe(500);

    jest.advanceTimersByTime(1001);
    const second = response();
    await webhookHandler(webhookRequest, second);
    expect(second.statusCode).toBe(200);
    expect(grantProAccessAfterApprovedPayment).toHaveBeenCalled();
    expect(store.get(eventKey('event-1'))?.status).toBe('processed');
  });

  test('REFUND antigo seguido de compra ativa nova é processado sem revogar', async () => {
    const res = response();
    await webhookHandler(request({
      type: 'REFUND',
      transaction_id: 'old-refunded-transaction',
      purchased_at_ms: Date.parse('2026-08-01T00:00:00.000Z'),
      expiration_at_ms: Date.parse('2026-08-31T00:00:00.000Z'),
      event_timestamp_ms: NOW,
    }), res);

    expect(res.statusCode).toBe(200);
    expect(grantProAccessAfterApprovedPayment).toHaveBeenCalled();
    expect(revokeProAccess).not.toHaveBeenCalled();
    expect(store.get(eventKey('event-1'))?.status).toBe('processed');
  });

  test('duas primeiras entregas concorrentes não rebaixam o pedido aprovado', async () => {
    const first = response();
    const second = response();
    await Promise.all([webhookHandler(request(), first), webhookHandler(request(), second)]);

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(store.get('payment_orders/order_performance_firebase-user-A')).toMatchObject({
      status: 'approved', paymentStatus: 'approved', provisionStatus: 'applied',
    });
    expect(store.get(eventKey('event-1'))?.status).toBe('processed');
  });

  test('redelivery de evento normal não migra para outro alias após processado', async () => {
    store.set('users/firebase-user-B', { status: 'OPEN_ATIVO', subscriptionTier: 'open' });
    snapshotByUser['firebase-user-B'] = { ...activeSnapshot, transactionId: 'transaction-B' };
    const webhookRequest = request({ aliases: ['firebase-user-A', 'firebase-user-B'] });

    const first = response();
    await webhookHandler(webhookRequest, first);
    expect(first.statusCode).toBe(200);
    expect(grantProAccessAfterApprovedPayment).toHaveBeenCalledTimes(1);

    store.set('users/firebase-user-A', { deleted: true, deletedAt: new Date(NOW).toISOString() });
    const repeated = response();
    await webhookHandler(webhookRequest, repeated);

    expect(repeated.statusCode).toBe(200);
    expect(repeated.body.duplicate).toBe(true);
    expect(grantProAccessAfterApprovedPayment).toHaveBeenCalledTimes(1);
    expect(fetchRevenueCatPerformanceEntitlement).toHaveBeenCalledTimes(1);
    expect(store.has('payment_orders/order_performance_firebase-user-B')).toBe(false);
  });

  test('evento normal pending continua vinculado ao primeiro UID se aliases mudarem de ordem', async () => {
    store.set('users/firebase-user-B', { status: 'OPEN_ATIVO', subscriptionTier: 'open' });
    snapshotByUser['firebase-user-B'] = { ...activeSnapshot, transactionId: 'transaction-B' };
    const first = response();
    await webhookHandler(request({
      type: 'REFUND',
      aliases: ['firebase-user-A', 'firebase-user-B'],
    }), first);
    expect(first.statusCode).toBe(500);

    const repeated = response();
    await webhookHandler(request({
      type: 'REFUND',
      app_user_id: 'firebase-user-B',
      original_app_user_id: 'firebase-user-B',
      aliases: ['firebase-user-B', 'firebase-user-A'],
    }), repeated);

    expect(repeated.statusCode).toBe(500);
    expect((fetchRevenueCatPerformanceEntitlement as jest.Mock).mock.calls).toEqual([
      ['firebase-user-A'],
      ['firebase-user-A'],
    ]);
    expect(store.get(eventKey('event-1'))).toMatchObject({
      status: 'pending_reconciliation', userId: 'firebase-user-A', attempts: 2,
    });
    expect(store.has('payment_orders/order_performance_firebase-user-B')).toBe(false);
  });

  test('evento normal pending é encerrado sem migrar para alias B se o UID A desaparecer', async () => {
    store.set('users/firebase-user-B', { status: 'OPEN_ATIVO', subscriptionTier: 'open' });
    snapshotByUser['firebase-user-B'] = { ...activeSnapshot, transactionId: 'transaction-B' };
    const webhookRequest = request({
      type: 'REFUND',
      aliases: ['firebase-user-A', 'firebase-user-B'],
    });
    const first = response();
    await webhookHandler(webhookRequest, first);
    expect(first.statusCode).toBe(500);

    store.set('users/firebase-user-A', { deleted: true, deletedAt: new Date(NOW).toISOString() });
    const repeated = response();
    await webhookHandler(request({
      type: 'REFUND',
      app_user_id: 'firebase-user-B',
      original_app_user_id: 'firebase-user-B',
      aliases: ['firebase-user-B', 'firebase-user-A'],
    }), repeated);

    expect(repeated.statusCode).toBe(200);
    expect(repeated.body).toMatchObject({ received: true, ignored: true });
    expect(fetchRevenueCatPerformanceEntitlement).toHaveBeenCalledTimes(1);
    expect(store.get(eventKey('event-1'))).toMatchObject({
      status: 'processed',
      userId: 'firebase-user-A',
      outcome: 'ignored_user_unavailable',
    });
    expect(store.has('payment_orders/order_performance_firebase-user-B')).toBe(false);
  });

  test('usuário removido/tombstonado é registrado como ignorado sem recriar perfil ou pedido', async () => {
    store.set('users/firebase-user-A', { deleted: true, deletedAt: '2026-09-06T11:00:00.000Z' });
    const res = response();
    await webhookHandler(request(), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.ignored).toBe(true);
    expect(store.get('users/firebase-user-A')).toMatchObject({ deleted: true });
    expect(store.has('payment_orders/order_performance_firebase-user-A')).toBe(false);
    expect(store.get(eventKey('event-1'))).toMatchObject({
      providerEventId: 'event-1', status: 'processed', outcome: 'ignored_no_existing_user',
    });
  });

  test('TRANSFER sem app_user_id reconcilia origem e destino com dedupe event.id+UID', async () => {
    store.set('users/source-user', { status: 'PRO_ATIVO' });
    store.set('users/destination-user', { status: 'OPEN_ATIVO' });
    snapshotByUser['source-user'] = {
      ...activeSnapshot, active: false, status: 'inactive', productId: null,
      expiresAt: null, transactionId: null,
    };
    snapshotByUser['destination-user'] = {
      ...activeSnapshot, transactionId: 'transferred-transaction',
    };
    const transferRequest = request({
      type: 'TRANSFER',
      app_user_id: undefined,
      original_app_user_id: undefined,
      aliases: undefined,
      entitlement_ids: undefined,
      transaction_id: undefined,
      transferred_from: ['$RCAnonymousID:old', 'missing-alias', 'source-user'],
      transferred_to: ['$RCAnonymousID:new', 'destination-user'],
    });
    const res = response();
    await webhookHandler(transferRequest, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ received: true, transfer: true });
    expect(revokeProAccess).toHaveBeenCalledWith(
      'order_performance_source-user',
      expect.any(String),
      'revoked',
      'revenuecat_webhook',
      expect.any(String),
      expect.objectContaining({
        eventId: 'event-1', transferDirection: 'source',
        eventDocumentId: expect.not.stringContaining('destination-user'),
      }),
    );
    expect(grantProAccessAfterApprovedPayment).toHaveBeenCalledWith(
      'order_performance_destination-user',
      'transferred-transaction',
      'revenuecat_webhook',
      expect.objectContaining({
        eventId: 'event-1',
        transferDirection: 'destination',
        transferOccurredAt: new Date(NOW).toISOString(),
      }),
    );
    expect(store.get(eventKey('event-1', 'source-user'))).toMatchObject({
      providerEventId: 'event-1', userId: 'source-user', status: 'processed', transferDirection: 'source',
    });
    expect(store.get(eventKey('event-1', 'destination-user'))).toMatchObject({
      providerEventId: 'event-1', userId: 'destination-user', status: 'processed', transferDirection: 'destination',
    });

    jest.clearAllMocks();
    installDbMock();
    installProvisioningMocks();
    (fetchRevenueCatPerformanceEntitlement as jest.Mock).mockImplementation(async (userId: string) => snapshotByUser[userId]);
    const repeated = response();
    await webhookHandler(transferRequest, repeated);
    expect(repeated.statusCode).toBe(200);
    expect(repeated.body.results).toEqual(expect.arrayContaining([
      expect.objectContaining({ userId: 'source-user', duplicate: true }),
      expect.objectContaining({ userId: 'destination-user', duplicate: true }),
    ]));
    expect(fetchRevenueCatPerformanceEntitlement).not.toHaveBeenCalled();
  });

  test('TRANSFER destination inativo converge para processed/ignored após o limite', async () => {
    process.env.REVENUECAT_RECONCILIATION_MAX_ATTEMPTS = '2';
    store.set('users/destination-user', { status: 'OPEN_ATIVO' });
    snapshotByUser['destination-user'] = {
      ...activeSnapshot,
      active: false,
      status: 'inactive',
      productId: null,
      expiresAt: null,
      transactionId: null,
      willRenew: false,
    };
    const transferRequest = request({
      type: 'TRANSFER',
      app_user_id: undefined,
      original_app_user_id: undefined,
      aliases: undefined,
      entitlement_ids: undefined,
      transaction_id: undefined,
      transferred_from: ['missing-source'],
      transferred_to: ['destination-user'],
    });

    const first = response();
    await webhookHandler(transferRequest, first);
    expect(first.statusCode).toBe(500);
    expect(store.get(eventKey('event-1', 'destination-user'))).toMatchObject({
      status: 'pending_reconciliation',
      outcome: 'transfer_destination_not_yet_active',
      attempts: 1,
    });

    const second = response();
    await webhookHandler(transferRequest, second);
    expect(second.statusCode).toBe(200);
    expect(second.body.results).toEqual([
      expect.objectContaining({ userId: 'destination-user', ignored: true }),
    ]);
    expect(store.get(eventKey('event-1', 'destination-user'))).toMatchObject({
      status: 'processed',
      outcome: 'ignored_transfer_destination_inactive',
      attempts: 2,
    });
    expect(store.has('payment_orders/order_performance_destination-user')).toBe(false);
    expect(grantProAccessAfterApprovedPayment).not.toHaveBeenCalled();
    expect(revokeProAccess).not.toHaveBeenCalled();
  });

  test('TRANSFER revoga origem mesmo quando purchasedAt é posterior ao event_timestamp', async () => {
    store.set('users/source-user', { status: 'PRO_ATIVO' });
    store.set('users/destination-user', { status: 'OPEN_ATIVO' });
    snapshotByUser['source-user'] = {
      ...activeSnapshot,
      providerObservedAt: '2026-09-06T12:02:00.000Z',
    };
    snapshotByUser['destination-user'] = {
      ...activeSnapshot,
      providerObservedAt: '2026-09-06T12:02:00.000Z',
      transactionId: 'transferred-transaction',
    };
    const res = response();

    await webhookHandler(request({
      type: 'TRANSFER',
      event_timestamp_ms: Date.parse('2026-08-31T00:00:00.000Z'),
      app_user_id: undefined,
      original_app_user_id: undefined,
      aliases: undefined,
      entitlement_ids: undefined,
      transaction_id: undefined,
      transferred_from: ['source-user'],
      transferred_to: ['destination-user'],
    }), res);

    expect(res.statusCode).toBe(200);
    expect(revokeProAccess).toHaveBeenCalledWith(
      'order_performance_source-user',
      expect.any(String),
      'revoked',
      'revenuecat_webhook',
      expect.any(String),
      expect.objectContaining({
        transferDirection: 'source',
        entitlement: expect.objectContaining({
          status: 'revoked',
          providerObservedAt: '2026-09-06T12:02:00.000Z',
        }),
      }),
    );
  });
});
