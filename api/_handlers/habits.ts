import { VercelRequest, VercelResponse } from '@vercel/node';
import { corsMiddleware } from '../_middleware/cors.js';
import { methodMiddleware } from '../_middleware/method.js';
import { authMiddleware } from '../_middleware/auth.js';
import { errorHandler, AppError } from '../_middleware/error.js';
import { db } from '../_lib/common.js';
import { generateMilestonePlan, HabitGoalInput, HabitProfile, HabitGoalType } from '../_lib/habit-engine.js';

const VALID_GOAL_TYPES: HabitGoalType[] = [
  'start_running',
  'walk_regularly',
  'cycling',
  'improve_conditioning',
  'reach_distance',
  'custom',
];

/**
 * Strips any milestone the user has not reached yet down to {order, status}.
 * This is the server-side enforcement of the "surprise" rule: even inspecting
 * the network response for /api/habits?action=active never reveals a future
 * milestone's target before it is unlocked.
 */
function toPublicGoal(goal: any) {
  const milestones = (goal.milestones || []).map((m: any) => {
    if (m.status === 'locked') {
      return { order: m.order, status: 'locked' };
    }
    return m;
  });
  return {
    id: goal.id,
    goalType: goal.goalType,
    targetDistanceKm: goal.targetDistanceKm,
    deadline: goal.deadline,
    weeklyFrequency: goal.weeklyFrequency,
    status: goal.status,
    currentMilestoneIndex: goal.currentMilestoneIndex,
    totalSessionsCompleted: goal.totalSessionsCompleted || 0,
    milestones,
    createdAt: goal.createdAt,
    updatedAt: goal.updatedAt,
  };
}

async function buildProfile(userId: string): Promise<HabitProfile> {
  const snap = await db
    .collection('workouts')
    .where('userId', '==', userId)
    .where('type', '==', 'cardio')
    .orderBy('timestamp', 'desc')
    .limit(20)
    .get()
    .catch(() => null);

  if (!snap || snap.empty) {
    return { hasCardioHistory: false };
  }

  const distances: number[] = [];
  snap.forEach(doc => {
    const d = doc.data();
    if (typeof d.distance === 'number' && d.distance > 0) distances.push(d.distance);
  });

  if (distances.length === 0) return { hasCardioHistory: false };

  const avg = distances.reduce((a, b) => a + b, 0) / distances.length;
  return {
    hasCardioHistory: true,
    recentAvgDistanceKm: avg,
    longestRecentRunKm: Math.max(...distances),
    recentSessionsPerWeek: Math.min(7, distances.length / 4),
  };
}

