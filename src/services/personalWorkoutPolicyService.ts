import { auth } from '../firebase';
import { API_CONFIG } from '../config';
import type { ActivityCompetitionPolicy } from '../types';

/**
 * Emite uma autorização de treino explicitamente PESSOAL no servidor.
 * A decisão não é um bypass de frontend: o snapshot persistido nasce sem
 * contextos competitivos, portanto não exige check-in/GPS/motion e não pode
 * alimentar ranking/campeonato.
 */
export async function resolvePersonalWorkoutPolicy(): Promise<ActivityCompetitionPolicy> {
  const user = auth.currentUser;
  if (!user) throw new Error('Usuário não autenticado');
  const token = await user.getIdToken();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(`${API_CONFIG.baseUrl}/api/activity-policy`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        activityType: 'workout',
        isIndoorCardio: false,
        requestedMode: 'personal',
      }),
    });
    const result = await response.json().catch(() => ({}));
    const validPersonalPolicy = response.ok
      && result?.version === 'activity-competition-v2'
      && Boolean(result?.snapshotId)
      && Boolean(result?.sessionId)
      && Array.isArray(result?.contexts)
      && result.contexts.length === 0
      && result.requiresSecurityReview === false
      && result.requiresGymCheckIn === false
      && result.requiresContinuousGps === false
      && result.requiresMotionSensors === false;
    if (!validPersonalPolicy) {
      throw new Error(result?.error || 'Não foi possível iniciar este treino no modo pessoal.');
    }
    return result as ActivityCompetitionPolicy;
  } catch (error: any) {
    if (error?.name === 'AbortError') throw new Error('Tempo limite ao preparar o treino pessoal. Tente novamente.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
