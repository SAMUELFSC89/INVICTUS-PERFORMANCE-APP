import fs from 'node:fs';
import path from 'node:path';

const read = (relativePath: string) => fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');

describe('presence biometric AI cost guardrails', () => {
  test('uses a dedicated distributed quota bucket with bounded burst and daily limits', () => {
    const quota = read('api/_lib/ai-quota.ts');
    expect(quota).toContain("| 'presence_biometric'");
    expect(quota).toContain("presence_biometric: { burst: { windowMs: HOUR, maxRequests: 8 }, daily: { windowMs: DAY, maxRequests: 24 } }");
    expect(quota).toContain("db.collection('ai_quota_counters')");
    expect(quota).toContain('db.runTransaction');
  });

  test('provider availability and payload bounds are checked before consuming paid AI quota', () => {
    const guard = read('api/validate-presence-guarded.ts');
    const providerCheck = guard.indexOf('if (!getAiApiKey())');
    const quotaCall = guard.indexOf("consumeAiQuota(auth.uid, 'presence_biometric')");
    const canonicalCall = guard.indexOf('return validatePresenceHandler(req, res)');

    expect(providerCheck).toBeGreaterThan(-1);
    expect(quotaCall).toBeGreaterThan(providerCheck);
    expect(canonicalCall).toBeGreaterThan(quotaCall);
    expect(guard).toContain('MAX_SELFIE_BASE64_CHARS = 8_000_000');
    expect(guard).toContain("code: 'AI_NOT_CONFIGURED'");
    expect(guard).toContain("code: unavailable ? 'AI_QUOTA_UNAVAILABLE' : 'AI_RATE_LIMITED'");
    expect(guard).toContain("res.setHeader('Retry-After', String(quota.retryAfterSeconds))");
  });

  test('routes the public presence endpoint through the guard before the generic API rewrite', () => {
    const vercel = read('vercel.json');
    const guarded = vercel.indexOf('"source": "/api/validate-presence"');
    const generic = vercel.indexOf('"source": "/api/(.*)"');
    expect(guarded).toBeGreaterThanOrEqual(0);
    expect(generic).toBeGreaterThan(guarded);
    expect(vercel).toContain('"destination": "/api/validate-presence-guarded"');
  });

  test('canonical handler remains fail-closed and reopens transient processing claims', () => {
    const canonical = read('api/_handlers/validate-presence.ts');
    expect(canonical).toContain("status: 'processing'");
    expect(canonical).toContain("recheckSnap.data()?.status === 'processing'");
    expect(canonical).toContain("await pendingCheckRef.update({ status: 'pending' })");
    expect(canonical).toContain("let finalDecision: 'approved' | 'pending' | 'rejected' = 'pending'");
    expect(canonical).toContain('presenceConfidence >= 72 && identityMatched');
  });
});
