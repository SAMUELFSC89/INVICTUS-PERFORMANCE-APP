import { auth } from '../firebase';
import { HealthVitalsProvider } from '../services/wearables/HealthVitalsProvider';
import { WearableManager } from '../services/wearables/WearableManager';

jest.mock('../firebase', () => ({ auth: { currentUser: null } }));
jest.mock('../config', () => ({ API_CONFIG: { baseUrl: '' } }));
jest.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: () => 'ios', isNativePlatform: () => true } }));
jest.mock('../services/wearables/AppleHealthProvider', () => ({ AppleHealthProvider: class { id = 'apple_health'; disconnect = async () => {}; requestPermissions = async () => true; fetchActivities = async () => []; } }));
jest.mock('../services/wearables/HealthConnectProvider', () => ({ HealthConnectProvider: class { id = 'health_connect'; disconnect = async () => {}; requestPermissions = async () => true; fetchActivities = async () => []; } }));
jest.mock('../services/wearables/StravaProvider', () => ({ StravaProvider: class { id = 'strava'; } }));
jest.mock('../services/wearables/HealthVitalsProvider', () => ({ HealthVitalsProvider: { isAvailable: jest.fn(), checkPermissions: jest.fn(), fetchVitalsWithDiagnostics: jest.fn(), requestPermissions: jest.fn() } }));

const currentAuth = auth as unknown as { currentUser: { uid: string; getIdToken: () => Promise<string> } | null };
const user = (uid: string) => ({ uid, getIdToken: jest.fn(async () => `token-${uid}`) });
const config = (uid = 'A', connected = true) => ({
  userId: uid, appleHealthConnected: connected, healthConnectConnected: false,
  healthVitalsVersion: 1, lastVitalsSyncTime: null, autoSync: true
});
const result = () => ({ samples: [{ metricType: 'heart_rate', value: 65, normalizationVersion: 2 }], diagnostics: {
  since: '2026-08-05T10:00:00Z', until: '2026-09-04T10:00:00Z', reads: [], failedTypes: [], emptyTypes: [], readComplete: true
} });
const response = (body: unknown, ok = true) => ({ ok, json: async () => body });
const posts = () => (global.fetch as jest.Mock).mock.calls.filter(([, options]) => options?.method === 'POST').map(([, options]) => ({ ...options, body: JSON.parse(options.body) }));

beforeEach(() => {
  jest.resetAllMocks();
  (WearableManager as any).instance = null;
  currentAuth.currentUser = user('A');
  global.fetch = jest.fn(async (_url, options) => response(options?.method === 'GET' ? { config: config() } : { savedCount: 1 } )) as jest.Mock;
  (HealthVitalsProvider.isAvailable as jest.Mock).mockResolvedValue(true);
  (HealthVitalsProvider.checkPermissions as jest.Mock).mockResolvedValue(null);
  (HealthVitalsProvider.fetchVitalsWithDiagnostics as jest.Mock).mockImplementation(async () => result());
});

test('não lê nem envia dados quando a conexão está desligada', async () => {
  (global.fetch as jest.Mock).mockResolvedValue(response({ config: config('A', false) }));
  await expect(WearableManager.getInstance().syncVitals()).resolves.toEqual({ savedCount: 0 });
  expect(HealthVitalsProvider.fetchVitalsWithDiagnostics).not.toHaveBeenCalled();
  expect(posts()).toEqual([]);
});

test('permissão parcial de treino não bloqueia conexão de vitais autorizadas', async () => {
  const manager = WearableManager.getInstance();
  manager.getProvider('apple_health')!.requestPermissions = async () => false;
  (HealthVitalsProvider.requestPermissions as jest.Mock).mockResolvedValue(true);
  (global.fetch as jest.Mock).mockImplementation(async (_url, options) => {
    const body = options.body ? JSON.parse(options.body) : {};
    return response(body.action === 'update-config' ? { config: config() } : { savedCount: 1, syncedCount: 0 });
  });
  await expect(manager.connectProvider('apple_health')).resolves.toBe(true);
  expect(HealthVitalsProvider.requestPermissions).toHaveBeenCalledTimes(1);
  expect(posts().find((post) => post.body.action === 'update-config')?.body.config.appleHealthConnected).toBe(true);
});

