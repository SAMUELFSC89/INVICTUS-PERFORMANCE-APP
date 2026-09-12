import { summarizeCardioHistory } from '../../src/core/cardioObjective/history';

const now = '2026-09-12T12:00:00.000Z';

it('resume sessões, dias ativos, minutos e tendência sem transformar razão em diagnóstico', () => {
  const summary = summarizeCardioHistory([
    { occurredAt: '2026-09-12T08:00:00.000Z', durationMinutes: 50, modality: 'running', distanceKm: 8 },
    { occurredAt: '2026-09-10T08:00:00.000Z', durationMinutes: 40, modality: 'running', distanceKm: 6 },
    { occurredAt: '2026-09-04T08:00:00.000Z', durationMinutes: 30, modality: 'bike', distanceKm: 12 },
    { occurredAt: '2026-09-02T08:00:00.000Z', durationMinutes: 30, modality: 'bike', distanceKm: 11 },
    { occurredAt: '2026-08-25T08:00:00.000Z', durationMinutes: 60, modality: 'running', distanceKm: 9 },
    { occurredAt: '2026-08-01T08:00:00.000Z', durationMinutes: 999, modality: 'running', distanceKm: 100 },
    { occurredAt: '2026-09-13T08:00:00.000Z', durationMinutes: 200, modality: 'running', distanceKm: 30 },
  ], now);

  expect(summary).toMatchObject({
    sessions7d: 2,
    sessions28d: 5,
    activeDays7d: 2,
    activeDays28d: 5,
    minutes7d: 90,
    previous7dMinutes: 60,
    minutes28d: 210,
    averageSessionMinutes28d: 42,
    longestSessionMinutes28d: 60,
    loadRatio7d: 1.5,
    loadTrend: 'rising',
    lastCardioAt: '2026-09-12T08:00:00.000Z',
    daysSinceLastCardio: 0,
  });
  expect(summary.capacitySignature).toMatchObject({
    version: 'CARDIO_CAPACITY_SIGNATURE_V1',
    dominantModality: 'running',
    sessionsPerWeek28d: 1.3,
    activeWeeks28d: 3,
    consistencyBand: 'consistent',
    totalDistanceKm28d: 46,
    runningDistanceKm28d: 23,
    longestDistanceKm28d: 12,
    longestRunningDistanceKm28d: 9,
    medianSessionMinutes28d: 40,
  });
  expect(summary.capacitySignature.modalityMinutes28d).toEqual({ running: 150, bike: 60 });
});

it('não fabrica tendência a partir de uma semana quase vazia', () => {
  const summary = summarizeCardioHistory([
    { occurredAt: '2026-09-11T08:00:00.000Z', durationMinutes: 45 },
    { occurredAt: '2026-09-10T08:00:00.000Z', durationMinutes: 45 },
    { occurredAt: '2026-09-04T08:00:00.000Z', durationMinutes: 10 },
  ], now);
  expect(summary.loadRatio7d).toBeNull();
  expect(summary.loadTrend).toBe('insufficient');
  expect(summary.capacitySignature.activeWeeks28d).toBe(2);
  expect(summary.capacitySignature.consistencyBand).toBe('building');
});

it('distingue duas rotinas com volume parecido pela modalidade e consistência', () => {
  const consistentRunner = summarizeCardioHistory([
    { occurredAt: '2026-09-11T08:00:00.000Z', durationMinutes: 35, modality: 'running', distanceKm: 5 },
    { occurredAt: '2026-09-03T08:00:00.000Z', durationMinutes: 35, modality: 'running', distanceKm: 5 },
    { occurredAt: '2026-08-27T08:00:00.000Z', durationMinutes: 35, modality: 'running', distanceKm: 5 },
    { occurredAt: '2026-08-20T08:00:00.000Z', durationMinutes: 35, modality: 'running', distanceKm: 5 },
  ], now);
  const clusteredCyclist = summarizeCardioHistory([
    { occurredAt: '2026-09-11T08:00:00.000Z', durationMinutes: 70, modality: 'bike', distanceKm: 25 },
    { occurredAt: '2026-09-10T08:00:00.000Z', durationMinutes: 70, modality: 'bike', distanceKm: 25 },
  ], now);

  expect(consistentRunner.minutes28d).toBe(clusteredCyclist.minutes28d);
  expect(consistentRunner.capacitySignature).toMatchObject({ dominantModality: 'running', consistencyBand: 'highly_consistent', activeWeeks28d: 4 });
  expect(clusteredCyclist.capacitySignature).toMatchObject({ dominantModality: 'bike', consistencyBand: 'sporadic', activeWeeks28d: 1 });
});

it('descarta durações inválidas e atividades futuras', () => {
  const summary = summarizeCardioHistory([
    { occurredAt: '2026-09-11T08:00:00.000Z', durationMinutes: 0 },
    { occurredAt: '2026-09-11T09:00:00.000Z', durationMinutes: 601 },
    { occurredAt: '2026-09-13T08:00:00.000Z', durationMinutes: 30 },
  ], now);
  expect(summary.sessions28d).toBe(0);
  expect(summary.averageSessionMinutes28d).toBeNull();
  expect(summary.lastCardioAt).toBeNull();
  expect(summary.capacitySignature).toMatchObject({ consistencyBand: 'insufficient', dominantModality: null, sessionsPerWeek28d: 0 });
});
