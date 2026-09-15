let mockDb: any;

jest.mock('../_lib/common', () => ({
  get db() { return mockDb; },
}));

import { getPaidChampionshipEditionGate } from '../_lib/paid-championship-edition';

function createDb() {
  const store = new Map<string, Record<string, any>>();
  const snapshot = (value: Record<string, any> | undefined) => ({
    exists: value !== undefined,
    data: () => value,
  });
  return {
    store,
    collection: (collection: string) => ({
      doc: (id: string) => ({
        key: `${collection}/${id}`,
        get: async () => snapshot(store.get(`${collection}/${id}`)),
      }),
    }),
  };
}

function championship(extra: Record<string, any> = {}) {
  return {
    id: 'invictus_cardio_v1',
    editionId: 'invictus_cardio_v1_ed_new',
    publishedConfigDigest: 'digest-new',
    regulationHash: 'rules-new',
    ...extra,
  } as any;
}

describe('paid championship edition preflight gate', () => {
  beforeEach(() => {
    mockDb = createDb();
  });

  test('sem lock anterior permite a primeira edição', async () => {
    await expect(getPaidChampionshipEditionGate(championship())).resolves.toMatchObject({ ok: true });
  });

  test('mesma edição e mesmo digest permanecem liberados', async () => {
    mockDb.store.set('championship_edition_locks/invictus_cardio_v1', {
      activeEditionId: 'invictus_cardio_v1_ed_new',
      configDigest: 'digest-new',
    });
    await expect(getPaidChampionshipEditionGate(championship())).resolves.toMatchObject({
      ok: true,
      activeEditionId: 'invictus_cardio_v1_ed_new',
    });
  });

  test('mesmo editionId com digest divergente falha fechado', async () => {
    mockDb.store.set('championship_edition_locks/invictus_cardio_v1', {
      activeEditionId: 'invictus_cardio_v1_ed_new',
      configDigest: 'digest-corrompido',
    });
    const result = await getPaidChampionshipEditionGate(championship());
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/divergiu do lock/i);
  });

  test('nova configuração é bloqueada enquanto a edição anterior não estiver FINALIZED', async () => {
    mockDb.store.set('championship_edition_locks/invictus_cardio_v1', {
      activeEditionId: 'invictus_cardio_v1_ed_old',
      configDigest: 'digest-old',
    });
    mockDb.store.set('championship_settlements/invictus_cardio_v1_ed_old', {
      editionId: 'invictus_cardio_v1_ed_old',
      status: 'LOCKED',
    });
    const result = await getPaidChampionshipEditionGate(championship());
    expect(result.ok).toBe(false);
    expect(result.activeEditionId).toBe('invictus_cardio_v1_ed_old');
    expect(result.reason).toMatch(/antes da homologação da edição anterior/i);
  });

  test('nova edição é permitida somente depois de a anterior estar FINALIZED', async () => {
    mockDb.store.set('championship_edition_locks/invictus_cardio_v1', {
      activeEditionId: 'invictus_cardio_v1_ed_old',
      configDigest: 'digest-old',
    });
    mockDb.store.set('championship_settlements/invictus_cardio_v1_ed_old', {
      editionId: 'invictus_cardio_v1_ed_old',
      status: 'FINALIZED',
    });
    await expect(getPaidChampionshipEditionGate(championship())).resolves.toMatchObject({
      ok: true,
      activeEditionId: 'invictus_cardio_v1_ed_old',
    });
  });
});
