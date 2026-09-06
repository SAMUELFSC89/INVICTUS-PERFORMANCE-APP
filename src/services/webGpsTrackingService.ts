import { Capacitor } from '@capacitor/core';
import { activityService } from './activityService';
import { nativeBackgroundLocationService, type NativeGpsSnapshot } from './nativeBackgroundLocationService';
import { calculateDistance } from '../lib/runUtils';
import type { ActivitySession } from '../types';

export interface WebGpsSnapshot {
  sessionId: string | null;
  accuracy: number | null;
  signal: 'SEARCHING' | 'WEAK' | 'STRONG';
  permissionDenied: boolean;
  stalled: boolean;
  liveDistanceKm: number;
  liveSpeedKmH: number | null;
  liveSpeedUpdatedAt: number | null;
}

const INITIAL_SNAPSHOT: WebGpsSnapshot = {
  sessionId: null,
  accuracy: null,
  signal: 'SEARCHING',
  permissionDenied: false,
  stalled: false,
  liveDistanceKm: 0,
  liveSpeedKmH: null,
  liveSpeedUpdatedAt: null,
};

const MIN_LIVE_SPEED_KMH = 1.0;
const MAX_LIVE_SPEED_KMH = 300;

let watchId: number | null = null;
let nativeUnsubscribe: (() => void) | null = null;
let stallTimer: ReturnType<typeof setTimeout> | null = null;
let wakeLock: any = null;
let snapshot: WebGpsSnapshot = { ...INITIAL_SNAPSHOT };
let lastCheckpointTimeAt = 0;
let lastRawGps: { lat: number; lng: number; timestamp: number; accuracy: number } | null = null;
const listeners = new Set<(snap: WebGpsSnapshot) => void>();

function notify() {
  const current = snapshot;
  listeners.forEach((listener) => {
    try { listener(current); } catch (error) { console.warn('[webGpsTrackingService] Listener falhou:', error); }
  });
}

function setSnapshot(patch: Partial<WebGpsSnapshot>) {
  snapshot = { ...snapshot, ...patch };
  notify();
}

function webSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.geolocation && !Capacitor.isNativePlatform();
}

function clearStallTimer() {
  if (stallTimer !== null) { clearTimeout(stallTimer); stallTimer = null; }
}

function releaseWakeLock() {
  if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
}

function computeSignal(accuracy: number): WebGpsSnapshot['signal'] {
  return accuracy < 20 ? 'STRONG' : accuracy < 50 ? 'WEAK' : 'SEARCHING';
}

function ingestNativeSnapshot(session: ActivitySession, native: NativeGpsSnapshot) {
  const currentSession = activityService.getCurrentSession();
  if (!currentSession || currentSession.id !== session.id) return;

  const point = native.latestPoint;
  if (point && !currentSession.isPaused) {
    const now = Date.now();
    const accuracy = typeof point.accuracy === 'number' ? point.accuracy : undefined;
    const speedKmH = typeof native.liveSpeedKmH === 'number' ? native.liveSpeedKmH : undefined;

    if (typeof speedKmH === 'number') activityService.recordGpsSpeedSample(speedKmH, accuracy);
    if (now - lastCheckpointTimeAt >= 2000) {
      lastCheckpointTimeAt = now;
      activityService.addCheckpoint({
        lat: point.lat,
        lng: point.lng,
        ...(typeof accuracy === 'number' ? { accuracy } : {}),
        ...(typeof speedKmH === 'number' ? { speedKmH } : {}),
      }, Date.parse(point.timestamp));
    }
  }

  const updated = activityService.getCurrentSession();
  const distance = updated ? activityService.calculateSessionDistance(updated) : snapshot.liveDistanceKm;
  setSnapshot({
    sessionId: session.id,
    accuracy: native.accuracy,
    signal: native.signal,
    permissionDenied: native.permissionDenied,
    stalled: native.stalled,
    liveDistanceKm: distance,
    liveSpeedKmH: currentSession.isPaused ? null : native.liveSpeedKmH,
    liveSpeedUpdatedAt: currentSession.isPaused ? null : native.liveSpeedUpdatedAt,
  });
}

