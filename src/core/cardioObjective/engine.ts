import { GOALS, OBJECTIVE_VERSIONS, type Baseline, type CardioAchievement, type HabitIntervention, type Journey, type Mission, type ObjectiveAnswers, type Prescription, type ProfessionalUnlock, type ProfileSnapshot, type Review, type SafetyAnswers, type WeightMeasurement, type WeeklyAnswers } from './types.js';
import { CARDIO_RESEARCH_VERSION, buildResearchDecisionTrace, evidenceForProfile } from './research.js';

const DAY = 86400000;
const MIN_ACTIVE_MISSION_MINUTES = 15;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export type CardioProfileClass = 'sedentary' | 'beginner' | 'active' | 'runner' | 'advanced' | 'returning';
export interface CardioBaselineDecision {
  profileClass: CardioProfileClass;
  baselineMinutes: number;
  minMinutes: number;
  maxMinutes: number;
  reason: string;
  evidenceIds: string[];
}

const profilePolicy: Record<CardioProfileClass, { fallbackMinutes: number; floorMinutes: number; availabilityFraction: number; progressionRate: number; regressionFactor: number }> = {
  sedentary: { fallbackMinutes: 15, floorMinutes: 15, availabilityFraction: 0.45, progressionRate: 0.08, regressionFactor: 0.80 },
  beginner: { fallbackMinutes: 18, floorMinutes: 15, availabilityFraction: 0.60, progressionRate: 0.08, regressionFactor: 0.80 },
  active: { fallbackMinutes: 24, floorMinutes: 20, availabilityFraction: 0.68, progressionRate: 0.07, regressionFactor: 0.85 },
  runner: { fallbackMinutes: 30, floorMinutes: 25, availabilityFraction: 0.76, progressionRate: 0.06, regressionFactor: 0.90 },
  advanced: { fallbackMinutes: 35, floorMinutes: 30, availabilityFraction: 0.82, progressionRate: 0.05, regressionFactor: 0.90 },
  returning: { fallbackMinutes: 18, floorMinutes: 15, availabilityFraction: 0.60, progressionRate: 0.05, regressionFactor: 0.80 },
};

export function safetyDecision(safety: SafetyAnswers, gradualReturn: boolean) {
  if (!safety.screened) return { blocked: true, urgent: false, reason: 'Precisamos confirmar os sinais de segurança antes de continuar.' };
  const urgent = safety.signals.some(s => ['chest_pain', 'fainting', 'dizziness', 'unusual_breathlessness'].includes(s));
  if (urgent) return { blocked: true, urgent: true, reason: 'Interrompa a atividade. Procure atendimento médico imediato se os sintomas estiverem presentes ou forem intensos. Em uma emergência no Brasil, ligue 192.' };
  if ((gradualReturn || safety.signals.includes('surgical_recovery')) && safety.medicalClearance !== true) return { blocked: true, urgent: false, reason: 'Antes de iniciar ou progredir, peça liberação ao profissional responsável pela sua recuperação.' };
  if (safety.signals.includes('pain')) return { blocked: true, urgent: false, reason: 'Não force movimentos com dor. Procure avaliação profissional antes de continuar a progressão.' };
  return { blocked: false, urgent: false, reason: 'Mantenha um esforço confortável, em que consiga conversar. Pare se surgir algum sintoma incomum.' };
}

/** Running capability is not medical clearance nor general athletic level. */
export function readiness(a: ObjectiveAnswers): number {
  if (a.goalType === 'gradual_return') return 0;
  const runningLevel = ({ none: 1, seconds: 2, minutes: 3, regular: 4, structured: 5 } as const)[a.runningAbility];
  if (a.walkingMinutes === 5 && runningLevel <= 1) return 0;
  return runningLevel;
}

/**
 * Classification combines self-report with canonical 7/28-day history and the
 * individual capacity signature. Running ability remains sport-specific: a
 * competitive cyclist/fighter/team athlete is not sedentary merely because they
 * do not run.
 */
