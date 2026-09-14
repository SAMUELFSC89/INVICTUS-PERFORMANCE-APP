import fs from 'fs';
import path from 'path';
import { AsaasClient } from '../_lib/asaas-client';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

describe('Asaas withdrawal reconciliation hardening', () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.ASAAS_API_KEY;
  const originalBase = process.env.ASAAS_API_BASE_URL;

  beforeEach(() => {
    process.env.ASAAS_API_KEY = 'test-key';
    process.env.ASAAS_API_BASE_URL = 'https://asaas.example.test/v3';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.ASAAS_API_KEY;
    else process.env.ASAAS_API_KEY = originalKey;
    if (originalBase === undefined) delete process.env.ASAAS_API_BASE_URL;
    else process.env.ASAAS_API_BASE_URL = originalBase;
    jest.restoreAllMocks();
  });

  test('transfer sends canonical externalReference and preserves provider value', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'transfer_123',
        status: 'PENDING',
        value: 42.5,
        externalReference: 'pix_req_user_request123',
      }),
    });
    global.fetch = fetchMock as any;

    const result = await AsaasClient.transferPix({
      value: 42.5,
      pixKey: 'evp-key',
      pixKeyType: 'random',
      externalReference: 'pix_req_user_request123',
    });

    expect(result.id).toBe('transfer_123');
    expect(result.value).toBe(42.5);
    expect(result.externalReference).toBe('pix_req_user_request123');
    const request = fetchMock.mock.calls[0][1];
    expect(JSON.parse(String(request.body))).toMatchObject({
      value: 42.5,
      externalReference: 'pix_req_user_request123',
    });
  });

  test('transfer response fails closed when provider value is missing', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 'transfer_123', status: 'PENDING' }),
    }) as any;

    await expect(AsaasClient.transferPix({
      value: 42.5,
      pixKey: 'evp-key',
      pixKeyType: 'random',
      externalReference: 'pix_req_user_request123',
    })).rejects.toThrow(/valor ausente ou divergente/i);
  });

  test('transfer response fails closed when provider value or reference diverges', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ id: 'transfer_123', status: 'PENDING', value: 99 }),
    }).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'transfer_124',
        status: 'PENDING',
        value: 42.5,
        externalReference: 'pix_req_other_request999',
      }),
    }) as any;

    await expect(AsaasClient.transferPix({
      value: 42.5,
      pixKey: 'evp-key',
      pixKeyType: 'random',
      externalReference: 'pix_req_user_request123',
    })).rejects.toThrow(/valor ausente ou divergente/i);

    await expect(AsaasClient.transferPix({
      value: 42.5,
      pixKey: 'evp-key',
      pixKeyType: 'random',
      externalReference: 'pix_req_user_request123',
    })).rejects.toThrow(/referência externa divergente/i);
  });

  test('engine can recover an orphaned provider transfer through externalReference', () => {
    const engine = read('api/_lib/withdrawal-engine.ts');
    expect(engine).toContain('externalReference: withdrawalId');
    expect(engine).toContain("db.collection('withdrawals').doc(normalizedReference).get()");
    expect(engine).toContain('providerExternalReference: normalizedReference || canonicalWithdrawalId');
    expect(engine).toContain("reconciliationReason: 'PROVIDER_AMOUNT_MISMATCH_OR_MISSING'");
    expect(engine).toContain("reconciliationReason: 'PROVIDER_TRANSFER_ID_CONFLICT'");
  });

  test('authorization callback recovers binding by reference and requires a numeric exact amount', () => {
    const authorization = read('api/_handlers/asaas-withdrawal-authorization.ts');
    expect(authorization).toContain("db.collection('withdrawals').doc(externalReference).get()");
    expect(authorization).toContain("typeof transferValue === 'number'");
    expect(authorization).toContain('Number.isFinite(transferValue)');
    expect(authorization).toContain('providerAuthorizationBoundAt');
    expect(authorization).not.toContain("typeof transfer.value !== 'number' ||");
  });

  test('final webhook forwards provider reference and amount into settlement validation', () => {
    const webhook = read('api/_handlers/asaas-webhook.ts');
    expect(webhook).toContain('transfer.externalReference');
    expect(webhook).toContain('transfer.value');
  });
});
