import { createHash } from 'node:crypto';
import handler, { redactRouteEndpoints } from '../activity-map-guarded';
import activityMapHandler from '../activity-map';
import { db, verifyAuth } from '../_lib/common';

jest.mock('../activity-map', () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock('../_lib/common', () => ({
  db: { collection: jest.fn(), runTransaction: jest.fn() },
  cors: () => false,
  verifyAuth: jest.fn(),
}));

let rateStore: Record<string, any>;

function request(body: any, method = 'POST') {
  return { method, body, headers: {} } as any;
}

function response() {
  const res: any = { status: jest.fn(), json: jest.fn(), setHeader: jest.fn() };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res;
}

function rateId(userId: string) {
  return `activity_map_${createHash('sha256').update(userId).digest('hex')}`;
}

beforeEach(() => {
  jest.clearAllMocks();
  rateStore = {};
  (verifyAuth as jest.Mock).mockResolvedValue({ uid: 'user-map-A' });

  (db.collection as jest.Mock).mockImplementation((name: string) => {
    if (name !== 'api_rate_limits') throw new Error(`unexpected collection ${name}`);
    return {
      doc: (id: string) => ({ __collection: name, __id: id }),
    };
  });

  (db.runTransaction as jest.Mock).mockImplementation(async (callback: (transaction: any) => Promise<any>) => {
    const transaction = {
      get: async (ref: any) => ({
        exists: Boolean(rateStore[ref.__id]),
        data: () => rateStore[ref.__id],
      }),
      set: (ref: any, data: any, options?: { merge?: boolean }) => {
        rateStore[ref.__id] = options?.merge
          ? { ...(rateStore[ref.__id] || {}), ...data }
          : data;
      },
    };
    return callback(transaction);
  });

  (activityMapHandler as jest.Mock).mockImplementation(async (req: any, res: any) => {
    return res.json({ success: true, receivedTrajectory: req.body.trajectory });
  });
});

describe('activity-map guarded entrypoint', () => {
  test('redige as duas extremidades sem alterar a geometria intermediaria', () => {
    const points = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 0.0025 },
      { lat: 0, lng: 0.005 },
      { lat: 0, lng: 0.0075 },
      { lat: 0, lng: 0.01 },
    ];

    const redacted = redactRouteEndpoints(points);
    expect(redacted.length).toBeGreaterThanOrEqual(2);
    expect(redacted[0].lng).toBeGreaterThan(points[0].lng);
    expect(redacted[redacted.length - 1].lng).toBeLessThan(points[points.length - 1].lng);
    expect(points[0]).toEqual({ lat: 0, lng: 0 });
    expect(points[points.length - 1]).toEqual({ lat: 0, lng: 0.01 });
  });

  test('passa somente a rota redigida para o renderer e marca a resposta como privada', async () => {
    const req = request({
      trajectory: [
        { lat: -30, lng: -51 },
        { lat: -30, lng: -50.995 },
        { lat: -30, lng: -50.99 },
      ],
      width: 720,
      height: 1280,
    });
    const res = response();

    await handler(req, res);

    expect(activityMapHandler).toHaveBeenCalledTimes(1);
    const forwardedReq = (activityMapHandler as jest.Mock).mock.calls[0][0];
    expect(forwardedReq.body.trajectory[0]).not.toEqual({ lat: -30, lng: -51 });
    expect(forwardedReq.body.trajectory.at(-1)).not.toEqual({ lat: -30, lng: -50.99 });
    expect(res.setHeader).toHaveBeenCalledWith('X-Invictus-Route-Privacy', 'endpoints-redacted');
  });

  test('rejeita coordenada fora do planeta antes de quota e renderer', async () => {
    const res = response();
    await handler(request({ trajectory: [{ lat: 91, lng: 0 }, { lat: 0, lng: 0 }] }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(db.runTransaction).not.toHaveBeenCalled();
    expect(activityMapHandler).not.toHaveBeenCalled();
  });

  test('rejeita payload de rota exagerado antes de quota e renderer', async () => {
    const trajectory = Array.from({ length: 8001 }, (_, index) => ({ lat: -30, lng: -51 + index * 0.000001 }));
    const res = response();
    await handler(request({ trajectory }), res);

    expect(res.status).toHaveBeenCalledWith(413);
    expect(db.runTransaction).not.toHaveBeenCalled();
    expect(activityMapHandler).not.toHaveBeenCalled();
  });

  test('quota distribuida bloqueia antes do renderer e retorna Retry-After', async () => {
    const now = Date.now();
    rateStore[rateId('user-map-A')] = {
      scope: 'activity_map',
      burstStartedAt: now,
      burstCount: 30,
      dailyStartedAt: now,
      dailyCount: 30,
    };

    const res = response();
    await handler(request({ trajectory: [{ lat: -30, lng: -51 }, { lat: -30.01, lng: -51.01 }] }), res);

    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', expect.any(String));
    expect(activityMapHandler).not.toHaveBeenCalled();
  });

  test('limiter usa hash e nao persiste UID bruto', async () => {
    const res = response();
    await handler(request({ trajectory: [{ lat: -30, lng: -51 }, { lat: -30.01, lng: -51.01 }] }), res);

    const id = rateId('user-map-A');
    expect(rateStore[id]).toMatchObject({ scope: 'activity_map', burstCount: 1, dailyCount: 1 });
    expect(id).not.toContain('user-map-A');
    expect(rateStore[id]).not.toHaveProperty('uid');
    expect(rateStore[id]).not.toHaveProperty('userId');
    expect(rateStore[id]).not.toHaveProperty('subjectId');
  });

  test('falha do armazenamento de quota fecha antes do renderer', async () => {
    (db.runTransaction as jest.Mock).mockRejectedValueOnce(new Error('firestore unavailable'));
    const res = response();

    await handler(request({ trajectory: [{ lat: -30, lng: -51 }, { lat: -30.01, lng: -51.01 }] }), res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(activityMapHandler).not.toHaveBeenCalled();
  });

  test('exige POST e autenticacao', async () => {
    const getRes = response();
    await handler(request({}, 'GET'), getRes);
    expect(getRes.status).toHaveBeenCalledWith(405);

    (verifyAuth as jest.Mock).mockResolvedValueOnce(null);
    const unauthRes = response();
    await handler(request({ trajectory: [{ lat: -30, lng: -51 }, { lat: -30.01, lng: -51.01 }] }), unauthRes);
    expect(unauthRes.status).toHaveBeenCalledWith(401);
  });
});
