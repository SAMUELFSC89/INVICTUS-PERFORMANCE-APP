const DAY = 86_400_000;

export type CardioLoadTrend = 'insufficient' | 'declining' | 'stable' | 'rising' | 'spiking';
export type CardioConsistencyBand = 'insufficient' | 'sporadic' | 'building' | 'consistent' | 'highly_consistent';

export interface CardioHistoryPoint {
  occurredAt: string;
  durationMinutes: number;
  modality?: string | null;
  distanceKm?: number | null;
}

export interface CardioCapacitySignature {
  /** Product characterization only; never a medical or injury-risk score. */
  version: 'CARDIO_CAPACITY_SIGNATURE_V1';
  dominantModality: string | null;
  modalityMinutes28d: Record<string, number>;
  sessionsPerWeek28d: number;
  activeWeeks28d: number;
  weeklyMinutesRecentFirst: [number, number, number, number];
  consistencyBand: CardioConsistencyBand;
  totalDistanceKm28d: number | null;
  runningDistanceKm28d: number | null;
  longestDistanceKm28d: number | null;
  longestRunningDistanceKm28d: number | null;
  medianSessionMinutes28d: number | null;
}

export interface CardioHistorySummary {
  windowDays: 28;
  sessions7d: number;
  sessions28d: number;
  activeDays7d: number;
  activeDays28d: number;
  minutes7d: number;
  previous7dMinutes: number;
  minutes28d: number;
  averageSessionMinutes28d: number | null;
  longestSessionMinutes28d: number | null;
  loadRatio7d: number | null;
  loadTrend: CardioLoadTrend;
  lastCardioAt: string | null;
  daysSinceLastCardio: number | null;
  capacitySignature: CardioCapacitySignature;
}

const round1 = (value: number) => Math.round(value * 10) / 10;
const median = (values: number[]) => {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
};

function buildCapacitySignature(valid: CardioHistoryPoint[], now: number): CardioCapacitySignature {
  const modalityMinutes = new Map<string, number>();
  const weeklyMinutes: [number, number, number, number] = [0, 0, 0, 0];
  let totalDistance = 0;
  let distanceSamples = 0;
  let runningDistance = 0;
  let runningDistanceSamples = 0;
  let longestDistance = 0;
  let longestRunningDistance = 0;

  for (const point of valid) {
    const ageDays = Math.max(0, (now - Date.parse(point.occurredAt)) / DAY);
    const weekIndex = Math.min(3, Math.floor(ageDays / 7));
    weeklyMinutes[weekIndex] += point.durationMinutes;

    const modality = typeof point.modality === 'string' && point.modality.trim() ? point.modality.trim() : 'unknown';
    modalityMinutes.set(modality, (modalityMinutes.get(modality) || 0) + point.durationMinutes);

    const distance = typeof point.distanceKm === 'number' && Number.isFinite(point.distanceKm) && point.distanceKm > 0 && point.distanceKm <= 300
      ? point.distanceKm
      : null;
    if (distance !== null) {
      totalDistance += distance;
      distanceSamples += 1;
      longestDistance = Math.max(longestDistance, distance);
      if (modality === 'running') {
        runningDistance += distance;
        runningDistanceSamples += 1;
        longestRunningDistance = Math.max(longestRunningDistance, distance);
      }
    }
  }

  const modalityEntries = [...modalityMinutes.entries()].filter(([modality]) => modality !== 'unknown');
  modalityEntries.sort((a, b) => b[1] - a[1]);
  const activeWeeks = weeklyMinutes.filter(value => value > 0).length;
  const consistencyBand: CardioConsistencyBand = valid.length < 2 ? 'insufficient'
    : activeWeeks <= 1 ? 'sporadic'
      : activeWeeks === 2 ? 'building'
        : activeWeeks === 3 ? 'consistent'
          : 'highly_consistent';

  return {
    version: 'CARDIO_CAPACITY_SIGNATURE_V1',
    dominantModality: modalityEntries[0]?.[0] || null,
    modalityMinutes28d: Object.fromEntries(modalityEntries.map(([key, value]) => [key, round1(value)])),
    sessionsPerWeek28d: round1(valid.length / 4),
    activeWeeks28d: activeWeeks,
    weeklyMinutesRecentFirst: weeklyMinutes.map(round1) as [number, number, number, number],
    consistencyBand,
    totalDistanceKm28d: distanceSamples ? round1(totalDistance) : null,
    runningDistanceKm28d: runningDistanceSamples ? round1(runningDistance) : null,
    longestDistanceKm28d: distanceSamples ? round1(longestDistance) : null,
    longestRunningDistanceKm28d: runningDistanceSamples ? round1(longestRunningDistance) : null,
    medianSessionMinutes28d: valid.length ? round1(median(valid.map(point => point.durationMinutes)) || 0) : null,
  };
}

