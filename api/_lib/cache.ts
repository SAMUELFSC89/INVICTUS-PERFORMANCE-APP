import Redis from 'ioredis';
import { logger } from './logger.js';

const memoryStore = new Map<string, { value: unknown; expiresAt: number }>();

const redisHost = process.env.REDIS_HOST || 'localhost';
const redisPort = parseInt(process.env.REDIS_PORT || '6379', 10);
const enableRedis = process.env.ENABLE_REDIS === 'true' || Boolean(process.env.REDIS_HOST);

export const redis = new Redis({
  host: redisHost,
  port: redisPort,
  maxRetriesPerRequest: 1,
  retryStrategy: (times) => {
    // If Redis is not available, stop retrying after 2 attempts to avoid ECONNREFUSED loops
    if (times > 2) return null;
    return Math.min(times * 100, 1000);
  },
  enableReadyCheck: false,
  enableOfflineQueue: false,
  lazyConnect: true
});

let isRedisConnected = false;
let hasLoggedDisconnect = false;

redis.on('error', (err) => {
  isRedisConnected = false;
  if (!hasLoggedDisconnect) {
    hasLoggedDisconnect = true;
    logger.info({}, 'Redis server not detected. Using memory cache fallback.');
  }
});

redis.on('connect', () => {
  isRedisConnected = true;
  hasLoggedDisconnect = false;
  logger.info({}, 'Redis connected successfully.');
});

// Attempt background connection if Redis is explicitly enabled or configured
if (enableRedis) {
  redis.connect().then(() => {
    isRedisConnected = true;
  }).catch(() => {
    isRedisConnected = false;
  });
}

export class CacheManager {
  /**
   * Get value from cache
   */
  static async get<T>(key: string): Promise<T | null> {
    try {
      if (isRedisConnected) {
        const data = await redis.get(key);
        if (data) return JSON.parse(data) as T;
      }
    } catch (error) {
      logger.warn({ key, error: error instanceof Error ? error.message : error }, 'Redis get error, fallback to memory');
    }

    const item = memoryStore.get(key);
    if (!item) return null;
    if (Date.now() > item.expiresAt) {
      memoryStore.delete(key);
      return null;
    }
    return item.value as T;
  }

  /**
   * Set value in cache
   */
  static async set<T>(key: string, value: T, ttl: number = 300): Promise<boolean> {
    try {
      if (isRedisConnected) {
        await redis.setex(key, ttl, JSON.stringify(value));
      }
    } catch (error) {
      logger.warn({ key, error: error instanceof Error ? error.message : error }, 'Redis set error, using memory fallback');
    }

    memoryStore.set(key, {
      value,
      expiresAt: Date.now() + ttl * 1000
    });
    return true;
  }

  /**
   * Delete key from cache
   */
  static async delete(key: string): Promise<boolean> {
    try {
      if (isRedisConnected) {
        await redis.del(key);
      }
    } catch (error) {
      logger.warn({ key, error: error instanceof Error ? error.message : error }, 'Redis delete error');
    }
    memoryStore.delete(key);
    return true;
  }

  /**
   * Delete keys matching pattern
   */
  static async deletePattern(pattern: string): Promise<number> {
    let deletedCount = 0;
    try {
      if (isRedisConnected) {
        const keys = await redis.keys(pattern);
        if (keys.length > 0) {
          deletedCount = await redis.del(...keys);
        }
      }
    } catch (error) {
      logger.warn({ pattern, error: error instanceof Error ? error.message : error }, 'Redis delete pattern error');
    }

    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    for (const key of memoryStore.keys()) {
      if (regex.test(key)) {
        memoryStore.delete(key);
        deletedCount++;
      }
    }
    return deletedCount;
  }

  /**
   * Get or set pattern (cache-aside)
   */
  static async getOrSet<T>(
    key: string,
    fetcher: () => Promise<T>,
    ttl: number = 300
  ): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached) {
      logger.debug({ key }, 'Cache hit');
      return cached;
    }

    logger.debug({ key }, 'Cache miss, fetching from source');
    const data = await fetcher();
    await this.set(key, data, ttl);
    return data;
  }

  static clearMemory(): void {
    memoryStore.clear();
  }
}

export default redis;
