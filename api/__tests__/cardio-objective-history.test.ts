import { summarizeCardioHistory } from '../../src/core/cardioObjective/history';

const now = '2026-09-12T12:00:00.000Z';

it('resume sessões, dias ativos, minutos e tendência sem transformar razão em diagnóstico', () => {
  const summary = summarizeCardioHistory([
    { occurredAt: '2026-09-12T08:00:00.000Z', durationMinutes: 50, modality: 'running' },
    { occurredAt: '2026-09-10T08:00:00.000Z', durationMinutes: 40, modality: 'running' },
    { occurredAt: '2026-09-04T08:00:00.000Z', durationMinutes: 30, modality: 'bike' },
    { occurredAt: '2026-09-02T08:00:00.000Z', durationMinutes: 30, modality: 'bike' },
    { occurredAt: '2026-08-25T08:00:00.000Z', durationMinutes: 60, modality: 'running' },
    { occurredAt: '2026-08-01T08:00:00.000Z', durationMinutes: 999, modality: 'running' },
    { occurredAt: '2026-09-13T08:00:00.000Z', durationMinutes: 200, modality: 'running' },
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
});

it('não fabrica tendência a partir de uma semana quase vazia', () => {
  const summary = summarizeCardioHistory([
    { occurredAt: '2026-09-11T08:00:00.000Z', durationMinutes: 45 },
    { occurredAt: '2026-09-10T08:00:00.000Z', durationMinutes: 45 },
    { occurredAt: '2026-09-04T08:00:00.000Z', durationMinutes: 10 },
  ], now);
  expect(summary.loadRatio7d).toBeNull();
  expect(summary.loadTrend).toBe('insufficient');
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
});
