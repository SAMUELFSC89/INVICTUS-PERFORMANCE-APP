import { createHash } from 'node:crypto';
import { cors, db } from '../_lib/common.js';
import { getGooglePlacesApiKey } from '../_lib/google-places-config.js';

const BURST_WINDOW_MS = 5 * 60 * 1000;
const BURST_MAX = 120;
const DAILY_WINDOW_MS = 24 * 60 * 60 * 1000;
const DAILY_MAX = 800;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_UPSTREAM_REDIRECTS = 3;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function sourceKey(req: any): string {
  const forwarded = String(req.headers?.['x-vercel-forwarded-for'] || '').split(',')[0].trim();
  const remote = String(req.socket?.remoteAddress || '').trim();
  const source = (forwarded || remote || 'unknown').slice(0, 160);
  return createHash('sha256').update(source).digest('hex');
}

async function consumePhotoQuota(req: any): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const ref = db.collection('api_rate_limits').doc(`gym_photo_${sourceKey(req)}`);
  const now = Date.now();

  return db.runTransaction(async (transaction: any) => {
    const snap = await transaction.get(ref);
    const data = snap.exists ? snap.data() || {} : {};

    let burstStartedAt = Number(data.burstStartedAt) || 0;
    let burstCount = Math.max(0, Number(data.burstCount) || 0);
    let dailyStartedAt = Number(data.dailyStartedAt) || 0;
    let dailyCount = Math.max(0, Number(data.dailyCount) || 0);

    if (!burstStartedAt || now - burstStartedAt >= BURST_WINDOW_MS) {
      burstStartedAt = now;
      burstCount = 0;
    }
    if (!dailyStartedAt || now - dailyStartedAt >= DAILY_WINDOW_MS) {
      dailyStartedAt = now;
      dailyCount = 0;
    }

    if (dailyCount >= DAILY_MAX) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((dailyStartedAt + DAILY_WINDOW_MS - now) / 1000)),
      };
    }
    if (burstCount >= BURST_MAX) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((burstStartedAt + BURST_WINDOW_MS - now) / 1000)),
      };
    }

    transaction.set(ref, {
      scope: 'gym_photo_proxy',
      burstStartedAt,
      burstCount: burstCount + 1,
      dailyStartedAt,
      dailyCount: dailyCount + 1,
      updatedAt: new Date(now).toISOString(),
    }, { merge: true });

    return { allowed: true, retryAfterSeconds: 0 };
  });
}

function parsePhotoRef(value: unknown): { ref: string; isV1: boolean } | null {
  const photoRef = typeof value === 'string' ? value.trim() : '';
  if (!photoRef || photoRef.length > 1024) return null;

  if (photoRef.startsWith('places/')) {
    const match = photoRef.match(/^places\/[A-Za-z0-9_-]{8,256}\/photos\/[A-Za-z0-9_-]{8,512}$/);
    return match ? { ref: photoRef, isV1: true } : null;
  }

  // Legacy Google photo references are opaque tokens. Keep the accepted
  // alphabet deliberately narrow so this endpoint cannot be repurposed as an
  // arbitrary upstream proxy.
  if (!/^[A-Za-z0-9._~-]{20,1024}$/.test(photoRef)) return null;
  return { ref: photoRef, isV1: false };
}

function isAllowedGoogleMediaUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase();
    return host === 'places.googleapis.com'
      || host === 'maps.googleapis.com'
      || host.endsWith('.googleusercontent.com')
      || host.endsWith('.ggpht.com');
  } catch {
    return false;
  }
}

function resolveAllowedRedirect(location: string, currentUrl: string): string | null {
  try {
    const resolved = new URL(location, currentUrl).toString();
    return isAllowedGoogleMediaUrl(resolved) ? resolved : null;
  } catch {
    return null;
  }
}

