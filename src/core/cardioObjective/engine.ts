import { GOALS, OBJECTIVE_VERSIONS, type Baseline, type CardioAchievement, type HabitIntervention, type Journey, type Mission, type ObjectiveAnswers, type Prescription, type ProfessionalUnlock, type ProfileSnapshot, type Review, type SafetyAnswers, type WeightMeasurement, type WeeklyAnswers } from './types.js';

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
}

export function safetyDecision(safety: SafetyAnswers, gradualReturn: boolean) {
  if (!safety.screened) return { blocked: true, urgent: false, reason: 'Precisamos confirmar os sinais de segurança antes de continuar.' };
  const urgent = safety.signals.some(s => ['chest_pain', 'fainting', 'dizziness', 'unusual_breathlessness'].includes(s));
  if (urgent) return { blocked: true, urgent: true, reason: 'Interrompa a atividade. Procure atendimento médico imediato se os sintomas estiverem presentes ou forem intensos. Em uma emergência no Brasil, ligue 192.' };
  if ((gradualReturn || safety.signals.includes('surgical_recovery')) && safety.medicalClearance !== true) return { blocked: true, urgent: false, reason: 'Antes de iniciar ou progredir, peça liberação ao profissional responsável pela sua recuperação.' };
  if (safety.signals.includes('pain')) return { blocked: true, urgent: false, reason: 'Não force movimentos com dor. Procure avaliação profissional antes de continuar a progressão.' };
  return { blocked: false, urgent: false, reason: 'Mantenha um esforço confortável, em que consiga conversar. Pare se surgir algum sintoma incomum.' };
}

/** Capability is not medical clearance. Self-report is deliberately conservative. */
export function readiness(a: ObjectiveAnswers): number {
  if (a.goalType === 'gradual_return') return 0;
  const runningLevel = ({ none: 1, seconds: 2, minutes: 3, regular: 4, structured: 5 } as const)[a.runningAbility];
  if (a.walkingMinutes === 5 && runningLevel <= 1) return 0;
  return runningLevel;
}

export function classifyCardioProfile(a: ObjectiveAnswers, profile?: ProfileSnapshot): CardioProfileClass {
  if (a.goalType === 'gradual_return' || a.safety.signals.includes('surgical_recovery')) return 'returning';
  const sessions = profile?.recentCardioSessions || 0;
  const longestRun = profile?.recentLongestRunKm || 0;
  if (a.runningAbility === 'structured' || (sessions >= 8 && longestRun >= 5)) return 'advanced';
  if (a.runningAbility === 'regular' || (sessions >= 4 && longestRun >= 2)) return 'runner';
  if (a.runningAbility === 'minutes' || sessions >= 3) return 'active';
  if (a.runningAbility === 'seconds' || a.walkingMinutes >= 30 || sessions >= 1) return 'beginner';
  return 'sedentary';
}