export default async function handler(req: VercelRequest & { userId?: string }, res: VercelResponse) {
  try {
    if (corsMiddleware(req, res)) return;
    if (!methodMiddleware(req, res, ['GET', 'POST'])) return;
    if (!(await authMiddleware(req, res))) return;

    const userId = req.userId as string;
    const action = ((req.query.action as string) || req.body?.action || 'active').toLowerCase();

    switch (action) {
      case 'active': {
        const snap = await db
          .collection('habit_goals')
          .where('userId', '==', userId)
          .where('status', '==', 'active')
          .limit(1)
          .get();
        if (snap.empty) return res.status(200).json({ habit: null });
        const doc = snap.docs[0];
        return res.status(200).json({ habit: toPublicGoal({ id: doc.id, ...doc.data() }) });
      }

      case 'history': {
        const snap = await db
          .collection('habit_goals')
          .where('userId', '==', userId)
          .orderBy('createdAt', 'desc')
          .limit(20)
          .get();
        const items = snap.docs.map(d => toPublicGoal({ id: d.id, ...d.data() }));
        return res.status(200).json({ habits: items });
      }

      case 'create': {
        const { goalType, targetDistanceKm, deadlineDays, weeklyFrequency } = req.body || {};

        if (!VALID_GOAL_TYPES.includes(goalType)) {
          throw new AppError('Tipo de objetivo invalido.', 400);
        }
        const target = Number(targetDistanceKm);
        const deadline = Number(deadlineDays);
        const freq = Number(weeklyFrequency);
        if (!Number.isFinite(target) || target <= 0 || target > 200) {
          throw new AppError('Distancia alvo invalida.', 400);
        }
        if (!Number.isFinite(deadline) || deadline < 7 || deadline > 365) {
          throw new AppError('Prazo invalido (entre 7 e 365 dias).', 400);
        }
        if (!Number.isFinite(freq) || freq < 1 || freq > 7) {
          throw new AppError('Frequencia semanal invalida (entre 1 e 7).', 400);
        }

        const existing = await db
          .collection('habit_goals')
          .where('userId', '==', userId)
          .where('status', '==', 'active')
          .limit(1)
          .get();
        if (!existing.empty) {
          throw new AppError('Voce ja possui um habito ativo. Cancele-o antes de criar um novo.', 409);
        }

        const profile = await buildProfile(userId);
        const input: HabitGoalInput = {
          goalType,
          targetDistanceKm: target,
          deadlineDays: deadline,
          weeklyFrequency: freq,
        };
        const milestones = generateMilestonePlan(input, profile);
        const nowIso = new Date().toISOString();
        const deadlineIso = new Date(Date.now() + deadline * 86400000).toISOString();

        const docRef = await db.collection('habit_goals').add({
          userId,
          goalType,
          targetDistanceKm: target,
          deadlineDays: deadline,
          deadline: deadlineIso,
          weeklyFrequency: freq,
          status: 'active',
          currentMilestoneIndex: 0,
          milestones,
          totalSessionsCompleted: 0,
          appliedActivityIds: [],
          lastActivityAt: null,
          createdAt: nowIso,
          updatedAt: nowIso,
        });

        const created = await docRef.get();
        return res.status(201).json({ habit: toPublicGoal({ id: created.id, ...created.data() }) });
      }

      case 'cancel': {
        const goalId = (req.body?.goalId as string) || '';
        if (!goalId) throw new AppError('goalId obrigatorio.', 400);
        const ref = db.collection('habit_goals').doc(goalId);
        const snap = await ref.get();
        if (!snap.exists || (snap.data() as any).userId !== userId) {
          throw new AppError('Habito nao encontrado.', 404);
        }
        await ref.update({ status: 'cancelled', updatedAt: new Date().toISOString() });
        return res.status(200).json({ success: true });
      }

      case 'update-goal': {
        const goalId = (req.body?.goalId as string) || '';
        if (!goalId) throw new AppError('goalId obrigatorio.', 400);
        const ref = db.collection('habit_goals').doc(goalId);
        const snap = await ref.get();
        if (!snap.exists || (snap.data() as any).userId !== userId) {
          throw new AppError('Habito nao encontrado.', 404);
        }
        const goal = snap.data() as any;
        if (goal.status !== 'active') {
          throw new AppError('Somente habitos ativos podem ser alterados.', 400);
        }

        const update: any = { updatedAt: new Date().toISOString() };
        if (req.body?.weeklyFrequency !== undefined) {
          const freq = Number(req.body.weeklyFrequency);
          if (!Number.isFinite(freq) || freq < 1 || freq > 7) throw new AppError('Frequencia invalida.', 400);
          update.weeklyFrequency = freq;
        }
        if (req.body?.targetDistanceKm !== undefined) {
          const newTarget = Number(req.body.targetDistanceKm);
          if (!Number.isFinite(newTarget) || newTarget <= 0 || newTarget > 200) throw new AppError('Distancia invalida.', 400);

          // Keep every already-completed milestone untouched; regenerate the plan
          // for the remaining distance from the current point onward.
          const completed = (goal.milestones || []).filter((m: any) => m.status === 'completed');
          const lastCompletedDistance = completed.length ? completed[completed.length - 1].targetDistanceKm : 0;
          const remainingProfile: HabitProfile = { hasCardioHistory: true, recentAvgDistanceKm: lastCompletedDistance || 1 };
          const remainingDeadlineDays = Math.max(7, Math.round((new Date(goal.deadline).getTime() - Date.now()) / 86400000));
          const newPlanTail = generateMilestonePlan(
            { goalType: goal.goalType, targetDistanceKm: newTarget, deadlineDays: remainingDeadlineDays, weeklyFrequency: goal.weeklyFrequency },
            remainingProfile
          );
          const reindexed = newPlanTail.map((m, i) => ({ ...m, order: completed.length + i }));
          if (reindexed[0]) {
            reindexed[0].status = 'active';
            reindexed[0].unlockedAt = new Date().toISOString();
          }
          update.milestones = [...completed, ...reindexed];
          update.currentMilestoneIndex = completed.length;
          update.targetDistanceKm = newTarget;
        }

        await ref.update(update);
        const updated = await ref.get();
        return res.status(200).json({ habit: toPublicGoal({ id: updated.id, ...updated.data() }) });
      }

      default:
        throw new AppError(`Acao de habito '${action}' nao reconhecida.`, 400);
    }
  } catch (error: any) {
    return errorHandler(error, res);
  }
}