function handlePosition(session: ActivitySession, position: GeolocationPosition) {
  const rawAccuracy = Number(position.coords.accuracy);
  const accuracy = Number.isFinite(rawAccuracy) && rawAccuracy >= 0 ? rawAccuracy : 999;
  const { speed } = position.coords;
  clearStallTimer();

  const currentSession = activityService.getCurrentSession();
  if (!currentSession || currentSession.id !== session.id) return;

  if (currentSession.isPaused) {
    setSnapshot({ accuracy, signal: computeSignal(accuracy), stalled: false, liveSpeedKmH: null, liveSpeedUpdatedAt: null });
    return;
  }

  // speed=0 é uma observação válida de repouso. Antes o zero acionava o
  // fallback por deslocamento e o drift das coordenadas virava um pace enorme.
  const hasReportedSpeed = accuracy <= 50 && typeof speed === 'number' && Number.isFinite(speed) && speed >= 0;
  let instantSpeedKmH = hasReportedSpeed ? speed * 3.6 : null;
  if (instantSpeedKmH !== null) {
    if (instantSpeedKmH > MAX_LIVE_SPEED_KMH) instantSpeedKmH = null;
    else if (instantSpeedKmH < MIN_LIVE_SPEED_KMH) instantSpeedKmH = 0;
  }

  const currentRaw = {
    lat: position.coords.latitude,
    lng: position.coords.longitude,
    timestamp: position.timestamp || Date.now(),
    accuracy,
  };
  const previousRaw = lastRawGps;

  // Só deriva velocidade se o navegador NÃO forneceu coords.speed. Nunca
  // substitui zero explícito por ruído de posição.
  if (instantSpeedKmH === null && previousRaw && accuracy <= 30) {
    const deltaSec = (currentRaw.timestamp - previousRaw.timestamp) / 1000;
    if (deltaSec > 0 && deltaSec <= 15) {
      const distanceMeters = calculateDistance(previousRaw.lat, previousRaw.lng, currentRaw.lat, currentRaw.lng);
      const noiseFloorMeters = Math.max(3.5, Math.min(9, (previousRaw.accuracy + accuracy) * 0.18));
      if (distanceMeters >= noiseFloorMeters) {
        const derived = (distanceMeters / deltaSec) * 3.6;
        if (Number.isFinite(derived) && derived <= MAX_LIVE_SPEED_KMH) instantSpeedKmH = derived < MIN_LIVE_SPEED_KMH ? 0 : derived;
      } else {
        instantSpeedKmH = 0;
      }
    }
  }
  if (accuracy <= 30) lastRawGps = currentRaw;

  let nextLiveSpeed = snapshot.liveSpeedKmH;
  let nextLiveSpeedUpdatedAt = snapshot.liveSpeedUpdatedAt;
  if (instantSpeedKmH !== null) {
    activityService.recordGpsSpeedSample(instantSpeedKmH, accuracy);
    if (instantSpeedKmH === 0) nextLiveSpeed = 0;
    else nextLiveSpeed = nextLiveSpeed === null || nextLiveSpeed < MIN_LIVE_SPEED_KMH
      ? instantSpeedKmH
      : nextLiveSpeed * 0.65 + instantSpeedKmH * 0.35;
    nextLiveSpeedUpdatedAt = Date.now();
  }

  let nextDistanceKm = snapshot.liveDistanceKm;
  const now = Date.now();
  if (now - lastCheckpointTimeAt >= 2000) {
    lastCheckpointTimeAt = now;
    activityService.addCheckpoint({
      lat: position.coords.latitude,
      lng: position.coords.longitude,
      accuracy,
      ...(instantSpeedKmH !== null ? { speedKmH: instantSpeedKmH } : {}),
    }, position.timestamp);

    const updated = activityService.getCurrentSession();
    if (updated) nextDistanceKm = activityService.calculateSessionDistance(updated);
  }

  setSnapshot({
    accuracy,
    signal: computeSignal(accuracy),
    stalled: false,
    liveSpeedKmH: nextLiveSpeed,
    liveSpeedUpdatedAt: nextLiveSpeedUpdatedAt,
    liveDistanceKm: nextDistanceKm,
  });
}

