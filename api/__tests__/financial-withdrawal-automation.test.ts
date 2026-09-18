/**
 * #saque-automatico (decisão do usuário em 18/09/2026): uma solicitação de
 * saque que sai com status 'pending' (passou no antifraude, score >=80) deve
 * ser enviada na hora para o Asaas, sem esperar um admin aprovar manualmente.
 * 'under_review' (score <80, sinal de risco) continua exigindo aprovação
 * manual, exatamente como antes -- ver api/_handlers/financial.ts.
 */
const mockRequestWithdrawal = jest.fn();
const mockProcessPayment = jest.fn();
const mockGetConfig = jest.fn(async (..._args: any[]) => ({ enabled: true, minWithdrawalAmount: 10, maxDailyWithdrawalAmount: 5000 }));
const mockGetWallet = jest.fn(async (..._args: any[]) => ({ redeemableBalance: 1000, blockedBalance: 0, updatedAt: 'now' }));
const mockLogEvent = jest.fn(async (..._args: any[]) => 'log-id');

jest.mock('../_lib/wallet-engine', () => ({
  WalletEngine: { getWallet: (...args: unknown[]) => mockGetWallet(...args) },
}));
jest.mock('../_lib/withdrawal-engine', () => ({
  WithdrawalEngine: {
    getConfig: (...args: unknown[]) => mockGetConfig(...args),
    requestWithdrawal: (...args: unknown[]) => mockRequestWithdrawal(...args),
    processPayment: (...args: unknown[]) => mockProcessPayment(...args),
    getUserWithdrawals: jest.fn(async () => []),
  },
}));
jest.mock('../_lib/admin-authority', () => ({ hasActiveAdminAuthority: () => false }));
jest.mock('../_lib/identity-verification-service', () => ({
  maskPhone: (value: string) => value,
  normalizeBrazilianPhone: (value: string) => value,
}));
jest.mock('../_lib/observability', () => ({ logEvent: (...args: unknown[]) => mockLogEvent(...args) }));
jest.mock('../_lib/common', () => ({
  cors: jest.fn(() => false),
  verifyAuth: jest.fn(async () => ({ uid: 'user-1' })),
  app: {},
  getAuth: () => ({ getUser: async () => ({ emailVerified: true, phoneNumber: null }) }),
  db: {
    collection: (name: string) => {
      if (name !== 'users') throw new Error(`Coleção inesperada no teste: ${name}`);
      return { doc: () => ({ get: async () => ({ exists: true, data: () => ({}) }) }) };
    },
  },
}));

import handler from '../_handlers/financial';

function response() {
  const res: any = { status: jest.fn(), json: jest.fn(), setHeader: jest.fn() };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res;
}

function postRequest(body: Record<string, any>) {
  return { method: 'POST', headers: {}, body } as any;
}

const WITHDRAWAL_BODY = { action: 'request-withdrawal', amount: 50, pixKey: 'user@example.com', pixKeyType: 'email' };

describe('POST /api/financial -- envio automático de saque para o Asaas', () => {
  beforeEach(() => jest.clearAllMocks());

  test("saque 'pending' é enviado automaticamente ao Asaas, sem esperar aprovação manual", async () => {
    mockRequestWithdrawal.mockResolvedValue({ id: 'pix_req_1', userId: 'user-1', amount: 50, status: 'pending' });
    mockProcessPayment.mockResolvedValue({
      id: 'pix_req_1', userId: 'user-1', amount: 50, status: 'processing',
      providerTransferId: 'transfer-abc', providerStatus: 'PENDING',
    });

    const res = response();
    await handler(postRequest(WITHDRAWAL_BODY), res);

    expect(mockProcessPayment).toHaveBeenCalledWith('pix_req_1', 'system_auto_asaas');
    expect(res.status).toHaveBeenCalledWith(201);
    const payload = res.json.mock.calls[0][0];
    expect(payload.success).toBe(true);
    expect(payload.status).toBe('processing');
    expect(payload.commitResult.providerTransferId).toBe('transfer-abc');
    expect(payload.userMessage).toMatch(/automaticamente/i);
    expect(mockLogEvent).toHaveBeenCalledWith(expect.objectContaining({
      severity: 'INFO', category: 'payment_logs', userId: 'user-1',
      details: expect.objectContaining({ withdrawalId: 'pix_req_1', providerTransferId: 'transfer-abc' }),
    }));
  });

  test("saque 'under_review' (antifraude sinalizou risco) continua exigindo aprovação manual", async () => {
    mockRequestWithdrawal.mockResolvedValue({ id: 'pix_req_2', userId: 'user-1', amount: 50, status: 'under_review' });

    const res = response();
    await handler(postRequest(WITHDRAWAL_BODY), res);

    expect(mockProcessPayment).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
    const payload = res.json.mock.calls[0][0];
    expect(payload.status).toBe('under_review');
    expect(payload.userMessage).toMatch(/análise de segurança/i);
  });

  test('falha ao disparar o pagamento automático não derruba a resposta; saque fica para conciliação', async () => {
    mockRequestWithdrawal.mockResolvedValue({ id: 'pix_req_3', userId: 'user-1', amount: 50, status: 'pending' });
    mockProcessPayment.mockRejectedValue(new Error('Asaas indisponível'));

    const res = response();
    await handler(postRequest(WITHDRAWAL_BODY), res);

    expect(res.status).toHaveBeenCalledWith(201);
    const payload = res.json.mock.calls[0][0];
    expect(payload.success).toBe(true);
    expect(payload.status).toBe('pending');
    expect(payload.userMessage).toMatch(/equipe finaliza manualmente/i);
    expect(mockLogEvent).toHaveBeenCalledWith(expect.objectContaining({ severity: 'WARNING' }));
  });
});
