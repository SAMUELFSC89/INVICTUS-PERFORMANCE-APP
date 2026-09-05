import type { RecordedExerciseSet, WorkoutHealthRecord, WorkoutHeartRateEvidence } from '../../src/core/health/workoutHealthTypes.js';

export const MAX_WORKOUT_HEALTH_SETS = 200;
export const MAX_WORKOUT_HEART_RATE_SAMPLES = 5000;

export interface SanitizedWorkoutHealth {
  healthSession?: WorkoutHealthRecord;
  healthSessionStatus?: 'available' | 'partial' | 'unavailable';
  healthSessionReason?: string;
}

const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

function boundedText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text.length > 0 && text.length <= max && !/[\u0000-\u001f\u007f]/.test(text) ? text : null;
}

/** Require an explicit timezone. Never replace a missing observation time with "now". */
function timestamp(value: unknown, now: number): { iso: string; ms: number } | null {
  if (typeof value !== 'string' || value.length > 40 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || ms > now) return null;
  // Date.parse normalizes impossible calendar dates (e.g. February 30).
  const date = value.slice(0, 10);
  const [year, month, day] = date.split('-').map(Number);
  if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return null;
  return { iso: new Date(ms).toISOString(), ms };
}

function actualNumber(value: unknown, max: number, integer = false): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max && (!integer || Number.isInteger(value)) ? value : null;
}

/**
 * Private, additive health data only. No value here is copied into duration,
 * activity evidence, validation, XP or IGA. The authenticated request owns the
 * surrounding workout; user/owner/score fields inside this input are ignored.
 */
