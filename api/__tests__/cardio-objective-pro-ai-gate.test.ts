import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.join(process.cwd(), 'api/_lib/cardio-objective-ai.ts'), 'utf8');

describe('Cardio Objective AI entitlement', () => {
  test('all Gemini personalization paths fail closed without canonical Pro entitlement', () => {
    expect(source).toContain('async function hasProAiAccess(userId: string)');
    expect(source).toContain('return userSnap.exists && isProUser(userSnap.data())');
    expect(source.match(/if \(!await hasProAiAccess\(userId\)\) return fallback;/g)?.length).toBe(3);
  });

  test('Free keeps deterministic fallback instead of losing the feature', () => {
    expect(source).toContain("source: 'deterministic'");
    expect(source).toContain('fallbackChallengePresentation');
    expect(source).toContain('validateMissionCoherence');
  });
});
