import { buildWorkoutFeedback, WORKOUT_FEEDBACK_RULES } from '../core/health/workoutFeedback';
import type { RecordedExerciseSet, WorkoutHealthRecord } from '../core/health/workoutHealthTypes';

const NOW = Date.parse('2026-09-05T12:00:00Z');
const time = (day: number, second: number) => new Date(Date.UTC(2026, 8, day, 10, 0, second)).toISOString();
function set(day = 4, overrides: Partial<RecordedExerciseSet> = {}): RecordedExerciseSet {
  return { id: 's1', exerciseId: 'squat', exerciseName: 'Agachamento', equipment: 'barbell', startedAt: time(day, 10), endedAt: time(day, 70), status: 'completed', timingSource: 'user_marked', reps: 10, loadKg: 40, ...overrides };
}
function record(day = 4, bpm = 140): WorkoutHealthRecord {
  return { version: 1, sessionId: `session-${day}`, startedAt: time(day, 0), endedAt: time(day, 120), sets: [set(day)], heartRate: { status: 'available', source: 'apple_health', sourceKey: 'device-1', samples: Array.from({ length: 25 }, (_, index) => ({ timestamp: time(day, index * 5), bpm })), fetchedAt: time(day, 121), truncated: false } };
}
const observations = (value: ReturnType<typeof buildWorkoutFeedback>) => value.insights.filter(item => item.id.startsWith('heart-rate:'));
const achievements = (value: ReturnType<typeof buildWorkoutFeedback>) => value.insights.filter(item => item.id.startsWith('achievement:'));
const baseline = (value: ReturnType<typeof buildWorkoutFeedback>) => observations(value).map(item => item.evidence).join(' ').includes('mediana das médias');

