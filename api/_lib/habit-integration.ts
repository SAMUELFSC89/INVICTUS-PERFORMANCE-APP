import { db } from './common.js';
import { evaluateProgress, ActivityForHabit } from './habit-engine.js';

export interface HabitProgressResult {
  applied: boolean;
  reason: string;
  milestoneCompleted?: boolean;
  nextMilestoneUnlocked?: boolean;
}

/**
 * READ STEP. Firestore transactions require every transaction.get() to run
 * before any transaction.set()/update(). Callers that already perform their
 * own writes earlier in the transaction (e.g. commitRunningSession) MUST call
 * this before their first write, then pass the result into
 * applyHabitProgressWithGoal() later, after their other writes are issued.
 */
export async function readActiveHabitGoal(
  transaction: FirebaseFirestore.Transaction,
  userId: string
): Promise<FirebaseFirestore.QueryDocumentSnapshot | null> {
  const goalsQuery = db
    .collection('habit_goals')
    .where('userId', '==', userId)
    .where('status', '==', 'active')
    .limit(1);
  const snap = await transaction.get(goalsQuery);
  return snap.empty ? null : snap.docs[0];
}

/**
 * WRITE STEP. Pure/synchronous (no reads) so it is safe to call after other
 * writes have already been issued in the same transaction. Idempotent: an
 * activityId already present in appliedActivityIds is a no-op.
 */
export function applyHabitProgressWithGoal(
  transaction: FirebaseFirestore.Transaction,
  goalDoc: FirebaseFirestore.QueryDocumentSnapshot | null,
  activity: ActivityForHabit
): HabitProgressResult {
  if (!goalDoc) {
    return { applied: false, reason: 'no_active_habit' };
  }

  const goal = goalDoc.data() as any;
  const appliedIds: string[] = goal.appliedActivityIds || [];
  if (appliedIds.includes(activity.activityId)) {
    return { applied: false, reason: 'already_applied' };
  }

  const result = evaluateProgress(goal.milestones, goal.currentMilestoneIndex, activity, goal.lastActivityAt || null);

  const update: any = {
    milestones: result.milestones,
    currentMilestoneIndex: result.currentMilestoneIndex,
    lastActivityAt: activity.timestamp,
    appliedActivityIds: [...appliedIds, activity.activityId].slice(-200),
    totalSessionsCompleted: (goal.totalSessionsCompleted || 0) + (result.decision.sessionCounted ? 1 : 0),
    updatedAt: new Date().toISOString(),
    // Surprise-rule gate: true right after a milestone completes with a next one
    // pending. The client must call the reveal-next action before the next
    // milestone's target is ever unlocked/returned to it.
    pendingReveal: !!result.decision.pendingReveal,
    pendingSkipAhead: !!result.decision.pendingSkipAhead,
  };

  // The goal is only actually finished when the engine explicitly says so
  // (completed milestone had no `next` at all). This must NOT be inferred from
  // "no active milestone right now", because a milestone sitting in the
  // pending-reveal state also has zero active milestones by design.
  if (result.decision.goalCompleted) {
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

/**
 * Convenience wrapper for callers whose transaction has NOT issued any writes
 * yet (read + write back-to-back is safe in that case). commitRunningSession
 * does NOT use this — it calls readActiveHabitGoal()/applyHabitProgressWithGoal()
 * separately because it already writes earlier in its own transaction.
 */
export async function applyHabitProgressInTransaction(
  transaction: FirebaseFirestore.Transaction,
  userId: string,
  activity: ActivityForHabit
): Promise<HabitProgressResult> {
  const goalDoc = await readActiveHabitGoal(transaction, userId);
  return applyHabitProgressWithGoal(transaction, goalDoc, activity);
}
