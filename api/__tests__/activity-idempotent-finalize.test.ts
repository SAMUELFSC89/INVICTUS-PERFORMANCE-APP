// ACT-01 / ACT-02 / ACT-08 (auditoria 6167c8f): a finalizacao de uma
// atividade nao tinha uma chave de idempotencia durável -- um retry (rede
// caiu, resposta se perdeu) recalculava duracao/hora de fim do zero e so era
// deduplicado por um heuristico fragil (mesmo tipo + mesma duracao em 10s),
// furavel por qualquer retry com duracao levemente diferente; cada furo virava
// um SEGUNDO documento com ID novo (ActivityRepository.create() sem customId
// sempre usa .add()). Alem disso, falha ao persistir uma atividade
// pendente-de-revisao era absorvida e o cliente recebia 200/pending sem ID
// (achava que a atividade estava na fila quando nada foi gravado). E o TTL de
// 15 minutos do check-in de academia era comparado contra Date.now() no FIM
// do treino, expirando check-ins legítimos de sessões de duração normal.
// Estes testes cobrem o comportamento ESPERADO das correções, não os probes
// de defeito da auditoria.
import { ValidateActivityService } from '../_services/activities/validate-activity-service';
import { ActivityRepository } from '../_repositories/activity-repository';
import { UserRepository } from '../_repositories/user-repository';
import { SecurityPipeline } from '../_lib/security-pipeline';
import { recalculateAllUserScores } from '../_lib/igaService';
import { registrarAmostrasDeAtividade } from '../_lib/health-data-layer';
import { submitActivityToActiveChampionships } from '../_lib/championship-scoring-service';
import { db } from '../_lib/common';

jest.mock('../_lib/common', () => ({ db: { collection: jest.fn() } }));
jest.mock('../_repositories/activity-repository', () => ({ ActivityRepository: jest.fn() }));
jest.mock('../_repositories/user-repository', () => ({ UserRepository: jest.fn() }));
jest.mock('../_lib/security-pipeline', () => ({ SecurityPipeline: { runPipeline: jest.fn() } }));
jest.mock('../_lib/igaService', () => ({ recalculateAllUserScores: jest.fn() }));
jest.mock('../_lib/health-data-layer', () => ({ registrarAmostrasDeAtividade: jest.fn() }));
jest.mock('../_lib/user-activity-history', () => ({ buscarHistoricoRecente: async () => [] }));
jest.mock('../_lib/championship-scoring-service', () => ({ submitActivityToActiveChampionships: jest.fn() }));
jest.mock('../_lib/geofence-engine', () => ({
  MAX_GEOFENCE_RADIUS_METERS: 80,
  MAX_GPS_ACCURACY_METERS: 30,
  validateGeofenceCheckin: () => ({ approved: true })
}));

const startedAt = '2026-09-05T10:00:00.000Z';
const endedAt = '2026-09-05T11:00:00.000Z';

let workoutStore: Record<string, any>;
let checkinStore: Record<string, any>;
let championshipActive: boolean;
let activities: any;
let users: any;
let audit: any;
let notification: any;
let service: ValidateActivityService;

function request(overrides: Partial<any> = {}) {
  return {
    userId: 'user-A',
    activityData: {
      type: 'workout',
      muscleGroup: 'legs',
      duration: 60,
      intensity: 'moderate' as const,
      startTime: startedAt,
      endTime: endedAt,
      sessionId: 'session-1',
      ...overrides
    }
  };
}

