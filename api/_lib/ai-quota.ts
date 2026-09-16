import { createHash } from 'node:crypto';
import { db, isDbAvailable } from './common.js';

export type AiQuotaFeature =
  | 'chat'
  | 'health_report'
  | 'tts'
  | 'memory_extraction'
  | 'workout_generation'
  | 'cardio_personalization'
  | 'powerlift_audit'
  | 'activity_photo_validation'
  | 'presence_biometric';

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
  powerlift_audit: { burst: { windowMs: HOUR, maxRequests: 6 }, daily: { windowMs: DAY, maxRequests: 20 } },
  activity_photo_validation: { burst: { windowMs: 30 * MINUTE, maxRequests: 12 }, daily: { windowMs: DAY, maxRequests: 60 } },
  presence_biometric: { burst: { windowMs: HOUR, maxRequests: 8 }, daily: { windowMs: DAY, maxRequests: 24 } },
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

function quotaDocId(userId: string, feature: AiQuotaFeature): string {
  return createHash('sha256').update(`${userId}\u0000${feature}`).digest('hex');
}

function windowStart(now: number, windowMs: number): number {
  return Math.floor(now / windowMs) * windowMs;
}

export interface AiQuotaDecision {
  allowed: boolean;
  retryAfterSeconds: number;
  reason?: 'quota_exceeded' | 'quota_unavailable';
}

/**
 * Distributed fixed-window quota for paid AI calls.
 *
 * One Firestore document is reused for each user+feature pair. Burst and daily
 * counters reset in-place when their fixed window changes, so storage remains
 * bounded even for highly active accounts. The transaction is authoritative
 * across Vercel instances; if it cannot be verified, paid AI fails closed.
 */
export async function consumeAiQuota(userId: string, feature: AiQuotaFeature): Promise<AiQuotaDecision> {
  if (!userId || !isDbAvailable()) {
    return { allowed: false, retryAfterSeconds: 60, reason: 'quota_unavailable' };
  }

  const now = Date.now();
  const policy = policyFor(feature);
  const burstStart = windowStart(now, policy.burst.windowMs);
  const dailyStart = windowStart(now, policy.daily.windowMs);
  const ref = db.collection('ai_quota_counters').doc(quotaDocId(userId, feature));

  try {
    return await db.runTransaction(async (transaction: any) => {
      const snapshot = await transaction.get(ref);
      const data = snapshot.exists ? snapshot.data() || {} : {};

      const storedBurstStart = Number(data.burstWindowStart);
      const storedDailyStart = Number(data.dailyWindowStart);
      const burstCount = storedBurstStart === burstStart ? Math.max(0, Number(data.burstCount) || 0) : 0;
      const dailyCount = storedDailyStart === dailyStart ? Math.max(0, Number(data.dailyCount) || 0) : 0;

      const burstExceeded = burstCount >= policy.burst.maxRequests;
      const dailyExceeded = dailyCount >= policy.daily.maxRequests;
      if (burstExceeded || dailyExceeded) {
        const retryAfterMs = Math.max(
          burstExceeded ? burstStart + policy.burst.windowMs - now : 0,
          dailyExceeded ? dailyStart + policy.daily.windowMs - now : 0,
        );
        return {
          allowed: false,
          retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
          reason: 'quota_exceeded' as const,
        };
      }

      const nowIso = new Date(now).toISOString();
      transaction.set(ref, {
        userId,
        feature,
        burstWindowStart: burstStart,
        burstWindowEnd: burstStart + policy.burst.windowMs,
        burstCount: burstCount + 1,
        burstMaxRequests: policy.burst.maxRequests,
        dailyWindowStart: dailyStart,
        dailyWindowEnd: dailyStart + policy.daily.windowMs,
        dailyCount: dailyCount + 1,
        dailyMaxRequests: policy.daily.maxRequests,
        updatedAt: nowIso,
        ...(snapshot.exists ? {} : { createdAt: nowIso }),
      }, { merge: true });

      return { allowed: true, retryAfterSeconds: 0 };
    });
  } catch (error: any) {
    console.warn('[AiQuota] Não foi possível confirmar quota; chamada paga bloqueada:', error?.message || error);
    return { allowed: false, retryAfterSeconds: 60, reason: 'quota_unavailable' };
  }
}
