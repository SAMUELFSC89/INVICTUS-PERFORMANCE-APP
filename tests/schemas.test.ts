import { validateInput, RunActivitySchema, GymCheckInSchema } from '../api/_lib/schemas.js';

describe('Validation Schemas (Zod)', () => {
  test('validates valid run activity', () => {
    const validRun = {
      type: 'run',
      distance: 10,
      duration: 3600,
      avgPace: 360,
      source: 'app',
      timestamp: new Date()
    };

    const result = validateInput(RunActivitySchema, validRun);
    expect(result.success).toBe(true);
  });

  test('rejects run activity with negative distance', () => {
    const invalidRun = {
      type: 'run',
      distance: -5,
      duration: 3600,
      avgPace: 360,
      source: 'app',
      timestamp: new Date()
    };

    const result = validateInput(RunActivitySchema, invalidRun);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toBe('Validation failed');
    }
  });

  test('validates valid gym checkin', () => {
    const validGym = {
      type: 'gym',
      gymId: 'gym_001',
      duration: 3600,
      timestamp: new Date(),
      exercises: [
        { name: 'Supino', sets: 4, reps: 10, weight: 80 }
      ]
    };

    const result = validateInput(GymCheckInSchema, validGym);
    expect(result.success).toBe(true);
  });
});
