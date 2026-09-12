import { buildCardioBaseline, classifyCardioProfile, createJourney, initialPrescription } from '../../src/core/cardioObjective/engine';
import { CARDIO_RESEARCH_SOURCES, CARDIO_RESEARCH_VERSION, buildResearchDecisionTrace } from '../../src/core/cardioObjective/research';
import type { CardioHistorySummary } from '../../src/core/cardioObjective/history';
import type { ObjectiveAnswers, ProfileSnapshot } from '../../src/core/cardioObjective/types';

const now = '2026-09-12T03:00:00.000Z';
const safety = { screened: true, signals: [], medicalClearance: null };
const profile: ProfileSnapshot = {
  capturedAt: now, weightKg: 80, heightCm: 175, ageYears: 30,
  strengthDays: [], source: 'users', planId: null,
  recentCardioSessions: 0, recentLongestRunKm: null,
  historyStatus: 'available', historyWindowDays: 28,
};
const base: ObjectiveAnswers = {
  goalType: 'sedentary', walkingMinutes: 15, runningAbility: 'none', availableMinutes: 40,
  availableDays: [1, 3, 5], timeZone: 'America/Sao_Paulo', preferredMoment: 'morning',
  preferredActivity: 'walking', barrier: 'starting', confidenceScore: 8,
  safety, productConsent: true,
};
const history = (overrides: Partial<CardioHistorySummary> = {}): CardioHistorySummary => ({
  windowDays: 28,
  sessions7d: 3,
  sessions28d: 6,
  activeDays7d: 3,
  activeDays28d: 6,
  minutes7d: 105,
  previous7dMinutes: 90,
  minutes28d: 240,
  averageSessionMinutes28d: 40,
  longestSessionMinutes28d: 60,
  loadRatio7d: 1.2,
  loadTrend: 'stable',
  lastCardioAt: '2026-09-11T08:00:00.000Z',
  daysSinceLastCardio: 0,
  capacitySignature: {
    version: 'CARDIO_CAPACITY_SIGNATURE_V1',
    dominantModality: 'running',
    modalityMinutes28d: { running: 240 },
    sessionsPerWeek28d: 1.5,
    activeWeeks28d: 4,
    weeklyMinutesRecentFirst: [105, 90, 25, 20],
    consistencyBand: 'highly_consistent',
    totalDistanceKm28d: 30,
    runningDistanceKm28d: 30,
    longestDistanceKm28d: 6,
    longestRunningDistanceKm28d: 6,
    medianSessionMinutes28d: 40,
  },
  ...overrides,
});

