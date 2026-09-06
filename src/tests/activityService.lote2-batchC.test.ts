// Lote 2 (auditoria 6167c8f), Batch C -- ACT-05 em src/services/activityService.ts.
// Estes testes afirmam o comportamento ESPERADO da correção, não o probe de
// defeito da própria auditoria (activity-lifecycle.probe.test.ts: BUG A5).
//
// ACT-05: "Pausar e retomar apaga a rota nativa registrada antes da pausa".
// pauseSession() chamava nativeBackgroundLocationService.stop() e IGNORAVA
// os pontos que o plugin nativo retornava -- e como resumeSession() reinicia
// o coletor do zero (start() zera o buffer no plugin Swift/Android), esses
// pontos ficavam perdidos para sempre: nunca entravam em session.checkpoints
// nem apareciam no lote final que endSession() monta. Isso só afeta pontos
// que existem UNICAMENTE no coletor nativo -- ou seja, exatamente o cenário
// de uso normal onde o achado importa: tela bloqueada / app minimizado
// durante parte da atividade.
//
// A correção agora drena (collectAndStop) o buffer nativo ao pausar e
// IMPORTA esses pontos para session.checkpoints antes de descartar o
// coletor, e resumeSession() aguarda essa drenagem (com teto de segurança)
// antes de reiniciar o coletor nativo, para não arriscar uma corrida entre
// stopLocationTracking() (da pausa) e startLocationTracking() (do resume).
import { updateDoc } from 'firebase/firestore';
import { auth } from '../firebase';
import { nativeBackgroundLocationService } from '../services/nativeBackgroundLocationService';
import { activityService } from '../services/activityService';
import type { ActivitySession } from '../types';

jest.mock('../firebase', () => ({ auth: { currentUser: null }, db: {} }));
jest.mock('firebase/firestore', () => ({
  doc: jest.fn((..._args: unknown[]) => ({ __ref: true })),
  collection: jest.fn(() => 'active_sessions'),
  query: jest.fn((...args: unknown[]) => args),
  where: jest.fn((...args: unknown[]) => args),
  getDoc: jest.fn(),
  getDocs: jest.fn(),
  updateDoc: jest.fn(),
  setDoc: jest.fn(),
}));
jest.mock('../services/nativeBackgroundLocationService', () => ({
  nativeBackgroundLocationService: {
    start: jest.fn(async () => {}),
    stop: jest.fn(async () => []),
    collectAndStop: jest.fn(async () => [] as any[]),
  },
}));
jest.mock('../services/workoutSetJournal', () => ({
  workoutSetJournal: { finish: jest.fn(() => []), clear: jest.fn(), interrupt: jest.fn() },
}));
jest.mock('../services/sessionHeartRateService', () => ({
  sessionHeartRateService: { read: jest.fn(async () => ({ status: 'unavailable', source: null, sourceKey: null, samples: [], fetchedAt: null, truncated: false })) },
}));
jest.mock('../services/healthDataCollector', () => ({
  HealthDataCollector: { collectForSession: jest.fn(async () => ({ metricSources: {} })) },
}));
jest.mock('../services/communityChampionshipService', () => ({
  communityChampionshipService: { status: jest.fn(async () => ({ enrolled: false })) },
}));
jest.mock('../services/championshipService', () => ({
  championshipService: { getUserRegistrations: jest.fn(async () => []) },
}));
jest.mock('../lib/locationUtils', () => ({ getCurrentLocation: jest.fn(async () => ({ lat: 0, lng: 0 })) }));
jest.mock('../lib/imageCompression', () => ({ compressBase64Image: jest.fn(async (b64: string) => b64) }));
jest.mock('../services/validationService', () => ({ validationService: { calculateDistance: jest.fn(() => 0.01) } }));
jest.mock('../config', () => ({ API_CONFIG: { baseUrl: '' } }));

class MemoryStorage {
  private store: Record<string, string> = {};
  getItem(key: string) { return Object.prototype.hasOwnProperty.call(this.store, key) ? this.store[key] : null; }
  setItem(key: string, value: string) { this.store[key] = String(value); }
  removeItem(key: string) { delete this.store[key]; }
  clear() { this.store = {}; }
}
(global as any).localStorage = new MemoryStorage();

const SESSION_KEY = 'current_activity_session';
const authState = auth as unknown as { currentUser: any };

function baseSession(overrides: Partial<ActivitySession> = {}): ActivitySession {
  return {
    id: 'session-x',
    userId: 'user-A',
    type: 'cardio',
    cardioType: 'running',
    cardioTypeLabel: 'Corrida',
    isIndoorCardio: false,
    requiresGpsDistance: true,
    startTime: new Date(Date.now() - 30 * 60000).toISOString(),
    startLocation: { lat: -23.5, lng: -46.6 },
    status: 'active',
    checkpoints: [{ timestamp: new Date(Date.now() - 30 * 60000).toISOString(), segmentId: 0, location: { lat: -23.5, lng: -46.6 } }],
    maxObservedSpeedKmH: 10,
    gpsSpeedSampleCount: 5,
    isPaused: false,
    pausedMs: 0,
    pauseStartedAt: null,
    gpsSegmentId: 0,
    ...overrides,
  } as ActivitySession;
}

function seedLocalSession(overrides: Partial<ActivitySession> = {}) {
  const session = baseSession(overrides);
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

function flush() {
  // Deixa as promises fire-and-forget (pauseSession/resumeSession não são
  // async) avançarem até o fim da fila de microtasks.
  return new Promise((resolve) => setImmediate(resolve));
}

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  authState.currentUser = { uid: 'user-A', getIdToken: jest.fn(async () => 'fake-token') };
  (nativeBackgroundLocationService.collectAndStop as jest.Mock).mockResolvedValue([]);
  (updateDoc as jest.Mock).mockResolvedValue(undefined);
  for (const name of ['log', 'warn', 'error'] as const) jest.spyOn(console, name).mockImplementation(() => {});
});

