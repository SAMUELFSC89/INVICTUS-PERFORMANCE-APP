import handler from '../_handlers/private-challenges';
import { verifyAuth } from '../_lib/common';
import { computePrivateChallengeIGAForWindow } from '../_lib/private-challenge-iga';

const records = new Map<string, any>();
let serial = 0;

function reference(path: string): any {
  return {
    id: path.split('/').at(-1),
    path,
    collection: (name: string) => collection(`${path}/${name}`),
    get: async () => document(path),
    set: async (value: any, options?: { merge?: boolean }) => {
      records.set(path, options?.merge ? { ...(records.get(path) || {}), ...structuredClone(value) } : structuredClone(value));
    },
  };
}

function document(path: string): any {
  return {
    id: path.split('/').at(-1),
    ref: reference(path),
    exists: records.has(path),
    data: () => structuredClone(records.get(path)),
  };
}

function collection(path: string, filters: Array<(v: any) => boolean> = [], order?: [string, string], count = Infinity): any {
  return {
    doc: (id = `generated_${++serial}`) => reference(`${path}/${id}`),
    where: (field: string, op: string, value: any) => collection(path, [...filters, v => {
      if (op === '==') return v[field] === value;
      if (op === 'in') return Array.isArray(value) && value.includes(v[field]);
      return false;
    }], order, count),
    orderBy: (field: string, direction = 'asc') => collection(path, filters, [field, direction], count),
    limit: (limit: number) => collection(path, filters, order, limit),
    get: async () => {
      let entries = [...records].filter(([key, value]) => key.startsWith(`${path}/`)
        && !key.slice(path.length + 1).includes('/')
        && filters.every(filter => filter(value)));
      if (order) entries.sort((a, b) => String(a[1][order[0]]).localeCompare(String(b[1][order[0]])) * (order[1] === 'desc' ? -1 : 1));
      const docs = entries.slice(0, count).map(([key]) => document(key));
      return { docs, empty: !docs.length };
    },
  };
}

jest.mock('../_lib/common', () => ({
  cors: jest.fn(() => false),
  verifyAuth: jest.fn(),
  db: {
    collection: (name: string) => collection(name),
    runTransaction: async (fn: (tx: any) => Promise<any>) => {
      const writes: Array<() => void> = [];
      const tx = {
        get: (ref: any) => ref.get(),
        create: (ref: any, value: any) => {
          if (records.has(ref.path)) throw new Error('ALREADY_EXISTS');
          writes.push(() => records.set(ref.path, structuredClone(value)));
        },
        set: (ref: any, value: any, options?: { merge?: boolean }) => writes.push(() => {
          records.set(ref.path, options?.merge ? { ...(records.get(ref.path) || {}), ...structuredClone(value) } : structuredClone(value));
        }),
        update: (ref: any, value: any) => writes.push(() => records.set(ref.path, { ...(records.get(ref.path) || {}), ...structuredClone(value) })),
      };
      const result = await fn(tx);
      writes.forEach(write => write());
      return result;
    },
  },
}));

jest.mock('../_lib/entitlement', () => ({ isProUser: jest.fn(() => true) }));
jest.mock('../_lib/account-state', () => ({ isActiveAccountState: jest.fn(() => true) }));
jest.mock('../_lib/private-challenge-iga', () => ({ computePrivateChallengeIGAForWindow: jest.fn() }));

const now = '2026-09-18T12:00:00.000Z';

async function request(body?: any, query: any = {}) {
  const result = { status: 200, body: undefined as any };
  const res: any = {
    status: (status: number) => { result.status = status; return res; },
    json: (value: any) => { result.body = value; return res; },
  };
  await handler({ method: 'POST', body, query } as any, res);
  return result;
}

function wallet(userId: string) {
  return records.get(`reward_coin_wallets/${userId}`);
}

function member(challengeId: string, userId: string, stakeAmount = 100) {
  records.set(`private_challenge_members/${userId}_${challengeId}`, {
    userId,
    userName: `Atleta ${userId}`,
    challengeId,
    points: 0,
    stakeAmount,
  });
  records.set(`reward_coin_wallets/${userId}`, { balance: 1000, lifetimeEarned: 1000, lifetimeSpent: 100 });
}

beforeEach(() => {
  records.clear();
  serial = 0;
  jest.useFakeTimers().setSystemTime(new Date(now));
  (verifyAuth as jest.Mock).mockResolvedValue({ uid: 'u1' });
  (computePrivateChallengeIGAForWindow as jest.Mock).mockResolvedValue({ average: 0, weeks: [] });
  records.set('users/u1', { displayName: 'Atleta 1', status: 'active' });
  records.set('users/u2', { displayName: 'Atleta 2', status: 'active' });
  records.set('users/u3', { displayName: 'Atleta 3', status: 'active' });
});

afterEach(() => jest.useRealTimers());

