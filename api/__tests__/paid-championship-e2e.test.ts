const mockDeleteSentinel = { __fieldValueDelete: true };
let mockDb: any;

const mockChampionship: any = {
  id: 'invictus_cardio_v1',
  editionId: 'invictus_cardio_v1_ed_e2e',
  type: 'run_elite_corrida',
  title: 'Campeonato Invictus de Cardio',
  edition: 'E2E',
  subtitle: 'E2E',
  description: 'E2E',
  categoryLabel: 'Corrida',
  accentColor: 'teal',
  durationDays: 30,
  startAt: '2026-09-01T00:00:00.000Z',
  endAt: '2026-09-10T23:59:59.999Z',
  settlementAt: '2026-09-11T12:00:00.000Z',
  registrationPrice: 29.9,
  participantCount: 0,
  grossRevenue: 0,
  netEligibleRevenue: 0,
  prizePool: 500,
  prizeDistribution: [{ rank: 1, amount: 500 }],
  status: 'active',
  regulationVersion: 'invictus-cardio-v1',
  regulationHash: 'rules-e2e-hash',
  publishedConfigDigest: 'config-e2e-digest',
  antiFraudProfile: { requireContinuousGPS: true, allowedCardioTypes: ['running'] },
};

jest.mock('../_lib/common', () => ({
  get db() { return mockDb; },
  FieldValue: {
    serverTimestamp: () => '2026-09-16T12:00:00.000Z',
    delete: () => mockDeleteSentinel,
  },
}));

jest.mock('../_lib/championship-catalog', () => ({
  CHAMPIONSHIPS: [mockChampionship],
  getChampionship: jest.fn((id: string) => id === mockChampionship.id ? mockChampionship : null),
  getRuntimeChampionship: jest.fn(async (id: string) => id === mockChampionship.id ? mockChampionship : undefined),
  listRuntimeChampionships: jest.fn(async () => [mockChampionship]),
  matchRuntimeActiveChampionshipsForActivity: jest.fn(async () => [mockChampionship]),
  isRegistrationOpen: jest.fn(() => true),
}));

jest.mock('../_lib/paid-championship-edition', () => ({
  lockPaidChampionshipEdition: jest.fn(async () => undefined),
  markPaidChampionshipEditionFinalized: jest.fn(async () => undefined),
  paidChampionshipRegistrationId: (userId: string, editionId: string) => `${userId}_${editionId}`,
  paidChampionshipSettlementDocumentId: (editionId: string) => `settlement_${editionId}`,
}));

jest.mock('../_lib/asaas-client', () => ({
  AsaasClient: {
    criarCheckoutHospedado: jest.fn(async () => ({
      id: 'checkout_e2e_1',
      link: 'https://sandbox.asaas.com/checkoutSession/show?id=checkout_e2e_1',
    })),
    transferPix: jest.fn(async (input: any) => ({
      id: 'transfer_e2e_1',
      status: 'DONE',
      value: input.value,
    })),
  },
}));

jest.mock('../_lib/account-state', () => ({
  isActiveAccountState: (data: any) => String(data?.status || 'active') === 'active',
}));

jest.mock('../_lib/entitlement', () => ({ isProUser: () => true }));
jest.mock('../_lib/withdrawal-admin-status', () => ({ updateWithdrawalStatusSafely: jest.fn() }));
jest.mock('../_services/notification-service', () => ({
  notificationService: { notify: jest.fn(async () => undefined) },
}));

import { AsaasClient } from '../_lib/asaas-client';
import {
  confirmarInscricaoChampionshipPorPagamento,
  criarInscricaoChampionship,
  registrarAceiteRegulamento,
  registrarEventoFinanceiroChampionship,
} from '../_lib/championship-inscription-service';
import { finalizePaidChampionship } from '../_lib/paid-championship-settlement';
import { WithdrawalEngine } from '../_lib/withdrawal-engine';
import { COMPETITIVE_HR_ACKNOWLEDGEMENT_VERSION } from '../../shared/competitiveHeartRatePolicy';

type Stored = Record<string, any>;
type Filter = { field: string; op: string; value: any };

