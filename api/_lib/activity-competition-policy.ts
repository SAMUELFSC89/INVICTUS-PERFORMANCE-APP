import { db } from './common.js';
import { matchActiveChampionshipsForActivity } from './championship-catalog.js';
import { normalizeSessionPolicyModality } from './modality-config.js';
import { isCurrentCompetitiveHrAcknowledgement } from './competitive-heart-rate-acknowledgement.js';
import { COMPETITION_RULES_VERSIONS } from '../../shared/competitiveHeartRatePolicy.js';
import { publishAdminRealtimeSignalSafe } from './admin-realtime.js';

export type ActivityCompetitionContextType =
  | 'gym_ranking'
  | 'community_championship'
  | 'paid_championship';

export interface ActivityCompetitionContext {
  type: ActivityCompetitionContextType;
  id: string;
  label: string;
  enrollmentId: string;
  requiresGymCheckIn: boolean;
  requiresContinuousGps: boolean;
  requiresMotionSensors: boolean;
  /** Identidade imutável da edição paga; ausente nos outros contextos. */
  editionId?: string;
  /** Identifica a adesão específica; muda quando o atleta sai e entra de novo. */
  epochId?: string;
  epochStartedAt?: string;
  gymId?: string;
  cycleKey?: string;
  minDurationMinutes?: number;
  maxDurationMinutes?: number;
  regulationVersion?: string;
  regulationHash?: string;
  /** Modalidades de cardio aceitas pelo regulamento desta edição. */
  allowedCardioTypes?: string[];
}

export interface ActivityCompetitionPolicy {
  version: 'activity-competition-v2';
  activityType: 'workout' | 'cardio';
  cardioType?: string;
  isIndoorCardio: boolean;
  resolvedAt: string;
  effectiveAt: string;
  contexts: ActivityCompetitionContext[];
  requiresSecurityReview: boolean;
  requiresGymCheckIn: boolean;
  requiresContinuousGps: boolean;
  requiresMotionSensors: boolean;
  snapshotId?: string;
  sessionId?: string;
  startBy?: string;
  expiresAt?: string;
}

export interface ResolveActivityCompetitionPolicyInput {
  userId: string;
  activityType: string;
  cardioType?: string;
  isIndoorCardio?: boolean;
  when?: Date;
}

const COMMUNITY_EVENT_ID = 'community_friends_v1';
const POLICY_VERSION = 'activity-competition-v2' as const;

function timestampMs(value: any): number | null {
  if (!value) return null;
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value?._seconds === 'number') return value._seconds * 1000;
  if (typeof value?.seconds === 'number') return value.seconds * 1000;
  const parsed = value instanceof Date ? value.getTime() : Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function activeAt(data: Record<string, any> | undefined, when: Date, activeNow: boolean, joinedField: string): boolean {
  if (!data) return false;
  const whenMs = when.getTime();
  const joinedMs = timestampMs(data[joinedField]);
  const withdrawnMs = timestampMs(data.withdrawnAt);
  if (joinedMs !== null && joinedMs > whenMs) return false;
  const applicableWithdrawal = withdrawnMs !== null && (joinedMs === null || withdrawnMs >= joinedMs)
    ? withdrawnMs
    : null;
  if (applicableWithdrawal !== null && applicableWithdrawal <= whenMs) return false;
  return activeNow || (joinedMs !== null && applicableWithdrawal !== null && joinedMs <= whenMs && whenMs < applicableWithdrawal);
}

function buildContext(
  type: ActivityCompetitionContextType,
  id: string,
  label: string,
  enrollmentId: string,
  activityType: string,
  isIndoorCardio: boolean,
  overrides: Partial<Omit<ActivityCompetitionContext, 'type' | 'id' | 'label' | 'enrollmentId'>> = {}
): ActivityCompetitionContext {
  return {
    type,
    id,
    label,
    enrollmentId,
    requiresGymCheckIn: activityType === 'workout',
    requiresContinuousGps: activityType === 'cardio' && !isIndoorCardio,
    requiresMotionSensors: true,
    ...overrides,
  };
}