function handleError(err: GeolocationPositionError) {
  console.warn('[webGpsTrackingService] Erro no watchPosition durante a sessão de cardio:', err);
  if (err.code === 1) { setSnapshot({ permissionDenied: true }); return; }
  if (err.code === 2 || err.code === 3) setSnapshot({ stalled: true });
}

export const webGpsTrackingService = {
  getSnapshot(): WebGpsSnapshot {
    return snapshot;
  },

  subscribe(listener: (snap: WebGpsSnapshot) => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },

  start(session: ActivitySession) {
    if (!session.requiresGpsDistance) return;
    if ((watchId !== null || nativeUnsubscribe !== null) && snapshot.sessionId === session.id) return;
    this.stop();

    snapshot = { ...INITIAL_SNAPSHOT, sessionId: session.id };
    notify();
    lastCheckpointTimeAt = 0;
    lastRawGps = null;

    // No iOS/Android Capacitor, o rastreador nativo é o dono da coleta. Antes
    // esta função retornava sem fazer nada, mas Challenges.tsx só assinava ESTE
    // snapshot; resultado: o iPhone coletava em segundo plano e a tela ficava
    // eternamente em "Buscando GPS". Agora o mesmo snapshot recebe o stream
    // nativo e alimenta mapa, distância, velocidade e pace em tempo real.
    if (nativeBackgroundLocationService.isSupported()) {
      const applyNative = (native: NativeGpsSnapshot) => ingestNativeSnapshot(session, native);
      nativeUnsubscribe = nativeBackgroundLocationService.subscribe(applyNative);
      applyNative(nativeBackgroundLocationService.getSnapshot());
      void nativeBackgroundLocationService.readBuffered()
        .then((points) => {
          for (const point of points) {
            const current = activityService.getCurrentSession();
            if (!current || current.id !== session.id || current.isPaused) break;
            activityService.addCheckpoint({
              lat: point.lat,
              lng: point.lng,
              ...(typeof point.accuracy === 'number' ? { accuracy: point.accuracy } : {}),
              ...(typeof point.speedKmH === 'number' ? { speedKmH: point.speedKmH < MIN_LIVE_SPEED_KMH ? 0 : point.speedKmH } : {}),
            }, Date.parse(point.timestamp));
          }
          const updated = activityService.getCurrentSession();
          if (updated) setSnapshot({ liveDistanceKm: activityService.calculateSessionDistance(updated) });
        })
        .catch((error) => console.warn('[webGpsTrackingService] Não foi possível ler o buffer nativo:', error));
      return;
    }

    if (!webSupported()) return;
    stallTimer = setTimeout(() => setSnapshot({ stalled: true }), 20000);

    if ('wakeLock' in navigator) {
      (navigator as any).wakeLock.request('screen')
        .then((lock: any) => { wakeLock = lock; })
        .catch((err: any) => console.warn('[webGpsTrackingService] Wake Lock request failed:', err));
    }

    watchId = navigator.geolocation.watchPosition(
      (position) => handlePosition(session, position),
      handleError,
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 }
    );
  },

  retry(session: ActivitySession) {
    this.stop();
    // O rastreador nativo continua sendo controlado pelo activityService. Em
    // iOS/Android, retry reconecta a ponte visual e reinicia a coleta nativa.
    if (nativeBackgroundLocationService.isSupported()) {
      void nativeBackgroundLocationService.start(session.id)
        .catch((error) => console.warn('[webGpsTrackingService] Retry nativo falhou:', error));
    }
    this.start(session);
  },

  stop() {
    clearStallTimer();
    nativeUnsubscribe?.();
    nativeUnsubscribe = null;
    if (watchId !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchId);
    }
    watchId = null;
    releaseWakeLock();
    lastCheckpointTimeAt = 0;
    lastRawGps = null;
    snapshot = { ...INITIAL_SNAPSHOT };
    notify();
  },

  resetForPauseToggle(isPaused: boolean) {
    lastRawGps = null;
    lastCheckpointTimeAt = isPaused ? Date.now() : 0;
    if (isPaused) setSnapshot({ liveSpeedKmH: null, liveSpeedUpdatedAt: null });
  },
};
