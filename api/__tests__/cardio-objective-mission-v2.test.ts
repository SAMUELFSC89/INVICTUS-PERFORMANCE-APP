import fs from 'node:fs';
import path from 'node:path';
import { buildCardioBaseline, classifyCardioProfile, createJourney, initialPrescription, makeMissions, reviewWeek } from '../../src/core/cardioObjective/engine';
import type { ObjectiveAnswers, ProfileSnapshot, WeeklyAnswers } from '../../src/core/cardioObjective/types';

const now = '2026-09-07T12:00:00.000Z';
const safety = { screened: true, signals: [], medicalClearance: null };
const profile: ProfileSnapshot = {
  capturedAt: now, weightKg: 80, heightCm: 175, ageYears: 30,
  strengthDays: [], source: 'users', planId: null,
  recentCardioSessions: 0, recentLongestRunKm: null,
};
const baseAnswers: ObjectiveAnswers = {
  goalType: 'sedentary', walkingMinutes: 15, runningAbility: 'none', availableMinutes: 25,
  availableDays: [1, 3, 5], timeZone: 'America/Sao_Paulo', preferredMoment: 'morning',
  preferredActivity: 'walking', barrier: 'starting', confidenceScore: 8, safety, productConsent: true,
};

it('nunca gera missão ativa abaixo de 15 minutos, mesmo com pouco tempo e baixa confiança', () => {
  const prescription = initialPrescription({
    ...baseAnswers,
    walkingMinutes: 5,
    availableMinutes: 10,
    barrier: 'time',
    confidenceScore: 1,
  }, profile);
  expect(classifyCardioProfile({ ...baseAnswers, walkingMinutes: 5, availableMinutes: 10, barrier: 'time', confidenceScore: 1 }, profile)).toBe('sedentary');
  expect(buildCardioBaseline({ ...baseAnswers, walkingMinutes: 5, availableMinutes: 10, barrier: 'time', confidenceScore: 1 }, profile).minMinutes).toBe(15);
  expect(prescription.durationMinutes).toBe(15);
});

it('respeita quem já corre e não regride para caminhada curta', () => {
  const answers: ObjectiveAnswers = {
    ...baseAnswers,
    goalType: 'conditioning',
    walkingMinutes: 45,
    runningAbility: 'regular',
    availableMinutes: 40,
    preferredActivity: 'running',
  };
  const prescription = initialPrescription(answers, { ...profile, recentCardioSessions: 4, recentLongestRunKm: 4 });
  expect(classifyCardioProfile(answers, profile)).toBe('runner');
  expect(prescription.modality).toBe('running');
  expect(prescription.targetMetric).toBe('duration');
  expect(prescription.durationMinutes).toBeGreaterThanOrEqual(28);
  expect(prescription.durationMinutes).toBeLessThanOrEqual(40);
  expect(prescription.runSecondsPerInterval).toBe(0);
  expect(prescription.walkSecondsPerInterval).toBe(0);
});

it('mantém atleta estruturado em uma faixa compatível com a disponibilidade', () => {
  const prescription = initialPrescription({
    ...baseAnswers,
    goalType: 'endurance',
    walkingMinutes: 45,
    runningAbility: 'structured',
    availableMinutes: 50,
    preferredActivity: 'running',
  }, { ...profile, recentCardioSessions: 10, recentLongestRunKm: 8 });
  expect(prescription.modality).toBe('running');
  expect(prescription.durationMinutes).toBeGreaterThanOrEqual(35);
  expect(prescription.durationMinutes).toBeLessThanOrEqual(50);
});

it('revisão difícil nunca derruba uma missão de duração abaixo do piso de 15 minutos', () => {
  const answers: ObjectiveAnswers = { ...baseAnswers, availableMinutes: 15, walkingMinutes: 5, confidenceScore: 8 };
  const { journey, baseline } = createJourney('j', 'u', answers, profile, now);
  const missions = makeMissions(journey, now).map(mission => ({ ...mission, state: 'completed' as const }));
  const weekly: WeeklyAnswers = {
    difficulty: 'very_hard', energy: 'poor', confidenceScore: 2,
    habitAdherence: 'partly', barrier: 'starting', safety,
  };
  const review = reviewWeek(journey, baseline, missions, weekly, [], [], '2026-09-14T12:00:00.000Z');
  expect(review.after.durationMinutes).toBe(15);
});

it('quando o usuário escolhe em Outros, a opção selecionada é promovida para as duas principais', () => {
  const source = fs.readFileSync(path.resolve(process.cwd(), 'src/pages/CardioObjective.tsx'), 'utf8');
  expect(source).toContain('const selected = options.find(([id]) => id === value)');
  expect(source).toContain('return [selected, ...base.filter(([id]) => id !== value)]');
  expect(source).not.toContain("options={[[10, '10 min'], [15, '15 min']");
});
