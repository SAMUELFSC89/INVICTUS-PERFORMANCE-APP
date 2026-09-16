import { createHash } from 'node:crypto';
import { db, isDbAvailable } from './common.js';

export interface DistributedRateLimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
  remaining: number;
  reason?: 'rate_limited' | 'store_unavailable';
}

export interface DistributedRateLimitInput {
  scope: string;
  subjectId: string;
  windowMs: number;
  maxRequests: number;
}

function safeScope(value: string): string {
  return String(value || '').trim().slice(0, 80);
}

function rateLimitId(scope: string, subjectId: string): string {
  return `api_${createHash('sha256').update(`${scope}|${subjectId}`).digest('hex')}`;
}

/**
 * Rate limit autoritativo entre todas as instâncias serverless.
 *
 * Use somente depois de autenticar/validar a identidade do subjectId. Se o
 * Firestore não estiver disponível, falha fechado: endpoints caros/sensíveis
 * não podem cair de volta para um limiter de memória local.
 */
export async function consumeDistributedRateLimit(
  input: DistributedRateLimitInput,
): Promise<DistributedRateLimitDecision> {
  const scope = safeScope(input.scope);
  const subjectId = String(input.subjectId || '').trim();
  const windowMs = Math.max(1_000, Math.floor(Number(input.windowMs) || 0));
  const maxRequests = Math.max(1, Math.floor(Number(input.maxRequests) || 0));

  if (!scope || !subjectId || !isDbAvailable()) {
    return { allowed: false, retryAfterSeconds: 60, remaining: 0, reason: 'store_unavailable' };
  }

  const ref = db.collection('api_rate_limits').doc(rateLimitId(scope, subjectId));
  const now = Date.now();

  try {
    return await db.runTransaction(async (transaction: any) => {
      const snap = await transaction.get(ref);
      const data = snap.exists ? snap.data() || {} : {};
      const windowStartedAt = Number(data.windowStartedAt) || 0;
      const count = Math.max(0, Math.floor(Number(data.count) || 0));
      const expired = !windowStartedAt || now - windowStartedAt >= windowMs;

      if (expired) {
        transaction.set(ref, {
          scope,
          subjectId,
          windowStartedAt: now,
          windowMs,
          maxRequests,
          count: 1,
          updatedAt: new Date(now).toISOString(),
        }, { merge: true });
        return {
          allowed: true,
          retryAfterSeconds: 0,
          remaining: Math.max(0, maxRequests - 1),
        };
      }

      const retryAfterSeconds = Math.max(1, Math.ceil((windowMs - (now - windowStartedAt)) / 1000));
      if (count >= maxRequests) {
        return { allowed: false, retryAfterSeconds, remaining: 0, reason: 'rate_limited' as const };
      }

      transaction.set(ref, {
        count: count + 1,
        windowMs,
        maxRequests,
        updatedAt: new Date(now).toISOString(),
      }, { merge: true });
      return {
        allowed: true,
        retryAfterSeconds: 0,
        remaining: Math.max(0, maxRequests - count - 1),
      };
    });
  } catch (error) {
    console.error(`[DistributedRateLimit] Falha no scope ${scope}:`, error);
    return { allowed: false, retryAfterSeconds: 60, remaining: 0, reason: 'store_unavailable' };
  }
}
