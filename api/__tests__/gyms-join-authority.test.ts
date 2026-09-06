// SEC-02 (auditoria 6167c8f): "entrar" numa academia gravava o objeto `gym`
// inteiro (nome, latitude, longitude) do corpo da requisição direto no
// documento COMPARTILHADO gyms/{gymId} via merge -- qualquer conta
// autenticada podia forjar a localização de uma academia real e corromper a
// geofence de check-in (gyms_checkin.ts) de todos os outros membros. Estes
// testes cobrem o comportamento ESPERADO: a localização/nome compartilhados
// só vêm do registro canônico já salvo quando a academia já existe; só o
// cadastro de uma academia NOVA usa os dados declarados por quem está
// entrando.
import handler from '../_handlers/gyms_join';
import { db, verifyAuth } from '../_lib/common';

jest.mock('../_lib/common', () => ({
  db: { collection: jest.fn(), batch: jest.fn() },
  cors: () => false,
  verifyAuth: jest.fn(),
  serverTimestamp: () => 'SERVER_TIMESTAMP'
}));

let gymsStore: Record<string, any>;
let usersStore: Record<string, any>;
let batchOps: { type: 'set' | 'update'; collection: string; id: string; data: any }[];

beforeEach(() => {
  jest.clearAllMocks();
  gymsStore = {};
  usersStore = {};
  batchOps = [];
  (verifyAuth as jest.Mock).mockResolvedValue({ uid: 'user-A' });

  (db.collection as jest.Mock).mockImplementation((name: string) => {
    const store = name === 'gyms' ? gymsStore : name === 'users' ? usersStore : null;
    if (!store) throw new Error(`unexpected collection ${name}`);
    return {
      doc: (id: string) => ({
        __collection: name,
        __id: id,
        get: async () => ({ exists: Boolean(store[id]), data: () => store[id], id })
      })
    };
  });

  (db.batch as jest.Mock).mockImplementation(() => ({
    set: (ref: any, data: any, _opts?: any) => { batchOps.push({ type: 'set', collection: ref.__collection, id: ref.__id, data }); },
    update: (ref: any, data: any) => { batchOps.push({ type: 'update', collection: ref.__collection, id: ref.__id, data }); },
    commit: async () => {
      for (const op of batchOps) {
        const store = op.collection === 'gyms' ? gymsStore : usersStore;
        store[op.id] = { ...(store[op.id] || {}), ...op.data };
      }
    }
  }));
});

function request(gym: any) {
  return { method: 'POST', body: { gym }, headers: {} } as any;
}

function response() {
  const res: any = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res;
}

describe('SEC-02: entrar numa academia não pode sobrescrever a localização compartilhada', () => {
  test('academia nova: dados declarados por quem entra viram o registro canônico inicial', async () => {
    const res = response();
    await handler(request({ id: 'gym-nova', name: 'Academia Nova', latitude: -23.55, longitude: -46.63 }), res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    expect(gymsStore['gym-nova'].latitude).toBe(-23.55);
    expect(gymsStore['gym-nova'].longitude).toBe(-46.63);
    expect(usersStore['user-A'].gymLocation).toEqual({ lat: -23.55, lng: -46.63 });
  });

  test('academia já existente: localização forjada pelo cliente é ignorada, canônica prevalece', async () => {
    gymsStore['gym-real'] = { id: 'gym-real', name: 'Academia Real', latitude: -23.5, longitude: -46.6 };

    const res = response();
    // Um atacante autenticado tenta "entrar" na academia real declarando uma
    // localização completamente diferente (do outro lado da cidade).
    await handler(request({ id: 'gym-real', name: 'Academia Real (nome forjado)', latitude: -23.9, longitude: -46.9 }), res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, gymName: 'Academia Real' }));
    // O documento compartilhado da academia mantém a localização/nome
    // originais -- nada do corpo da requisição foi aplicado a ele.
    expect(gymsStore['gym-real'].latitude).toBe(-23.5);
    expect(gymsStore['gym-real'].longitude).toBe(-46.6);
    expect(gymsStore['gym-real'].name).toBe('Academia Real');
    // O próprio usuário que entrou reflete a localização CANÔNICA, não a que
    // ele declarou.
    expect(usersStore['user-A'].gymName).toBe('Academia Real');
    expect(usersStore['user-A'].gymLocation).toEqual({ lat: -23.5, lng: -46.6 });
  });

  test('segundo usuário "entrando" na mesma academia não corrompe a geofence do primeiro', async () => {
    gymsStore['gym-real'] = { id: 'gym-real', name: 'Academia Real', latitude: -23.5, longitude: -46.6 };
    usersStore['user-A'] = { gymId: 'gym-real', gymName: 'Academia Real', gymLocation: { lat: -23.5, lng: -46.6 } };

    (verifyAuth as jest.Mock).mockResolvedValue({ uid: 'user-B' });
    const res = response();
    await handler(request({ id: 'gym-real', name: 'Qualquer Nome', latitude: 0, longitude: 0 }), res);

    // A localização da academia (que o check-in de user-A depende) continua
    // intacta depois que user-B "entrou" declarando 0,0.
    expect(gymsStore['gym-real'].latitude).toBe(-23.5);
    expect(gymsStore['gym-real'].longitude).toBe(-46.6);
    expect(usersStore['user-A'].gymLocation).toEqual({ lat: -23.5, lng: -46.6 });
  });

  test('cadastro de academia nova com coordenadas inválidas é rejeitado', async () => {
    const res = response();
    await handler(request({ id: 'gym-invalida', name: 'Academia', latitude: 999, longitude: -46.6 }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(gymsStore['gym-invalida']).toBeUndefined();
  });

  test('id de academia com caracteres inválidos é rejeitado', async () => {
    const res = response();
    await handler(request({ id: '../../etc/passwd', name: 'Academia', latitude: -23.5, longitude: -46.6 }), res);

    expect(res.status).toHaveBeenCalledWith(400);
  });
});
