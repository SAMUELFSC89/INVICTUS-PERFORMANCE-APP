jest.mock('../../src/firebase', () => ({ auth: { currentUser: { uid: 'athlete-a' } } }));
jest.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: jest.fn(), getPlatform: jest.fn() } }));
jest.mock('../../src/services/wearables/WearableManager', () => ({ WearableManager: { getInstance: jest.fn() } }));
jest.mock('../../src/services/wearables/HealthVitalsProvider', () => ({ readCompleteHealthRange: jest.fn() }));

import { auth } from '../../src/firebase';
import { Capacitor } from '@capacitor/core';
import type { HealthSample } from 'capgo-capacitor-health';
import { WearableManager } from '../../src/services/wearables/WearableManager';
import { readCompleteHealthRange } from '../../src/services/wearables/HealthVitalsProvider';
import { normalizeSessionHeartRateEvidence, sessionHeartRateService, sessionHeartRateSourceKey, SESSION_HEART_RATE_TIMEOUT_MS } from '../../src/services/sessionHeartRateService';

const start = '2026-09-05T10:00:00.000Z';
const end = '2026-09-05T11:00:00.000Z';
const sample = (overrides: Partial<HealthSample> = {}): HealthSample => ({
  dataType: 'heartRate', startDate: start, endDate: start, unit: 'bpm', value: 110,
  sourceId: 'com.example.watch', localIdentifier: 'device-1', recordingMethod: 'automatic', ...overrides,
});
let manager: { getAuthenticatedUserId: jest.Mock; getConnectedNativeProviders: jest.Mock; isProviderEnabledForUser: jest.Mock };

beforeEach(() => {
  jest.resetAllMocks();
  (auth as any).currentUser = { uid: 'athlete-a' };
  (Capacitor.isNativePlatform as jest.Mock).mockReturnValue(true);
  (Capacitor.getPlatform as jest.Mock).mockReturnValue('ios');
  manager = {
    getAuthenticatedUserId: jest.fn(() => auth.currentUser?.uid),
    getConnectedNativeProviders: jest.fn().mockResolvedValue([{ id: 'apple_health' }, { id: 'health_connect' }]),
    isProviderEnabledForUser: jest.fn().mockReturnValue(true),
  };
  (WearableManager.getInstance as jest.Mock).mockReturnValue(manager);
  (readCompleteHealthRange as jest.Mock).mockResolvedValue([sample()]);
});

afterEach(() => jest.useRealTimers());

test('reads timestamped heart rate directly without requesting permissions or requiring a native workout', async () => {
  const result = await sessionHeartRateService.read('athlete-a', start, end);
  expect(result).toMatchObject({ status: 'available', source: 'apple_health', truncated: false, samples: [{ timestamp: start, bpm: 110 }] });
  expect(result.sourceKey).toContain('device-1');
  expect(readCompleteHealthRange).toHaveBeenCalledWith('heartRate', new Date(start), new Date(end), 1000, expect.any(AbortSignal));
});

test('selects Health Connect on native Android without a route permission gate', async () => {
  (Capacitor.getPlatform as jest.Mock).mockReturnValue('android');
  expect(await sessionHeartRateService.read('athlete-a', start, end)).toMatchObject({ source: 'health_connect', status: 'available' });
  expect(manager.isProviderEnabledForUser).toHaveBeenCalledWith('health_connect', 'athlete-a');
});

test('web and mismatched accounts never query native health', async () => {
  expect(await sessionHeartRateService.read('other', start, end)).toMatchObject({ status: 'unavailable', samples: [] });
  (Capacitor.isNativePlatform as jest.Mock).mockReturnValue(false);
  expect(await sessionHeartRateService.read('athlete-a', start, end)).toMatchObject({ status: 'unavailable', samples: [] });
  expect(readCompleteHealthRange).not.toHaveBeenCalled();
});

test('disabled connection never queries native health', async () => {
  manager.isProviderEnabledForUser.mockReturnValue(false);
  const result = await sessionHeartRateService.read('athlete-a', start, end);
  expect(result).toMatchObject({ status: 'unavailable', samples: [] });
  expect(readCompleteHealthRange).not.toHaveBeenCalled();
});

