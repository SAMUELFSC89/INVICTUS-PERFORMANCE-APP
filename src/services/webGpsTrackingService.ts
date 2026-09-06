import { Capacitor } from '@capacitor/core';
import { activityService } from './activityService';
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

function supported(): boolean {
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

  // Se o navegador forneceu speed=0, isso é uma observação válida de que o
  // aparelho está parado. O código antigo tratava 0 como "sem velocidade" e
  // recalculava a partir do deslocamento entre coordenadas, transformando o
  // drift normal do GPS em paces gigantes que mudavam mesmo sem movimento.
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

  // Só derivamos velocidade por deslocamento quando o provedor realmente NÃO
  // informou coords.speed. Nunca substituímos um zero explícito por ruído de
  // posição. Isso mantém Android/web compatível sem fabricar movimento parado.
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
    // Zero deve zerar imediatamente. Suavizar zero junto com a velocidade
    // anterior fazia a tela continuar mostrando 0,8/0,5/0,3 km/h e paces
    // absurdos por vários segundos depois que o atleta já estava parado.
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
    if (!supported()) return;
    if (!session.requiresGpsDistance) return;
    if (watchId !== null && snapshot.sessionId === session.id) return;
    this.stop();

    snapshot = { ...INITIAL_SNAPSHOT, sessionId: session.id };
    notify();
    lastCheckpointTimeAt = 0;
    lastRawGps = null;

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
    this.start(session);
  },

  stop() {
    clearStallTimer();
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
