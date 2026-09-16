import fs from 'node:fs';
import path from 'node:path';

const read = (relativePath: string) => fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');

describe('gym photo proxy guardrails', () => {
  test('rejects unsupported methods and malformed refs before touching Google', () => {
    const source = read('api/_handlers/gyms_photo.ts');
    const handlerStart = source.indexOf('export default async function handler');
    const handler = source.slice(handlerStart);
    const methodGuard = handler.indexOf("if (req.method !== 'GET')");
    const parseRef = handler.indexOf('const parsed = parsePhotoRef');
    const apiKey = handler.indexOf('const apiKey = getGooglePlacesApiKey()');
    const providerFetch = handler.indexOf('fetchGoogleImageWithRedirectGuard');

    expect(handlerStart).toBeGreaterThan(-1);
    expect(methodGuard).toBeGreaterThan(-1);
    expect(parseRef).toBeGreaterThan(methodGuard);
    expect(apiKey).toBeGreaterThan(parseRef);
    expect(providerFetch).toBeGreaterThan(apiKey);
    expect(source).toContain("/^places\\/[A-Za-z0-9_-]{8,256}\\/photos\\/[A-Za-z0-9_-]{8,512}$/");
    expect(source).toContain('/^[A-Za-z0-9._~-]{20,1024}$/');
  });

  test('rate limits provider-backed requests with Firestore and Retry-After', () => {
    const source = read('api/_handlers/gyms_photo.ts');
    expect(source).toContain("db.collection('api_rate_limits')");
    expect(source).toContain("scope: 'gym_photo_proxy'");
    expect(source).toContain('BURST_MAX = 120');
    expect(source).toContain('DAILY_MAX = 800');
    expect(source).toContain("res.setHeader('Retry-After'");
    expect(source).toContain('return res.status(429)');
  });

  test('never logs key material or returns arbitrary upstream content', () => {
    const source = read('api/_handlers/gyms_photo.ts');
    expect(source).not.toContain('KeyPrefix');
    expect(source).not.toContain('apiKey.substring');
    expect(source).not.toContain('error.message');
    expect(source).toContain("contentType.startsWith('image/')");
    expect(source).toContain('MAX_IMAGE_BYTES');
    expect(source).toContain("host.endsWith('.googleusercontent.com')");
  });

  test('manually validates every redirect and bounds streamed response bytes before buffering', () => {
    const source = read('api/_handlers/gyms_photo.ts');
    expect(source).toContain('MAX_UPSTREAM_REDIRECTS = 3');
    expect(source).toContain("redirect: 'manual'");
    expect(source).not.toContain("redirect: 'follow'");
    expect(source).toContain('resolveAllowedRedirect(location, currentUrl)');
    expect(source).toContain("host === 'maps.googleapis.com'");
    expect(source).toContain('response.body.getReader()');
    expect(source).toContain('totalBytes > MAX_IMAGE_BYTES');
    expect(source).toContain('await reader.cancel()');
  });
});
