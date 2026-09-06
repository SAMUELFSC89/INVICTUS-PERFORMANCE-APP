import { createHash, randomUUID } from 'node:crypto';
import { db } from './common.js';
import { resolverPerfilValidacao } from './modality-config.js';

const SEGMENT_MS = 15 * 60 * 1000;

export interface ActivityIdentityInput {
  userId: string;
  activityId: string;
  type: string;
  cardioType?: string;
  startTime: Date | string;
  /** Real wall-clock end when the source provides it. Active duration may be
   * much shorter than the session span because of pauses. */
  endTime?: Date | string;
  durationMinutes: number;
  source: string;
}

export type ActivityIdentityReservation =
  | { status: 'claimed'; canonicalActivityId: string; reservationToken: string }
  | { status: 'duplicate'; canonicalActivityId: string }
  | { status: 'pending'; canonicalActivityId: string };

export type ActivityIdentityCommitResult =
  | { status: 'committed' }
  | { status: 'existing'; activity: Record<string, any> }
  | { status: 'lost' };

function segmentDocumentId(userId: string, segment: number): string {
  return createHash('sha256')
    .update(`${userId}\u0000${segment}`)
    .digest('hex');
}

function resolveIdentityWindow(input: ActivityIdentityInput): {
  start: Date;
  durationMinutes: number;
  startMs: number;
  endMs: number;
  segments: number[];
} {
  const start = input.startTime instanceof Date ? input.startTime : new Date(input.startTime);
  const durationMinutes = Number(input.durationMinutes);
  if (!input.userId || !input.activityId || !Number.isFinite(start.getTime())
    || !Number.isFinite(durationMinutes) || durationMinutes <= 0 || durationMinutes > 360) {
    throw new Error('Dados insuficientes para reservar a identidade da atividade.');
  }
  const startMs = start.getTime();
  const suppliedEnd = input.endTime instanceof Date ? input.endTime : new Date(input.endTime || NaN);
  const suppliedEndMs = suppliedEnd.getTime();
  const endMs = Number.isFinite(suppliedEndMs) && suppliedEndMs > startMs
    && suppliedEndMs <= startMs + 6 * 60 * 60_000
    ? suppliedEndMs
    : startMs + durationMinutes * 60_000;
  const firstSegment = Math.floor(startMs / SEGMENT_MS);
  const lastSegment = Math.floor(Math.max(startMs, endMs - 1) / SEGMENT_MS);
  const segments = Array.from(
    { length: Math.min(26, lastSegment - firstSegment + 1) },
    (_, index) => firstSegment + index,
  );
  return { start, durationMinutes, startMs, endMs, segments };
}

/**
 * Reserva atomicamente os intervalos físicos ocupados por uma atividade.
 * IDs de origem garantem retry; estes segmentos impedem que a mesma sessão
 * chegue simultaneamente por Invictus, Strava e Health e pague duas vezes.
 */
