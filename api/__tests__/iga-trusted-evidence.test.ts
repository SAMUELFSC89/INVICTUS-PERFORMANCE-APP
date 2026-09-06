let mockDb: any;

jest.mock('../_lib/common', () => ({
  get db() { return mockDb; },
}));
jest.mock('../../src/core/iga/index', () => ({
  calculateWeeklyIGA: jest.fn((sessions: any[]) => ({
    igaRanking: sessions.length ? 50 : 0,
    frequency: sessions.length,
    topSessions: sessions,
  })),
}));
jest.mock('../_lib/season-prize-engine', () => ({
  getOrInitCurrentSeasonWindow: jest.fn(async () => ({
    seasonId: 'season-a',
    startDate: new Date('2026-08-01T00:00:00.000Z'),
    endDate: new Date('2026-10-01T00:00:00.000Z'),
  })),
}));

import { calculateWeeklyIGA } from '../../src/core/iga/index';
import { recalculateAllUserScores } from '../_lib/igaService';

function createDb() {
  const enrollmentStart = '2026-08-01T00:00:00.000Z';
  const epochId = `user-a:${Date.parse(enrollmentStart)}`;
  const values: Record<string, Record<string, any>> = {
    'users/user-a': { age: 30, weight: 70 },
    'gym_ranking_enrollments/user-a': {
      enrolled: true, gymId: 'gym-a', enrolledAt: enrollmentStart,
    },
  };
  const workout = {
    schemaVersion: 2,
    userId: 'user-a', type: 'cardio', status: 'completed', validationStatus: 'validated',
    startTime: '2026-09-05T08:00:00.000Z', duration: 90, avgHeartRate: 240, calories: 9999,
    competitionReviewStatus: 'approved', isScoringEligible: true,
    competitionEvidenceStatus: 'trusted_server_source',
    // api/_lib/competition-evidence.ts::readCompetitionEvidenceMetrics() e um
    // leitor "fail-closed": se QUALQUER campo obrigatorio do snapshot faltar
    // ou for invalido, ele devolve null -- e fetchAllSessionsSince() em
    // igaService.ts entao DESCARTA a sessao inteira (nunca cai de volta pras
    // metricas nao confiaveis do wearable). O fixture precisa dos mesmos
    // campos que um snapshot real de evidencia confiavel teria.
    competitionEvidenceMetrics: {
      activityType: 'cardio', cardioType: 'running', isIndoorCardio: false,
      startTime: '2026-09-05T09:00:00.000Z', endTime: '2026-09-05T09:30:00.000Z',
      durationMinutes: 30, avgHeartRate: 140, calories: 300,
    },
    competitionContexts: [{ type: 'gym_ranking', id: 'gym-a', epochId }],
  };
  const snap = (value: any) => ({ exists: value !== undefined, data: () => value });
  return {
    collection: (name: string) => ({
      doc: (id: string) => ({
        get: async () => snap(values[`${name}/${id}`]),
        set: async (value: Record<string, any>, options?: { merge?: boolean }) => {
          const key = `${name}/${id}`;
          values[key] = options?.merge ? { ...(values[key] || {}), ...value } : value;
        },
      }),
      where: () => ({
        get: async () => ({
          forEach: (callback: (doc: any) => void) => {
            if (name === 'workouts') callback({ id: 'wearable-a', data: () => workout });
          },
        }),
      }),
    }),
  };
}

test('IGA ignora métricas pessoais do wearable após promoção confiável', async () => {
  jest.useFakeTimers().setSystemTime(new Date('2026-09-06T12:00:00.000Z'));
  mockDb = createDb();
  try {
    await recalculateAllUserScores('user-a');
    const calls = (calculateWeeklyIGA as jest.Mock).mock.calls
      .map(([sessions]) => sessions as any[]);
    const promoted = calls.flat().find(session => session?.id === 'wearable-a');
    expect(promoted).toMatchObject({
      type: 'cardio', durationMinutes: 30, avgHeartRate: 140, caloriesInformed: 300,
      date: '2026-09-05T09:00:00.000Z',
    });
  } finally {
    jest.useRealTimers();
  }
});