export function classifyCardioProfile(a: ObjectiveAnswers, profile?: ProfileSnapshot): CardioProfileClass {
  const history = profile?.cardioHistory;
  const signature = history?.capacitySignature;
  const sessions = history?.sessions28d ?? profile?.recentCardioSessions ?? 0;
  const activeDays = history?.activeDays28d ?? 0;
  const minutes28d = history?.minutes28d ?? 0;
  const averageMinutes = history?.averageSessionMinutes28d ?? 0;
  const longestRun = signature?.longestRunningDistanceKm28d ?? profile?.recentLongestRunKm ?? 0;
  const background = a.trainingBackground;
  const typical = a.typicalCardioMinutes || 0;
  const practicesSport = !!a.primarySport && a.primarySport !== 'none';
  const consistentHistory = signature?.consistencyBand === 'consistent' || signature?.consistencyBand === 'highly_consistent';
  const wasTrained = ['regular', 'structured'].includes(a.runningAbility)
    || ['regular', 'structured', 'competitive'].includes(background || '')
    || longestRun >= 3
    || (sessions >= 6 && minutes28d >= 180)
    || (consistentHistory && (signature?.sessionsPerWeek28d || 0) >= 2);

  if (a.goalType === 'gradual_return' || a.safety.signals.includes('surgical_recovery')) return 'returning';
  if (a.goalType === 'return_cardio' || (a.barrier === 'restart' && wasTrained && sessions <= 2)) return 'returning';
  if (background === 'competitive'
    || (background === 'structured' && typical >= 60)
    || a.runningAbility === 'structured'
    || (sessions >= 8 && longestRun >= 5)
    || (sessions >= 10 && activeDays >= 8 && minutes28d >= 360 && averageMinutes >= 35)
    || (consistentHistory && (signature?.sessionsPerWeek28d || 0) >= 3 && minutes28d >= 300)
    || (activeDays >= 12 && minutes28d >= 480)) return 'advanced';
  if (a.runningAbility === 'regular' || (sessions >= 4 && longestRun >= 2)) return 'runner';
  if (background === 'structured' || background === 'regular'
    || (practicesSport && typical >= 45)
    || a.runningAbility === 'minutes'
    || sessions >= 3
    || activeDays >= 4
    || minutes28d >= 90
    || (consistentHistory && (signature?.sessionsPerWeek28d || 0) >= 1.5)) return 'active';
  if (background === 'occasional' || a.runningAbility === 'seconds' || a.walkingMinutes >= 30 || sessions >= 1 || minutes28d >= 30) return 'beginner';
  return 'sedentary';
}

/**
 * Research-backed principles determine the shape of the decision; exact minute
 * values below are versioned Invictus product guardrails, not clinical claims.
 */
