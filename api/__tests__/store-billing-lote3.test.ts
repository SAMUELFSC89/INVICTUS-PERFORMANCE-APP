import { createHash } from 'node:crypto';

let mockDb: any;
const mockAsaas = {
  criarOuObterCliente: jest.fn(),
  buscarCobrancaPorReferenciaExterna: jest.fn(),
  criarCobrancaPix: jest.fn(),
  obterQrCodePix: jest.fn(),
  obterCobranca: jest.fn(),
  cancelarCobranca: jest.fn(),
  estornarPagamento: jest.fn(),
};

jest.mock('../_lib/common', () => ({
  get db() { return mockDb; },
  cors: jest.fn(() => false),
  verifyAuth: jest.fn(async () => ({ uid: 'u' })),
}));

jest.mock('../_lib/asaas-client', () => ({
  AsaasClient: {
    criarOuObterCliente: (...args: any[]) => mockAsaas.criarOuObterCliente(...args),
    buscarCobrancaPorReferenciaExterna: (...args: any[]) => mockAsaas.buscarCobrancaPorReferenciaExterna(...args),
    criarCobrancaPix: (...args: any[]) => mockAsaas.criarCobrancaPix(...args),
    obterQrCodePix: (...args: any[]) => mockAsaas.obterQrCodePix(...args),
    obterCobranca: (...args: any[]) => mockAsaas.obterCobranca(...args),
    cancelarCobranca: (...args: any[]) => mockAsaas.cancelarCobranca(...args),
    estornarPagamento: (...args: any[]) => mockAsaas.estornarPagamento(...args),
  },
}));

import storeHandler from '../_handlers/store';
import storeExpirationCronHandler from '../_handlers/store-expiration-cron';
import asaasWebhookHandler from '../_handlers/asaas-webhook';
import { StoreEngine } from '../_lib/store-engine';

type Stored = Record<string, any>;

function clone<T>(value: T): T {
  return value === undefined ? value : structuredClone(value);
}

function createMemoryDb(initial: Record<string, Stored> = {}) {
  const store = new Map<string, Stored>(Object.entries(initial).map(([key, value]) => [key, clone(value)]));
  let autoId = 0;
  let transactionTail = Promise.resolve();

  const makeRef = (path: string) => ({
    path,
    key: path,
    id: path.split('/').at(-1),
    get: async () => makeSnapshot(path),
    set: async (value: Stored, options?: { merge?: boolean }) => {
      store.set(path, options?.merge ? { ...(store.get(path) || {}), ...clone(value) } : clone(value));
    },
    update: async (value: Stored) => {
      if (!store.has(path)) throw new Error(`Documento ausente: ${path}`);
      store.set(path, { ...store.get(path), ...clone(value) });
    },
    create: async (value: Stored) => {
      if (store.has(path)) throw new Error(`Documento duplicado: ${path}`);
      store.set(path, clone(value));
    },
  });

  const makeSnapshot = (path: string) => ({
    id: path.split('/').at(-1),
    ref: makeRef(path),
    exists: store.has(path),
    data: () => clone(store.get(path)),
  });

  const makeQuery = (
    collectionName: string,
    filters: Array<[string, string, unknown]> = [],
    maximum = Number.POSITIVE_INFINITY,
    ordering: Array<[string, 'asc' | 'desc']> = [],
  ): any => ({
    doc: (id?: string) => makeRef(`${collectionName}/${id || `auto_${++autoId}`}`),
    where: (field: string, operator: string, expected: unknown) => {
      if (operator !== '==' && operator !== '<=') throw new Error(`Operador não suportado no mock: ${operator}`);
      return makeQuery(collectionName, [...filters, [field, operator, expected]], maximum, ordering);
    },
    orderBy: (field: string, direction: 'asc' | 'desc' = 'asc') => makeQuery(collectionName, filters, maximum, [...ordering, [field, direction]]),
    limit: (value: number) => makeQuery(collectionName, filters, value, ordering),
    get: async () => {
      const docs = [...store.keys()]
        .filter(key => key.startsWith(`${collectionName}/`) && key.split('/').length === 2)
        .filter(key => filters.every(([field, operator, expected]) => {
          const actual = store.get(key)?.[field];
          if (operator === '==') return actual === expected;
          return actual !== undefined && actual !== null && actual <= expected!;
        }))
        .sort((left, right) => {
          for (const [field, direction] of ordering) {
            const compared = String(store.get(left)?.[field] || '').localeCompare(String(store.get(right)?.[field] || ''));
            if (compared) return direction === 'desc' ? -compared : compared;
          }
          return left.localeCompare(right);
        })
        .slice(0, maximum)
        .map(makeSnapshot);
      return { docs, empty: docs.length === 0, size: docs.length };
    },
  });

  const db = {
    store,
    collection: (name: string) => makeQuery(name),
    runTransaction: async (callback: (transaction: any) => Promise<any>) => {
      const previous = transactionTail;
      let release!: () => void;
      transactionTail = new Promise<void>(resolve => { release = resolve; });
      await previous;
      const writes: Array<() => void> = [];
      try {
        const transaction = {
          get: async (target: any) => target.get(),
          set: (target: any, value: Stored, options?: { merge?: boolean }) => writes.push(() => {
            store.set(target.path, options?.merge ? { ...(store.get(target.path) || {}), ...clone(value) } : clone(value));
          }),
          update: (target: any, value: Stored) => writes.push(() => {
            if (!store.has(target.path)) throw new Error(`Documento ausente: ${target.path}`);
            store.set(target.path, { ...store.get(target.path), ...clone(value) });
          }),
          create: (target: any, value: Stored) => writes.push(() => {
            if (store.has(target.path)) throw new Error(`Documento duplicado: ${target.path}`);
            store.set(target.path, clone(value));
          }),
        };
        const result = await callback(transaction);
        writes.forEach(write => write());
        return result;
      } finally {
        release();
      }
    },
  };
  return db;
}

const address = {
  recipientName: 'Atleta Teste',
  postalCode: '01001000',
  street: 'Rua Teste',
  number: '10',
  complement: null,
  district: 'Centro',
  city: 'São Paulo',
  state: 'SP',
};