describe('deterministic workout feedback evidence', () => {
  it('reports only actual readings in a precisely timed exercise interval', () => {
    const result = buildWorkoutFeedback(record(), [], NOW);
    expect(result.status).toBe('available');
    expect(result.session).toEqual({ averageBpm: 140, maxBpm: 140, sampleCount: 25, coveragePercent: 100 });
    expect(observations(result)).toHaveLength(1);
    expect(observations(result)[0].evidence).toContain('13 leituras entre 140–140 bpm');
    expect(observations(result)[0].evidence).toContain('60 s cronometrados (100%');
    expect(result.methodologyVersion).toBe(WORKOUT_FEEDBACK_RULES.version);
  });

  it('keeps absent measurements null, never zero', () => {
    const current = record(); current.heartRate.samples = [];
    const result = buildWorkoutFeedback(current, [], NOW);
    expect(result.session).toEqual({ averageBpm: null, maxBpm: null, sampleCount: 0, coveragePercent: 0 });
    expect(observations(result)).toHaveLength(0);
    expect(result.insights.some(item => item.kind === 'insufficient')).toBe(true);
  });

  it.each(['pending', 'partial', 'unavailable'] as const)('does not promote %s data into a reliable conclusion', status => {
    const current = record(); current.heartRate.status = status;
    const result = buildWorkoutFeedback(current, [], NOW);
    expect(result.session.averageBpm).toBeNull();
    expect(observations(result)).toHaveLength(0);
  });

  it('does not analyze a truncated source even when its remaining samples look dense', () => {
    const current = record(); current.heartRate.truncated = true;
    expect(observations(buildWorkoutFeedback(current, [], NOW))).toHaveLength(0);
  });

  it.each([
    ['interrupted', { status: 'interrupted' }],
    ['not manually timed', { timingSource: 'planned' }],
    ['before session', { startedAt: time(3, 0) }],
    ['after session', { endedAt: time(4, 140) }],
    ['negative interval', { startedAt: time(4, 80) }],
    ['missing explicit timezone', { startedAt: '2026-09-04T10:00:10' }],
    ['too short', { endedAt: time(4, 30) }],
  ])('does not attribute readings to a series that is %s', (_, override) => {
    const current = record(); current.sets = [set(4, override as Partial<RecordedExerciseSet>)];
    expect(observations(buildWorkoutFeedback(current, [], NOW))).toHaveLength(0);
  });

  it('does not accept an accidentally running series longer than five minutes', () => {
    const current = record(); current.endedAt = time(4, 400); current.sets[0].endedAt = time(4, 320);
    current.heartRate.samples = Array.from({ length: 81 }, (_, index) => ({ timestamp: time(4, index * 5), bpm: 140 }));
    const result = buildWorkoutFeedback(current, [], NOW);
    expect(observations(result)).toHaveLength(0);
    expect(result.insights.some(item => item.id === 'recorded-completion')).toBe(false);
  });

  it.each(['completed', 'interrupted'] as const)('rejects overlaps even if the other series is %s', status => {
    const current = record(); current.sets.push(set(4, { id: 's2', exerciseId: 'bench', exerciseName: 'Supino', status, startedAt: time(4, 60), endedAt: time(4, 110) }));
    expect(observations(buildWorkoutFeedback(current, [], NOW))).toHaveLength(0);
  });

  it('accepts sequential intervals with a touching boundary', () => {
    const current = record(); current.sets.push(set(4, { id: 's2', exerciseId: 'bench', exerciseName: 'Supino', startedAt: time(4, 70), endedAt: time(4, 110) }));
    expect(observations(buildWorkoutFeedback(current, [], NOW))).toHaveLength(2);
  });

  it('discards ambiguous duplicate series instead of double-counting completions', () => {
    const current = record(); current.sets.push({ ...current.sets[0] });
    const result = buildWorkoutFeedback(current, [], NOW);
    expect(observations(result)).toHaveLength(0);
    expect(result.insights.some(item => item.id === 'recorded-completion')).toBe(false);
  });

  it('deduplicates identical readings and excludes conflicting timestamps', () => {
    const current = record(); current.heartRate.samples.push({ ...current.heartRate.samples[0] }, { ...current.heartRate.samples[10], bpm: 200 });
    const result = buildWorkoutFeedback(current, [], NOW);
    expect(result.session.sampleCount).toBe(24);
    expect(result.session.maxBpm).toBe(140);
    expect(observations(result)[0].evidence).toContain('12 leituras');
  });

  it('does not inflate sparse coverage by repeating a single sample', () => {
    const current = record(); current.heartRate.samples = Array.from({ length: 100 }, () => ({ timestamp: time(4, 30), bpm: 140 }));
    const result = buildWorkoutFeedback(current, [], NOW);
    expect(result.session.sampleCount).toBe(1);
    expect(result.session.averageBpm).toBeNull();
    expect(observations(result)).toHaveLength(0);
  });

  it('rejects gaps inside an exercise instead of connecting sparse readings', () => {
    const current = record(); current.heartRate.samples = current.heartRate.samples.filter(sample => !(Date.parse(sample.timestamp) > Date.parse(time(4, 30)) && Date.parse(sample.timestamp) < Date.parse(time(4, 55))));
    expect(observations(buildWorkoutFeedback(current, [], NOW))).toHaveLength(0);
  });

  it('rejects an uncovered edge, even with many samples in the middle', () => {
    const current = record(); current.sets[0].endedAt = time(4, 110);
    current.heartRate.samples = current.heartRate.samples.filter(sample => Date.parse(sample.timestamp) >= Date.parse(time(4, 30)));
    expect(observations(buildWorkoutFeedback(current, [], NOW))).toHaveLength(0);
  });

  it('ignores readings outside the session, invalid units/types and technical range', () => {
    const current = record(); current.heartRate.samples.push({ timestamp: time(3, 0), bpm: 220 }, { timestamp: time(4, 125), bpm: 220 }, { timestamp: time(4, 12), bpm: NaN }, { timestamp: time(4, 13), bpm: 300 }, { timestamp: time(4, 14), bpm: '150' as unknown as number });
    expect(buildWorkoutFeedback(current, [], NOW).session).toEqual({ averageBpm: 140, maxBpm: 140, sampleCount: 25, coveragePercent: 100 });
  });

  it('will not analyze a future or timezone-ambiguous session', () => {
    const future = record(6), ambiguous = record(); ambiguous.startedAt = '2026-09-04T10:00:00';
    expect(buildWorkoutFeedback(future, [], NOW).insights[0].id).toBe('invalid-session');
    expect(buildWorkoutFeedback(ambiguous, [], NOW).session.averageBpm).toBeNull();
  });

  it('describes a measured change between windows without calling it significant or beneficial', () => {
    const current = record(); current.heartRate.samples = current.heartRate.samples.map((sample, index) => ({ ...sample, bpm: 90 + index * 5 }));
    const result = observations(buildWorkoutFeedback(current, [], NOW))[0];
    expect(result.evidence).toContain('terço inicial: 107,5 bpm; no final: 152,5 bpm (+45 bpm)');
    expect(result.title).toContain('Variação registrada');
    expect(result.evidence).not.toMatch(/significativ|condicionamento|segur|evolu/i);
  });

  it('does not describe an increase from isolated endpoint readings', () => {
    const current = record(); current.heartRate.samples = [0, 15, 30, 45, 60, 75, 90, 105, 120].map(second => ({ timestamp: time(4, second), bpm: 100 + second }));
    current.sets[0].startedAt = time(4, 15); current.sets[0].endedAt = time(4, 75);
    const result = observations(buildWorkoutFeedback(current, [], NOW))[0];
    expect(result).toBeDefined();
    expect(result.evidence).not.toContain('terço inicial');
  });
});

