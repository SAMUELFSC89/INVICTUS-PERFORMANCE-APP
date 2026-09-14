import { createHash } from 'node:crypto';

let mockDb: any;

jest.mock('../_lib/common', () => ({
  get db() { return mockDb; },
}));

import { RewardCoinEngine } from '../_lib/reward-coin-engine';

type Stored = Record<string, any>;

function createDb() {
  const store = new Map<string, Stored>();
  const snapshot = (value: Stored | undefined) => ({
    exists: value !== undefined,
    data: () => value,
  });
  const ref = (collection: string, id: string) => ({
    collection,
    id,
    key: `${collection}/${id}`,
    get: async () => snapshot(store.get(`${collection}/${id}`)),
  });

  return {
    store,
    collection: (collection: string) => ({ doc: (id: string) => ref(collection, id) }),
    runTransaction: async (callback: (transaction: any) => Promise<any>) => {
      const writes: Array<{ target: any; value: Stored; merge: boolean }> = [];
      const transaction = {
        get: async (target: any) => snapshot(store.get(target.key)),
        set: (target: any, value: Stored, options?: { merge?: boolean }) => {
          writes.push({ target, value, merge: options?.merge === true });
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

function expectedId(userId: string, key: string): string {
  return `coin_${createHash('sha256').update(`${userId}\u0000${key}`).digest('hex')}`;
}

function expectedLegacyId(userId: string, key: string): string {
  return `coin_${userId}_${Buffer.from(key).toString('base64url').slice(0, 180)}`;
}

describe('RewardCoinEngine idempotency', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-06T12:00:00.000Z'));
    mockDb = createDb();
    // O engine valida lifecycle dentro da mesma transação do saldo. Os testes
    // de idempotência usam por padrão uma conta existente e elegível.
    mockDb.store.set('users/user-a', { status: 'active' });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('usa a chave completa no SHA-256 e não colide entre períodos longos', async () => {
    const prefix = `mission:${'m'.repeat(240)}`;
    const keyA = `${prefix}:2026-W36:claim`;
    const keyB = `${prefix}:2026-W37:claim`;
    const params = {
      userId: 'user-a', amount: 7, origin: 'mission' as const,
      ledgerType: 'MISSION_REWARD' as const, description: 'Desafio',
    };

    const first = await RewardCoinEngine.credit({ ...params, idempotencyKey: keyA });
    const second = await RewardCoinEngine.credit({ ...params, idempotencyKey: keyB });
    const retry = await RewardCoinEngine.credit({ ...params, idempotencyKey: keyA });

    expect(first.transaction.id).toBe(expectedId('user-a', keyA));
    expect(second.transaction.id).toBe(expectedId('user-a', keyB));
    expect(first.transaction.id).toMatch(/^coin_[a-f0-9]{64}$/);
    expect(second.transaction.id).not.toBe(first.transaction.id);
    expect(retry).toMatchObject({ duplicated: true, transaction: { id: first.transaction.id } });
    expect(mockDb.store.get('reward_coin_wallets/user-a')).toMatchObject({
      balance: 14,
      lifetimeEarned: 14,
    });
    // Dois lançamentos canônicos e um único alias: as chaves longas colidem
    // justamente no ID truncado da versão anterior.
    expect([...mockDb.store.keys()].filter(key => key.startsWith('reward_coin_transactions/'))).toHaveLength(3);
    expect(mockDb.store.get(`reward_coin_transactions/${expectedLegacyId('user-a', keyA)}`)).toEqual(expect.objectContaining({
      idempotencyAlias: true,
      canonicalTransactionId: expectedId('user-a', keyA),
    }));
    expect(mockDb.store.get(`reward_coin_transactions/${expectedLegacyId('user-a', keyA)}`)).not.toHaveProperty('userId');
  });

  test('alias legado impede uma instância antiga de creditar novamente durante o rollout', async () => {
    const input = {
      userId: 'user-a', amount: 7, origin: 'mission' as const,
      ledgerType: 'MISSION_REWARD' as const, description: 'Desafio', idempotencyKey: 'rollout-misto',
    };
    await RewardCoinEngine.credit(input);

    // A versão anterior tomava somente esta decisão: documento legado existe
    // => evento já processado. O alias precisa estar no mesmo commit do saldo.
    const legacy = mockDb.store.get(`reward_coin_transactions/${expectedLegacyId(input.userId, input.idempotencyKey)}`);
    expect(legacy).toMatchObject({
      idempotencyAlias: true,
      canonicalTransactionId: expectedId(input.userId, input.idempotencyKey),
    });
    const oldInstanceWouldCredit = !legacy;
    expect(oldInstanceWouldCredit).toBe(false);
    expect(mockDb.store.get('reward_coin_wallets/user-a')).toMatchObject({ balance: 7 });
  });

  test.each([
    ['idempotencyKey', 'chave-adulterada'],
    ['amount', 8],
    ['origin', 'campaign'],
  ])('rejeita ledger existente quando %s diverge', async (field, value) => {
    const input = {
      userId: 'user-a', amount: 7, origin: 'mission' as const,
      ledgerType: 'MISSION_REWARD' as const, description: 'Desafio', idempotencyKey: 'claim-a',
    };
    await RewardCoinEngine.credit(input);
    const transactionKey = `reward_coin_transactions/${expectedId(input.userId, input.idempotencyKey)}`;
    mockDb.store.set(transactionKey, { ...mockDb.store.get(transactionKey), [field]: value });

    await expect(RewardCoinEngine.credit(input)).rejects.toThrow('Conflito no ledger de Coins');
    expect(mockDb.store.get('reward_coin_wallets/user-a')).toMatchObject({ balance: 7, lifetimeEarned: 7 });
    expect(mockDb.store.get('reward_coin_monthly_counters/user-a_2026-09')).toMatchObject({ totalIssued: 7 });
    expect(mockDb.store.get('reward_coin_economy/global')).toMatchObject({ globalIssued: 7 });
  });

  test('falha fechado sem alterar saldo quando a conta fica inativa', async () => {
    mockDb.store.set('users/user-a', { status: 'blocked' });
    const input = {
      userId: 'user-a', amount: 7, origin: 'mission' as const,
      ledgerType: 'MISSION_REWARD' as const, description: 'Desafio', idempotencyKey: 'blocked-claim',
    };

    await expect(RewardCoinEngine.credit(input)).rejects.toThrow('Conta inativa não pode receber Invictus Coins.');
    expect(mockDb.store.has('reward_coin_wallets/user-a')).toBe(false);
    expect([...mockDb.store.keys()].some(key => key.startsWith('reward_coin_transactions/'))).toBe(false);
  });
});