export async function reserveActivityIdentity(
  input: ActivityIdentityInput,
): Promise<ActivityIdentityReservation> {
  const { start, durationMinutes, startMs, endMs, segments } = resolveIdentityWindow(input);
  if (typeof (db as any)?.runTransaction !== 'function') {
    throw new Error('Reserva transacional de atividade indisponível.');
  }

  const profile = resolverPerfilValidacao({ type: input.type, cardioType: input.cardioType }).id;
  const refs = segments.map((segment) => db.collection('activity_identity_claims')
    .doc(segmentDocumentId(input.userId, segment)));

  return db.runTransaction(async (transaction: any) => {
    const snapshots = await Promise.all(refs.map((ref) => transaction.get(ref)));
    const existingClaims = snapshots.flatMap((snapshot) => {
      if (!snapshot.exists) return [];
      const data = snapshot.data() || {};
      return Array.isArray(data.claims) ? data.claims : data.activityId ? [data] : [];
    });
    const competingClaims = existingClaims.filter((claim) => {
      if (!claim || claim.activityId === input.activityId) return false;
      const otherStart = Date.parse(String(claim.activityStart || ''));
      const otherDuration = Number(claim.durationMinutes);
      if (!Number.isFinite(otherStart) || !Number.isFinite(otherDuration)) return true;
      const parsedOtherEnd = Date.parse(String(claim.activityEnd || ''));
      const otherEnd = Number.isFinite(parsedOtherEnd) && parsedOtherEnd > otherStart
        ? parsedOtherEnd
        : otherStart + otherDuration * 60_000;
      const overlapMs = Math.min(endMs, otherEnd) - Math.max(startMs, otherStart);
      const minimumSubstantialOverlap = Math.min(
        5 * 60_000,
        Math.min(endMs - startMs, otherEnd - otherStart) * 0.25,
      );
      return overlapMs >= minimumSubstantialOverlap;
    });
    const competingIds = [...new Set(competingClaims.map((claim) => String(claim.activityId)))];
    const competingWorkouts = await Promise.all(competingIds.map(async (activityId) => ({
      activityId,
      snapshot: await transaction.get(db.collection('workouts').doc(activityId)),
    })));
    const persistedCompetitor = competingWorkouts.find((item) => {
      if (!item.snapshot.exists) return false;
      const workout = item.snapshot.data() || {};
      // Uma importação sem direito econômico (manual ou antiga) não impede
      // que uma origem posterior verificável seja canônica. Atividade válida
      // que só atingiu a quota diária continua economyEligible para impedir
      // XP/progresso de missão duplicados por outra origem.
      return workout.economyEligible === true
        || workout.missionEligible === true
        || Number(workout.activityXpAwarded ?? workout.points) > 0
        || workout.isScoringEligible === true;
    });
    if (persistedCompetitor) {
      return {
        status: 'duplicate' as const,
        canonicalActivityId: persistedCompetitor.activityId,
      };
    }

    const now = new Date().toISOString();
    const staleIds = new Set<string>();
    for (const activityId of competingIds) {
      const persisted = competingWorkouts.find((item) => item.activityId === activityId)?.snapshot;
      if (persisted?.exists) {
        staleIds.add(activityId);
        continue;
      }
      const claims = competingClaims.filter((claim) => String(claim.activityId) === activityId);
      const newestReservation = Math.max(...claims.map((claim) => Date.parse(String(claim.reservedAt || claim.createdAt || '')) || 0));
      if (newestReservation > Date.now() - 5 * 60_000) {
        return { status: 'pending' as const, canonicalActivityId: activityId };
      }
      staleIds.add(activityId);
    }
    const ownTokens = existingClaims
      .filter((claim) => claim?.activityId === input.activityId && typeof claim.reservationToken === 'string')
      .map((claim) => claim.reservationToken);
    const reservationToken = ownTokens[0] || randomUUID();
    refs.forEach((ref, index) => {
      const data = snapshots[index].exists ? snapshots[index].data() || {} : {};
      const claims = Array.isArray(data.claims) ? data.claims
        : data.activityId ? [{
            activityId: data.activityId,
            source: data.source,
            activityStart: data.activityStart,
            activityEnd: data.activityEnd,
            durationMinutes: data.durationMinutes,
          }] : [];
      const liveClaims = claims.filter((claim: any) => !staleIds.has(String(claim?.activityId || ''))
        && claim?.activityId !== input.activityId);
      transaction.set(ref, {
        userId: input.userId,
        profile,
        segment: segments[index],
        claims: [...liveClaims, {
          activityId: input.activityId,
          source: input.source,
          activityStart: start.toISOString(),
          activityEnd: new Date(endMs).toISOString(),
          durationMinutes,
          reservedAt: now,
          reservationToken,
        }],
        createdAt: now,
      });
    });
    return {
      status: 'claimed' as const,
      canonicalActivityId: input.activityId,
      reservationToken,
    };
  });
}

/**
 * Confirma a posse da reserva na mesma transação que grava/promove o workout.
 * Se outro processo tomou o lease, o dono antigo recebe `lost` e não alcança
 * o ledger de XP/missões.
 */
export async function commitActivityIdentityReservation(params: {
  input: ActivityIdentityInput;
  reservation: Extract<ActivityIdentityReservation, { status: 'claimed' }>;
  payload: Record<string, any>;
  mode?: 'create' | 'merge';
}): Promise<ActivityIdentityCommitResult> {
  const { segments } = resolveIdentityWindow(params.input);
  if (params.reservation.canonicalActivityId !== params.input.activityId) {
    throw new Error('Reserva de identidade não pertence à atividade informada.');
  }
  const refs = segments.map((segment) => db.collection('activity_identity_claims')
    .doc(segmentDocumentId(params.input.userId, segment)));
  const workoutRef = db.collection('workouts').doc(params.input.activityId);

  return db.runTransaction(async (transaction: any) => {
    const [workoutSnap, ...claimSnaps] = await Promise.all([
      transaction.get(workoutRef),
      ...refs.map(ref => transaction.get(ref)),
    ]);
    const ownsEverySegment = claimSnaps.every((snapshot) => {
      if (!snapshot.exists) return false;
      const data = snapshot.data() || {};
      const claims = Array.isArray(data.claims) ? data.claims : data.activityId ? [data] : [];
      return claims.some((claim: any) => claim?.activityId === params.input.activityId
        && claim?.reservationToken === params.reservation.reservationToken);
    });
    if (!ownsEverySegment) return { status: 'lost' as const };

    if (workoutSnap.exists && workoutSnap.data()?.userId !== params.input.userId) {
      throw new Error('Atividade existente pertence a outro usuário.');
    }
    const committedAt = new Date().toISOString();
    refs.forEach((ref, index) => {
      const data = claimSnaps[index].data() || {};
      const claims = Array.isArray(data.claims) ? data.claims : data.activityId ? [data] : [];
      transaction.set(ref, {
        ...data,
        claims: claims.map((claim: any) => claim?.activityId === params.input.activityId
          && claim?.reservationToken === params.reservation.reservationToken
          ? { ...claim, committedAt }
          : claim),
        updatedAt: committedAt,
      });
    });

    if (workoutSnap.exists && params.mode !== 'merge') {
      return { status: 'existing' as const, activity: workoutSnap.data() || {} };
    }
    const payload = {
      ...params.payload,
      identityReservationToken: params.reservation.reservationToken,
      identityCommittedAt: committedAt,
    };
    if (workoutSnap.exists) transaction.set(workoutRef, payload, { merge: true });
    else if (typeof transaction.create === 'function') transaction.create(workoutRef, payload);
    else transaction.set(workoutRef, payload);
    return { status: 'committed' as const };
  });
}
