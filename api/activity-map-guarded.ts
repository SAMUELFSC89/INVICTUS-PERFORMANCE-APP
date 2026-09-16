import { createHash } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import activityMapHandler from './activity-map.js';
import { cors, db, verifyAuth } from './_lib/common.js';

type GeoPoint = { lat: number; lng: number };

const MAX_RAW_TRAJECTORY_POINTS = 8000;
const PRIVACY_MAX_METERS_PER_ENDPOINT = 200;
const PRIVACY_MAX_ROUTE_FRACTION_PER_ENDPOINT = 0.15;
const RATE_BURST_WINDOW_MS = 5 * 60 * 1000;
const RATE_BURST_MAX = 30;
const RATE_DAILY_WINDOW_MS = 24 * 60 * 60 * 1000;
const RATE_DAILY_MAX = 180;

function normalizePoint(value: unknown): GeoPoint | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  const location = source.location && typeof source.location === 'object'
    ? source.location as Record<string, unknown>
    : undefined;
  const lat = Number(source.lat ?? source.latitude ?? location?.lat ?? location?.latitude);
  const lng = Number(source.lng ?? source.longitude ?? location?.lng ?? location?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const radius = 6_371_000;
  const toRad = (value: number) => value * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

function routeDistanceMeters(points: GeoPoint[]): number {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += haversineMeters(points[index - 1], points[index]);
  }
  return total;
}

function interpolate(a: GeoPoint, b: GeoPoint, ratio: number): GeoPoint {
  const safe = Math.max(0, Math.min(1, ratio));
  return {
    lat: a.lat + (b.lat - a.lat) * safe,
    lng: a.lng + (b.lng - a.lng) * safe,
  };
}

function trimFromStart(points: GeoPoint[], meters: number): GeoPoint[] {
  if (points.length < 2 || meters <= 0) return points;
  let remaining = meters;
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    const segment = haversineMeters(from, to);
    if (!Number.isFinite(segment) || segment <= 0) continue;
    if (remaining < segment) {
      return [interpolate(from, to, remaining / segment), ...points.slice(index)];
    }
    remaining -= segment;
  }
  return points.slice(-2);
}

function trimFromEnd(points: GeoPoint[], meters: number): GeoPoint[] {
  if (points.length < 2 || meters <= 0) return points;
  let remaining = meters;
  for (let index = points.length - 1; index > 0; index -= 1) {
    const from = points[index];
    const to = points[index - 1];
    const segment = haversineMeters(from, to);
    if (!Number.isFinite(segment) || segment <= 0) continue;
    if (remaining < segment) {
      return [...points.slice(0, index), interpolate(from, to, remaining / segment)];
    }
    remaining -= segment;
  }
  return points.slice(0, 2);
}

export function redactRouteEndpoints(points: GeoPoint[]): GeoPoint[] {
  if (points.length < 2) return points;
  const total = routeDistanceMeters(points);
  if (!Number.isFinite(total) || total < 20) return points;

  const privacyMeters = Math.min(
    PRIVACY_MAX_METERS_PER_ENDPOINT,
    total * PRIVACY_MAX_ROUTE_FRACTION_PER_ENDPOINT,
  );
  if (privacyMeters < 1) return points;

  const startTrimmed = trimFromStart(points, privacyMeters);
  const fullyTrimmed = trimFromEnd(startTrimmed, privacyMeters);
  return fullyTrimmed.length >= 2 ? fullyTrimmed : points;
}

function rateLimitId(userId: string): string {
  return `activity_map_${createHash('sha256').update(userId).digest('hex')}`;
}

async function consumeRateLimit(userId: string): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const ref = db.collection('api_rate_limits').doc(rateLimitId(userId));
  const now = Date.now();

  return db.runTransaction(async (transaction: any) => {
    const snap = await transaction.get(ref);
    const data = snap.exists ? snap.data() || {} : {};

    let burstStartedAt = Number(data.burstStartedAt) || 0;
    let burstCount = Math.max(0, Number(data.burstCount) || 0);
    let dailyStartedAt = Number(data.dailyStartedAt) || 0;
    let dailyCount = Math.max(0, Number(data.dailyCount) || 0);

    if (!burstStartedAt || now - burstStartedAt >= RATE_BURST_WINDOW_MS) {
      burstStartedAt = now;
      burstCount = 0;
    }
    if (!dailyStartedAt || now - dailyStartedAt >= RATE_DAILY_WINDOW_MS) {
      dailyStartedAt = now;
      dailyCount = 0;
    }

    if (dailyCount >= RATE_DAILY_MAX) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((dailyStartedAt + RATE_DAILY_WINDOW_MS - now) / 1000)),
      };
    }
    if (burstCount >= RATE_BURST_MAX) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((burstStartedAt + RATE_BURST_WINDOW_MS - now) / 1000)),
      };
    }

    transaction.set(ref, {
      scope: 'activity_map',
      burstStartedAt,
      burstCount: burstCount + 1,
      dailyStartedAt,
      dailyCount: dailyCount + 1,
      updatedAt: new Date(now).toISOString(),
    }, { merge: true });

    return { allowed: true, retryAfterSeconds: 0 };
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, userMessage: 'Metodo nao permitido.' });
  }

  const auth = await verifyAuth(req);
  if (!auth) {
    return res.status(401).json({ success: false, userMessage: 'Sessao expirada. Entre novamente.' });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const trajectory = Array.isArray(body.trajectory) ? body.trajectory : null;
  if (!trajectory || trajectory.length < 2) {
    return res.status(400).json({ success: false, userMessage: 'Rota GPS insuficiente para gerar o mapa desta atividade.' });
  }
  if (trajectory.length > MAX_RAW_TRAJECTORY_POINTS) {
    return res.status(413).json({ success: false, userMessage: 'Rota GPS extensa demais para gerar o mapa.' });
  }

  const points = trajectory.map(normalizePoint);
  if (points.some((point) => point === null)) {
    return res.status(400).json({ success: false, userMessage: 'Rota GPS invalida para esta atividade.' });
  }
  const normalized = points as GeoPoint[];

  let rateLimit: { allowed: boolean; retryAfterSeconds: number };
  try {
    rateLimit = await consumeRateLimit(auth.uid);
  } catch {
    console.error('[activity-map-guard] Quota distribuida indisponivel.');
    return res.status(503).json({ success: false, userMessage: 'Mapa temporariamente indisponivel. Tente novamente em instantes.' });
  }

  if (!rateLimit.allowed) {
    res.setHeader('Retry-After', String(rateLimit.retryAfterSeconds));
    return res.status(429).json({ success: false, userMessage: 'Muitas geracoes de mapa em pouco tempo. Aguarde antes de tentar novamente.' });
  }

  const redacted = redactRouteEndpoints(normalized);
  res.setHeader('X-Invictus-Route-Privacy', 'endpoints-redacted');

  // A redacao existe apenas nesta copia do request de apresentacao. O treino
  // original no Firestore, historico e antifraude nunca sao alterados.
  (req as any).body = { ...body, trajectory: redacted };
  return activityMapHandler(req as any, res as any);
}