export function buildCardioBaseline(a: ObjectiveAnswers, profile?: ProfileSnapshot): CardioBaselineDecision {
  const profileClass = classifyCardioProfile(a, profile);
  const policy = profilePolicy[profileClass];
  const maxMinutes = Math.max(MIN_ACTIVE_MISSION_MINUTES, a.availableMinutes);
  const classFloor = Math.min(maxMinutes, Math.max(MIN_ACTIVE_MISSION_MINUTES, policy.floorMinutes));
  const history = profile?.cardioHistory;
  const signature = history?.capacitySignature;

  let baselineMinutes = Math.max(policy.fallbackMinutes, Math.round(maxMinutes * policy.availabilityFraction));

  // Real history increases confidence that a non-trivial challenge is appropriate.
  const recentSessions = history?.sessions28d ?? profile?.recentCardioSessions ?? 0;
  const longestRun = signature?.longestRunningDistanceKm28d ?? profile?.recentLongestRunKm ?? 0;
  if (recentSessions >= 4) baselineMinutes += profileClass === 'runner' || profileClass === 'advanced' ? 2 : 1;
  if (longestRun >= 5 && (profileClass === 'runner' || profileClass === 'advanced')) baselineMinutes += 2;

  // Anchor the first mission to what the person actually sustains. Median is used
  // as a robust typical-session anchor; the longest session only gets meaningful
  // weight when the pattern exists across several weeks.
  const observedAverage = history?.averageSessionMinutes28d || 0;
  const observedMedian = signature?.medianSessionMinutes28d || 0;
  const observedLongest = history?.longestSessionMinutes28d || 0;
  const consistency = signature?.consistencyBand || 'insufficient';
  if (Math.max(observedAverage, observedMedian) >= 10) {
    const observedFraction = profileClass === 'advanced' ? 0.82
      : profileClass === 'runner' ? 0.78
        : profileClass === 'active' ? 0.72
          : profileClass === 'returning' ? 0.55
            : profileClass === 'beginner' ? 0.68
              : 0.60;
    const typicalObserved = Math.max(observedMedian, observedAverage * 0.9);
    const typicalAnchor = Math.round(typicalObserved * observedFraction);
    const mayUseLongest = ['consistent', 'highly_consistent'].includes(consistency);
    const longestAnchor = mayUseLongest ? Math.round(observedLongest * (profileClass === 'returning' ? 0.42 : 0.55)) : 0;
    baselineMinutes = Math.max(baselineMinutes, Math.min(maxMinutes, Math.max(typicalAnchor, longestAnchor)));
  }

  // A rapid recent increase is context to avoid stacking another automatic jump.
  // It is explicitly NOT interpreted as an injury-risk or recovery score.
  if (history && ['rising', 'spiking'].includes(history.loadTrend) && Math.max(observedMedian, observedAverage) >= classFloor) {
    baselineMinutes = Math.min(baselineMinutes, Math.max(classFloor, Math.round(observedMedian || observedAverage)));
  }

  // Self-report matters for training performed outside Invictus/Health sources.
  if (a.runningAbility === 'minutes') baselineMinutes = Math.max(baselineMinutes, Math.round(maxMinutes * 0.62));
  if (a.runningAbility === 'regular') baselineMinutes = Math.max(baselineMinutes, Math.round(maxMinutes * 0.72));
  if (a.runningAbility === 'structured') baselineMinutes = Math.max(baselineMinutes, Math.round(maxMinutes * 0.78));
  if (a.typicalCardioMinutes) {
    const typicalFraction = profileClass === 'advanced' ? 0.78
      : profileClass === 'runner' ? 0.72
        : profileClass === 'active' ? 0.65
          : profileClass === 'returning' ? 0.55
            : 0.60;
    baselineMinutes = Math.max(baselineMinutes, Math.min(maxMinutes, Math.round(a.typicalCardioMinutes * typicalFraction)));
  }

  // Barriers soften the challenge without erasing demonstrated capacity.
  if (a.barrier === 'time') baselineMinutes = Math.min(baselineMinutes, Math.max(classFloor, Math.round(maxMinutes * 0.72)));
  if (a.confidenceScore <= 4) baselineMinutes = Math.max(classFloor, Math.round(baselineMinutes * 0.85));
  else if (a.confidenceScore <= 7 || a.barrier === 'restart') baselineMinutes = Math.max(classFloor, Math.round(baselineMinutes * 0.92));
  baselineMinutes = clamp(baselineMinutes, classFloor, maxMinutes);

  const reason = profileClass === 'sedentary'
    ? 'Perfil sedentário: começar com intensidade fácil e progressão gradual, mas com uma missão ativa de pelo menos 15 minutos para que o desafio não seja apenas uma tarefa cotidiana trivial.'
    : profileClass === 'beginner'
      ? 'Perfil iniciante: preservar aderência e progressão gradual, usando capacidade declarada e histórico recente sem saltos bruscos.'
      : profileClass === 'active'
        ? 'Perfil ativo/esportivo: usar uma carga compatível com a prática já existente, a modalidade preferida e o tempo real disponível, sem aplicar fallback de sedentário.'
        : profileClass === 'runner'
          ? 'Corredor regular: manter corrida e uma duração compatível com a base já demonstrada; o motor não volta para caminhada curta sem motivo de segurança ou retorno.'
          : profileClass === 'advanced'
            ? 'Perfil avançado/competitivo: preservar carga significativa e esforço predominantemente fácil; intensidade alta não é adicionada automaticamente sem contexto suficiente de carga, recuperação e fase de treino.'
            : 'Retorno: reconhecer a experiência anterior, reduzir a carga em relação ao nível habitual e progredir somente após resposta real da semana, respeitando os bloqueios de segurança.';
  const historyReason = history && history.sessions28d > 0
    ? ` Histórico canônico considerado: ${history.sessions28d} sessão(ões), ${history.minutes28d} min em 28 dias, mediana de ${signature?.medianSessionMinutes28d ?? 'n/d'} min, consistência ${signature?.consistencyBand ?? 'n/d'}, modalidade dominante ${signature?.dominantModality ?? 'n/d'} e tendência recente ${history.loadTrend}.`
    : '';

  return {
    profileClass,
    baselineMinutes,
    minMinutes: classFloor,
    maxMinutes,
    reason: `${reason}${historyReason}`,
    evidenceIds: evidenceForProfile(profileClass),
  };
}

export function onboardingSteps(goal: ObjectiveAnswers['goalType']) {
  return ['goal', ...(goal === 'other' ? ['otherGoal'] : []), 'safety', 'capacity', 'trainingProfile', 'availability', 'schedule', 'modality', 'barrier',
    ...(goal === 'lose_weight' ? ['weight', 'weightTarget', 'nutrition'] : []),
    ...(goal === 'race' ? ['distance'] : []), 'confidence', 'consent'];
}

