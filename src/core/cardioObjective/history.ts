const DAY = 86_400_000;

export type CardioLoadTrend = 'insufficient' | 'declining' | 'stable' | 'rising' | 'spiking';

export interface CardioHistoryPoint {
  occurredAt: string;
  durationMinutes: number;
  modality?: string | null;
  distanceKm?: number | null;
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
}

const round1 = (value: number) => Math.round(value * 10) / 10;

/**
 * Pure summary of canonical completed cardio. The 7d/previous-7d comparison is
 * a product context signal only: it must never be presented as an injury-risk
 * score or a clinical recovery diagnosis.
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
  };
}
