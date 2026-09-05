import { buildHealthViewModel, healthLocalDate, HealthPoint, HealthSummaryInput, HealthWorkoutInput } from '../core/health/healthViewModel';

const DAY = 86400000;
const now = Date.parse('2026-09-05T12:00:00Z');
const at = (days: number) => new Date(now - days * DAY).toISOString();
const point = (value: number, days: number, overrides: Partial<HealthPoint> = {}): HealthPoint => ({
  value, timestamp: at(days), source: 'apple_health', device: 'Watch A',
  confidenceAtMeasurement: { confidenceLevel: 'B' }, ...overrides
});
function summary(): HealthSummaryInput {
  return { windowDays: 30, latest: { heart_rate_resting: point(60, 0), hrv_sdnn: point(50, 0) },
    trends: { heart_rate_resting: Array.from({ length: 10 }, (_, i) => point(60, i + 1)), hrv_sdnn: Array.from({ length: 10 }, (_, i) => point(50, i + 1)) } };
}
function workouts(): HealthWorkoutInput[] {
  return [1, 3, 8, 10, 15, 17, 22, 24].map(days => ({ id: `workout-${days}`, timestamp: now - days * DAY, durationMinutes: 30, workoutType: 'Corrida' }));
}

describe('Health view model: truthful personal context', () => {
  test('empty account returns insufficiency, never invented zero baselines or recovery', () => {
    const vm = buildHealthViewModel({ summary: null, now });
    expect(vm.baselines.heart_rate_resting.value).toBeNull();
    expect(vm.recovery.status).toBe('INSUFFICIENT_DATA');
    expect(vm.readiness.status).toBe('INSUFFICIENT_DATA');
    expect(vm.weeklyReview.status).toBe('INSUFFICIENT_DATA');
    expect(vm.weeklyReview.nextSteps.join(' ')).toContain('Ainda faltam leituras de FC em repouso, HRV, Sono');
    expect(vm.weeklyReview.nextSteps.join(' ')).toContain('fonte de saúde');
  });
  test('seven distinct prior days form reference and current day does not leak into baseline', () => {
    const data = summary();
    data.trends.heart_rate_resting!.push(point(110, 0));
    const vm = buildHealthViewModel({ summary: data, now });
    expect(vm.baselines.heart_rate_resting.value).toBe(60);
    expect(vm.baselines.heart_rate_resting.baselineDays).toBe(10);
    expect(vm.baselines.heart_rate_resting.status).toBe('READY');
  });
  test('hundreds of measurements on one day do not stand in for seven days', () => {
    const data = summary();
    data.trends.heart_rate_resting = Array.from({ length: 300 }, () => point(60, 1));
    const vm = buildHealthViewModel({ summary: data, now });
    expect(vm.baselines.heart_rate_resting.status).toBe('INSUFFICIENT_BASELINE');
    expect(vm.baselines.heart_rate_resting.baselineDays).toBe(1);
    expect(vm.baselines.heart_rate_resting.reason).toContain('1 de 7 dias');
    expect(vm.weeklyReview.nextSteps.join(' ')).toContain('FC em repouso: Sua referência tem 1 de 7 dias');
  });
  test('source change and HRV method change do not inherit a different baseline', () => {
    const data = summary();
    data.latest.heart_rate_resting = point(50, 0, { device: 'Watch B' });
    data.latest.hrv_rmssd = point(60, 0);
    const vm = buildHealthViewModel({ summary: data, now });
    expect(vm.baselines.heart_rate_resting.status).toBe('INSUFFICIENT_BASELINE');
    expect(vm.baselines.hrv_rmssd.status).toBe('INSUFFICIENT_BASELINE');
    expect(vm.baselines.hrv_sdnn.status).toBe('READY');
  });
  test('old and future observations cannot describe today', () => {
    const data = summary();
    data.latest.heart_rate_resting = point(50, 10);
    data.latest.hrv_sdnn = point(60, -1);
    const vm = buildHealthViewModel({ summary: data, now });
    expect(vm.recovery.status).toBe('INSUFFICIENT_DATA');
    expect(vm.baselines.heart_rate_resting.status).toBe('STALE');
    expect(vm.baselines.hrv_sdnn.status).toBe('STALE');
    expect(vm.weeklyReview.nextSteps.join(' ')).toContain('leitura mais recente');
    expect(vm.weeklyReview.nextSteps.join(' ')).toContain('data e a hora');
    expect(vm.weeklyReview.nextSteps.join(' ')).not.toMatch(/conecte|conectar/i);
  });
  test('evidence downgrade overrides the historic favorable confidence', () => {
    const data = summary();
    data.latest.heart_rate_resting = point(55, 0, { currentEvidenceConfidence: { confidenceLevel: 'E' } });
    const vm = buildHealthViewModel({ summary: data, now });
    expect(vm.baselines.heart_rate_resting.status).toBe('UNRELIABLE');
    expect(vm.recovery.status).toBe('INSUFFICIENT_DATA');
  });
  test('partial heart-rate series does not disable unrelated complete baselines', () => {
    const data = summary();
    data.metadata = { partial: true, metrics: { heart_rate_resting: { partial: true }, hrv_sdnn: { partial: false } } };
    const vm = buildHealthViewModel({ summary: data, now });
    expect(vm.baselines.heart_rate_resting.status).toBe('PARTIAL');
    expect(vm.baselines.hrv_sdnn.status).toBe('READY');
  });
  test('both HRV methods are a single physiological signal, not two votes', () => {
    const data = summary();
    delete data.latest.heart_rate_resting;
    data.latest.hrv_rmssd = point(50, 0);
    data.trends.hrv_rmssd = Array.from({ length: 10 }, (_, i) => point(50, i + 1));
    const vm = buildHealthViewModel({ summary: data, now });
    expect(vm.recovery.status).toBe('INSUFFICIENT_DATA');
  });
  test('recorded duration compares nonoverlapping weeks and deduplicates session ids', () => {
    const sessions = workouts();
    const vm = buildHealthViewModel({ summary: summary(), workouts: [...sessions, sessions[0]], now });
    expect(vm.load.sessions7d).toBe(2);
    expect(vm.load.minutes7d).toBe(60);
    expect(vm.load.baselineWeeklyMinutes).toBe(60);
    expect(vm.load.ratio).toBe(1);
    expect(vm.load.method).toBe('RECORDED_DURATION');
    expect(vm.readiness.status).toBe('WITHIN_BASELINE');
  });
  test('truncated workouts disable readiness and comparison without hiding known counts', () => {
    const vm = buildHealthViewModel({ summary: summary(), workouts: workouts(), trainingPartial: true, now });
    expect(vm.load.status).toBe('PARTIAL');
    expect(vm.load.ratio).toBeNull();
    expect(vm.readiness.status).toBe('INSUFFICIENT_DATA');
    expect(vm.weeklyReview.status).toBe('PARTIAL');
    expect(vm.weeklyReview.highlights.find(h => h.id === 'weekly-training')?.detail).toContain('Totais parciais');
    expect(vm.weeklyReview.nextSteps.join(' ')).toContain('histórico de treinos chegou incompleto');
  });
  test.each([0, Number.NaN, undefined])('a received session without usable duration (%s) blocks volume comparison, but not physiological signals', durationMinutes => {
    const vm = buildHealthViewModel({ summary: summary(), workouts: [...workouts(), { id: 'missing-duration', timestamp: now - 2 * DAY, durationMinutes: durationMinutes as number }], now });
    expect(vm.load.status).toBe('PARTIAL');
    expect(vm.load.incompleteDuration).toBe(true);
    expect(vm.load.sessions7d).toBe(3);
    expect(vm.load.minutes7d).toBe(60);
    expect(vm.load.ratio).toBeNull();
    expect(vm.load.baselineWeeklyMinutes).toBeNull();
    expect(vm.load.description).toContain('Falta duração em sessões recebidas');
    expect(vm.readiness.status).toBe('INSUFFICIENT_DATA');
    expect(vm.recovery.status).toBe('WITHIN_BASELINE');
    expect(vm.weeklyReview.status).toBe('PARTIAL');
    expect(vm.weeklyReview.nextSteps[0]).toContain('complete a duração no registro de origem');
    expect(vm.weeklyReview.highlights.find(h => h.id === 'weekly-training')?.detail).toContain('3 sessões recebidas');
    expect(vm.weeklyReview.highlights.find(h => h.id === 'weekly-training')?.detail).not.toContain('sessões ainda não recebidas');
  });
  test('missing duration is scoped separately to weekly reference and sleep comparison windows', () => {
    const data = summary();
    data.trends.sleep_duration_min = Array.from({ length: 12 }, (_, i) => point(i % 2 ? 360 : 480, i + 1));
    data.latest.sleep_duration_min = point(480, 0);
    const sessions = Array.from({ length: 24 }, (_, i) => ({ id: `complete-${i}`, timestamp: now - (i + 1) * DAY, durationMinutes: i % 2 ? 30 : 60 }));
    const incomplete = (days: number) => ({ id: `incomplete-${days}`, timestamp: now - days * DAY, durationMinutes: 0 });
    const outside = buildHealthViewModel({ summary: data, workouts: [...sessions, incomplete(40), incomplete(-1), { ...incomplete(1), timestamp: Number.NaN }], now, periodDays: 30 });
    expect(outside.load.status).toBe('AVAILABLE');
    expect(outside.sleepActivity.status).toBe('AVAILABLE');
    const sleepOnly = buildHealthViewModel({ summary: data, workouts: [...sessions, incomplete(29)], now, periodDays: 30 });
    expect(sleepOnly.load.status).toBe('AVAILABLE');
    expect(sleepOnly.sleepActivity.status).toBe('PARTIAL');
    expect(sleepOnly.sleepActivity.activityDifferencePercent).toBeNull();
    expect(sleepOnly.sleepActivity.points).toBeUndefined();
    expect(sleepOnly.sleepActivity.description).toContain('Falta duração em sessões recebidas');
    expect(sleepOnly.weeklyReview.nextSteps[0]).toContain('período de 30 dias');
    const today = buildHealthViewModel({ summary: data, workouts: [...sessions, incomplete(0)], now, periodDays: 30 });
    expect(today.load.status).toBe('PARTIAL');
    expect(today.sleepActivity.status).toBe('AVAILABLE');
    const reference = buildHealthViewModel({ summary: data, workouts: [...sessions, incomplete(25)], now, periodDays: 30 });
    expect(reference.load.status).toBe('PARTIAL');
    expect(reference.sleepActivity.status).toBe('PARTIAL');
  });
  test('an incomplete duplicate does not invalidate a received version with usable duration', () => {
    const sessions = workouts();
    const vm = buildHealthViewModel({ summary: summary(), workouts: [{ ...sessions[0], durationMinutes: 0 }, ...sessions], now });
    expect(vm.load.status).toBe('AVAILABLE');
    expect(vm.load.sessions7d).toBe(2);
    expect(vm.load.minutes7d).toBe(60);
    expect(vm.load.incompleteDuration).toBeUndefined();
  });
  test('sleep relationship sums both sessions on a local day, and names the measured variable', () => {
    const data = summary();
    data.trends.sleep_duration_min = Array.from({ length: 12 }, (_, i) => point(i % 2 ? 360 : 480, i + 1));
    data.latest.sleep_duration_min = point(480, 1);
    const sessions = Array.from({ length: 12 }, (_, i) => [
      { id: `${i}-a`, timestamp: now - (i + 1) * DAY + 3600000, durationMinutes: i % 2 ? 30 : 60 },
      { id: `${i}-b`, timestamp: now - (i + 1) * DAY + 7200000, durationMinutes: 10 }
    ]).flat();
    const vm = buildHealthViewModel({ summary: data, workouts: sessions, now, timeZone: 'America/Sao_Paulo' });
    expect(vm.sleepActivity.status).toBe('AVAILABLE');
    expect(vm.sleepActivity.points).toHaveLength(12);
    expect(vm.sleepActivity.points).toContainEqual({ sleepMinutes: 480, activeMinutes: 70 });
    expect(vm.sleepActivity.points).toContainEqual({ sleepMinutes: 360, activeMinutes: 40 });
    expect(vm.sleepActivity.activityDifferencePercent).toBeCloseTo(75);
    expect(vm.sleepActivity.description).toContain('tempo de treino registrado');
    expect(vm.sleepActivity.description).toContain('não prova');
  });
  test('calendar dates use requested timezone rather than UTC substring', () => {
    expect(healthLocalDate('2026-09-05T01:30:00Z', 'America/Sao_Paulo')).toBe('2026-09-04');
    expect(healthLocalDate('2026-09-05T01:30:00Z', 'UTC')).toBe('2026-09-05');
  });
  test('unit mismatch and per-metric partial flags cannot generate a ready baseline', () => {
    const data = summary();
    data.latest.heart_rate_resting = point(1, 0, { unit: 'hz' });
    data.metadata = { partial: false, metrics: { hrv_sdnn: { partial: true } } };
    const vm = buildHealthViewModel({ summary: data, now });
    expect(vm.baselines.heart_rate_resting.status).toBe('UNRELIABLE');
    expect(vm.baselines.hrv_sdnn.status).toBe('PARTIAL');
    expect(vm.weeklyReview.status).toBe('PARTIAL');
    expect(vm.weeklyReview.nextSteps.join(' ')).toContain('unidade da leitura no relatório');
    expect(vm.weeklyReview.nextSteps.join(' ')).toContain('Parte do histórico ainda não foi recebida');
  });
  test('next step names the unfavorable signal and measured comparison without inventing a training prescription', () => {
    const data = summary();
    data.latest.heart_rate_resting = point(75, 0);
    const vm = buildHealthViewModel({ summary: data, workouts: workouts(), now });
    expect(vm.recovery.status).toBe('BELOW_BASELINE');
    expect(vm.weeklyReview.nextSteps[0]).toContain('FC em repouso: 75 bpm');
    expect(vm.weeklyReview.nextSteps[0]).toContain('referência de 60 bpm');
    expect(vm.weeklyReview.nextSteps[0]).toContain('próxima leitura');
    expect(vm.weeklyReview.nextSteps.join(' ')).not.toMatch(/reduza|aumente|descanso|risco de lesão|liberado/i);
    expect(vm.weeklyReview.nextSteps.join(' ')).not.toContain('faltam leituras');
  });
  test('a changed amount of recorded training prompts checking records, not a claim about better performance', () => {
    const sessions = workouts().map(w => now - w.timestamp < 7 * DAY ? { ...w, durationMinutes: 60 } : w);
    const vm = buildHealthViewModel({ summary: summary(), workouts: sessions, now });
    expect(vm.load.ratio).toBe(2);
    expect(vm.load.description).toContain('120 min registrados nos últimos 7 dias');
    expect(vm.load.description).toContain('60 min por semana');
    expect(vm.load.description).not.toContain('Razão');
    expect(vm.weeklyReview.nextSteps.join(' ')).toContain('se todas as sessões aparecem');
    expect(vm.weeklyReview.nextSteps.join(' ')).not.toMatch(/melhor|evolução|progresso/i);
  });
  test('review labels distinguish current signals, the training week, and the selected sleep period', () => {
    const data = summary();
    data.trends.sleep_duration_min = Array.from({ length: 12 }, (_, i) => point(i % 2 ? 360 : 480, i + 1));
    data.latest.sleep_duration_min = point(480, 0);
    const sessions = Array.from({ length: 24 }, (_, i) => ({ timestamp: now - (i + 1) * DAY, durationMinutes: i % 2 ? 30 : 60 }));
    const vm = buildHealthViewModel({ summary: data, workouts: sessions, now, periodDays: 90 });
    const highlight = (id: string) => vm.weeklyReview.highlights.find(h => h.id === id)!;
    expect(highlight('weekly-training').title).toContain('Últimos 7 dias');
    expect(highlight('weekly-volume').title).toContain('Últimos 7 dias');
    expect(highlight('body-signals').title).toContain('Leitura de hoje');
    expect(highlight('sleep-activity').title).toContain('Últimos 90 dias');
    expect(highlight('body-signals').detail).toContain('referência de 60 bpm');
  });
  test('a seven-day window tells the user to select a longer period for the ten-pair sleep comparison', () => {
    const data = summary();
    data.trends.sleep_duration_min = Array.from({ length: 7 }, (_, i) => point(i % 2 ? 360 : 480, i + 1));
    data.latest.sleep_duration_min = point(480, 0);
    const vm = buildHealthViewModel({ summary: data, workouts: workouts(), now, periodDays: 7 });
    expect(vm.sleepActivity.status).toBe('INSUFFICIENT_DATA');
    expect(vm.sleepActivity.description).toContain('Selecione um período maior');
    expect(vm.sleepActivity.description).toContain('10 dias');
  });
  test('sleep comparison excludes current local day and unknown partial scope', () => {
    const data = summary();
    data.metadata = { partial: true, metrics: {} };
    const vm = buildHealthViewModel({ summary: data, workouts: workouts(), now });
    expect(vm.sleepActivity.status).toBe('PARTIAL');
    expect(vm.sleepActivity.points).toBeUndefined();
    const complete = summary();
    complete.trends.sleep_duration_min = Array.from({ length: 12 }, (_, i) => point(i % 2 ? 360 : 480, i + 1));
    complete.latest.sleep_duration_min = point(480, 0);
    const sessions = Array.from({ length: 12 }, (_, i) => ({ timestamp: now - (i + 1) * DAY, durationMinutes: i % 2 ? 30 : 60 }));
    const before = buildHealthViewModel({ summary: complete, workouts: sessions, now });
    complete.trends.sleep_duration_min.push(point(900, 0));
    const after = buildHealthViewModel({ summary: complete, workouts: [...sessions, { timestamp: now, durationMinutes: 1000 }], now });
    expect(after.sleepActivity).toEqual(before.sleepActivity);
  });
});
