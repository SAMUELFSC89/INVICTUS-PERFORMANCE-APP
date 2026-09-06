import type { PhysicalShippingAddress } from '../types';
import {
  attachOrderToCheckoutIntent,
  checkoutIntentFingerprint,
  clearCheckoutIntent,
  getOrCreateCheckoutIntent,
  readCheckoutIntent,
  type CheckoutIntentInput,
  type CheckoutIntentStorage,
} from './storeCheckoutIntent';

class MemoryStorage implements CheckoutIntentStorage {
  private values = new Map<string, string>();

  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

const address: PhysicalShippingAddress = {
  recipientName: 'Atleta Teste',
  postalCode: '12345-678',
  street: 'Rua da Força',
  number: '10',
  complement: '',
  district: 'Centro',
  city: 'São Paulo',
  state: 'sp',
};

const input = (overrides: Partial<CheckoutIntentInput> = {}): CheckoutIntentInput => ({
  userId: 'user-1',
  productId: 'product-1',
  mode: 'money',
  quantity: 1,
  address,
  dropId: null,
  ...overrides,
});

describe('contrato da intenção idempotente do checkout (BILL-11)', () => {
  test('dois submits idênticos reutilizam exatamente a mesma chave', () => {
    const storage = new MemoryStorage();
    const createKey = jest.fn().mockReturnValueOnce('intent-1').mockReturnValueOnce('intent-2');

    const first = getOrCreateCheckoutIntent(storage, input(), createKey);
    const retry = getOrCreateCheckoutIntent(storage, input(), createKey);

    expect(first.idempotencyKey).toBe('intent-1');
    expect(retry.idempotencyKey).toBe('intent-1');
    expect(createKey).toHaveBeenCalledTimes(1);
  });

  test('uma nova instância após reload lê e reutiliza a intenção persistida', () => {
    const storage = new MemoryStorage();
    getOrCreateCheckoutIntent(storage, input(), () => 'before-reload', () => '2026-09-06T00:00:00.000Z');

    const restored = readCheckoutIntent(storage, input());
    const retriedAfterReload = getOrCreateCheckoutIntent(storage, input(), () => 'must-not-be-used');

    expect(restored?.idempotencyKey).toBe('before-reload');
    expect(retriedAfterReload.idempotencyKey).toBe('before-reload');
    expect(retriedAfterReload.address.postalCode).toBe('12345678');
    expect(retriedAfterReload.address.state).toBe('SP');
  });

  test('formatação equivalente do endereço não cria outra intenção', () => {
    const first = input();
    const sameServerPayload = input({ address: { ...address, recipientName: '  Atleta Teste  ', postalCode: '12345678', state: 'SP' } });

    expect(checkoutIntentFingerprint(first)).toBe(checkoutIntentFingerprint(sameServerPayload));
  });

  test.each([
    ['quantidade', { quantity: 2 }],
    ['produto', { productId: 'product-2' }],
    ['modo', { mode: 'discount' as const }],
    ['endereço', { address: { ...address, number: '11' } }],
    ['drop', { mode: 'drop' as const, dropId: 'drop-2' }],
  ])('mudar %s cria uma intenção explicitamente nova', (_label, change) => {
    const storage = new MemoryStorage();
    let sequence = 0;
    const createKey = () => `intent-${++sequence}`;
    const first = getOrCreateCheckoutIntent(storage, input(), createKey);
    const changed = getOrCreateCheckoutIntent(storage, input(change), createKey);

    expect(changed.idempotencyKey).not.toBe(first.idempotencyKey);
  });

  test('erro ou resposta perdida mantém a intenção; confirmação permite uma nova', () => {
    const storage = new MemoryStorage();
    let sequence = 0;
    const createKey = () => `intent-${++sequence}`;
    const uncertain = getOrCreateCheckoutIntent(storage, input(), createKey);

    expect(getOrCreateCheckoutIntent(storage, input(), createKey).idempotencyKey).toBe(uncertain.idempotencyKey);
    clearCheckoutIntent(storage, uncertain);
    expect(getOrCreateCheckoutIntent(storage, input(), createKey).idempotencyKey).toBe('intent-2');
  });

  test('resposta antiga não sobrescreve nem apaga uma intenção mais nova', () => {
    const storage = new MemoryStorage();
    const oldIntent = getOrCreateCheckoutIntent(storage, input(), () => 'old-intent');
    const newIntent = getOrCreateCheckoutIntent(storage, input({ quantity: 2 }), () => 'new-intent');

    expect(attachOrderToCheckoutIntent(storage, oldIntent, 'old-order')).toBe(false);
    expect(clearCheckoutIntent(storage, oldIntent)).toBe(false);

    const stored = readCheckoutIntent(storage, input());
    expect(stored?.idempotencyKey).toBe(newIntent.idempotencyKey);
    expect(stored?.orderId).toBeUndefined();
  });

  test('associa o pedido somente enquanto a intenção correspondente continua ativa', () => {
    const storage = new MemoryStorage();
    const intent = getOrCreateCheckoutIntent(storage, input(), () => 'intent-with-order');

    expect(attachOrderToCheckoutIntent(storage, intent, 'order-1')).toBe(true);
    expect(readCheckoutIntent(storage, input())?.orderId).toBe('order-1');
  });

  test('não envia com segurança degradada quando a intenção não pode ser persistida', () => {
    const blockedStorage: CheckoutIntentStorage = {
      getItem: () => null,
      setItem: () => { throw new Error('blocked'); },
      removeItem: () => undefined,
    };

    expect(() => getOrCreateCheckoutIntent(blockedStorage, input(), () => 'unsafe-key')).toThrow('Não foi possível proteger esta tentativa');
  });
});
