import { activityService } from '../services/activityService';
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

jest.mock('../services/nativeBackgroundLocationService', () => ({
  nativeBackgroundLocationService: {
    readBufferedSnapshot: jest.fn(),
    resume: jest.fn(),
  },
}));

jest.mock('../services/webGpsTrackingService', () => ({
  webGpsTrackingService: {
    start: jest.fn(),
  },
}));

const mockedActivity = activityService as jest.Mocked<typeof activityService>;
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
  mockedNative.readBufferedSnapshot.mockResolvedValue({ sessionId: null, locations: [] });
  mockedNative.resume.mockResolvedValue(undefined);
});

describe('Gate 1 — continuidade após recriação do app/WebView', () => {
  test('sessão local ativa religa a ponte visual e usa resume nativo sem criar/restaurar outra sessão', async () => {
    const active = session();
    mockedActivity.getCurrentSession.mockReturnValue(active);

    const restored = await restoreAndResumeActiveSession();

    expect(restored).toBe(active);
    expect(mockedActivity.restoreActiveSession).not.toHaveBeenCalled();
    expect(mockedWebGps.start).toHaveBeenCalledWith(active);
    expect(mockedNative.resume).toHaveBeenCalledWith(active.id);
  });

  test('sessão pausada é restaurada sem religar GPS automaticamente', async () => {
    const paused = session({ isPaused: true, pauseStartedAt: '2026-09-13T02:15:00.000Z' });
    mockedActivity.getCurrentSession.mockReturnValue(paused);

    const restored = await restoreAndResumeActiveSession();

    expect(restored).toBe(paused);
    expect(mockedNative.resume).not.toHaveBeenCalled();
    expect(mockedWebGps.start).not.toHaveBeenCalled();
  });

  test('quando o estado local sumiu, captura o buffer da mesma sessão antes do restore e reaplica somente a cauda posterior ao último checkpoint', async () => {
    const remote = session();
    let calls = 0;
    mockedActivity.getCurrentSession.mockImplementation(() => {
      calls += 1;
      return calls === 1 ? null : remote;
    });
    mockedActivity.restoreActiveSession.mockResolvedValue(remote);
    mockedNative.readBufferedSnapshot.mockResolvedValue({
      sessionId: remote.id,
      locations: [
        { lat: -30.001, lng: -51.001, accuracy: 7, timestamp: '2026-09-13T02:09:00.000Z', speedKmH: 9 },
        { lat: -30.002, lng: -51.002, accuracy: 6, timestamp: '2026-09-13T02:11:00.000Z', speedKmH: 10 },
        { lat: -30.003, lng: -51.003, accuracy: 6, timestamp: '2026-09-13T02:12:00.000Z', speedKmH: 11 },
      ],
    });

    await restoreAndResumeActiveSession();

    expect(mockedNative.readBufferedSnapshot).toHaveBeenCalledTimes(1);
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
    // O restore remoto já controla o plugin; não devemos chamar resume uma
    // segunda vez e disputar o bridge nativo com activityService.
    expect(mockedNative.resume).not.toHaveBeenCalled();
  });

  test('buffer persistido de outra sessão nunca é reaplicado na sessão restaurada', async () => {
    const remote = session();
    let calls = 0;
    mockedActivity.getCurrentSession.mockImplementation(() => {
      calls += 1;
      return calls === 1 ? null : remote;
    });
    mockedActivity.restoreActiveSession.mockResolvedValue(remote);
    mockedNative.readBufferedSnapshot.mockResolvedValue({
      sessionId: 'session-antiga',
      locations: [
        { lat: -30.004, lng: -51.004, accuracy: 5, timestamp: '2026-09-13T02:12:30.000Z', speedKmH: 12 },
      ],
    });
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    await restoreAndResumeActiveSession();

    expect(mockedActivity.addCheckpoint).not.toHaveBeenCalled();
    expect(mockedActivity.recordGpsSpeedSample).not.toHaveBeenCalled();
  });

  test('falha ao ler o buffer nativo não impede restaurar e retomar a sessão local', async () => {
    const active = session();
    mockedActivity.getCurrentSession.mockReturnValue(active);
    mockedNative.readBufferedSnapshot.mockRejectedValue(new Error('bridge indisponível'));
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(restoreAndResumeActiveSession()).resolves.toBe(active);
    expect(mockedNative.resume).toHaveBeenCalledWith(active.id);
    expect(mockedWebGps.start).toHaveBeenCalledWith(active);
  });
});