test('empty successful reading is pending without invented averages or points', async () => {
  (readCompleteHealthRange as jest.Mock).mockResolvedValue([]);
  expect(await sessionHeartRateService.read('athlete-a', start, end)).toMatchObject({ status: 'pending', sourceKey: null, samples: [], truncated: false });
});

test('native permission failure is unavailable and dense incomplete read is explicitly truncated', async () => {
  (readCompleteHealthRange as jest.Mock).mockRejectedValueOnce(new Error('permission denied'));
  expect(await sessionHeartRateService.read('athlete-a', start, end)).toMatchObject({ status: 'unavailable', samples: [], reason: expect.stringContaining('acesso') });
  (readCompleteHealthRange as jest.Mock).mockRejectedValueOnce(new Error('Limite de amostras no mesmo instante; histórico ainda incompleto.'));
  expect(await sessionHeartRateService.read('athlete-a', start, end)).toMatchObject({ status: 'pending', samples: [], truncated: true });
});

test('account change during configuration load cancels before any health query', async () => {
  manager.getConnectedNativeProviders.mockImplementation(async () => { (auth as any).currentUser = { uid: 'athlete-b' }; return [{ id: 'apple_health' }]; });
  expect(await sessionHeartRateService.read('athlete-a', start, end)).toMatchObject({ status: 'unavailable', samples: [] });
  expect(readCompleteHealthRange).not.toHaveBeenCalled();
});

test('account change during native read discards all returned personal measurements', async () => {
  (readCompleteHealthRange as jest.Mock).mockImplementation(async () => { (auth as any).currentUser = { uid: 'athlete-b' }; return [sample()]; });
  expect(await sessionHeartRateService.read('athlete-a', start, end)).toMatchObject({ status: 'unavailable', source: null, samples: [] });
});

test('disconnect during native reading discards measurements', async () => {
  (readCompleteHealthRange as jest.Mock).mockImplementation(async () => { manager.isProviderEnabledForUser.mockReturnValue(false); return [sample()]; });
  expect(await sessionHeartRateService.read('athlete-a', start, end)).toMatchObject({ status: 'unavailable', samples: [] });
});

test('entire operation including a hung configuration load is bounded to 4.5 seconds', async () => {
  jest.useFakeTimers();
  manager.getConnectedNativeProviders.mockReturnValue(new Promise(() => {}));
  const pending = sessionHeartRateService.read('athlete-a', start, end);
  await jest.advanceTimersByTimeAsync(SESSION_HEART_RATE_TIMEOUT_MS);
  expect(await pending).toMatchObject({ status: 'pending', samples: [], reason: expect.stringContaining('demorou') });
  expect(readCompleteHealthRange).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
});

test('external cancellation aborts a hung native read and does not return late data', async () => {
  (readCompleteHealthRange as jest.Mock).mockReturnValue(new Promise(() => {}));
  const controller = new AbortController();
  const pending = sessionHeartRateService.read('athlete-a', start, end, controller.signal);
  await Promise.resolve();
  controller.abort();
  expect(await pending).toMatchObject({ status: 'unavailable', samples: [] });
});

test.each([[end, start], ['invalid', end], ['2026-09-05T10:00:00', end], [start, '2026-09-06T10:00:00.000Z']])('invalid session interval %s — %s never queries health', async (from, until) => {
  expect(await sessionHeartRateService.read('athlete-a', from, until)).toMatchObject({ status: 'unavailable', samples: [] });
  expect(readCompleteHealthRange).not.toHaveBeenCalled();
});

test('deduplicates identical timestamps without collapsing all points from a shared native record ID', () => {
  const next = '2026-09-05T10:00:05.000Z';
  const records = [sample({ platformId: 'record' }), sample({ platformId: 'record' }), sample({ platformId: 'record', startDate: next, endDate: next, value: 115 })];
  const result = normalizeSessionHeartRateEvidence(records, 'apple_health', start, end);
  expect(result.samples).toEqual([{ timestamp: start, bpm: 110 }, { timestamp: next, bpm: 115 }]);
  expect(result.status).toBe('available');
});

