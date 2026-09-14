import { activityService } from '../services/activityService';
import { activityNotificationService } from '../services/activityNotificationService';
import { nativeBackgroundLocationService } from '../services/nativeBackgroundLocationService';
import { webGpsTrackingService } from '../services/webGpsTrackingService';
import { restoreAndResumeActiveSession } from '../services/sessionContinuityService';

jest.mock('../services/activityService', () => ({
  activityService: {
    getCurrentSession: jest.fn(),
    restoreActiveSession: jest.fn(),
    addCheckpoint: jest.fn(),
    recordGpsSpeedSample: jest.fn(),
  },
}));

jest.mock('../services/activityNotificationService', () => ({
  activityNotificationService: {
    sync: jest.fn(),
  },
}));

jest.mock('../services/nativeBackgroundLocationService', () => ({
  nativeBackgroundLocationService: {
    readBuffered: jest.fn(),
    resume: jest.fn(),
  },
}));

jest.mock('../services/webGpsTrackingService', () => ({
  webGpsTrackingService: {
    start: jest.fn(),
  },
}));

const mockedActivity = activityService as jest.Mocked<typeof activityService>;
const mockedNotification = activityNotificationService as jest.Mocked<typeof activityNotificationService>;
const mockedNative = nativeBackgroundLocationService as jest.Mocked<typeof nativeBackgroundLocationService>;
const mockedWebGps = webGpsTrackingService as jest.Mocked<typeof webGpsTrackingService>;

function session(overrides: Record<string, any> = {}) {
  return {
    id: 'session-1',
    userId: 'user-1',
    type: 'cardio',
    cardioType: 'running',
    startTime: '2026-09-13T02:00:00.000Z',
    status: 'active',
    requiresGpsDistance: true,
    checkpoints: [
      {
        timestamp: '2026-09-13T02:10:00.000Z',
        segmentId: 0,
        location: { lat: -30.0, lng: -51.0, accuracy: 7 },
      },
    ],
    isPaused: false,
    pausedMs: 0,
    pauseStartedAt: null,
    gpsSegmentId: 0,
    ...overrides,
  } as any;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedNotification.sync.mockResolvedValue(undefined);
  mockedNative.readBuffered.mockResolvedValue([]);
  mockedNative.resume.mockResolvedValue(undefined);
});

describe('Gate 1 — continuidade após recriação do app/WebView', () => {
  test('sessão local ativa religa FGS, ponte visual e usa resume nativo sem criar/restaurar outra sessão', async () => {
    const active = session();
    mockedActivity.getCurrentSession.mockReturnValue(active);

    const restored = await restoreAndResumeActiveSession();

    expect(restored).toBe(active);
    expect(mockedActivity.restoreActiveSession).not.toHaveBeenCalled();
    expect(mockedNotification.sync).toHaveBeenCalledWith(active, expect.any(Number));
    expect(mockedWebGps.start).toHaveBeenCalledWith(active);
    expect(mockedNative.resume).toHaveBeenCalledWith(active.id);
  });

  test('sessão pausada sincroniza o FGS para desligamento sem religar GPS automaticamente', async () => {
    const paused = session({ isPaused: true, pauseStartedAt: '2026-09-13T02:15:00.000Z' });
    mockedActivity.getCurrentSession.mockReturnValue(paused);

    const restored = await restoreAndResumeActiveSession();

    expect(restored).toBe(paused);
    expect(mockedNotification.sync).toHaveBeenCalledWith(paused, expect.any(Number));
    expect(mockedNative.resume).not.toHaveBeenCalled();
    expect(mockedWebGps.start).not.toHaveBeenCalled();
  });

  test('quando o estado local sumiu, captura o buffer antes do restore e reaplica somente a cauda posterior ao último checkpoint', async () => {
    const remote = session();
    let calls = 0;
    mockedActivity.getCurrentSession.mockImplementation(() => {
      calls += 1;
      return calls === 1 ? null : remote;
    });
    mockedActivity.restoreActiveSession.mockResolvedValue(remote);
    mockedNative.readBuffered.mockResolvedValue([
      { lat: -30.001, lng: -51.001, accuracy: 7, timestamp: '2026-09-13T02:09:00.000Z', speedKmH: 9 },
      { lat: -30.002, lng: -51.002, accuracy: 6, timestamp: '2026-09-13T02:11:00.000Z', speedKmH: 10 },
      { lat: -30.003, lng: -51.003, accuracy: 6, timestamp: '2026-09-13T02:12:00.000Z', speedKmH: 11 },
    ]);

    await restoreAndResumeActiveSession();

    expect(mockedNative.readBuffered).toHaveBeenCalledTimes(1);
    expect(mockedActivity.restoreActiveSession).toHaveBeenCalledTimes(1);
    expect(mockedActivity.addCheckpoint).toHaveBeenCalledTimes(2);
    expect(mockedActivity.addCheckpoint).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ lat: -30.002, lng: -51.002, speedKmH: 10 }),
      Date.parse('2026-09-13T02:11:00.000Z'),
    );
    expect(mockedActivity.addCheckpoint).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ lat: -30.003, lng: -51.003, speedKmH: 11 }),
      Date.parse('2026-09-13T02:12:00.000Z'),
    );
    expect(mockedActivity.recordGpsSpeedSample).toHaveBeenCalledTimes(2);
    expect(mockedNotification.sync).toHaveBeenCalledWith(remote, expect.any(Number));
    // O restore remoto já controla o plugin; não devemos chamar resume uma
    // segunda vez e disputar o bridge nativo com activityService.
    expect(mockedNative.resume).not.toHaveBeenCalled();
  });

  test('falha ao ler o buffer nativo não impede restaurar e retomar a sessão local', async () => {
    const active = session();
    mockedActivity.getCurrentSession.mockReturnValue(active);
    mockedNative.readBuffered.mockRejectedValue(new Error('bridge indisponível'));
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(restoreAndResumeActiveSession()).resolves.toBe(active);
    expect(mockedNotification.sync).toHaveBeenCalledWith(active, expect.any(Number));
    expect(mockedNative.resume).toHaveBeenCalledWith(active.id);
    expect(mockedWebGps.start).toHaveBeenCalledWith(active);
  });

  test('falha transitória do FGS não impede restaurar nem retomar GPS', async () => {
    const active = session();
    mockedActivity.getCurrentSession.mockReturnValue(active);
    mockedNotification.sync.mockRejectedValue(new Error('foreground service indisponível'));
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(restoreAndResumeActiveSession()).resolves.toBe(active);
    expect(mockedNative.resume).toHaveBeenCalledWith(active.id);
    expect(mockedWebGps.start).toHaveBeenCalledWith(active);
  });
});
