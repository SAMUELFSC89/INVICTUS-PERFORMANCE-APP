import { getModalityConfig } from '../../config/cardioConfig';
import type { HealthWorkoutInput } from './healthViewModel';

/** Input must already be scoped to the signed-in user's eligible health history.
 * Competition approval is deliberately not a requirement of this summary. */
export interface HealthPeriodWorkoutInput extends HealthWorkoutInput {
  caloriesBurned?: number;
  maxHeartRate?: number;
}

export interface HealthPeriodPoint {
  /** Calendar date in the resolved time zone, rather than an elapsed 24h bucket. */
  date: string;
  label: string;
  /** No recorded value is a gap, never a fabricated zero measurement. */
  value: number | null;
  sessions: number;
  coveredSessions: number;
}

export interface HealthPeriodSummary<T extends HealthPeriodWorkoutInput = HealthPeriodWorkoutInput> {
  periodDays: number;
  timeZone: string;
  startDate: string;
  endDate: string;
  partial: boolean;
  sessionCount: number;
  activeDays: number;
  activeMinutes: number | null;
  distanceKm: number | null;
  caloriesBurned: number | null;
  /** Arithmetic mean of available session averages; not continuous HR coverage. */
  averageHeartRate: number | null;
  heartRateMethod: 'SESSION_MEAN';
  maxHeartRate: number | null;
  coverage: {
    durationSessions: number;
    distanceSessions: number;
    calorieSessions: number;
    heartRateSessions: number;
    maxHeartRateSessions: number;
  };
  dailyMinutes: HealthPeriodPoint[];
  dailyCalories: HealthPeriodPoint[];
  dailyHeartRate: HealthPeriodPoint[];
  groups: Array<{ type: string; label: string; sessions: number; minutes: number | null }>;
  /** Same filtered, deduplicated population used by every aggregate. */
  workouts: T[];
  latestWorkouts: T[];
  firstAt: number | null;
  lastAt: number | null;
}

const DAY = 86_400_000;
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;
const recordedSum = (values: number[]): number | null => values.length ? values.reduce((total, value) => total + value, 0) : null;

function modality(workout: HealthPeriodWorkoutInput): { type: string; label: string } {
  const raw = (workout.cardioType || workout.workoutType || 'activity').trim().toLowerCase();
  const key = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[ -]+/g, '_');
  if (/^(workout|strength|strength_training|traditional_strength_training|functional_strength_training|musculacao|weightlifting)$/.test(key)) {
    return { type: 'strength', label: 'Força' };
  }
  const aliases: Record<string, string> = {
    corrida: 'running', run: 'running', caminhada: 'walking', walk: 'walking',
    cycling: 'bike', ciclismo: 'bike', natacao: 'swimming', swim: 'swimming',
    esteira: 'treadmill', bicicleta_ergometrica: 'stationary_bike',
  };
  const type = aliases[key] || key || 'activity';
  const config = getModalityConfig(type);
  if (config) return { type, label: config.label };
  const labels: Record<string, string> = { activity: 'Atividade', other: 'Outra atividade', cardio: 'Cardio' };
  const readable = type.replace(/_/g, ' ');
  return { type, label: labels[type] || readable.charAt(0).toUpperCase() + readable.slice(1) };
}

/** All cards, daily charts and session lists share one local-calendar window.
 * Invalid/absent numeric fields are omitted separately, not imputed. Duplicate
 * nonempty IDs retain the first eligible input record, without merging values. */
