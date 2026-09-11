// Lote 2 (auditoria 6167c8f), Batch B -- cobre o lado CLIENTE de ACT-03,
// ACT-04 e ACT-06 em src/services/activityService.ts. Estes testes afirmam o
// comportamento ESPERADO das correções, não os probes de defeito da própria
// auditoria.
//
// ACT-03: a escrita final que marca active_sessions/{id} como 'completed'
// (tanto em endSession() quanto em completeSessionAfterPresence()) não tinha
// NENHUM timeout -- diferente de quase toda outra chamada ao Firestore neste
// arquivo. Uma conexão que trava (nem fecha, nem abre) deixava o atleta preso
// numa tela de finalização que nunca sai do lugar, mesmo com a atividade já
// validada e persistida pelo servidor.
//
// ACT-04: quando essa escrita final falhava, o código já gravava uma marca
// local ("sessao_encerrada_<id>") mas ELA NUNCA ERA LIDA em lugar nenhum --
// getCurrentSession(), restoreActiveSession() e o loop de restauração de
// startSession() só olhavam o campo `status` do documento remoto, que
// continuava 'active' justamente porque a escrita que o mudaria falhou.
// Resultado: uma sessão que o atleta já encerrou/cancelou podia "ressuscitar"
// sozinha na próxima abertura do app.
//
// ACT-06: collectAndStop() para o coletor nativo de GPS ANTES da chamada de
// rede que finaliza a atividade. Se essa chamada falhar (rede caiu, ou o
// servidor responde com erro), a sessão local continua "active" mas sem
// NENHUM coletor de GPS rodando -- um novo trecho percorrido enquanto o
// atleta decide tentar de novo desaparecia silenciosamente.
import { getDocs, setDoc, updateDoc } from 'firebase/firestore';
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
    // O bridge de GPS ao vivo passou a consultar esta superfície também.
    // Estes testes exercitam activityService, não a ponte nativa; portanto
    // mantemos isSupported=false para preservar o cenário original e evitar
    // uma segunda coleta visual além do coletor explicitamente testado aqui.
    isSupported: jest.fn(() => false),
    getSnapshot: jest.fn(() => ({
      sessionId: null,
      accuracy: null,
      signal: 'SEARCHING',
      permissionDenied: false,
      stalled: false,
      liveSpeedKmH: null,
      liveSpeedUpdatedAt: null,
      latestPoint: null,
    })),
    subscribe: jest.fn(() => jest.fn()),
    readBuffered: jest.fn(async () => [] as any[]),
    start: jest.fn(async () => {}),
    stop: jest.fn(async () => []),
    collectAndStop: jest.fn(async () => [] as any[]),
  },
}));
jest.mock('../services/workoutSetJournal', () => ({
  workoutSetJournal: { finish: jest.fn(() => []), clear: jest.fn(), interrupt: jest.fn() },
}));
jest.mock('../services/sessionHeartRateService', () => ({
  sessionHeartRateService: {
    read: jest.fn(async () => ({
      status: 'unavailable', source: null, sourceKey: null, samples: [], fetchedAt: null,
      truncated: false, reason: 'sem dados nesta sessão de teste',
    })),
  },
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
jest.mock('../services/validationService', () => ({
  validationService: { calculateDistance: jest.fn(() => 0.01) },
}));
// ../config usa `import.meta.env` (sintaxe exclusiva do Vite) -- fora do
// bundler ela nunca é transformável pelo ts-jest (roda em CommonJS puro),
// então precisa ser mockada como qualquer outra dependência de borda.
jest.mock('../config', () => ({ API_CONFIG: { baseUrl: '' } }));

// Polyfill mínimo de localStorage -- jest.config.cjs usa testEnvironment:
// 'node', que não tem localStorage nem window. activityService.ts lê
// localStorage diretamente (sem guarda de `typeof window`) em
// getCurrentSession/cancelSession/completeSessionAfterPresence, então
// precisamos de um stub em memória para exercitar esse código exatamente
// como ele roda no navegador/WebView real.
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

function mockFetchOnce(response: { ok: boolean; status?: number; json: () => Promise<any> }) {
  (global as any).fetch = jest.fn(async () => response as any);
}

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  authState.currentUser = { uid: 'user-A', getIdToken: jest.fn(async () => 'fake-token') };
  (nativeBackgroundLocationService.collectAndStop as jest.Mock).mockResolvedValue([
    { lat: -23.501, lng: -46.601, accuracy: 5, timestamp: new Date().toISOString(), speedKmH: 8 },
  ]);
  for (const name of ['log', 'warn', 'error'] as const) jest.spyOn(console, name).mockImplementation(() => {});
});

describe('ACT-04: uma sessão marcada como encerrada nunca ressuscita sozinha', () => {
  test('getCurrentSession descarta e limpa o estado local de uma sessão com marca de encerramento', () => {
    const session = seedLocalSession();
    localStorage.setItem('sessao_encerrada_' + session.id, new Date().toISOString());

    expect(activityService.getCurrentSession()).toBeNull();
    expect(localStorage.getItem(SESSION_KEY)).toBeNull();
  });

  test('restoreActiveSession não resgata do servidor uma sessão marcada como encerrada, mesmo com o documento remoto ainda "active"', async () => {
    const session = baseSession();
    localStorage.setItem('sessao_encerrada_' + session.id, new Date().toISOString());
    (getDocs as jest.Mock).mockResolvedValue({
      docs: [{ data: () => ({ ...session, status: 'active' }) }],
    });

    const restored = await activityService.restoreActiveSession();

    expect(restored).toBeNull();
    expect(updateDoc).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ status: 'completed' }));
    expect(nativeBackgroundLocationService.start).not.toHaveBeenCalled();
    expect(localStorage.getItem(SESSION_KEY)).toBeNull();
  });

  test('restoreActiveSession continua restaurando normalmente uma sessão remota ativa e SEM marca de encerramento', async () => {
    const session = baseSession({ id: 'session-normal' });
    (getDocs as jest.Mock).mockResolvedValue({ docs: [{ data: () => ({ ...session, status: 'active' }) }] });

    const restored = await activityService.restoreActiveSession();

    expect(restored).not.toBeNull();
    expect(restored?.id).toBe('session-normal');
    expect(localStorage.getItem(SESSION_KEY)).not.toBeNull();
  });

  test('cancelSession grava a marca de encerramento quando a escrita de cancelamento falha no servidor', async () => {
    const session = seedLocalSession({ id: 'session-cancel' });
    (updateDoc as jest.Mock).mockRejectedValue(new Error('Firestore indisponível'));

    activityService.cancelSession();
    await Promise.resolve();
    await Promise.resolve();

    expect(localStorage.getItem('sessao_encerrada_' + session.id)).not.toBeNull();
    expect(localStorage.getItem(SESSION_KEY)).toBeNull();
  });
});

