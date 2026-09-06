import { Capacitor } from '@capacitor/core';
import { activityService } from './activityService';
import { calculateDistance } from '../lib/runUtils';
import type { ActivitySession } from '../types';

/**
 * ACT-10 (auditoria 6167c8f): "Minimizar cardio na versão web mantém tempo
 * mas interrompe coleta de rota". O rastreamento de GPS via
 * navigator.geolocation.watchPosition() vivia inteiramente dentro do
 * useEffect de src/pages/Challenges.tsx -- pertencia ao componente. Tocar em
 * "Minimizar atividade" navega para /activity/exit (ver
 * Challenges.tsx:closeFlow), que desmonta Challenges.tsx e dispara o cleanup
 * do efeito, que chamava navigator.geolocation.clearWatch() e liberava o
 * wake lock incondicionalmente. O cronômetro continuava correndo (lê apenas
 * o timestamp da sessão via polling), mas nenhum novo checkpoint de rota
 * era gravado até o atleta reabrir a tela de cardio -- o trecho percorrido
 * nesse meio-tempo desaparecia silenciosamente da rota final.
 *
 * No app nativo (iOS/Android) isso não acontece porque
 * nativeBackgroundLocationService delega a um serviço de segundo plano do
 * próprio sistema operacional, imune ao ciclo de vida do React. Na web/PWA
 * não existe equivalente -- então este módulo passa a ser o dono único do
 * watchPosition: iniciado/parado pelos MESMOS pontos que já controlam o
 * coletor nativo em activityService.ts (startSession, restoreActiveSession,
 * endSession, cancelSession), nunca pelo mount/unmount de um componente.
 * Uma tela (Challenges.tsx) apenas assina o snapshot para exibir sinal,
 * precisão e distância/velocidade ao vivo -- deixar de renderizá-la não
 * para mais a coleta, exatamente como pedido no fix sugerido pela auditoria
 * ("tela passa a ser apenas apresentação e controle").
 *
 * Limitação inerente ao navegador (fora do escopo deste fix, e explicitada
 * separadamente conforme o "expected" da própria auditoria): nada disso
 * sobrevive a fechar a aba ou a um reload completo da página -- só a
 * Service Worker resolveria isso, e não é o que ACT-10 pede. O que este
 * módulo garante é que a coleta sobrevive a NAVEGAÇÃO DENTRO DO APP aberto
 * (SPA/React Router), que é exatamente o cenário reproduzido no achado.
 */

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
  // O coletor nativo (nativeBackgroundLocationService) já cobre iOS/Android
  // com um serviço de segundo plano real; rodar este watcher também lá seria
  // coleta duplicada e desnecessária. Este serviço só faz sentido no
  // navegador/PWA, onde não existe outro coletor que sobreviva à troca de
  // tela dentro do app.
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
  // Um fix sem precisão finita não sustenta nem distância de rota nem uma
  // velocidade ao vivo confiável -- tratamos como sinal fraco em vez de
  // deixar NaN vazar para a tela ou para o payload de auditoria.
  const accuracy = Number.isFinite(rawAccuracy) && rawAccuracy >= 0 ? rawAccuracy : 999;
  const { speed } = position.coords;
  clearStallTimer();

  // A sessão pode ter mudado (nova atividade) ou encerrado enquanto este fix
  // estava a caminho -- nunca grava num alvo que não é mais o ativo.
  const currentSession = activityService.getCurrentSession();
  if (!currentSession || currentSession.id !== session.id) return;

  if (currentSession.isPaused) {
    // Durante uma pausa o aparelho pode continuar entregando fixes, mas eles
    // não representam esforço da atividade -- não conectamos velocidade nem
    // rota até o atleta retomar (o próprio addCheckpoint() também recusaria
    // este ponto, mas nem chegamos a chamá-lo).
    setSnapshot({ accuracy, signal: computeSignal(accuracy), stalled: false, liveSpeedKmH: null, liveSpeedUpdatedAt: null });
    return;
  }

  // #98: velocidade INSTANTÂNEA (Doppler do chip de GPS) em todo fix
  // recebido, independente do throttle de checkpoints abaixo -- evita que um
  // pico real (ex.: ônibus acelerando) desapareça na suavização por
  // distância/tempo entre checkpoints espaçados.
  let instantSpeedKmH = accuracy <= 50 && typeof speed === 'number' && Number.isFinite(speed) && speed >= 0
    ? speed * 3.6
    : null;

  const currentRaw = {
    lat: position.coords.latitude,
    lng: position.coords.longitude,
    timestamp: position.timestamp || Date.now(),
    accuracy,
  };
  const previousRaw = lastRawGps;
  // Alguns aparelhos Android não expõem coords.speed (ou reportam 0 quando a
  // leitura Doppler não está disponível). Deriva entre fixes consecutivos
  // quando a leitura veio ausente/zerada e o deslocamento supera o ruído
  // compatível com a precisão dos dois pontos.
  if ((instantSpeedKmH === null || instantSpeedKmH <= 0.5) && previousRaw && accuracy <= 30) {
    const deltaSec = (currentRaw.timestamp - previousRaw.timestamp) / 1000;
    if (deltaSec > 0 && deltaSec <= 15) {
      const distanceMeters = calculateDistance(previousRaw.lat, previousRaw.lng, currentRaw.lat, currentRaw.lng);
      const noiseFloorMeters = Math.max(2.5, Math.min(8, (previousRaw.accuracy + accuracy) * 0.12));
      if (distanceMeters >= noiseFloorMeters) instantSpeedKmH = (distanceMeters / deltaSec) * 3.6;
    }
  }
  if (accuracy <= 30) lastRawGps = currentRaw;
  // Mesmo teto de sanidade do acumulador da sessão: evita que um valor
  // espúrio do bridge GPS apareça na tela, mesmo que o servidor descarte
  // esse pico depois de qualquer forma.
  if (instantSpeedKmH !== null && instantSpeedKmH > 300) instantSpeedKmH = null;

  let nextLiveSpeed = snapshot.liveSpeedKmH;
  let nextLiveSpeedUpdatedAt = snapshot.liveSpeedUpdatedAt;
  if (instantSpeedKmH !== null) {
    activityService.recordGpsSpeedSample(instantSpeedKmH, accuracy);
    // Suavização curta apenas para leitura ao vivo -- a auditoria recebe
    // todas as amostras/checkpoints e não confia neste valor visual.
    nextLiveSpeed = nextLiveSpeed === null ? instantSpeedKmH : nextLiveSpeed * 0.65 + instantSpeedKmH * 0.35;
    nextLiveSpeedUpdatedAt = Date.now();
  }

  let nextDistanceKm = snapshot.liveDistanceKm;
  const now = Date.now();
  // Dois segundos preservam curvas, aceleração e velocidade como um fluxo
  // GPS esportivo. O servidor refaz a distância e elimina outliers.
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
  // #168: erro de posição indisponível/timeout (code 2/3) -- o timer de
  // estagnação abaixo cobre o caso de nenhum callback chegar; isto cobre o
  // caso do provedor nativo desistir e reportar erro explicitamente.
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

  /** Idempotente: chamar de novo para a MESMA sessão já em rastreamento não reinicia nada. */
  start(session: ActivitySession) {
    if (!supported()) return;
    if (!session.requiresGpsDistance) return;
    if (watchId !== null && snapshot.sessionId === session.id) return;
    this.stop();

    snapshot = { ...INITIAL_SNAPSHOT, sessionId: session.id };
    notify();
    lastCheckpointTimeAt = 0;
    lastRawGps = null;

    // #168: se nenhum fix chegar em 20s (prédio, GPS travado no provedor,
    // callback perdido), o indicador ficava preso para sempre em "Buscando
    // sinal..." sem nenhuma saída visível.
    stallTimer = setTimeout(() => setSnapshot({ stalled: true }), 20000);

    // Tela ligada durante o cardio ao ar livre. Falha aqui (API indisponível/
    // negada) nunca deve travar o rastreamento.
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

  /** #168: reinicia o watch do zero sem descartar a sessão em andamento. */
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

  /**
   * O primeiro fix depois de uma pausa não pode derivar velocidade nem
   * conectar o trajeto com o ponto anterior ao intervalo parado -- espelha
   * o que o efeito antigo em Challenges.tsx fazia com suas próprias refs.
   */
  resetForPauseToggle(isPaused: boolean) {
    lastRawGps = null;
    lastCheckpointTimeAt = isPaused ? Date.now() : 0;
    if (isPaused) setSnapshot({ liveSpeedKmH: null, liveSpeedUpdatedAt: null });
  },
};
