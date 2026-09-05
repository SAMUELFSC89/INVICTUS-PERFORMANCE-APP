import { MAX_WORKOUT_HEALTH_SETS, MAX_WORKOUT_HEART_RATE_SAMPLES, sanitizeWorkoutHealthRecord } from '../_lib/workout-health-record';
import type { WorkoutHealthRecord } from '../../src/core/health/workoutHealthTypes';

const now = Date.parse('2026-09-05T12:00:00Z');
function record(): WorkoutHealthRecord {
  return {
    version: 1, sessionId: 'session-A', startedAt: '2026-09-05T10:00:00.000Z', endedAt: '2026-09-05T11:00:00.000Z',
    sets: [{ id: 'set-1', exerciseId: 'squat', exerciseName: 'Agachamento', equipment: 'Barra', startedAt: '2026-09-05T10:01:00.000Z', endedAt: '2026-09-05T10:02:00.000Z', status: 'completed', timingSource: 'user_marked', reps: 8, loadKg: 50 }],
    heartRate: { status: 'available', source: 'apple_health', sourceKey: 'device-A', samples: [{ timestamp: '2026-09-05T10:01:20.000Z', bpm: 135 }], fetchedAt: '2026-09-05T11:01:00.000Z', truncated: false }
  };
}

test('roundtrip mantém somente observações e horários reais; não importa proprietário ou pontuação', () => {
  const input = { ...record(), ownerId: 'another-user', points: 100000, durationMins: 999, hidden: 'discard' };
  const result = sanitizeWorkoutHealthRecord(input, now);
  expect(result.healthSession).toEqual({ ...record(), integrity: { status: 'complete', discardedSets: 0, discardedHeartRateSamples: 0 } });
  expect(result.healthSessionStatus).toBe('available');
  expect(sanitizeWorkoutHealthRecord(result.healthSession, now)).toEqual(result);
  expect(input).toHaveProperty('ownerId', 'another-user');
});

test('ausência permanece ausência, sem fabricar registro', () => {
  expect(sanitizeWorkoutHealthRecord(undefined, now)).toEqual({});
});

test.each([null, {}, { ...record(), version: 2 }, { ...record(), sessionId: '' }, { ...record(), endedAt: '2026-09-06T11:00:00Z' }, { ...record(), startedAt: '2026-02-30T10:00:00Z' }, { ...record(), startedAt: '2026-09-05T10:00:00' }, { ...record(), endedAt: record().startedAt }])('envelope malformado não inventa horários nem lança erro (%#)', (input) => {
  const result = sanitizeWorkoutHealthRecord(input, now);
  expect(result.healthSession).toBeUndefined();
  expect(result.healthSessionStatus).toBe('unavailable');
  expect(result.healthSessionReason).toBeTruthy();
});

test('horários ISO com timezone são normalizados; duplicata idêntica de FC não multiplica evidência', () => {
  const input = record();
  input.heartRate.samples.push({ timestamp: '2026-09-05T07:01:20-03:00', bpm: 135 });
  const result = sanitizeWorkoutHealthRecord(input, now);
  expect(result.healthSession!.heartRate.samples).toHaveLength(1);
  expect(result.healthSessionStatus).toBe('available');
});

test('FC conflitante no mesmo instante é descartada, não escolhe máximo nem média fabricada', () => {
  const input = record();
  input.heartRate.samples.push({ timestamp: input.heartRate.samples[0].timestamp, bpm: 190 });
  const result = sanitizeWorkoutHealthRecord(input, now);
  expect(result.healthSession!.heartRate.samples).toEqual([]);
  expect(result.healthSession!.heartRate.status).toBe('unavailable');
  expect(result.healthSession!.integrity!.discardedHeartRateSamples).toBe(2);
});

test('datas fora do treino, FC não numérica e fontes não permitidas são rejeitadas', () => {
  const input = record();
  input.heartRate.samples.push({ timestamp: '2026-09-05T09:59:59Z', bpm: 140 }, { timestamp: '2026-09-05T11:00:01Z', bpm: 145 }, { timestamp: '2026-09-05T10:20:00Z', bpm: Number.NaN }, { timestamp: '2026-09-05T10:21:00Z', bpm: 500 });
  const result = sanitizeWorkoutHealthRecord(input, now);
  expect(result.healthSession!.heartRate.samples).toHaveLength(1);
  expect(result.healthSession!.heartRate.status).toBe('partial');
  expect(result.healthSession!.integrity!.discardedHeartRateSamples).toBe(4);
  const invalidSource = sanitizeWorkoutHealthRecord({ ...record(), heartRate: { ...record().heartRate, source: 'manual' } }, now);
  expect(invalidSource.healthSession!.heartRate.samples).toEqual([]);
  expect(invalidSource.healthSession!.heartRate.source).toBeNull();
});