async function fetchGoogleImageWithRedirectGuard(
  initialUrl: string,
  initialHeaders: Record<string, string>,
): Promise<Response> {
  let currentUrl = initialUrl;
  let headers = initialHeaders;

  for (let redirectCount = 0; redirectCount <= MAX_UPSTREAM_REDIRECTS; redirectCount += 1) {
    const response = await fetch(currentUrl, {
      method: 'GET',
      headers,
      redirect: 'manual',
    });

    if (!REDIRECT_STATUSES.has(response.status)) return response;
    if (redirectCount >= MAX_UPSTREAM_REDIRECTS) {
      throw Object.assign(new Error('Too many upstream redirects'), { code: 'UPSTREAM_REDIRECT_LIMIT' });
    }

    const location = response.headers.get('location') || '';
    const nextUrl = resolveAllowedRedirect(location, currentUrl);
    if (!nextUrl) {
      throw Object.assign(new Error('Unexpected upstream redirect'), { code: 'UPSTREAM_REDIRECT_REFUSED' });
    }

    currentUrl = nextUrl;
    // Authentication material is only needed on the first Places V1 request.
    // Do not forward X-Goog-Api-Key to the media host reached by redirects.
    headers = {
      Accept: 'image/*',
      'User-Agent': 'Invictus Performance photo proxy/1.0',
    };
  }

  throw Object.assign(new Error('Too many upstream redirects'), { code: 'UPSTREAM_REDIRECT_LIMIT' });
}

async function readImageBodyWithLimit(response: Response): Promise<Buffer> {
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_BYTES) {
    throw Object.assign(new Error('Photo payload too large'), { code: 'PHOTO_PAYLOAD_TOO_LARGE' });
  }

  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;

      totalBytes += value.byteLength;
      if (totalBytes > MAX_IMAGE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw Object.assign(new Error('Photo payload too large'), { code: 'PHOTO_PAYLOAD_TOO_LARGE' });
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks, totalBytes);
}

export default async function handler(req: any, res: any) {
  const requestId = Math.random().toString(36).substring(7);
  if (cors(req, res)) return;

  if (req.method !== 'GET') {
    return res.status(405).send('Method not allowed');
  }

  const parsed = parsePhotoRef(req.query?.ref);
  if (!parsed) {
    return res.status(400).send('Invalid photo reference');
  }

  const apiKey = getGooglePlacesApiKey();
  if (!apiKey) {
    console.error(`[PhotoProxy][${requestId}] Google Places is not configured`);
    return res.status(503).send('Photo service unavailable');
  }
  if (!db) {
    return res.status(503).send('Photo service unavailable');
  }

  try {
    const quota = await consumePhotoQuota(req);
    if (!quota.allowed) {
      res.setHeader('Retry-After', String(quota.retryAfterSeconds));
      return res.status(429).send('Too many photo requests');
    }

    const publicHeaders: Record<string, string> = {
      Accept: 'image/*',
      'User-Agent': 'Invictus Performance photo proxy/1.0',
    };

    let initialUrl: string;
    let initialHeaders = publicHeaders;
    if (parsed.isV1) {
      const url = new URL(`https://places.googleapis.com/v1/${parsed.ref}/media`);
      url.searchParams.set('maxWidthPx', '800');
      initialUrl = url.toString();
      initialHeaders = {
        ...publicHeaders,
        'X-Goog-Api-Key': apiKey,
      };
    } else {
      const url = new URL('https://maps.googleapis.com/maps/api/place/photo');
      url.searchParams.set('maxwidth', '800');
      url.searchParams.set('photoreference', parsed.ref);
      url.searchParams.set('key', apiKey);
      initialUrl = url.toString();
    }

    let response: Response;
    try {
      response = await fetchGoogleImageWithRedirectGuard(initialUrl, initialHeaders);
    } catch (error: any) {
      if (error?.code === 'UPSTREAM_REDIRECT_REFUSED' || error?.code === 'UPSTREAM_REDIRECT_LIMIT') {
        console.warn(`[PhotoProxy][${requestId}] Refused unsafe upstream redirect chain`);
        return res.status(502).send('Photo provider returned an invalid redirect');
      }
      throw error;
    }

    if (!response.ok) {
      console.warn(`[PhotoProxy][${requestId}] Upstream returned ${response.status}`);
      return res.status(response.status === 404 ? 404 : 502).send('Photo unavailable');
    }

    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    if (!contentType.startsWith('image/')) {
      console.warn(`[PhotoProxy][${requestId}] Upstream returned non-image content`);
      return res.status(502).send('Invalid photo payload');
    }

    let buffer: Buffer;
    try {
      buffer = await readImageBodyWithLimit(response);
    } catch (error: any) {
      if (error?.code === 'PHOTO_PAYLOAD_TOO_LARGE') {
        return res.status(502).send('Photo payload too large');
      }
      throw error;
    }

    if (!buffer.length) {
      return res.status(502).send('Invalid photo payload');
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=3600');
    return res.end(buffer);
  } catch (error: any) {
    console.error(`[PhotoProxy][${requestId}] Request failed:`, error?.name || 'error');
    if (!res.headersSent) return res.status(500).send('Photo service unavailable');
  }
}
