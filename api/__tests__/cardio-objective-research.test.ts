import { buildCardioBaseline, classifyCardioProfile, createJourney, initialPrescription } from '../../src/core/cardioObjective/engine';
import { CARDIO_RESEARCH_SOURCES, CARDIO_RESEARCH_VERSION, buildResearchDecisionTrace } from '../../src/core/cardioObjective/research';
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

it('mantém uma biblioteca de evidência versionada e auditável', () => {
  expect(CARDIO_RESEARCH_VERSION).toBe('CARDIO_EVIDENCE_2026_09_V1');
  expect(Object.keys(CARDIO_RESEARCH_SOURCES)).toEqual(expect.arrayContaining([
    'WHO_2020', 'CDC_START_SLOW', 'ACSM_FITT', 'SEILER_2010', 'ENDURANCE_TID_2025', 'RUNNING_LOAD_2021',
  ]));
  for (const source of Object.values(CARDIO_RESEARCH_SOURCES)) {
    expect(source.url).toMatch(/^https:\/\//);
    expect(source.supports.length).toBeGreaterThan(30);
  }
});

it('faz perguntas internas explícitas antes de gerar a missão', () => {
  const trace = buildResearchDecisionTrace(base, profile, 'sedentary');
  expect(trace.map(item => item.id)).toEqual(expect.arrayContaining([
    'safety_gate', 'current_activity', 'continuous_capacity', 'goal_specificity',
    'real_life_constraint', 'adherence_barrier', 'trained_intensity_distribution', 'progression_uncertainty',
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
  expect(active.durationMinutes).toBeGreaterThan(sedentary.durationMinutes);
  expect(runner.durationMinutes).toBeGreaterThan(active.durationMinutes);
  expect(advanced.durationMinutes).toBeGreaterThan(runner.durationMinutes);
  expect([runner, advanced].every(item => item.runSecondsPerInterval === 0 && item.walkSecondsPerInterval === 0)).toBe(true);
});

it('trata retorno de atleta como retorno, sem apagar a identidade de treino nem manter carga cheia', () => {
  const returningAnswers: ObjectiveAnswers = {
    ...base, goalType: 'return_cardio', walkingMinutes: 45, runningAbility: 'regular',
    preferredActivity: 'running', barrier: 'restart', availableMinutes: 40,
  };
  const returningProfile = { ...profile, recentCardioSessions: 1, recentLongestRunKm: 4 };
  expect(classifyCardioProfile(returningAnswers, returningProfile)).toBe('returning');
  const prescription = initialPrescription(returningAnswers, returningProfile);
  expect(prescription.modality).toBe('running');
  expect(prescription.durationMinutes).toBeGreaterThanOrEqual(15);
  expect(prescription.durationMinutes).toBeLessThan(30);
});

it('persiste no baseline a justificativa e as fontes usadas naquela decisão', () => {
  const created = createJourney('journey', 'user', base, profile, now);
  expect(created.baseline.evidenceVersion).toBe(CARDIO_RESEARCH_VERSION);
  expect(created.baseline.profileClass).toBe('sedentary');
  expect(created.baseline.evidenceDecisionTrace?.length).toBeGreaterThanOrEqual(8);
  expect(buildCardioBaseline(base, profile).evidenceIds).toContain('WHO_2020');
});
