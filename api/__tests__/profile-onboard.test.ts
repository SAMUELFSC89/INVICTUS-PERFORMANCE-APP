// SEC-01 / AP-01 (auditoria 6167c8f): antes, o cliente criava/atualizava
// users/{uid} direto pelo SDK (setDoc/updateDoc em AuthGuard.tsx), incluindo
// score, xp, nível, plano e bloqueio -- um cliente malicioso podia enviar
// qualquer valor, e apagar+recriar o próprio perfil ignorava até a lista de
// campos protegidos do update() das Firestore Rules. Estes testes cobrem o
// comportamento ESPERADO da nova ação action=onboard: o servidor decide todos
// os campos privilegiados, ignora o que o cliente declarar para eles, e a
// chamada é idempotente (nunca reseta o que já foi concedido).
import handler from '../_handlers/profile';
import { db, verifyAuth } from '../_lib/common';

jest.mock('../_lib/common', () => ({
  db: { collection: jest.fn(), runTransaction: jest.fn() },
  cors: () => false,
  verifyAuth: jest.fn()
}));

let usersStore: Record<string, any>;
let deletedUsersStore: Record<string, any>;

beforeEach(() => {
  jest.clearAllMocks();
  usersStore = {};
  deletedUsersStore = {};
  (verifyAuth as jest.Mock).mockResolvedValue({ uid: 'user-A', email: 'atleta@example.com' });

  (db.collection as jest.Mock).mockImplementation((name: string) => {
    if (name === 'deleted_users') {
      return {
        doc: (uid: string) => ({
          get: async () => ({
            exists: Boolean(deletedUsersStore[uid]),
            data: () => deletedUsersStore[uid],
          }),
        }),
      };
    }
    if (name !== 'users') throw new Error(`unexpected collection ${name}`);
    return {
      doc: (uid: string) => ({ __uid: uid }),
      where: (field: string, _op: string, value: unknown) => ({
        limit: () => ({
          get: async () => {
            const docs = Object.entries(usersStore)
              .filter(([, data]: [string, any]) => data[field] === value)
              .map(([id, data]) => ({ id, data: () => data }));
            return { docs, empty: docs.length === 0 };
          }
        })
      })
    };
  });

  (db.runTransaction as jest.Mock).mockImplementation(async (callback: any) => {
    return callback({
      get: async (ref: any) => ({
        exists: Boolean(usersStore[ref.__uid]),
        data: () => usersStore[ref.__uid],
        id: ref.__uid
      }),
      set: (ref: any, data: any) => { usersStore[ref.__uid] = { ...data }; },
      update: (ref: any, data: any) => { usersStore[ref.__uid] = { ...(usersStore[ref.__uid] || {}), ...data }; }
    });
  });
});

function request(body: any) {
  return {
    method: 'POST',
    query: { action: 'onboard' },
    body,
    headers: { authorization: 'Bearer faketoken' }
  } as any;
}

function response() {
  const res: any = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res;
}

const validBody = {
  displayName: 'Atleta Teste',
  cpf: '11144477735',
  birthDate: '1995-05-20',
  height: 175,
  weight: 75,
  sex: 'male',
  weeklyFrequency: '3-4',
  bodySelfAssessment: 'normal',
  objective: 'emagrecer',
  preferredPlan: 'open',
  city: 'São Paulo',
  state: 'sp',
  whatsappEnabled: true,
  phoneNumber: '11999999999',
  termsAccepted: true,
  termsVersionAccepted: 'v3'
};

