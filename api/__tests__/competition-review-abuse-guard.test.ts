import fs from 'node:fs';
import path from 'node:path';

const read = (relativePath: string) => fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');

describe('competition review abuse guardrails', () => {
  test('review requests are deterministic per athlete, subject, category and UTC day', () => {
    const source = read('api/_handlers/competition-review.ts');
    expect(source).toContain('export function competitionReviewRequestId');
    expect(source).toContain("const day = now.toISOString().slice(0, 10)");
    expect(source).toContain('`${userId}|${source}|${subjectId}|${category}|${day}`');
    expect(source).toContain("return `review_${digest}`");
  });

  test('distributed per-user quota is enforced transactionally before creating a new review', () => {
    const source = read('api/_handlers/competition-review.ts');
    expect(source).toContain('const REVIEW_RATE_WINDOW_MS = 24 * 60 * 60 * 1000');
    expect(source).toContain('const REVIEW_RATE_MAX = 10');
    expect(source).toContain("scope: 'competition-review'");
    const transaction = source.indexOf('db.runTransaction');
    const rateCheck = source.indexOf('count >= REVIEW_RATE_MAX');
    const create = source.indexOf('transaction.create(ref');
    expect(transaction).toBeGreaterThan(-1);
    expect(rateCheck).toBeGreaterThan(transaction);
    expect(create).toBeGreaterThan(rateCheck);
  });

  test('rate-limit storage uses a hashed document id without persisting raw uid', () => {
    const source = read('api/_handlers/competition-review.ts');
    expect(source).toContain("createHash('sha256').update(userId).digest('hex')");
    const rateWriteStart = source.indexOf('transaction.set(rateRef');
    const reviewCreateStart = source.indexOf('transaction.create(ref');
    expect(rateWriteStart).toBeGreaterThan(-1);
    expect(reviewCreateStart).toBeGreaterThan(rateWriteStart);
    const rateWrite = source.slice(rateWriteStart, reviewCreateStart);
    expect(rateWrite).not.toContain('userId: auth.uid');
  });

  test('same-day duplicate is idempotent and does not create a second review', () => {
    const source = read('api/_handlers/competition-review.ts');
    expect(source).toContain('if (existing.exists)');
    expect(source).toContain('idempotent: !result.created');
    expect(source).toContain("res.status(result.created ? 201 : 200)");
  });

  test('rate-limit response publishes Retry-After without changing competitive result', () => {
    const source = read('api/_handlers/competition-review.ts');
    expect(source).toContain("res.setHeader('Retry-After'");
    expect(source).toContain('return res.status(429)');
    expect(source).toContain('O resultado não é alterado automaticamente');
  });
});