/**
 * Pure summary of canonical completed cardio. The 7d/previous-7d comparison and
 * capacity signature are product context signals only: they must never be
 * presented as injury-risk scores, overtraining diagnoses or recovery proof.
 */
export function summarizeCardioHistory(points: CardioHistoryPoint[], nowIso: string): CardioHistorySummary {
  const now = Date.parse(nowIso);
  const cutoff28 = now - 28 * DAY;
  const cutoff14 = now - 14 * DAY;
  const cutoff7 = now - 7 * DAY;
  const valid = points
    .filter(point => Number.isFinite(Date.parse(point.occurredAt))
      && Date.parse(point.occurredAt) <= now
      && Date.parse(point.occurredAt) >= cutoff28
      && Number.isFinite(point.durationMinutes)
      && point.durationMinutes > 0
      && point.durationMinutes <= 600)
    .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));

  const current7 = valid.filter(point => Date.parse(point.occurredAt) >= cutoff7);
  const previous7 = valid.filter(point => Date.parse(point.occurredAt) >= cutoff14 && Date.parse(point.occurredAt) < cutoff7);
  const sum = (items: CardioHistoryPoint[]) => items.reduce((total, point) => total + point.durationMinutes, 0);
  const activeDays = (items: CardioHistoryPoint[]) => new Set(items.map(point => point.occurredAt.slice(0, 10))).size;
  const minutes7d = sum(current7);
  const previous7dMinutes = sum(previous7);
  const minutes28d = sum(valid);

  // Avoid manufacturing a ratio from one isolated workout or a near-zero prior week.
  const enoughForTrend = current7.length >= 2 && previous7.length >= 2 && previous7dMinutes >= 30;
  const loadRatio7d = enoughForTrend ? round1(minutes7d / previous7dMinutes) : null;
  const loadTrend: CardioLoadTrend = loadRatio7d === null ? 'insufficient'
    : loadRatio7d < 0.70 ? 'declining'
      : loadRatio7d <= 1.25 ? 'stable'
        : loadRatio7d <= 1.60 ? 'rising'
          : 'spiking';
  const last = valid.at(-1)?.occurredAt || null;

  return {
    windowDays: 28,
    sessions7d: current7.length,
    sessions28d: valid.length,
    activeDays7d: activeDays(current7),
    activeDays28d: activeDays(valid),
    minutes7d: round1(minutes7d),
    previous7dMinutes: round1(previous7dMinutes),
    minutes28d: round1(minutes28d),
    averageSessionMinutes28d: valid.length ? round1(minutes28d / valid.length) : null,
    longestSessionMinutes28d: valid.length ? round1(Math.max(...valid.map(point => point.durationMinutes))) : null,
    loadRatio7d,
    loadTrend,
    lastCardioAt: last,
    daysSinceLastCardio: last ? Math.max(0, Math.floor((now - Date.parse(last)) / DAY)) : null,
    capacitySignature: buildCapacitySignature(valid, now),
  };
}
