import { describe, it, expect } from '@jest/globals';
import { initSentry, captureException, captureMessage } from '../_lib/sentry';

describe('Sentry APM Module', () => {
  it('should initialize Sentry without crashing', () => {
    expect(() => initSentry()).not.toThrow();
  });

  it('should capture exceptions safely', () => {
    const error = new Error('Test Sentry APM error');
    expect(() => captureException(error, { userId: 'user-test-123' })).not.toThrow();
  });

  it('should capture messages safely', () => {
    expect(() => captureMessage('Test message', 'info', { key: 'value' })).not.toThrow();
  });
});
