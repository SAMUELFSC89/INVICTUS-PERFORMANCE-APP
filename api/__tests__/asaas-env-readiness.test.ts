const mockUserGet = jest.fn();
const mockPingGet = jest.fn();

jest.mock('../_lib/common', () => ({
  cors: jest.fn(() => false),
  verifyAuth: jest.fn(async () => ({ uid: 'admin-1' })),
  db: {
    collection: jest.fn((name: string) => ({
      doc: jest.fn(() => ({
        get: name === '_connection_test_' ? mockPingGet : mockUserGet,
      })),
    })),
  },
}));

jest.mock('../_lib/admin-authority', () => ({
  hasActiveAdminAuthority: jest.fn(() => true),
}));

jest.mock('../_lib/asaas-client', () => ({
  getAsaasBaseUrl: jest.fn(() => 'https://api.asaas.com/v3'),
}));

import handler from '../_handlers/env-check';

function responseMock() {
  const response: any = {};
  response.statusCode = 200;
  response.body = null;
  response.status = jest.fn((status: number) => {
    response.statusCode = status;
    return response;
  });
  response.json = jest.fn((body: any) => {
    response.body = body;
    return response;
  });
  return response;
}

describe('Asaas admin environment readiness', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, ENABLE_ENV_CHECK: 'true' };
    mockUserGet.mockResolvedValue({ exists: true, data: () => ({ role: 'admin', status: 'Ativo' }) });
    mockPingGet.mockResolvedValue({ exists: false });
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('reports production financial integration ready without exposing secret values', async () => {
    process.env.ASAAS_API_KEY = 'api-secret-value';
    process.env.ASAAS_WEBHOOK_TOKEN = 'webhook-secret-value';
    process.env.ASAAS_AUTHORIZATION_TOKEN = 'authorization-secret-value';

    const req: any = { headers: {}, method: 'GET' };
    const res = responseMock();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      firestoreAvailable: true,
      paidChampionshipReady: true,
      integrations: {
        asaas: {
          environment: 'production',
          host: 'api.asaas.com',
          apiKeyConfigured: true,
          webhookTokenConfigured: true,
          authorizationTokenConfigured: true,
          productionWithdrawalAuthorizationReady: true,
          paidChampionshipFinancialIntegrationReady: true,
        },
      },
    });
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain('api-secret-value');
    expect(serialized).not.toContain('webhook-secret-value');
    expect(serialized).not.toContain('authorization-secret-value');
  });

  test('keeps generic Firestore health ok but fails paid-championship readiness without production authorization token', async () => {
    process.env.ASAAS_API_KEY = 'configured';
    process.env.ASAAS_WEBHOOK_TOKEN = 'configured';
    delete process.env.ASAAS_AUTHORIZATION_TOKEN;

    const req: any = { headers: {}, method: 'GET' };
    const res = responseMock();
    await handler(req, res);

    expect(res.body.ok).toBe(true);
    expect(res.body.paidChampionshipReady).toBe(false);
    expect(res.body.integrations.asaas).toMatchObject({
      environment: 'production',
      authorizationTokenConfigured: false,
      productionWithdrawalAuthorizationReady: false,
      paidChampionshipFinancialIntegrationReady: false,
    });
  });

  test('diagnostic remains hidden when explicitly disabled', async () => {
    process.env.ENABLE_ENV_CHECK = 'false';
    const req: any = { headers: {}, method: 'GET' };
    const res = responseMock();
    await handler(req, res);
    expect(res.statusCode).toBe(404);
  });
});
