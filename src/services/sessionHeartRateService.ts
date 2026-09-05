import { Capacitor } from '@capacitor/core';
import type { HealthSample } from 'capgo-capacitor-health';
import { auth } from '../firebase';
import type { WorkoutHeartRateEvidence } from '../core/health/workoutHealthTypes';
import { WearableManager } from './wearables/WearableManager';
import { readCompleteHealthRange } from './wearables/HealthVitalsProvider';

export const SESSION_HEART_RATE_TIMEOUT_MS = 4500;
export const SESSION_HEART_RATE_MAX_SAMPLES = 5000;
/** Conservative app rule, not a HealthKit guarantee or medical threshold. */
export const SESSION_HEART_RATE_MAX_INTERVAL_MS = 5000;
type NativeSource = 'apple_health' | 'health_connect';

const unavailable = (reason: string, status: WorkoutHeartRateEvidence['status'] = 'unavailable', source: NativeSource | null = null, truncated = false): WorkoutHeartRateEvidence => ({
  status, source, sourceKey: null, samples: [], fetchedAt: new Date().toISOString(), truncated, reason,
});

function strictTime(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Device/origin identifiers only. A display name is not a device identity. */
export function sessionHeartRateSourceKey(sample: Partial<HealthSample>, source: NativeSource): string | null {
  const fields = [sample.dataOrigin || sample.sourceId, sample.localIdentifier,
    sample.deviceManufacturer, sample.deviceModel, sample.sourceProductType, sample.deviceType]
    .map(value => typeof value === 'string' ? value.trim() : '');
  if (!fields.some(Boolean)) return null;
  const key = `${source}:${JSON.stringify(fields)}`;
  // Long identifiers must not be truncated into a false match with another
  // source. Unknown identity is safer than an invented or colliding key.
  return key.length <= 256 ? key : null;
}

/** Pure boundary: no means, timestamps, missing values or device names are fabricated. */
export function normalizeSessionHeartRateEvidence(
  records: readonly HealthSample[], source: NativeSource, startedAt: string, endedAt: string,
): WorkoutHeartRateEvidence {
  const start = strictTime(startedAt);
  const end = strictTime(endedAt);
  if (start === null || end === null || end <= start) return unavailable('O intervalo do treino não possui horários válidos.');

  type Origin = { key: string | null; values: Map<number, number>; conflicts: Set<number> };
  const origins = new Map<string, Origin>();
  let excluded = 0;
  let shortIntervals = 0;
  for (const record of records) {
    if (!record || record.dataType !== 'heartRate') { excluded++; continue; }
    const sampleStart = strictTime(record.startDate);
    const sampleEnd = strictTime(record.endDate);
    // Apple HKQuantitySample may represent an interval. Short native windows
    // retain their real end timestamp; long windows cannot become invented
    // points within one exercise. Never expand or interpolate quantities.
    if (sampleStart === null || sampleEnd === null || sampleEnd < sampleStart || sampleEnd - sampleStart > SESSION_HEART_RATE_MAX_INTERVAL_MS
      || record.unit !== 'bpm'
      || typeof record.value !== 'number' || !Number.isFinite(record.value) || record.value < 30 || record.value > 240
      || record.recordingMethod === 'manual') { excluded++; continue; }
    if (sampleStart < start || sampleEnd >= end) continue;
    if (sampleEnd > sampleStart) shortIntervals++;
    const key = sessionHeartRateSourceKey(record, source);
    const groupKey = key || '__unknown_origin__';
    const origin = origins.get(groupKey) || { key, values: new Map<number, number>(), conflicts: new Set<number>() };
    if (origin.conflicts.has(sampleEnd)) { excluded++; continue; }
    const existing = origin.values.get(sampleEnd);
    if (existing !== undefined && existing !== record.value) {
      // Two contradictory readings for the same instant and origin are not
      // averaged, and input order must never decide the user's heart rate.
      origin.values.delete(sampleEnd);
      origin.conflicts.add(sampleEnd);
      excluded += 2;
    } else {
      origin.values.set(sampleEnd, record.value);
    }
    origins.set(groupKey, origin);
  }

  const candidates = [...origins.values()].filter(origin => origin.values.size > 0)
    .sort((a, b) => Number(b.key !== null) - Number(a.key !== null) || b.values.size - a.values.size || (a.key || '').localeCompare(b.key || ''));
  const selected = candidates[0];
  if (!selected) return unavailable(records.length
    ? 'As leituras recebidas não contêm pontos de batimentos utilizáveis no intervalo marcado.'
    : 'Nenhuma leitura de batimentos foi recebida neste intervalo. Pode faltar sincronização do relógio ou acesso de leitura.',
  records.length ? 'unavailable' : 'pending', source);

  const sorted = [...selected.values.entries()].sort(([a], [b]) => a - b);
  const truncated = sorted.length > SESSION_HEART_RATE_MAX_SAMPLES;
  const reasons: string[] = [];
  if (candidates.length > 1) reasons.push('Foram recebidas origens diferentes; usamos somente uma origem, sem combinar relógios ou aplicativos.');
  if (selected.key === null) reasons.push('A fonte não identificou a origem técnica das leituras. Comparações entre sessões ficam limitadas.');
  if (excluded) reasons.push('Leituras manuais, fora do intervalo, sem horário pontual válido ou conflitantes foram excluídas.');
  if (shortIntervals) reasons.push('Leituras em janelas de até 5 segundos usam o horário final informado pela fonte. Não foram criados pontos intermediários.');
  if (truncated) reasons.push('O volume de dados excedeu o limite desta análise. Apenas as primeiras 5.000 leituras válidas da origem selecionada estão disponíveis.');
  return {
    status: candidates.length > 1 || excluded > 0 || truncated ? 'partial' : 'available', source, sourceKey: selected.key,
    samples: sorted.slice(0, SESSION_HEART_RATE_MAX_SAMPLES).map(([time, bpm]) => ({ timestamp: new Date(time).toISOString(), bpm })),
    fetchedAt: new Date().toISOString(), truncated,
    ...(reasons.length ? { reason: reasons.join(' ') } : {}),
  };
}

/** Private health-only reading; does not request permissions or query a native workout.
 * The same bounded reader supports finalization and a later explicit refresh.
 */
export const sessionHeartRateService = {
  async read(uid: string, startedAt: string, endedAt: string, signal?: AbortSignal): Promise<WorkoutHeartRateEvidence> {
    if (!uid || auth.currentUser?.uid !== uid) return unavailable('A conta mudou. A leitura de batimentos foi cancelada.');
    const start = strictTime(startedAt);
    const end = strictTime(endedAt);
    if (start === null || end === null || end <= start || end - start > 12 * 3600_000) return unavailable('O intervalo do treino não possui horários válidos.');
    const platform = Capacitor.getPlatform();
    if (!Capacitor.isNativePlatform() || (platform !== 'ios' && platform !== 'android')) {
      return unavailable('A leitura de batimentos do aparelho está disponível no aplicativo iOS ou Android conectado à Saúde.');
    }
    const source: NativeSource = platform === 'ios' ? 'apple_health' : 'health_connect';
    const controller = new AbortController();
    let timedOut = false;
    let onAbort: (() => void) | undefined;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, SESSION_HEART_RATE_TIMEOUT_MS);
    const externalAbort = () => controller.abort();
    signal?.addEventListener('abort', externalAbort, { once: true });
    if (signal?.aborted) controller.abort();

    try {
      const manager = WearableManager.getInstance();
      const assertOwner = () => {
        if (controller.signal.aborted || auth.currentUser?.uid !== uid || manager.getAuthenticatedUserId() !== uid) {
          throw new Error('HEALTH_READ_CANCELLED');
        }
      };
      const operation = async (): Promise<WorkoutHeartRateEvidence> => {
        assertOwner();
        // This gate checks the user's configured connection. It intentionally
        // does not call provider.isConnected(), which can require GPS/route
        // permissions unrelated to an already-authorized heart-rate reading.
        const providers = await manager.getConnectedNativeProviders();
        assertOwner();
        if (!providers.some(provider => provider.id === source) || !manager.isProviderEnabledForUser(source, uid)) {
          return unavailable('A conexão de Saúde está desativada para esta conta.', 'unavailable', source);
        }
        const records = await readCompleteHealthRange('heartRate', new Date(start), new Date(end), 1000, controller.signal);
        assertOwner();
        if (!manager.isProviderEnabledForUser(source, uid)) return unavailable('A conexão de Saúde foi desativada durante a leitura.');
        return normalizeSessionHeartRateEvidence(records, source, startedAt, endedAt);
      };
      const cancelled = new Promise<never>((_, reject) => {
        onAbort = () => reject(new Error('HEALTH_READ_CANCELLED'));
        if (controller.signal.aborted) onAbort();
        else controller.signal.addEventListener('abort', onAbort, { once: true });
      });
      return await Promise.race([operation(), cancelled]);
    } catch (error) {
      if (auth.currentUser?.uid !== uid) return unavailable('A conta mudou. A leitura de batimentos foi cancelada.');
      if (timedOut) return unavailable('A leitura demorou mais que o esperado. Os batimentos podem ser atualizados após a sincronização.', 'pending', source);
      if (controller.signal.aborted) return unavailable('A leitura de batimentos foi cancelada.');
      const message = error instanceof Error ? error.message : '';
      if (/permission|authoriz|denied|permiss|autoriz|negad/i.test(message)) {
        return unavailable('Os batimentos não puderam ser lidos. Confira o acesso de leitura nas configurações de Saúde.', 'unavailable', source);
      }
      const truncated = /limite|incompleto|denso|janela menor/i.test(message);
      return unavailable(truncated
        ? 'O histórico de batimentos não pôde ser lido por completo. Atualize a análise após a sincronização.'
        : 'Os batimentos ainda não puderam ser consultados. Atualize a análise após a sincronização.', 'pending', source, truncated);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', externalAbort);
      if (onAbort) controller.signal.removeEventListener('abort', onAbort);
    }
  },
};
