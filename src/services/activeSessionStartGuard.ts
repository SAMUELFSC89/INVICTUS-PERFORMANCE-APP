import { collection, getDocs, query, where } from 'firebase/firestore';
import type { ActivitySession } from '../types';
import { auth, db } from '../firebase';
import { activityService } from './activityService';

const MAX_REMOTE_SESSION_MINUTES = {
  workout: 240,
  cardio: 360,
} as const;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('ACTIVE_SESSION_CHECK_TIMEOUT')), ms);
    promise.then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); },
    );
  });
}

function isTombstoned(sessionId: string): boolean {
  try {
    return Boolean(localStorage.getItem(`sessao_encerrada_${sessionId}`));
  } catch {
    return false;
  }
}

function isStillPotentiallyActive(data: Record<string, unknown>): boolean {
  const sessionId = String(data.id || '');
  if (!sessionId || isTombstoned(sessionId)) return false;

  const type = data.type === 'cardio' ? 'cardio' : 'workout';
  const startTimeMs = Date.parse(String(data.startTime || ''));
  if (!Number.isFinite(startTimeMs)) return true;

  const pausedMs = Math.max(0, Number(data.pausedMs) || 0);
  const pauseStartedAtMs = data.pauseStartedAt ? Date.parse(String(data.pauseStartedAt)) : NaN;
  const openPauseMs = Number.isFinite(pauseStartedAtMs) ? Math.max(0, Date.now() - pauseStartedAtMs) : 0;
  const elapsedActiveMinutes = (Date.now() - startTimeMs - pausedMs - openPauseMs) / 60000;
  return elapsedActiveMinutes <= MAX_REMOTE_SESSION_MINUTES[type];
}

/**
 * Fail-closed guard used only before opening a NEW activity flow.
 *
 * restoreActiveSession() is intentionally best-effort because passive screens
 * must remain usable offline. A start CTA has a different safety requirement:
 * a Firestore failure cannot be interpreted as "there is no active session",
 * otherwise a second workout may be created while the first one still exists.
 */
export async function verifyActiveSessionBeforeStart(): Promise<ActivitySession | null> {
  const localSession = activityService.getCurrentSession();
  if (localSession) return localSession;

  const user = auth.currentUser;
  if (!user) throw new Error('Entre novamente na sua conta antes de iniciar uma atividade.');

  let snapshot;
  try {
    snapshot = await withTimeout(
      getDocs(query(
        collection(db, 'active_sessions'),
        where('userId', '==', user.uid),
        where('status', '==', 'active'),
      )),
      5000,
    );
  } catch (error) {
    console.warn('[ActiveSessionStartGuard] Não foi possível confirmar sessões ativas:', error);
    throw new Error('Não foi possível verificar sua atividade em andamento. Confira a conexão e tente novamente.');
  }

  const hasPotentialActiveSession = snapshot.docs.some(item => isStillPotentiallyActive(item.data() as Record<string, unknown>));
  if (!hasPotentialActiveSession) return null;

  // A consulta estrita confirmou que há uma sessão remota. Agora reutilizamos
  // o restaurador oficial para reconstruir todos os campos e rastreadores.
  const restored = await activityService.restoreActiveSession();
  if (restored) return restored;

  // Nunca liberar um novo início quando o servidor afirmou que existe uma
  // sessão mas o cliente não conseguiu reconstruí-la com segurança.
  throw new Error('Existe uma atividade em andamento, mas não foi possível recuperá-la com segurança. Tente novamente antes de iniciar outra.');
}