function finalizePolicy(
  input: ResolveActivityCompetitionPolicyInput,
  when: Date,
  contexts: ActivityCompetitionContext[],
  identity: Partial<Pick<ActivityCompetitionPolicy, 'snapshotId' | 'sessionId' | 'startBy' | 'expiresAt'>> = {},
): ActivityCompetitionPolicy {
  const activityType = String(input.activityType).toLowerCase() === 'cardio' ? 'cardio' : 'workout';
  return {
    version: POLICY_VERSION,
    activityType,
    ...(input.cardioType ? { cardioType: input.cardioType } : {}),
    isIndoorCardio: input.isIndoorCardio === true,
    resolvedAt: new Date().toISOString(),
    effectiveAt: when.toISOString(),
    contexts,
    requiresSecurityReview: contexts.length > 0,
    requiresGymCheckIn: contexts.some((context) => context.requiresGymCheckIn),
    requiresContinuousGps: contexts.some((context) => context.requiresContinuousGps),
    requiresMotionSensors: contexts.some((context) => context.requiresMotionSensors),
    ...identity,
  };
}

function enrollmentEpoch(data: Record<string, any> | undefined, joinedField: string, enrollmentId: string) {
  const startedMs = timestampMs(data?.[joinedField]);
  if (startedMs === null) return {};
  const epochStartedAt = new Date(startedMs).toISOString();
  return { epochStartedAt, epochId: `${enrollmentId}:${startedMs}` };
}

function cycleKey(when: Date): string {
  return when.toISOString().slice(0, 7);
}

export async function resolveActivityCompetitionPolicy(
  input: ResolveActivityCompetitionPolicyInput
): Promise<ActivityCompetitionPolicy> {
  const when = input.when && Number.isFinite(input.when.getTime()) ? input.when : new Date();
  const activityType = String(input.activityType || '').toLowerCase();
  const isSupportedActivity = activityType === 'workout' || activityType === 'cardio';
  if (!db || !isSupportedActivity) return finalizePolicy(input, when, []);

  const rankingRef = db.collection('gym_ranking_enrollments').doc(input.userId);
  const communityRef = db.collection('community_championship_enrollments').doc(`${COMMUNITY_EVENT_ID}_${input.userId}`);
  const [rankingSnap, communitySnap, paidRegistrationsSnap, userSnap] = await Promise.all([
    rankingRef.get(),
    communityRef.get(),
    db.collection('championship_registrations').where('userId', '==', input.userId).get(),
    db.collection('users').doc(input.userId).get(),
  ]);

  const ranking = rankingSnap.exists ? rankingSnap.data() || {} : undefined;
  const community = communitySnap.exists ? communitySnap.data() || {} : undefined;
  const user = userSnap.exists ? userSnap.data() || {} : {};
  const contexts: ActivityCompetitionContext[] = [];
  const isIndoorCardio = input.isIndoorCardio === true;

  const rankingGymId = String(ranking?.gymId || '').trim();
  if (rankingGymId
    && isCurrentCompetitiveHrAcknowledgement(ranking, 'gym_ranking', COMPETITION_RULES_VERSIONS.gym_ranking)
    && activeAt(ranking, when, ranking?.enrolled === true, 'enrolledAt')) {
    contexts.push(buildContext(
      'gym_ranking',
      rankingGymId,
      'Ranking da Academia',
      rankingSnap.id,
      activityType,
      isIndoorCardio,
      { ...enrollmentEpoch(ranking, 'enrolledAt', rankingSnap.id), gymId: rankingGymId }
    ));
  }

  if (isCurrentCompetitiveHrAcknowledgement(community, COMMUNITY_EVENT_ID, COMPETITION_RULES_VERSIONS.community_friends_v1)
    && activeAt(community, when, community?.status === 'active', 'joinedAt')) {
    contexts.push(buildContext(
      'community_championship',
      COMMUNITY_EVENT_ID,
      'Campeonato entre Amigos',
      communitySnap.id,
      activityType,
      isIndoorCardio,
      {
        ...enrollmentEpoch(community, 'joinedAt', communitySnap.id),
        gymId: String(user.gymId || user.academyId || 'community_global'),
        cycleKey: cycleKey(when),
      }
    ));
  }

  const candidates = matchActiveChampionshipsForActivity({
    activityType,
    cardioType: input.cardioType,
    isIndoorCardio,
    when,
  });
  const paidRegistrations = paidRegistrationsSnap.docs.map((entry) => ({ id: entry.id, ...entry.data() } as any));
  for (const championship of candidates) {
    const registration: any = paidRegistrations.find((entry: any) => (
      String(entry.editionId || '') === championship.editionId
      || (!entry.editionId
        && entry.championshipId === championship.id
        && entry.regulationHash === championship.regulationHash)
    ));
    if (!registration || registration.status !== 'paga' || registration.paymentStatus !== 'PAID') continue;
    const paidAt = timestampMs(registration.pagaEm ?? registration.paidAt);
    if (paidAt === null || paidAt > when.getTime()) continue;
    contexts.push(buildContext(
      'paid_championship',
      championship.id,
      championship.title,
      registration.id,
      activityType,
      isIndoorCardio,
      {
        editionId: championship.editionId,
        ...enrollmentEpoch(registration, registration.pagaEm ? 'pagaEm' : 'paidAt', registration.id),
        cycleKey: cycleKey(when),
        gymId: String(user.gymId || user.academyId || ''),
        minDurationMinutes: championship.antiFraudProfile?.minDurationMinutes,
        maxDurationMinutes: championship.antiFraudProfile?.maxDurationMinutes,
        regulationVersion: String(registration.regulationVersion || championship.regulationVersion || ''),
        regulationHash: String(registration.regulationHash || championship.regulationHash || ''),
        allowedCardioTypes: championship.antiFraudProfile?.allowedCardioTypes
          ? [...championship.antiFraudProfile.allowedCardioTypes]
          : undefined,
        requiresGymCheckIn: activityType === 'workout' && championship.antiFraudProfile?.requireGeofence !== false,
        requiresContinuousGps: activityType === 'cardio' && championship.antiFraudProfile?.requireContinuousGPS !== false,
      }
    ));
  }

  return finalizePolicy(input, when, contexts);
}

