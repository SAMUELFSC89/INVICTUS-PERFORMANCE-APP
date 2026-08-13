/**
 * Habit Integration - Firestore glue between a committed cardio activity and the
 * "Criar Habito" habit-engine. This module owns the ONLY write path that can
 * mutate habit_goals progress, and it is idempotent per activityId.
 *
 * MUST be called from inside the same Firestore transaction that commits the
 * activity/score (see api/_handlers/validate-presence.ts commitRunningSession),
 * so that activity + score + habit progress are atomic: either all of it lands,
 * or none of it does.
 */
import { db } from './common.js';
import { evaluateProgress } from './habit-engine.js';
import type { ActivityForHabit } from './habit-engine.js';

export interface HabitProgressResult {
  applied: boolean;
  reason: string;
  milestoneCompleted?: boolean;
  nextMilestoneUnlocked?: boolean;
}

export async function applyHabitProgressInTransaction(
  transaction: FirebaseFirestore.Transaction,
  userId: string,
  activity: ActivityForHabit
): Promise<HabitProgressResult> {
  const goalsQuery = db
    .collection('habit_goals')
    .where('userId', '==', userId)
    .where('status', '==', 'active')
    .limit(1);

  const snap = await transaction.get(goalsQuery);
  if (snap.empty) {
    return { applied: false, reason: 'no_active_habit' };
  }

  const goalDoc = snap.docs[0];
  const goal = goalDoc.data() as any;

  // Idempotency guard: this exact activity was already applied to this habit.
  const appliedIds: string[] = goal.appliedActivityIds || [];
  if (appliedIds.includes(activity.activityId)) {
    return { applied: false, reason: 'already_applied' };
  }

  const result = evaluateProgress(
    goal.milestones,
    goal.currentMilestoneIndex,
    activity,
    goal.lastActivityAt || null
  );

  const update: any = {
    milestones: result.milestones,
    currentMilestoneIndex: result.currentMilestoneIndex,
    lastActivityAt: activity.timestamp,
    appliedActivityIds: [...appliedIds, activity.activityId].slice(-200),
    totalSessionsCompleted: (goal.totalSessionsCompleted || 0) + (result.decision.sessionCounted ? 1 : 0),
    updatedAt: new Date().toISOString(),
  };

  const noMoreActiveMilestones = !result.milestones.some((m: any) => m.status === 'active');
  const lastMilestone = result.milestones[result.milestones.length - 1];
  if (lastMilestone && lastMilestone.status === 'completed' && noMoreActiveMilestones) {
    update.status = 'completed';
    update.completedAt = activity.timestamp;
  }

  transaction.update(goalDoc.ref, update);

  return {
    applied: true,
    reason: result.decision.reason,
    milestoneCompleted: result.decision.milestoneCompleted,
    nextMilestoneUnlocked: result.decision.nextMilestoneUnlocked,
  };
}
