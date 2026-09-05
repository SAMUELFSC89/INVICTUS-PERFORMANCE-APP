import handler from '../_handlers/performance-ai';

const mockUserGet = jest.fn();
const mockWorkoutGet = jest.fn();
const mockGenerate = jest.fn();
const mockBuildSummary = jest.fn();
const mockLoadMemory = jest.fn();
const mockExtractMemory = jest.fn();
const mockCache = new Map<string, unknown>();

jest.mock('../_lib/common', () => ({
  cors: jest.fn(() => false), verifyAuth: jest.fn(async () => ({ uid: 'owner' })),
  db: { collection: (name: string) => name === 'users'
    ? { doc: () => ({ get: () => mockUserGet() }) }
    : { where: () => ({ limit: () => ({ get: () => mockWorkoutGet() }) }) } }
}));
jest.mock('@google/genai', () => ({ GoogleGenAI: class { models = { generateContent: (...args: unknown[]) => mockGenerate(...args) }; } }));
jest.mock('../_repositories/memory-repository', () => ({ MemoryRepository: class {} }));
jest.mock('../_services/ai/memory-service', () => ({
  isTrivialMessage: () => false,
  MemoryService: class {
    getFormattedMemoriesForContext = (...args: unknown[]) => mockLoadMemory(...args);
    extractAndStoreMemoriesFromInteraction = (...args: unknown[]) => mockExtractMemory(...args);
  }
}));
jest.mock('../_lib/ai-config', () => ({
  getAiApiKey: () => 'test-key', getAiChatModel: () => 'test-model',
  classifyAiError: () => ({ status: 503, code: 'AI_UNAVAILABLE', message: 'Indisponível', retryable: true })
}));
jest.mock('../_lib/ai-usage-logger', () => ({ extractUsage: () => ({}), logAiUsage: jest.fn(async () => {}), newAiRequestId: () => 'request' }));
jest.mock('../_handlers/health-summary', () => ({ buildHealthSummary: (...args: unknown[]) => mockBuildSummary(...args) }));
jest.mock('../_lib/health-data-layer', () => ({ lerSerieTemporalMetrica: jest.fn() }));
jest.mock('../_lib/cache', () => ({ CacheManager: {
  get: async (key: string) => mockCache.get(key) || null,
  set: async (key: string, value: unknown) => { mockCache.set(key, value); },
  delete: async (key: string) => { mockCache.delete(key); }
} }));

function response() {
  const res: any = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res;
}

