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
    startDate: new Date('2026-08-01T03:00:00.000Z'),
    endDate: new Date('2026-10-01T03:00:00.000Z'),
  })),
}));

import { calculateWeeklyIGA } from '../../src/core/iga/index';
import { recalculateAllUserScores } from '../_lib/igaService';

function createDb() {
  const enrollmentStart = '2026-08-01T03:00:00.000Z';
  const values: Record<string, Record<string, any>> = {
    'users/user-a': { age: 30, weight: 70 },
    'gym_ranking_enrollments/user-a': {
      enrolled: true,
      gymId: 'gym-a',
      enrolledAt: enrollmentStart,
      accepted: true,
      consentType: 'competitive_hr_measurement_acknowledgement',
      competitionId: 'gym_ranking',
      competitionRulesVersion: 'gym-ranking-v2-hr',
      hrAcknowledgementVersion: 'competitive-hr-v1',
    },
  };

  // Documento legado: homologado antes do contrato schema-v2, mas sem qualquer
  // snapshot/atestado de proveniência de FC. A duração/frequência histórica pode
  // continuar existindo; o BPM bruto nunca deve aumentar a intensidade do IGA.
  const legacyWorkout = {
    userId: 'user-a',
    type: 'cardio',
    status: 'completed',
    validationStatus: 'validated',
    startTime: '2026-09-05T12:00:00.000Z',
    duration: 30,
    avgHeartRate: 235,
    calories: 500,
    isScoringEligible: true,
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
            if (name === 'workouts') callback({ id: 'legacy-cardio-a', data: () => legacyWorkout });
          },
        }),
      }),
    }),
  };
}

test('IGA zera FC bruta de atividade legada sem proveniência competitiva confiável', async () => {
  jest.useFakeTimers().setSystemTime(new Date('2026-09-06T15:00:00.000Z'));
  mockDb = createDb();
  try {
    await recalculateAllUserScores('user-a');
    const sessions = (calculateWeeklyIGA as jest.Mock).mock.calls
      .flatMap(([items]) => items as any[]);
    const legacy = sessions.find(session => session?.id === 'legacy-cardio-a');
    expect(legacy).toMatchObject({
      type: 'cardio',
      durationMinutes: 30,
      avgHeartRate: 0,
      caloriesInformed: 500,
      isValid: true,
    });
    expect(legacy.avgHeartRate).not.toBe(235);
  } finally {
    jest.useRealTimers();
  }
});