function product(productId = 'p', overrides: Stored = {}) {
  return {
    productId,
    name: `Produto ${productId}`,
    brand: 'Invictus',
    category: 'Suplementos',
    subcategory: 'Teste',
    productStatus: 'ACTIVE',
    developmentStatus: 'READY',
    gtin: '7896311763498',
    currentSupplierCost: 10,
    active: true,
    published: true,
    storeVisible: true,
    displayOrder: productId === 'p' ? 1 : 2,
    canPurchaseWithCash: true,
    canPurchaseWithCoinsDiscount: true,
    coinDiscountPrice: 80,
    coinDiscountAmount: 100,
    commercialStock: 10,
    reservedCommercialStock: 1,
    dropStock: 10,
    reservedDropStock: 0,
    images: { primary: '/mock.png', thumbnail: '/mock.png', gallery: [] },
    imageStatus: 'READY',
    pricing: { cashPrice: 100 },
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

function order(overrides: Stored = {}) {
  return {
    orderId: 'o',
    userId: 'u',
    status: 'PAID',
    paymentMethod: 'COINS_PLUS_MONEY',
    totalCashAmount: 80,
    totalCoinAmount: 100,
    shippingAmount: 0,
    address,
    dropId: null,
    idempotencyKey: 'intent-1',
    paymentProvider: 'asaas',
    paymentReference: 'pay_original',
    paymentStatus: 'PAID',
    coinReservationStatus: 'CONSUMED',
    createdAt: '2026-09-06T10:00:00.000Z',
    updatedAt: '2026-09-06T10:00:00.000Z',
    ...overrides,
  };
}

function item(orderId = 'o', productId = 'p', overrides: Stored = {}) {
  return {
    orderId,
    userId: 'u',
    productId,
    name: `Produto ${productId}`,
    gtin: '7896311763498',
    quantity: 1,
    unitPrice: 80,
    supplierCostSnapshot: 10,
    coinAmountUsed: 100,
    cashAmount: 80,
    shippingAmount: 0,
    ...overrides,
  };
}

function coinHoldId(value: Stored): string {
  const digest = createHash('sha256').update([value.userId, value.idempotencyKey, value.paymentMethod].join(':')).digest('hex').slice(0, 40);
  return `coin_store_discount_hold_${digest}`;
}

function compensationId(orderId: string, paymentId: string): string {
  const digest = createHash('sha256').update(`${orderId}:${paymentId}`).digest('hex').slice(0, 40);
  return `store_payment_compensation_${digest}`;
}

function responseMock() {
  const output: { statusCode: number; body: any } = { statusCode: 200, body: undefined };
  const response = {
    status(code: number) { output.statusCode = code; return this; },
    json(body: any) { output.body = body; return this; },
  };
  return { output, response };
}

describe('Loja Invictus — lote 3 de billing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-09-06T12:00:00.000Z'));
    mockDb = createMemoryDb();
    mockAsaas.criarOuObterCliente.mockResolvedValue('customer_1');
    mockAsaas.buscarCobrancaPorReferenciaExterna.mockResolvedValue(null);
    mockAsaas.criarCobrancaPix.mockResolvedValue({ id: 'pay_1', status: 'PENDING', value: 80, invoiceUrl: 'https://example.invalid/pay_1', raw: {} });
    mockAsaas.obterQrCodePix.mockResolvedValue({ payload: 'pix-pay_1', encodedImage: 'base64', expirationDate: '2026-09-06T12:25:00.000Z' });
    mockAsaas.obterCobranca.mockResolvedValue({ id: 'pay_original', status: 'PENDING', value: 80, raw: {} });
    mockAsaas.cancelarCobranca.mockResolvedValue({ id: 'pay_original', status: 'CANCELLED', deleted: true, raw: {} });
    mockAsaas.estornarPagamento.mockResolvedValue({ id: 'pay_original', status: 'REFUND_REQUESTED', raw: {} });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('BILL-01: fulfillment normal não devolve Coins nem cria ledger de estorno', async () => {
    const currentOrder = order();
    mockDb.store.set('physicalOrders/o', currentOrder);
    mockDb.store.set('physicalOrderItems/o_p', item());
    mockDb.store.set('products/p', product());
    mockDb.store.set('reward_coin_wallets/u', { userId: 'u', balance: 900, lifetimeSpent: 100, lifetimeEarned: 1000 });

    await StoreEngine.updateOrderStatus('o', 'PROCESSING');

    expect(mockDb.store.get('physicalOrders/o')).toMatchObject({ status: 'PROCESSING', coinReservationStatus: 'CONSUMED' });
    expect(mockDb.store.get('reward_coin_wallets/u')).toMatchObject({ balance: 900, lifetimeSpent: 100 });
    expect(mockDb.store.has('reward_coin_transactions/coin_store_refund_o')).toBe(false);
  });

  it('BILL-05: chamadas PIX concorrentes fazem um POST e retornam a cobrança canônica', async () => {
    mockDb.store.set('physicalOrders/o', order({ status: 'PENDING_PAYMENT', paymentMethod: 'MONEY', totalCoinAmount: 0, coinReservationStatus: 'NONE', paymentReference: null, paymentStatus: 'PENDING', paymentExpiresAt: '2026-09-06T12:30:00.000Z', paymentIntentId: 'o' }));
    mockDb.store.set('users/u', { cpf: '00000000000', name: 'Atleta' });
    let release!: () => void;
    const gatewayGate = new Promise<void>(resolve => { release = resolve; });
    mockAsaas.criarCobrancaPix.mockImplementation(async () => {
      await gatewayGate;
      return { id: 'pay_canonical', status: 'PENDING', value: 80, invoiceUrl: 'https://example.invalid/canonical', raw: {} };
    });
    mockAsaas.obterQrCodePix.mockResolvedValue({ payload: 'pix-canonical' });

    const first = StoreEngine.createPaymentForOrder('u', 'o');
    const second = StoreEngine.createPaymentForOrder('u', 'o');
    release();
    const results = await Promise.all([first, second]);

    expect(mockAsaas.criarCobrancaPix).toHaveBeenCalledTimes(1);
    expect(results.map(result => result.paymentId)).toEqual(['pay_canonical', 'pay_canonical']);
    expect(mockDb.store.get('physicalOrders/o')).toMatchObject({ paymentReference: 'pay_canonical', paymentCreationState: 'READY', paymentQrStatus: 'READY' });
  });

  it('BILL-05: lock distribuído reconcilia a intenção e descarta resposta não canônica', async () => {
    mockDb.store.set('physicalOrders/o', order({ status: 'PENDING_PAYMENT', paymentMethod: 'MONEY', totalCoinAmount: 0, coinReservationStatus: 'NONE', paymentReference: null, paymentStatus: 'PENDING', paymentExpiresAt: '2026-09-06T12:30:00.000Z', paymentIntentId: 'o' }));
    mockDb.store.set('users/u', { cpf: '00000000000', name: 'Atleta' });
    let lookup = 0;
    mockAsaas.buscarCobrancaPorReferenciaExterna.mockImplementation(async () => ++lookup === 1 ? null : { id: 'pay_recovered', status: 'PENDING', value: 80, invoiceUrl: 'https://example.invalid/recovered', raw: {} });
    let release!: () => void;
    const gatewayGate = new Promise<void>(resolve => { release = resolve; });
    mockAsaas.criarCobrancaPix.mockImplementation(async () => {
      await gatewayGate;
      return { id: 'pay_created', status: 'PENDING', value: 80, invoiceUrl: 'https://example.invalid/created', raw: {} };
    });
    mockAsaas.cancelarCobranca.mockRejectedValueOnce(new Error('timeout ao cancelar cobrança concorrente'));
    mockAsaas.obterCobranca.mockResolvedValueOnce({ id: 'pay_created', status: 'PENDING', value: 80, raw: {} });

    const first = StoreEngine.createPaymentForOrder('u', 'o');
    for (let attempt = 0; attempt < 30 && mockDb.store.get('physicalOrders/o')?.paymentCreationState !== 'CREATING'; attempt += 1) await Promise.resolve();
    expect(mockDb.store.get('physicalOrders/o')).toMatchObject({ paymentCreationState: 'CREATING', paymentReference: null });
    (StoreEngine as any).paymentCreationFlights.clear();
    const second = StoreEngine.createPaymentForOrder('u', 'o');
    await jest.advanceTimersByTimeAsync(2_100);
    const secondResult = await second;
    release();
    const firstResult = await first;

    expect(mockAsaas.criarCobrancaPix).toHaveBeenCalledTimes(1);
    expect([firstResult.paymentId, secondResult.paymentId]).toEqual(['pay_recovered', 'pay_recovered']);
    expect(mockAsaas.cancelarCobranca).toHaveBeenCalledWith('pay_created');
    const auditId = compensationId('o', 'pay_created');
    expect(mockDb.store.get(`storePaymentCompensations/${auditId}`)).toMatchObject({ state: 'RECONCILIATION_PENDING', attempts: 1, paymentId: 'pay_created', canonicalPaymentId: 'pay_recovered' });
    expect(mockDb.store.get('physicalOrders/o')).toMatchObject({ paymentReference: 'pay_recovered', paymentCreationState: 'READY', financialReviewRequired: true, financialReviewReason: 'ORPHAN_PAYMENT', financialActionRequired: 'REFUND', orphanPaymentReconciliationIds: [auditId] });

    await StoreEngine.createPaymentForOrder('u', 'o');
    expect(mockAsaas.cancelarCobranca).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(120_001);
    mockDb.store.set('physicalOrders/o', { ...mockDb.store.get('physicalOrders/o'), status: 'PAID', paymentStatus: 'PAID' });
    await StoreEngine.expirePendingOrders(10);

    expect(mockAsaas.criarCobrancaPix).toHaveBeenCalledTimes(1);
    expect(mockAsaas.cancelarCobranca).toHaveBeenCalledTimes(2);
    expect(mockDb.store.get(`storePaymentCompensations/${auditId}`)).toMatchObject({ state: 'CONFIRMED', attempts: 2, lastError: null });
    expect(mockDb.store.get('physicalOrders/o')).toMatchObject({ orphanPaymentReconciliationIds: [], financialReviewRequired: false, financialReviewReason: null });
  });

  it('BILL-06: erro do QR preserva pedido/cobrança, e resume-payment recupera o mesmo PIX', async () => {
    mockDb.store.set('products/p', product('p', { reservedCommercialStock: 0 }));
    mockDb.store.set('users/u', { cpf: '00000000000', name: 'Atleta' });
    mockAsaas.obterQrCodePix.mockRejectedValueOnce(new Error('QR temporariamente indisponível'));
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const firstResponse = responseMock();

    await storeHandler({ method: 'POST', query: { action: 'create-cash-order' }, body: { productId: 'p', quantity: 1, address, paymentMethod: 'MONEY', idempotencyKey: 'cash-intent' }, headers: {} } as any, firstResponse.response as any);

    expect(firstResponse.output.statusCode).toBe(400);
    const storedOrderEntry = [...mockDb.store.entries()].find(([key]) => key.startsWith('physicalOrders/'))!;
    const [orderPath, pendingOrder] = storedOrderEntry;
    expect(pendingOrder).toMatchObject({ status: 'PENDING_PAYMENT', paymentReference: 'pay_1', paymentQrStatus: 'ERROR' });
    expect(mockDb.store.get('products/p')).toMatchObject({ reservedCommercialStock: 1 });
    expect(mockAsaas.cancelarCobranca).not.toHaveBeenCalled();

    const resumed = responseMock();
    await storeHandler({ method: 'POST', query: { action: 'resume-payment' }, body: { orderId: pendingOrder.orderId }, headers: {} } as any, resumed.response as any);
    expect(resumed.output.statusCode).toBe(200);
    expect(resumed.output.body.payment.paymentId).toBe('pay_1');
    expect(mockAsaas.criarCobrancaPix).toHaveBeenCalledTimes(1);
    expect(mockDb.store.get(orderPath)).toMatchObject({ status: 'PENDING_PAYMENT', paymentReference: 'pay_1', paymentQrStatus: 'READY' });

    await StoreEngine.handleStorePaymentWebhook('pay_1', 'PAYMENT_RECEIVED', 100);
    expect(mockDb.store.get(orderPath)).toMatchObject({ status: 'PAID', paymentStatus: 'PAID' });
    consoleError.mockRestore();
  });

  it('BILL-12: comprador cancela somente o próprio pedido pendente', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockDb.store.set('physicalOrders/o', order({ status: 'PENDING_PAYMENT', paymentMethod: 'MONEY', totalCoinAmount: 0, coinReservationStatus: 'NONE', paymentStatus: 'AWAITING_PAYMENT' }));
    mockDb.store.set('physicalOrderItems/o_p', item('o', 'p', { coinAmountUsed: 0 }));
    mockDb.store.set('products/p', product());
    const cancelled = responseMock();

    await storeHandler({ method: 'POST', query: { action: 'cancel-order' }, body: { orderId: 'o' }, headers: {} } as any, cancelled.response as any);

    expect(cancelled.output.statusCode).toBe(200);
    expect(cancelled.output.body).toMatchObject({ success: true, pending: false, order: { status: 'CANCELLED' }, financialOperation: { operation: 'CANCEL', state: 'CONFIRMED' } });
    expect(mockAsaas.cancelarCobranca).toHaveBeenCalledTimes(1);

    mockDb.store.set('physicalOrders/paid', order({ orderId: 'paid', paymentMethod: 'MONEY', totalCoinAmount: 0, coinReservationStatus: 'NONE' }));
    const paid = responseMock();
    await storeHandler({ method: 'POST', query: { action: 'cancel-order' }, body: { orderId: 'paid' }, headers: {} } as any, paid.response as any);
    expect(paid.output.statusCode).toBe(400);
    expect(paid.output.body.error).toContain('aguardando pagamento');

    mockDb.store.set('physicalOrders/foreign', order({ orderId: 'foreign', userId: 'outra-pessoa', status: 'PENDING_PAYMENT' }));
    const foreign = responseMock();
    await storeHandler({ method: 'POST', query: { action: 'cancel-order' }, body: { orderId: 'foreign' }, headers: {} } as any, foreign.response as any);
    expect(foreign.output.statusCode).toBe(400);
    expect(foreign.output.body.error).toBe('Pedido não encontrado.');
    expect(mockAsaas.cancelarCobranca).toHaveBeenCalledTimes(1);
    consoleError.mockRestore();
  });

  it('BILL-10: expiração falha fechada e pode ser retomada sem duplicar a liberação', async () => {
    const expired = order({ status: 'PENDING_PAYMENT', paymentStatus: 'AWAITING_PAYMENT', coinReservationStatus: 'HELD', paymentExpiresAt: '2026-09-06T11:30:00.000Z', coinReservationExpiresAt: '2026-09-06T11:30:00.000Z' });
    mockDb.store.set('physicalOrders/o', expired);
    mockDb.store.set('physicalOrderItems/o_p', item());
    mockDb.store.set('products/p', product());
    mockDb.store.set('reward_coin_wallets/u', { userId: 'u', balance: 900, lifetimeSpent: 0, lifetimeEarned: 1000 });
    mockDb.store.set(`reward_coin_transactions/${coinHoldId(expired)}`, { metadata: { status: 'HELD' } });
    mockAsaas.cancelarCobranca.mockRejectedValueOnce(new Error('timeout no cancelamento'));

    const afterFailure = await StoreEngine.getPhysicalOrder('u', 'o');
    expect(afterFailure).toMatchObject({ status: 'PENDING_PAYMENT', expirationStatus: 'FAILED', coinReservationStatus: 'HELD' });
    expect(mockDb.store.get('products/p')).toMatchObject({ reservedCommercialStock: 1 });
    expect(mockDb.store.get('reward_coin_wallets/u')).toMatchObject({ balance: 900 });

    const afterRetry = await StoreEngine.getPhysicalOrder('u', 'o');
    expect(afterRetry).toMatchObject({ status: 'CANCELLED', expirationStatus: 'COMPLETED', coinReservationStatus: 'RELEASED' });
    expect(mockDb.store.get('products/p')).toMatchObject({ reservedCommercialStock: 0 });
    expect(mockDb.store.get('reward_coin_wallets/u')).toMatchObject({ balance: 1000, lifetimeSpent: 0 });
    expect(mockAsaas.cancelarCobranca).toHaveBeenCalledTimes(2);

    await StoreEngine.getPhysicalOrder('u', 'o');
    expect(mockDb.store.get('reward_coin_wallets/u')).toMatchObject({ balance: 1000 });
    expect(mockDb.store.has('reward_coin_transactions/coin_store_refund_o')).toBe(true);
  });

  it('BILL-10: confirmação de pagamento vence a corrida contra a expiração', async () => {
    const expired = order({ status: 'PENDING_PAYMENT', paymentStatus: 'AWAITING_PAYMENT', coinReservationStatus: 'HELD', paymentExpiresAt: '2026-09-06T11:30:00.000Z', coinReservationExpiresAt: '2026-09-06T11:30:00.000Z' });
    mockDb.store.set('physicalOrders/o', expired);
    mockDb.store.set('physicalOrderItems/o_p', item());
    mockDb.store.set('products/p', product());
    mockDb.store.set('reward_coin_wallets/u', { userId: 'u', balance: 900, lifetimeSpent: 0, lifetimeEarned: 1000 });
    mockDb.store.set(`reward_coin_transactions/${coinHoldId(expired)}`, { metadata: { status: 'HELD' } });
    let releaseCancellation!: () => void;
    const cancellationGate = new Promise<void>(resolve => { releaseCancellation = resolve; });
    mockAsaas.cancelarCobranca.mockImplementationOnce(async () => {
      await cancellationGate;
      throw new Error('cobrança já recebida');
    });

    const expiration = StoreEngine.expirePendingOrder('o', 'u');
    for (let attempt = 0; attempt < 20 && mockAsaas.cancelarCobranca.mock.calls.length === 0; attempt += 1) await Promise.resolve();
    expect(mockAsaas.cancelarCobranca).toHaveBeenCalledTimes(1);
    await StoreEngine.handleStorePaymentWebhook('pay_original', 'PAYMENT_RECEIVED', 80);
    releaseCancellation();

    await expect(expiration).resolves.toBe(false);
    expect(mockDb.store.get('physicalOrders/o')).toMatchObject({
      status: 'PAID',
      paymentStatus: 'REFUND_IN_PROGRESS',
      refundStatus: 'IN_PROGRESS',
      cancellationStatus: 'RECONCILIATION_PENDING',
      cancellationReason: 'EXPIRATION',
      expirationStatus: 'RECONCILIATION_PENDING',
      financialReviewRequired: true,
      financialReviewReason: 'PAYMENT_DURING_CANCELLATION',
      financialActionRequired: 'REFUND',
      coinReservationStatus: 'CONSUMED',
    });
    expect(mockAsaas.estornarPagamento).toHaveBeenCalledTimes(1);
    expect(mockDb.store.get('products/p')).toMatchObject({ reservedCommercialStock: 1 });
    expect(mockDb.store.get('reward_coin_wallets/u')).toMatchObject({ balance: 900, lifetimeSpent: 100 });
    expect(mockDb.store.has('reward_coin_transactions/coin_store_refund_o')).toBe(false);
  });

  it('BILL-10: cron autenticado faz varredura global limitada e deixa o restante para o próximo lote', async () => {
    mockDb.store.set('physicalOrders/o1', order({ orderId: 'o1', status: 'PENDING_PAYMENT', paymentMethod: 'MONEY', totalCoinAmount: 0, coinReservationStatus: 'NONE', paymentReference: null, paymentStatus: 'PENDING', paymentExpiresAt: '2026-09-06T11:00:00.000Z', createdAt: '2026-09-06T10:30:00.000Z' }));
    mockDb.store.set('physicalOrders/o2', order({ orderId: 'o2', status: 'PENDING_PAYMENT', paymentMethod: 'MONEY', totalCoinAmount: 0, coinReservationStatus: 'NONE', paymentReference: null, paymentStatus: 'PENDING', paymentExpiresAt: '2026-09-06T11:01:00.000Z', createdAt: '2026-09-06T10:31:00.000Z' }));
    mockDb.store.set('physicalOrders/o3', order({ orderId: 'o3', status: 'PENDING_PAYMENT', paymentMethod: 'MONEY', totalCoinAmount: 0, coinReservationStatus: 'NONE', paymentReference: null, paymentStatus: 'PENDING', paymentExpiresAt: '2026-09-06T12:25:00.000Z', createdAt: '2026-09-06T11:55:00.000Z' }));
    const previousSecret = process.env.CRON_SECRET;
    process.env.CRON_SECRET = 'cron-secreto';
    try {
      const first = responseMock();
      await storeExpirationCronHandler({ method: 'GET', query: { limit: '1' }, body: {}, headers: { authorization: 'Bearer cron-secreto' } } as any, first.response as any);
      expect(first.output).toMatchObject({ statusCode: 200, body: { success: true, result: { scanned: 1, expired: 1, failed: 0, hasMore: true } } });
      expect(mockDb.store.get('physicalOrders/o1')).toMatchObject({ status: 'CANCELLED', expirationStatus: 'COMPLETED' });
      expect(mockDb.store.get('physicalOrders/o2')).toMatchObject({ status: 'PENDING_PAYMENT' });

      const second = responseMock();
      await storeExpirationCronHandler({ method: 'POST', query: { limit: '1' }, body: {}, headers: { 'x-cron-secret': 'cron-secreto' } } as any, second.response as any);
      expect(second.output).toMatchObject({ statusCode: 200, body: { success: true, result: { scanned: 1, expired: 1, failed: 0 } } });
      expect(mockDb.store.get('physicalOrders/o2')).toMatchObject({ status: 'CANCELLED', expirationStatus: 'COMPLETED' });
      expect(mockDb.store.get('physicalOrders/o3')).toMatchObject({ status: 'PENDING_PAYMENT' });
    } finally {
      if (previousSecret === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = previousSecret;
    }
  });

  it('BILL-10: cron recusa segredo inválido sem iniciar a varredura', async () => {
    const previousSecret = process.env.CRON_SECRET;
    process.env.CRON_SECRET = 'cron-secreto';
    const sweep = jest.spyOn(StoreEngine, 'expirePendingOrders');
    try {
      const unauthorized = responseMock();
      await storeExpirationCronHandler({ method: 'GET', query: {}, body: {}, headers: { authorization: 'Bearer incorreto' } } as any, unauthorized.response as any);
      expect(unauthorized.output).toMatchObject({ statusCode: 401, body: { success: false } });
      expect(sweep).not.toHaveBeenCalled();
    } finally {
      if (previousSecret === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = previousSecret;
    }
  });

  it('BILL-10: duas expirações concorrentes convergem sem regredir COMPLETED para FAILED', async () => {
    mockDb.store.set('physicalOrders/o', order({ status: 'PENDING_PAYMENT', paymentMethod: 'MONEY', totalCoinAmount: 0, coinReservationStatus: 'NONE', paymentReference: null, paymentStatus: 'PENDING', paymentExpiresAt: '2026-09-06T11:00:00.000Z' }));

    const results = await Promise.all([StoreEngine.expirePendingOrder('o'), StoreEngine.expirePendingOrder('o')]);

    expect(results).toEqual([true, true]);
    expect(mockDb.store.get('physicalOrders/o')).toMatchObject({ status: 'CANCELLED', expirationStatus: 'COMPLETED', paymentStatus: 'CANCELLED' });
  });

  it('BILL-04: cancelamento pago solicita refund uma vez e só conclui no webhook', async () => {
    mockDb.store.set('physicalOrders/o', order({ paymentMethod: 'MONEY', totalCoinAmount: 0, coinReservationStatus: 'NONE' }));
    mockDb.store.set('physicalOrderItems/o_p', item('o', 'p', { coinAmountUsed: 0 }));
    mockDb.store.set('products/p', product());
    mockAsaas.estornarPagamento.mockResolvedValueOnce({ id: 'pay_original', status: 'REFUNDED', raw: {} });

    const requested = await StoreEngine.updateOrderStatus('o', 'CANCELLED');
    expect(requested).toMatchObject({ operation: 'REFUND', state: 'PENDING', duplicated: false });
    expect(mockAsaas.estornarPagamento).toHaveBeenCalledTimes(1);
    expect(mockDb.store.get('physicalOrders/o')).toMatchObject({ status: 'PAID', paymentStatus: 'REFUND_IN_PROGRESS', refundStatus: 'IN_PROGRESS' });
    expect(mockDb.store.get('products/p')).toMatchObject({ reservedCommercialStock: 1 });

    const duplicate = await StoreEngine.updateOrderStatus('o', 'CANCELLED');
    expect(duplicate).toMatchObject({ operation: 'REFUND', state: 'PENDING', duplicated: true });
    expect(mockAsaas.estornarPagamento).toHaveBeenCalledTimes(1);

    await StoreEngine.handleStorePaymentWebhook('pay_original', 'PAYMENT_REFUNDED', 80);
    expect(mockDb.store.get('physicalOrders/o')).toMatchObject({ status: 'REFUNDED', paymentStatus: 'REFUNDED', refundStatus: 'CONFIRMED' });
    expect(mockDb.store.get('products/p')).toMatchObject({ reservedCommercialStock: 0 });
  });

  it('BILL-04: timeout depois de refund aceito é reconciliado sem segunda solicitação', async () => {
    mockDb.store.set('physicalOrders/o', order({ paymentMethod: 'MONEY', totalCoinAmount: 0, coinReservationStatus: 'NONE' }));
    mockDb.store.set('physicalOrderItems/o_p', item('o', 'p', { coinAmountUsed: 0 }));
    mockDb.store.set('products/p', product());
    mockAsaas.estornarPagamento.mockRejectedValueOnce(new Error('timeout depois do aceite'));
    mockAsaas.obterCobranca.mockResolvedValueOnce({ id: 'pay_original', status: 'REFUND_IN_PROGRESS', value: 80, raw: {} });

    const reconciled = await StoreEngine.updateOrderStatus('o', 'CANCELLED');
    const retry = await StoreEngine.updateOrderStatus('o', 'CANCELLED');

    expect(reconciled).toMatchObject({ operation: 'REFUND', state: 'PENDING', duplicated: false });
    expect(retry).toMatchObject({ operation: 'REFUND', state: 'PENDING', duplicated: true });
    expect(mockAsaas.estornarPagamento).toHaveBeenCalledTimes(1);
    expect(mockAsaas.obterCobranca).toHaveBeenCalledTimes(2);
    expect(mockDb.store.get('physicalOrders/o')).toMatchObject({ status: 'PAID', paymentStatus: 'REFUND_IN_PROGRESS', refundStatus: 'IN_PROGRESS' });
  });

  it('BILL-04/13: retry consulta refund em andamento e converge mesmo sem o webhook original', async () => {
    mockDb.store.set('physicalOrders/o', order({ paymentMethod: 'MONEY', totalCoinAmount: 0, coinReservationStatus: 'NONE', cancellationStatus: 'NONE', refundStatus: 'NONE' }));
    mockDb.store.set('physicalOrderItems/o_p', item('o', 'p', { coinAmountUsed: 0 }));
    mockDb.store.set('products/p', product());

    const requested = await StoreEngine.updateOrderStatus('o', 'CANCELLED');
    mockAsaas.obterCobranca.mockResolvedValueOnce({ id: 'pay_original', status: 'REFUNDED', value: 80, raw: {} });
    const reconciled = await StoreEngine.updateOrderStatus('o', 'CANCELLED');

    expect(requested).toMatchObject({ operation: 'REFUND', state: 'PENDING' });
    expect(reconciled).toMatchObject({ operation: 'REFUND', state: 'CONFIRMED', duplicated: true });
    expect(mockAsaas.estornarPagamento).toHaveBeenCalledTimes(1);
    expect(mockAsaas.obterCobranca).toHaveBeenCalledTimes(1);
    expect(mockDb.store.get('physicalOrders/o')).toMatchObject({ status: 'REFUNDED', paymentStatus: 'REFUNDED', refundStatus: 'CONFIRMED' });
    expect(mockDb.store.get('products/p')).toMatchObject({ reservedCommercialStock: 0 });
  });

  it('BILL-13: estorno depois do envio é idempotente e evento anterior não regride finanças', async () => {
    mockDb.store.set('physicalOrders/o', order({ status: 'SHIPPED', paymentMethod: 'MONEY', totalCoinAmount: 0, coinReservationStatus: 'NONE', trackingCode: 'BR123' }));
    mockDb.store.set('physicalOrderItems/o_p', item('o', 'p', { coinAmountUsed: 0 }));
    mockDb.store.set('products/p', product('p', { commercialStock: 9, reservedCommercialStock: 0 }));

    const context = { eventId: 'evt-refund', eventAt: '2026-09-06T12:10:00.000Z', externalReference: 'o' };
    const result = await StoreEngine.handleStorePaymentWebhook('pay_original', 'PAYMENT_REFUNDED', 80, context);
    await StoreEngine.handleStorePaymentWebhook('pay_original', 'PAYMENT_REFUNDED', 80, context);
    const staleContext = { eventId: 'evt-paid-antigo', eventAt: '2026-09-06T12:05:00.000Z', externalReference: 'o' };
    const stale = await StoreEngine.handleStorePaymentWebhook('pay_original', 'PAYMENT_RECEIVED', 80, staleContext);
    const staleRetry = await StoreEngine.handleStorePaymentWebhook('pay_original', 'PAYMENT_RECEIVED', 80, staleContext);

    expect(result).toMatchObject({ found: true, status: 'refunded' });
    expect(stale).toMatchObject({ found: true, status: 'stale_event_ignored' });
    expect(staleRetry).toMatchObject({ found: true, status: 'stale_event_ignored' });
    expect(mockDb.store.get('physicalOrders/o')).toMatchObject({ status: 'SHIPPED', paymentStatus: 'REFUNDED', refundStatus: 'CONFIRMED', financialReviewRequired: true, financialActionRequired: 'RETURN_REVIEW', lastPaymentEventId: 'evt-refund' });
    expect(mockDb.store.get('products/p')).toMatchObject({ commercialStock: 9, reservedCommercialStock: 0 });
    expect([...mockDb.store.keys()].filter(key => key.startsWith('storePaymentEvents/'))).toHaveLength(2);
  });

  it('BILL-05/06: webhook reconcilia por externalReference quando o vínculo da cobrança ainda falta', async () => {
    mockDb.store.set('physicalOrders/o', order({ status: 'PENDING_PAYMENT', paymentMethod: 'MONEY', totalCoinAmount: 0, coinReservationStatus: 'NONE', paymentReference: null, paymentStatus: 'CREATING', paymentIntentId: 'o' }));

    const result = await StoreEngine.handleStorePaymentWebhook('pay_recuperado', 'PAYMENT_RECEIVED', 80, { eventId: 'evt-orphan-paid', eventAt: '2026-09-06T12:15:00.000Z', externalReference: 'o' });

    expect(result).toMatchObject({ found: true, status: 'paid' });
    expect(mockDb.store.get('physicalOrders/o')).toMatchObject({ paymentReference: 'pay_recuperado', paymentCreationState: 'READY', status: 'PAID', paymentStatus: 'PAID' });
  });

  it('BILL-05/13: webhook de cobrança não canônica registra revisão sem aprovar o pedido', async () => {
    mockDb.store.set('physicalOrders/o', order({ status: 'PENDING_PAYMENT', paymentMethod: 'MONEY', totalCoinAmount: 0, coinReservationStatus: 'NONE', paymentReference: 'pay_canonical', paymentStatus: 'AWAITING_PAYMENT', paymentIntentId: 'o' }));
    mockAsaas.cancelarCobranca.mockRejectedValueOnce(new Error('falha ao cancelar duplicata'));
    mockAsaas.obterCobranca.mockResolvedValueOnce({ id: 'pay_duplicate', status: 'PENDING', value: 80, raw: {} });

    const duplicate = await StoreEngine.handleStorePaymentWebhook('pay_duplicate', 'PAYMENT_RECEIVED', 80, { eventId: 'evt-duplicate-paid', eventAt: '2026-09-06T12:15:00.000Z', externalReference: 'o' });

    expect(duplicate).toMatchObject({ found: true, status: 'non_canonical_payment_review_required' });
    expect(mockDb.store.get('physicalOrders/o')).toMatchObject({ status: 'PENDING_PAYMENT', paymentReference: 'pay_canonical', paymentStatus: 'AWAITING_PAYMENT', financialReviewRequired: true, financialActionRequired: 'REFUND' });
    const conflictEvent = [...mockDb.store.entries()].find(([key]) => key.startsWith('storePaymentEvents/'))?.[1];
    expect(conflictEvent).toMatchObject({ paymentReferenceConflict: true, ignoredReason: 'NON_CANONICAL_PAYMENT' });
    expect(mockDb.store.get(`storePaymentCompensations/${compensationId('o', 'pay_duplicate')}`)).toMatchObject({ state: 'RECONCILIATION_PENDING', paymentId: 'pay_duplicate' });
  });

  it('BILL-05/06: valor divergente deixa trilha, vincula intenção e estorna o valor realmente recebido', async () => {
    const pending = order({ status: 'PENDING_PAYMENT', paymentReference: null, paymentStatus: 'CREATING', paymentIntentId: 'o', coinReservationStatus: 'HELD' });
    mockDb.store.set('physicalOrders/o', pending);
    mockDb.store.set('reward_coin_wallets/u', { userId: 'u', balance: 900, lifetimeSpent: 0, lifetimeEarned: 1000 });
    mockDb.store.set(`reward_coin_transactions/${coinHoldId(pending)}`, { metadata: { status: 'HELD' } });
    mockAsaas.estornarPagamento.mockRejectedValueOnce(new Error('falha transitória ao solicitar estorno'));
    mockAsaas.obterCobranca.mockResolvedValueOnce({ id: 'pay_invalido', status: 'PENDING', value: 10, raw: {} });
    const context = { eventId: 'evt-wrong-value', eventAt: '2026-09-06T12:15:00.000Z', externalReference: 'o' };

    const first = await StoreEngine.handleStorePaymentWebhook('pay_invalido', 'PAYMENT_RECEIVED', 10, context);
    const retry = await StoreEngine.handleStorePaymentWebhook('pay_invalido', 'PAYMENT_RECEIVED', 10, context);

    expect(first).toMatchObject({ found: true, status: 'amount_mismatch_refund_failed', retryable: true });
    expect(retry).toMatchObject({ found: true, status: 'amount_mismatch_refund_pending', retryable: false });
    expect(mockAsaas.estornarPagamento).toHaveBeenCalledTimes(2);
    expect(mockAsaas.estornarPagamento.mock.calls.map(([, params]) => params.valor)).toEqual([10, 10]);
    expect(mockDb.store.get('physicalOrders/o')).toMatchObject({
      status: 'PENDING_PAYMENT',
      paymentReference: 'pay_invalido',
      paymentIntentId: 'o',
      paymentReceivedAmount: 10,
      paymentStatus: 'REFUND_IN_PROGRESS',
      refundStatus: 'IN_PROGRESS',
      financialReviewRequired: true,
      financialReviewReason: 'PAYMENT_AMOUNT_MISMATCH',
      financialActionRequired: 'REFUND',
      coinReservationStatus: 'HELD',
    });
    expect(mockDb.store.get('reward_coin_wallets/u')).toMatchObject({ balance: 900, lifetimeSpent: 0 });
    expect(mockDb.store.get(`reward_coin_transactions/${coinHoldId(pending)}`)).toMatchObject({ metadata: { status: 'HELD' } });
    const events = [...mockDb.store.entries()].filter(([key]) => key.startsWith('storePaymentEvents/'));
    expect(events).toHaveLength(1);
    expect(events[0][1]).toMatchObject({ value: 10, expectedValue: 80, amountMismatch: true, requiresFinancialReview: true });
  });

  it('BILL-05/13: confirmação sem valor falha fechada sem consumir Coins ou inventar estorno', async () => {
    mockDb.store.set('physicalOrders/o', order({ status: 'PENDING_PAYMENT', paymentMethod: 'MONEY', totalCoinAmount: 0, coinReservationStatus: 'NONE', paymentReference: null, paymentStatus: 'CREATING', paymentIntentId: 'o', paymentExpiresAt: '2026-09-06T12:30:00.000Z' }));

    const context = { eventId: 'evt-sem-valor', eventAt: '2026-09-06T12:15:00.000Z', externalReference: 'o' };
    const result = await StoreEngine.handleStorePaymentWebhook('pay_sem_valor', 'PAYMENT_RECEIVED', undefined, context);
    const duplicate = await StoreEngine.handleStorePaymentWebhook('pay_sem_valor', 'PAYMENT_RECEIVED', undefined, context);

    expect(result).toMatchObject({ found: true, status: 'amount_missing_review_required' });
    expect(duplicate).toMatchObject({ found: true, status: 'amount_missing_review_required' });
    expect(mockAsaas.estornarPagamento).not.toHaveBeenCalled();
    expect(mockDb.store.get('physicalOrders/o')).toMatchObject({ status: 'PENDING_PAYMENT', paymentReference: 'pay_sem_valor', paymentReceivedAmount: null, paymentStatus: 'AMOUNT_MISMATCH', financialReviewRequired: true, financialReviewReason: 'PAYMENT_AMOUNT_MISMATCH', financialActionRequired: 'REFUND' });
    await expect(StoreEngine.createPaymentForOrder('u', 'o')).rejects.toMatchObject({ statusCode: 409 });
  });

  it('BILL-04: cancelamento confirmado só responde sucesso depois da baixa local', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockDb.store.set('physicalOrders/o', order({ status: 'PENDING_PAYMENT', paymentMethod: 'MONEY', totalCoinAmount: 0, coinReservationStatus: 'NONE', paymentStatus: 'AWAITING_PAYMENT', cancellationStatus: 'NONE', refundStatus: 'NONE' }));
    mockDb.store.set('physicalOrderItems/o_p', item('o', 'p', { coinAmountUsed: 0 }));
    const first = responseMock();

    await storeHandler({ method: 'POST', query: { action: 'cancel-order' }, body: { orderId: 'o' }, headers: {} } as any, first.response as any);

    expect(first.output).toMatchObject({ statusCode: 503, body: { success: false, retryable: true } });
    expect(mockDb.store.get('physicalOrders/o')).toMatchObject({
      status: 'PENDING_PAYMENT',
      paymentStatus: 'CANCELLED',
      cancellationStatus: 'RECONCILIATION_PENDING',
      cancellationReason: 'USER',
      financialReviewRequired: true,
      financialReviewReason: 'FINANCIAL_TRANSITION_FAILED',
    });
    expect(mockAsaas.cancelarCobranca).toHaveBeenCalledTimes(1);

    mockDb.store.set('products/p', product());
    const retry = responseMock();
    await storeHandler({ method: 'POST', query: { action: 'cancel-order' }, body: { orderId: 'o' }, headers: {} } as any, retry.response as any);

    expect(retry.output).toMatchObject({ statusCode: 200, body: { success: true, pending: false, order: { status: 'CANCELLED', paymentStatus: 'CANCELLED', cancellationStatus: 'CONFIRMED' } } });
    expect(mockAsaas.cancelarCobranca).toHaveBeenCalledTimes(1);
    expect(mockDb.store.get('products/p')).toMatchObject({ reservedCommercialStock: 0 });
    consoleError.mockRestore();
  });

  it('BILL-04/13: refund confirmado fica reconciliável até estoque e Coins convergirem', async () => {
    const currentOrder = order({ cancellationStatus: 'NONE', refundStatus: 'NONE' });
    mockDb.store.set('physicalOrders/o', currentOrder);
    mockDb.store.set('physicalOrderItems/o_p', item());
    mockDb.store.set('products/p', product());
    mockAsaas.estornarPagamento.mockRejectedValueOnce(new Error('timeout após confirmação'));
    mockAsaas.obterCobranca.mockResolvedValueOnce({ id: 'pay_original', status: 'REFUNDED', value: 80, raw: {} });

    await expect(StoreEngine.updateOrderStatus('o', 'CANCELLED')).rejects.toMatchObject({ statusCode: 503, retryable: true });
    expect(mockDb.store.get('physicalOrders/o')).toMatchObject({ status: 'PAID', paymentStatus: 'REFUNDED', refundStatus: 'RECONCILIATION_PENDING', financialReviewRequired: true });
    expect(mockDb.store.get('products/p')).toMatchObject({ reservedCommercialStock: 1 });

    mockDb.store.set('reward_coin_wallets/u', { userId: 'u', balance: 900, lifetimeSpent: 100, lifetimeEarned: 1000 });
    mockDb.store.set(`reward_coin_transactions/${coinHoldId(currentOrder)}`, { metadata: { status: 'CONSUMED' } });
    const reconciled = await StoreEngine.updateOrderStatus('o', 'CANCELLED');
    const duplicate = await StoreEngine.updateOrderStatus('o', 'CANCELLED');

    expect(reconciled).toMatchObject({ operation: 'REFUND', state: 'CONFIRMED', duplicated: true });
    expect(duplicate).toMatchObject({ operation: 'NONE', state: 'CONFIRMED', duplicated: true });
    expect(mockAsaas.estornarPagamento).toHaveBeenCalledTimes(1);
    expect(mockDb.store.get('physicalOrders/o')).toMatchObject({ status: 'REFUNDED', paymentStatus: 'REFUNDED', refundStatus: 'CONFIRMED', coinReservationStatus: 'REFUNDED' });
    expect(mockDb.store.get('products/p')).toMatchObject({ reservedCommercialStock: 0 });
    expect(mockDb.store.get('reward_coin_wallets/u')).toMatchObject({ balance: 1000, lifetimeSpent: 0 });
    expect([...mockDb.store.keys()].filter(key => key === 'reward_coin_transactions/coin_store_refund_o')).toHaveLength(1);
  });

  it('BILL-13: webhook responde 503 enquanto a confirmação financeira não converge localmente', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const consoleLog = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    mockDb.store.set('physicalOrders/o', order({ cancellationStatus: 'NONE', refundStatus: 'IN_PROGRESS', paymentStatus: 'REFUND_IN_PROGRESS' }));
    mockDb.store.set('physicalOrderItems/o_p', item());
    mockDb.store.set('products/p', product());
    const previousToken = process.env.ASAAS_WEBHOOK_TOKEN;
    process.env.ASAAS_WEBHOOK_TOKEN = 'token-seguro';
    try {
      const response = responseMock();
      await asaasWebhookHandler({
        method: 'POST',
        headers: { 'asaas-access-token': 'token-seguro' },
        body: { id: 'evt-refund-retryable', dateCreated: '2026-09-06T12:10:00.000Z', event: 'PAYMENT_REFUNDED', payment: { id: 'pay_original', status: 'REFUNDED', value: 80, externalReference: 'o' } },
      } as any, response.response as any);

      expect(response.output).toMatchObject({ statusCode: 503, body: { received: false, retryable: true, loja: { status: 'financial_reconciliation_pending', retryable: true } } });
      expect(mockDb.store.get('physicalOrders/o')).toMatchObject({ status: 'PAID', paymentStatus: 'REFUNDED', refundStatus: 'RECONCILIATION_PENDING', financialReviewRequired: true });
    } finally {
      if (previousToken === undefined) delete process.env.ASAAS_WEBHOOK_TOKEN;
      else process.env.ASAAS_WEBHOOK_TOKEN = previousToken;
      consoleError.mockRestore();
      consoleLog.mockRestore();
    }
  });

  it('BILL-01/13: chargeback concorrente impede baixa de refund e liberação de estoque', async () => {
    mockDb.store.set('physicalOrders/o', order({ paymentMethod: 'MONEY', totalCoinAmount: 0, coinReservationStatus: 'NONE', cancellationStatus: 'NONE', refundStatus: 'IN_PROGRESS', paymentStatus: 'REFUND_IN_PROGRESS' }));
    mockDb.store.set('physicalOrderItems/o_p', item('o', 'p', { coinAmountUsed: 0 }));
    mockDb.store.set('products/p', product());
    const originalApply = (StoreEngine as any).applyOrderStatusTransition;
    jest.spyOn(StoreEngine as any, 'applyOrderStatusTransition').mockImplementationOnce(async (...args: any[]) => {
      mockDb.store.set('physicalOrders/o', {
        ...mockDb.store.get('physicalOrders/o'),
        paymentStatus: 'CHARGEBACK_REQUESTED',
        financialReviewRequired: true,
        financialActionRequired: 'CHARGEBACK_REVIEW',
      });
      return originalApply.apply(StoreEngine, args);
    });

    const result = await StoreEngine.handleStorePaymentWebhook('pay_original', 'PAYMENT_REFUNDED', 80, { eventId: 'evt-refund-before-chargeback', eventAt: '2026-09-06T12:10:00.000Z', externalReference: 'o' });

    expect(result).toMatchObject({ found: true, status: 'financial_reconciliation_pending', retryable: true });
    expect(mockDb.store.get('physicalOrders/o')).toMatchObject({ status: 'PAID', paymentStatus: 'CHARGEBACK_REQUESTED', financialReviewRequired: true, financialActionRequired: 'CHARGEBACK_REVIEW' });
    expect(mockDb.store.get('products/p')).toMatchObject({ reservedCommercialStock: 1 });
  });

  it('BILL-06/10: resume bloqueia cancelamento pendente e pagamento tardio exige refund explícito', async () => {
    const pending = order({ status: 'PENDING_PAYMENT', paymentStatus: 'AWAITING_PAYMENT', coinReservationStatus: 'HELD', cancellationStatus: 'REQUESTED', cancellationReason: 'USER', refundStatus: 'NONE', paymentExpiresAt: '2026-09-06T12:30:00.000Z', coinReservationExpiresAt: '2026-09-06T12:30:00.000Z', financialOperationLockExpiresAt: '2026-09-06T12:02:00.000Z', paymentQrCode: null });
    mockDb.store.set('physicalOrders/o', pending);
    mockDb.store.set('reward_coin_wallets/u', { userId: 'u', balance: 900, lifetimeSpent: 0, lifetimeEarned: 1000 });
    mockDb.store.set(`reward_coin_transactions/${coinHoldId(pending)}`, { metadata: { status: 'HELD' } });

    await expect(StoreEngine.createPaymentForOrder('u', 'o')).rejects.toMatchObject({ statusCode: 409, retryable: true });
    expect(mockAsaas.obterQrCodePix).not.toHaveBeenCalled();
    const context = { eventId: 'evt-paid-during-user-cancel', eventAt: '2026-09-06T12:01:00.000Z', externalReference: 'o' };
    const paid = await StoreEngine.handleStorePaymentWebhook('pay_original', 'PAYMENT_RECEIVED', 80, context);
    const duplicate = await StoreEngine.handleStorePaymentWebhook('pay_original', 'PAYMENT_RECEIVED', 80, context);

    expect(paid).toMatchObject({ found: true, status: 'paid_during_cancellation_refund_pending', retryable: false });
    expect(duplicate).toMatchObject({ found: true, status: 'paid_during_cancellation_refund_pending', retryable: false });
    expect(mockAsaas.estornarPagamento).toHaveBeenCalledTimes(1);
    expect(mockDb.store.get('physicalOrders/o')).toMatchObject({
      status: 'PAID',
      paymentStatus: 'REFUND_IN_PROGRESS',
      refundStatus: 'IN_PROGRESS',
      cancellationStatus: 'RECONCILIATION_PENDING',
      cancellationReason: 'USER',
      financialReviewRequired: true,
      financialReviewReason: 'PAYMENT_DURING_CANCELLATION',
      financialActionRequired: 'REFUND',
      coinReservationStatus: 'CONSUMED',
    });
    expect(mockDb.store.get('reward_coin_wallets/u')).toMatchObject({ balance: 900, lifetimeSpent: 100 });
    expect(mockDb.store.get(`reward_coin_transactions/${coinHoldId(pending)}`)).toMatchObject({ metadata: { status: 'CONSUMED' } });
  });

  it.each([
    ['revisão financeira', { financialReviewRequired: true }],
    ['ação financeira pendente', { financialActionRequired: 'REFUND' }],
    ['erro financeiro pendente', { financialOperationError: 'reconciliação necessária' }],
    ['chargeback', { paymentStatus: 'CHARGEBACK_REQUESTED' }],
    ['refund parcial', { paymentStatus: 'PARTIALLY_REFUNDED', refundStatus: 'PARTIAL' }],
    ['cancelamento pendente', { cancellationStatus: 'REQUESTED' }],
    ['refund pendente', { paymentStatus: 'REFUND_IN_PROGRESS', refundStatus: 'IN_PROGRESS' }],
    ['cobrança órfã', { orphanPaymentReconciliationIds: ['comp-1'] }],
  ])('BILL-01: barreira de fulfillment bloqueia %s', async (_label, financialState) => {
    mockDb.store.set('physicalOrders/o', order(financialState));
    mockDb.store.set('physicalOrderItems/o_p', item());
    mockDb.store.set('products/p', product());
    mockDb.store.set('reward_coin_wallets/u', { userId: 'u', balance: 900, lifetimeSpent: 100, lifetimeEarned: 1000 });

    await expect(StoreEngine.updateOrderStatus('o', 'PROCESSING')).rejects.toMatchObject({ statusCode: 409 });

    expect(mockDb.store.get('physicalOrders/o')).toMatchObject({ status: 'PAID' });
    expect(mockDb.store.get('products/p')).toMatchObject({ reservedCommercialStock: 1 });
    expect(mockDb.store.get('reward_coin_wallets/u')).toMatchObject({ balance: 900, lifetimeSpent: 100 });
    expect(mockDb.store.has('reward_coin_transactions/coin_store_refund_o')).toBe(false);
  });

  it('BILL-01/04: refund de pedido só Coins usa refundStatus e é idempotente', async () => {
    const coinOrder = order({ paymentMethod: 'COINS', totalCashAmount: 0, totalCoinAmount: 100, paymentReference: null, cancellationStatus: 'NONE', refundStatus: 'NONE', paymentStatus: 'PAID', coinReservationStatus: 'CONSUMED' });
    mockDb.store.set('physicalOrders/o', coinOrder);
    mockDb.store.set('physicalOrderItems/o_p', item('o', 'p', { unitPrice: 0, cashAmount: 0, coinAmountUsed: 100 }));
    mockDb.store.set('products/p', product());
    mockDb.store.set('reward_coin_wallets/u', { userId: 'u', balance: 900, lifetimeSpent: 100, lifetimeEarned: 1000 });
    mockDb.store.set(`reward_coin_transactions/${coinHoldId(coinOrder)}`, { metadata: { status: 'CONSUMED' } });

    const refunded = await StoreEngine.updateOrderStatus('o', 'REFUNDED');
    const duplicate = await StoreEngine.updateOrderStatus('o', 'REFUNDED');

    expect(refunded).toMatchObject({ operation: 'NONE', state: 'CONFIRMED', duplicated: false });
    expect(duplicate).toMatchObject({ operation: 'NONE', state: 'CONFIRMED', duplicated: true });
    expect(mockDb.store.get('physicalOrders/o')).toMatchObject({ status: 'REFUNDED', paymentStatus: 'REFUNDED', refundStatus: 'CONFIRMED', refundReason: 'ADMIN', cancellationStatus: 'NONE', coinReservationStatus: 'REFUNDED' });
    expect(mockDb.store.get('products/p')).toMatchObject({ reservedCommercialStock: 0 });
    expect(mockDb.store.get('reward_coin_wallets/u')).toMatchObject({ balance: 1000, lifetimeSpent: 0 });
    expect(mockDb.store.get(`reward_coin_transactions/${coinHoldId(coinOrder)}`)).toMatchObject({ metadata: { status: 'RELEASED' } });
    expect([...mockDb.store.keys()].filter(key => key === 'reward_coin_transactions/coin_store_refund_o')).toHaveLength(1);
  });

  it('BILL-14: retry da última unidade retorna o pedido vendido sem novo débito', async () => {
    mockDb.store.set('products/p', product('p', { reservedCommercialStock: 0, reservedDropStock: 0, dropStock: 1 }));
    mockDb.store.set('reward_coin_wallets/u', { userId: 'u', balance: 1000, lifetimeSpent: 0, lifetimeEarned: 1000 });
    mockDb.store.set('store_drops/d1', { id: 'd1', name: 'Drop final', productId: 'p', productIds: ['p'], status: 'ACTIVE', active: true, startsAt: '2026-09-06T11:00:00.000Z', endsAt: '2026-09-06T13:00:00.000Z', initialStock: 1, availableStock: 1, reservedStock: 0, coinPrice: 100, limitPerUser: 1, shippingMode: 'SPONSORED', freightSubsidy: 0, packagingCost: 0, fulfillmentCost: 0, otherCosts: 0 });
    const params = { userId: 'u', productId: 'p', quantity: 1, address, idempotencyKey: 'same-drop-intent' };

    const first = await StoreEngine.redeemWithCoins(params);
    const retry = await StoreEngine.redeemWithCoins(params);

    expect(first.duplicated).toBe(false);
    expect(retry).toMatchObject({ duplicated: true, order: { orderId: first.order.orderId } });
    expect(mockDb.store.get('store_drops/d1')).toMatchObject({ status: 'SOLD_OUT', availableStock: 0, reservedStock: 1 });
    expect(mockDb.store.get('reward_coin_wallets/u')).toMatchObject({ balance: 900, lifetimeSpent: 100 });
  });

  it('BILL-15: catálogo e detalhe selecionam o Drop vigente de cada produto', async () => {
    mockDb.store.set('products/p', product('p', { reservedCommercialStock: 0 }));
    mockDb.store.set('products/p2', product('p2', { gtin: '7898593053779', reservedCommercialStock: 0 }));
    mockDb.store.set('store_drops/d1', { id: 'd1', name: 'Drop P', productId: 'p', status: 'ACTIVE', active: true, startsAt: '2026-09-06T11:00:00.000Z', endsAt: '2026-09-06T13:00:00.000Z', initialStock: 5, availableStock: 5, reservedStock: 0, coinPrice: 100, limitPerUser: 1, shippingMode: 'SPONSORED' });
    mockDb.store.set('store_drops/d2', { id: 'd2', name: 'Drop P2', productId: 'p2', status: 'ACTIVE', active: true, startsAt: '2026-09-06T11:01:00.000Z', endsAt: '2026-09-06T13:00:00.000Z', initialStock: 5, availableStock: 5, reservedStock: 0, coinPrice: 200, limitPerUser: 1, shippingMode: 'SPONSORED' });

    const catalogue = await StoreEngine.getPublicProducts();
    const detail = await StoreEngine.getPublicProduct('p2');

    expect(catalogue.map(entry => [entry.productId, entry.drop?.id, entry.availableForDrop])).toEqual([
      ['p', 'd1', true],
      ['p2', 'd2', true],
    ]);
    expect(detail).toMatchObject({ productId: 'p2', availableForDrop: true, drop: { id: 'd2', coinPrice: 200 } });
  });
});
