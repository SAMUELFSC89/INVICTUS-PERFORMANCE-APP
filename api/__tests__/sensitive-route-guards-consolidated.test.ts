import fs from 'node:fs';
import path from 'node:path';

const read = (file: string) => fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');

describe('consolidated sensitive route guards', () => {
  test('keeps every sensitive guard ahead of the generic API rewrite in one deterministic order', () => {
    const vercel = read('vercel.json');
    const routes = [
      '/api/performance-ai',
      '/api/payments/verify-purchase',
      '/api/validate-presence',
      '/api/strava/webhook',
      '/api/app',
      '/api/(.*)',
    ];
    const positions = routes.map(route => vercel.indexOf(`\"source\": \"${route}\"`));
    positions.forEach(position => expect(position).toBeGreaterThanOrEqual(0));
    for (let index = 1; index < positions.length; index += 1) {
      expect(positions[index]).toBeGreaterThan(positions[index - 1]);
    }
    expect(vercel).toContain('"destination": "/api/performance-ai-guarded"');
    expect(vercel).toContain('"destination": "/api/payments-verify-purchase-guarded"');
    expect(vercel).toContain('"destination": "/api/validate-presence-guarded"');
    expect(vercel).toContain('"destination": "/api/strava-webhook-guarded"');
    expect(vercel).toContain('"destination": "/api/app-guarded"');
  });

  test('legacy dispatcher cannot bypass the dedicated purchase, presence or Strava webhook guards', () => {
    const source = read('api/app-guarded.ts');
    expect(source).toContain("action === 'payments-verify-purchase'");
    expect(source).toContain("action === 'validate-presence'");
    expect(source).toContain("action === 'strava' && stravaAction(req) === 'webhook'");
    expect(source).toContain("return res.status(410).json");
    expect(source).toContain('return performanceAiGuardedHandler(req, res)');
  });
});
