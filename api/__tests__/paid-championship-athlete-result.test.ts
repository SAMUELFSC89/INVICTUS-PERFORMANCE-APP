const mockVerifyAuth = jest.fn();
const mockGetChampionshipProgress = jest.fn();
const mockSettlementGet = jest.fn();

jest.mock('../_lib/common', () => ({
  verifyAuth: (...args: any[]) => mockVerifyAuth(...args),
  db: {
    collection: (name: string) => {
      if (name !== 'championship_settlements') throw new Error(`unexpected collection ${name}`);
      return { doc: () => ({ get: () => mockSettlementGet() }) };
    },
  },
}));

jest.mock('../_lib/championship-catalog', () => ({
  listChampionships: jest.fn(() => []),
  getChampionship: jest.fn(() => ({
    id: 'invictus_cardio_v1',
    title: 'Campeonato Invictus de Cardio',
    edition: 'Edição 1',
    endAt: '2026-10-01T03:00:00.000Z',
    settlementAt: '2026-10-03T03:00:00.000Z',
    durationDays: 30,
  })),
}));

jest.mock('../_lib/championship-inscription-service', () => ({
  registrarAceiteRegulamento: jest.fn(),
  confirmarInscricaoChampionshipPorCheckout: jest.fn(),
  confirmarInscricaoChampionshipPorPagamento: jest.fn(),
  encerrarCheckoutChampionship: jest.fn(),
  registrarEventoFinanceiroChampionship: jest.fn(),
  getUserRegistrations: jest.fn(() => []),
}));

jest.mock('../_lib/competitive-heart-rate-acknowledgement', () => ({
  recordCompetitiveHrAcknowledgement: jest.fn(),
}));

jest.mock('../_lib/championship-scoring-service', () => ({
  getChampionshipProgress: (...args: any[]) => mockGetChampionshipProgress(...args),
  getChampionshipLeaderboard: jest.fn(),
  getUserChampionshipActivities: jest.fn(),
}));

jest.mock('../_lib/presence-check-service', () => ({ criarPresenceCheck: jest.fn() }));

import { getChampionshipProgressHandler } from '../_handlers/championships';

function responseCapture() {
  const state: any = { statusCode: 200, body: undefined };
  return {
    state,
    res: {
      status(code: number) { state.statusCode = code; return this; },
      json(body: any) { state.body = body; return body; },
    },
  };
}

const settlement = {
  status: 'FINALIZED',
  finalizedAt: '2026-10-03T04:00:00.000Z',
  ranking: [
    { userId: 'refunded-leader', userName: 'Refunded', score: 100 },
    { userId: 'winner-b', userName: 'B', score: 99 },
    { userId: 'winner-c', userName: 'C', score: 98 },
    { userId: 'athlete-d', userName: 'D', score: 97 },
  ],
  winnerAssignments: [
    { rank: 1, userId: 'winner-b', userName: 'B', amount: 500 },
    { rank: 2, userId: 'winner-c', userName: 'C', amount: 300 },
  ],
};

describe('athlete-facing paid championship final result', () => {
  beforeEach(() => {
    mockGetChampionshipProgress.mockResolvedValue({
      totalScore: 0, totalTimeMinutes: 0, validSessionsCount: 0, currentRank: 0, totalParticipants: 0,
    });
    mockSettlementGet.mockResolvedValue({ exists: true, data: () => settlement });
  });

  test('candidate skipped by payout does not keep a duplicated final rank', async () => {
    mockVerifyAuth.mockResolvedValue({ uid: 'refunded-leader' });
    const { res, state } = responseCapture();
    await getChampionshipProgressHandler({ query: { championshipId: 'invictus_cardio_v1' } } as any, res as any);

    expect(state.statusCode).toBe(200);
    expect(state.body.settlementStatus).toBe('FINALIZED');
    expect(state.body.finalResult).toBeNull();
  });

  test('replacement winner receives the promoted rank and following athlete shifts consistently', async () => {
    mockVerifyAuth.mockResolvedValue({ uid: 'winner-b' });
    const winnerResponse = responseCapture();
    await getChampionshipProgressHandler({ query: { championshipId: 'invictus_cardio_v1' } } as any, winnerResponse.res as any);
    expect(winnerResponse.state.body.finalResult).toMatchObject({
      finalRank: 1,
      totalParticipants: 3,
      prizeWon: 500,
    });

    mockVerifyAuth.mockResolvedValue({ uid: 'athlete-d' });
    const athleteResponse = responseCapture();
    await getChampionshipProgressHandler({ query: { championshipId: 'invictus_cardio_v1' } } as any, athleteResponse.res as any);
    expect(athleteResponse.state.body.finalResult).toMatchObject({
      finalRank: 3,
      totalParticipants: 3,
      prizeWon: 0,
    });
  });
});