describe('ACT-03 / ACT-04: falha na escrita final de encerramento nunca trava nem ressuscita a sessão', () => {
  test('endSession() não lança erro e marca a sessão como encerrada localmente quando a confirmação final no servidor falha, mesmo com a atividade já validada', async () => {
    seedLocalSession({ id: 'session-final-fail' });
    mockFetchOnce({
      ok: true,
      json: async () => ({
        success: true,
        status: 'valid',
        workout: { id: 'w1', status: 'valid' },
        isScoringEligible: true,
      }),
    });
    (updateDoc as jest.Mock).mockRejectedValue(new Error('Tempo limite ao confirmar encerramento da sessão no servidor.'));

    const result = await activityService.endSession();

    expect(result.workout?.id).toBe('w1');
    expect(localStorage.getItem('sessao_encerrada_session-final-fail')).not.toBeNull();
  });

  test('completeSessionAfterPresence() marca a sessão como encerrada localmente quando a confirmação final falha', async () => {
    const session = seedLocalSession({ id: 'session-presence-fail' });
    (updateDoc as jest.Mock).mockRejectedValue(new Error('offline'));

    await activityService.completeSessionAfterPresence();

    expect(localStorage.getItem('sessao_encerrada_' + session.id)).not.toBeNull();
    expect(localStorage.getItem(SESSION_KEY)).toBeNull();
  });
});