function security(shouldScore = true, eligible = true) {
  (SecurityPipeline.runPipeline as jest.Mock).mockResolvedValue({
    shouldScore,
    decision: shouldScore ? 'APPROVED' : 'UNDER_REVIEW',
    report: { validation: { competitivelyEligible: eligible, ineligibleReason: eligible ? undefined : 'Tempo mínimo não atingido.' }, explanation: {} }
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  workoutStore = {};
  checkinStore = {};
  championshipActive = false;
  for (const name of ['log', 'warn', 'error'] as const) jest.spyOn(console, name).mockImplementation(() => {});

  activities = {
    findById: jest.fn(async (id: string) => (workoutStore[id] ? { ...workoutStore[id] } : null)),
    create: jest.fn(async (value: any, customId?: string) => {
      const id = customId || `auto_${Object.keys(workoutStore).length}`;
      const doc = { ...value, id, createdAt: endedAt };
      workoutStore[id] = doc;
      return doc;
    }),
    findRecentByUser: jest.fn(async () => [])
  };
  users = {
    findById: jest.fn(async () => ({ id: 'user-A', weightKg: 70 })),
    addXP: jest.fn(async () => ({ newXP: 500, newLevel: 2 }))
  };
  audit = { log: jest.fn(async () => undefined) };
  notification = { send: jest.fn(async () => undefined) };

  (ActivityRepository as unknown as jest.Mock).mockImplementation(() => activities);
  (UserRepository as unknown as jest.Mock).mockImplementation(() => users);

  (db.collection as jest.Mock).mockImplementation((name: string) => {
    if (name === 'community_championship_enrollments') {
      return { doc: () => ({ get: async () => ({ data: () => ({ status: championshipActive ? 'active' : 'inactive' }) }) }) };
    }
    if (name === 'championship_registrations') {
      return { where: () => ({ get: async () => ({ docs: [] }) }) };
    }
    if (name === 'gym_checkins') {
      return {
        doc: (id: string) => ({
          get: async () => ({ exists: Boolean(checkinStore[id]), data: () => checkinStore[id] }),
          set: async (data: any) => { checkinStore[id] = { ...(checkinStore[id] || {}), ...data }; }
        })
      };
    }
    return { doc: () => ({ get: async () => ({ exists: false, data: () => undefined }) }), where: () => ({ get: async () => ({ docs: [] }) }) };
  });

  (recalculateAllUserScores as jest.Mock).mockResolvedValue({ weekly: { igaRanking: 73 }, monthly: { average: 65 }, season: { average: 60 } });
  (registrarAmostrasDeAtividade as jest.Mock).mockResolvedValue(undefined);
  (submitActivityToActiveChampionships as jest.Mock).mockResolvedValue(undefined);
  security();
  service = new ValidateActivityService(activities as any, users as any, audit as any, notification as any);
});

describe('ACT-02: retry com o mesmo sessionId nunca duplica nem concede XP duas vezes', () => {
  test('segunda chamada com o mesmo sessionId (mesmo com duração recalculada) devolve o mesmo activityId sem criar novo documento', async () => {
    championshipActive = true;
    const first = await service.execute(request()) as any;
    const retry = await service.execute(request({ duration: 65, endTime: '2026-09-05T11:05:00.000Z' })) as any;

    expect(activities.create).toHaveBeenCalledTimes(1);
    expect(Object.keys(workoutStore)).toHaveLength(1);
    expect(retry.activityId).toBe(first.activityId);
    expect(retry.scoreAwarded).toBe(first.scoreAwarded);
    expect(users.addXP).toHaveBeenCalledTimes(1);
    expect(recalculateAllUserScores).toHaveBeenCalledTimes(1);
  });

  test('sessionId diferente sempre gera atividades distintas', async () => {
    championshipActive = true;
    await service.execute(request({ sessionId: 'session-1' }));
    await service.execute(request({ sessionId: 'session-2' }));

    expect(activities.create).toHaveBeenCalledTimes(2);
    expect(Object.keys(workoutStore)).toHaveLength(2);
    expect(users.addXP).toHaveBeenCalledTimes(2);
  });

  test('retry de uma atividade not_eligible devolve o mesmo status sem rodar SecurityPipeline de novo', async () => {
    security(true, false);
    const first = await service.execute(request()) as any;
    expect(first.workout.status).toBe('not_eligible');

    const retry = await service.execute(request({ duration: 61 })) as any;
    expect(retry.activityId).toBe(first.activityId);
    expect(retry.workout.status).toBe('not_eligible');
    expect(SecurityPipeline.runPipeline).toHaveBeenCalledTimes(1);
  });

  test('retry de uma atividade pending_review (SecurityPipeline UNDER_REVIEW com stakes ativos) devolve o mesmo resultado sem reprocessar', async () => {
    championshipActive = true;
    security(false);
    const first = await service.execute(request()) as any;
    expect(first.status).toBe('pending_review');

    const retry = await service.execute(request({ duration: 70 })) as any;
    expect(retry.activityId).toBe(first.activityId);
    expect(retry.status).toBe('pending_review');
    expect(SecurityPipeline.runPipeline).toHaveBeenCalledTimes(1);
    expect(activities.create).toHaveBeenCalledTimes(1);
  });
});

describe('ACT-01: falha ao persistir uma atividade pendente de revisão nunca vira um 200/pending falso', () => {
  test('falha no create() do caminho SecurityPipeline propaga erro 503 em vez de sucesso sem ID', async () => {
    championshipActive = true;
    security(false);
    activities.create.mockRejectedValueOnce(new Error('Firestore indisponível'));

    await expect(service.execute(request())).rejects.toMatchObject({ statusCode: 503 });
    expect(Object.keys(workoutStore)).toHaveLength(0);
  });
});

describe('ACT-08: TTL do check-in é validado contra o início da sessão, não contra o fim', () => {
  test('check-in confirmado pouco antes do início de um treino de 60min continua válido no encerramento', async () => {
    // Sessão começou há 60 minutos (duração normal de treino); check-in foi
    // confirmado no mesmo instante em que a sessão começou -- portanto ainda
    // dentro do TTL de 15min NAQUELE momento, mesmo que Date.now() (agora, no
    // fim do treino) já esteja bem além dos 15 minutos do check-in.
    const sessionStart = new Date(Date.now() - 60 * 60000).toISOString();
    checkinStore['checkin-1'] = {
      userId: 'user-A',
      status: 'confirmed',
      expiresAt: new Date(new Date(sessionStart).getTime() + 15 * 60000).toISOString()
    };

    const result = await service.execute(request({ checkInId: 'checkin-1', startTime: sessionStart, duration: 60 })) as any;
    expect(result.success).toBe(true);
  });

  test('check-in já expirado ANTES do início da sessão continua sendo rejeitado', async () => {
    const sessionStart = new Date(Date.now() - 60 * 60000).toISOString();
    // expirou 5 minutos antes da sessão começar
    checkinStore['checkin-1'] = {
      userId: 'user-A',
      status: 'confirmed',
      expiresAt: new Date(new Date(sessionStart).getTime() - 5 * 60000).toISOString()
    };

    await expect(service.execute(request({ checkInId: 'checkin-1', startTime: sessionStart }))).rejects.toMatchObject({ statusCode: 400 });
  });

  test('mesmo checkInId não pode ser reaproveitado para uma sessão com início muito diferente', async () => {
    const firstStart = new Date(Date.now() - 120 * 60000).toISOString();
    checkinStore['checkin-1'] = {
      userId: 'user-A',
      status: 'confirmed',
      expiresAt: new Date(new Date(firstStart).getTime() + 15 * 60000).toISOString()
    };
    await service.execute(request({ checkInId: 'checkin-1', startTime: firstStart, sessionId: 'session-a' }));

    // Uma segunda sessão, começada muito depois, tenta reaproveitar o MESMO
    // checkInId (já vinculado à primeira sessão).
    const secondStart = new Date(Date.now() - 30 * 60000).toISOString();
    await expect(service.execute(request({ checkInId: 'checkin-1', startTime: secondStart, sessionId: 'session-b' })))
      .rejects.toMatchObject({ statusCode: 400 });
  });
});
