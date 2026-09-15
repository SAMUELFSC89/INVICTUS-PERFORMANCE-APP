import fs from 'node:fs';
import path from 'node:path';

describe('AI cost guardrails', () => {
  const quota = fs.readFileSync(path.join(process.cwd(), 'api/_lib/ai-quota.ts'), 'utf8');
  const cardio = fs.readFileSync(path.join(process.cwd(), 'api/_lib/cardio-objective-ai.ts'), 'utf8');

  test('quota is distributed, per-user and fail-closed', () => {
    expect(quota).toContain("db.collection('ai_quota_windows')");
    expect(quota).toContain('db.runTransaction');
    expect(quota).toContain("update(`${userId}\\u0000${feature}");
    expect(quota).toContain("reason: 'quota_unavailable'");
    expect(quota).toContain("reason: 'quota_exceeded'");
    expect(quota).toContain('burst');
    expect(quota).toContain('daily');
  });

  test('all Cardio Objective Gemini paths require Pro and available quota', () => {
    expect(cardio).toContain("import { consumeAiQuota } from './ai-quota.js'");
    expect(cardio).toContain('async function hasProAiAccess');
    expect(cardio).toContain("consumeAiQuota(userId, 'cardio_personalization')");

    const guardedCalls = cardio.match(/if \([^\n]*!await canUseCardioAi\(userId\)[^\n]*\) return fallback;/g) || [];
    expect(guardedCalls.length).toBeGreaterThanOrEqual(3);
  });

  test('quota exhaustion preserves deterministic cardio behavior instead of throwing', () => {
    expect(cardio).toContain("source: 'deterministic'");
    expect(cardio).not.toContain("throw new Error('AI quota");
  });
});
