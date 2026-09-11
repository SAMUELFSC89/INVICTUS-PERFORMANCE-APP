import { auth } from '../firebase';
import { API_CONFIG } from '../config';
import { sessionHeartRateService } from './sessionHeartRateService';
import { readWorkoutHealthRecord } from './workoutFeedbackHistoryService';
import type { WorkoutHealthRecord } from '../core/health/workoutHealthTypes';

const pending = new Map<string, Promise<WorkoutHealthRecord | null>>();

/** A user-requested retry for watch data that arrived after the workout ended. */
export const workoutHealthRefreshService = {
  refresh(record: WorkoutHealthRecord, workoutId: string): Promise<WorkoutHealthRecord | null> {
    const user = auth.currentUser;
    if (!user || !workoutId || workoutId.length > 200 || workoutId.includes('/') || !readWorkoutHealthRecord(record)) {
      return Promise.reject(new Error('Não foi possível identificar este treino na sua conta.'));
    }
    const key = `${user.uid}:${workoutId}`;
    const existing = pending.get(key);
    if (existing) return existing;
    const operation = (async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        const tokenPromise = user.getIdToken();
        const boundedToken = Promise.race([
          tokenPromise,
          new Promise<never>((_, reject) => {
            if (controller.signal.aborted) reject(new Error('A consulta demorou demais. Tente novamente.'));
            else controller.signal.addEventListener('abort', () => reject(new Error('A consulta demorou demais. Tente novamente.')), { once: true });
          }),
        ]);
        const [freshHeartRate, token] = await Promise.all([
          sessionHeartRateService.read(user.uid, record.startedAt, record.endedAt, controller.signal), boundedToken,
        ]);
        if (auth.currentUser?.uid !== user.uid) return null;
        if (!freshHeartRate.samples.length) throw new Error(freshHeartRate.reason || 'Ainda não chegaram leituras deste treino. Sincronize seu relógio e tente novamente.');
        const heartRate = {
          ...freshHeartRate,
          audit: {
            ...freshHeartRate.audit,
            syncHistory: record.heartRate.audit?.syncHistory || [],
          },
        };
        const response = await fetch(`${API_CONFIG.baseUrl}/api/wearables`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ action: 'refresh-session-heart-rate', workoutId, heartRate }), signal: controller.signal,
        });
        const result = await response.json().catch(() => ({}));
        if (auth.currentUser?.uid !== user.uid) return null;
        if (!response.ok) throw new Error(result.error || result.message || 'Não foi possível salvar os batimentos atualizados.');
        const updated = readWorkoutHealthRecord(result.healthSession);
        if (!updated || updated.sessionId !== record.sessionId || updated.startedAt !== record.startedAt || updated.endedAt !== record.endedAt) {
          throw new Error('A atualização não confirmou os dados deste treino.');
        }

        // Best-effort second step: archive the already server-sanitized series in
        // deterministic Firestore chunks. Failure here never rolls back the valid
        // health refresh or affects scoring.
        try {
          const archiveResponse = await fetch(`${API_CONFIG.baseUrl}/api/health`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ action: 'archive-workout-heart-rate', workoutId }), signal: controller.signal,
          });
          if (archiveResponse.ok) {
            const archiveResult = await archiveResponse.json().catch(() => ({}));
            const archived = readWorkoutHealthRecord(archiveResult.healthSession);
            if (archived && archived.sessionId === updated.sessionId) return archived;
          }
        } catch (archiveError) {
          console.warn('[WorkoutHealthRefresh] Série atualizada, mas o arquivo em chunks ficou pendente:', archiveError);
        }
        return updated;
      } catch (error) {
        if (auth.currentUser?.uid !== user.uid) return null;
        if (controller.signal.aborted) throw new Error('A consulta demorou demais. Tente novamente.');
        throw error;
      } finally { clearTimeout(timeout); }
    })();
    pending.set(key, operation);
    void operation.finally(() => { if (pending.get(key) === operation) pending.delete(key); }).catch(() => {});
    return operation;
  },
};
