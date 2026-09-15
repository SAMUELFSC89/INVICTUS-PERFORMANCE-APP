import { createHash } from 'node:crypto';
import { db, isDbAvailable } from './common.js';

export type AiQuotaFeature =
  | 'chat'
  | 'health_report'
  | 'tts'
  | 'memory_extraction'
  | 'workout_generation'
  | 'cardio_personalization';

type BucketPolicy = { windowMs: number; maxRequests: number };
type FeaturePolicy = { burst: BucketPolicy; daily: BucketPolicy };

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const DEFAULT_POLICIES: Record<AiQuotaFeature, FeaturePolicy> = {
  chat: { burst: { windowMs: 10 * MINUTE, maxRequests: 24 }, daily: { windowMs: DAY, maxRequests: 180 } },
  health_report: { burst: { windowMs: 30 * MINUTE, maxRequests: 6 }, daily: { windowMs: DAY, maxRequests: 24 } },
  tts: { burst: { windowMs: 10 * MINUTE, maxRequests: 10 }, daily: { windowMs: DAY, maxRequests: 60 } },
  memory_extraction: { burst: { windowMs: 30 * MINUTE, maxRequests: 30 }, daily: { windowMs: DAY, maxRequests: 120 } },
  workout_generation: { burst: { windowMs: HOUR, maxRequests: 8 }, daily: { windowMs: DAY, maxRequests: 24 } },
  cardio_personalization: { burst: { windowMs: HOUR, maxRequests: 20 }, daily: { windowMs: DAY, maxRequests: 60 } },
};

function boundedEnvInt(name: string, fallback: number, max = 10_000): number {
  const parsed = Number(process.env[name]);
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

function policyFor(feature: AiQuotaFeature): FeaturePolicy {
  const defaults = DEFAULT_POLICIES[feature];
  const prefix = `AI_QUOTA_${feature.toUpperCase()}`;
  return {
    burst: {
      windowMs: defaults.burst.windowMs,
      maxRequests: boundedEnvInt(`${prefix}_BURST_MAX`, defaults.burst.maxRequests),
    },
    daily: {
      windowMs: defaults.daily.windowMs,
      maxRequests: boundedEnvInt(`${prefix}_DAILY_MAX`, defaults.daily.maxRequests),
    },
  };
}

function quotaDocId(userId: string, feature: AiQuotaFeature, bucket: 'burst' | 'daily', windowStart: number): string {
  return createHash('sha256')
    .update(`${userId}\u0000${feature}\u0000${bucket}\u0000${windowStart}`)
    .digest('hex');
}

export interface AiQuotaDecision {
  allowed: boolean;
  retryAfterSeconds: number;
  reason?: 'quota_exceeded' | 'quota_unavailable';
}

/**
 * Distributed fixed-window quota for paid AI calls.
 *
 * A serverless in-memory limiter is not authoritative because requests can land
 * on different Vercel instances. This transaction stores one counter per
 * user/feature/window and increments burst + daily buckets atomically. If the
 * quota store is unavailable we fail closed: paid AI is optional enrichment,
 * while deterministic product paths remain available to callers.
 */
export async function consumeAiQuota(userId: string, feature: AiQuotaFeature): Promise<AiQuotaDecision> {
  if (!userId || !isDbAvailable()) {
    return { allowed: false, retryAfterSeconds: 60, reason: 'quota_unavailable' };
  }

  const now = Date.now();
  const policy = policyFor(feature);
  const buckets = (['burst', 'daily'] as const).map((name) => {
    const config = policy[name];
    const windowStart = Math.floor(now / config.windowMs) * config.windowMs;
    const windowEnd = windowStart + config.windowMs;
    const ref = db.collection('ai_quota_windows').doc(quotaDocId(userId, feature, name, windowStart));
    return { name, config, windowStart, windowEnd, ref };
  });

  try {
    return await db.runTransaction(async (transaction: any) => {
      const snapshots = await Promise.all(buckets.map((bucket) => transaction.get(bucket.ref)));
      let retryAfterSeconds = 0;

      for (let index = 0; index < buckets.length; index += 1) {
        const bucket = buckets[index];
        const data = snapshots[index]?.exists ? snapshots[index].data() || {} : {};
        const count = Math.max(0, Number(data.count) || 0);
        if (count >= bucket.config.maxRequests) {
          retryAfterSeconds = Math.max(retryAfterSeconds, Math.ceil((bucket.windowEnd - now) / 1000));
        }
      }

      if (retryAfterSeconds > 0) {
        return { allowed: false, retryAfterSeconds, reason: 'quota_exceeded' as const };
      }

      const nowIso = new Date(now).toISOString();
      for (let index = 0; index < buckets.length; index += 1) {
        const bucket = buckets[index];
        const snapshot = snapshots[index];
        const count = snapshot?.exists ? Math.max(0, Number(snapshot.data()?.count) || 0) : 0;
        transaction.set(bucket.ref, {
          userId,
          feature,
          bucket: bucket.name,
          windowStart: new Date(bucket.windowStart).toISOString(),
          windowEnd: new Date(bucket.windowEnd).toISOString(),
          count: count + 1,
          maxRequests: bucket.config.maxRequests,
          updatedAt: nowIso,
          ...(snapshot?.exists ? {} : { createdAt: nowIso }),
        }, { merge: true });
      }

      return { allowed: true, retryAfterSeconds: 0 };
    });
  } catch (error: any) {
    console.warn('[AiQuota] Não foi possível confirmar quota; chamada paga bloqueada:', error?.message || error);
    return { allowed: false, retryAfterSeconds: 60, reason: 'quota_unavailable' };
  }
}
