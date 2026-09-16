import fs from 'node:fs';
import path from 'node:path';

const read = (relativePath: string) => fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');

describe('legacy /api/app sensitive action guard', () => {
  test('routes the public /api/app endpoint through the guard before generic API routing', () => {
    const vercel = read('vercel.json');
    const appGuard = vercel.indexOf('"source": "/api/app"');
    const generic = vercel.indexOf('"source": "/api/(.*)"');
    expect(appGuard).toBeGreaterThanOrEqual(0);
    expect(generic).toBeGreaterThan(appGuard);
    expect(vercel).toContain('"destination": "/api/app-guarded"');
  });

  test('keeps legacy performance-ai compatibility but delegates to the guarded handler', () => {
    const source = read('api/app-guarded.ts');
    expect(source).toContain("if (action === 'performance-ai')");
    expect(source).toContain('return performanceAiGuardedHandler(req, res)');
    expect(source).not.toContain('return performanceAiHandler(req, res)');
  });

  test('disables sensitive aliases that would bypass dedicated route guards', () => {
    const source = read('api/app-guarded.ts');
    expect(source).toContain("action === 'payments-verify-purchase'");
    expect(source).toContain("action === 'validate-presence'");
    expect(source).toContain("action === 'strava' && stravaAction(req) === 'webhook'");
    expect(source).toContain("return res.status(410).json");
    expect(source).toContain("endpoint: '/api/payments/verify-purchase'");
    expect(source).toContain("endpoint: '/api/validate-presence'");
    expect(source).toContain("endpoint: '/api/strava/webhook'");
  });

  test('delegates non-sensitive legacy actions to the canonical router', () => {
    const source = read('api/app-guarded.ts');
    expect(source).toContain('return appHandler(req, res)');
  });
});
