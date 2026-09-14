import rankingHandler from '../_handlers/ranking';
import { db, verifyAuth } from '../_lib/common';

jest.mock('../_lib/common', () => ({
  db: { collection: jest.fn(), getAll: jest.fn() },
  cors: jest.fn(() => false),
  verifyAuth: jest.fn(),
}));

jest.mock('../_lib/entitlement', () => ({
  isProUser: jest.fn(() => false),
}));

function response() {
  const res: any = {
    statusCode: 0,
    body: undefined,
    status: jest.fn((code: number) => { res.statusCode = code; return res; }),
    json: jest.fn((body: any) => { res.body = body; return res; }),
  };
  return res;
}

function documentSnapshot(id: string, data: Record<string, unknown>, exists = true) {
  return { id, exists, data: () => data };
}

function configureDatabase({ gymId, enrollmentGymId = gymId }: { gymId: string; enrollmentGymId?: string }) {
  const profiles: Record<string, Record<string, unknown>> = {
    'user-b': { displayName: 'Mesmo Nome', gymId, gymName: 'Academia Segura', weeklyScore: 100 },
    'user-a': { displayName: 'Mesmo Nome', gymId, gymName: 'Academia Segura', weeklyScore: 100 },
    'cross-gym': { displayName: 'Intruso', gymId: 'outra-academia', weeklyScore: 999 },
    'blocked-user': { displayName: 'Bloqueado', gymId, weeklyScore: 500, isBlocked: true },
    'disabled-user': { displayName: 'Desabilitado', gymId, weeklyScore: 600, disabled: true },
    'deleted-status-user': { displayName: 'Excluído', gymId, weeklyScore: 700, deletionStatus: 'deletion_completed' },
    'lifecycle-user': { displayName: 'Suspenso', gymId, weeklyScore: 800, lifecycleStatus: 'suspended' },
  };
  const enrollmentDocs = Object.keys(profiles).map((id) => documentSnapshot(id, { enrolled: true, gymId, accepted: true, consentType: 'competitive_hr_measurement_acknowledgement', competitionId: 'gym_ranking', competitionRulesVersion: 'gym-ranking-v2-hr', hrAcknowledgementVersion: 'competitive-hr-v1' }));

  (db.collection as jest.Mock).mockImplementation((collection: string) => ({
    doc: (id: string) => ({
      get: async () => collection === 'gym_ranking_enrollments'
        ? documentSnapshot(id, { enrolled: true, gymId: enrollmentGymId, accepted: true, consentType: 'competitive_hr_measurement_acknowledgement', competitionId: 'gym_ranking', competitionRulesVersion: 'gym-ranking-v2-hr', hrAcknowledgementVersion: 'competitive-hr-v1' })
        : documentSnapshot(id, profiles[id], Boolean(profiles[id])),
    }),
    where: () => ({ limit: () => ({ get: async () => ({ docs: enrollmentDocs }) }) }),
  }));
  (db.getAll as jest.Mock).mockImplementation(async (...refs: Array<{ get: () => Promise<unknown> }>) => Promise.all(refs.map((ref) => ref.get())));

  return { profiles };
}

beforeEach(() => {
  jest.clearAllMocks();
  (verifyAuth as jest.Mock).mockResolvedValue({ uid: 'user-b' });
});

test('deriva a academia do perfil autenticado, exclui perfis externos/inativos e desempata de modo estável', async () => {
  configureDatabase({ gymId: 'gym-secure-1' });
  const res = response();

  await rankingHandler({ method: 'GET', query: { period: 'weekly', level: 'global', levelId: 'outra-academia' } } as any, res);

  expect(res.statusCode).toBe(200);
  expect(res.body.gymId).toBe('gym-secure-1');
  expect(res.body.gymName).toBe('Academia Segura');
  expect(res.body.topUsers.map((entry: any) => entry.uid)).toEqual(['user-a', 'user-b']);
  expect(res.body.currentUser).toMatchObject({ uid: 'user-b', rank: 2 });
  expect(res.body.participantCount).toBe(2);
});

test('não serve participante suspenso de uma leitura anterior', async () => {
  const state = configureDatabase({ gymId: 'gym-fresh-1' });
  const first = response();
  await rankingHandler({ method: 'GET', query: { period: 'weekly' } } as any, first);
  expect(first.statusCode).toBe(200);
  expect(first.body.topUsers.map((entry: any) => entry.uid)).toEqual(['user-a', 'user-b']);

  state.profiles['user-a'].disabled = true;
  const second = response();
  await rankingHandler({ method: 'GET', query: { period: 'weekly' } } as any, second);

  expect(second.statusCode).toBe(200);
  expect(second.body.topUsers.map((entry: any) => entry.uid)).toEqual(['user-b']);
  expect(second.body.participantCount).toBe(1);
});

test('recusa adesão antiga que não corresponde mais à academia do perfil', async () => {
  configureDatabase({ gymId: 'gym-current-2', enrollmentGymId: 'gym-old-2' });
  const res = response();

  await rankingHandler({ method: 'GET', query: { period: 'weekly' } } as any, res);

  expect(res.statusCode).toBe(409);
  expect(res.body.enrolled).toBe(false);
  expect(db.getAll).not.toHaveBeenCalled();
});

test('exige autenticação antes de revelar qualquer classificação', async () => {
  (verifyAuth as jest.Mock).mockResolvedValue(null);
  const res = response();

  await rankingHandler({ method: 'GET', query: {} } as any, res);

  expect(res.statusCode).toBe(401);
  expect(db.collection).not.toHaveBeenCalled();
});