export function buildCardioBaseline(a: ObjectiveAnswers, profile?: ProfileSnapshot): CardioBaselineDecision {
  const profileClass = classifyCardioProfile(a, profile);
  const maxMinutes = Math.max(MIN_ACTIVE_MISSION_MINUTES, a.availableMinutes);
  const baseByClass: Record<CardioProfileClass, number> = {
    sedentary: 15,
    beginner: 18,
    active: 22,
    runner: 30,
    advanced: 35,
    returning: 15,
  };
  let baselineMinutes = baseByClass[profileClass];

  // A pessoa que já corre não deve receber uma caminhada simbólica de poucos minutos.
  // A disponibilidade declarada é usada como teto, mas também ajuda a calibrar quem já possui base.
  if (a.runningAbility === 'minutes') baselineMinutes = Math.max(baselineMinutes, Math.round(maxMinutes * 0.6));
  if (a.runningAbility === 'regular') baselineMinutes = Math.max(baselineMinutes, Math.round(maxMinutes * 0.7));
  if (a.runningAbility === 'structured') baselineMinutes = Math.max(baselineMinutes, Math.round(maxMinutes * 0.75));
  if ((profile?.recentCardioSessions || 0) >= 6) baselineMinutes += 2;

  // Barreiras podem suavizar a missão, mas nunca a reduzir abaixo de 15 minutos.
  if (a.barrier === 'time') baselineMinutes = Math.min(baselineMinutes, Math.max(MIN_ACTIVE_MISSION_MINUTES, Math.round(maxMinutes * 0.7)));
  if (a.confidenceScore <= 4) baselineMinutes = Math.round(baselineMinutes * 0.8);
  else if (a.confidenceScore <= 7 || a.barrier === 'restart') baselineMinutes = Math.round(baselineMinutes * 0.9);
  baselineMinutes = clamp(baselineMinutes, MIN_ACTIVE_MISSION_MINUTES, maxMinutes);

  const reason = profileClass === 'sedentary'
    ? 'Começo mínimo de 15 minutos para criar estímulo real sem transformar a missão em uma tarefa cotidiana trivial.'
    : profileClass === 'runner' || profileClass === 'advanced'
      ? 'A missão respeita a capacidade de quem já corre e usa uma fração conservadora do tempo disponível, sem regredir para caminhada curta.'
      : profileClass === 'returning'
        ? 'Retorno conservador, condicionado às regras de segurança e liberação aplicáveis.'
        : 'A missão parte da capacidade declarada e do histórico recente, mantendo progressão conservadora.';
  return { profileClass, baselineMinutes, minMinutes: MIN_ACTIVE_MISSION_MINUTES, maxMinutes, reason };
}

export function onboardingSteps(goal: ObjectiveAnswers['goalType']) {
  return ['goal', ...(goal === 'other' ? ['otherGoal'] : []), 'safety', 'capacity', 'availability', 'schedule', 'modality', 'barrier',
    ...(goal === 'lose_weight' ? ['weight', 'weightTarget', 'nutrition'] : []),
    ...(goal === 'race' ? ['distance'] : []), 'confidence', 'consent'];
}

