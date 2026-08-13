/**
 * Habit Engine (Criar Habito) - deterministic rules for the adaptive cardio journey.
 *
 * Design principle: the AI layer only RECOMMENDS (messages, tone, explanations).
 * This module is the single source of truth for anything that affects integrity:
 * how many milestones are generated, how progress is evaluated, when a milestone
 * unlocks, and when a milestone is repeated/eased. Nothing here can be overridden
 * by client input - all inputs come from server-validated activity data.
 */

export type HabitGoalType =
  | 'start_running'
  | 'walk_regularly'
  | 'cycling'
  | 'improve_conditioning'
  | 'reach_distance'
  | 'custom';

export interface HabitMilestone {
  order: number;
  targetDistanceKm: number;
  targetDurationSec: number | null;
  requiredSessions: number;
  completedSessions: number;
  status: 'locked' | 'active' | 'completed';
  unlockedAt: string | null;
  completedAt: string | null;
}

export interface HabitGoalInput {
  goalType: HabitGoalType;
  targetDistanceKm: number;
  deadlineDays: number;
  weeklyFrequency: number;
}

export interface HabitProfile {
  recentAvgDistanceKm?: number;
  recentSessionsPerWeek?: number;
  longestRecentRunKm?: number;
  hasCardioHistory: boolean;
}

const MIN_STEP_KM = 0.5;
const MAX_STEP_KM = 1.5;
const MIN_SESSIONS_PER_MILESTONE = 2;
const MAX_SESSIONS_PER_MILESTONE = 4;

export function generateMilestonePlan(input: HabitGoalInput, profile: HabitProfile): HabitMilestone[] {
  const target = Math.max(0.5, input.targetDistanceKm);
  const startingPoint = profile.hasCardioHistory
    ? Math.min(target, Math.max(1, profile.recentAvgDistanceKm || 1))
    : Math.min(target, 1);

  const availableWeeks = Math.max(2, Math.round(input.deadlineDays / 7));
  const remaining = Math.max(0, target - startingPoint);
  const roughSteps = Math.max(1, Math.min(10, availableWeeks));
  const stepSize = clamp(remaining / roughSteps, MIN_STEP_KM, MAX_STEP_KM);

  const milestones: HabitMilestone[] = [];
  let current = startingPoint;
  let order = 0;
  while (current < target - 0.001 && order < 20) {
    milestones.push(makeMilestone(order, roundToHalf(current)));
    current += stepSize;
    order++;
  }
  milestones.push(makeMilestone(order, target));

  milestones[0].status = 'active';
  milestones[0].unlockedAt = new Date().toISOString();
  return milestones;
}

function makeMilestone(order: number, targetDistanceKm: number): HabitMilestone {
  return {
    order,
    targetDistanceKm,
    targetDurationSec: null,
    requiredSessions: MIN_SESSIONS_PER_MILESTONE,
    completedSessions: 0,
    status: 'locked',
    unlockedAt: null,
    completedAt: null,
  };
}

function clamp(v: number, min: number, max: number) { return Math.min(max, Math.max(min, v)); }
function roundToHalf(v: number) { return Math.round(v * 2) / 2; }

export interface ActivityForHabit {
  activityId: string;
  distanceKm: number;
  durationSec: number;
  timestamp: string;
}

export interface ProgressDecision {
  sessionCounted: boolean;
  milestoneCompleted: boolean;
  nextMilestoneUnlocked: boolean;
  regressed: boolean;
  reason: string;
  /** Milestone just completed and a next one exists, but it stays LOCKED until the
   * user explicitly reveals it via the reveal-next action. This is the server-side
   * gate that implements the "surprise" rule - no future target is unlocked here. */
  pendingReveal?: boolean;
  /** Computed at completion time (how easily the milestone was cleared), consumed
   * later by the reveal-next step to decide whether to skip an extra milestone
   * ahead. Never applied automatically - purely a stored boolean flag. */
  pendingSkipAhead?: boolean;
  /** True only when the completed milestone was the last one in the plan (no
   * next milestone exists at all) - the whole habit goal is finished. */
  goalCompleted?: boolean;
}