test('conflicting values at the same origin/time are removed rather than averaged or picked by input order', () => {
  const later = '2026-09-05T10:00:05.000Z';
  const result = normalizeSessionHeartRateEvidence([sample(), sample({ value: 150 }), sample({ startDate: later, endDate: later, value: 120 })], 'apple_health', start, end);
  expect(result.status).toBe('partial');
  expect(result.samples).toEqual([{ timestamp: later, bpm: 120 }]);
});

test('multiple origins are never merged; a single known origin is selected and partial status is explicit', () => {
  const result = normalizeSessionHeartRateEvidence([sample(), sample({ sourceId: 'other-app', localIdentifier: 'device-2', value: 160 })], 'apple_health', start, end);
  expect(result.status).toBe('partial');
  expect(result.samples).toHaveLength(1);
  expect(result.reason).toContain('origens diferentes');
});

test('display-only identity remains unknown and does not prevent honest within-session descriptions', () => {
  const result = normalizeSessionHeartRateEvidence([sample({ sourceId: undefined, localIdentifier: undefined, sourceName: 'My Watch' })], 'apple_health', start, end);
  expect(result).toMatchObject({ status: 'available', sourceKey: null, samples: [{ timestamp: start, bpm: 110 }] });
  expect(result.reason).toContain('identificou');
  expect(sessionHeartRateSourceKey({ sourceName: 'A' }, 'apple_health')).toBeNull();
});

test('device source keys ignore visual names and software updates but distinguish physical identifiers', () => {
  const key = sessionHeartRateSourceKey(sample({ sourceName: 'Watch', softwareVersion: '1' }), 'apple_health');
  expect(sessionHeartRateSourceKey(sample({ sourceName: 'Meu relógio', softwareVersion: '2' }), 'apple_health')).toBe(key);
  expect(sessionHeartRateSourceKey(sample({ localIdentifier: 'device-2' }), 'apple_health')).not.toBe(key);
});

test('boundaries are exact; out-of-window samples are excluded without marking usable in-window data incomplete', () => {
  const before = '2026-09-05T09:59:59.000Z';
  const result = normalizeSessionHeartRateEvidence([sample(), sample({ startDate: before, endDate: before }), sample({ startDate: end, endDate: end })], 'apple_health', start, end);
  expect(result.samples).toEqual([{ timestamp: start, bpm: 110 }]);
  expect(result.status).toBe('available');
});

test('short native quantity windows retain actual end timestamp; long aggregate intervals are excluded', () => {
  const shortEnd = '2026-09-05T10:00:05.000Z';
  const result = normalizeSessionHeartRateEvidence([sample({ endDate: shortEnd }), sample({ startDate: '2026-09-05T10:10:00.000Z', endDate: '2026-09-05T10:20:00.000Z' })], 'apple_health', start, end);
  expect(result.samples).toEqual([{ timestamp: shortEnd, bpm: 110 }]);
  expect(result.reason).toContain('janelas de até 5 segundos');
  expect(result.status).toBe('partial');
});

test('manual, implausible, nonnumeric and incompatible-unit data never become sensor measurements', () => {
  const result = normalizeSessionHeartRateEvidence([
    sample({ recordingMethod: 'manual' }), sample({ value: 29 }), sample({ value: 241 }), sample({ value: '110' as any }), sample({ unit: 'count' }),
  ], 'apple_health', start, end);
  expect(result.samples).toEqual([]);
  expect(result.status).toBe('unavailable');
});

test('overflow never silently returns a complete curve or fabricated reduced points', () => {
  const values = Array.from({ length: 5001 }, (_, index) => {
    const time = new Date(Date.parse(start) + index * 100).toISOString();
    return sample({ startDate: time, endDate: time, value: 100 + index % 20 });
  });
  const result = normalizeSessionHeartRateEvidence(values, 'apple_health', start, end);
  expect(result).toMatchObject({ status: 'partial', truncated: true });
  expect(result.samples).toHaveLength(5000);
  expect(result.samples.at(-1)?.timestamp).toBe(values[4999].endDate);
  expect(result.reason).toContain('5.000');
});
