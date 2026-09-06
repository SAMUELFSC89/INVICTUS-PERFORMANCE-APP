// Lote 2 (auditoria 6167c8f), Batch D -- ACT-10 em src/services/webGpsTrackingService.ts.
import { webGpsTrackingService } from '../services/webGpsTrackingService';
import { activityService } from '../services/activityService';
import type { ActivitySession } from '../types';

jest.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: jest.fn(() => false), getPlatform: jest.fn(() => 'web') },
  registerPlugin: jest.fn(() => ({
    startLocationTracking: jest.fn().mockResolvedValue(undefined),
    getTrackedLocations: jest.fn().mockResolvedValue({ locations: [] }),
    stopLocationTracking: jest.fn().mockResolvedValue({ locations: [] }),
    addListener: jest.fn().mockResolvedValue({ remove: jest.fn() }),
  })),
}));

jest.mock('../services/activityService', () => ({
  activityService: {
    getCurrentSession: jest.fn(),
    addCheckpoint: jest.fn(),
    recordGpsSpeedSample: jest.fn(),
    calculateSessionDistance: jest.fn(() => 0),
  },
}));

const mockedActivityService = activityService as jest.Mocked<typeof activityService>;

function baseSession(overrides: Partial<ActivitySession> = {}): ActivitySession {
  return {
    id: 'session-x',
    userId: 'user-A',
    type: 'cardio',
    cardioType: 'running',
    isIndoorCardio: false,
    requiresGpsDistance: true,
    startTime: new Date().toISOString(),
    startLocation: { lat: -23.5, lng: -46.6 },
    status: 'active',
    checkpoints: [],
    maxObservedSpeedKmH: 0,
    gpsSpeedSampleCount: 0,
    isPaused: false,
    pausedMs: 0,
    pauseStartedAt: null,
    gpsSegmentId: 0,
    ...overrides,
  } as ActivitySession;
}

type WatchSuccess = (position: any) => void;
type WatchError = (err: any) => void;

class FakeGeolocation {
  watchPosition = jest.fn((success: WatchSuccess, _error: WatchError, _opts: any) => {
    this.lastSuccess = success;
    this.lastError = _error;
    this.nextId += 1;
    return this.nextId;
  });
  clearWatch = jest.fn();
  lastSuccess: WatchSuccess | null = null;
  lastError: WatchError | null = null;
  nextId = 0;
}

function makePosition(overrides: Partial<{ lat: number; lng: number; accuracy: number; speed: number | null; timestamp: number }> = {}) {
  const { lat = -23.5, lng = -46.6, accuracy = 10, speed = null, timestamp = Date.now() } = overrides;
  return {
    coords: { latitude: lat, longitude: lng, accuracy, speed },
    timestamp,
  };
}

let fakeGeolocation: FakeGeolocation;

beforeEach(() => {
  jest.clearAllMocks();
  fakeGeolocation = new FakeGeolocation();
  (global as any).navigator = { geolocation: fakeGeolocation };
  webGpsTrackingService.stop();
  jest.clearAllMocks();
  fakeGeolocation = new FakeGeolocation();
  (global as any).navigator = { geolocation: fakeGeolocation };
  for (const name of ['log', 'warn', 'error'] as const) jest.spyOn(console, name).mockImplementation(() => {});
});

