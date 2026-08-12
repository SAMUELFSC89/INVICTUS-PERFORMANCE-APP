import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { CacheManager } from '../_lib/cache';
import redis from '../_lib/cache';

describe('CacheManager', () => {
  beforeAll(async () => {
    CacheManager.clearMemory();
  });

  afterAll(async () => {
    try {
      await redis.quit();
    } catch {
      // ignore
    }
  });

  it('should set and get values', async () => {
    const key = 'test:key';
    const value = { userId: '123', score: 50 };

    await CacheManager.set(key, value, 300);
    const cached = await CacheManager.get(key);

    expect(cached).toEqual(value);
  });

  it('should return null for missing keys', async () => {
    const cached = await CacheManager.get('nonexistent:key');
    expect(cached).toBeNull();
  });

  it('should delete keys', async () => {
    const key = 'test:delete';
    await CacheManager.set(key, { test: true }, 300);
    await CacheManager.delete(key);
    const cached = await CacheManager.get(key);
    expect(cached).toBeNull();
  });

  it('should handle getOrSet pattern', async () => {
    const key = 'test:getorset';
    let fetchCount = 0;

    const fetcher = async () => {
      fetchCount++;
      return { data: 'expensive operation' };
    };

    // Primeira chamada: deve buscar
    const result1 = await CacheManager.getOrSet(key, fetcher, 300);
    expect(fetchCount).toBe(1);

    // Segunda chamada: deve vir do cache
    const result2 = await CacheManager.getOrSet(key, fetcher, 300);
    expect(fetchCount).toBe(1); // Não chamou fetcher novamente
    expect(result1).toEqual(result2);
  });
});
