import { sanitizeWorkoutHealthRecord } from '../_lib/workout-health-record';

const now = Date.parse('2026-09-07T12:00:00.000Z');
function record(actualRir: unknown, status = 'completed') {
  return {
    version: 1,
    sessionId: 'session-rir',
    startedAt: '2026-09-07T10:00:00.000Z',
    endedAt: '2026-09-07T11:00:00.000Z',
    sets: [{
      id: 'set-1', exerciseId: 'barbell_bench_press', exerciseName: 'Supino reto', equipment: 'barra e banco reto',
      startedAt: '2026-09-07T10:10:00.000Z', endedAt: '2026-09-07T10:10:30.000Z',
      status, timingSource: 'user_marked', reps: 12, loadKg: 70, actualRir
    }],
    heartRate: { status: 'unavailable', source: null, sourceKey: null, samples: [], fetchedAt: '2026-09-07T11:01:00.000Z', truncated: false }
  };
}

test('sanitizer preserves valid actual RIR as private set evidence', () => {
  const result = sanitizeWorkoutHealthRecord(record(2), now);
  expect(result.healthSession?.sets[0]).toMatchObject({ reps: 12, loadKg: 70, actualRir: 2 });
});

test.each([-1, 6, 1.5, '2'])('sanitizer never promotes invalid actual RIR %p', (actualRir) => {
  const result = sanitizeWorkoutHealthRecord(record(actualRir), now);
  expect(result.healthSession?.sets[0].actualRir).toBeNull();
  expect(result.healthSession?.integrity?.status).toBe('partial');
});

test('interrupted sets cannot retain RIR as completed effort evidence', () => {
  const result = sanitizeWorkoutHealthRecord(record(0, 'interrupted'), now);
  expect(result.healthSession?.sets[0]).toMatchObject({ status: 'interrupted', reps: null, loadKg: null, actualRir: null });
});