import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CHAMPIONSHIPS, matchActiveChampionshipsForActivity } from '../_lib/championship-catalog';

function fakeRunningCamp(allowedCardioTypes?: string[]) {
  return {
    id: 'cardio-camp-running-test',
    editionId: 'cardio-camp-running-test_ed_stress',
    type: 'run_elite_corrida' as const,
    title: 'Cardio Camp Corrida',
    edition: 'stress',
    subtitle: 'stress',
    description: 'stress',
    categoryLabel: 'Corrida',
    accentColor: 'teal' as const,
    durationDays: 30,
    startAt: '2026-09-01T00:00:00.000Z',
    endAt: '2026-09-30T23:59:59.999Z',
    registrationPrice: 29.9,
    participantCount: 0,
    grossRevenue: 0,
    netEligibleRevenue: 0,
    prizePool: 0,
    prizeDistribution: [],
    status: 'active' as const,
    regulationVersion: 'test-v1',
    regulationHash: 'test-hash',
    antiFraudProfile: {
      requireContinuousGPS: true,
      ...(allowedCardioTypes ? { allowedCardioTypes } : {}),
    },
  };
}

describe('Cardio Camp — modalidade congelada no regulamento', () => {
  afterEach(() => {
    CHAMPIONSHIPS.length = 0;
  });

  test('Camp de corrida aceita running e não aceita bike declarada', () => {
    CHAMPIONSHIPS.length = 0;
    CHAMPIONSHIPS.push(fakeRunningCamp(['running']));

    const when = new Date('2026-09-12T12:00:00.000Z');
    expect(matchActiveChampionshipsForActivity({
      activityType: 'cardio',
      cardioType: 'running',
      isIndoorCardio: false,
      when,
    }).map((item) => item.id)).toEqual(['cardio-camp-running-test']);

    expect(matchActiveChampionshipsForActivity({
      activityType: 'cardio',
      cardioType: 'bike',
      isIndoorCardio: false,
      when,
    })).toEqual([]);
  });

  test('Camp de cardio sem allowlist de modalidade falha fechado', () => {
    CHAMPIONSHIPS.length = 0;
    CHAMPIONSHIPS.push(fakeRunningCamp());

    expect(matchActiveChampionshipsForActivity({
      activityType: 'cardio',
      cardioType: 'running',
      isIndoorCardio: false,
      when: new Date('2026-09-12T12:00:00.000Z'),
    })).toEqual([]);
  });

  test('policy server-side repassa cardioType ao matcher e congela allowlist no contexto', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'api/_lib/activity-competition-policy.ts'),
      'utf8',
    );
    expect(source).toContain('cardioType: input.cardioType');
    expect(source).toContain('allowedCardioTypes: championship.antiFraudProfile?.allowedCardioTypes');
    expect(source).toContain('allowedCardioTypes: context.allowedCardioTypes || null');
  });
});
