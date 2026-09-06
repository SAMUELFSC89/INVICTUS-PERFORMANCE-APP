// Lote 2 (auditoria 6167c8f), Batch D -- ACT-10 em src/services/webGpsTrackingService.ts.
// Estes testes afirmam o comportamento ESPERADO da correção, não um probe de
// defeito da própria auditoria (que usou "static lifecycle trace", sem probe
// automatizado pronto).
//
// ACT-10: "Minimizar cardio na versão web mantém tempo mas interrompe coleta
// de rota". O watchPosition/wake lock viviam dentro do componente
// Challenges.tsx -- minimizar navega para /activity/exit, que desmonta o
// componente e o cleanup do efeito chamava navigator.geolocation.clearWatch()
// incondicionalmente. Estes testes provam que o novo dono do watcher
// (webGpsTrackingService, um módulo/singleton) NÃO depende de nenhum
// componente React: start()/stop() são chamados explicitamente (aqui,
// simulando os pontos reais de chamada em activityService.ts), e o watcher
// seguiria rodando entre eles independente de qualquer efeito React ter
// desmontado -- não há nenhum "cleanup automático" a testar porque não
// existe mais nenhum useEffect no meio do caminho.
import { webGpsTrackingService } from '../services/webGpsTrackingService';
import { activityService } from '../services/activityService';
import type { ActivitySession } from '../types';

jest.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: jest.fn(() => false) },
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
  jest.clearAllMocks(); // stop() acima também dispara mocks; zera de novo para as asserções do teste
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

  test('start() chamado de novo para a MESMA sessão já em rastreamento é idempotente (não reinicia o watch)', () => {
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

  test('um fix de GPS grava checkpoint e atualiza o snapshot (sinal/precisão/distância/velocidade)', () => {
    const session = baseSession();
    mockedActivityService.getCurrentSession.mockReturnValue(session);
    mockedActivityService.calculateSessionDistance.mockReturnValue(0.42);

    webGpsTrackingService.start(session);
    fakeGeolocation.lastSuccess?.(makePosition({ accuracy: 8, speed: 3 })); // 3 m/s = 10.8 km/h

    expect(mockedActivityService.addCheckpoint).toHaveBeenCalledTimes(1);
    expect(mockedActivityService.recordGpsSpeedSample).toHaveBeenCalledWith(expect.any(Number), 8);

    const snap = webGpsTrackingService.getSnapshot();
    expect(snap.accuracy).toBe(8);
    expect(snap.signal).toBe('STRONG');
    expect(snap.liveDistanceKm).toBe(0.42);
    expect(snap.liveSpeedKmH).not.toBeNull();
  });

  test('fixes recebidos DEPOIS de a sessão mudar/encerrar (getCurrentSession não bate mais) são ignorados', () => {
    const session = baseSession();
    mockedActivityService.getCurrentSession.mockReturnValue(session);
    webGpsTrackingService.start(session);

    // A sessão ativa mudou (outra atividade, ou encerrou) antes deste fix chegar.
    mockedActivityService.getCurrentSession.mockReturnValue(null);
    fakeGeolocation.lastSuccess?.(makePosition());

    expect(mockedActivityService.addCheckpoint).not.toHaveBeenCalled();
  });

  test('durante a pausa da sessão, fixes atualizam sinal mas não gravam checkpoint nem velocidade', () => {
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

  test('erro de permissão negada (code 1) marca permissionDenied no snapshot', () => {
    const session = baseSession();
    mockedActivityService.getCurrentSession.mockReturnValue(session);
    webGpsTrackingService.start(session);

    fakeGeolocation.lastError?.({ code: 1 });

    expect(webGpsTrackingService.getSnapshot().permissionDenied).toBe(true);
  });

  test('erro de posição indisponível/timeout (code 2/3) marca stalled no snapshot', () => {
    const session = baseSession();
    mockedActivityService.getCurrentSession.mockReturnValue(session);
    webGpsTrackingService.start(session);

    fakeGeolocation.lastError?.({ code: 3 });

    expect(webGpsTrackingService.getSnapshot().stalled).toBe(true);
  });

  test('stop() limpa o watch e reseta o snapshot para o estado inicial', () => {
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

  test('retry() para e reinicia o watch para a mesma sessão, limpando o estado de estagnação', () => {
    const session = baseSession();
    mockedActivityService.getCurrentSession.mockReturnValue(session);
    webGpsTrackingService.start(session);

    webGpsTrackingService.retry(session);

    expect(fakeGeolocation.clearWatch).toHaveBeenCalledTimes(1);
    expect(fakeGeolocation.watchPosition).toHaveBeenCalledTimes(2);
    expect(webGpsTrackingService.getSnapshot().stalled).toBe(false);
  });

  test('subscribe() entrega o snapshot atualizado a cada mudança e unsubscribe() para de receber', () => {
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

  test('resetForPauseToggle(true) zera a velocidade ao vivo exibida sem parar o watcher', () => {
    const session = baseSession();
    mockedActivityService.getCurrentSession.mockReturnValue(session);
    webGpsTrackingService.start(session);
    fakeGeolocation.lastSuccess?.(makePosition({ accuracy: 8, speed: 3 }));
    expect(webGpsTrackingService.getSnapshot().liveSpeedKmH).not.toBeNull();

    webGpsTrackingService.resetForPauseToggle(true);

    expect(webGpsTrackingService.getSnapshot().liveSpeedKmH).toBeNull();
    expect(webGpsTrackingService.getSnapshot().sessionId).toBe(session.id); // watcher continua "ativo"
    expect(fakeGeolocation.clearWatch).not.toHaveBeenCalled();
  });

  test('start() é um no-op quando a sessão não exige GPS', () => {
    const session = baseSession({ requiresGpsDistance: false });
    webGpsTrackingService.start(session);
    expect(fakeGeolocation.watchPosition).not.toHaveBeenCalled();
  });
});
