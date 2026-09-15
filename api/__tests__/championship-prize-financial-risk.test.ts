import fs from 'node:fs';
import path from 'node:path';

let mockDb: any;

jest.mock('../_lib/common', () => ({
  get db() { return mockDb; },
}));

import { getChampionshipPrizeFinancialRisk } from '../_lib/championship-prize-financial-risk';

type Stored = Record<string, any>;

function createDb() {
  const store = new Map<string, Stored>();
  const snapshot = (id: string, value: Stored | undefined) => ({
    id,
    exists: value !== undefined,
    data: () => value,
  });
  const queryFor = (collection: string, field: string, value: unknown) => ({
    get: async () => ({
      docs: [...store.entries()]
        .filter(([key, data]) => key.startsWith(`${collection}/`) && data[field] === value)
        .map(([key, data]) => snapshot(key.slice(collection.length + 1), data)),
    }),
  });

  return {
    store,
    collection: (collection: string) => ({
      doc: (id: string) => ({
        id,
        key: `${collection}/${id}`,
        get: async () => snapshot(id, store.get(`${collection}/${id}`)),
      }),
      where: (field: string, _operator: string, value: unknown) => queryFor(collection, field, value),
    }),
  };
}

const EDITION_A = 'invictus_cardio_v1_ed_a';
const EDITION_B = 'invictus_cardio_v1_ed_b';

describe('championship prize financial risk', () => {
  beforeEach(() => {
    mockDb = createDb();
  });

  test('reembolso sem prêmio creditado não bloqueia outros saldos do usuário', async () => {
    mockDb.store.set(`championship_registrations/user-a_${EDITION_A}`, {
      userId: 'user-a', championshipId: 'invictus_cardio_v1', editionId: EDITION_A,
      status: 'reembolsada', paymentStatus: 'REFUNDED',
    });
    await expect(getChampionshipPrizeFinancialRisk('user-a')).resolves.toBeNull();
  });

  test('chargeback depois de prêmio creditado cria risco financeiro de saque da mesma edição', async () => {
    mockDb.store.set(`championship_registrations/user-a_${EDITION_A}`, {
      userId: 'user-a', championshipId: 'invictus_cardio_v1', editionId: EDITION_A, status: 'contestada',
      paymentStatus: 'PAYMENT_CHARGEBACK_DISPUTE', paymentLifecycleEvent: 'PAYMENT_CHARGEBACK_DISPUTE',
    });
    mockDb.store.set(`championship_prize_awards/${EDITION_A}_user-a`, {
      championshipId: 'invictus_cardio_v1', editionId: EDITION_A, userId: 'user-a', status: 'CREDITED', amount: 500, rank: 1,
      transactionId: 'tx_championship_prize_abc',
    });

    await expect(getChampionshipPrizeFinancialRisk('user-a')).resolves.toMatchObject({
      championshipId: 'invictus_cardio_v1',
      editionId: EDITION_A,
      paymentStatus: 'PAYMENT_CHARGEBACK_DISPUTE',
      awardAmount: 500,
      rank: 1,
      transactionId: 'tx_championship_prize_abc',
    });
  });

  test('award de edição anterior não é herdado por disputa financeira de edição nova', async () => {
    mockDb.store.set(`championship_registrations/user-a_${EDITION_B}`, {
      userId: 'user-a', championshipId: 'invictus_cardio_v1', editionId: EDITION_B, status: 'contestada',
      paymentStatus: 'PAYMENT_CHARGEBACK_DISPUTE', paymentLifecycleEvent: 'PAYMENT_CHARGEBACK_DISPUTE',
    });
    mockDb.store.set(`championship_prize_awards/${EDITION_A}_user-a`, {
      championshipId: 'invictus_cardio_v1', editionId: EDITION_A, userId: 'user-a', status: 'CREDITED', amount: 500, rank: 1,
      transactionId: 'tx_old_edition',
    });

    await expect(getChampionshipPrizeFinancialRisk('user-a')).resolves.toBeNull();
  });

  test('award creditado com inscrição ainda paga não bloqueia saque', async () => {
    mockDb.store.set(`championship_registrations/user-a_${EDITION_A}`, {
      userId: 'user-a', championshipId: 'invictus_cardio_v1', editionId: EDITION_A, status: 'paga', paymentStatus: 'PAID',
    });
    mockDb.store.set(`championship_prize_awards/${EDITION_A}_user-a`, {
      championshipId: 'invictus_cardio_v1', editionId: EDITION_A, userId: 'user-a', status: 'CREDITED', amount: 500, rank: 1,
      transactionId: 'tx_championship_prize_abc',
    });
    await expect(getChampionshipPrizeFinancialRisk('user-a')).resolves.toBeNull();
  });

  test('autorização Asaas consulta o risco dentro da transação antes de aprovar transferência', () => {
    const handler = fs.readFileSync(path.join(process.cwd(), 'api/_handlers/asaas-withdrawal-authorization.ts'), 'utf8');
    expect(handler).toContain('getChampionshipPrizeFinancialRisk(withdrawal.userId, tx)');
    expect(handler).toContain("status: 'REFUSED'");
    expect(handler).toContain('Premiacao de campeonato esta em conciliacao financeira');
  });
});