describe('ACT-05: pausar drena e importa o buffer nativo em vez de descartá-lo', () => {
  test('pontos que só existiam no coletor nativo entram em session.checkpoints após pausar', async () => {
    seedLocalSession({ id: 'session-pause-drain', gpsSegmentId: 0 });
    (nativeBackgroundLocationService.collectAndStop as jest.Mock).mockResolvedValue([
      { lat: -23.502, lng: -46.602, accuracy: 6, timestamp: new Date(Date.now() - 20 * 60000).toISOString(), speedKmH: 9 },
      { lat: -23.503, lng: -46.603, accuracy: 6, timestamp: new Date(Date.now() - 19 * 60000).toISOString(), speedKmH: 9 },
    ]);

    const paused = activityService.pauseSession();
    expect(paused?.isPaused).toBe(true);
    // pauseSession() em si é síncrono e não deve esperar a drenagem nativa
    // para responder -- a UI de pausa não pode travar no bridge nativo.
    expect(nativeBackgroundLocationService.collectAndStop).toHaveBeenCalledTimes(1);

    await flush();

    const stored = JSON.parse(localStorage.getItem(SESSION_KEY) as string) as ActivitySession;
    expect(stored.checkpoints.length).toBe(3); // 1 checkpoint original + 2 pontos nativos importados
    expect(stored.checkpoints.some((c) => c.location.lat === -23.502)).toBe(true);
    expect(stored.checkpoints.some((c) => c.location.lat === -23.503)).toBe(true);
    // Os pontos drenados pertencem ao segmento ATIVO no momento da pausa,
    // não a um segmento novo ainda não criado.
    expect(stored.checkpoints.filter((c) => c.location.lat !== -23.5)[0].segmentId).toBe(0);
    expect(stored.maxObservedSpeedKmH).toBeGreaterThanOrEqual(9);

    // A drenagem também propaga pro Firestore, não fica só no localStorage.
    expect(updateDoc).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ checkpoints: expect.arrayContaining([expect.objectContaining({ segmentId: 0 })]) })
    );
  });

  test('pausar sem nenhum ponto nativo pendente não altera os checkpoints existentes', async () => {
    seedLocalSession({ id: 'session-pause-empty' });
    (nativeBackgroundLocationService.collectAndStop as jest.Mock).mockResolvedValue([]);

    activityService.pauseSession();
    await flush();

    const stored = JSON.parse(localStorage.getItem(SESSION_KEY) as string) as ActivitySession;
    expect(stored.checkpoints.length).toBe(1);
  });

  test('pontos nativos com timestamp já presente em checkpoints não são duplicados', async () => {
    const dupTimestamp = new Date(Date.now() - 25 * 60000).toISOString();
    seedLocalSession({
      id: 'session-pause-dup',
      checkpoints: [
        { timestamp: new Date(Date.now() - 30 * 60000).toISOString(), segmentId: 0, location: { lat: -23.5, lng: -46.6 } },
        { timestamp: dupTimestamp, segmentId: 0, location: { lat: -23.501, lng: -46.601 } },
      ],
    });
    (nativeBackgroundLocationService.collectAndStop as jest.Mock).mockResolvedValue([
      { lat: -23.999, lng: -46.999, accuracy: 6, timestamp: dupTimestamp, speedKmH: 9 },
    ]);

    activityService.pauseSession();
    await flush();

    const stored = JSON.parse(localStorage.getItem(SESSION_KEY) as string) as ActivitySession;
    expect(stored.checkpoints.length).toBe(2);
  });
});

describe('ACT-05: retomar aguarda a drenagem da pausa antes de reiniciar o coletor nativo', () => {
  test('resumeSession() só chama start() depois que a drenagem disparada pela pausa termina', async () => {
    seedLocalSession({ id: 'session-resume-wait', isPaused: true, pauseStartedAt: new Date().toISOString() });

    let resolveDrain!: (value: any[]) => void;
    (nativeBackgroundLocationService.collectAndStop as jest.Mock).mockReturnValue(
      new Promise((resolve) => { resolveDrain = resolve; })
    );

    // Dispara a pausa "de verdade" primeiro para popular pendingNativeDrain
    // (usamos uma sessão já isPaused:false->true simulando o fluxo real:
    // pausa, e SÓ DEPOIS retomada, com a drenagem ainda em andamento).
    localStorage.setItem(SESSION_KEY, JSON.stringify({ ...baseSession({ id: 'session-resume-wait' }) }));
    activityService.pauseSession();
    expect(nativeBackgroundLocationService.collectAndStop).toHaveBeenCalledTimes(1);

    // Retoma IMEDIATAMENTE, antes da drenagem da pausa resolver.
    activityService.resumeSession();
    await flush();
    expect(nativeBackgroundLocationService.start).not.toHaveBeenCalled();

    resolveDrain([]);
    await flush();
    await flush();

    expect(nativeBackgroundLocationService.start).toHaveBeenCalledTimes(1);
  });

  test('resumeSession() reinicia o coletor imediatamente quando não há nenhuma drenagem pendente', async () => {
    seedLocalSession({ id: 'session-resume-clean', isPaused: true, pauseStartedAt: new Date().toISOString() });

    activityService.resumeSession();
    await flush();

    expect(nativeBackgroundLocationService.start).toHaveBeenCalledTimes(1);
  });
});
