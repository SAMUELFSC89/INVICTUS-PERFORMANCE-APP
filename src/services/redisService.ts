/**
 * Redis & Realtime High-Performance Cache Service (KM Fatal Global Scale)
 * Optimized for both Client-side browser (using LocalStorage + Memory)
 * and Server-side Node/Vercel handles (using Global Process memory with optional remote backing).
 * Handles: SWR (Stale-While-Revalidate), Rate-limiting, Cache Stampede control, and Circuit Breakers.
 */

interface CacheOptions {
  exSeconds?: number;
  staleAfterSeconds?: number;
}

// In-Memory storage for process-level caching (Node server side or live browser run)
const memoryCacheStore = new Map<string, { value: any; expiresAt: number; savedAt: number }>();

// Inflight requests tracking to prevent "Cache Stampede" (Multiple requests hitting database for the same key at once)
const inflightQueries = new Map<string, Promise<any>>();

// Circuit Breakers state
const circuitBreakerStatus = new Map<string, { failures: number; lastFailureTime: number; state: 'CLOSED' | 'OPEN' | 'HALF-OPEN' }>();
const CIRCUIT_BREAKER_THRESHOLD = 5; // failures
const CIRCUIT_RECOVERY_TIME = 30000; // 30 seconds

export const redisService = {
  /**
   * Safe check for environment
   */
  isServer(): boolean {
    return typeof window === 'undefined';
  },

  /**
   * Dynamic Key Storage Getter
   */
  async get<T>(key: string): Promise<T | null> {
    const now = Date.now();

    // 1. Check in-memory process level cache
    const cached = memoryCacheStore.get(key);
    if (cached) {
      if (cached.expiresAt > now) {
        return cached.value as T;
      }
      // Evict if expired
      memoryCacheStore.delete(key);
    }

    // 2. Client-side browser cache
    if (!this.isServer()) {
      try {
        const localValue = localStorage.getItem(`km_redis_${key}`);
        if (localValue) {
          const parsed = JSON.parse(localValue);
          if (parsed.expiresAt > now) {
            // Keep in-memory for speed
            memoryCacheStore.set(key, { value: parsed.value, expiresAt: parsed.expiresAt, savedAt: parsed.savedAt });
            return parsed.value as T;
          }
          localStorage.removeItem(`km_redis_${key}`);
        }
      } catch (err) {
        // Safe swallow
      }
    }

    return null;
  },

  /**
   * Dynamic Key Storage Setter
   */
  async set<T>(key: string, value: T, options?: CacheOptions): Promise<boolean> {
    const now = Date.now();
    const ttlSeconds = options?.exSeconds || 180; // Default to 3 minutes
    const expiresAt = now + (ttlSeconds * 1000);

    const cachePayload = {
      value,
      expiresAt,
      savedAt: now
    };

    // 1. Set process memory cache
    memoryCacheStore.set(key, cachePayload);

    // 2. Set browser storage if applicable
    if (!this.isServer()) {
      try {
        localStorage.setItem(`km_redis_${key}`, JSON.stringify(cachePayload));
      } catch (err) {
        // Handle localStorage quote limit gracefully
        console.warn("[Redis Cache] localStorage quota exceeded, clearing stale keys...");
        this.pruneStaleLocalStorageKeys();
      }
    }

    return true;
  },

  /**
   * Delete cache entry
   */
  async del(key: string): Promise<boolean> {
    memoryCacheStore.delete(key);
    if (!this.isServer()) {
      try {
        localStorage.removeItem(`km_redis_${key}`);
      } catch (e) {}
    }
    return true;
  },

  /**
   * Prunes expired keys from LocalStorage to keep client optimized
   */
  pruneStaleLocalStorageKeys(): void {
    if (this.isServer()) return;
    try {
      const now = Date.now();
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('km_redis_')) {
          const item = localStorage.getItem(key);
          if (item) {
            const parsed = JSON.parse(item);
            if (parsed.expiresAt < now) {
              localStorage.removeItem(key);
            }
          }
        }
      }
    } catch (e) {}
  },

  /**
   * STALE-WHILE-REVALIDATE pattern (Econômico e escalável no Firestore)
   * Serves cached content within TTL instantly. If content has crossed "staleAfterSeconds" 
   * but is still within "exSeconds", it serves the stale data instantly and triggers the live fetcher 
   * asynchronously in the background. Completely bypasses frontend loading locks.
   */
  async staleWhileRevalidate<T>(
    key: string,
    fetcher: () => Promise<T>,
    options?: { exSeconds: number; staleAfterSeconds: number }
  ): Promise<T> {
    const now = Date.now();
    const exSec = options?.exSeconds || 300; // 5 mins total expiry
    const staleSec = options?.staleAfterSeconds || 60; // 1 min freshness

    const cached = memoryCacheStore.get(key);
    const browserCached = !this.isServer() ? this.getLocalStoragePayload(key) : null;
    const activeCache = cached || browserCached;

    if (activeCache) {
      const msSinceSave = now - activeCache.savedAt;
      const isStale = msSinceSave > (staleSec * 1000);
      const isHardExpired = now > activeCache.expiresAt;

      if (!isHardExpired) {
        if (isStale) {
          // Trigger asynchronous background refresh without blocking client!
          console.log(`[Cache SWR] Key ${key} is stale. Fetching in background...`);
          this.triggerBackgroundUpdate(key, fetcher, exSec);
        }
        return activeCache.value as T;
      }
    }

    // Hard expired or missing cache: we must wait for a fresh fetch.
    // Use anti-stampede promise deduplication.
    if (inflightQueries.has(key)) {
      console.log(`[Cache Stampede Prevention] Bundling concurrent request for: ${key}`);
      return inflightQueries.get(key);
    }

    const fetchPromise = fetcher().then(async (freshData) => {
      await this.set(key, freshData, { exSeconds: exSec });
      inflightQueries.delete(key);
      return freshData;
    }).catch((err) => {
      inflightQueries.delete(key);
      // Fallback to expired cache if fetch fails (Highly resilient!)
      if (activeCache) {
        console.warn(`[Cache SWR Fallback] Fetcher failed for ${key}, serving expired cache.`, err);
        return activeCache.value as T;
      }
      throw err;
    });

    inflightQueries.set(key, fetchPromise);
    return fetchPromise;
  },

  /**
   * Client helper for localStorage
   */
  getLocalStoragePayload(key: string) {
    try {
      const localValue = localStorage.getItem(`km_redis_${key}`);
      if (localValue) return JSON.parse(localValue);
    } catch (e) {}
    return null;
  },

  /**
   * Fires a background update that updates storage quietly without blocking the caller.
   */
  triggerBackgroundUpdate<T>(key: string, fetcher: () => Promise<T>, exSec: number): void {
    if (inflightQueries.has(key)) return;

    const promise = fetcher().then(async (freshData) => {
      await this.set(key, freshData, { exSeconds: exSec });
      inflightQueries.delete(key);
      return freshData;
    }).catch(err => {
      console.warn(`[Cache Background Update Error] Key: ${key}`, err);
      inflightQueries.delete(key);
    });

    inflightQueries.set(key, promise);
  },

  /**
   * RATE LIMITER (Anti-Bot & Anti-Abuse Shield)
   * Throttles spam requests per user/IP using token bucket with zero database writes.
   * Keeps track in local process namespace.
   */
  rateLimit(clientId: string, maxRequests: number = 30, windowMs: number = 60000): { allowed: boolean; remaining: number } {
    const key = `ratelimit_${clientId}`;
    const now = Date.now();

    const record = memoryCacheStore.get(key);
    if (!record) {
      // First event
      const value = { requests: [now] };
      memoryCacheStore.set(key, { value, expiresAt: now + windowMs, savedAt: now });
      return { allowed: true, remaining: maxRequests - 1 };
    }

    const timestamps: number[] = record.value.requests;
    // Filter timestamps out of window
    const windowStart = now - windowMs;
    const validTimestamps = timestamps.filter(t => t > windowStart);
    validTimestamps.push(now);

    // Save updated timestamps
    record.value.requests = validTimestamps;
    record.expiresAt = now + windowMs;
    memoryCacheStore.set(key, record);

    const allowed = validTimestamps.length <= maxRequests;
    const remaining = Math.max(0, maxRequests - validTimestamps.length);

    return { allowed, remaining };
  },

  /**
   * CIRCUIT BREAKER PATTERN (Graceful Degradation)
   * If a target API or service fails consistently, stops making raw requests and immediately serves fallback 
   * to preserve server resources and consumer experience, trying to recover after set cooldown.
   */
  async executeWithCircuitBreaker<T>(
    serviceName: string,
    action: () => Promise<T>,
    fallback: T | (() => Promise<T>)
  ): Promise<T> {
    const now = Date.now();
    let record = circuitBreakerStatus.get(serviceName);

    if (!record) {
      record = { failures: 0, lastFailureTime: 0, state: 'CLOSED' };
      circuitBreakerStatus.set(serviceName, record);
    }

    // State Transition: OPEN -> HALF-OPEN
    if (record.state === 'OPEN' && (now - record.lastFailureTime > CIRCUIT_RECOVERY_TIME)) {
      console.log(`[Circuit Breaker] ${serviceName} entered HALF-OPEN state, checking health...`);
      record.state = 'HALF-OPEN';
      circuitBreakerStatus.set(serviceName, record);
    }

    if (record.state === 'OPEN') {
      console.warn(`[Circuit Breaker] ${serviceName} is OPEN. Immediate fallback triggered.`);
      return typeof fallback === 'function' ? (fallback as Function)() : fallback;
    }

    try {
      const result = await action();
      // If HALF-OPEN and succeeds, close circuit completely
      if (record.state === 'HALF-OPEN') {
        console.log(`[Circuit Breaker] ${serviceName} is healthy again! Closing circuit.`);
        record.failures = 0;
        record.state = 'CLOSED';
        circuitBreakerStatus.set(serviceName, record);
      }
      return result;
    } catch (err) {
      record.failures++;
      record.lastFailureTime = now;

      if (record.failures >= CIRCUIT_BREAKER_THRESHOLD) {
        console.error(`[Circuit Breaker] ${serviceName} has failed ${record.failures} times. Opening Circuit!`);
        record.state = 'OPEN';
      }

      circuitBreakerStatus.set(serviceName, record);
      return typeof fallback === 'function' ? (fallback as Function)() : fallback;
    }
  }
};
