import { auth, db, handleFirestoreError, OperationType } from '../firebase';
import { collection, getDocs, limit, query, where } from 'firebase/firestore';
import type { Workout } from '../types';
import { readActivityTimestamp, resolveActivityState } from '../lib/workoutData';
import { API_CONFIG } from '../config';

/**
 * Leitura de atividades pessoais concluídas. A criação, recompensas e eventual
 * pontuação competitiva acontecem exclusivamente nas APIs; este serviço não
 * possui caminho de escrita direta em `workouts` ou `users`.
 */
export const workoutService = {
  async submitRecovery(data: { focus: 'alongamento' | 'sono' | 'meditacao' | 'caminhada'; description: string; quizAnswers?: unknown }) {
    const user = auth.currentUser;
    if (!user) throw new Error('Usuário não autenticado.');

    const idToken = await user.getIdToken();
    const response = await fetch(`${API_CONFIG.baseUrl}/api/validate-activity`, {
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
        const activityState = resolveActivityState(data);
        if (timestamp === null || !activityState.isCompleted) return [];

        const workoutType: 'workout' | 'cardio' | 'diet' | 'recovery' =
          data.type === 'cardio' || data.type === 'diet' || data.type === 'recovery' || data.type === 'workout'
            ? data.type
            : 'workout';

        const workout: Workout = {
          id: entry.id,
          userId: typeof data.userId === 'string' ? data.userId : user.uid,
          timestamp: new Date(timestamp).toISOString(),
          status: 'completed',
          type: workoutType,
          photoUrl: typeof data.photoUrl === 'string' ? data.photoUrl : undefined,
          muscleGroup: typeof data.muscleGroup === 'string' ? data.muscleGroup : undefined,
          cardioType: typeof data.cardioType === 'string' ? data.cardioType : undefined,
          cardioTypeLabel: typeof data.cardioTypeLabel === 'string' ? data.cardioTypeLabel : undefined,
          isIndoorCardio: typeof data.isIndoorCardio === 'boolean' ? data.isIndoorCardio : undefined,
          requiresGpsDistance: typeof data.requiresGpsDistance === 'boolean' ? data.requiresGpsDistance : undefined,
          duration: typeof data.duration === 'number' ? data.duration : undefined,
          distance: typeof data.distance === 'number' ? data.distance : undefined,
          calories: typeof data.calories === 'number' ? data.calories : undefined,
          points: typeof data.activityXpAwarded === 'number' ? data.activityXpAwarded : typeof data.points === 'number' ? data.points : undefined,
          rankingPointsEarned: activityState.isCompetitionApproved
            ? (typeof data.competitionPoints === 'number'
                ? data.competitionPoints
                : typeof data.rankingPointsEarned === 'number' ? data.rankingPointsEarned : undefined)
            : undefined,
          gymId: typeof data.gymId === 'string' ? data.gymId : undefined,
          validationStatus: typeof data.validationStatus === 'string' ? data.validationStatus : undefined,
          recordStatus: activityState.recordStatus,
          activityMode: activityState.activityMode,
          competitionReviewStatus: activityState.competitionStatus,
          competitionContexts: Array.isArray(data.competitionContexts) ? data.competitionContexts as Workout['competitionContexts'] : undefined,
          activityXpAwarded: typeof data.activityXpAwarded === 'number' ? data.activityXpAwarded : undefined,
          competitionPoints: typeof data.competitionPoints === 'number' ? data.competitionPoints : undefined,
          sessionId: typeof data.sessionId === 'string' ? data.sessionId : undefined,
          verificationPhotoUrl: typeof data.verificationPhotoUrl === 'string' ? data.verificationPhotoUrl : undefined
        };
        return [workout];
      })
        .sort((a, b) => Date.parse(String(b.timestamp)) - Date.parse(String(a.timestamp)))
        .slice(0, limitCount);
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, 'workouts');
      return [];
    }
  }
};