describe('relatório de saúde: autorização, período e isolamento da IA', () => {
  beforeEach(() => {
    jest.clearAllMocks(); mockCache.clear();
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-05T15:00:00Z'));
    mockUserGet.mockResolvedValue({ exists: true, data: () => ({ subscriptionTier: 'pro' }) });
    mockWorkoutGet.mockResolvedValue({ docs: [] });
    mockBuildSummary.mockResolvedValue({ windowDays: 30, latest: {}, trends: {
      steps_daily: [{ timestamp: '2026-09-04T23:00:00Z', value: 5300, unit: 'steps', source: 'health_connect' }]
    }, metadata: { partial: false } });
    mockGenerate.mockResolvedValue({ text: 'Precisamos de mais dados para comparar seu padrão.' });
  });
  afterEach(() => jest.restoreAllMocks());

  test('falha de consulta Pro retorna503 sem gerar nem buscar histórico', async () => {
    mockUserGet.mockRejectedValueOnce(new Error('offline'));
    const res = response();
    await handler({ method: 'POST', body: { action: 'health-report', days: 7 } } as any, res);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'ENTITLEMENT_UNAVAILABLE' }));
    expect(mockGenerate).not.toHaveBeenCalled();
    expect(mockBuildSummary).not.toHaveBeenCalled();
  });

  test('Free continua bloqueado apenas na geração IA', async () => {
    mockUserGet.mockResolvedValueOnce({ exists: true, data: () => ({ subscriptionTier: 'free' }) });
    const res = response();
    await handler({ method: 'POST', body: { action: 'health-report', days: 30 } } as any, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockGenerate).not.toHaveBeenCalled();
    expect(mockBuildSummary).not.toHaveBeenCalled();
  });

  test('período inválido é rejeitado sem gastos', async () => {
    const res = response();
    await handler({ method: 'POST', body: { action: 'health-report', days: 365 } } as any, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  test('ausência de dados usa resposta determinística semGemini', async () => {
    mockBuildSummary.mockResolvedValueOnce({ windowDays: 30, latest: {}, trends: {}, metadata: { partial: false } });
    const res = response();
    await handler({ method: 'POST', body: { action: 'health-report', days: 30 } } as any, res);
    expect(mockGenerate).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ generationMode: 'deterministic', confidence: 'DADOS INSUFICIENTES' }));
  });

  test('treino antigo usado como referência não dispara IA quando o período selecionado está vazio', async () => {
    mockBuildSummary.mockResolvedValueOnce({ windowDays: 30, latest: {}, trends: {}, metadata: { partial: false } });
    mockWorkoutGet.mockResolvedValueOnce({ docs: [{ data: () => ({ timestamp: '2026-08-15T12:00:00Z', status: 'valid', duration: 45 }) }] });
    const res = response();
    await handler({ method: 'POST', body: { action: 'health-report', days: 7 } } as any, res);
    expect(mockGenerate).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ generationMode: 'deterministic', periodDays: 7 }));
  });

  test('sessão sem duração aparece no relatório, doc ID só deduplica internamente e não chega à IA', async () => {
    mockBuildSummary.mockResolvedValueOnce({ windowDays: 30, latest: {}, trends: {}, metadata: { partial: false } });
    const activity = { id: 'PRIVATE_DOCUMENT_ID', data: () => ({ id: 'spoofed-id', startTime: '2026-09-04T12:00:00Z',
      source: 'apple_health', healthTelemetry: { maxHeartRate: 150 } }) };
    mockWorkoutGet.mockResolvedValueOnce({ docs: [activity, activity] });
    const res = response();
    await handler({ method: 'POST', body: { action: 'health-report', days: 7 } } as any, res);
    expect(mockGenerate).toHaveBeenCalledTimes(1);
    const prompt = mockGenerate.mock.calls[0][0].contents;
    expect(prompt).toContain('"sessions":1');
    expect(prompt).toContain('"recordedMinutes":null');
    expect(prompt).toContain('"durationCoveredSessions":0');
    expect(prompt).not.toMatch(/PRIVATE_DOCUMENT_ID|spoofed-id/);
  });

  test('relatório respeita7dias, não envia identidade nem usa memória/TTS; repetir usa cache', async () => {
    const req: any = { method: 'POST', body: { action: 'health-report', days: 7, timeZone: 'America/Sao_Paulo',
      includeAudio: true, userProfile: { uid: 'owner', displayName: 'PRIVATE NAME', cpf: 'PRIVATE CPF' } } };
    const first = response(); const second = response();
    await handler(req, first); await handler(req, second);
    expect(mockBuildSummary).toHaveBeenCalledWith('owner', 30, 'America/Sao_Paulo');
    expect(mockGenerate).toHaveBeenCalledTimes(1);
    const prompt = mockGenerate.mock.calls[0][0].contents;
    expect(prompt).toContain('"days":7');
    expect(prompt).not.toMatch(/PRIVATE NAME|PRIVATE CPF|owner/);
    expect(prompt).toContain('previousPeriodComparison');
    const instructions = mockGenerate.mock.calls[0][0].config.systemInstruction;
    expect(instructions).toContain('Resumo do período');
    expect(instructions).toContain('Próximo passo');
    expect(instructions).toContain('impede afirmar melhora, piora ou evolução contra outro período');
    expect(mockLoadMemory).not.toHaveBeenCalled();
    expect(mockExtractMemory).not.toHaveBeenCalled();
    expect(first.json).toHaveBeenCalledWith(expect.objectContaining({ periodDays: 7, audio: null, cacheHit: false }));
    expect(second.json).toHaveBeenCalledWith(expect.objectContaining({ cacheHit: true }));
  });
});
