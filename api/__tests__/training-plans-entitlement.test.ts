const mockGenerateContent = jest.fn();
const mockUserGet = jest.fn();

jest.mock('@google/genai', () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({ models: { generateContent: mockGenerateContent } })),
}));
jest.mock('../_lib/common', () => ({
  FieldValue: { serverTimestamp: jest.fn() },
  cors: jest.fn(() => false),
  verifyAuth: jest.fn(async () => ({ uid: 'athlete-1' })),
  isDbAvailable: jest.fn(() => true),
  db: { collection: jest.fn(() => ({ doc: () => ({ get: mockUserGet }) })) },
}));
jest.mock('../_lib/ai-config', () => ({
  getAiApiKey: () => 'test-key',
  getAiWorkoutModel: () => 'test-model',
  classifyAiError: () => ({ status: 503, message: 'test failure', code: 'UPSTREAM_ERROR', retryable: true }),
}));
jest.mock('../_lib/entitlement', () => ({ isProUser: jest.fn(() => true) }));
jest.mock('../_lib/ai-usage-logger', () => ({
  extractUsage: () => ({}),
  logAiUsage: jest.fn(async () => undefined),
  newAiRequestId: () => 'request-1',
}));

import handler from '../_handlers/training-plans';

function response() {
  const res: any = { status: jest.fn(), json: jest.fn(), setHeader: jest.fn() };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res;
}

describe('gate de entitlement dos planos por IA', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUserGet.mockRejectedValue(new Error('Firestore indisponível'));
  });

  it('falha fechado antes de chamar a IA quando o entitlement não pode ser confirmado', async () => {
    const consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const res = response();

    await handler({ method: 'POST', body: { action: 'generate', answers: {} } } as any, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      code: 'ENTITLEMENT_UNAVAILABLE',
      retryable: true,
    }));
    expect(mockGenerateContent).not.toHaveBeenCalled();
    consoleWarn.mockRestore();
  });
});