describe('AP-01 / SEC-01: action=onboard cria/concluí o perfil com autoridade do servidor', () => {
  test('onboarding legítimo grava os defaults do servidor (score, xp, nível, plano)', async () => {
    const res = response();
    await handler(request(validBody), res);

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload).toMatchObject({ success: true, alreadyOnboarded: false, onboardingComplete: true });

    const stored = usersStore['user-A'];
    expect(stored.uid).toBe('user-A');
    expect(stored.email).toBe('atleta@example.com');
    expect(stored.role).toBe('user');
    expect(stored.isAdmin).toBe(false);
    expect(stored.termsAccepted).toBe(true);
    expect(stored.score).toBe(10);
    expect(stored.xp).toBe(10);
    expect(stored.level).toBe(1);
    expect(stored.isBlocked).toBe(false);
    expect(stored.isBanned).toBe(false);
    expect(stored.isSubscribed).toBe(false);
    expect(stored.subscriptionTier).toBe('open');
    expect(stored.displayName).toBe('Atleta Teste');
    expect(stored.state).toBe('SP');
  });

  test('campos privilegiados enviados pelo cliente são ignorados -- o servidor decide os valores', async () => {
    const res = response();
    const forgedBody = {
      ...validBody,
      score: 999999,
      xp: 999999,
      level: 99,
      role: 'admin',
      isAdmin: true,
      isBlocked: false,
      isBanned: false,
      subscriptionTier: 'performance',
      isSubscribed: true,
      walletBalance: 1000000,
      uid: 'outro-uid-forjado',
      email: 'atacante@evil.com'
    };

    await handler(request(forgedBody), res);

    const stored = usersStore['user-A'];
    // O uid/email vêm do token verificado (verifyAuth), nunca do corpo.
    expect(stored.uid).toBe('user-A');
    expect(stored.email).toBe('atleta@example.com');
    expect(stored.role).toBe('user');
    expect(stored.isAdmin).toBe(false);
    // preferredPlan:'open' é um plano gratuito legítimo -- mas o valor
    // 'performance' forjado pelo cliente é ignorado; só a derivação
    // determinística a partir de preferredPlan é aceita.
    expect(stored.subscriptionTier).toBe('open');
    expect(stored.score).toBe(10);
    expect(stored.xp).toBe(10);
    expect(stored.level).toBe(1);
    expect(stored.walletBalance).toBe(0);
  });

  test('termsAccepted:true sem CPF/data de nascimento reais não conclui o onboarding', async () => {
    const res = response();
    await handler(request({ ...validBody, cpf: '', birthDate: '' }), res);

    const payload = res.json.mock.calls[0][0];
    expect(payload.onboardingComplete).toBe(false);

    const stored = usersStore['user-A'];
    expect(stored.termsAccepted).toBe(false);
    // Nenhum dos campos de concessão inicial deve existir ainda.
    expect(stored.score).toBeUndefined();
    expect(stored.subscriptionTier).toBeUndefined();
  });

  test('chamada repetida é idempotente: não repete a concessão nem reseta campos já alterados pelo jogo', async () => {
    const res1 = response();
    await handler(request(validBody), res1);

    // Simula o motor de pontuação alterando o score legitimamente depois.
    usersStore['user-A'].score = 500;
    usersStore['user-A'].level = 4;

    const res2 = response();
    await handler(request({ ...validBody, termsAccepted: true }), res2);

    const payload2 = res2.json.mock.calls[0][0];
    expect(payload2.alreadyOnboarded).toBe(true);

    const stored = usersStore['user-A'];
    expect(stored.score).toBe(500);
    expect(stored.level).toBe(4);
  });

  test('CPF já usado por outra conta é rejeitado com 409 e nada é gravado', async () => {
    usersStore['outro-uid'] = { cpf: validBody.cpf, uid: 'outro-uid' };

    const res = response();
    await handler(request(validBody), res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(usersStore['user-A']).toBeUndefined();
  });

  test('sem autenticação retorna 401 e nunca chama o banco', async () => {
    (verifyAuth as jest.Mock).mockResolvedValue(null);
    const res = response();
    await handler(request(validBody), res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(db.runTransaction).not.toHaveBeenCalled();
  });

  test('tombstone de exclusão impede recriar o perfil', async () => {
    deletedUsersStore['user-A'] = { deletedAt: '2026-09-06T12:00:00.000Z' };
    const res = response();

    await handler(request(validBody), res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'ACCOUNT_DELETED' }));
    expect(usersStore['user-A']).toBeUndefined();
    expect(db.runTransaction).not.toHaveBeenCalled();
  });
});