export function buildHealthPeriodSummary<T extends HealthPeriodWorkoutInput>(
  workouts: readonly T[], now: number, periodDays: number, timeZone = 'UTC', partial = false,
): HealthPeriodSummary<T> {
  if (!Number.isFinite(now) || !Number.isFinite(new Date(now).getTime())) throw new RangeError('Invalid health summary timestamp');
  if (!Number.isSafeInteger(periodDays) || periodDays < 1) throw new RangeError('Health period must contain a positive whole number of days');
  let resolvedTimeZone = timeZone;
  try { resolvedTimeZone = new Intl.DateTimeFormat('en', { timeZone }).resolvedOptions().timeZone; }
  catch { resolvedTimeZone = 'UTC'; }
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: resolvedTimeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const localDate = (timestamp: number): string => {
    const parts = formatter.formatToParts(timestamp);
    const part = (type: string) => parts.find(item => item.type === type)!.value;
    return `${part('year')}-${part('month')}-${part('day')}`;
  };
  const endDate = localDate(now);
  // Only date labels are moved in UTC. This does not subtract 24h from a local
  // midnight, so daylight-saving changes cannot add or remove a calendar day.
  const todayUtc = Date.parse(`${endDate}T00:00:00Z`);
  const dates = Array.from({ length: periodDays }, (_, index) => new Date(todayUtc - (periodDays - 1 - index) * DAY).toISOString().slice(0, 10));
  const startDate = dates[0];
  const ids = new Set<string>();
  const byDay = new Map<string, T[]>();
  const selected: T[] = [];
  for (const workout of workouts) {
    if (!positive(workout.timestamp) || workout.timestamp > now) continue;
    const day = localDate(workout.timestamp);
    if (day < startDate || day > endDate) continue;
    const id = workout.id?.trim();
    if (id && ids.has(id)) continue;
    if (id) ids.add(id);
    selected.push(workout);
    const dayWorkouts = byDay.get(day) || [];
    dayWorkouts.push(workout);
    byDay.set(day, dayWorkouts);
  }
  selected.sort((a, b) => a.timestamp - b.timestamp);
  const values = (field: 'durationMinutes' | 'distanceKm' | 'caloriesBurned' | 'avgHeartRate' | 'maxHeartRate') => selected.map(workout => workout[field]).filter(positive);
  const durations = values('durationMinutes');
  const distances = values('distanceKm');
  const calories = values('caloriesBurned');
  const heartRates = values('avgHeartRate');
  const maxima = values('maxHeartRate');
  const daily = (field: 'durationMinutes' | 'caloriesBurned' | 'avgHeartRate', average = false): HealthPeriodPoint[] => dates.map(date => {
    const sessions = byDay.get(date) || [];
    const recorded = sessions.map(workout => workout[field]).filter(positive);
    const total = recordedSum(recorded);
    return { date, label: `${date.slice(8, 10)}/${date.slice(5, 7)}`, value: total === null ? null : average ? total / recorded.length : total,
      sessions: sessions.length, coveredSessions: recorded.length };
  });
  const byModality = new Map<string, { type: string; label: string; sessions: number; durations: number[] }>();
  for (const workout of selected) {
    const kind = modality(workout);
    const group = byModality.get(kind.type) || { ...kind, sessions: 0, durations: [] };
    group.sessions++;
    if (positive(workout.durationMinutes)) group.durations.push(workout.durationMinutes);
    byModality.set(kind.type, group);
  }
  return {
    periodDays, timeZone: resolvedTimeZone, startDate, endDate, partial,
    sessionCount: selected.length, activeDays: byDay.size,
    activeMinutes: recordedSum(durations), distanceKm: recordedSum(distances), caloriesBurned: recordedSum(calories),
    averageHeartRate: heartRates.length ? recordedSum(heartRates)! / heartRates.length : null,
    heartRateMethod: 'SESSION_MEAN', maxHeartRate: maxima.length ? Math.max(...maxima) : null,
    coverage: { durationSessions: durations.length, distanceSessions: distances.length, calorieSessions: calories.length, heartRateSessions: heartRates.length, maxHeartRateSessions: maxima.length },
    dailyMinutes: daily('durationMinutes'), dailyCalories: daily('caloriesBurned'), dailyHeartRate: daily('avgHeartRate', true),
    groups: [...byModality.values()].map(({ durations: groupDurations, ...group }) => ({ ...group, minutes: recordedSum(groupDurations) }))
      .sort((a, b) => b.sessions - a.sessions || a.type.localeCompare(b.type)),
    workouts: selected, latestWorkouts: selected.slice(-6).reverse(),
    firstAt: selected[0]?.timestamp ?? null, lastAt: selected[selected.length - 1]?.timestamp ?? null,
  };
}
