// SEC-02: vínculo de academia nunca pode confiar em nome/coordenadas enviados
// pelo cliente. Academias já conhecidas usam o documento canônico; placeIds
// ainda não persistidos são resolvidos novamente pelo Google Places no servidor.
import { createHash } from 'node:crypto';
import handler from '../_handlers/gyms_join';
import { db, verifyAuth } from '../_lib/common';
import { getGooglePlacesApiKey } from '../_lib/google-places-config';

jest.mock('../_lib/common', () => ({
  db: { collection: jest.fn(), batch: jest.fn(), runTransaction: jest.fn() },
  cors: () => false,
  verifyAuth: jest.fn(),
  serverTimestamp: () => 'SERVER_TIMESTAMP'
}));

jest.mock('../_lib/google-places-config', () => ({
  getGooglePlacesApiKey: jest.fn(() => 'test-key')
}));

let gymsStore: Record<string, any>;
let usersStore: Record<string, any>;
let rateStore: Record<string, any>;
let batchOps: { type: 'set' | 'update' | 'create'; collection: string; id: string; data: any }[];

beforeEach(() => {
  jest.clearAllMocks();
  gymsStore = {};
  usersStore = { 'user-A': { displayName: 'Atleta A' }, 'user-B': { displayName: 'Atleta B' } };
  rateStore = {};
  batchOps = [];
  (verifyAuth as jest.Mock).mockResolvedValue({ uid: 'user-A' });
  (getGooglePlacesApiKey as jest.Mock).mockReturnValue('test-key');
  global.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      id: 'gym-nova',
      displayName: { text: 'Academia Canônica' },
      formattedAddress: 'Rua Oficial, 123',
      location: { latitude: -23.55, longitude: -46.63 },
      photos: [{ name: 'places/gym-nova/photos/photo-1' }]
    })
  })) as jest.Mock;

  (db.collection as jest.Mock).mockImplementation((name: string) => {
    const store = name === 'gyms' ? gymsStore : name === 'users' ? usersStore : name === 'api_rate_limits' ? rateStore : null;
    if (!store) throw new Error(`unexpected collection ${name}`);
    return {
      doc: (id: string) => ({
        __collection: name,
        __id: id,
        get: async () => ({ exists: Boolean(store[id]), data: () => store[id], id })
      })
    };
  });

  (db.runTransaction as jest.Mock).mockImplementation(async (callback: (transaction: any) => Promise<any>) => {
    const transaction = {
      get: async (ref: any) => {
        const store = ref.__collection === 'api_rate_limits' ? rateStore : null;
        if (!store) throw new Error(`unexpected transaction collection ${ref.__collection}`);
        return { exists: Boolean(store[ref.__id]), data: () => store[ref.__id], id: ref.__id };
      },
      set: (ref: any, data: any, options?: { merge?: boolean }) => {
        if (ref.__collection !== 'api_rate_limits') throw new Error(`unexpected transaction set ${ref.__collection}`);
        rateStore[ref.__id] = options?.merge
          ? { ...(rateStore[ref.__id] || {}), ...data }
          : data;
      }
    };
    return callback(transaction);
  });

  (db.batch as jest.Mock).mockImplementation(() => ({
    set: (ref: any, data: any, _opts?: any) => { batchOps.push({ type: 'set', collection: ref.__collection, id: ref.__id, data }); },
    create: (ref: any, data: any) => { batchOps.push({ type: 'create', collection: ref.__collection, id: ref.__id, data }); },
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
  const res: any = { status: jest.fn(), json: jest.fn(), setHeader: jest.fn() };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res;
}

function userRateId(userId: string) {
  return `gym_join_places_${createHash('sha256').update(userId).digest('hex')}`;
}

describe('SEC-02: entrar numa academia usa somente identidade/localização canônicas', () => {
  test('academia nova ignora nome/coordenadas declarados e resolve o placeId no Google', async () => {
    const res = response();
    await handler(request({ id: 'gym-nova', name: 'Nome Forjado', latitude: 0, longitude: 0, address: 'Endereço Forjado' }), res);

    expect(global.fetch).toHaveBeenCalledWith(
      'https://places.googleapis.com/v1/places/gym-nova',
      expect.objectContaining({ headers: expect.objectContaining({ 'X-Goog-Api-Key': 'test-key' }) })
    );
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, gymName: 'Academia Canônica' }));
    expect(gymsStore['gym-nova']).toMatchObject({
      name: 'Academia Canônica', latitude: -23.55, longitude: -46.63,
      address: 'Rua Oficial, 123', source: 'google_places'
    });
    expect(usersStore['user-A'].gymLocation).toEqual({ lat: -23.55, lng: -46.63 });

    const rateId = userRateId('user-A');
    expect(rateStore[rateId]).toMatchObject({ scope: 'gym_join_places', burstCount: 1, dailyCount: 1 });
    expect(rateStore[rateId]).not.toHaveProperty('userId');
    expect(rateStore[rateId]).not.toHaveProperty('uid');
    expect(rateStore[rateId]).not.toHaveProperty('subjectId');
    expect(rateId).not.toContain('user-A');
  });

  test('academia já existente: localização forjada pelo cliente é ignorada, canônica prevalece e não consome quota', async () => {
    gymsStore['gym-real'] = { id: 'gym-real', name: 'Academia Real', latitude: -23.5, longitude: -46.6 };

    const res = response();
    await handler(request({ id: 'gym-real', name: 'Academia Real (nome forjado)', latitude: -23.9, longitude: -46.9 }), res);

    expect(global.fetch).not.toHaveBeenCalled();
    expect(db.runTransaction).not.toHaveBeenCalled();
    expect(getGooglePlacesApiKey).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, gymName: 'Academia Real' }));
    expect(gymsStore['gym-real'].latitude).toBe(-23.5);
    expect(gymsStore['gym-real'].longitude).toBe(-46.6);
    expect(gymsStore['gym-real'].name).toBe('Academia Real');
    expect(usersStore['user-A'].gymName).toBe('Academia Real');
    expect(usersStore['user-A'].gymLocation).toEqual({ lat: -23.5, lng: -46.6 });
  });

  test('segundo usuário entrando na mesma academia não corrompe a geofence do primeiro', async () => {
    gymsStore['gym-real'] = { id: 'gym-real', name: 'Academia Real', latitude: -23.5, longitude: -46.6 };
    usersStore['user-A'] = { gymId: 'gym-real', gymName: 'Academia Real', gymLocation: { lat: -23.5, lng: -46.6 } };

    (verifyAuth as jest.Mock).mockResolvedValue({ uid: 'user-B' });
    const res = response();
    await handler(request({ id: 'gym-real', name: 'Qualquer Nome', latitude: 0, longitude: 0 }), res);

    expect(gymsStore['gym-real'].latitude).toBe(-23.5);
    expect(gymsStore['gym-real'].longitude).toBe(-46.6);
    expect(usersStore['user-A'].gymLocation).toEqual({ lat: -23.5, lng: -46.6 });
    expect(usersStore['user-B'].gymLocation).toEqual({ lat: -23.5, lng: -46.6 });
    expect(db.runTransaction).not.toHaveBeenCalled();
  });

  test('placeId novo que Google não confirma é rejeitado sem criar geofence', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: { status: 'NOT_FOUND' } })
    });
    const res = response();
    await handler(request({ id: 'gym-falsa', name: 'Academia', latitude: -23.5, longitude: -46.6 }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(gymsStore['gym-falsa']).toBeUndefined();
    expect(usersStore['user-A'].gymId).toBeUndefined();
  });

  test('sem chave do Google, academia nova falha fechada sem gastar quota nem confiar no cliente', async () => {
    (getGooglePlacesApiKey as jest.Mock).mockReturnValue('');
    const res = response();
    await handler(request({ id: 'gym-nova', name: 'Academia', latitude: -23.5, longitude: -46.6 }), res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(db.runTransaction).not.toHaveBeenCalled();
    expect(gymsStore['gym-nova']).toBeUndefined();
  });

  test('quota horária bloqueia antes do Google e retorna Retry-After', async () => {
    const now = Date.now();
    rateStore[userRateId('user-A')] = {
      scope: 'gym_join_places',
      burstStartedAt: now,
      burstCount: 12,
      dailyStartedAt: now,
      dailyCount: 12,
    };

    const res = response();
    await handler(request({ id: 'gym-nova', name: 'Academia' }), res);

    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', expect.any(String));
    expect(global.fetch).not.toHaveBeenCalled();
    expect(gymsStore['gym-nova']).toBeUndefined();
  });

  test('quota diária bloqueia antes do Google mesmo com janela horária renovada', async () => {
    const now = Date.now();
    rateStore[userRateId('user-A')] = {
      scope: 'gym_join_places',
      burstStartedAt: now - (2 * 60 * 60 * 1000),
      burstCount: 12,
      dailyStartedAt: now,
      dailyCount: 40,
    };

    const res = response();
    await handler(request({ id: 'gym-nova', name: 'Academia' }), res);

    expect(res.status).toHaveBeenCalledWith(429);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('falha do armazenamento de quota bloqueia chamada paga ao provedor', async () => {
    (db.runTransaction as jest.Mock).mockRejectedValueOnce(new Error('firestore unavailable'));

    const res = response();
    await handler(request({ id: 'gym-nova', name: 'Academia' }), res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(gymsStore['gym-nova']).toBeUndefined();
  });

  test('id de academia com caracteres inválidos é rejeitado', async () => {
    const res = response();
    await handler(request({ id: '../../etc/passwd', name: 'Academia', latitude: -23.5, longitude: -46.6 }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(db.runTransaction).not.toHaveBeenCalled();
  });
});
