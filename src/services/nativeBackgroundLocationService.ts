import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { calculateDistance } from '../lib/runUtils';

export interface NativeTrackedLocation {
  lat: number;
  lng: number;
  accuracy?: number;
  timestamp: string;
  speedKmH?: number;
  isSimulated?: boolean;
}

export interface NativeGpsSnapshot {
  sessionId: string | null;
  accuracy: number | null;
  signal: 'SEARCHING' | 'WEAK' | 'STRONG';
  permissionDenied: boolean;
  stalled: boolean;
  liveSpeedKmH: number | null;
  liveSpeedUpdatedAt: number | null;
  latestPoint: NativeTrackedLocation | null;
}

export interface NativeBufferedLocations {
  sessionId: string | null;
  locations: NativeTrackedLocation[];
}

type NativeLocationError = { code?: number | string; message?: string };
type NativeAuthorization = { status?: string };
type NativeSessionOptions = { sessionId: string };
type NativeStopOptions = { clear?: boolean };
type NativeLocationResult = { locations?: NativeTrackedLocation[]; sessionId?: string | null };

interface NativeActivityLocationPlugin {
  startLocationTracking(options: NativeSessionOptions): Promise<void>;
  resumeLocationTracking(options: NativeSessionOptions): Promise<void>;
  getTrackedLocations(): Promise<NativeLocationResult>;
  stopLocationTracking(options?: NativeStopOptions): Promise<NativeLocationResult>;
  addListener(eventName: 'locationUpdate', listenerFunc: (location: NativeTrackedLocation) => void): Promise<PluginListenerHandle>;
  addListener(eventName: 'locationError', listenerFunc: (error: NativeLocationError) => void): Promise<PluginListenerHandle>;
  addListener(eventName: 'locationAuthorization', listenerFunc: (state: NativeAuthorization) => void): Promise<PluginListenerHandle>;
}

const NativeActivityLocation = registerPlugin<NativeActivityLocationPlugin>('InvictusActivity');
const MIN_LIVE_SPEED_KMH = 1.0;
const MAX_LIVE_SPEED_KMH = 300;
const ACTIVE_SESSION_KEY = 'current_activity_session';

const INITIAL_SNAPSHOT: NativeGpsSnapshot = {
  sessionId: null,
  accuracy: null,
  signal: 'SEARCHING',
  permissionDenied: false,
  stalled: false,
  liveSpeedKmH: null,
  liveSpeedUpdatedAt: null,
  latestPoint: null,
};

let snapshot: NativeGpsSnapshot = { ...INITIAL_SNAPSHOT };
let previousPoint: NativeTrackedLocation | null = null;
let listenerSetup: Promise<void> | null = null;
let stallTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<(snapshot: NativeGpsSnapshot) => void>();

function supported(): boolean {
  const platform = Capacitor.getPlatform();
  return Capacitor.isNativePlatform() && (platform === 'ios' || platform === 'android');
}

function notify() {
  const current = snapshot;
  listeners.forEach((listener) => {
    try { listener(current); } catch (error) { console.warn('[nativeBackgroundLocationService] listener falhou:', error); }
  });
}

function setSnapshot(patch: Partial<NativeGpsSnapshot>) {
  snapshot = { ...snapshot, ...patch };
  notify();
}

function clearStallTimer() {
  if (stallTimer !== null) clearTimeout(stallTimer);
  stallTimer = null;
}

function signalForAccuracy(accuracy: number): NativeGpsSnapshot['signal'] {
  return accuracy < 20 ? 'STRONG' : accuracy < 50 ? 'WEAK' : 'SEARCHING';
}

