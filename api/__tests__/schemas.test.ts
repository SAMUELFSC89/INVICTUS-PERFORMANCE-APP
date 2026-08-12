import { describe, it, expect } from '@jest/globals';
import { RunActivitySchema, GymCheckInSchema, validateInput } from '../_lib/schemas';

describe('RunActivitySchema', () => {
  it('should accept valid run activity', () => {
    const valid = {
      type: 'run',
      distance: 10,
      duration: 3600,
      avgPace: 360,
      source: 'app',
      timestamp: new Date().toISOString()
    };
    expect(() => RunActivitySchema.parse(valid)).not.toThrow();
  });

  it('should reject negative distance', () => {
    const invalid = {
      type: 'run',
      distance: -5,
      duration: 3600,
      avgPace: 360,
      source: 'app',
      timestamp: new Date().toISOString()
    };
    expect(() => RunActivitySchema.parse(invalid)).toThrow();
  });

  it('should reject duration > 4 hours', () => {
    const invalid = {
      type: 'run',
      distance: 10,
      duration: 20000,
      avgPace: 360,
      source: 'app',
      timestamp: new Date().toISOString()
    };
    expect(() => RunActivitySchema.parse(invalid)).toThrow();
  });

  it('should accept optional fields', () => {
    const valid = {
      type: 'run',
      distance: 5,
      duration: 1800,
      avgPace: 360,
      source: 'app',
      timestamp: new Date().toISOString(),
      notes: 'Morning run'
    };
    expect(() => RunActivitySchema.parse(valid)).not.toThrow();
  });
});

describe('GymCheckInSchema', () => {
  it('should accept valid gym checkin', () => {
    const valid = {
      type: 'gym',
      gymId: 'gym-123',
      duration: 3600,
      timestamp: new Date().toISOString(),
      exercises: [
        { name: 'bench press', sets: 3, reps: 10, weight: 80 }
      ]
    };
    expect(() => GymCheckInSchema.parse(valid)).not.toThrow();
  });

  it('should reject without exercises', () => {
    const invalid = {
      type: 'gym',
      gymId: 'gym-123',
      duration: 3600,
      timestamp: new Date().toISOString(),
      exercises: []
    };
    expect(() => GymCheckInSchema.parse(invalid)).toThrow();
  });
});

describe('validateInput', () => {
  it('should return success for valid data', () => {
    const valid = {
      type: 'run',
      distance: 10,
      duration: 3600,
      avgPace: 360,
      source: 'app',
      timestamp: new Date().toISOString()
    };
    const result = validateInput(RunActivitySchema, valid);
    expect(result.success).toBe(true);
  });

  it('should return error details for invalid data', () => {
    const invalid = {
      type: 'run',
      distance: -5,
      duration: 3600,
      avgPace: 360,
      source: 'app',
      timestamp: new Date().toISOString()
    };
    const result = validateInput(RunActivitySchema, invalid);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.details.length).toBeGreaterThan(0);
      expect(result.error.details[0].path).toContain('distance');
    }
  });
});
