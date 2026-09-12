import { db } from './common.js';
import { getGooglePlacesApiKey } from './google-places-config.js';

export type GymAuditStatus = 'OK' | 'WARNING' | 'ERROR';

export interface GymAuditItem {
  id: string;
  placeId: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  registeredAddress: string;
  googleMapsAddress: string;
  googleMapsLat: number | null;
  googleMapsLng: number | null;
  distanceMeters: number | null;
  status: GymAuditStatus;
  errors: string[];
  warnings: string[];
}

export interface GymAuditReport {
  success: true;
  providerConfigured: boolean;
  gymsCount: number;
  errorsCount: number;
  warningsCount: number;
  results: GymAuditItem[];
  timestamp: string;
}

type CanonicalPlace = {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
};

function validCoordinate(latitude: number, longitude: number): boolean {
  return Number.isFinite(latitude)
    && Number.isFinite(longitude)
    && latitude >= -90
    && latitude <= 90
    && longitude >= -180
    && longitude <= 180;
}

export function distanceMetersBetween(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (value: number) => value * Math.PI / 180;
  const earthRadius = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function fetchCanonicalPlace(placeId: string, apiKey: string): Promise<CanonicalPlace> {
  const response = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
    headers: {
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'id,displayName,formattedAddress,location',
    },
  });
  const payload: any = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = String(payload?.error?.message || payload?.error?.status || `HTTP_${response.status}`);
    throw new Error(message.slice(0, 240));
  }

  const id = String(payload?.id || '').trim();
  const latitude = Number(payload?.location?.latitude);
  const longitude = Number(payload?.location?.longitude);
  if (id !== placeId || !validCoordinate(latitude, longitude)) {
    throw new Error('Google Places retornou coordenadas canônicas inválidas.');
  }

  return {
    id,
    name: String(payload?.displayName?.text || '').trim().slice(0, 128),
    address: String(payload?.formattedAddress || '').trim().slice(0, 256),
    latitude,
    longitude,
  };
}

function localAuditItem(id: string, data: Record<string, any>): GymAuditItem {
  const latitude = Number(data.latitude ?? data.lat);
  const longitude = Number(data.longitude ?? data.lng);
  const hasCoords = validCoordinate(latitude, longitude);
  const placeId = String(data.place_id || data.placeId || id || '').trim();
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!String(data.name || '').trim()) errors.push('Academia sem nome canônico.');
  if (!hasCoords) errors.push('Coordenadas locais ausentes ou inválidas.');
  if (!placeId || placeId.length > 128) errors.push('Google Place ID ausente ou inválido.');
  if (!String(data.address || '').trim()) warnings.push('Endereço local não informado.');

  return {
    id,
    placeId,
    name: String(data.name || 'Academia sem nome').slice(0, 128),
    latitude: hasCoords ? latitude : null,
    longitude: hasCoords ? longitude : null,
    registeredAddress: String(data.address || '').slice(0, 256),
    googleMapsAddress: '',
    googleMapsLat: null,
    googleMapsLng: null,
    distanceMeters: null,
    status: errors.length ? 'ERROR' : warnings.length ? 'WARNING' : 'OK',
    errors,
    warnings,
  };
}

export async function runAdminGymAudit(limit = 100): Promise<GymAuditReport> {
  const max = Math.min(200, Math.max(1, Number(limit) || 100));
  const snapshot = await db.collection('gyms').limit(max).get();
  const apiKey = getGooglePlacesApiKey();
  const seenPlaceIds = new Map<string, string>();
  const results: GymAuditItem[] = [];

  for (const document of snapshot.docs) {
    const item = localAuditItem(document.id, document.data() || {});

    if (item.placeId) {
      const existing = seenPlaceIds.get(item.placeId);
      if (existing && existing !== item.id) item.warnings.push(`Place ID também usado pela academia ${existing}.`);
      else seenPlaceIds.set(item.placeId, item.id);
    }

    if (!apiKey) {
      item.warnings.push('Google Places não está configurado; auditoria externa não executada.');
    } else if (item.placeId && item.placeId.length <= 128) {
      try {
        const canonical = await fetchCanonicalPlace(item.placeId, apiKey);
        item.googleMapsAddress = canonical.address;
        item.googleMapsLat = canonical.latitude;
        item.googleMapsLng = canonical.longitude;
        if (item.latitude !== null && item.longitude !== null) {
          item.distanceMeters = Number(distanceMetersBetween(
            item.latitude,
            item.longitude,
            canonical.latitude,
            canonical.longitude,
          ).toFixed(1));
          if (item.distanceMeters > 30) {
            item.errors.push(`Coordenada local está ${item.distanceMeters.toFixed(1)} m distante do ponto canônico do Google.`);
          }
        }
        if (canonical.name && item.name && canonical.name.toLocaleLowerCase('pt-BR') !== item.name.toLocaleLowerCase('pt-BR')) {
          item.warnings.push(`Nome Google: ${canonical.name}`);
        }
      } catch (error: any) {
        item.warnings.push(`Google Places indisponível para este cadastro: ${String(error?.message || error).slice(0, 180)}`);
      }
    }

    item.status = item.errors.length ? 'ERROR' : item.warnings.length ? 'WARNING' : 'OK';
    results.push(item);
  }

  return {
    success: true,
    providerConfigured: Boolean(apiKey),
    gymsCount: results.length,
    errorsCount: results.filter((item) => item.status === 'ERROR').length,
    warningsCount: results.filter((item) => item.status === 'WARNING').length,
    results,
    timestamp: new Date().toISOString(),
  };
}

export async function fixGymFromGoogle(gymId: string, reviewerId: string) {
  const id = String(gymId || '').trim();
  if (!id || id.length > 128 || !/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('ID de academia inválido.');

  const gymRef = db.collection('gyms').doc(id);
  const gymSnap = await gymRef.get();
  if (!gymSnap.exists) throw new Error('Academia não encontrada.');
  const existing = gymSnap.data() || {};
  const placeId = String(existing.place_id || existing.placeId || id).trim();
  const apiKey = getGooglePlacesApiKey();
  if (!apiKey) throw new Error('Google Places não está configurado no ambiente.');

  const canonical = await fetchCanonicalPlace(placeId, apiKey);
  const now = new Date().toISOString();
  await gymRef.set({
    name: canonical.name || existing.name,
    latitude: canonical.latitude,
    longitude: canonical.longitude,
    address: canonical.address || existing.address || '',
    source: 'google_places',
    auditLastFixedAt: now,
    auditLastFixedBy: reviewerId,
    updatedAt: now,
  }, { merge: true });

  const usersSnap = await db.collection('users').where('gymId', '==', id).limit(400).get();
  if (!usersSnap.empty) {
    const batch = db.batch();
    usersSnap.docs.forEach((userDoc) => batch.set(userDoc.ref, {
      gymName: canonical.name || existing.name || 'Academia',
      gymLocation: { lat: canonical.latitude, lng: canonical.longitude },
      updatedAt: now,
    }, { merge: true }));
    await batch.commit();
  }

  return {
    success: true,
    gymId: id,
    affectedUsers: usersSnap.size,
    canonical,
  };
}
