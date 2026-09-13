import type { ActivitySession } from '../types';
import { activityService } from './activityService';
import { nativeBackgroundLocationService, type NativeTrackedLocation } from './nativeBackgroundLocationService';
import { webGpsTrackingService } from './webGpsTrackingService';

async function readNativeBufferSafely(): Promise<NativeTrackedLocation[]> {
  try {
    return await nativeBackgroundLocationService.readBuffered();
  } catch (error) {
    console.warn('[SessionContinuity] Não foi possível ler o buffer nativo antes da restauração:', error);
    return [];
  }
}

/**
 * O restore remoto antigo reinicia o plugin nativo antes de devolver a sessão.
 * Se o localStorage tiver sido perdido/corrompido, isso pode limpar o buffer
 * persistido pelo native antes do webGpsTrackingService conseguir lê-lo.
 * Capturamos esse buffer antes e, nesse caso excepcional, reintroduzimos apenas
 * a cauda posterior ao último checkpoint conhecido para não reordenar a rota.
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
 *   plugin nativo, preservando o buffer GPS persistido antes do restart;
 * - sessão só encontrada no servidor: captura o buffer nativo ANTES do restore
 *   antigo e reaplica somente a cauda perdida depois que a sessão volta;
 * - sessão pausada nunca religa GPS automaticamente;
 * - falha ao reler o buffer não impede a recuperação da sessão em si.
 */
export async function restoreAndResumeActiveSession(): Promise<ActivitySession | null> {
  const localBeforeRestore = activityService.getCurrentSession();
  const bufferedBeforeRestore = await readNativeBufferSafely();

  const restored = localBeforeRestore || await activityService.restoreActiveSession();
  if (!restored) return null;

  if (!localBeforeRestore) {
    replayRecoveredTail(restored, bufferedBeforeRestore);
  }

  const current = activityService.getCurrentSession() || restored;
  if (!current.requiresGpsDistance || current.isPaused) return current;

  if (localBeforeRestore) {
    // A ponte visual começa primeiro; assim ela já está inscrita quando o
    // plugin retoma a emissão de novos pontos. `resume()` não apaga o buffer.
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