export function validateMissionCoherence(a: ObjectiveAnswers, prescription: Prescription, profile?: ProfileSnapshot): Prescription {
  const level = readiness(a);
  const next = { ...prescription };
  const baseline = buildCardioBaseline(a, profile);
  next.durationMinutes = Math.max(MIN_ACTIVE_MISSION_MINUTES, next.durationMinutes);

  if (a.preferredActivity === 'running' && level >= 2 && a.barrier !== 'dislike_running' && a.goalType !== 'gradual_return') {
    next.modality = 'running';
  }
  if (next.modality === 'running' && level < 2) next.modality = 'walking';
  if (a.goalType === 'gradual_return') next.modality = 'walking';

  // A trained runner does not get artificial beginner run/walk intervals by default.
  if (next.modality === 'running' && level >= 4) {
    next.runSecondsPerInterval = 0;
    next.walkSecondsPerInterval = 0;
  }

  if (next.targetMetric === 'duration') next.durationMinutes = clamp(next.durationMinutes, baseline.minMinutes, baseline.maxMinutes);
  return next;
}

function targetWeeklySessions(profileClass: CardioProfileClass, profile: ProfileSnapshot | undefined): number {
  const signature = profile?.cardioHistory?.capacitySignature;
  if (profileClass === 'sedentary' || profileClass === 'returning') return 2;
  if (profileClass === 'beginner') return signature && ['consistent', 'highly_consistent'].includes(signature.consistencyBand) && signature.sessionsPerWeek28d >= 2.5 ? 3 : 2;
  if (profileClass === 'active') return signature && signature.consistencyBand === 'highly_consistent' && signature.sessionsPerWeek28d >= 3.5 ? 4 : 3;
  if (profileClass === 'runner' || profileClass === 'advanced') return signature && ['consistent', 'highly_consistent'].includes(signature.consistencyBand) && signature.sessionsPerWeek28d >= 3.5 ? 4 : 3;
  return 3;
}

export function initialPrescription(a: ObjectiveAnswers, profile?: ProfileSnapshot): Prescription {
  const level = readiness(a);
  const baseline = buildCardioBaseline(a, profile);
  const runFriendlyGoal = ['start_running', 'run_5k', 'run_10k', 'pace', 'race', 'weekly_distance', 'conditioning', 'endurance', 'return_cardio', 'weekly_energy', 'stress', 'post_workout', 'rest_days'].includes(a.goalType);
  const avoidsRun = a.barrier === 'dislike_running';
  let modality = a.preferredActivity;
  if (modality === 'running' && (level < 2 || avoidsRun || !runFriendlyGoal)) modality = 'walking';
  if (a.goalType === 'gradual_return') modality = 'walking';

  const distanceGoal = ['run_5k', 'run_10k', 'race', 'weekly_distance'].includes(a.goalType) && ['running', 'walking'].includes(modality);
  const outcomeDistance = a.goalType === 'run_5k' ? 5 : a.goalType === 'run_10k' ? 10 : a.targetDistanceKm || null;
  const signatureLongestRun = profile?.cardioHistory?.capacitySignature.longestRunningDistanceKm28d;
  const knownLongestRun = signatureLongestRun ?? profile?.recentLongestRunKm;
  const inferredStart = knownLongestRun ? Math.max(0.5, knownLongestRun * 0.75) : [0.5, 0.75, 1, 1.5, 2, 2.5][level];
  const distanceKm = distanceGoal ? Math.round(Math.min(outcomeDistance || inferredStart, inferredStart) * 10) / 10 : null;
  const runSecondsPerInterval = modality === 'running' && level < 4 ? (level === 2 ? 30 : 60) : 0;
  const walkSecondsPerInterval = modality === 'running' && level < 4 ? 90 : 0;
  const targetSessions = targetWeeklySessions(baseline.profileClass, profile);
  const prescription: Prescription = {
    modality,
    targetMetric: distanceGoal ? 'distance' : 'duration',
    durationMinutes: baseline.baselineMinutes,
    distanceKm,
    sessions: Math.min(a.availableDays.length, targetSessions),
    intensity: 'easy',
    runSecondsPerInterval,
    walkSecondsPerInterval,
  };
  return validateMissionCoherence(a, prescription, profile);
}