describe('private challenges — Invictus Coins + IGA', () => {
  test('debita stake atomicamente ao criar', async () => {
    records.set('reward_coin_wallets/u1', { balance: 500, lifetimeEarned: 500, lifetimeSpent: 0 });
    const result = await request({ action: 'create', title: 'Desafio X', durationDays: 7, stakeAmount: 100 });
    expect(result.status).toBe(200);
    expect(wallet('u1')).toMatchObject({ balance: 400, lifetimeSpent: 100 });
    expect(records.get(`private_challenges/${result.body.challengeId}`)).toMatchObject({ stakeAmount: 100, potTotal: 100 });
  });

  test('rejeita criação se Coins forem insuficientes e não cria desafio', async () => {
    records.set('reward_coin_wallets/u1', { balance: 50, lifetimeEarned: 50, lifetimeSpent: 0 });
    const result = await request({ action: 'create', title: 'Desafio X', durationDays: 7, stakeAmount: 100 });
    expect(result.status).toBe(500);
    expect(result.body.error).toContain('Saldo de Invictus Coins insuficiente');
    expect([...records.keys()].some(key => key.startsWith('private_challenges/'))).toBe(false);
  });

  test('entra com o mesmo stake e soma ao pote usando estado fresco', async () => {
    records.set('reward_coin_wallets/u1', { balance: 500, lifetimeEarned: 500, lifetimeSpent: 0 });
    const created = await request({ action: 'create', title: 'Desafio X', durationDays: 7, stakeAmount: 100 });
    const challengeId = created.body.challengeId;
    const inviteCode = records.get(`private_challenges/${challengeId}`).inviteCode;
    records.set('reward_coin_wallets/u2', { balance: 300, lifetimeEarned: 300, lifetimeSpent: 0 });
    (verifyAuth as jest.Mock).mockResolvedValue({ uid: 'u2' });

    const joined = await request({ action: 'join', inviteCode });
    expect(joined.status).toBe(200);
    expect(wallet('u2')).toMatchObject({ balance: 200, lifetimeSpent: 100 });
    expect(records.get(`private_challenges/${challengeId}`)).toMatchObject({ status: 'active', potTotal: 200 });
  });

  test('reembolsa stake se expirar abaixo de 2 participantes', async () => {
    records.set('private_challenges/ch1', {
      title: 'Desafio X', creatorId: 'u1', status: 'active', stakeAmount: 100, potTotal: 100,
      startDate: '2026-09-01T00:00:00.000Z', endDate: '2026-09-10T00:00:00.000Z', extendedOnce: false,
    });
    member('ch1', 'u1', 100);

    await request({ action: 'list' });
    expect(records.get('private_challenges/ch1')).toMatchObject({ status: 'cancelled', resultStatus: 'CANCELLED_BELOW_MIN_PARTICIPANTS' });
    expect(wallet('u1')).toMatchObject({ balance: 1100 });
  });

  test('IGA define vencedor único e paga pote inteiro uma única vez', async () => {
    records.set('private_challenges/ch1', {
      title: 'Desafio X', creatorId: 'u1', status: 'active', stakeAmount: 100, potTotal: 200,
      startDate: '2026-09-01T00:00:00.000Z', endDate: '2026-09-10T00:00:00.000Z', extendedOnce: false,
    });
    member('ch1', 'u1');
    member('ch1', 'u2');
    (computePrivateChallengeIGAForWindow as jest.Mock).mockImplementation(async (userId: string) => ({ average: userId === 'u1' ? 10 : 5, weeks: [] }));

    await request({ action: 'list' });
    const firstBalance = wallet('u1').balance;
    expect(records.get('private_challenges/ch1')).toMatchObject({ status: 'completed', winnerId: 'u1', resultStatus: 'WINNER_CONFIRMED' });
    expect(firstBalance).toBe(1200);
    await request({ action: 'list' });
    expect(wallet('u1').balance).toBe(firstBalance);
  });

  test('empate estende exatamente um dia antes de dividir', async () => {
    records.set('private_challenges/ch1', {
      title: 'Desafio X', creatorId: 'u1', status: 'active', stakeAmount: 100, potTotal: 200,
      startDate: '2026-09-01T00:00:00.000Z', endDate: '2026-09-10T00:00:00.000Z', extendedOnce: false,
    });
    member('ch1', 'u1');
    member('ch1', 'u2');
    (computePrivateChallengeIGAForWindow as jest.Mock).mockResolvedValue({ average: 5, weeks: [] });

    await request({ action: 'list' });
    expect(records.get('private_challenges/ch1')).toMatchObject({ status: 'active', extendedOnce: true, endDate: '2026-09-11T00:00:00.000Z' });
  });

  test('empate persistente divide o pote sem deixar resto', async () => {
    records.set('private_challenges/ch1', {
      title: 'Desafio X', creatorId: 'u1', status: 'active', stakeAmount: 100, potTotal: 301,
      startDate: '2026-09-01T00:00:00.000Z', endDate: '2026-09-10T00:00:00.000Z', extendedOnce: true,
    });
    member('ch1', 'u1');
    member('ch1', 'u2');
    member('ch1', 'u3');
    (computePrivateChallengeIGAForWindow as jest.Mock).mockImplementation(async (userId: string) => ({ average: userId === 'u3' ? 2 : 10, weeks: [] }));

    await request({ action: 'list' });
    expect(records.get('private_challenges/ch1')).toMatchObject({ status: 'completed', resultStatus: 'SPLIT_ON_PERSISTENT_TIE' });
    expect(wallet('u1').balance + wallet('u2').balance + wallet('u3').balance).toBe(3301);
  });
});
