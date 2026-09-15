import fs from 'node:fs';
import path from 'node:path';

const read = (relativePath: string) => fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');

describe('Cardio Objective AI quota guardrails', () => {
  test('quota is distributed, per-user, bounded in storage and fail-closed', () => {
    const quota = read('api/_lib/ai-quota.ts');
    expect(quota).toContain("db.collection('ai_quota_counters')");
    expect(quota).toContain('db.runTransaction');
    expect(quota).toContain("update(`${userId}\\u0000${feature}`)");
    expect(quota).toContain('burstWindowStart');
    expect(quota).toContain('dailyWindowStart');
    expect(quota).toContain("reason: 'quota_unavailable'");
    expect(quota).toContain("reason: 'quota_exceeded'");
    expect(quota).not.toContain('ai_quota_windows');
  });

  test('all Cardio Objective Gemini paths require canonical Pro and available quota', () => {
    const cardio = read('api/_lib/cardio-objective-ai.ts');
    expect(cardio).toContain("import { consumeAiQuota } from './ai-quota.js'");
    expect(cardio).toContain("import { isProUser } from './entitlement.js'");
    expect(cardio).toContain('async function hasProAiAccess');
    expect(cardio).toContain("consumeAiQuota(userId, 'cardio_personalization')");
    const guardedCalls = cardio.match(/if \([^\n]*!await canUseCardioAi\(userId\)[^\n]*\) return fallback;/g) || [];
    expect(guardedCalls.length).toBeGreaterThanOrEqual(3);
  });

  test('quota or entitlement failure preserves deterministic mission behavior', () => {
    const cardio = read('api/_lib/cardio-objective-ai.ts');
    expect(cardio).toContain("source: 'deterministic'");
    expect(cardio).toContain('fallbackChallengePresentation');
    expect(cardio).not.toContain("throw new Error('AI quota");
  });

  test('Gemini cannot become authority over deterministic Cardio prescription', () => {
    const cardio = read('api/_lib/cardio-objective-ai.ts');
    expect(cardio).toContain('const fallbackPrescription = validateMissionCoherence');
    expect(cardio).toContain('const prescription = validateMissionCoherence');
    expect(cardio).toContain('durationMinutes = canRefineDuration');
    expect(cardio).toContain('journey.status !== \'active\'');
  });
});