export function validateMissionCoherence(a: ObjectiveAnswers, prescription: Prescription, profile?: ProfileSnapshot): Prescription {
  const level = readiness(a);
  const next = { ...prescription };
  next.durationMinutes = Math.max(MIN_ACTIVE_MISSION_MINUTES, next.durationMinutes);

  if (a.preferredActivity === 'running' && level >= 2 && a.barrier !== 'dislike_running' && a.goalType !== 'gradual_return') {
    next.modality = 'running';
  }
  if (next.modality === 'running' && level < 2) next.modality = 'walking';
  if (a.goalType === 'gradual_return') next.modality = 'walking';

  // Quem corre regularmente não recebe intervalos artificiais de 60s/120s.
  if (next.modality === 'running' && level >= 4) {
    next.runSecondsPerInterval = 0;
    next.walkSecondsPerInterval = 0;
  }

  const baseline = buildCardioBaseline(a, profile);
  if (next.targetMetric === 'duration') next.durationMinutes = clamp(next.durationMinutes, baseline.minMinutes, baseline.maxMinutes);
  return next;
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
  const inferredStart = profile?.recentLongestRunKm ? Math.max(0.5, profile.recentLongestRunKm * 0.75) : [0.5, 0.75, 1, 1.5, 2, 2.5][level];
  const distanceKm = distanceGoal ? Math.round(Math.min(outcomeDistance || inferredStart, inferredStart) * 10) / 10 : null;
  const runSecondsPerInterval = modality === 'running' && level < 4 ? (level === 2 ? 30 : 60) : 0;
  const walkSecondsPerInterval = modality === 'running' && level < 4 ? 90 : 0;
  const prescription: Prescription = {
    modality,
    targetMetric: distanceGoal ? 'distance' : 'duration',
    durationMinutes: baseline.baselineMinutes,
    distanceKm,
    sessions: Math.min(a.availableDays.length, a.goalType === 'gradual_return' ? 2 : 3),
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
  const baseline: Baseline = { id: 'initial', capturedAt: now, profile, answers: a, startingWeightKg: a.currentWeightKg ?? null, readinessLevel: readiness(a), versions: OBJECTIVE_VERSIONS };
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
  const context = j.goalType === 'post_workout' ? 'Faça após a musculação, apenas se ainda estiver se sentindo bem.' : j.goalType === 'rest_days' ? 'Planejada para um dia sem musculação. Mantenha esforço confortável.' : 'A meta respeita seu ponto de partida e sua capacidade atual. Faça no seu ritmo e pare diante de sintomas.';
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
  if (safetyDecision(answers.safety, j.goalType === 'gradual_return').blocked) {
    decision = 'pause'; reason = safetyDecision(answers.safety, j.goalType === 'gradual_return').reason;
  } else if (adherence < 0.6 || answers.confidenceScore <= 4 || answers.energy === 'poor' || ['hard', 'very_hard'].includes(answers.difficulty)) {
    if (after.targetMetric === 'distance' && after.distanceKm) {
      after.distanceKm = Math.max(0.2, Math.round(after.distanceKm * 0.8 * 10) / 10);
      decision = after.distanceKm < (j.behavior.distanceKm || 0) ? 'regress' : 'maintain';
    } else {
      after.durationMinutes = Math.max(MIN_ACTIVE_MISSION_MINUTES, Math.floor(after.durationMinutes * 0.8));
      decision = after.durationMinutes < j.behavior.durationMinutes ? 'regress' : 'maintain';
    }
    reason = 'Essa meta ficou difícil nesta semana. Vamos facilitar a retomada sem transformar a missão em uma atividade curta demais para gerar progresso.';
  } else if (j.goalType === 'lose_weight' && plateau === 'persistent' && adherence >= 0.8 && answers.habitAdherence === 'yes') {
    reason = 'Seu peso ficou estável apesar da boa adesão. Vamos revisar o contexto e, se houver outra ação simples possível, mudar somente uma coisa nesta semana.';
  } else if (j.goalType === 'lose_weight' && plateau === 'investigate') {
    reason = 'Oscilações de peso são comuns. Por enquanto, mantenha a rotina e observe sono, fome e facilidade antes de qualquer mudança.';
  } else if (adherence >= 0.8 && answers.confidenceScore >= 8 && ['good', 'great'].includes(answers.energy) && !['high', 'very_high'].includes(answers.hunger || '') && answers.habitAdherence !== 'no') {
    if (after.targetMetric === 'distance' && after.distanceKm) {
      const goalCap = j.outcome.distanceKm || Number.POSITIVE_INFINITY;
      const nextDistance = Math.min(goalCap, after.distanceKm + Math.min(0.5, Math.max(0.1, Math.round(after.distanceKm * 0.1 * 10) / 10)));
      after.distanceKm = Math.round(nextDistance * 10) / 10;
      decision = after.distanceKm > (j.behavior.distanceKm || 0) ? 'progress' : 'maintain';
      reason = decision === 'progress' ? 'Vamos aumentar somente um pouco a distância. Frequência e esforço continuam iguais.' : 'Você está mantendo uma boa base dentro da distância planejada.';
    } else {
      const step = j.goalType === 'gradual_return' ? 1 : Math.max(1, Math.floor(after.durationMinutes * 0.1));
      after.durationMinutes = Math.min(Math.max(MIN_ACTIVE_MISSION_MINUTES, baseline.answers.availableMinutes), after.durationMinutes + Math.min(3, step));
      decision = after.durationMinutes > j.behavior.durationMinutes ? 'progress' : 'maintain';
      reason = decision === 'progress' ? 'Vamos aumentar somente um pouco o tempo. Frequência e intensidade continuam iguais.' : 'Você está mantendo uma boa base dentro do tempo disponível.';
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