describe('webGpsTrackingService: dono único do watcher, independente de componentes React', () => {
  test('start() registra um watchPosition e o snapshot passa a refletir a sessão', () => {
    const session = baseSession();
    mockedActivityService.getCurrentSession.mockReturnValue(session);
    webGpsTrackingService.start(session);
    expect(fakeGeolocation.watchPosition).toHaveBeenCalledTimes(1);
    expect(webGpsTrackingService.getSnapshot().sessionId).toBe(session.id);
  });

  test('start() chamado de novo para a MESMA sessão já em rastreamento é idempotente', () => {
    const session = baseSession();
    mockedActivityService.getCurrentSession.mockReturnValue(session);
    webGpsTrackingService.start(session);
    webGpsTrackingService.start(session);
    webGpsTrackingService.start(session);
    expect(fakeGeolocation.watchPosition).toHaveBeenCalledTimes(1);
  });

  test('start() para uma sessão DIFERENTE para o watcher anterior antes de iniciar o novo', () => {
    const sessionA = baseSession({ id: 'session-a' });
    const sessionB = baseSession({ id: 'session-b' });
    mockedActivityService.getCurrentSession.mockReturnValue(sessionA);
    webGpsTrackingService.start(sessionA);
    expect(fakeGeolocation.watchPosition).toHaveBeenCalledTimes(1);
    mockedActivityService.getCurrentSession.mockReturnValue(sessionB);
    webGpsTrackingService.start(sessionB);
    expect(fakeGeolocation.clearWatch).toHaveBeenCalledTimes(1);
    expect(fakeGeolocation.watchPosition).toHaveBeenCalledTimes(2);
    expect(webGpsTrackingService.getSnapshot().sessionId).toBe('session-b');
  });

  test('um fix de GPS grava checkpoint e atualiza o snapshot', () => {
    const session = baseSession();
    mockedActivityService.getCurrentSession.mockReturnValue(session);
    mockedActivityService.calculateSessionDistance.mockReturnValue(0.42);
    webGpsTrackingService.start(session);
    fakeGeolocation.lastSuccess?.(makePosition({ accuracy: 8, speed: 3 }));
    expect(mockedActivityService.addCheckpoint).toHaveBeenCalledTimes(1);
    expect(mockedActivityService.recordGpsSpeedSample).toHaveBeenCalledWith(expect.any(Number), 8);
    const snap = webGpsTrackingService.getSnapshot();
    expect(snap.accuracy).toBe(8);
    expect(snap.signal).toBe('STRONG');
    expect(snap.liveDistanceKm).toBe(0.42);
    expect(snap.liveSpeedKmH).toBeCloseTo(10.8);
  });

  test('speed=0 explícito permanece parado e não vira velocidade derivada por drift', () => {
    const session = baseSession();
    mockedActivityService.getCurrentSession.mockReturnValue(session);
    webGpsTrackingService.start(session);
    const t0 = Date.now();
    fakeGeolocation.lastSuccess?.(makePosition({ lat: -23.5, lng: -46.6, accuracy: 8, speed: 0, timestamp: t0 }));
    // Segundo ponto "pulou" vários metros, como acontece com GPS parado. Como
    // o provedor informou speed=0, esse salto NÃO pode virar pace/velocidade.
    fakeGeolocation.lastSuccess?.(makePosition({ lat: -23.49994, lng: -46.59994, accuracy: 8, speed: 0, timestamp: t0 + 3000 }));
    expect(webGpsTrackingService.getSnapshot().liveSpeedKmH).toBe(0);
    expect(mockedActivityService.recordGpsSpeedSample).toHaveBeenLastCalledWith(0, 8);
  });

  test('fixes recebidos depois de a sessão mudar/encerrar são ignorados', () => {
    const session = baseSession();
    mockedActivityService.getCurrentSession.mockReturnValue(session);
    webGpsTrackingService.start(session);
    mockedActivityService.getCurrentSession.mockReturnValue(null);
    fakeGeolocation.lastSuccess?.(makePosition());
    expect(mockedActivityService.addCheckpoint).not.toHaveBeenCalled();
  });

  test('durante a pausa, fixes atualizam sinal mas não gravam checkpoint nem velocidade', () => {
    const session = baseSession({ isPaused: true });
    mockedActivityService.getCurrentSession.mockReturnValue(session);
    webGpsTrackingService.start(session);
    fakeGeolocation.lastSuccess?.(makePosition({ accuracy: 15, speed: 5 }));
    expect(mockedActivityService.addCheckpoint).not.toHaveBeenCalled();
    expect(mockedActivityService.recordGpsSpeedSample).not.toHaveBeenCalled();
    const snap = webGpsTrackingService.getSnapshot();
    expect(snap.accuracy).toBe(15);
    expect(snap.liveSpeedKmH).toBeNull();
  });

  test('erro de permissão negada marca permissionDenied', () => {
    const session = baseSession();
    mockedActivityService.getCurrentSession.mockReturnValue(session);
    webGpsTrackingService.start(session);
    fakeGeolocation.lastError?.({ code: 1 });
    expect(webGpsTrackingService.getSnapshot().permissionDenied).toBe(true);
  });

  test('erro de posição indisponível/timeout marca stalled', () => {
    const session = baseSession();
    mockedActivityService.getCurrentSession.mockReturnValue(session);
    webGpsTrackingService.start(session);
    fakeGeolocation.lastError?.({ code: 3 });
    expect(webGpsTrackingService.getSnapshot().stalled).toBe(true);
  });

  test('stop() limpa o watch e reseta o snapshot', () => {
    const session = baseSession();
    mockedActivityService.getCurrentSession.mockReturnValue(session);
    webGpsTrackingService.start(session);
    fakeGeolocation.lastSuccess?.(makePosition({ accuracy: 8, speed: 3 }));
    webGpsTrackingService.stop();
    expect(fakeGeolocation.clearWatch).toHaveBeenCalledTimes(1);
    const snap = webGpsTrackingService.getSnapshot();
    expect(snap.sessionId).toBeNull();
    expect(snap.liveDistanceKm).toBe(0);
    expect(snap.liveSpeedKmH).toBeNull();
  });

  test('retry() para e reinicia o watch para a mesma sessão', () => {
    const session = baseSession();
    mockedActivityService.getCurrentSession.mockReturnValue(session);
    webGpsTrackingService.start(session);
    webGpsTrackingService.retry(session);
    expect(fakeGeolocation.clearWatch).toHaveBeenCalledTimes(1);
    expect(fakeGeolocation.watchPosition).toHaveBeenCalledTimes(2);
    expect(webGpsTrackingService.getSnapshot().stalled).toBe(false);
  });

  test('subscribe() entrega atualização e unsubscribe() para de receber', () => {
    const session = baseSession();
    mockedActivityService.getCurrentSession.mockReturnValue(session);
    const updates: number[] = [];
    const unsubscribe = webGpsTrackingService.subscribe((snap) => { if (snap.accuracy !== null) updates.push(snap.accuracy); });
    webGpsTrackingService.start(session);
    fakeGeolocation.lastSuccess?.(makePosition({ accuracy: 12 }));
    unsubscribe();
    fakeGeolocation.lastSuccess?.(makePosition({ accuracy: 99 }));
    expect(updates).toEqual([12]);
  });

  test('resetForPauseToggle(true) zera a velocidade sem parar o watcher', () => {
    const session = baseSession();
    mockedActivityService.getCurrentSession.mockReturnValue(session);
    webGpsTrackingService.start(session);
    fakeGeolocation.lastSuccess?.(makePosition({ accuracy: 8, speed: 3 }));
    expect(webGpsTrackingService.getSnapshot().liveSpeedKmH).not.toBeNull();
    webGpsTrackingService.resetForPauseToggle(true);
    expect(webGpsTrackingService.getSnapshot().liveSpeedKmH).toBeNull();
    expect(webGpsTrackingService.getSnapshot().sessionId).toBe(session.id);
    expect(fakeGeolocation.clearWatch).not.toHaveBeenCalled();
  });

  test('start() é no-op quando a sessão não exige GPS', () => {
    const session = baseSession({ requiresGpsDistance: false });
    webGpsTrackingService.start(session);
    expect(fakeGeolocation.watchPosition).not.toHaveBeenCalled();
  });
});
