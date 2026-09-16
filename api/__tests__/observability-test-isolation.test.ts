const mockCollection = jest.fn(() => { throw new Error('Firestore must not be touched in test mode'); });

jest.mock('../_lib/common.js', () => ({ db: { collection: mockCollection } }));

import { incrementMetric, logEvent, memoryCache, triggerAlert } from '../_lib/observability.js';

describe('observability test isolation', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    memoryCache.flushAll();
    mockCollection.mockClear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  test('logging, metrics and alerts do not touch Firestore in test mode', async () => {
    await expect(logEvent({
      severity: 'INFO',
      category: 'admin_reviews',
      message: 'Admin review test event',
      userId: 'user-test',
    })).resolves.toMatch(/^log_/);

    await expect(incrementMetric('admin_reviews_count', 1)).resolves.toBeUndefined();
    await expect(triggerAlert(
      'admin_reviews',
      'WARNING',
      'Synthetic test alert',
      'user-test',
    )).resolves.toBeUndefined();

    expect(mockCollection).not.toHaveBeenCalled();
  });
});