function normalizedPoint(raw: NativeTrackedLocation): NativeTrackedLocation | null {
  const lat = Number(raw.lat);
  const lng = Number(raw.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const accuracy = Number(raw.accuracy);
  const speedKmH = Number(raw.speedKmH);
  return {
    lat,
    lng,
    timestamp: raw.timestamp || new Date().toISOString(),
    ...(Number.isFinite(accuracy) && accuracy >= 0 ? { accuracy } : {}),
    ...(Number.isFinite(speedKmH) && speedKmH >= 0 ? { speedKmH } : {}),
    ...(raw.isSimulated === true ? { isSimulated: true } : {}),
  };
}

function deriveSpeedIfNeeded(point: NativeTrackedLocation): number | null {
  if (typeof point.speedKmH === 'number' && Number.isFinite(point.speedKmH)) {
    if (point.speedKmH > MAX_LIVE_SPEED_KMH) return null;
    return point.speedKmH < MIN_LIVE_SPEED_KMH ? 0 : point.speedKmH;
  }

  if (!previousPoint) return null;
  const accuracy = Number(point.accuracy);
  const previousAccuracy = Number(previousPoint.accuracy);
  if (!Number.isFinite(accuracy) || !Number.isFinite(previousAccuracy) || accuracy > 30 || previousAccuracy > 30) return null;

  const currentMs = Date.parse(point.timestamp);
  const previousMs = Date.parse(previousPoint.timestamp);
  const deltaSec = (currentMs - previousMs) / 1000;
  if (!Number.isFinite(deltaSec) || deltaSec <= 0 || deltaSec > 15) return null;

  const distanceMeters = calculateDistance(previousPoint.lat, previousPoint.lng, point.lat, point.lng);
  const noiseFloorMeters = Math.max(3.5, Math.min(9, (accuracy + previousAccuracy) * 0.18));
  if (!Number.isFinite(distanceMeters) || distanceMeters < noiseFloorMeters) return 0;

  const derived = (distanceMeters / deltaSec) * 3.6;
  if (!Number.isFinite(derived) || derived > MAX_LIVE_SPEED_KMH) return null;
  return derived < MIN_LIVE_SPEED_KMH ? 0 : derived;
}

function handleLocation(raw: NativeTrackedLocation) {
  const point = normalizedPoint(raw);
  if (!point) return;

  clearStallTimer();
  const accuracy = typeof point.accuracy === 'number' ? point.accuracy : 999;
  const speed = deriveSpeedIfNeeded(point);
  previousPoint = point;

  setSnapshot({
    accuracy,
    signal: signalForAccuracy(accuracy),
    permissionDenied: false,
    stalled: false,
    liveSpeedKmH: speed,
    liveSpeedUpdatedAt: speed === null ? null : Date.now(),
    latestPoint: point,
  });
}

async function ensureListeners(): Promise<void> {
  if (!supported()) return;
  if (listenerSetup) return listenerSetup;

  listenerSetup = (async () => {
    await NativeActivityLocation.addListener('locationUpdate', handleLocation);
    await NativeActivityLocation.addListener('locationError', (error) => {
      const denied = String(error?.code || '').toLowerCase().includes('denied') || Number(error?.code) === 1;
      setSnapshot({ permissionDenied: denied || snapshot.permissionDenied, stalled: !denied });
    });
    await NativeActivityLocation.addListener('locationAuthorization', (state) => {
      const status = String(state?.status || '').toLowerCase();
      const denied = status === 'denied' || status === 'restricted';
      setSnapshot({ permissionDenied: denied, ...(denied ? { stalled: false } : {}) });
    });
  })().catch((error) => {
    listenerSetup = null;
    throw error;
  });

  return listenerSetup;
}

function prepareTrackingSnapshot(sessionId?: string) {
  clearStallTimer();
  previousPoint = null;
  snapshot = { ...INITIAL_SNAPSHOT, sessionId: sessionId || null };
  notify();
  stallTimer = setTimeout(() => setSnapshot({ stalled: true }), 20000);
}

function resolveSessionId(explicit?: string): string {
  const direct = String(explicit || '').trim();
  if (direct) return direct;
  try {
    const raw = localStorage.getItem(ACTIVE_SESSION_KEY);
    if (!raw) return '';
    const parsed = JSON.parse(raw) as { id?: unknown };
    return typeof parsed?.id === 'string' ? parsed.id.trim() : '';
  } catch {
    return '';
  }
}

function normalizeNativeResult(result: NativeLocationResult | null | undefined): NativeBufferedLocations {
  const owner = typeof result?.sessionId === 'string' && result.sessionId.trim() ? result.sessionId.trim() : null;
  return {
    sessionId: owner,
    locations: Array.isArray(result?.locations) ? result!.locations! : [],
  };
}

export const nativeBackgroundLocationService = {
  isSupported(): boolean {
    return supported();
  },

  getSnapshot(): NativeGpsSnapshot {
    return snapshot;
  },

  subscribe(listener: (next: NativeGpsSnapshot) => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },

  async readBufferedSnapshot(): Promise<NativeBufferedLocations> {
    if (!supported()) return { sessionId: null, locations: [] };
    await ensureListeners();
    return normalizeNativeResult(await NativeActivityLocation.getTrackedLocations());
  },

  async readBuffered(): Promise<NativeTrackedLocation[]> {
    const buffered = await this.readBufferedSnapshot();
    const ownerSessionId = resolveSessionId();
    // Leitura normal da UI é fail-closed: sem owner comprovado e idêntico à
    // sessão local atual, coordenadas persistidas nunca entram no mapa/score.
    if (!ownerSessionId || buffered.sessionId !== ownerSessionId) return [];
    return buffered.locations;
  },

  async start(sessionId?: string): Promise<void> {
    if (!supported()) return;
    const ownerSessionId = resolveSessionId(sessionId);
    if (!ownerSessionId) throw new Error('Sessão ativa ausente para iniciar o GPS nativo.');
    await ensureListeners();
    prepareTrackingSnapshot(ownerSessionId);
    await NativeActivityLocation.startLocationTracking({ sessionId: ownerSessionId });
  },

  /**
   * Reanexa a coleta nativa depois que o WebView/processo JS foi recriado.
   * O plugin só preserva o buffer quando o sessionId salvo pertence exatamente
   * à sessão retomada; qualquer buffer órfão/de outra conta é descartado.
   */
  async resume(sessionId?: string): Promise<void> {
    if (!supported()) return;
    const ownerSessionId = resolveSessionId(sessionId);
    if (!ownerSessionId) throw new Error('Sessão ativa ausente para retomar o GPS nativo.');
    await ensureListeners();
    prepareTrackingSnapshot(ownerSessionId);
    await NativeActivityLocation.resumeLocationTracking({ sessionId: ownerSessionId });
  },

  async collectAndStop(): Promise<NativeTrackedLocation[]> {
    if (!supported()) return [];
    clearStallTimer();
    const result = normalizeNativeResult(await NativeActivityLocation.stopLocationTracking({ clear: false }));
    previousPoint = null;
    snapshot = { ...INITIAL_SNAPSHOT };
    notify();
    return result.locations;
  },

  async stop(): Promise<void> {
    if (!supported()) return;
    clearStallTimer();
    // Encerramento/cancelamento/logout: além de parar o LocationManager,
    // apague o buffer persistido para que coordenadas de uma conta nunca
    // fiquem disponíveis para uma sessão futura no mesmo aparelho.
    await NativeActivityLocation.stopLocationTracking({ clear: true });
    previousPoint = null;
    snapshot = { ...INITIAL_SNAPSHOT };
    notify();
  }
};
