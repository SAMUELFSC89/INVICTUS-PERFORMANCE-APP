let mockDb: any;

jest.mock('../_lib/common', () => ({
  get db() { return mockDb; },
}));

import { WalletEngine } from '../_lib/wallet-engine';

type Stored = Record<string, any>;

function createDb() {
  const store = new Map<string, Stored>();
  let firstWalletRead = true;
  let injectConcurrentWallet: Stored | null = null;

  const snapshot = (value: Stored | undefined) => ({
    exists: value !== undefined,
    data: () => value,
  });
  const ref = (collection: string, id: string) => ({
    collection,
    id,
    key: `${collection}/${id}`,
    get: async () => {
      if (collection === 'wallets' && firstWalletRead) {
        firstWalletRead = false;
        return snapshot(undefined);
      }
      return snapshot(store.get(`${collection}/${id}`));
    },
  });

  return {
    store,
    setConcurrentWallet(value: Stored) { injectConcurrentWallet = value; },
    collection: (collection: string) => ({ doc: (id: string) => ref(collection, id) }),
    runTransaction: async (callback: (transaction: any) => Promise<any>) => {
      if (injectConcurrentWallet) {
        store.set('wallets/user-a', injectConcurrentWallet);
        injectConcurrentWallet = null;
      }
      const creates: Array<{ target: any; value: Stored }> = [];
      const transaction = {
        get: async (target: any) => snapshot(store.get(target.key)),
        create: (target: any, value: Stored) => {
          if (store.has(target.key)) throw new Error(`already exists: ${target.key}`);
          creates.push({ target, value });
        },
      };
      const result = await callback(transaction);
      for (const { target, value } of creates) store.set(target.key, { ...value });
      return result;
    },
  };
}

describe('WalletEngine initial wallet concurrency', () => {
  beforeEach(() => {
    mockDb = createDb();
    mockDb.store.set('users/user-a', { walletBalance: 25 });
  });

  test('migra saldo legado quando realmente não existe carteira moderna', async () => {
    const wallet = await WalletEngine.getWallet('user-a');
    expect(wallet).toMatchObject({
      userId: 'user-a',
      redeemableBalance: 25,
      totalBalance: 25,
    });
  });

  test('não sobrescreve crédito que apareceu depois da leitura inicial', async () => {
    mockDb.setConcurrentWallet({
      userId: 'user-a',
      redeemableBalance: 525,
      ecosystemBalance: 10,
      promotionalBalance: 5,
      blockedBalance: 0,
      totalBalance: 540,
      updatedAt: '2026-09-15T15:00:00.000Z',
    });

    const wallet = await WalletEngine.getWallet('user-a');
    expect(wallet).toMatchObject({
      redeemableBalance: 525,
      ecosystemBalance: 10,
      promotionalBalance: 5,
      totalBalance: 540,
    });
    expect(mockDb.store.get('wallets/user-a')).toMatchObject({ redeemableBalance: 525 });
  });
});
