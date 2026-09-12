import { activityAchievementSeeds, adaptHabit, chooseHabit, createJourney, goalReached, habitConfidence, initialPrescription, makeMissions, missionMeetsActivity, onboardingSteps, professionalNextLevel, reviewAchievementSeeds, reviewWeek, safetyDecision } from '../../src/core/cardioObjective/engine';
import { OBJECTIVE_VERSIONS } from '../../src/core/cardioObjective/types';
import type { ObjectiveAnswers, ProfileSnapshot, WeeklyAnswers } from '../../src/core/cardioObjective/types';

const now = '2026-09-07T12:00:00.000Z';
const safety = { screened: true, signals: [], medicalClearance: null };
const answers: ObjectiveAnswers = { goalType: 'sedentary', walkingMinutes: 15, runningAbility: 'none', availableMinutes: 25, availableDays: [1, 3, 5], timeZone: 'America/Sao_Paulo', preferredMoment: 'morning', preferredActivity: 'walking', barrier: 'starting', confidenceScore: 8, safety, productConsent: true };
const profile: ProfileSnapshot = { capturedAt: now, weightKg: 80, heightCm: 175, ageYears: 30, strengthDays: [], source: 'users', planId: null, recentCardioSessions: 0, recentLongestRunKm: null };
const weekly: WeeklyAnswers = { difficulty: 'easy', energy: 'good', confidenceScore: 8, habitAdherence: 'yes', barrier: 'starting', safety };

