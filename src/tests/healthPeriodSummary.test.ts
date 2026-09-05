import { buildHealthPeriodSummary, HealthPeriodWorkoutInput } from '../core/health/healthPeriodSummary';
import { RawWorkoutSession } from '../core/performance/performanceEngine';

const now = Date.parse('2026-09-05T12:00:00Z');
const workout = (id: string, at: string, fields: Partial<HealthPeriodWorkoutInput> = {}): HealthPeriodWorkoutInput => ({
  id, timestamp: Date.parse(at), durationMinutes: 30, ...fields,
});

describe('health period summary', () => {
  test('includes health-only sessions and keeps the cards, charts and list on one population', () => {
    const sessions: RawWorkoutSession[] = [
      { ...workout('a', '2026-09-05T09:00:00Z', { caloriesBurned: 240 }), id: 'a', userId: 'owner', validationStatus: 'health_only' },
      { ...workout('b', '2026-09-04T09:00:00Z', { caloriesBurned: 160 }), id: 'b', userId: 'owner', validationStatus: 'approved' },
    ];
    const result = buildHealthPeriodSummary(sessions, now, 7, 'America/Sao_Paulo');
    expect(result.sessionCount).toBe(2);
    expect(result.activeMinutes).toBe(60);
    expect(result.caloriesBurned).toBe(400);
    expect(result.dailyCalories.reduce((sum, point) => sum + (point.value ?? 0), 0)).toBe(result.caloriesBurned);
    expect(result.latestWorkouts.map(item => item.id)).toEqual(['a', 'b']);
    expect(result.latestWorkouts[0].validationStatus).toBe('health_only');
  });

  test('uses local days including today and excludes earlier dates plus future timestamps', () => {
    const sessions = [
      workout('old', '2026-08-30T02:59:59Z'), // August 29 locally.
      workout('boundary', '2026-08-30T03:00:00Z'),
      workout('today', '2026-09-05T03:00:00Z'),
      workout('future-today', '2026-09-05T12:00:01Z'),
      workout('future-date', '2026-09-06T09:00:00Z'),
      workout('invalid', 'invalid'),
    ];
    const result = buildHealthPeriodSummary(sessions, now, 7, 'America/Sao_Paulo');
    expect(result.startDate).toBe('2026-08-30');
    expect(result.endDate).toBe('2026-09-05');
    expect(result.workouts.map(item => item.id)).toEqual(['boundary', 'today']);
    expect(result.dailyMinutes).toHaveLength(7);
    expect(result.dailyMinutes[0]).toMatchObject({ date: '2026-08-30', label: '30/08', value: 30 });
  });

  test('calendar dates remain continuous across a daylight-saving change', () => {
    const result = buildHealthPeriodSummary([
      workout('start', '2026-03-07T05:00:00Z'),
      workout('before-local-start', '2026-03-07T04:59:59Z'),
      workout('after-change', '2026-03-09T04:00:00Z'),
    ], Date.parse('2026-03-09T12:00:00Z'), 3, 'America/New_York');
    expect(result.workouts.map(item => item.id)).toEqual(['start', 'after-change']);
    expect(result.dailyMinutes.map(item => item.date)).toEqual(['2026-03-07', '2026-03-08', '2026-03-09']);
    expect(result.dailyMinutes[1].value).toBeNull();
  });

  test('deduplicates IDs without mutating input and leaves distinct id-less sessions intact', () => {
    const latest = workout('latest', '2026-09-05T09:00:00Z');
    const sessions = [latest, workout('older', '2026-09-03T09:00:00Z'), latest,
      workout('', '2026-09-04T09:00:00Z'), workout('', '2026-09-04T09:00:00Z')];
    const snapshot = sessions.map(item => item.id);
    const result = buildHealthPeriodSummary(sessions, now, 7);
    expect(result.sessionCount).toBe(4);
    expect(result.activeDays).toBe(3);
    expect(result.firstAt).toBe(Date.parse('2026-09-03T09:00:00Z'));
    expect(result.lastAt).toBe(latest.timestamp);
    expect(sessions.map(item => item.id)).toEqual(snapshot);
  });

  test('missing or invalid measurements remain missing, with independent coverage', () => {
    const result = buildHealthPeriodSummary([
      workout('observed', '2026-09-05T09:00:00Z', { caloriesBurned: 200, distanceKm: 5, avgHeartRate: 120, maxHeartRate: 170 }),
      workout('missing', '2026-09-05T08:00:00Z', { durationMinutes: 0, caloriesBurned: -5, distanceKm: Number.NaN, avgHeartRate: 0, maxHeartRate: Number.POSITIVE_INFINITY }),
      workout('only-duration', '2026-09-04T09:00:00Z', { durationMinutes: 45 }),
    ], now, 7);
    expect(result.sessionCount).toBe(3);
    expect(result.activeMinutes).toBe(75);
    expect(result.caloriesBurned).toBe(200);
    expect(result.distanceKm).toBe(5);
    expect(result.averageHeartRate).toBe(120);
    expect(result.coverage).toEqual({ durationSessions: 2, distanceSessions: 1, calorieSessions: 1, heartRateSessions: 1, maxHeartRateSessions: 1 });
    expect(result.dailyCalories.find(item => item.date === '2026-09-04')).toMatchObject({ value: null, sessions: 1, coveredSessions: 0 });
    expect(result.dailyCalories.find(item => item.date === '2026-09-05')).toMatchObject({ value: 200, sessions: 2, coveredSessions: 1 });
  });

  test('heart rate explicitly averages available session averages without weighting missing coverage', () => {
    const result = buildHealthPeriodSummary([
      workout('long', '2026-09-05T08:00:00Z', { durationMinutes: 120, avgHeartRate: 100, maxHeartRate: 160 }),
      workout('short', '2026-09-05T09:00:00Z', { durationMinutes: 20, avgHeartRate: 140, maxHeartRate: 175 }),
    ], now, 1);
    expect(result.averageHeartRate).toBe(120);
    expect(result.heartRateMethod).toBe('SESSION_MEAN');
    expect(result.maxHeartRate).toBe(175);
    expect(result.dailyHeartRate[0].value).toBe(120);
  });

  test('normalizes known modality aliases without conflating treadmill and outdoor activity', () => {
    const result = buildHealthPeriodSummary([
      workout('a', '2026-09-05T09:00:00Z', { workoutType: 'strength_training' }),
      workout('b', '2026-09-04T09:00:00Z', { workoutType: 'musculação' }),
      workout('c', '2026-09-03T09:00:00Z', { workoutType: 'cardio', cardioType: 'treadmill' }),
      workout('d', '2026-09-02T09:00:00Z', { workoutType: 'corrida' }),
    ], now, 7);
    expect(result.groups).toEqual([
      { type: 'strength', label: 'Força', sessions: 2, minutes: 60 },
      { type: 'running', label: 'Corrida ao ar livre', sessions: 1, minutes: 30 },
      { type: 'treadmill', label: 'Esteira', sessions: 1, minutes: 30 },
    ]);
  });

  test('empty and partial history never imply complete coverage or measured zero values', () => {
    const result = buildHealthPeriodSummary([], now, 30, 'invalid-zone', true);
    expect(result.timeZone).toBe('UTC');
    expect(result.partial).toBe(true);
    expect(result.sessionCount).toBe(0);
    expect(result.activeDays).toBe(0);
    expect(result.activeMinutes).toBeNull();
    expect(result.caloriesBurned).toBeNull();
    expect(result.distanceKm).toBeNull();
    expect(result.averageHeartRate).toBeNull();
    expect(result.maxHeartRate).toBeNull();
    expect(result.firstAt).toBeNull();
    expect(result.lastAt).toBeNull();
    expect(result.dailyMinutes.every(item => item.value === null)).toBe(true);
  });

  test('latest six sessions are chosen by timestamp rather than the input order', () => {
    const sessions = Array.from({ length: 9 }, (_, index) => workout(`id-${index}`, `2026-09-05T${String(index + 1).padStart(2, '0')}:00:00Z`));
    const result = buildHealthPeriodSummary([...sessions].reverse(), now, 7);
    expect(result.latestWorkouts.map(item => item.id)).toEqual(['id-8', 'id-7', 'id-6', 'id-5', 'id-4', 'id-3']);
  });
});