export function chooseHabit(a: ObjectiveAnswers, now: string, id: string): HabitIntervention {
  const base = { id, createdAt: now, ruleVersion: OBJECTIVE_VERSIONS.habit };
  if (a.goalType === 'lose_weight' && a.nutrition && !a.safety.signals.includes('surgical_recovery')) {
    const frequencies = a.nutrition.frequencies;
    if (frequencies.soda === 'multiple_daily') return { ...base, target: 'soda', text: 'Nesta semana, escolha uma das ocasiões do dia para trocar o refrigerante por água, se isso for viável para você.' };
    if (['daily', 'multiple_daily'].includes(frequencies.chocolate || '')) return { ...base, target: 'chocolate', text: 'Escolha duas ocasiões nesta semana para experimentar outra pausa agradável no lugar do chocolate, sem compensar pulando refeições.' };
    if (['daily', 'multiple_daily', 'weekly'].includes(frequencies.delivery || '')) return { ...base, target: 'delivery', text: 'Planeje uma refeição simples nesta semana para uma ocasião em que costuma pedir delivery.' };
  }
  return { ...base, target: 'routine', text: a.barrier === 'time' ? 'Reserve um pequeno horário na agenda para sua próxima meta.' : a.barrier === 'restart' ? 'Se precisar interromper, escolha um dia possível para retomar. Sua jornada não volta ao zero.' : 'Deixe o que você precisa para sua próxima atividade separado com antecedência.' };
}
export function adaptHabit(j: Journey, baseline: Baseline, review: Review, now: string): HabitIntervention {
  if (j.goalType !== 'lose_weight' || review.plateau !== 'persistent' || review.adherence < 0.8 || review.answers.habitAdherence !== 'yes' || !baseline.answers.nutrition || baseline.answers.safety.signals.includes('surgical_recovery')) return j.habit;
  const frequencies = { ...baseline.answers.nutrition.frequencies };
  if (j.habit.target !== 'routine') delete frequencies[j.habit.target];
  const candidate = chooseHabit({ ...baseline.answers, nutrition: { ...baseline.answers.nutrition, frequencies } }, now, `week_${j.currentWeek + 1}`);
  return candidate.target === 'routine' ? j.habit : candidate;
}
export function createJourney(id: string, uid: string, a: ObjectiveAnswers, profile: ProfileSnapshot, now: string): { journey: Journey; baseline: Baseline } {
  if (a.goalType === 'lose_weight' && (!a.weightConfirmed || !a.currentWeightKg || !a.loseKg)) throw new Error('Confirme seu peso e o objetivo antes de continuar.');
  const behavior = initialPrescription(a, profile);
  const safety = safetyDecision(a.safety, a.goalType === 'gradual_return');
  const profileClass = classifyCardioProfile(a, profile);
  const evidenceDecisionTrace = buildResearchDecisionTrace(a, profile, profileClass);
  const baseline: Baseline = {
    id: 'initial', capturedAt: now, profile, answers: a, startingWeightKg: a.currentWeightKg ?? null,
    readinessLevel: readiness(a), versions: OBJECTIVE_VERSIONS, profileClass,
    evidenceVersion: CARDIO_RESEARCH_VERSION, evidenceDecisionTrace,
  };
  return { baseline, journey: {
    id, userId: uid, status: safety.blocked ? 'paused' : 'active', goalType: a.goalType,
    goalLabel: a.goalType === 'lose_weight' ? `Perder ${a.loseKg} kg` : a.goalType === 'other' ? a.otherGoal || GOALS.other : GOALS[a.goalType],
    outcome: { weightKg: a.goalType === 'lose_weight' ? a.currentWeightKg! - a.loseKg! : null, distanceKm: a.goalType === 'run_5k' ? 5 : a.goalType === 'run_10k' ? 10 : a.targetDistanceKm ?? null, continuousMinutes: a.targetContinuousMinutes ?? null },
    behavior, baselineId: baseline.id, createdAt: now, updatedAt: now, weekStartedAt: now, currentWeek: 1, totalCompleted: 0,
    habitConfidence: 0, consolidated: false, availableDays: [...a.availableDays], timeZone: a.timeZone,
    habit: chooseHabit(a, now, 'initial'), safety: a.safety, versions: OBJECTIVE_VERSIONS,
  } };
}
export function localDate(now: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(now));
  return ['year', 'month', 'day'].map(type => parts.find(p => p.type === type)!.value).join('-');
}
export function makeMissions(j: Journey, now: string): Mission[] {
  if (j.status !== 'active' || safetyDecision(j.safety, j.goalType === 'gradual_return').blocked) return [];
  const today = localDate(now, j.timeZone);
  const dates: string[] = [];
  for (let offset = 0; offset < 7; offset++) {
    const day = new Date(`${today}T12:00:00Z`); day.setUTCDate(day.getUTCDate() + offset);
    if (j.availableDays.includes(day.getUTCDay()) && dates.length < j.behavior.sessions) dates.push(day.toISOString().slice(0, 10));
  }
  const context = j.goalType === 'post_workout' ? 'Faça após a musculação, apenas se ainda estiver se sentindo bem.' : j.goalType === 'rest_days' ? 'Planejada para um dia sem musculação. Mantenha esforço confortável.' : 'A meta respeita seu ponto de partida, seu histórico e a resposta da jornada. Faça no seu ritmo e pare diante de sintomas.';
  return dates.map((date, index) => ({ id: `w${j.currentWeek}_${index}`, journeyId: j.id, week: j.currentWeek, goalType: j.goalType, localDate: date, state: index === 0 ? 'available' : 'locked', prescription: { ...j.behavior }, context, ruleVersion: OBJECTIVE_VERSIONS.mission, createdAt: now, startedAt: null, completedAt: null, sessionId: null, activityId: null }));
}
const mean = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;
/** At most one measurement per local UTC date; no response to a single weigh-in. */
export function weightPlateau(weights: WeightMeasurement[], now: string): Review['plateau'] {
  const days = new Map<string, number>();
  for (const w of [...weights].sort((a, b) => a.measuredAt.localeCompare(b.measuredAt))) {
    if (w.kg > 0 && Number.isFinite(w.kg) && Date.parse(w.measuredAt) <= Date.parse(now) && Date.parse(w.measuredAt) >= Date.parse(now) - 56 * DAY) days.set(w.measuredAt.slice(0, 10), w.kg);
  }
  const samples = [...days].sort(([a], [b]) => a.localeCompare(b));
  if (samples.length < 4) return 'insufficient';
  const span = (Date.parse(samples.at(-1)![0]) - Date.parse(samples[0][0])) / DAY;
  if (span < 14) return 'observe';
  const stable = Math.abs(mean(samples.slice(-2).map(x => x[1])) - mean(samples.slice(0, 2).map(x => x[1]))) < 0.5;
  if (!stable) return 'none';
  return span >= 21 ? 'persistent' : 'investigate';
}
/** A product adherence indicator, NOT proof a habit is formed or a clinical score. */
export function habitConfidence(reviews: Review[]): { score: number; consolidated: boolean } {
  const recent = [...reviews].sort((a, b) => a.week - b.week).slice(-8);
  if (!recent.length) return { score: 0, consolidated: false };
  const adherence = mean(recent.map(r => r.adherence));
  const confidence = mean(recent.map(r => r.answers.confidenceScore)) / 10;
  const ease = mean(recent.map(r => ['easy', 'appropriate'].includes(r.answers.difficulty) ? 1 : 0));
  const recovery = recent.some((r, i) => i > 0 && recent[i - 1].adherence < 0.6 && r.adherence >= 0.8) ? 1 : 0;
  const score = Math.round(clamp(55 * adherence + 20 * confidence + 15 * ease + 5 * recovery + 5 * Math.min(1, recent.length / 8), 0, 100));
  const consecutive = recent.every((r, i) => i === 0 || r.week === recent[i - 1].week + 1);
  const span = recent.length > 1 ? (Date.parse(recent.at(-1)!.createdAt) - Date.parse(recent[0].createdAt)) / DAY : 0;
  return { score, consolidated: recent.length >= 6 && span >= 35 && consecutive && score >= 80 && recent.slice(-4).every(r => r.adherence >= 0.75) };
}
export function reviewWeek(j: Journey, baseline: Baseline, missions: Mission[], answers: WeeklyAnswers, history: Review[], weights: WeightMeasurement[], now: string): Review {
  if (Date.parse(now) - Date.parse(j.weekStartedAt) < 7 * DAY) throw new Error('A revisão será liberada ao completar esta semana.');
  const current = missions.filter(m => m.week === j.currentWeek && m.state !== 'rescheduled');
  const completed = current.filter(m => m.state === 'completed').length;
  const planned = current.length;
  const adherence = planned > 0 ? completed / planned : 0;
  const after = { ...j.behavior };
  let decision: Review['decision'] = 'maintain';
  let reason = 'Vamos consolidar o que já cabe na sua rotina.';
  const plateau = weightPlateau(weights, now);
  const profileClass = (baseline.profileClass || classifyCardioProfile(baseline.answers, baseline.profile)) as CardioProfileClass;
  const policy = profilePolicy[profileClass] || profilePolicy.beginner;
  if (safetyDecision(answers.safety, j.goalType === 'gradual_return').blocked) {
    decision = 'pause'; reason = safetyDecision(answers.safety, j.goalType === 'gradual_return').reason;
  } else if (adherence < 0.6 || answers.confidenceScore <= 4 || answers.energy === 'poor' || ['hard', 'very_hard'].includes(answers.difficulty)) {
    if (after.targetMetric === 'distance' && after.distanceKm) {
      const regression = profileClass === 'runner' || profileClass === 'advanced' ? 0.9 : 0.8;
      after.distanceKm = Math.max(0.2, Math.round(after.distanceKm * regression * 10) / 10);
      decision = after.distanceKm < (j.behavior.distanceKm || 0) ? 'regress' : 'maintain';
    } else {
      after.durationMinutes = Math.max(MIN_ACTIVE_MISSION_MINUTES, Math.floor(after.durationMinutes * policy.regressionFactor));
      decision = after.durationMinutes < j.behavior.durationMinutes ? 'regress' : 'maintain';
    }
    reason = 'A resposta da semana pede menos carga. Vamos reduzir de forma proporcional ao seu perfil, sem transformar a missão em uma atividade curta demais para ser útil.';
  } else if (j.goalType === 'lose_weight' && plateau === 'persistent' && adherence >= 0.8 && answers.habitAdherence === 'yes') {
    reason = 'Seu peso ficou estável apesar da boa adesão. Vamos revisar o contexto e, se houver outra ação simples possível, mudar somente uma coisa nesta semana.';
  } else if (j.goalType === 'lose_weight' && plateau === 'investigate') {
    reason = 'Oscilações de peso são comuns. Por enquanto, mantenha a rotina e observe sono, fome e facilidade antes de qualquer mudança.';
  } else if (adherence >= 0.8 && answers.confidenceScore >= 8 && ['good', 'great'].includes(answers.energy) && !['high', 'very_high'].includes(answers.hunger || '') && answers.habitAdherence !== 'no') {
    if (after.targetMetric === 'distance' && after.distanceKm) {
      const goalCap = j.outcome.distanceKm || Number.POSITIVE_INFINITY;
      const distanceRate = policy.progressionRate;
      const distanceStep = Math.min(0.5, Math.max(0.1, Math.round(after.distanceKm * distanceRate * 10) / 10));
      const nextDistance = Math.min(goalCap, after.distanceKm + distanceStep);
      after.distanceKm = Math.round(nextDistance * 10) / 10;
      decision = after.distanceKm > (j.behavior.distanceKm || 0) ? 'progress' : 'maintain';
      reason = decision === 'progress' ? 'Sua semana sustentou a carga. A próxima distância sobe em um passo pequeno, ajustado ao perfil em vez de usar uma porcentagem universal.' : 'Você está mantendo uma boa base dentro da distância planejada.';
    } else {
      const step = j.goalType === 'gradual_return' ? 1 : Math.max(1, Math.round(after.durationMinutes * policy.progressionRate));
      after.durationMinutes = Math.min(Math.max(MIN_ACTIVE_MISSION_MINUTES, baseline.answers.availableMinutes), after.durationMinutes + Math.min(3, step));
      decision = after.durationMinutes > j.behavior.durationMinutes ? 'progress' : 'maintain';
      reason = decision === 'progress' ? 'Sua semana sustentou a carga. Vamos aumentar somente um pouco o tempo, usando um passo compatível com o seu perfil e mantendo a intensidade fácil.' : 'Você está mantendo uma boa base dentro do tempo disponível.';
    }
  }
  const result: Review = { id: `week_${j.currentWeek}`, journeyId: j.id, week: j.currentWeek, createdAt: now, completed, planned, adherence, answers, before: { ...j.behavior }, after, decision, reason, habitConfidence: 0, plateau, versions: OBJECTIVE_VERSIONS };
  result.habitConfidence = habitConfidence([...history, result]).score;
  return result;
}
export function professionalNextLevel(j: Journey, review: Review | null, now: string): ProfessionalUnlock {
  const runningGoals: Journey['goalType'][] = ['start_running', 'run_5k', 'run_10k', 'pace', 'weekly_distance', 'race'];
  const kind = j.goalType === 'lose_weight' || ['food', 'hunger', 'sweets'].includes(review?.answers.barrier || '')
    ? 'nutritionist'
    : runningGoals.includes(j.goalType)
      ? 'running_coach'
      : j.goalType === 'gradual_return' || j.safety.signals.includes('pain')
        ? 'physiotherapist'
        : 'personal_trainer';
  return { journeyId: j.id, kind, eligibleAt: j.consolidated ? now : null, status: 'COMING_SOON', partnerId: null, canBook: false, canShare: false, reason: 'Parcerias em preparação. Nenhuma consulta ou condição comercial está disponível.', version: OBJECTIVE_VERSIONS.nextLevel };
}
export function professionalSharingAllowed(): false { return false; }

