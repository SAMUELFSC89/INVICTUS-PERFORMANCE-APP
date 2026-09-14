import { hasTrustedCompetitionEvidence, readCompetitionEvidenceMetrics } from '../_lib/competition-evidence';

const trustedMetrics = {
  activityType: 'cardio' as const,
  cardioType: 'corrida',
  isIndoorCardio: false,
  startTime: '2026-09-14T10:00:00.000Z',
  endTime: '2026-09-14T10:30:00.000Z',
  durationMinutes: 30,
  distanceKm: 5,
  avgHeartRate: 155,
  maxHeartRate: 175,
  calories: 300,
};

describe('competition evidence provenance', () => {
  test('v2 untrusted wearable fails closed even if a metrics object exists', () => {
    const activity = {
      schemaVersion: 2,
      source: 'health_connect',
      competitionEvidenceStatus: 'untrusted_client_import',
      competitionEvidenceMetrics: trustedMetrics,
    };
    expect(hasTrustedCompetitionEvidence(activity)).toBe(true);
    expect(readCompetitionEvidenceMetrics(activity)).toBeNull();
  });

  test('v2 missing evidence fails closed', () => {
    const activity = { schemaVersion: 2, source: 'health_connect', type: 'cardio', avgHeartRate: 190 };
    expect(hasTrustedCompetitionEvidence(activity)).toBe(true);
    expect(readCompetitionEvidenceMetrics(activity)).toBeNull();
  });

  test('direct non-manual Strava is normalized as trusted server evidence', () => {
    const activity = {
      schemaVersion: 2,
      source: 'strava',
      sourceActivityId: '12345',
      stravaActivityId: '12345',
      manual: false,
      type: 'cardio',
      cardioType: 'corrida',
      isIndoorCardio: false,
      startTime: '2026-09-14T10:00:00.000Z',
      endTime: '2026-09-14T10:30:00.000Z',
      duration: 30,
      distance: 5,
      avgHeartRate: 152,
      calories: 280,
    };
    expect(readCompetitionEvidenceMetrics(activity)).toMatchObject({
      activityType: 'cardio',
      cardioType: 'corrida',
      durationMinutes: 30,
      distanceKm: 5,
      avgHeartRate: 152,
      maxHeartRate: null,
      calories: 280,
    });
  });

  test('manual Strava cannot use raw heart rate as trusted evidence', () => {
    const activity = {
      schemaVersion: 2,
      source: 'strava',
      sourceActivityId: '12345',
      stravaActivityId: '12345',
      manual: true,
      type: 'cardio',
      cardioType: 'corrida',
      isIndoorCardio: false,
      startTime: '2026-09-14T10:00:00.000Z',
      endTime: '2026-09-14T10:30:00.000Z',
      duration: 30,
      avgHeartRate: 180,
    };
    expect(readCompetitionEvidenceMetrics(activity)).toBeNull();
  });

  test('explicit trusted snapshot remains accepted', () => {
    expect(readCompetitionEvidenceMetrics({
      schemaVersion: 2,
      competitionEvidenceStatus: 'trusted_server_source',
      competitionEvidenceMetrics: trustedMetrics,
    })).toEqual(trustedMetrics);
  });
});
