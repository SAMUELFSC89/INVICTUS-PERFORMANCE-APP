import { db } from './common.js';
import { calculateWeeklyIGA, IGASession, IGAUserProfile, IGACalculationResult } from '../../src/core/iga/index.js';

/**
 * Recalcula o IGA Semanal de um usuário buscando os treinos da semana no Firestore
 * e atualizando weeklyScore e igaAudit no perfil.
 */
export async function recalculateUserWeeklyIGA(
  userId: string,
  extraSession?: IGASession
): Promise<IGACalculationResult> {
  if (!db || !userId) {
    const emptyResult = calculateWeeklyIGA([], {});
    return emptyResult;
  }

  const userRef = db.collection('users').doc(userId);
  const userSnap = await userRef.get();
  const userData = userSnap.exists ? (userSnap.data() || {}) : {};

  // Calcular segunda-feira da semana atual
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0 = Domingo, 1 = Segunda
  const diffToMonday = (dayOfWeek === 0 ? -6 : 1 - dayOfWeek);
  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMonday);
  monday.setHours(0, 0, 0, 0);

  const sessions: IGASession[] = [];

  try {
    const workoutsSnap = await db.collection('workouts')
      .where('userId', '==', userId)
      .get();

    workoutsSnap.forEach(doc => {
      const data = doc.data();
      const createdAt = data.createdAt ? (data.createdAt.toDate ? data.createdAt.toDate() : new Date(data.createdAt)) : new Date();

      if (createdAt >= monday) {
        sessions.push({
          id: doc.id,
          type: data.type || 'workout',
          durationMinutes: Number(data.duration) || Number(data.durationMinutes) || 30,
          avgHeartRate: Number(data.avgHeartRate) || Number(data.avgHr) || 0,
          caloriesInformed: Number(data.calories) || Number(data.caloriesBurned) || 0,
          isValid: data.validationStatus !== 'rejected' && data.validationStatus !== 'not_eligible',
          date: createdAt.toISOString()
        });
      }
    });
  } catch (err) {
    console.warn(`[IGA Service] Aviso ao buscar treinos da semana para ${userId}:`, err);
  }

  if (extraSession) {
    sessions.push(extraSession);
  }

  const profile: IGAUserProfile = {
    userId,
    age: Number(userData.age) || 30,
    weightKg: Number(userData.weight) || Number(userData.weightKg) || 70,
    maxHeartRate: Number(userData.maxHeartRate) || undefined
  };

  const igaResult = calculateWeeklyIGA(sessions, profile);

  try {
    await userRef.set({
      weeklyScore: igaResult.igaRanking,
      igaAudit: igaResult,
      updatedAt: new Date().toISOString()
    }, { merge: true });
  } catch (saveErr) {
    console.error(`[IGA Service] Erro ao salvar IGA para ${userId}:`, saveErr);
  }

  return igaResult;
}