type AchievementSeed = Omit<CardioAchievement, 'journeyId' | 'createdAt' | 'version'>;
export function activityAchievementSeeds(j: Journey, m: Mission, a: VerifiedActivity, nextTotal: number, now: string): AchievementSeed[] {
  const result: AchievementSeed[] = [];
  if (nextTotal === 10) result.push({ id: 'ten_missions', label: '10 metas concluídas', evidence: { totalCompleted: nextTotal } });
  if (m.prescription.modality === 'running') result.push({ id: 'first_run', label: 'Primeira corrida da jornada', evidence: { activityId: a.id } });
  if (a.distanceKm >= 1) result.push({ id: 'first_km', label: 'Primeiro quilômetro', evidence: { activityId: a.id, distanceKm: a.distanceKm } });
  if (a.distanceKm >= 5) result.push({ id: 'first_5k', label: 'Primeiros 5 km', evidence: { activityId: a.id, distanceKm: a.distanceKm } });
  if (Date.parse(now) - Date.parse(j.createdAt) >= 30 * DAY) result.push({ id: 'thirty_days', label: '30 dias de jornada', evidence: { journeyStartedAt: j.createdAt } });
  return result;
}
export function reviewAchievementSeeds(review: Review, history: Review[], consolidated: boolean): AchievementSeed[] {
  const result: AchievementSeed[] = [];
  if (review.week === 1 && review.planned > 0 && review.completed === review.planned) result.push({ id: 'first_complete_week', label: 'Primeira semana completa', evidence: { week: 1, completed: review.completed } });
  if (history[0]?.adherence < 0.6 && review.adherence >= 0.8) result.push({ id: 'returned_after_interruption', label: 'Retorno após uma semana difícil', evidence: { week: review.week } });
  const recent = [...history, review].sort((a, b) => a.week - b.week).slice(-4);
  if (recent.length === 4 && recent.every(item => item.adherence >= 0.8)) result.push({ id: 'high_consistency', label: 'Alta consistência', evidence: { weeks: 4 } });
  if (review.week >= 4 && ((review.after.targetMetric === 'distance' && (review.after.distanceKm || 0) > (review.before.distanceKm || 0)) || (review.after.targetMetric === 'duration' && review.after.durationMinutes > review.before.durationMinutes))) result.push({ id: 'improved_endurance', label: 'Resistência em evolução', evidence: { week: review.week, targetMetric: review.after.targetMetric } });
  if (consolidated) result.push({ id: 'base_built', label: 'Base construída', evidence: { habitConfidence: review.habitConfidence } });
  return result;
}

