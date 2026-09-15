import fs from 'node:fs';
import path from 'node:path';

const read = (relativePath: string) => fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');

describe('Vision AI cost and abuse guardrails', () => {
  test('PowerLift keeps the existing fail-safe decision policy and gates Gemini behind distributed quota', () => {
    const source = read('api/_handlers/validate-activity.ts');
    expect(source).toContain("consumeAiQuota(req.userId!, 'powerlift_audit')");
    expect(source.indexOf("consumeAiQuota(req.userId!, 'powerlift_audit')"))
      .toBeLessThan(source.indexOf('const response = await ai.models.generateContent'));
    expect(source).toContain("decision: 'manual_review'");
    expect(source).toContain('confidence >= 98');
    expect(source).toContain('weightConsistent');
    expect(source).toContain('frames.length >= 8');
    expect(source).toContain('maxOutputTokens: 600');
  });

  test('activity photo validation is size-bounded and quota-gated before Gemini', () => {
    const source = read('api/_handlers/validate-activity.ts');
    expect(source).toContain('MAX_IMAGE_VALIDATION_BASE64_LENGTH = 8_000_000');
    expect(source).toContain("consumeAiQuota(req.userId!, 'activity_photo_validation')");
    expect(source).toContain("reason: photoQuota.reason === 'quota_exceeded' ? 'AI_RATE_LIMITED' : 'AI_VALIDATION_UNAVAILABLE'");
    expect(source).toContain("reason: 'IMAGE_TOO_LARGE'");
    expect(source).toContain('maxOutputTokens: 400');
  });

  test('quota policy keeps PowerLift and generic photo validation in separate buckets', () => {
    const quota = read('api/_lib/ai-quota.ts');
    expect(quota).toContain("| 'powerlift_audit'");
    expect(quota).toContain("| 'activity_photo_validation'");
    expect(quota).toContain('powerlift_audit: { burst: { windowMs: HOUR, maxRequests: 6 }');
    expect(quota).toContain('activity_photo_validation: { burst: { windowMs: 30 * MINUTE, maxRequests: 12 }');
  });

  test('quota failure never auto-approves a PowerLift or activity photo', () => {
    const source = read('api/_handlers/validate-activity.ts');
    const powerQuotaBlock = source.slice(
      source.indexOf("const powerQuota = await consumeAiQuota"),
      source.indexOf('try {', source.indexOf("const powerQuota = await consumeAiQuota"))
    );
    expect(powerQuotaBlock).toContain('manual(reason)');
    expect(powerQuotaBlock).not.toContain("decision: 'approved'");

    const photoQuotaBlock = source.slice(
      source.indexOf("const photoQuota = await consumeAiQuota"),
      source.indexOf('const promptImagem', source.indexOf("const photoQuota = await consumeAiQuota"))
    );
    expect(photoQuotaBlock).toContain('revisaoManual');
    expect(photoQuotaBlock).not.toContain('isValid: true');
  });
});