export function sanitizeWorkoutHealthRecord(input: unknown, now = Date.now()): SanitizedWorkoutHealth {
  if (input === undefined) return {};
  const raw = object(input);
  const sessionId = boundedText(raw?.sessionId, 160);
  const startedAt = timestamp(raw?.startedAt, now);
  const endedAt = timestamp(raw?.endedAt, now);
  if (!raw || raw.version !== 1 || !sessionId || !startedAt || !endedAt || endedAt.ms <= startedAt.ms) {
    return { healthSessionStatus: 'unavailable', healthSessionReason: 'O registro de saúde não tinha identificação ou horários válidos. O treino continua registrado.' };
  }

  const priorIntegrity = object(raw.integrity);
  // A second sanitation (e.g. after presence confirmation) must not promote a
  // previously incomplete record into complete evidence after discarded items
  // have already disappeared from the payload.
  let discardedSets = actualNumber(priorIntegrity?.discardedSets, 10000000, true) ?? 0;
  let invalidActualValues = false;
  const rawSets = Array.isArray(raw.sets) ? raw.sets : [];
  let setsPartial = !Array.isArray(raw.sets) || rawSets.length > MAX_WORKOUT_HEALTH_SETS || discardedSets > 0;
  discardedSets += Math.max(0, rawSets.length - MAX_WORKOUT_HEALTH_SETS);
  const seenIds = new Set<string>();
  const sets: RecordedExerciseSet[] = [];
  for (const value of rawSets.slice(0, MAX_WORKOUT_HEALTH_SETS)) {
    const set = object(value);
    const id = boundedText(set?.id, 160);
    const exerciseId = boundedText(set?.exerciseId, 160);
    const exerciseName = boundedText(set?.exerciseName, 160);
    const start = timestamp(set?.startedAt, now);
    const end = timestamp(set?.endedAt, now);
    const equipment = set?.equipment === null || set?.equipment === undefined ? null : boundedText(set.equipment, 120);
    if (!set || !id || !exerciseId || !exerciseName || !start || !end || end.ms <= start.ms || start.ms < startedAt.ms || end.ms > endedAt.ms
      || typeof set.status !== 'string' || !['completed', 'interrupted'].includes(set.status) || set.timingSource !== 'user_marked' || seenIds.has(id)
      || (set.equipment !== undefined && set.equipment !== null && equipment === null)) {
      discardedSets += 1; setsPartial = true; continue;
    }
    const enteredReps = actualNumber(set.reps, 1000, true);
    const reps = set.status === 'completed' && enteredReps !== 0 ? enteredReps : null;
    const loadKg = set.status === 'completed' ? actualNumber(set.loadKg, 1000) : null;
    if ((set.reps !== undefined && set.reps !== null && reps === null) || (set.loadKg !== undefined && set.loadKg !== null && loadKg === null)) {
      invalidActualValues = true; setsPartial = true;
    }
    seenIds.add(id);
    sets.push({ id, exerciseId, exerciseName, equipment, startedAt: start.iso, endedAt: end.iso, status: set.status as RecordedExerciseSet['status'], timingSource: 'user_marked', reps, loadKg });
  }
  sets.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  // Two simultaneously marked sets cannot identify which exercise produced a
  // heart-rate observation. Keep no ambiguous intervals in the health record.
  const unambiguousSets: RecordedExerciseSet[] = [];
  const ambiguous = new Set<string>();
  for (let i = 0; i < sets.length; i += 1) {
    for (let j = i + 1; j < sets.length && sets[j].startedAt < sets[i].endedAt; j += 1) {
      ambiguous.add(sets[i].id); ambiguous.add(sets[j].id);
    }
  }
  for (const set of sets) {
    if (ambiguous.has(set.id)) { discardedSets += 1; setsPartial = true; } else unambiguousSets.push(set);
  }

  const heart = object(raw.heartRate);
  const source = heart?.source === 'apple_health' || heart?.source === 'health_connect' ? heart.source : null;
  const sourceKey = heart?.sourceKey === null || heart?.sourceKey === undefined ? null : boundedText(heart.sourceKey, 256);
  const fetchedAt = timestamp(heart?.fetchedAt, now);
  const rawSamples = Array.isArray(heart?.samples) ? heart.samples : [];
  let discardedHeartRateSamples = (actualNumber(priorIntegrity?.discardedHeartRateSamples, 10000000, true) ?? 0) + Math.max(0, rawSamples.length - MAX_WORKOUT_HEART_RATE_SAMPLES);
  let heartPartial = !Array.isArray(heart?.samples) || rawSamples.length > MAX_WORKOUT_HEART_RATE_SAMPLES || heart?.truncated === true || discardedHeartRateSamples > 0;
  const validStatuses = ['available', 'pending', 'partial', 'unavailable'];
  const validHeartEnvelope = heart && typeof heart.status === 'string' && validStatuses.includes(heart.status) && fetchedAt && fetchedAt.ms >= endedAt.ms
    && (heart.sourceKey === undefined || heart.sourceKey === null || sourceKey !== null);
  const samplesByTime = new Map<string, number>();
  const ambiguousTimes = new Set<string>();
  if (validHeartEnvelope && source && (heart.status === 'available' || heart.status === 'partial')) {
    for (const value of rawSamples.slice(0, MAX_WORKOUT_HEART_RATE_SAMPLES)) {
      const sample = object(value);
      const time = timestamp(sample?.timestamp, now);
      const bpm = sample?.bpm;
      if (!time || time.ms < startedAt.ms || time.ms > endedAt.ms || typeof bpm !== 'number' || !Number.isFinite(bpm) || bpm < 30 || bpm > 240) {
        discardedHeartRateSamples += 1; heartPartial = true; continue;
      }
      if (ambiguousTimes.has(time.iso)) { discardedHeartRateSamples += 1; continue; }
      const previous = samplesByTime.get(time.iso);
      if (previous !== undefined && previous !== bpm) {
        samplesByTime.delete(time.iso); ambiguousTimes.add(time.iso); discardedHeartRateSamples += 2; heartPartial = true; continue;
      }
      samplesByTime.set(time.iso, bpm);
    }
  } else if (rawSamples.length > 0) {
    discardedHeartRateSamples += Math.min(rawSamples.length, MAX_WORKOUT_HEART_RATE_SAMPLES); heartPartial = true;
  }
  const samples = [...samplesByTime].sort(([a], [b]) => a.localeCompare(b)).map(([time, bpm]) => ({ timestamp: time, bpm }));
  const status: WorkoutHeartRateEvidence['status'] = samples.length > 0
    ? (heartPartial || heart?.status === 'partial' ? 'partial' : 'available')
    : validHeartEnvelope && heart?.status === 'pending' ? 'pending' : 'unavailable';
  const heartRate: WorkoutHeartRateEvidence = {
    status, source, sourceKey, samples, fetchedAt: fetchedAt?.iso ?? null,
    truncated: heart?.truncated === true || rawSamples.length > MAX_WORKOUT_HEART_RATE_SAMPLES,
    ...(status !== 'available' ? { reason: status === 'pending'
      ? 'O dispositivo ainda não disponibilizou os batimentos deste treino.'
      : status === 'partial' ? 'Parte das leituras não pôde ser usada. A análise considera somente amostras válidas.'
        : 'Não há leituras válidas de batimentos para este intervalo.' } : {})
  };
  const integrityPartial = setsPartial || heartPartial || priorIntegrity?.status === 'partial';
  const partial = integrityPartial || status !== 'available';
  return {
    healthSession: {
      version: 1, sessionId, startedAt: startedAt.iso, endedAt: endedAt.iso, sets: unambiguousSets, heartRate,
      integrity: { status: integrityPartial ? 'partial' : 'complete', discardedSets, discardedHeartRateSamples }
    },
    healthSessionStatus: partial ? 'partial' : 'available',
    ...(partial ? { healthSessionReason: setsPartial
      ? `Registro parcial: ${discardedSets} série(s) descartada(s)${invalidActualValues ? '; valores de carga ou repetições inválidos ficaram sem informação' : ''}. As conclusões devem respeitar essas lacunas.`
      : heartRate.reason || 'O registro de saúde está incompleto.' } : {})
  };
}
