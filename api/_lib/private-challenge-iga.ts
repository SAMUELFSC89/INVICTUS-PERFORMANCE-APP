import { db } from './common.js';
import { IGAUserProfile, type IGASession } from '../../src/core/iga/index.js';
import { computeWindowAverageIGA } from '../../src/core/iga/windowAverage.js';
import { resolveCompetitionTimeZone } from '../../src/core/time/competitionTime.js';
import { hasTrustedCompetitionEvidence, readCompetitionEvidenceMetrics } from './competition-evidence.js';
import { isCurrentCompetitiveHrAcknowledgement } from './competitive-heart-rate-acknowledgement.js';
import { COMPETITION_RULES_VERSIONS } from '../../shared/competitiveHeartRatePolicy.js';

const COMPETITION_TIME_ZONE = resolveCompetitionTimeZone(process.env.COMPETITION_TIME_ZONE);

interface DatedSession extends IGASession {
  createdAt: Date;
}

interface GymRankingEnrollmentEpoch {
  gymId: string;
  enrolledAt: Date;
  epochId: string;
}

function profileFor(userId: string, userData: Record<string, any>): IGAUserProfile {
  return {
    userId,
    age: Number(userData.age) || 30,
    weightKg: Number(userData.weight) || Number(userData.weightKg) || 70,
    maxHeartRate: Number(userData.maxHeartRate) || undefined,
  };
}

async function sessionsForWindow(
  userId: string,
  earliestNeeded: Date,
  enrollment: GymRankingEnrollmentEpoch,
): Promise<DatedSession[]> {
  if (!db) return [];
  const sessions: DatedSession[] = [];
  const workoutsSnap = await db.collection('workouts').where('userId', '==', userId).get();

  workoutsSnap.forEach((doc: any) => {
    const data = doc.data() || {};
    const promotedMetrics = readCompetitionEvidenceMetrics(data);
    if (hasTrustedCompetitionEvidence(data) && !promotedMetrics) return;

    const activityDateValue = promotedMetrics?.startTime
      || data.startTime
      || data.timestamp
      || data.competitionPolicyEffectiveAt
      || data.policyEffectiveAt
      || data.createdAt;
    const createdAt = activityDateValue
      ? (activityDateValue.toDate ? activityDateValue.toDate() : new Date(activityDateValue))
      : null;
    if (!createdAt || !Number.isFinite(createdAt.getTime()) || createdAt < earliestNeeded || createdAt < enrollment.enrolledAt) return;

    const isApprovedStatus = data.status === 'completed' || data.status === 'valid';
    const isFlaggedOrPending = data.status === 'rejected'
      || data.status === 'invalid'
      || data.status === 'suspicious'
      || ['rejected', 'invalid', 'not_eligible', 'pending', 'pending_review'].includes(String(data.validationStatus || ''))
      || data.securityBlocked === true
      || data.pendingReview === true;
    const isVersioned = Number(data.schemaVersion) >= 2 || Boolean(data.competitionPolicyVersion);
    const contexts = Array.isArray(data.competitionContexts) ? data.competitionContexts : [];
    const approvedForCurrentGym = isVersioned
      ? isApprovedStatus && !isFlaggedOrPending
        && data.competitionReviewStatus === 'approved'
        && data.isScoringEligible === true
        && contexts.some((context: any) => context?.type === 'gym_ranking'
          && String(context?.id) === enrollment.gymId
          && String(context?.epochId || '') === enrollment.epochId)
      : isApprovedStatus && !isFlaggedOrPending && data.isScoringEligible === true;

    sessions.push({
      id: doc.id,
      type: promotedMetrics?.activityType || data.type || 'workout',
      durationMinutes: Number(promotedMetrics?.durationMinutes) || Number(data.duration) || Number(data.durationMinutes) || 30,
      avgHeartRate: promotedMetrics ? Number(promotedMetrics.avgHeartRate) || 0 : 0,
      caloriesInformed: promotedMetrics
        ? Number(promotedMetrics.calories) || 0
        : Number(data.calories) || Number(data.caloriesBurned) || 0,
      isValid: approvedForCurrentGym,
      date: createdAt.toISOString(),
      createdAt,
    });
  });

  return sessions;
}

/**
 * Mesmo motor IGA competitivo do ranking, aplicado à janela arbitrária do
 * desafio privado. A adesão válida ao ranking da academia continua sendo o
 * epoch competitivo que define quais atividades podem pontuar.
 */
export async function computePrivateChallengeIGAForWindow(
  userId: string,
  startDate: Date,
  endDate: Date,
): Promise<{ average: number; weeks: Array<{ weekStart: string; igaRanking: number; frequency: number }> }> {
  const empty = { average: 0, weeks: [] as Array<{ weekStart: string; igaRanking: number; frequency: number }> };
  if (!db || !userId || !Number.isFinite(startDate.getTime()) || !Number.isFinite(endDate.getTime())) return empty;

  const [userSnap, enrollmentSnap] = await Promise.all([
    db.collection('users').doc(userId).get(),
    db.collection('gym_ranking_enrollments').doc(userId).get(),
  ]);
  const userData = userSnap.exists ? (userSnap.data() || {}) : {};
  const enrollmentData = enrollmentSnap.exists ? (enrollmentSnap.data() || {}) : {};
  const enrolledAt = enrollmentData.enrolledAt?.toDate
    ? enrollmentData.enrolledAt.toDate()
    : new Date(enrollmentData.enrolledAt || '');
  const enrollment: GymRankingEnrollmentEpoch | null = enrollmentData.enrolled === true
    && isCurrentCompetitiveHrAcknowledgement(enrollmentData, 'gym_ranking', COMPETITION_RULES_VERSIONS.gym_ranking)
    && typeof enrollmentData.gymId === 'string'
    && enrollmentData.gymId
    && Number.isFinite(enrolledAt.getTime())
    ? { gymId: enrollmentData.gymId, enrolledAt, epochId: `${userId}:${enrolledAt.getTime()}` }
    : null;

  if (!enrollment) return empty;
  const now = new Date();
  const windowStart = enrollment.enrolledAt > startDate ? enrollment.enrolledAt : startDate;
  const windowEnd = endDate > now ? now : endDate;
  if (windowEnd <= windowStart) return empty;

  const sessions = await sessionsForWindow(userId, windowStart, enrollment);
  return computeWindowAverageIGA(
    sessions,
    windowStart,
    windowEnd,
    profileFor(userId, userData),
    { activeFrom: enrollment.enrolledAt, now, timeZone: COMPETITION_TIME_ZONE },
  );
}