test('troca de A para B durante leitura cancela upload', async () => {
  (HealthVitalsProvider.fetchVitalsWithDiagnostics as jest.Mock).mockImplementation(async () => {
    currentAuth.currentUser = user('B');
    return result();
  });
  await expect(WearableManager.getInstance().syncVitals()).rejects.toThrow('conta mudou');
  expect(posts()).toEqual([]);
});

test('configuração de A não é fallback para B quando a rede falha', async () => {
  const manager = WearableManager.getInstance();
  await manager.loadConfig();
  currentAuth.currentUser = user('B');
  (global.fetch as jest.Mock).mockRejectedValue(new Error('offline'));
  const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const fallback = await manager.loadConfig();
  expect(fallback.userId).toBe('B');
  expect(fallback.appleHealthConnected).toBe(false);
  expect(await manager.getConnectedNativeProviders()).toEqual([]);
  warning.mockRestore();
});

test('desconectar enquanto a leitura está pendente impede envio posterior', async () => {
  let finish!: (value: ReturnType<typeof result>) => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  (HealthVitalsProvider.fetchVitalsWithDiagnostics as jest.Mock).mockImplementation(() => {
    entered();
    return new Promise((resolve) => { finish = resolve; });
  });
  const manager = WearableManager.getInstance();
  const sync = manager.syncVitals();
  const failed = expect(sync).rejects.toThrow('desativada');
  await started;
  (global.fetch as jest.Mock).mockResolvedValue(response({ config: config('A', false) }));
  await manager.disconnectProvider('apple_health');
  finish(result());
  await failed;
  expect(posts().some((post) => post.body.action === 'sync-vitals')).toBe(false);
});

test('duas telas compartilham a mesma leitura em andamento', async () => {
  let finish!: (value: ReturnType<typeof result>) => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  (HealthVitalsProvider.fetchVitalsWithDiagnostics as jest.Mock).mockImplementation(() => {
    entered();
    return new Promise((resolve) => { finish = resolve; });
  });
  const manager = WearableManager.getInstance();
  const first = manager.syncVitals();
  const second = manager.syncVitals();
  await started;
  finish(result());
  await Promise.all([first, second]);
  expect(HealthVitalsProvider.fetchVitalsWithDiagnostics).toHaveBeenCalledTimes(1);
  expect(posts().filter((post) => post.body.action === 'sync-vitals')).toHaveLength(1);
});

test('envia versão e fim fixo da leitura; erro parcial não confirma cursor', async () => {
  const partial = result();
  partial.diagnostics.readComplete = false;
  partial.diagnostics.failedTypes = ['sleep'] as never[];
  (HealthVitalsProvider.fetchVitalsWithDiagnostics as jest.Mock).mockResolvedValue(partial);
  await WearableManager.getInstance().syncVitals();
  expect(posts()[0].body).toMatchObject({ normalizationVersion: 2, syncWindowEnd: partial.diagnostics.until, finalBatch: true, readComplete: false });
  expect(posts()[0].headers.Authorization).toBe('Bearer token-A');
});

test('falha offline permite nova tentativa com a mesma janela pendente', async () => {
  const manager = WearableManager.getInstance();
  await manager.loadConfig();
  (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('offline'));
  await expect(manager.syncVitals()).rejects.toThrow('offline');
  (global.fetch as jest.Mock).mockResolvedValue(response({ savedCount: 1 }));
  await expect(manager.syncVitals()).resolves.toMatchObject({ savedCount: 1 });
  expect(HealthVitalsProvider.fetchVitalsWithDiagnostics).toHaveBeenCalledTimes(2);
});

test.each([1, 2])('backfill depende da versão da fonte (%i), não da versão global', async (version) => {
  const lastRead = new Date(Date.now() - 60000).toISOString();
  (global.fetch as jest.Mock).mockImplementation(async (_url, options) => response(options?.method === 'GET' ? {
    config: { ...config(), healthVitalsVersion: 2, lastVitalsSyncBySource: { apple_health: lastRead }, healthVitalsVersionBySource: { apple_health: version } }
  } : { savedCount: 1 }));
  await WearableManager.getInstance().syncVitals();
  const [start, options] = (HealthVitalsProvider.fetchVitalsWithDiagnostics as jest.Mock).mock.calls[0];
  const daysRead = (options.until.getTime() - start.getTime()) / 86400000;
  if (version === 1) expect(daysRead).toBe(30);
  else expect(daysRead).toBeLessThan(2);
});
