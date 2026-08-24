import { auth, db, handleFirestoreError, OperationType } from '../firebase';
import { collection, getDocs, limit, query, where } from 'firebase/firestore';
import type { Workout } from '../types';
import { normalizeActivityValidationStatus, readActivityTimestamp } from '../lib/workoutData';

/**
 * Leitura de atividades já homologadas. A criação, validação, score e
 * conquistas acontecem exclusivamente nas APIs de validação; este serviço não
 * possui mais um caminho de escrita direta em `workouts` ou `users`.
 */
export const workoutService = {
  async submitRecovery(data: { focus: 'alongamento' | 'sono' | 'meditacao' | 'caminhada'; description: string; quizAnswers?: unknown }) {
    const user = auth.currentUser;
    if (!user) throw new Error('Usuário não autenticado.');

    const idToken = await user.getIdToken();
    const response = await fetch('/api/validate-activity', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`
      },
      body: JSON.stringify({
        type: 'recovery',
        focus: data.focus,
        description: data.description,
        quizAnswers: data.quizAnswers
      })
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || 'Erro ao registrar descanso inteligente.');
    }
    return payload;
  },

  async getUserWorkouts(limitCount = 10): Promise<Workout[]> {
    const user = auth.currentUser;
    if (!user) return [];

    try {
      const snapshot = await getDocs(query(
        collection(db, 'workouts'),
        where('userId', '==', user.uid),
        limit(Math.max(limitCount * 3, limitCount))
      ));

      return snapshot.docs.flatMap((entry) => {
        const data = entry.data() as Record<string, unknown>;
        const timestamp = readActivityTimestamp(data.timestamp ?? data.createdAt);
        const status = normalizeActivityValidationStatus(
          data.validationStatus ?? data.status ?? (data.validation as { status?: unknown } | undefined)?.status
        );
        if (timestamp === null || status !== 'validated') return [];
        return [{
          ...(data as Workout),
          id: entry.id,
          timestamp: new Date(timestamp).toISOString(),
          status: 'valid'
        }];
      })
        .sort((a, b) => Date.parse(String(b.timestamp)) - Date.parse(String(a.timestamp)))
        .slice(0, limitCount);
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, 'workouts');
      return [];
    }
  }
};
