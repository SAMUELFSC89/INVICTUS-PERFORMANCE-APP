let connection: Record<string, any>;

const ref = { key: 'strava_connections/user-a' };
const snapshot = () => ({ exists: true, data: () => connection });

jest.mock('../_lib/common', () => ({
  db: {
    collection: (name: string) => ({
      doc: (id: string) => ({ ...ref, key: `${name}/${id}` }),
    }),
    runTransaction: async (callback: (transaction: any) => Promise<any>) => callback({
      get: async () => snapshot(),
      update: (_target: any, patch: Record<string, any>) => {
        connection = { ...connection, ...patch };
      },
    }),
  },
  FieldValue: {
    serverTimestamp: () => 'server-timestamp',
    delete: () => 'delete-field',
  },
}));

import { StravaApi, resolveStravaActivitiesAfter } from '../_lib/strava-api';

describe('Strava sync provider guardrails', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-15T12:00:00.000Z'));
    connection = {
      userId: 'user-a',
      lastSyncAt: '2026-09-10T12:00:00.000Z',
    };
    jest.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
  });

  it('uses a 24h overlap after the last successful sync without crossing the requested floor', () => {
    const sixtyDayFloor = Date.parse('2026-07-17T12:00:00.000Z') / 1000;
    expect(resolveStravaActivitiesAfter(sixtyDayFloor, '2026-09-10T12:00:00.000Z'))
      .toBe(Date.parse('2026-09-09T12:00:00.000Z') / 1000);

    const recentFloor = Date.parse('2026-09-10T00:00:00.000Z') / 1000;
    expect(resolveStravaActivitiesAfter(recentFloor, '2026-09-10T12:00:00.000Z'))
      .toBe(recentFloor);
  });

  it('paginates provider results and blocks an immediate repeated fetch before another Strava request', async () => {
    const api = new StravaApi('user-a');
    jest.spyOn(api, 'getAccessToken').mockResolvedValue('token-a');

    const pageOne = Array.from({ length: 100 }, (_, index) => ({ id: index + 1 }));
    const pageTwo = [{ id: 101 }, { id: 102 }];
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => pageOne })
      .mockResolvedValueOnce({ ok: true, json: async () => pageTwo });
    global.fetch = fetchMock as any;

    const requestedFloor = Date.parse('2026-07-17T12:00:00.000Z') / 1000;
    const activities = await api.fetchActivities(requestedFloor);

    expect(activities).toHaveLength(102);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const firstUrl = new URL(fetchMock.mock.calls[0][0]);
    const secondUrl = new URL(fetchMock.mock.calls[1][0]);
    expect(firstUrl.searchParams.get('after')).toBe(String(Date.parse('2026-09-09T12:00:00.000Z') / 1000));
    expect(firstUrl.searchParams.get('before')).toBe(String(Date.parse('2026-09-15T12:00:00.000Z') / 1000 + 1));
    expect(firstUrl.searchParams.get('page')).toBe('1');
    expect(firstUrl.searchParams.get('per_page')).toBe('100');
    expect(secondUrl.searchParams.get('page')).toBe('2');
    expect(connection.activitiesFetchLeaseToken).toBeNull();
    expect(connection.activitiesFetchLeaseUntil).toBeNull();
    expect(connection.lastActivitiesFetchAt).toBe('2026-09-15T12:00:00.000Z');

    await expect(api.fetchActivities(requestedFloor)).rejects.toThrow('STRAVA_SYNC_COOLDOWN');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
