import type { ActivitySession } from '../types';
import { activityService } from './activityService';
import { activityNotificationService } from './activityNotificationService';
import {
  nativeBackgroundLocationService,
  type NativeBufferedLocations,
  type NativeTrackedLocation,
} from './nativeBackgroundLocationService';
import { webGpsTrackingService } from './webGpsTrackingService';

async function readNativeBufferSafely(): Promise<NativeBufferedLocations> {
  try {
    return await nativeBackgroundLocationService.readBufferedSnapshot();
  } catch (error) {
    console.warn('[SessionContinuity] Não foi possível ler o buffer nativo antes da restauração:', error);
    return { sessionId: null, locations: [] };
  }
}

function elapsedSecondsForSession(session: ActivitySession): number {
  const startMs = Date.parse(session.startTime);
  if (!Number.isFinite(startMs)) return 0;
  const pausedMs = Math.max(0, Number(session.pausedMs) || 0);
  const pauseStartedMs = session.isPaused && session.pauseStartedAt ? Date.parse(session.pauseStartedAt) : NaN;
  const currentPauseMs = Number.isFinite(pauseStartedMs) ? Math.max(0, Date.now() - pauseStartedMs) : 0;
  return Math.max(0, Math.floor((Date.now() - startMs - pausedMs - currentPauseMs) / 1000));
}

async function syncAndroidForegroundService(session: ActivitySession): Promise<void> {
  try {
    await activityNotificationService.sync(session, elapsedSecondsForSession(session));
  } catch (error) {
    // O FGS protege a continuidade no Android, mas uma falha transitória da
    // ponte não pode esconder a sessão restaurada. A tela continua disponível
    // e uma nova sincronização poderá ocorrer quando o fluxo ativo montar.
    console.warn('[SessionContinuity] Não foi possível sincronizar o foreground service:', error);
  }
}

/**
 * O restore remoto antigo reinicia o plugin nativo antes de devolver a sessão.
 * Se o localStorage tiver sido perdido/corrompido, isso pode limpar o buffer
 * persistido pelo native antes do webGpsTrackingService conseguir lê-lo.
 * Capturamos esse buffer antes e, nesse caso excepcional, reintroduzimos apenas
 * a cauda posterior ao último checkpoint conhecido para não reordenar a rota.
 * O chamador só chega aqui quando o próprio plugin comprovou o mesmo sessionId.
 */
function replayRecoveredTail(session: ActivitySession, buffered: NativeTrackedLocation[]) {
  if (!session.requiresGpsDistance || session.isPaused || buffered.length === 0) return;

  const current = activityService.getCurrentSession() || session;
  const sessionStartMs = Date.parse(current.startTime);
  const latestCheckpointMs = (current.checkpoints || []).reduce((latest, checkpoint) => {
    const timestamp = Date.parse(checkpoint.timestamp);
    return Number.isFinite(timestamp) ? Math.max(latest, timestamp) : latest;
  }, Number.isFinite(sessionStartMs) ? sessionStartMs : 0);
  const upperBound = Date.now() + 60_000;

  const tail = buffered
    .map((point) => ({ point, timestampMs: Date.parse(point.timestamp) }))
    .filter(({ point, timestampMs }) => Number.isFinite(point.lat)
      && Number.isFinite(point.lng)
      && Number.isFinite(timestampMs)
      && timestampMs > latestCheckpointMs
      && timestampMs <= upperBound)
    .sort((a, b) => a.timestampMs - b.timestampMs);

  for (const { point, timestampMs } of tail) {
    if (typeof point.speedKmH === 'number' && Number.isFinite(point.speedKmH)) {
      activityService.recordGpsSpeedSample(point.speedKmH, point.accuracy);
    }
    activityService.addCheckpoint({
      lat: point.lat,
      lng: point.lng,
      ...(typeof point.accuracy === 'number' ? { accuracy: point.accuracy } : {}),
      ...(typeof point.speedKmH === 'number' ? { speedKmH: point.speedKmH } : {}),
    }, timestampMs);
  }
}

/**
 * Gate 1 — continuidade de sessão.
 *
 * - sessão local encontrada: reconecta o snapshot visual e usa `resume()` no
 *   plugin nativo, preservando o buffer GPS somente quando o owner nativo é a
 *   mesma sessão;
 * - no Android, religa também o foreground service de localização antes de a
 *   sessão voltar ao background; negar notificações não pode interromper GPS;
 * - sessão só encontrada no servidor: captura owner+buffer nativos ANTES do
 *   restore e reaplica a cauda apenas se o sessionId persistido for idêntico;
 * - buffer antigo, órfão ou de outra conta falha fechado e é ignorado;
 * - sessão pausada nunca religa GPS/FGS automaticamente;
 * - falha ao reler o buffer ou sincronizar o FGS não impede a recuperação da
 *   sessão em si.
 */
export async function restoreAndResumeActiveSession(): Promise<ActivitySession | null> {
  const localBeforeRestore = activityService.getCurrentSession();
  const bufferedBeforeRestore = await readNativeBufferSafely();

  const restored = localBeforeRestore || await activityService.restoreActiveSession();
  if (!restored) return null;

  if (!localBeforeRestore) {
    if (bufferedBeforeRestore.sessionId === restored.id) {
      replayRecoveredTail(restored, bufferedBeforeRestore.locations);
    } else if (bufferedBeforeRestore.locations.length > 0) {
      console.warn('[SessionContinuity] Buffer GPS persistido pertence a outra sessão; pontos antigos foram ignorados.');
    }
  }

  const current = activityService.getCurrentSession() || restored;

  // `sync` também encerra qualquer FGS location órfão quando a sessão voltou
  // pausada ou quando não é uma modalidade que precise de GPS contínuo.
  await syncAndroidForegroundService(current);

  if (!current.requiresGpsDistance || current.isPaused) return current;

  if (localBeforeRestore) {
    // O FGS já foi sincronizado acima enquanto o app está visível. A ponte
    // visual começa antes de `resume()` para não perder os primeiros fixes.
    // O plugin só preserva o buffer se o owner persistido for current.id.
    webGpsTrackingService.start(current);
    try {
      await nativeBackgroundLocationService.resume(current.id);
    } catch (error) {
      console.warn('[SessionContinuity] GPS nativo não retomou após reabertura:', error);
    }
  } else {
    // restoreActiveSession() já reativou os coletores. Esta chamada é
    // idempotente e apenas garante que o snapshot visual aponta para a sessão.
    webGpsTrackingService.start(activityService.getCurrentSession() || current);
  }

  return activityService.getCurrentSession() || current;
}
