import handler from '../_handlers/private-challenges';
import { verifyAuth } from '../_lib/common';
import { computeUserScoreForWindow } from '../_lib/igaService';

// Mock Firestore em memória com o MESMO shape usado em cardio-objective-api.test.ts:
// where/orderBy/limit/get para queries, e transações com get/create/set/update
// (create falha em ALREADY_EXISTS -- é exatamente essa garantia que o código
// de staking depende para nunca pagar/reembolsar em dobro).
const records = new Map<string, any>();
let serial = 0;
function reference(path: string): any {
  return {
    id: path.split('/').at(-1), path,
    collection: (name: string) => collection(`${path}/${name}`),
    get: async () => document(path),
  };
}
function document(path: string): any {
  return { id: path.split('/').at(-1), ref: reference(path), exists: records.has(path), data: () => structuredClone(records.get(path)) };
}
function collection(path: string, filters: Array<(v: any) => boolean> = [], order?: [string, string], count = Infinity): any {
  return {
    doc: (id = `generated_${++serial}`) => reference(`${path}/${id}`),
    where: (field: string, op: string, value: any) => collection(path, [...filters, v => {
      if (op === '==') return v[field] === value;
      if (op === 'in') return Array.isArray(value) && value.includes(v[field]);
      return v[field] >= value;
    }], order, count),
    orderBy: (field: string, direction = 'asc') => collection(path, filters, [field, direction], count),
    limit: (limit: number) => collection(path, filters, order, limit),
    get: async () => {
      let entries = [...records].filter(([key, value]) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/') && filters.every(f => f(value)));
      if (order) entries.sort((a, b) => String(a[1][order[0]]).localeCompare(String(b[1][order[0]])) * (order[1] === 'desc' ? -1 : 1));
      const docs = entries.slice(0, count).map(([key]) => document(key));
      return { docs, empty: !docs.length };
    },
  };
}
jest.mock('../_lib/common', () => ({
  cors: jest.fn(() => false), verifyAuth: jest.fn(),
  db: {
    collection: (name: string) => collection(name),
    runTransaction: async (fn: (tx: any) => Promise<void>) => {
      const writes: Array<() => void> = [];
      const result = await fn({
        get: (ref: any) => ref.get(),
        create: (ref: any, value: any) => { if (records.has(ref.path)) throw new Error('ALREADY_EXISTS'); writes.push(() => records.set(ref.path, structuredClone(value))); },
        set: (ref: any, value: any, options?: { merge?: boolean }) => writes.push(() => records.set(ref.path, options?.merge ? { ...(records.get(ref.path) || {}), ...structuredClone(value) } : structuredClone(value))),
        update: (ref: any, value: any) => writes.push(() => records.set(ref.path, { ...records.get(ref.path), ...structuredClone(value) })),
      });
      writes.forEach(write => write());
      return result;
    },
  },
}));
jest.mock('../_lib/entitlement', () => ({ isProUser: jest.fn(() => true) }));
jest.mock('../_lib/igaService', () => ({ computeUserScoreForWindow: jest.fn() }));

const now = '2026-09-18T12:00:00.000Z';

async function request(body?: any, query: any = {}) {
  const result = { status: 200, body: undefined as any };
  const res: any = { status: (status: number) => { result.status = status; return res; }, json: (value: any) => { result.body = value; return res; } };
  await handler({ method: 'POST', body, query } as any, res);
  return result;
}

function wallet(userId: string) {
  return records.get(`reward_coin_wallets/${userId}`);
}

beforeEach(() => {
  records.clear(); serial = 0;
  jest.useFakeTimers().setSystemTime(new Date(now));
  (verifyAuth as jest.Mock).mockResolvedValue({ uid: 'u1' });
  (computeUserScoreForWindow as jest.Mock).mockResolvedValue({ average: 0, weeks: [] });
  records.set('users/u1', { displayName: 'Atleta 1', status: 'active' });
  records.set('users/u2', { displayName: 'Atleta 2', status: 'active' });
  records.set('users/u3', { displayName: 'Atleta 3', status: 'active' });
  records.set('users/u4', { displayName: 'Atleta 4', status: 'active' });
});
afterEach(() => jest.useRealTimers());

describe('criação de desafio com aposta em Invictus Coins', () => {
  test('debita a aposta do criador atomicamente com a criação do desafio', async () => {
    records.set('reward_coin_wallets/u1', { balance: 500, lifetimeEarned: 500, lifetimeSpent: 0 });
    const result = await request({ action: 'create', title: 'Desafio X', durationDays: 7, stakeAmount: 100 });
    expect(result.status).toBe(200);
    const challengeId = result.body.challengeId;

    expect(wallet('u1')).toMatchObject({ balance: 400, lifetimeSpent: 100 });
    expect(records.get(`private_challenges/${challengeId}`)).toMatchObject({ stakeAmount: 100, potTotal: 100 });
    expect(records.get(`private_challenge_members/u1_${challengeId}`)).toMatchObject({ stakeAmount: 100 });
    const txs = [...records.entries()].filter(([k]) => k.startsWith('reward_coin_transactions/'));
    expect(txs).toHaveLength(1);
    expect(txs[0][1]).toMatchObject({ userId: 'u1', amount: 100, type: 'debit', origin: 'private_challenge_stake' });
  });

  test('rejeita e não cria nada quando o saldo é insuficiente', async () => {
    records.set('reward_coin_wallets/u1', { balance: 50, lifetimeEarned: 50, lifetimeSpent: 0 });
    const result = await request({ action: 'create', title: 'Desafio X', durationDays: 7, stakeAmount: 100 });
    expect(result.status).toBe(500);
    expect(result.body.error).toContain('Saldo de Invictus Coins insuficiente');
    expect(wallet('u1')).toMatchObject({ balance: 50 });
    expect([...records.keys()].some(k => k.startsWith('private_challenges/'))).toBe(false);
  });

  test('sem stakeAmount continua sendo um desafio livre, sem tocar em Coins', async () => {
    const result = await request({ action: 'create', title: 'Desafio livre', durationDays: 7 });
    expect(result.status).toBe(200);
    expect(records.get(`private_challenges/${result.body.challengeId}`)).toMatchObject({ stakeAmount: 0, potTotal: 0 });
    expect(wallet('u1')).toBeUndefined();
  });
});

describe('entrada em desafio com aposta', () => {
  async function createStakedChallenge(stakeAmount = 100) {
    records.set('reward_coin_wallets/u1', { balance: 1000, lifetimeEarned: 1000, lifetimeSpent: 0 });
    const created = await request({ action: 'create', title: 'Desafio X', durationDays: 7, stakeAmount });
    return created.body.challengeId as string;
  }

  test('debita a aposta de quem entra e soma ao pote', async () => {
    const challengeId = await createStakedChallenge(100);
    const inviteCode = records.get(`private_challenges/${challengeId}`).inviteCode;
    records.set('reward_coin_wallets/u2', { balance: 300, lifetimeEarned: 300, lifetimeSpent: 0 });

    (verifyAuth as jest.Mock).mockResolvedValue({ uid: 'u2' });
    const result = await request({ action: 'join', inviteCode });

    expect(result.status).toBe(200);
    expect(wallet('u2')).toMatchObject({ balance: 200, lifetimeSpent: 100 });
    expect(records.get(`private_challenges/${challengeId}`)).toMatchObject({ status: 'active', potTotal: 200 });
    expect(records.get(`private_challenge_members/u2_${challengeId}`)).toMatchObject({ stakeAmount: 100 });
  });

  test('rejeita entrada com saldo insuficiente sem alterar o desafio', async () => {
    const challengeId = await createStakedChallenge(100);
    const inviteCode = records.get(`private_challenges/${challengeId}`).inviteCode;
    records.set('reward_coin_wallets/u2', { balance: 10, lifetimeEarned: 10, lifetimeSpent: 0 });

    (verifyAuth as jest.Mock).mockResolvedValue({ uid: 'u2' });
    const result = await request({ action: 'join', inviteCode });

    expect(result.status).toBe(500);
    expect(result.body.error).toContain('Saldo de Invictus Coins insuficiente');
    expect(wallet('u2')).toMatchObject({ balance: 10 });
    expect(records.get(`private_challenges/${challengeId}`)).toMatchObject({ status: 'forming' });
    expect(records.has(`private_challenge_members/u2_${challengeId}`)).toBe(false);
  });
});

describe('encerramento de desafio com aposta', () => {
  function pastChallenge(overrides: Record<string, any> = {}) {
    const challengeId = 'ch1';
    records.set(`private_challenges/${challengeId}`, {
      title: 'Desafio X', creatorId: 'u1', status: 'active', stakeAmount: 100, potTotal: 200,
      startDate: '2026-09-01T00:00:00.000Z', endDate: '2026-09-10T00:00:00.000Z', extendedOnce: false,
      ...overrides,
    });
    return challengeId;
  }
  function member(challengeId: string, userId: string, stakeAmount = 100) {
    records.set(`private_challenge_members/${userId}_${challengeId}`, { userId, userName: `Atleta ${userId}`, challengeId, points: 0, stakeAmount });
    records.set(`reward_coin_wallets/${userId}`, { balance: 1000, lifetimeEarned: 1000, lifetimeSpent: 100 });
  }
  async function triggerExpiration() {
    return request({ action: 'list' });
  }

  test('cancela e reembolsa quando fica com menos de 2 participantes', async () => {
    const challengeId = pastChallenge({ potTotal: 100 });
    member(challengeId, 'u1', 100);

    await triggerExpiration();

    const challenge = records.get(`private_challenges/${challengeId}`);
    expect(challenge).toMatchObject({ status: 'cancelled', resultStatus: 'CANCELLED_BELOW_MIN_PARTICIPANTS' });
    expect(wallet('u1')).toMatchObject({ balance: 1100 });
    const refundTx = [...records.entries()].find(([k, v]) => k.startsWith('reward_coin_transactions/') && v.origin === 'private_challenge_refund');
    expect(refundTx?.[1]).toMatchObject({ userId: 'u1', amount: 100, type: 'credit' });
  });

  test('paga o pote inteiro para o vencedor único', async () => {
    const challengeId = pastChallenge();
    member(challengeId, 'u1', 100);
    member(challengeId, 'u2', 100);
    (computeUserScoreForWindow as jest.Mock).mockImplementation(async (userId: string) => ({
      average: userId === 'u1' ? 10 : 5, weeks: [],
    }));

    await triggerExpiration();

    const challenge = records.get(`private_challenges/${challengeId}`);
    expect(challenge).toMatchObject({ status: 'completed', winnerId: 'u1', resultStatus: 'WINNER_CONFIRMED' });
    expect(wallet('u1')).toMatchObject({ balance: 1200 });
    expect(wallet('u2')).toMatchObject({ balance: 1000 });
    const payoutTx = [...records.entries()].find(([k, v]) => k.startsWith('reward_coin_transactions/') && v.origin === 'private_challenge_payout');
    expect(payoutTx?.[1]).toMatchObject({ userId: 'u1', amount: 200 });
  });

  test('empate estende o desafio em 1 dia sem mexer em Coins', async () => {
    const challengeId = pastChallenge();
    member(challengeId, 'u1', 100);
    member(challengeId, 'u2', 100);
    (computeUserScoreForWindow as jest.Mock).mockResolvedValue({ average: 5, weeks: [] });

    await triggerExpiration();

    const challenge = records.get(`private_challenges/${challengeId}`);
    expect(challenge.status).toBe('active');
    expect(challenge.extendedOnce).toBe(true);
    expect(challenge.endDate).toBe('2026-09-11T00:00:00.000Z');
    expect(wallet('u1')).toMatchObject({ balance: 1000 });
    expect(wallet('u2')).toMatchObject({ balance: 1000 });
  });

  test('empate persistente após a extensão divide o pote (com resto distribuído)', async () => {
    const challengeId = pastChallenge({ potTotal: 400, extendedOnce: true });
    member(challengeId, 'a', 100);
    member(challengeId, 'b', 100);
    member(challengeId, 'c', 100);
    member(challengeId, 'd', 100);
    (computeUserScoreForWindow as jest.Mock).mockImplementation(async (userId: string) => ({
      average: userId === 'd' ? 3 : 10, weeks: [],
    }));

    await triggerExpiration();

    const challenge = records.get(`private_challenges/${challengeId}`);
    expect(challenge).toMatchObject({ status: 'completed', winnerId: null, resultStatus: 'SPLIT_ON_PERSISTENT_TIE' });
    // base = floor(400/3) = 133, resto = 1 -> primeiro (ordem alfabética: a) leva 134
    expect(wallet('a')).toMatchObject({ balance: 1134 });
    expect(wallet('b')).toMatchObject({ balance: 1133 });
    expect(wallet('c')).toMatchObject({ balance: 1133 });
    expect(wallet('d')).toMatchObject({ balance: 1000 });
  });

  test('não estende nem paga duas vezes se processado de novo após concluído', async () => {
    const challengeId = pastChallenge();
    member(challengeId, 'u1', 100);
    member(challengeId, 'u2', 100);
    (computeUserScoreForWindow as jest.Mock).mockImplementation(async (userId: string) => ({
      average: userId === 'u1' ? 10 : 5, weeks: [],
    }));

    await triggerExpiration();
    const balanceAfterFirst = wallet('u1').balance;
    // Segunda passada (ex: outra requisição de lista) não deve pagar de novo:
    // o status já é 'completed', processChallengeExpiration retorna cedo.
    await triggerExpiration();

    expect(wallet('u1').balance).toBe(balanceAfterFirst);
  });
});