test.each(['chest_pain', 'fainting', 'dizziness', 'unusual_breathlessness', 'pain'] as const)('safety blocks %s', signal => {
  expect(safetyDecision({ ...safety, signals: [signal] }, false).blocked).toBe(true);
});
test('surgery clearance is explicit and never assumed', () => {
  expect(safetyDecision(safety, true).blocked).toBe(true);
  expect(safetyDecision({ ...safety, medicalClearance: true }, true).blocked).toBe(false);
});
test('surgery does not get automated food interventions even on weight goal', () => {
  const habit = chooseHabit({ ...answers, goalType: 'lose_weight', safety: { ...safety, signals: ['surgical_recovery'], medicalClearance: true }, nutrition: { meals: '3', hardestTime: 'night', frequencies: { soda: 'multiple_daily' } } }, now, 'one');
  expect(habit.target).toBe('routine');
});
test('onboarding asks weight and nutrition only for weight loss', () => {
  expect(onboardingSteps('sedentary')).not.toEqual(expect.arrayContaining(['weight', 'weightTarget', 'nutrition']));
  expect(onboardingSteps('lose_weight')).toEqual(expect.arrayContaining(['weight', 'weightTarget', 'nutrition']));
  expect(onboardingSteps('other')).toContain('otherGoal');
  expect(onboardingSteps('race')).toContain('distance');
});
test('baseline snapshots the existing profile and every engine version', () => {
  const created = createJourney('j', 'u', answers, profile, now);
  expect(created.baseline.profile).toEqual(profile);
  expect(created.baseline.versions).toEqual(OBJECTIVE_VERSIONS);
  expect(created.journey.versions).toEqual(OBJECTIVE_VERSIONS);
  expect(() => createJourney('weight', 'u', { ...answers, goalType: 'lose_weight', loseKg: 5 }, profile, now)).toThrow('Confirme seu peso');
});
test('readiness, confidence, time barrier and recent history constrain the first mission', () => {
  const constrained = initialPrescription({ ...answers, goalType: 'run_5k', preferredActivity: 'running', runningAbility: 'regular', barrier: 'time', confidenceScore: 3 }, { ...profile, recentLongestRunKm: 4 });
  expect(constrained).toMatchObject({ targetMetric: 'distance', modality: 'running', distanceKm: 3 });
  expect(constrained.durationMinutes).toBeGreaterThanOrEqual(15);
  expect(initialPrescription({ ...answers, goalType: 'start_running', preferredActivity: 'running', barrier: 'dislike_running' }).modality).toBe('walking');
});
test('only first mission available, only current week created', () => {
  const { journey } = createJourney('j', 'u', answers, profile, now);
  const missions = makeMissions(journey, now);
  expect(missions.map(m => m.state)).toEqual(['available', 'locked']);
  expect(new Set(missions.map(m => m.week))).toEqual(new Set([1]));
});
test('real activity must have matching owner, session, modality, status and duration', () => {
  const { journey } = createJourney('j', 'u', answers, profile, now);
  const mission = { ...makeMissions(journey, now)[0], state: 'started' as const, sessionId: 's', startedAt: now };
  const activity = { id: 'a', userId: 'u', type: 'cardio', cardioType: 'walking', sessionId: 's', durationMinutes: 15, distanceKm: 1, startedAt: now, recordStatus: 'completed', rejected: false };
  expect(missionMeetsActivity(journey, mission, activity)).toBe(true);
  for (const change of [{ userId: 'other' }, { sessionId: 'other' }, { cardioType: 'bike' }, { recordStatus: 'pending' }, { rejected: true }, { durationMinutes: 0 }, { durationMinutes: NaN }]) {
    expect(missionMeetsActivity(journey, mission, { ...activity, ...change })).toBe(false);
  }
});
test('review changes duration only, computes adherence and preserves baseline', () => {
  const { journey, baseline } = createJourney('j', 'u', answers, profile, now);
  const before = JSON.stringify(baseline);
  const missions = makeMissions(journey, now).map(m => ({ ...m, state: 'completed' as const }));
  const result = reviewWeek(journey, baseline, missions, weekly, [], [], '2026-09-14T12:00:00.000Z');
  expect(result.adherence).toBe(1);
  expect(result.after.durationMinutes).toBeGreaterThan(result.before.durationMinutes);
  expect({ ...result.after, durationMinutes: 0 }).toEqual({ ...result.before, durationMinutes: 0 });
  expect(JSON.stringify(baseline)).toBe(before);
  expect(() => reviewWeek(journey, baseline, missions, weekly, [], [], now)).toThrow('A revisão');
});
test('distance goals advance only distance and complete only with verified distance', () => {
  const runAnswers: ObjectiveAnswers = { ...answers, goalType: 'run_5k', runningAbility: 'minutes', preferredActivity: 'running' };
  const { journey, baseline } = createJourney('j', 'u', runAnswers, { ...profile, recentLongestRunKm: 2 }, now);
  expect(journey.behavior).toMatchObject({ targetMetric: 'distance', distanceKm: 1.5 });
  const missions = makeMissions(journey, now).map(m => ({ ...m, state: 'completed' as const }));
  const result = reviewWeek(journey, baseline, missions, weekly, [], [], '2026-09-14T12:00:00.000Z');
  expect(result.after.distanceKm).toBeGreaterThan(result.before.distanceKm!);
  expect(result.after.durationMinutes).toBe(result.before.durationMinutes);
  const activity = { id: 'a', userId: 'u', type: 'cardio', cardioType: 'running', sessionId: 's', durationMinutes: 60, distanceKm: 4.99, startedAt: now, recordStatus: 'completed', rejected: false };
  expect(goalReached(journey, activity)).toBe(false);
  expect(goalReached(journey, { ...activity, distanceKm: 5 })).toBe(true);
});
test('high hunger prevents automatic escalation and low confidence does not break the minimum mission floor', () => {
  const { journey, baseline } = createJourney('j', 'u', answers, profile, now);
  const missions = makeMissions(journey, now).map(m => ({ ...m, state: 'completed' as const }));
  const review = (changes: Partial<WeeklyAnswers>) => reviewWeek(journey, baseline, missions, { ...weekly, ...changes }, [], [], '2026-09-14T12:00:00.000Z');
  expect(review({ hunger: 'high' }).decision).toBe('maintain');
  expect(review({ confidenceScore: 3 }).after.durationMinutes).toBeGreaterThanOrEqual(15);
});
test('persistent weight plateau changes at most one habit and does not also progress cardio', () => {
  const weightAnswers: ObjectiveAnswers = { ...answers, goalType: 'lose_weight', weightConfirmed: true, currentWeightKg: 90, loseKg: 5, nutrition: { meals: '3', hardestTime: 'night', frequencies: { soda: 'multiple_daily', delivery: 'weekly' } } };
  const { journey, baseline } = createJourney('j', 'u', weightAnswers, profile, now);
  const missions = makeMissions(journey, now).map(m => ({ ...m, state: 'completed' as const }));
  const weights = ['2026-09-07', '2026-09-08', '2026-09-28', '2026-09-29'].map((date, index) => ({ id: String(index), kg: 90 + index * 0.05, measuredAt: `${date}T12:00:00.000Z`, recordedAt: `${date}T12:00:00.000Z`, source: 'manual' as const, sourceId: null }));
  const review = reviewWeek(journey, baseline, missions, weekly, [], weights, '2026-09-29T12:00:00.000Z');
  expect(review.plateau).toBe('persistent');
  expect(review.after).toEqual(review.before);
  expect(journey.habit.target).toBe('soda');
  expect(adaptHabit(journey, baseline, review, '2026-09-29T12:00:00.000Z').target).toBe('delivery');
});
test('professional feature never books or shares, and empty history is not consolidation', () => {
  const { journey } = createJourney('j', 'u', answers, profile, now);
  expect(professionalNextLevel({ ...journey, consolidated: true }, null, now)).toMatchObject({ status: 'COMING_SOON', partnerId: null, canBook: false, canShare: false });
  expect(professionalNextLevel(journey, null, now).eligibleAt).toBeNull();
  expect(professionalNextLevel({ ...journey, goalType: 'run_5k' }, null, now).kind).toBe('running_coach');
  expect(professionalNextLevel({ ...journey, goalType: 'gradual_return' }, null, now).kind).toBe('physiotherapist');
  expect(habitConfidence([])).toEqual({ score: 0, consolidated: false });
});
test('achievement seeds use evidence and deterministic ids', () => {
  const { journey } = createJourney('j', 'u', { ...answers, goalType: 'start_running', preferredActivity: 'running', runningAbility: 'minutes' }, profile, now);
  const mission = { ...makeMissions(journey, now)[0], state: 'started' as const, sessionId: 's', startedAt: now };
  const activity = { id: 'a', userId: 'u', type: 'cardio', cardioType: 'running', sessionId: 's', durationMinutes: 20, distanceKm: 5, startedAt: now, recordStatus: 'completed', rejected: false };
  expect(activityAchievementSeeds(journey, mission, activity, 10, '2026-10-08T12:00:00.000Z').map(a => a.id)).toEqual(['ten_missions', 'first_run', 'first_km', 'first_5k', 'thirty_days']);
  const review = { ...reviewWeek(journey, { id: 'initial', capturedAt: now, profile, answers, startingWeightKg: null, readinessLevel: 3, versions: journey.versions }, makeMissions(journey, now).map(m => ({ ...m, state: 'completed' as const })), weekly, [], [], '2026-09-14T12:00:00.000Z'), completed: 3, planned: 3 };
  expect(reviewAchievementSeeds(review, [], false).map(a => a.id)).toContain('first_complete_week');
});
