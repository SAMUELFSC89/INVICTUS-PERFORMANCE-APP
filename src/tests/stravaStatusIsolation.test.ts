import { auth } from '../firebase';
import { stravaService } from '../services/stravaService';

jest.mock('../firebase', () => ({
  auth: { currentUser: null },
  onAuthStateChanged: jest.fn(),
}));
jest.mock('../config', () => ({ API_CONFIG: { baseUrl: '' } }));
jest.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }));

type FakeUser = { uid: string; getIdToken: () => Promise<string> };
const currentAuth = auth as unknown as { currentUser: FakeUser | null };
const user = (uid: string): FakeUser => ({ uid, getIdToken: jest.fn(async () => `token-${uid}`) });
const response = (body: unknown, ok = true) => ({ ok, json: async () => body, text: async () => JSON.stringify(body) });

test('cache de status do Strava é isolado por UID e invalidado ao desconectar', async () => {
  currentAuth.currentUser = user('A');
  global.fetch = jest.fn(async (url: string | URL | Request, options?: RequestInit) => {
    const target = String(url);
    const authorization = String((options?.headers as Record<string, string> | undefined)?.Authorization || '');
    if (target.endsWith('/disconnect')) return response({ ok: true });
    if (target.endsWith('/status')) {
      if (authorization === 'Bearer token-A') return response({ connected: true, lastSync: '2026-09-11T10:00:00Z', athleteId: 'athlete-A' });
      if (authorization === 'Bearer token-B') return response({ connected: false, lastSync: null, athleteId: 'athlete-B' });
    }
    return response({}, false);
  }) as jest.Mock;

  const statusA = await stravaService.getStatus();
  expect(statusA).toMatchObject({ connected: true, athleteId: 'athlete-A' });
  expect(global.fetch).toHaveBeenCalledTimes(1);

  // A troca de conta dentro do TTL não pode devolver o cache de A para B.
  currentAuth.currentUser = user('B');
  const statusB = await stravaService.getStatus();
  expect(statusB).toMatchObject({ connected: false, athleteId: 'athlete-B' });
  expect(global.fetch).toHaveBeenCalledTimes(2);
  expect((global.fetch as jest.Mock).mock.calls[1][1].headers.Authorization).toBe('Bearer token-B');

  // Uma segunda consulta de B usa seu próprio cache.
  await stravaService.getStatus();
  expect(global.fetch).toHaveBeenCalledTimes(2);

  // Desconectar invalida o cache de B; a próxima consulta precisa ir ao servidor.
  await stravaService.disconnect();
  expect(global.fetch).toHaveBeenCalledTimes(3);
  await stravaService.getStatus();
  expect(global.fetch).toHaveBeenCalledTimes(4);
});