export function goalReached(j: Journey, activity?: VerifiedActivity, weightKg?: number): boolean {
  if (j.goalType === 'lose_weight') return typeof weightKg === 'number' && !!j.outcome.weightKg && weightKg <= j.outcome.weightKg;
  if (['run_5k', 'run_10k', 'race'].includes(j.goalType)) return !!activity && !!j.outcome.distanceKm && activity.distanceKm >= j.outcome.distanceKm;
  return false;
}

export interface VerifiedActivity { id: string; userId: string; type: string; cardioType: string; sessionId: string; durationMinutes: number; distanceKm: number; startedAt: string; recordStatus: string; rejected: boolean }
export function missionMeetsActivity(j: Journey, m: Mission, a: VerifiedActivity): boolean {
  return j.status === 'active' && !safetyDecision(j.safety, j.goalType === 'gradual_return').blocked
    && m.state === 'started' && !!m.sessionId && m.sessionId === a.sessionId && a.userId === j.userId
    && a.type === 'cardio' && a.cardioType === m.prescription.modality && a.recordStatus === 'completed' && !a.rejected
    && (m.prescription.targetMetric === 'distance'
      ? Number.isFinite(a.distanceKm) && !!m.prescription.distanceKm && a.distanceKm >= m.prescription.distanceKm
      : Number.isFinite(a.durationMinutes) && a.durationMinutes >= m.prescription.durationMinutes)
    && !!m.startedAt && Date.parse(a.startedAt) >= Date.parse(m.startedAt) - 60_000;
}
