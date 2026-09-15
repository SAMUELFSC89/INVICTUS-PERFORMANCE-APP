let mockDb: any;

jest.mock('../_lib/common', () => ({
  get db() { return mockDb; },
}));

import {
  championshipPrizeAwardId,
  championshipPrizeSettlementId,
  championshipPrizeTransactionId,
  creditChampionshipPrize,
  type ChampionshipPrizeCreditInput,
} from '../_lib/championship-prize-credit';

type Stored = Record<string, any>;

function createDb() {
  const store = new Map<string, Stored>();
  const snapshot = (value: Stored | undefined) => ({
    exists: value !== undefined,
    data: () => value,
  });
  const ref = (collection: string, id: string) => ({ collection, id, key: `${collection}/${id}` });

  return {
    store,
    collection: (collection: string) => ({ doc: (id: string) => ref(collection, id) }),
    runTransaction: async (callback: (transaction: any) => Promise<any>) => {
      const writes: Array<{ target: any; value: Stored; merge: boolean; create: boolean }> = [];
      const transaction = {
        get: async (target: any) => snapshot(store.get(target.key)),
        set: (target: any, value: Stored, options?: { merge?: boolean }) => {
          writes.push({ target, value, merge: options?.merge === true, create: false });
        },
        create: (target: any, value: Stored) => {
          if (store.has(target.key) || writes.some((write) => write.target.key === target.key)) {
            throw new Error(`already exists: ${target.key}`);
          }
          writes.push({ target, value, merge: false, create: true });
        },
      };
      const result = await callback(transaction);
      writes.forEach(({ target, value, merge }) => {
        store.set(target.key, merge ? { ...(store.get(target.key) || {}), ...value } : { ...value });
      });
      return result;
    },
  };
}

const input = (extra: Partial<ChampionshipPrizeCreditInput> = {}): ChampionshipPrizeCreditInput => ({
  championshipId: 'invictus_cardio_v1',
  championshipTitle: 'Campeonato Invictus de Cardio',
  regulationVersion: 'invictus-cardio-v1',
  regulationHash: 'rules-digest-123',
  userId: 'user-a',
  rank: 1,
  amount: 500,
  ...extra,
});

describe('paid championship cash prize settlement', () => {
  beforeEach(() => {
    mockDb = createDb();
    mockDb.store.set('users/user-a', { status: 'active', walletBalance: 25 });
    mockDb.store.set('championship_registrations/user-a_invictus_cardio_v1', {
      userId: 'user-a',
      championshipId: 'invictus_cardio_v1',
      status: 'paga',
      paymentStatus: 'PAID',
      regulationVersion: 'invictus-cardio-v1',
      regulationHash: 'rules-digest-123',
    });
  });

  test('credita reais sacáveis uma única vez e preserva saldo legado ao criar a wallet', async () => {
    const request = input();
    const first = await creditChampionshipPrize(request);
    const retry = await creditChampionshipPrize(request);

    expect(first).toMatchObject({ credited: true, alreadyCredited: false, ineligible: false });
    expect(retry).toMatchObject({ credited: false, alreadyCredited: true, ineligible: false });
    expect(first.transactionId).toBe(championshipPrizeTransactionId(request));
    expect(mockDb.store.get('wallets/user-a')).toMatchObject({
      redeemableBalance: 525,
      totalBalance: 525,
    });
    expect(mockDb.store.get(`iv_transactions/${championshipPrizeTransactionId(request)}`)).toMatchObject({
      userId: 'user-a',
      amount: 500,
      category: 'redeemable',
      origin: 'championship',
      type: 'credit',
    });
    expect(mockDb.store.get(`championship_prize_settlements/${championshipPrizeSettlementId(request)}`)).toMatchObject({
      status: 'CREDITED',
      balanceBefore: 25,
      balanceAfter: 525,
    });
    expect(mockDb.store.get(`championship_prize_awards/${championshipPrizeAwardId(request.championshipId, request.userId)}`)).toMatchObject({
      championshipId: request.championshipId,
      userId: request.userId,
      rank: 1,
      amount: 500,
      status: 'CREDITED',
      financialRiskStatus: 'CLEAR',
      transactionId: championshipPrizeTransactionId(request),
    });
  });

  test('refund ou perda de elegibilidade cria marker definitivo sem pagar', async () => {
    mockDb.store.set('championship_registrations/user-a_invictus_cardio_v1', {
      ...mockDb.store.get('championship_registrations/user-a_invictus_cardio_v1'),
      status: 'reembolsada', paymentStatus: 'REFUNDED',
    });
    const request = input();
    const first = await creditChampionshipPrize(request);
    expect(first).toMatchObject({ credited: false, alreadyCredited: false, ineligible: true });
    expect(mockDb.store.has('wallets/user-a')).toBe(false);
    expect(mockDb.store.has(`championship_prize_awards/${championshipPrizeAwardId(request.championshipId, request.userId)}`)).toBe(false);

    // Mesmo que o perfil/registro seja alterado depois, o retry antigo não
    // transforma uma inelegibilidade já homologada em novo pagamento.
    mockDb.store.set('championship_registrations/user-a_invictus_cardio_v1', {
      userId: 'user-a', championshipId: 'invictus_cardio_v1', status: 'paga', paymentStatus: 'PAID',
      regulationVersion: 'invictus-cardio-v1', regulationHash: 'rules-digest-123',
    });
    const retry = await creditChampionshipPrize(request);
    expect(retry).toMatchObject({ credited: false, alreadyCredited: false, ineligible: true });
    expect(mockDb.store.has('wallets/user-a')).toBe(false);
  });

  test('conta inativa não recebe prêmio', async () => {
    mockDb.store.set('users/user-a', { status: 'blocked' });
    const result = await creditChampionshipPrize(input());
    expect(result.ineligible).toBe(true);
    expect(mockDb.store.has('wallets/user-a')).toBe(false);
  });

  test('mudança posterior de valor colide no mesmo rank em vez de pagar novamente', async () => {
    const first = input({ amount: 500 });
    await creditChampionshipPrize(first);
    await expect(creditChampionshipPrize(input({ amount: 600 }))).rejects.toThrow(/Conflito no (award|settlement) de prêmio/);
    expect(mockDb.store.get('wallets/user-a')).toMatchObject({ redeemableBalance: 525 });
  });
});