export async function createActivityCompetitionPolicySnapshot(
  input: ResolveActivityCompetitionPolicyInput
): Promise<ActivityCompetitionPolicy> {
  const modality = normalizeSessionPolicyModality(input);
  const normalizedInput: ResolveActivityCompetitionPolicyInput = {
    ...input,
    activityType: modality.activityType,
    cardioType: modality.cardioType,
    isIndoorCardio: modality.isIndoorCardio,
  };
  const policy = await resolveActivityCompetitionPolicy(normalizedInput);
  if (!db) return policy;
  const ref = db.collection('activity_policy_snapshots').doc();
  const issuedAt = new Date();
  const startBy = new Date(issuedAt.getTime() + 30 * 60 * 1000).toISOString();
  const expiresAt = new Date(issuedAt.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const frozenPolicy = finalizePolicy(normalizedInput, input.when || issuedAt, policy.contexts, {
    snapshotId: ref.id,
    sessionId: ref.id,
    startBy,
    expiresAt,
  });
  await ref.create({
    id: ref.id,
    sessionId: ref.id,
    userId: input.userId,
    activityType: modality.activityType,
    cardioType: modality.cardioType || null,
    isIndoorCardio: modality.isIndoorCardio,
    policy: frozenPolicy,
    createdAt: issuedAt.toISOString(),
    startBy,
    expiresAt,
    expiresAtTimestamp: new Date(expiresAt),
  });
  return frozenPolicy;
}

export async function loadActivityCompetitionPolicySnapshot(params: {
  snapshotId?: string;
  userId: string;
  activityType: string;
  cardioType?: string;
  isIndoorCardio?: boolean;
  sessionId?: string;
}): Promise<ActivityCompetitionPolicy | null> {
  if (!db || !params.snapshotId) return null;
  let requestedModality;
  try {
    requestedModality = normalizeSessionPolicyModality(params);
  } catch {
    return null;
  }
  const snap = await db.collection('activity_policy_snapshots').doc(params.snapshotId).get();
  if (!snap.exists) return null;
  const data = snap.data() || {};
  let storedModality;
  try {
    storedModality = normalizeSessionPolicyModality({
      activityType: data.activityType,
      cardioType: data.cardioType ?? undefined,
      isIndoorCardio: data.isIndoorCardio,
    });
  } catch {
    return null;
  }
  if (data.userId !== params.userId
    || storedModality.activityType !== requestedModality.activityType
    || String(storedModality.cardioType || '') !== String(requestedModality.cardioType || '')
    || storedModality.isIndoorCardio !== requestedModality.isIndoorCardio) return null;
  if (params.sessionId && data.sessionId !== params.sessionId) return null;
  const expiresAt = timestampMs(data.expiresAt);
  if (expiresAt !== null && expiresAt < Date.now()) return null;
  const policy = data.policy as ActivityCompetitionPolicy | undefined;
  if (!policy || policy.version !== POLICY_VERSION || !Array.isArray(policy.contexts)) return null;
  let policyModality;
  try {
    policyModality = normalizeSessionPolicyModality({
      activityType: policy.activityType,
      cardioType: policy.cardioType,
      isIndoorCardio: policy.isIndoorCardio,
    });
  } catch {
    return null;
  }
  if (policyModality.activityType !== storedModality.activityType
    || String(policyModality.cardioType || '') !== String(storedModality.cardioType || '')
    || policyModality.isIndoorCardio !== storedModality.isIndoorCardio) return null;
  return { ...policy, snapshotId: snap.id, sessionId: data.sessionId || policy.sessionId || snap.id };
}

export type ActivityCompetitionReviewStatus = 'processing' | 'approved' | 'pending_review' | 'rejected' | 'ineligible';

export async function persistActivityCompetitionEntries(params: {
  activityId: string;
  userId: string;
  policy: ActivityCompetitionPolicy;
  reviewStatus: ActivityCompetitionReviewStatus;
  score?: number;
  riskScore?: number;
  securityDecision?: string | null;
  securityReportId?: string | null;
  reasonCode?: string | null;
}): Promise<void> {
  if (!db || !params.activityId || params.policy.contexts.length === 0) return;
  const batch = db.batch();
  const now = new Date().toISOString();
  for (const context of params.policy.contexts) {
    const durableContextId = context.type === 'paid_championship' && context.editionId ? context.editionId : context.id;
    const safeContextId = `${context.type}_${durableContextId}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 500);
    const ref = db.collection('activity_competition_entries').doc(`${safeContextId}_${params.activityId}`);
    batch.set(ref, {
      id: ref.id,
      activityId: params.activityId,
      userId: params.userId,
      contextType: context.type,
      contextId: context.id,
      editionId: context.editionId || null,
      contextLabel: context.label,
      enrollmentId: context.enrollmentId,
      policyVersion: params.policy.version,
      policyEffectiveAt: params.policy.effectiveAt,
      policySnapshotId: params.policy.snapshotId || null,
      policySessionId: params.policy.sessionId || null,
      epochId: context.epochId || null,
      epochStartedAt: context.epochStartedAt || null,
      gymId: context.gymId || null,
      cycleKey: context.cycleKey || null,
      allowedCardioTypes: context.allowedCardioTypes || null,
      reviewStatus: params.reviewStatus,
      competitionPoints: params.reviewStatus === 'approved' ? Math.max(0, Number(params.score) || 0) : 0,
      riskScore: Number.isFinite(Number(params.riskScore)) ? Number(params.riskScore) : null,
      securityDecision: params.securityDecision || null,
      securityReportId: params.securityReportId || null,
      reasonCode: params.reasonCode || null,
      updatedAt: now,
      createdAt: params.policy.resolvedAt || now,
    }, { merge: true });
  }
  await batch.commit();
  if (params.reviewStatus === 'pending_review') {
    publishAdminRealtimeSignalSafe({ type: 'ACTIVITY_REVIEW_REQUIRED', source: 'activity-competition-policy' });
  }
}