describe('compatible prior evidence, without invented baselines or achievements', () => {
  it('compares FC to a median only with three distinct previous days and an identical known source', () => {
    const result = buildWorkoutFeedback(record(), [record(3, 100), record(2, 110), record(1, 120)], NOW);
    expect(observations(result)[0].evidence).toContain('mediana das médias em 3 sessões anteriores');
    expect(observations(result)[0].evidence).toContain('110 bpm (+30 bpm)');
  });

  it('still shows readings with unknown source identity, but never builds a comparison', () => {
    const current = record(); current.heartRate.sourceKey = null;
    const result = buildWorkoutFeedback(current, [record(3), record(2), record(1)], NOW);
    expect(observations(result)).toHaveLength(1);
    expect(baseline(result)).toBe(false);
    expect(result.limitations.join(' ')).toContain('identidade do sensor');
  });

  it.each(['source', 'sourceKey', 'equipment', 'loadKg', 'reps', 'exerciseId', 'duration'] as const)('does not merge incompatible history: %s', field => {
    const past = record(1);
    if (field === 'source') past.heartRate.source = 'health_connect';
    else if (field === 'sourceKey') past.heartRate.sourceKey = 'device-2';
    else if (field === 'duration') past.sets[0].endedAt = time(1, 85);
    else if (field === 'equipment') past.sets[0].equipment = 'smith';
    else if (field === 'exerciseId') past.sets[0].exerciseId = 'other-squat';
    else past.sets[0][field] = 12;
    expect(baseline(buildWorkoutFeedback(record(), [record(3), record(2), past], NOW))).toBe(false);
  });

  it('does not count three sessions on a single day as three independent days', () => {
    const history = [record(3), record(3), record(3)].map((value, index) => ({ ...value, sessionId: `same-day-${index}` }));
    expect(baseline(buildWorkoutFeedback(record(), history, NOW))).toBe(false);
  });

  it('retains interval facts but suppresses comparisons after some sets were discarded', () => {
    const current = record(); current.sets[0].reps = 12;
    current.integrity = { status: 'partial', discardedSets: 1, discardedHeartRateSamples: 0 };
    const history = [record(3), record(2), record(1)]; history.forEach(past => { past.sets[0].reps = 12; });
    const result = buildWorkoutFeedback(current, history, NOW);
    expect(observations(result)).toHaveLength(1);
    expect(achievements(result)).toHaveLength(0);
    expect(baseline(result)).toBe(false);
    expect(result.limitations.join(' ')).toContain('Parte das séries');
    expect(result.status).toBe('partial');
  });

  it('does not use incomplete history as a comparison baseline', () => {
    const past = record(1); past.integrity = { status: 'partial', discardedSets: 1, discardedHeartRateSamples: 0 };
    expect(baseline(buildWorkoutFeedback(record(), [record(3), record(2), past], NOW))).toBe(false);
  });

  it('does not hide discarded FC behind an available status', () => {
    const current = record(); current.integrity = { status: 'partial', discardedSets: 0, discardedHeartRateSamples: 1 };
    const result = buildWorkoutFeedback(current, [], NOW);
    expect(observations(result)).toHaveLength(0);
    expect(result.session.averageBpm).toBeNull();
  });

  it('rejects duplicate, future and current-session histories', () => {
    const history = [record(3), record(3), record(2), record(5), record()];
    expect(baseline(buildWorkoutFeedback(record(), history, NOW))).toBe(false);
  });

  it('excludes stale history older than ninety days', () => {
    const old = record(1); old.startedAt = '2026-01-01T10:00:00Z'; old.endedAt = '2026-01-01T10:02:00Z'; old.sets = [set(1, { startedAt: '2026-01-01T10:00:10Z', endedAt: '2026-01-01T10:01:10Z' })];
    old.heartRate.samples = old.heartRate.samples.map(sample => ({ ...sample, timestamp: sample.timestamp.replace('2026-09-01', '2026-01-01') }));
    expect(baseline(buildWorkoutFeedback(record(), [record(3), record(2), old], NOW))).toBe(false);
  });

  it('congratulates actual additional reps at the same stated load and equipment', () => {
    const current = record(); current.sets[0].reps = 12;
    const result = achievements(buildWorkoutFeedback(current, [record(3)], NOW));
    expect(result).toHaveLength(1);
    expect(result[0].evidence).toContain('12 repetições com carga informada de 40 kg');
    expect(result[0].evidence).toContain('contra 10 repetições');
    expect(result[0].meaning).toContain('não mede técnica');
  });

  it.each(['missing-reps', 'missing-load', 'different-load', 'different-equipment', 'unknown-equipment', 'no-improvement'] as const)('does not invent achievement for %s', condition => {
    const current = record(); current.sets[0].reps = 12;
    if (condition === 'missing-reps') current.sets[0].reps = null;
    if (condition === 'missing-load') current.sets[0].loadKg = null;
    if (condition === 'different-load') current.sets[0].loadKg = 30;
    if (condition === 'different-equipment') current.sets[0].equipment = 'smith';
    if (condition === 'unknown-equipment') current.sets[0].equipment = null;
    if (condition === 'no-improvement') current.sets[0].reps = 9;
    expect(achievements(buildWorkoutFeedback(current, [record(3)], NOW))).toHaveLength(0);
  });

  it('does not celebrate extra total reps obtained by adding more sets', () => {
    const current = record(); current.sets[0].reps = 12; current.sets.push(set(4, { id: 's2', startedAt: time(4, 75), endedAt: time(4, 110), reps: 12 }));
    expect(achievements(buildWorkoutFeedback(current, [record(3)], NOW))).toHaveLength(0);
  });

  it('does not skip the latest weaker evidence to cherry-pick an older achievement', () => {
    const current = record(); current.sets[0].reps = 12;
    const recent = record(3); recent.sets[0].reps = 15;
    expect(achievements(buildWorkoutFeedback(current, [record(2), recent], NOW))).toHaveLength(0);
    recent.sets[0].status = 'interrupted';
    expect(achievements(buildWorkoutFeedback(current, [record(2), recent], NOW))).toHaveLength(0);
    recent.sets[0].status = 'completed'; recent.sets[0].reps = 10;
    recent.integrity = { status: 'partial', discardedSets: 1, discardedHeartRateSamples: 0 };
    expect(achievements(buildWorkoutFeedback(current, [record(2), recent], NOW))).toHaveLength(0);
  });

  it('uses no planned values when actual results are missing', () => {
    const current = record(); current.sets[0].reps = null; current.sets[0].loadKg = null;
    Object.assign(current.sets[0], { plannedReps: 15, plannedLoadKg: 40 });
    expect(achievements(buildWorkoutFeedback(current, [record(3)], NOW))).toHaveLength(0);
  });

  it('keeps recorded completion distinct from measured performance', () => {
    const current = record(); current.heartRate.samples = []; current.sets[0].reps = null; current.sets[0].loadKg = null;
    const result = buildWorkoutFeedback(current, [], NOW);
    expect(result.insights.find(item => item.id === 'recorded-completion')?.evidence).toContain('marcou 1 série concluída');
    expect(result.status).toBe('insufficient');
  });

  it('caps feedback at four distinct prioritized insights without mutating caller data', () => {
    const current = record(); current.endedAt = time(4, 600);
    current.sets = Array.from({ length: 6 }, (_, index) => set(4, { id: `s${index}`, exerciseId: `exercise-${index}`, exerciseName: `Exercício ${index}`, startedAt: time(4, index * 90 + 10), endedAt: time(4, index * 90 + 70) }));
    current.heartRate.samples = Array.from({ length: 121 }, (_, index) => ({ timestamp: time(4, index * 5), bpm: 140 }));
    const before = JSON.stringify(current), result = buildWorkoutFeedback(current, [], NOW);
    expect(result.insights).toHaveLength(4);
    expect(JSON.stringify(current)).toBe(before);
    expect(result).toEqual(buildWorkoutFeedback(current, [], NOW));
  });
});