it('mantém uma biblioteca de evidência versionada e auditável', () => {
  expect(CARDIO_RESEARCH_VERSION).toBe('CARDIO_EVIDENCE_2026_09_V2');
  expect(Object.keys(CARDIO_RESEARCH_SOURCES)).toEqual(expect.arrayContaining([
    'WHO_2020', 'CDC_START_SLOW', 'ACSM_FITT', 'SEILER_2010', 'ENDURANCE_TID_2025',
    'RUNNING_LOAD_2021', 'LOAD_PROGRESSION_2021', 'ACWR_2025',
  ]));
  for (const source of Object.values(CARDIO_RESEARCH_SOURCES)) {
    expect(source.url).toMatch(/^https:\/\//);
    expect(source.supports.length).toBeGreaterThan(30);
  }
});

it('faz perguntas internas explícitas antes de gerar a missão', () => {
  const trace = buildResearchDecisionTrace(base, profile, 'sedentary');
  expect(trace.map(item => item.id)).toEqual(expect.arrayContaining([
    'safety_gate', 'current_activity', 'observed_training_history', 'capacity_signature', 'recent_load_change',
    'sport_transfer', 'continuous_capacity', 'goal_specificity', 'real_life_constraint',
    'adherence_barrier', 'recovery_information', 'trained_intensity_distribution', 'progression_uncertainty',
  ]));
  expect(trace.every(item => item.question && item.answer && item.impact && item.evidenceIds.length)).toBe(true);
});

it('diferencia sedentário, ativo, corredor e avançado em vez de usar uma receita única', () => {
  const sedentary = initialPrescription(base, profile);
  const activeAnswers: ObjectiveAnswers = { ...base, goalType: 'conditioning', runningAbility: 'minutes', preferredActivity: 'running' };
  const runnerAnswers: ObjectiveAnswers = { ...base, goalType: 'conditioning', walkingMinutes: 45, runningAbility: 'regular', preferredActivity: 'running' };
  const advancedAnswers: ObjectiveAnswers = { ...base, goalType: 'endurance', walkingMinutes: 45, runningAbility: 'structured', preferredActivity: 'running', availableMinutes: 50 };

  const active = initialPrescription(activeAnswers, { ...profile, recentCardioSessions: 3, recentLongestRunKm: 1.5 });
  const runner = initialPrescription(runnerAnswers, { ...profile, recentCardioSessions: 5, recentLongestRunKm: 4 });
  const advanced = initialPrescription(advancedAnswers, { ...profile, recentCardioSessions: 10, recentLongestRunKm: 8 });

  expect(classifyCardioProfile(base, profile)).toBe('sedentary');
  expect(classifyCardioProfile(activeAnswers, profile)).toBe('active');
  expect(classifyCardioProfile(runnerAnswers, profile)).toBe('runner');
  expect(classifyCardioProfile(advancedAnswers, profile)).toBe('advanced');
  expect(sedentary.durationMinutes).toBe(18);
  expect(sedentary.sessions).toBe(2);
  expect(active.durationMinutes).toBeGreaterThan(sedentary.durationMinutes);
  expect(runner.durationMinutes).toBeGreaterThan(active.durationMinutes);
  expect(advanced.durationMinutes).toBeGreaterThan(runner.durationMinutes);
  expect([runner, advanced].every(item => item.runSecondsPerInterval === 0 && item.walkSecondsPerInterval === 0)).toBe(true);
});

it('usa histórico real de 7/28 dias para corrigir um autorrelato raso', () => {
  const observed: ProfileSnapshot = {
    ...profile,
    recentCardioSessions: 6,
    cardioHistory: history(),
  };
  const activeFromHistory = { ...base, goalType: 'conditioning' as const };
  expect(classifyCardioProfile(activeFromHistory, observed)).toBe('active');
  expect(buildCardioBaseline(activeFromHistory, observed).baselineMinutes).toBeGreaterThan(buildCardioBaseline(base, profile).baselineMinutes);
  const trace = buildResearchDecisionTrace(activeFromHistory, observed, 'active');
  expect(trace.find(item => item.id === 'observed_training_history')?.answer).toContain('240min');
  expect(trace.find(item => item.id === 'capacity_signature')?.answer).toContain('highly_consistent');
});

it('diferencia frequência semanal mesmo com a mesma classe ativa', () => {
  const activeAnswers: ObjectiveAnswers = { ...base, goalType: 'conditioning', runningAbility: 'minutes', preferredActivity: 'running', availableDays: [1, 2, 3, 5] };
  const regular: ProfileSnapshot = { ...profile, cardioHistory: history({
    capacitySignature: { ...history().capacitySignature, sessionsPerWeek28d: 2.5, consistencyBand: 'consistent', activeWeeks28d: 3 },
  }) };
  const veryConsistent: ProfileSnapshot = { ...profile, cardioHistory: history({
    sessions28d: 16,
    activeDays28d: 14,
    minutes28d: 560,
    averageSessionMinutes28d: 35,
    capacitySignature: { ...history().capacitySignature, sessionsPerWeek28d: 4, consistencyBand: 'highly_consistent', activeWeeks28d: 4 },
  }) };
  expect(initialPrescription(activeAnswers, regular).sessions).toBe(3);
  expect(initialPrescription(activeAnswers, veryConsistent).sessions).toBe(4);
});

it('usa aumento recente só como contexto e evita acrescentar outra escalada automática', () => {
  const rising: ProfileSnapshot = {
    ...profile,
    recentCardioSessions: 6,
    cardioHistory: history({
      minutes7d: 120,
      previous7dMinutes: 60,
      minutes28d: 210,
      averageSessionMinutes28d: 30,
      longestSessionMinutes28d: 45,
      loadRatio7d: 2,
      loadTrend: 'spiking',
      capacitySignature: { ...history().capacitySignature, medianSessionMinutes28d: 30, weeklyMinutesRecentFirst: [120, 60, 15, 15] },
    }),
  };
  const answers: ObjectiveAnswers = { ...base, goalType: 'conditioning', availableMinutes: 50 };
  const decision = buildCardioBaseline(answers, rising);
  expect(decision.profileClass).toBe('active');
  expect(decision.baselineMinutes).toBeLessThanOrEqual(30);
  expect(buildResearchDecisionTrace(answers, rising, 'active').find(item => item.id === 'recent_load_change')?.impact).toContain('nunca como diagnóstico');
});

it('não trata atleta competitivo de outro esporte como sedentário só porque ele não corre', () => {
  const cyclist: ObjectiveAnswers = {
    ...base,
    goalType: 'conditioning',
    walkingMinutes: 45,
    runningAbility: 'none',
    trainingBackground: 'competitive',
    primarySport: 'cycling',
    typicalCardioMinutes: 90,
    preferredActivity: 'bike',
    availableMinutes: 50,
  };
  expect(classifyCardioProfile(cyclist, profile)).toBe('advanced');
  const prescription = initialPrescription(cyclist, profile);
  expect(prescription.modality).toBe('bike');
  expect(prescription.durationMinutes).toBeGreaterThanOrEqual(35);
  expect(prescription.durationMinutes).toBeLessThanOrEqual(50);
  const trace = buildResearchDecisionTrace(cyclist, profile, 'advanced');
  expect(trace.find(item => item.id === 'sport_transfer')?.answer).toContain('cycling');
});

it('trata retorno de atleta como retorno, sem apagar a identidade de treino nem manter carga cheia', () => {
  const returningAnswers: ObjectiveAnswers = {
    ...base, goalType: 'return_cardio', walkingMinutes: 45, runningAbility: 'regular',
    trainingBackground: 'regular', primarySport: 'running', typicalCardioMinutes: 45,
    preferredActivity: 'running', barrier: 'restart', availableMinutes: 40,
  };
  const returningProfile = { ...profile, recentCardioSessions: 1, recentLongestRunKm: 4 };
  expect(classifyCardioProfile(returningAnswers, returningProfile)).toBe('returning');
  const prescription = initialPrescription(returningAnswers, returningProfile);
  expect(prescription.modality).toBe('running');
  expect(prescription.durationMinutes).toBeGreaterThanOrEqual(15);
  expect(prescription.durationMinutes).toBeLessThan(30);
  expect(prescription.sessions).toBe(2);
});

it('persiste no baseline a justificativa e as fontes usadas naquela decisão', () => {
  const created = createJourney('journey', 'user', base, profile, now);
  expect(created.baseline.evidenceVersion).toBe(CARDIO_RESEARCH_VERSION);
  expect(created.baseline.profileClass).toBe('sedentary');
  expect(created.baseline.evidenceDecisionTrace?.length).toBeGreaterThanOrEqual(13);
  expect(buildCardioBaseline(base, profile).evidenceIds).toContain('WHO_2020');
});