export function evaluateProgress(
  milestonesIn: HabitMilestone[],
  currentMilestoneIndex: number,
  activity: ActivityForHabit,
  lastActivityAt: string | null
): { milestones: HabitMilestone[]; currentMilestoneIndex: number; decision: ProgressDecision } {
  const list = milestonesIn.map(m => ({ ...m }));
  const current = list[currentMilestoneIndex];
  if (!current || current.status !== 'active') {
    return {
      milestones: list,
      currentMilestoneIndex,
      decision: { sessionCounted: false, milestoneCompleted: false, nextMilestoneUnlocked: false, regressed: false, reason: 'no_active_milestone' },
    };
  }

  const daysSinceLast = lastActivityAt
    ? (new Date(activity.timestamp).getTime() - new Date(lastActivityAt).getTime()) / 86400000
    : 0;
  const longGap = daysSinceLast > 10;

  const meetsTarget = activity.distanceKm >= current.targetDistanceKm * 0.95;

  let sessionCounted = false;
  let milestoneCompleted = false;
  let nextMilestoneUnlocked = false;
  let regressed = false;
  let reason = '';

  if (meetsTarget) {
    current.completedSessions += 1;
    sessionCounted = true;
    reason = 'session_met_target';

    if (current.completedSessions >= current.requiredSessions) {
      current.status = 'completed';
      current.completedAt = activity.timestamp;
      milestoneCompleted = true;
      list[currentMilestoneIndex] = current;

      const next = list[currentMilestoneIndex + 1];
      if (next) {
        // SURPRISE RULE: the next milestone is NOT unlocked here. It stays 'locked'
        // (its target is never written/exposed) until the user explicitly taps
        // "Revelar Proxima Meta", which triggers the reveal-next action. We only
        // pre-compute whether that later step should skip an extra milestone ahead
        // because this one was cleared easily - nothing about the next target is
        // decided or stored here, it is purely a boolean flag for later use.
        const clearedEasily = activity.distanceKm >= current.targetDistanceKm * 1.3;
        const pendingSkipAhead = !!(clearedEasily && !longGap && list[currentMilestoneIndex + 2]);
        return {
          milestones: list,
          currentMilestoneIndex,
          decision: { sessionCounted, milestoneCompleted, nextMilestoneUnlocked: false, regressed, reason, pendingReveal: true, pendingSkipAhead, goalCompleted: false },
        };
      }

      reason = 'final_goal_completed';
      return {
        milestones: list,
        currentMilestoneIndex,
        decision: { sessionCounted, milestoneCompleted, nextMilestoneUnlocked: false, regressed, reason, pendingReveal: false, pendingSkipAhead: false, goalCompleted: true },
      };
    }
  } else {
    reason = 'session_below_target';
    const strugglingBadly = current.completedSessions === 0 && activity.distanceKm < current.targetDistanceKm * 0.5;
    if (longGap || strugglingBadly) {
      const prevTarget = currentMilestoneIndex > 0 ? list[currentMilestoneIndex - 1].targetDistanceKm : 0.5;
      const eased = Math.max(prevTarget, roundToHalf(current.targetDistanceKm - 0.5));
      if (eased < current.targetDistanceKm) {
        current.targetDistanceKm = eased;
        current.requiredSessions = Math.min(MAX_SESSIONS_PER_MILESTONE, current.requiredSessions + 1);
        regressed = true;
        reason += '_regressed';
      }
    }
  }

  list[currentMilestoneIndex] = current;
  return { milestones: list, currentMilestoneIndex, decision: { sessionCounted, milestoneCompleted, nextMilestoneUnlocked, regressed, reason } };
}

/** Deterministic (non-AI) fallback motivational message, used if the AI layer is unavailable. */
export function fallbackMessage(decision: ProgressDecision): string {
  if (decision.milestoneCompleted) return 'Meta concluida! Voce desbloqueou uma nova etapa da sua evolucao.';
  if (decision.regressed) return 'Sem pressa. Ajustamos sua proxima etapa para o seu ritmo atual.';
  if (decision.sessionCounted) return 'Sessao registrada rumo a proxima meta.';
  return 'Continue treinando para avancar na sua jornada.';
}