test('ausência de fetchedAt invalida só FC; preserva séries sem preencher horário', () => {
  const input = { ...record(), heartRate: { ...record().heartRate, fetchedAt: undefined } };
  const result = sanitizeWorkoutHealthRecord(input, now);
  expect(result.healthSession!.sets).toEqual(record().sets);
  expect(result.healthSession!.heartRate).toMatchObject({ status: 'unavailable', fetchedAt: null, samples: [] });
});

test('repetições/carga ausentes ou inválidas ficam null, mesmo havendo valores planejados', () => {
  const set = record().sets[0];
  for (const overrides of [{ reps: undefined, loadKg: undefined }, { reps: '8', loadKg: Number.POSITIVE_INFINITY }, { reps: -1, loadKg: -10 }]) {
    const input = { ...record(), sets: [{ ...set, ...overrides, plannedReps: 12, plannedWeight: 90 }] };
    expect(sanitizeWorkoutHealthRecord(input, now).healthSession!.sets[0]).toMatchObject({ reps: null, loadKg: null });
  }
  expect(sanitizeWorkoutHealthRecord({ ...record(), sets: [{ ...set, reps: 1, loadKg: 0 }] }, now).healthSession!.sets[0]).toMatchObject({ reps: 1, loadKg: 0 });
});

test('séries sem fim, fora da sessão, com identidade inválida ou sobrepostas não atribuem FC a exercício', () => {
  const base = record().sets[0];
  const input = { ...record(), sets: [base,
    { ...base, id: 'overlap', startedAt: '2026-09-05T10:01:30Z', endedAt: '2026-09-05T10:02:10Z' },
    { ...base, id: 'unfinished', endedAt: undefined },
    { ...base, id: 'before', startedAt: '2026-09-05T09:59:00Z' },
    { ...base, id: 'missing-name', exerciseName: '' },
  ] };
  const result = sanitizeWorkoutHealthRecord(input, now);
  expect(result.healthSession!.sets).toEqual([]);
  expect(result.healthSession!.integrity).toMatchObject({ status: 'partial', discardedSets: 5 });
  expect(result.healthSession!.heartRate.samples).toHaveLength(1);
});

test('limites de séries e amostras são explícitos; re-sanitizar não promove registro parcial', () => {
  const input = record();
  input.sets = Array.from({ length: MAX_WORKOUT_HEALTH_SETS + 1 }, (_, index) => ({ ...input.sets[0], id: `set-${index}`, startedAt: new Date(Date.parse(input.startedAt) + index * 10000).toISOString(), endedAt: new Date(Date.parse(input.startedAt) + index * 10000 + 5000).toISOString() }));
  input.heartRate.samples = Array.from({ length: MAX_WORKOUT_HEART_RATE_SAMPLES + 3 }, (_, index) => ({ timestamp: new Date(Date.parse(input.startedAt) + index * 500).toISOString(), bpm: 130 }));
  const result = sanitizeWorkoutHealthRecord(input, now);
  expect(result.healthSession!.sets).toHaveLength(MAX_WORKOUT_HEALTH_SETS);
  expect(result.healthSession!.heartRate.samples).toHaveLength(MAX_WORKOUT_HEART_RATE_SAMPLES);
  expect(result.healthSession!.heartRate.truncated).toBe(true);
  expect(result.healthSession!.integrity).toEqual({ status: 'partial', discardedSets: 1, discardedHeartRateSamples: 3 });
  expect(sanitizeWorkoutHealthRecord(result.healthSession, now)).toEqual(result);
});

test('FC pendente é reconhecida sem afirmar leitura concluída', () => {
  const input = record();
  input.heartRate = { ...input.heartRate, status: 'pending', samples: [] };
  const result = sanitizeWorkoutHealthRecord(input, now);
  expect(result.healthSession!.heartRate.status).toBe('pending');
  expect(result.healthSessionStatus).toBe('partial');
  expect(result.healthSession!.sets).toEqual(input.sets);
});

test('série interrompida não preserva repetições ou carga como resultado concluído', () => {
  const input = record(); input.sets[0].status = 'interrupted';
  expect(sanitizeWorkoutHealthRecord(input, now).healthSession!.sets[0]).toMatchObject({ status: 'interrupted', reps: null, loadKg: null });
});

test('campos de status maliciosos em JSON não lançam erro nem validam observações', () => {
  const malicious = JSON.parse('{"toString":null,"valueOf":null}');
  const result = sanitizeWorkoutHealthRecord({ ...record(), sets: [{ ...record().sets[0], status: malicious }], heartRate: { ...record().heartRate, status: malicious } }, now);
  expect(result.healthSession!.sets).toEqual([]);
  expect(result.healthSession!.heartRate.status).toBe('unavailable');
});
