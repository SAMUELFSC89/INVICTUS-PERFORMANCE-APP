import { auth } from '../firebase';
import { healthSummaryService } from '../services/healthSummaryService';

jest.mock('../firebase', () => ({ auth: { currentUser: null } }));
jest.mock('../config', () => ({ API_CONFIG: { baseUrl: '' } }));

const authState = auth as unknown as { currentUser: { uid: string; getIdToken: () => Promise<string> } | null };
const originalFetch = global.fetch;
const response = (value = 60, partial = false) => ({
  ok: true,
  json: async () => ({ windowDays: 30, latest: { heart_rate_resting: { value, unit: 'bpm', timestamp: '2026-09-05T08:00:00Z' } }, trends: {}, metadata: { partial, aggregation: 'daily', metrics: {} } })
});

beforeEach(() => {
  jest.useFakeTimers({ now: Date.parse('2026-09-05T09:00:00Z') });
  healthSummaryService.invalidate();
  authState.currentUser = { uid: 'athlete-a', getIdToken: async () => 'token-a' };
  global.fetch = jest.fn().mockResolvedValue(response());
});

afterEach(() => { jest.useRealTimers(); global.fetch = originalFetch; });

test('shares an in-flight request and a short-lived cache for the same user, window and timezone', async () => {
  const [first, second] = await Promise.all([
    healthSummaryService.fetchSummary(30, 'America/Sao_Paulo'),
    healthSummaryService.fetchSummary(30, 'America/Sao_Paulo')
  ]);
  expect(first).toBe(second);
  expect(await healthSummaryService.fetchSummary(30, 'America/Sao_Paulo')).toBe(first);
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('timeZone=America%2FSao_Paulo'), expect.anything());
});

test('does not share cached health records across users, timezones or windows', async () => {
  await healthSummaryService.fetchSummary(30, 'UTC');
  await healthSummaryService.fetchSummary(90, 'UTC');
  await healthSummaryService.fetchSummary(30, 'America/Sao_Paulo');
  authState.currentUser = { uid: 'athlete-b', getIdToken: async () => 'token-b' };
  (global.fetch as jest.Mock).mockResolvedValue(response(75));
  expect((await healthSummaryService.fetchSummary(30, 'UTC')).latest.heart_rate_resting?.value).toBe(75);
  expect(global.fetch).toHaveBeenCalledTimes(4);
});

test('distinguishes no measurements, backend failure and truncated data', async () => {
  (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false });
  expect((await healthSummaryService.fetchSummary(30, 'UTC')).availability).toBe('error');
  (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => ({ latest: {}, trends: {} }) });
  expect((await healthSummaryService.fetchSummary(30, 'UTC')).availability).toBe('empty');
  healthSummaryService.invalidate();
  (global.fetch as jest.Mock).mockResolvedValueOnce(response(60, true));
  expect((await healthSummaryService.fetchSummary(30, 'UTC')).availability).toBe('partial');
});

test('marks the previous session snapshot stale after expiry and a network failure', async () => {
  await healthSummaryService.fetchSummary(30, 'UTC');
  jest.advanceTimersByTime(61_000);
  (global.fetch as jest.Mock).mockRejectedValueOnce(new TypeError('offline'));
  const stale = await healthSummaryService.fetchSummary(30, 'UTC');
  expect(stale.availability).toBe('stale');
  expect(stale.latest.heart_rate_resting?.value).toBe(60);
  expect(stale.errorMessage).toBeTruthy();
});

test('a completed sync invalidates the cached response', async () => {
  await healthSummaryService.fetchSummary(30, 'UTC');
  healthSummaryService.invalidate();
  (global.fetch as jest.Mock).mockResolvedValue(response(65));
  expect((await healthSummaryService.fetchSummary(30, 'UTC')).latest.heart_rate_resting?.value).toBe(65);
  expect(global.fetch).toHaveBeenCalledTimes(2);
});
