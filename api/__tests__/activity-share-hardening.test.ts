import fs from 'fs';
import path from 'path';

const source = fs.readFileSync(path.join(process.cwd(), 'api/_handlers/activity-share.ts'), 'utf8');

describe('activity-share direct endpoint hardening', () => {
  test('uses authenticated distributed rate limiting', () => {
    expect(source).toContain("collection('api_rate_limits')");
    expect(source).toContain('SHARE_RATE_WINDOW_MS = 60_000');
    expect(source).toContain('SHARE_RATE_MAX = 20');
    expect(source).toContain('verifyStrictAuth');
  });

  test('sets explicit security and no-cache response headers', () => {
    expect(source).toContain("'Cache-Control', 'no-store'");
    expect(source).toContain("'X-Content-Type-Options', 'nosniff'");
    expect(source).toContain("'X-Frame-Options', 'DENY'");
    expect(source).toContain("'Referrer-Policy', 'no-referrer'");
  });
});
