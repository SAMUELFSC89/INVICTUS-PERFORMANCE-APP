import fs from 'node:fs';
import path from 'node:path';

const read = (file: string) => fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');

describe('Strava webhook provider abuse guard', () => {
  test('rate limits by validated owner before any athlete lookup or provider fetch', () => {
    const source = read('api/strava-webhook-guarded.ts');
    const numericValidation = source.indexOf("!/^[0-9]+$/.test(ownerId)");
    const quota = source.indexOf("scope: 'strava_webhook_owner'");
    const athleteLookup = source.indexOf("db.collection('strava_athletes').doc(ownerId).get()");
    const providerFetch = source.indexOf('await strava.fetchActivity(objectId)');

    expect(numericValidation).toBeGreaterThan(-1);
    expect(quota).toBeGreaterThan(numericValidation);
    expect(athleteLookup).toBeGreaterThan(quota);
    expect(providerFetch).toBeGreaterThan(athleteLookup);
    expect(source).toContain('maxRequests: 30');
    expect(source).toContain('windowMs: 60_000');
    expect(source).toContain("res.setHeader('Retry-After'");
    expect(source).toContain("providerQuota.reason === 'store_unavailable' ? 503 : 429");
  });
});
