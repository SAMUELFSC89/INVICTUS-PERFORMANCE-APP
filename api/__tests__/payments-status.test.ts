import paymentsStatus from '../_handlers/payments-status';
import { db, verifyAuth } from '../_lib/common';

jest.mock('../_lib/common', () => ({
  db: { collection: jest.fn() },
  cors: jest.fn(() => false),
  verifyAuth: jest.fn()
}));

let orderData: Record<string, any>;

function response() {
  const res: any = {
    statusCode: 0,
    body: undefined,
    status: jest.fn((code: number) => {
      res.statusCode = code;
      return res;
    }),
    json: jest.fn((body: any) => {
      res.body = body;
      return res;
    })
  };
  return res;
}

async function requestStatus() {
  const res = response();
  await paymentsStatus({ method: 'GET', query: { orderId: 'order-A' } } as any, res);
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers().setSystemTime(new Date('2026-09-06T12:00:00.000Z'));
  (verifyAuth as jest.Mock).mockResolvedValue({ uid: 'user-A' });
  orderData = {
    userId: 'user-A',
    planId: 'invictus_performance',
    amount: 29.9,
    currency: 'BRL',
    paymentStatus: 'approved',
    provisionStatus: 'applied',
    expiresAt: '2026-10-06T12:00:00.000Z'
  };
  (db.collection as jest.Mock).mockImplementation((collection: string) => ({
    doc: (id: string) => ({
      get: async () => ({
        exists: collection === 'payment_orders' && id === 'order-A',
        data: () => orderData
      })
    })
  }));
});

afterEach(() => {
  jest.useRealTimers();
});

test('publica approved somente após provisionamento aplicado e com entitlement vigente', async () => {
  const res = await requestStatus();

  expect(res.statusCode).toBe(200);
  expect(res.body).toMatchObject({
    status: 'approved',
    paymentStatus: 'approved',
    provisionStatus: 'applied',
    accessGranted: true,
    expiresAt: '2026-10-06T12:00:00.000Z'
  });
});

test.each(['pending', 'retryable_error'])(
  'pagamento aprovado com provisionamento %s permanece processing sem anunciar acesso liberado',
  async (provisionStatus) => {
    orderData.provisionStatus = provisionStatus;

    const res = await requestStatus();

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      status: 'processing',
      paymentStatus: 'approved',
      provisionStatus,
      accessGranted: false
    });
    expect(res.body.message.toLowerCase()).not.toContain('liberado');
  }
);

test('não concede acesso quando o entitlement Performance está expirado', async () => {
  orderData.expiresAt = '2026-09-06T11:59:59.999Z';

  const res = await requestStatus();

  expect(res.statusCode).toBe(200);
  expect(res.body).toMatchObject({
    status: 'expired',
    paymentStatus: 'approved',
    provisionStatus: 'applied',
    accessGranted: false
  });
});

test('impede que um usuário consulte o pedido de outra conta', async () => {
  orderData.userId = 'user-B';

  const res = await requestStatus();

  expect(res.statusCode).toBe(403);
  expect(res.body).toEqual({
    error: 'Operação proibida: este pedido pertence a outro usuário.'
  });
});