function createDb() {
  const store = new Map<string, Stored>();

  const applyValue = (current: Stored | undefined, value: Stored, merge: boolean) => {
    const next: Stored = merge ? { ...(current || {}) } : {};
    for (const [key, fieldValue] of Object.entries(value || {})) {
      if (fieldValue === mockDeleteSentinel) delete next[key];
      else next[key] = fieldValue;
    }
    return next;
  };

  const makeRef = (collection: string, id: string): any => {
    const key = `${collection}/${id}`;
    const ref: any = {
      __kind: 'doc', collection, id, key,
      get: async () => makeDocSnapshot(ref),
      set: async (value: Stored, options?: { merge?: boolean }) => {
        store.set(key, applyValue(store.get(key), value, options?.merge === true));
      },
      update: async (value: Stored) => {
        if (!store.has(key)) throw new Error(`missing doc: ${key}`);
        store.set(key, applyValue(store.get(key), value, true));
      },
    };
    return ref;
  };

  const makeDocSnapshot = (ref: any) => {
    const value = store.get(ref.key);
    return {
      id: ref.id,
      ref,
      exists: value !== undefined,
      data: () => value,
    };
  };

  const matches = (value: Stored, filter: Filter) => {
    const actual = value?.[filter.field];
    if (filter.op === '==') return actual === filter.value;
    if (filter.op === '>=') return String(actual ?? '') >= String(filter.value ?? '');
    throw new Error(`unsupported filter op: ${filter.op}`);
  };

  const makeQuery = (collection: string, filters: Filter[] = [], limitCount?: number): any => {
    const query: any = {
      __kind: 'query', collection, filters, limitCount,
      where: (field: string, op: string, value: any) => makeQuery(collection, [...filters, { field, op, value }], limitCount),
      limit: (count: number) => makeQuery(collection, filters, count),
      orderBy: () => query,
      get: async () => evaluateQuery(query),
      count: () => ({
        get: async () => ({ data: () => ({ count: evaluateQuery(query).size }) }),
      }),
    };
    return query;
  };

  const evaluateQuery = (query: any) => {
    const prefix = `${query.collection}/`;
    let refs = [...store.keys()]
      .filter((key) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
      .map((key) => makeRef(query.collection, key.slice(prefix.length)))
      .filter((ref) => query.filters.every((filter: Filter) => matches(store.get(ref.key) || {}, filter)));
    if (Number.isFinite(query.limitCount)) refs = refs.slice(0, query.limitCount);
    const docs = refs.map(makeDocSnapshot);
    return { docs, empty: docs.length === 0, size: docs.length };
  };

  const collection = (name: string): any => ({
    doc: (id: string) => makeRef(name, id),
    where: (field: string, op: string, value: any) => makeQuery(name, [{ field, op, value }]),
    get: async () => evaluateQuery(makeQuery(name)),
  });

  const runTransaction = async (callback: (transaction: any) => Promise<any>) => {
    const writes: Array<{ kind: 'set' | 'create'; target: any; value: Stored; merge: boolean }> = [];
    const transaction: any = {
      get: async (target: any) => target?.__kind === 'query' ? evaluateQuery(target) : makeDocSnapshot(target),
      set: (target: any, value: Stored, options?: { merge?: boolean }) => {
        writes.push({ kind: 'set', target, value, merge: options?.merge === true });
      },
      create: (target: any, value: Stored) => {
        if (store.has(target.key) || writes.some((write) => write.target.key === target.key)) {
          throw new Error(`already exists: ${target.key}`);
        }
        writes.push({ kind: 'create', target, value, merge: false });
      },
    };
    const result = await callback(transaction);
    for (const write of writes) {
      store.set(write.target.key, applyValue(store.get(write.target.key), write.value, write.merge));
    }
    return result;
  };

  return {
    store,
    collection,
    runTransaction,
    getAll: async (...refs: any[]) => refs.map(makeDocSnapshot),
    batch: () => {
      const writes: Array<{ target: any; value: Stored; merge: boolean }> = [];
      return {
        set: (target: any, value: Stored, options?: { merge?: boolean }) => {
          writes.push({ target, value, merge: options?.merge === true });
        },
        commit: async () => {
          for (const write of writes) {
            store.set(write.target.key, applyValue(store.get(write.target.key), write.value, write.merge));
          }
        },
      };
    },
  };
}

const USER_ID = 'user-e2e';
const REGISTRATION_ID = `${USER_ID}_${mockChampionship.editionId}`;

describe('paid championship financial lifecycle — end to end', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDb = createDb();
    mockDb.store.set(`users/${USER_ID}`, {
      status: 'active',
      name: 'Atleta E2E',
      displayName: 'Atleta E2E',
      email: 'e2e@example.com',
      cpf: '12345678901',
      createdAt: '2026-01-01T00:00:00.000Z',
      totalWorkouts: 100,
      infractions: 0,
      walletBalance: 0,
    });
  });

  test('aceite -> checkout idempotente -> pagamento -> ranking/settlement -> prêmio -> PIX -> refund -> bloqueio', async () => {
    const acceptance = await registrarAceiteRegulamento({
      userId: USER_ID,
      championshipId: mockChampionship.id,
      regulationVersion: mockChampionship.regulationVersion,
      regulationHash: mockChampionship.regulationHash,
      ip: '127.0.0.1',
      platform: 'web',
      hrAcknowledgementId: 'hr_ack_e2e',
      hrAcknowledgementVersion: COMPETITIVE_HR_ACKNOWLEDGEMENT_VERSION,
    });

    const checkout = await criarInscricaoChampionship(USER_ID, mockChampionship.id, acceptance.acceptanceId, 'web');
    const checkoutRetry = await criarInscricaoChampionship(USER_ID, mockChampionship.id, acceptance.acceptanceId, 'web');
    expect(checkout).toMatchObject({ jaExistia: false, checkoutId: 'checkout_e2e_1', valor: 29.9 });
    expect(checkoutRetry).toMatchObject({ jaExistia: true, checkoutId: 'checkout_e2e_1' });
    expect(AsaasClient.criarCheckoutHospedado).toHaveBeenCalledTimes(1);

    const paymentAt = '2026-09-05T12:00:00.000Z';
    const paid = await confirmarInscricaoChampionshipPorPagamento(
      'payment_e2e_1',
      29.9,
      'checkout_e2e_1',
      REGISTRATION_ID,
      paymentAt,
    );
    const duplicatePaid = await confirmarInscricaoChampionshipPorPagamento(
      'payment_e2e_1',
      29.9,
      'checkout_e2e_1',
      REGISTRATION_ID,
      paymentAt,
    );
    expect(paid).toMatchObject({ encontrada: true, jaEstavaPaga: false });
    expect(duplicatePaid).toMatchObject({ encontrada: true, jaEstavaPaga: true });
    expect(mockDb.store.get(`championship_registrations/${REGISTRATION_ID}`)).toMatchObject({
      status: 'paga', paymentStatus: 'PAID', asaasPaymentId: 'payment_e2e_1', editionId: mockChampionship.editionId,
    });

    const staleRiskEvent = await registrarEventoFinanceiroChampionship(
      'payment_e2e_1',
      'PAYMENT_CHARGEBACK_REQUESTED',
      'checkout_e2e_1',
      REGISTRATION_ID,
      29.9,
      '2026-09-05T11:59:00.000Z',
    );
    expect(staleRiskEvent).toMatchObject({ encontrada: true, ignoradoComoAntigo: true });
    expect(mockDb.store.get(`championship_registrations/${REGISTRATION_ID}`)).toMatchObject({ status: 'paga', paymentStatus: 'PAID' });

    mockDb.store.set('activity_competition_entries/entry-e2e-1', {
      contextType: 'paid_championship',
      contextId: mockChampionship.id,
      editionId: mockChampionship.editionId,
      activityId: 'activity-e2e-1',
      reviewStatus: 'approved',
      userId: USER_ID,
    });
    mockDb.store.set('championship_scores/score-e2e-1', {
      championshipId: mockChampionship.id,
      editionId: mockChampionship.editionId,
      activityId: 'activity-e2e-1',
      userId: USER_ID,
      userName: 'Atleta E2E',
      userGymName: 'Academia E2E',
      validationStatus: 'VALIDATED',
      score: 100,
      metrics: { durationMinutes: 45 },
      createdAt: '2026-09-06T10:00:00.000Z',
    });

    const settlement = await finalizePaidChampionship(mockChampionship.id, new Date('2026-09-12T12:00:00.000Z'));
    expect(settlement).toMatchObject({ status: 'FINALIZED', totalPaid: 500 });
    expect(settlement.winnerAssignments).toHaveLength(1);
    expect(settlement.winnerAssignments[0]).toMatchObject({ userId: USER_ID, rank: 1, amount: 500 });
    expect(mockDb.store.get(`wallets/${USER_ID}`)).toMatchObject({ redeemableBalance: 500, blockedBalance: 0, totalBalance: 500 });

    const withdrawal = await WithdrawalEngine.requestWithdrawal({
      userId: USER_ID,
      amount: 100,
      pixKey: 'e2e@example.com',
      pixKeyType: 'email',
      requestId: 'happyflow01',
    });
    expect(withdrawal.status).toBe('pending');
    expect(mockDb.store.get(`wallets/${USER_ID}`)).toMatchObject({ redeemableBalance: 400, blockedBalance: 100 });

    const paidWithdrawal = await WithdrawalEngine.processPayment(withdrawal.id, 'admin-e2e');
    expect(paidWithdrawal.status).toBe('paid');
    expect(AsaasClient.transferPix).toHaveBeenCalledTimes(1);
    expect(mockDb.store.get(`wallets/${USER_ID}`)).toMatchObject({ redeemableBalance: 400, blockedBalance: 0, totalBalance: 400 });

    const refund = await registrarEventoFinanceiroChampionship(
      'payment_e2e_1',
      'PAYMENT_REFUNDED',
      'checkout_e2e_1',
      REGISTRATION_ID,
      29.9,
      '2026-09-13T12:00:00.000Z',
    );
    expect(refund).toMatchObject({ encontrada: true, status: 'reembolsada', event: 'PAYMENT_REFUNDED' });
    expect(mockDb.store.get(`championship_registrations/${REGISTRATION_ID}`)).toMatchObject({ status: 'reembolsada', paymentStatus: 'REFUNDED' });

    await expect(WithdrawalEngine.requestWithdrawal({
      userId: USER_ID,
      amount: 50,
      pixKey: 'e2e@example.com',
      pixKeyType: 'email',
      requestId: 'blocked002',
    })).rejects.toThrow(/Saque bloqueado: prêmio da edição/);
    expect(AsaasClient.transferPix).toHaveBeenCalledTimes(1);
    expect(mockDb.store.get(`wallets/${USER_ID}`)).toMatchObject({ redeemableBalance: 400, blockedBalance: 0 });
  });
});