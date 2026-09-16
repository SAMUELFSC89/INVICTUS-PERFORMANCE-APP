import fs from 'node:fs';
import path from 'node:path';

const read = (relativePath: string) => fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');

describe('Strava webhook fail-closed guard', () => {
  test('requires webhook verification configuration for GET challenge', () => {
    const source = read('api/strava-webhook-guarded.ts');
    expect(source).toContain('STRAVA_VERIFY_TOKEN');
    expect(source).toContain('STRAVA_WEBHOOK_SECRET');
    expect(source).toContain("return res.status(503).json({ error: 'Webhook temporariamente indisponível.' })");
    expect(source).toContain("return res.status(403).json({ error: 'Webhook verification failed' })");
  });

  test('requires configured subscription id before accepting POST events', () => {
    const source = read('api/strava-webhook-guarded.ts');
    const configured = source.indexOf('const expectedSubscriptionId = process.env.STRAVA_SUBSCRIPTION_ID?.trim()');
    const missing = source.indexOf('if (!expectedSubscriptionId)');
    const compare = source.indexOf("String(event.subscription_id || '') !== expectedSubscriptionId");
    const fetchActivity = source.indexOf('await strava.fetchActivity(objectId)');
    expect(configured).toBeGreaterThan(-1);
    expect(missing).toBeGreaterThan(configured);
    expect(compare).toBeGreaterThan(missing);
    expect(fetchActivity).toBeGreaterThan(compare);
  });

  test('only imports the real activity for a registered Strava athlete', () => {
    const source = read('api/strava-webhook-guarded.ts');
    expect(source).toContain("db.collection('strava_athletes').doc(ownerId).get()");
    expect(source).toContain('if (!athleteSnap.exists)');
    expect(source).toContain('const strava = new StravaApi(userId)');
    expect(source).toContain('await SyncService.processStravaActivity(userId, activity)');
    expect(source).toContain("return res.status(503).json({ success: false, retryable: true })");
  });

  test('routes webhook guard before generic API router while preserving AI guard', () => {
    const vercel = read('vercel.json');
    const aiGuard = vercel.indexOf('"source": "/api/performance-ai"');
    const stravaGuard = vercel.indexOf('"source": "/api/strava/webhook"');
    const generic = vercel.indexOf('"source": "/api/(.*)"');
    expect(aiGuard).toBeGreaterThanOrEqual(0);
    expect(stravaGuard).toBeGreaterThan(aiGuard);
    expect(generic).toBeGreaterThan(stravaGuard);
    expect(vercel).toContain('"destination": "/api/strava-webhook-guarded"');
  });
});
