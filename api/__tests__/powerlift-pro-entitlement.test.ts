/**
 * Power Lift é 100% exclusivo do plano PRO. Este arquivo cobre o gate
 * server-side em api/_handlers/powerlift.ts, que protege TODAS as ações do
 * handler (status, me, submit, finalize-audit, opt-in -- Elite e Geral -- e
 * ranking) num único ponto, antes de qualquer despacho. Usa a política
 * canônica real (isProUser / hasActiveAdminAuthority / isActiveAccountState)
 * contra um Firestore mockado -- não mocka o entitlement em si -- para
 * provar o comportamento real do handler, não só o texto do arquivo.
 */
const mockUserGet = jest.fn();
const mockVerifyAuth = jest.fn(async () => ({ uid: 'athlete-1' }));

const mockGetPowerLiftSeasonStatus = jest.fn(async () => ({ season: { number: 1 }, general: {}, byExercise: {} }));
const mockGetPowerLiftEliteRanking = jest.fn(async () => ({ entries: [] }));
const mockGetPowerLiftGeneralRanking = jest.fn(async () => ({ entries: [] }));
const mockSetPowerLiftRankingOptIn = jest.fn(async () => ({ optedIn: true }));
const mockApplyApprovedPowerLiftRecord = jest.fn(async () => ({}));
const mockPublicPowerLiftEntry = jest.fn((entry: unknown) => entry);

jest.mock('../_lib/common', () => ({
  cors: jest.fn(() => false),
  app: {},
  verifyAuth: mockVerifyAuth,
  db: { collection: jest.fn(() => ({ doc: () => ({ get: mockUserGet }) })) },
}));

jest.mock('../_lib/powerlift-season-engine', () => ({
  applyApprovedPowerLiftRecord: mockApplyApprovedPowerLiftRecord,
  getPowerLiftEliteRanking: mockGetPowerLiftEliteRanking,
  getPowerLiftGeneralRanking: mockGetPowerLiftGeneralRanking,
  getPowerLiftSeasonStatus: mockGetPowerLiftSeasonStatus,
  publicPowerLiftEntry: mockPublicPowerLiftEntry,
  setPowerLiftRankingOptIn: mockSetPowerLiftRankingOptIn,
}));

jest.mock('../_lib/powerlift-audit', () => ({
  resolvePowerLiftAuditStatus: jest.fn(),
}));

import handler from '../_handlers/powerlift';

function response() {
  const res: any = { status: jest.fn(), json: jest.fn(), setHeader: jest.fn() };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res;
}

function userDoc(data: Record<string, unknown> | undefined) {
  mockUserGet.mockResolvedValue({ exists: data !== undefined, data: () => data });
}

const FUTURE = '2026-10-06T12:00:00.000Z';
const PAST = '2026-01-01T00:00:00.000Z';

function canonicalPro(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    entitlementId: 'performance',
    tier: 'performance',
    provider: 'revenuecat',
    status: 'active',
    productId: 'invictus.performance.monthly',
    providerObservedAt: '2026-09-06T11:59:00.000Z',
    expiresAt: FUTURE,
    ...overrides,
  };
}

describe('Power Lift API - gate PRO server-side (api/_handlers/powerlift.ts)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockVerifyAuth.mockResolvedValue({ uid: 'athlete-1' });
    jest.useFakeTimers().setSystemTime(new Date('2026-09-19T12:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('usuário PRO (entitlement canônico ativo) entra normalmente', async () => {
    userDoc({ proEntitlement: canonicalPro() });
    const res = response();

    await handler({ method: 'GET', query: { action: 'status' } }, res);

    expect(res.status).not.toHaveBeenCalledWith(403);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockGetPowerLiftSeasonStatus).toHaveBeenCalledWith('athlete-1');
  });

  test('usuário não-PRO (sem entitlement algum) é bloqueado com 403 PRO_REQUIRED', async () => {
    userDoc({});
    const res = response();

    await handler({ method: 'GET', query: { action: 'status' } }, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Power Lift é exclusivo do plano PRO.', code: 'PRO_REQUIRED' });
    expect(mockGetPowerLiftSeasonStatus).not.toHaveBeenCalled();
  });

  test('admin com autoridade ativa entra sem precisar de compra RevenueCat', async () => {
    userDoc({ role: 'admin' });
    const res = response();

    await handler({ method: 'GET', query: { action: 'status' } }, res);

    expect(res.status).not.toHaveBeenCalledWith(403);
    expect(mockGetPowerLiftSeasonStatus).toHaveBeenCalledWith('athlete-1');
  });

  test.each([
    { action: 'opt-in', req: { method: 'POST', body: { action: 'opt-in', scope: 'elite', exercise: 'supino', optedIn: true } }, downstream: () => mockSetPowerLiftRankingOptIn },
    { action: 'opt-in (geral)', req: { method: 'POST', body: { action: 'opt-in', scope: 'general', optedIn: true } }, downstream: () => mockSetPowerLiftRankingOptIn },
    { action: 'ranking', req: { method: 'GET', query: { action: 'ranking' } }, downstream: () => mockGetPowerLiftEliteRanking },
    { action: 'me', req: { method: 'GET', query: { action: 'me' } }, downstream: () => mockGetPowerLiftSeasonStatus },
  ])('usuário não-PRO não consegue chamar a API diretamente (ação: $action)', async ({ req }) => {
    userDoc({});
    const res = response();

    await handler(req as any, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'PRO_REQUIRED' }));
    expect(mockSetPowerLiftRankingOptIn).not.toHaveBeenCalled();
    expect(mockGetPowerLiftEliteRanking).not.toHaveBeenCalled();
    expect(mockGetPowerLiftGeneralRanking).not.toHaveBeenCalled();
    expect(mockGetPowerLiftSeasonStatus).not.toHaveBeenCalled();
  });

  test('flags legadas isoladas (isPro/premium/isSubscribed/subscriptionTier) não liberam acesso sem entitlement canônico', async () => {
    userDoc({ isPro: true, premium: true, isSubscribed: true, subscriptionTier: 'performance', subscriptionStatus: 'active' });
    const res = response();

    await handler({ method: 'GET', query: { action: 'status' } }, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'PRO_REQUIRED' }));
    expect(mockGetPowerLiftSeasonStatus).not.toHaveBeenCalled();
  });

  test('entitlement canônico expirado não libera acesso', async () => {
    userDoc({ proEntitlement: canonicalPro({ expiresAt: PAST }) });
    const res = response();

    await handler({ method: 'GET', query: { action: 'status' } }, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'PRO_REQUIRED' }));
    expect(mockGetPowerLiftSeasonStatus).not.toHaveBeenCalled();
  });

  test('falha fechado (503) quando o entitlement não pode ser confirmado, sem chamar nenhuma ação', async () => {
    mockUserGet.mockRejectedValue(new Error('Firestore indisponível'));
    const consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const res = response();

    await handler({ method: 'GET', query: { action: 'status' } }, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'ENTITLEMENT_UNAVAILABLE', retryable: true }));
    expect(mockGetPowerLiftSeasonStatus).not.toHaveBeenCalled();
    consoleWarn.mockRestore();
  });

  test('sem autenticação retorna 401 antes mesmo de checar o plano', async () => {
    mockVerifyAuth.mockResolvedValue(null);
    const res = response();

    await handler({ method: 'GET', query: { action: 'status' } }, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockUserGet).not.toHaveBeenCalled();
  });
});
