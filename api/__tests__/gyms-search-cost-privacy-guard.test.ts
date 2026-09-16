import fs from 'node:fs';
import path from 'node:path';

const read = (relativePath: string) => fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');

describe('gym search provider cost and privacy guardrails', () => {
  test('requires authentication and distributed quota before uncached Google Places calls', () => {
    const source = read('api/_handlers/gyms.ts');
    const auth = source.indexOf('const auth = await verifyAuth(req)');
    const cacheLookup = source.indexOf('const cached = cache.get(cacheKey)');
    const quota = source.indexOf('const quota = await consumeGymSearchRateLimit(auth.uid)');
    const legacyFetch = source.indexOf("const fetchPlacesLegacy = async");

    expect(auth).toBeGreaterThan(-1);
    expect(cacheLookup).toBeGreaterThan(auth);
    expect(quota).toBeGreaterThan(cacheLookup);
    expect(legacyFetch).toBeGreaterThan(quota);
    expect(source).toContain("db.collection('api_rate_limits')");
    expect(source).toContain("scope: 'gyms_search'");
    expect(source).toContain("res.setHeader('Retry-After'");
    expect(source).toContain('return res.status(429)');
  });

  test('bounds burst and daily provider-backed searches per authenticated user', () => {
    const source = read('api/_handlers/gyms.ts');
    expect(source).toContain('GYM_SEARCH_BURST_WINDOW_MS = 5 * 60 * 1000');
    expect(source).toContain('GYM_SEARCH_BURST_MAX = 24');
    expect(source).toContain('GYM_SEARCH_DAILY_WINDOW_MS = 24 * 60 * 60 * 1000');
    expect(source).toContain('GYM_SEARCH_DAILY_MAX = 120');
    expect(source).toContain("createHash('sha256').update(userId).digest('hex')");
  });

  test('does not write search terms or coordinates into routine GymAPI logs', () => {
    const source = read('api/_handlers/gyms.ts');
    expect(source).not.toContain('Returning cached results for ${cacheKey}');
    expect(source).not.toContain('REQUEST: ${type} with params:');
    expect(source).not.toContain('User searching for specific term: ${q}');
    expect(source).toContain('Returning cached results.');
    expect(source).toContain('Text search requested');
  });
});