describe('ACT-06: uma falha ao enviar a finalização reinicia o coletor nativo de GPS', () => {
  test('erro de rede (fetch rejeita) reinicia o rastreamento nativo antes de propagar o erro', async () => {
    seedLocalSession({ id: 'session-network-fail' });
    (global as any).fetch = jest.fn(async () => { throw new Error('network down'); });

    await expect(activityService.endSession()).rejects.toThrow(/Falha de conexão/);

    expect(nativeBackgroundLocationService.start).toHaveBeenCalledTimes(1);
  });

  test('erro do servidor (503, ex.: ACT-01) também reinicia o rastreamento nativo antes de propagar o erro', async () => {
    seedLocalSession({ id: 'session-server-fail' });
    mockFetchOnce({ ok: false, status: 503, json: async () => ({ message: 'Não foi possível registrar sua atividade agora.' }) });

    await expect(activityService.endSession()).rejects.toThrow('Não foi possível registrar sua atividade agora.');

    expect(nativeBackgroundLocationService.start).toHaveBeenCalledTimes(1);
  });

  test('sucesso no envio NÃO reinicia o rastreamento nativo (já foi consumido por collectAndStop)', async () => {
    seedLocalSession({ id: 'session-ok' });
    mockFetchOnce({ ok: true, json: async () => ({ success: true, status: 'valid', workout: { id: 'w2' } }) });

    await activityService.endSession();

    expect(nativeBackgroundLocationService.start).not.toHaveBeenCalled();
  });

  test('confirmação de presença é intermediária: preserva a sessão e retoma o GPS drenado', async () => {
    const session = seedLocalSession({ id: 'session-presence-open' });
    mockFetchOnce({
      ok: true,
      json: async () => ({ presenceCheckRequired: true, presenceCheckId: 'presence-1', livenessPrompt: 'pisque' }),
    });

    const result = await activityService.endSession();

    expect(result.presenceCheckRequired).toBe(true);
    expect(nativeBackgroundLocationService.start).toHaveBeenCalledTimes(1);
    const persisted = JSON.parse(localStorage.getItem(SESSION_KEY) || '{}');
    expect(persisted.id).toBe(session.id);
    expect(persisted.status).toBe('active');
    expect(persisted.checkpoints).toHaveLength(2);
  });
});

describe('barreira central de início: ausência só é aceita após resposta confiável', () => {
  test('falha remota bloqueia startSession e não cria o registro ativo', async () => {
    (getDocs as jest.Mock).mockRejectedValue(new Error('offline'));
    const now = Date.now();
    const policy = {
      version: 'activity-competition-v2' as const,
      activityType: 'workout' as const,
      isIndoorCardio: false,
      resolvedAt: new Date(now).toISOString(),
      effectiveAt: new Date(now).toISOString(),
      contexts: [],
      requiresSecurityReview: false,
      requiresGymCheckIn: false,
      requiresContinuousGps: false,
      requiresMotionSensors: false,
      snapshotId: 'policy-1',
      sessionId: 'session-new',
      startBy: new Date(now + 60_000).toISOString(),
      expiresAt: new Date(now + 3_600_000).toISOString(),
    };

    await expect(activityService.startSession('workout', undefined, undefined, undefined, undefined, 'Peito', undefined, policy))
      .rejects.toThrow(/Não foi possível verificar sua atividade/);
    expect(setDoc).not.toHaveBeenCalled();
    expect(localStorage.getItem(SESSION_KEY)).toBeNull();
  });

  test('falha ao publicar o registro ativo desfaz o início local e permanece fail-closed', async () => {
    (getDocs as jest.Mock).mockResolvedValue({ docs: [] });
    (setDoc as jest.Mock).mockRejectedValue(new Error('write unavailable'));
    const now = Date.now();
    const policy = {
      version: 'activity-competition-v2' as const,
      activityType: 'workout' as const,
      isIndoorCardio: false,
      resolvedAt: new Date(now).toISOString(),
      effectiveAt: new Date(now).toISOString(),
      contexts: [],
      requiresSecurityReview: false,
      requiresGymCheckIn: false,
      requiresContinuousGps: false,
      requiresMotionSensors: false,
      snapshotId: 'policy-write-fail',
      sessionId: 'session-write-fail',
      startBy: new Date(now + 60_000).toISOString(),
      expiresAt: new Date(now + 3_600_000).toISOString(),
    };

    await expect(activityService.startSession('workout', undefined, undefined, undefined, undefined, 'Peito', undefined, policy))
      .rejects.toThrow(/registrar a atividade com segurança/);
    expect(setDoc).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(SESSION_KEY)).toBeNull();
  });

  test('sessão remota ativa é restaurada e bloqueia um segundo início', async () => {
    const remote = baseSession({ id: 'remote-active' });
    (getDocs as jest.Mock).mockResolvedValue({ docs: [{ ref: { id: remote.id }, data: () => remote }] });

    const restored = await activityService.verifyActiveSessionBeforeStart();

    expect(restored?.id).toBe(remote.id);
    expect(JSON.parse(localStorage.getItem(SESSION_KEY) || '{}').id).toBe(remote.id);
    expect(nativeBackgroundLocationService.start).toHaveBeenCalledTimes(1);
  });

  test('sessão local de outra conta bloqueia o início sem apagar seus dados', async () => {
    seedLocalSession({ id: 'other-user-session', userId: 'user-B' });

    await expect(activityService.verifyActiveSessionBeforeStart()).rejects.toThrow(/outra conta/);
    expect(JSON.parse(localStorage.getItem(SESSION_KEY) || '{}').id).toBe('other-user-session');
    expect(getDocs).not.toHaveBeenCalled();
  });
});
