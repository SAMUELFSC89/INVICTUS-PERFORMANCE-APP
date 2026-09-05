import type { RecordedExerciseSet, WorkoutFeedback, WorkoutFeedbackInsight, WorkoutHealthRecord } from './workoutHealthTypes';

/** Product evidence requirements, not medical thresholds or validated clinical scores. */
export const WORKOUT_FEEDBACK_RULES = Object.freeze({
  version: 'workout-evidence-v1',
  minSamples: 5,
  minSetSeconds: 30,
  maxSetSeconds: 300,
  minCoverage: 0.8,
  maxSetGapSeconds: 15,
  maxSessionGapSeconds: 60,
  maxHistoryDays: 90,
  minHistoricalDays: 3,
  durationTolerance: 0.1,
  minWindowSamples: 3,
  displayChangeBpm: 5,
});

type TimedSet = RecordedExerciseSet & { start: number; end: number; ordinal: number };
type Sample = { at: number; bpm: number };
type Evidence = { samples: Sample[]; average: number | null; min: number | null; max: number | null; coverage: number; enough: boolean };
const DAY = 86_400_000;
const emptySession = () => ({ averageBpm: null, maxBpm: null, sampleCount: 0, coveragePercent: 0 });
const number = (value: number) => value.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
const round = (value: number) => Math.round(value * 10) / 10;
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const date = (value: string) => typeof value === 'string' && /(?:Z|[+-]\d\d:\d\d)$/.test(value) ? Date.parse(value) : NaN;
const validResult = (set: RecordedExerciseSet) => Number.isInteger(set.reps) && set.reps! > 0 && set.reps! <= 1000
  && typeof set.loadKg === 'number' && Number.isFinite(set.loadKg) && set.loadKg >= 0 && set.loadKg <= 2000;
const knownEquipment = (set: RecordedExerciseSet) => typeof set.equipment === 'string' && set.equipment.trim().length > 0;
const partialIntegrity = (record: WorkoutHealthRecord) => record.integrity?.status === 'partial'
  || (record.integrity?.discardedSets ?? 0) > 0 || (record.integrity?.discardedHeartRateSamples ?? 0) > 0;

function validSession(record: WorkoutHealthRecord, now: number) {
  const start = date(record.startedAt), end = date(record.endedAt);
  return record.version === 1 && typeof record.sessionId === 'string' && record.sessionId.trim().length > 0
    && Number.isFinite(start) && Number.isFinite(end) && start < end && end <= now;
}

/** Ambiguous duplicate timestamps are discarded, never resolved by choosing a convenient value. */
function samplesFor(record: WorkoutHealthRecord): Sample[] {
  if (!['available', 'partial'].includes(record.heartRate.status)) return [];
  const start = date(record.startedAt), end = date(record.endedAt);
  const byTime = new Map<number, number | null>();
  for (const sample of record.heartRate.samples) {
    const at = date(sample.timestamp);
    if (!Number.isFinite(at) || at < start || at > end || typeof sample.bpm !== 'number'
      || !Number.isFinite(sample.bpm) || sample.bpm < 30 || sample.bpm > 240) continue;
    if (!byTime.has(at)) byTime.set(at, sample.bpm);
    else if (byTime.get(at) !== sample.bpm) byTime.set(at, null);
  }
  return [...byTime].filter((entry): entry is [number, number] => entry[1] !== null)
    .map(([at, bpm]) => ({ at, bpm })).sort((a, b) => a.at - b.at);
}

/** No interpolation: coverage measures short intervals bounded by actual readings. */
function evidence(samples: Sample[], start: number, end: number, gapSeconds: number, blocked = false): Evidence {
  const selected = samples.filter(sample => sample.at >= start && sample.at <= end);
  const maxGap = gapSeconds * 1000;
  let covered = 0;
  let largestGap = selected.length ? Math.max(selected[0].at - start, end - selected[selected.length - 1].at) : end - start;
  for (let index = 1; index < selected.length; index += 1) {
    const gap = selected[index].at - selected[index - 1].at;
    largestGap = Math.max(largestGap, gap);
    if (gap <= maxGap) covered += gap;
  }
  const coverage = end > start ? Math.min(1, covered / (end - start)) : 0;
  const enough = !blocked && selected.length >= WORKOUT_FEEDBACK_RULES.minSamples
    && coverage >= WORKOUT_FEEDBACK_RULES.minCoverage && largestGap <= maxGap;
  return {
    samples: selected, coverage, enough,
    average: enough ? mean(selected.map(sample => sample.bpm)) : null,
    min: enough ? selected.reduce((minimum, sample) => Math.min(minimum, sample.bpm), Infinity) : null,
    max: enough ? selected.reduce((maximum, sample) => Math.max(maximum, sample.bpm), -Infinity) : null,
  };
}

function timedSets(record: WorkoutHealthRecord): TimedSet[] {
  const ids = new Map<string, number>();
  record.sets.forEach(set => ids.set(set.id, (ids.get(set.id) || 0) + 1));
  // Include interrupted intervals in overlap detection: neither overlapping attribution is trustworthy.
  const intervals = record.sets.map(set => ({ ...set, start: date(set.startedAt), end: date(set.endedAt), ordinal: 0 }))
    .filter(set => Number.isFinite(set.start) && Number.isFinite(set.end) && set.start < set.end)
    .sort((a, b) => a.start - b.start);
  const ordinals = new Map<string, number>();
  return intervals.map(set => {
    const ordinal = (ordinals.get(set.exerciseId) || 0) + 1;
    ordinals.set(set.exerciseId, ordinal);
    return { ...set, ordinal };
  }).filter(set => set.id && ids.get(set.id) === 1 && set.exerciseId && set.exerciseName.trim()
    && set.status === 'completed' && set.timingSource === 'user_marked'
    && set.start >= date(record.startedAt) && set.end <= date(record.endedAt)
    && set.end - set.start <= WORKOUT_FEEDBACK_RULES.maxSetSeconds * 1000
    && !intervals.some(other => other.id !== set.id && other.start < set.end && other.end > set.start));
}

function cleanHistory(record: WorkoutHealthRecord, history: readonly WorkoutHealthRecord[], now: number) {
  const count = new Map<string, number>();
  history.forEach(item => count.set(item.sessionId, (count.get(item.sessionId) || 0) + 1));
  const start = date(record.startedAt);
  return history.filter(item => count.get(item.sessionId) === 1 && item.sessionId !== record.sessionId
    && validSession(item, now) && date(item.endedAt) <= start && date(item.startedAt) < start
    && date(item.startedAt) >= start - WORKOUT_FEEDBACK_RULES.maxHistoryDays * DAY)
    .sort((a, b) => date(b.startedAt) - date(a.startedAt));
}

function sameContext(current: TimedSet, past: TimedSet) {
  return current.exerciseId === past.exerciseId && knownEquipment(current) && current.equipment === past.equipment
    && validResult(current) && validResult(past) && current.loadKg === past.loadKg && current.reps === past.reps
    && current.ordinal === past.ordinal
    && Math.abs((past.end - past.start) / (current.end - current.start) - 1) <= WORKOUT_FEEDBACK_RULES.durationTolerance;
}

function previousHeartRate(record: WorkoutHealthRecord, set: TimedSet, history: WorkoutHealthRecord[]): number[] {
  if (!record.heartRate.source || !record.heartRate.sourceKey?.trim() || partialIntegrity(record)
    || timedSets(record).length !== record.sets.length) return [];
  const perDay = new Map<string, number>();
  for (const past of history) {
    if (past.heartRate.source !== record.heartRate.source || past.heartRate.sourceKey !== record.heartRate.sourceKey
      || past.heartRate.truncated || past.heartRate.status !== 'available' || partialIntegrity(past)) continue;
    const pastSets = timedSets(past);
    if (pastSets.length !== past.sets.length) continue;
    const match = pastSets.find(candidate => sameContext(set, candidate));
    if (!match || match.end - match.start < WORKOUT_FEEDBACK_RULES.minSetSeconds * 1000) continue;
    const readings = evidence(samplesFor(past), match.start, match.end, WORKOUT_FEEDBACK_RULES.maxSetGapSeconds);
    const day = new Date(date(past.startedAt)).toISOString().slice(0, 10);
    if (readings.enough && !perDay.has(day)) perDay.set(day, readings.average!);
  }
  return [...perDay.values()];
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function exerciseObservation(record: WorkoutHealthRecord, set: TimedSet, reading: Evidence, history: WorkoutHealthRecord[]): WorkoutFeedbackInsight {
  const range = `${number(reading.min!)}–${number(reading.max!)} bpm`;
  const coverage = `${Math.floor(reading.coverage * 100)}%`;
  const duration = number((set.end - set.start) / 1000);
  const thirds = (set.end - set.start) / 3;
  const first = reading.samples.filter(sample => sample.at < set.start + thirds);
  const last = reading.samples.filter(sample => sample.at > set.end - thirds);
  const difference = first.length >= WORKOUT_FEEDBACK_RULES.minWindowSamples && last.length >= WORKOUT_FEEDBACK_RULES.minWindowSamples
    ? mean(last.map(sample => sample.bpm)) - mean(first.map(sample => sample.bpm)) : null;
  const past = previousHeartRate(record, set, history);
  let description = `Na série ${set.ordinal} de ${set.exerciseName}, foram registradas ${reading.samples.length} leituras entre ${range}, em ${duration} s cronometrados (${coverage} de cobertura temporal).`;
  let title = `Batimentos registrados em ${set.exerciseName}`;
  if (difference !== null && Math.abs(difference) >= WORKOUT_FEEDBACK_RULES.displayChangeBpm) {
    const initial = mean(first.map(sample => sample.bpm)), final = mean(last.map(sample => sample.bpm));
    description += ` Média das leituras no terço inicial: ${number(initial)} bpm; no final: ${number(final)} bpm (${difference > 0 ? '+' : ''}${number(difference)} bpm).`;
    title = `Variação registrada em ${set.exerciseName}`;
  }
  if (past.length >= WORKOUT_FEEDBACK_RULES.minHistoricalDays) {
    const reference = median(past), delta = reading.average! - reference;
    description += ` Média das leituras desta série: ${number(reading.average!)} bpm; mediana das médias em ${past.length} sessões anteriores, de dias distintos em UTC: ${number(reference)} bpm (${delta > 0 ? '+' : ''}${number(delta)} bpm). Mesmos exercício, equipamento, carga, repetições e posição da série; duração com diferença de até 10%.`;
  }
  return {
    id: `heart-rate:${set.id}`, kind: 'observation', title, evidence: description,
    meaning: 'A frequência cardíaca pode subir durante o esforço. Essas leituras mostram o que ocorreu no intervalo marcado, mas não identificam a causa da variação nem medem a qualidade do exercício. Um número mais alto, isoladamente, não confirma melhor desempenho nem determina se o exercício está seguro.',
    nextStep: 'Observe se o esforço percebido acompanha as leituras e confira o ajuste do sensor. Compare séries semelhantes ao longo do tempo; batimentos mais altos não precisam ser sua meta.',
    exerciseId: set.exerciseId,
  };
}

function achievement(set: TimedSet, currentSets: TimedSet[], history: WorkoutHealthRecord[]): WorkoutFeedbackInsight | null {
  if (!validResult(set) || !knownEquipment(set)) return null;
  // First previous session with this exercise/equipment is the honest comparator.
  // Do not cherry-pick an older weaker session when the latest is incompatible.
  for (const record of history) {
    const matches = timedSets(record).filter(past => past.exerciseId === set.exerciseId && past.equipment === set.equipment);
    if (!record.sets.some(past => past.exerciseId === set.exerciseId && past.equipment === set.equipment)) continue;
    if (!matches.length || partialIntegrity(record) || timedSets(record).length !== record.sets.length) return null;
    const currentMatches = currentSets.filter(current => current.exerciseId === set.exerciseId && current.equipment === set.equipment);
    if (matches.length !== currentMatches.length || !currentMatches.every(current => matches.some(past =>
      current.ordinal === past.ordinal && validResult(current) && validResult(past) && current.loadKg === past.loadKg))) return null;
    const past = matches.find(candidate => candidate.ordinal === set.ordinal);
    if (!past || !validResult(past) || past.loadKg !== set.loadKg || set.reps! <= past.reps!) return null;
    return {
      id: `achievement:${set.id}`, kind: 'achievement', title: `Mais repetições registradas em ${set.exerciseName}`,
      evidence: `Parabéns pelo resultado registrado: ${set.reps} repetições com carga informada de ${number(set.loadKg!)} kg na série ${set.ordinal}, contra ${past.reps} repetições com a mesma carga informada e equipamento na última sessão comparável (${new Date(date(record.startedAt)).toISOString().slice(0, 10)}, UTC).`,
      meaning: 'Você registrou mais repetições nessa série. O registro não mede técnica, amplitude, assistência, ganho muscular ou condicionamento.',
      nextStep: 'Mantenha carga, repetições e condições de execução bem registradas para verificar se o resultado se repete.',
      exerciseId: set.exerciseId,
    };
  }
  return null;
}

/** Pure, bounded, auditable feedback. No AI, IO, planned results, clinical inference or scoring. */
export function buildWorkoutFeedback(record: WorkoutHealthRecord, history: readonly WorkoutHealthRecord[] = [], now = Date.now()): WorkoutFeedback {
  if (!Number.isFinite(now) || !validSession(record, now)) return {
    methodologyVersion: WORKOUT_FEEDBACK_RULES.version, status: 'insufficient', session: emptySession(),
    insights: [{ id: 'invalid-session', kind: 'insufficient', title: 'Sessão sem intervalo válido', evidence: 'O início e o fim da sessão não permitem cruzar os registros com precisão.', meaning: 'Nenhuma conclusão foi produzida com este intervalo.', nextStep: 'Confira o registro da sessão e seus horários.' }],
    limitations: ['Horários precisam conter fuso explícito, início anterior ao fim e término no passado.'],
  };
  const samples = samplesFor(record), sets = timedSets(record), previous = cleanHistory(record, history, now);
  const blocked = record.heartRate.truncated || record.heartRate.status !== 'available' || (record.integrity?.discardedHeartRateSamples ?? 0) > 0;
  const session = evidence(samples, date(record.startedAt), date(record.endedAt), WORKOUT_FEEDBACK_RULES.maxSessionGapSeconds, blocked);
  const limitations: string[] = ['Médias são das leituras aceitas; o maior valor observado não garante o pico real. Cobertura usa somente intervalos curtos entre leituras, sem preencher lacunas.'];
  if (!record.heartRate.source || !record.heartRate.sourceKey?.trim()) limitations.push('A identidade do sensor não foi informada. As leituras podem ser descritas, mas não são comparadas ao histórico de batimentos.');
  if (blocked) limitations.push(record.heartRate.status === 'pending' ? 'Os batimentos desta sessão ainda estão aguardando sincronização.' : 'O registro de batimentos está incompleto ou indisponível; médias e comparações foram suspensas.');
  const incomplete = partialIntegrity(record) || sets.length !== record.sets.length;
  if (incomplete) limitations.push('Parte das séries não pôde ser preservada. Conquistas comparadas e referências históricas foram suspensas para não tratar um registro incompleto como completo.');
  if (sets.length !== record.sets.length) limitations.push('Séries interrompidas, sobrepostas, duplicadas ou com horários inválidos foram excluídas do feedback.');
  const achievements: WorkoutFeedbackInsight[] = [], observations: WorkoutFeedbackInsight[] = [];
  const seenAchievements = new Set<string>(), seenObservations = new Set<string>();
  let coveredSets = 0;
  for (const set of sets) {
    const success = incomplete ? null : achievement(set, sets, previous);
    if (success && !seenAchievements.has(set.exerciseId)) { achievements.push(success); seenAchievements.add(set.exerciseId); }
    if (set.end - set.start < WORKOUT_FEEDBACK_RULES.minSetSeconds * 1000) continue;
    const reading = evidence(samples, set.start, set.end, WORKOUT_FEEDBACK_RULES.maxSetGapSeconds, blocked);
    if (reading.enough) coveredSets += 1;
    if (reading.enough && !seenObservations.has(set.exerciseId)) {
      observations.push(exerciseObservation(record, set, reading, previous)); seenObservations.add(set.exerciseId);
    }
  }
  // Reserve space for both useful result feedback and measurement feedback when available.
  const insights = [...achievements.slice(0, observations.length ? 2 : 3), ...observations].slice(0, 4);
  if (coveredSets < sets.length && coveredSets > 0) limitations.push(`Somente ${coveredSets} de ${sets.length} séries válidas tiveram cobertura de batimentos suficiente; as demais não receberam interpretação de FC.`);
  limitations.push('Para atribuir FC a uma série: marcação explícita de início/fim, duração de 30 a 300 s, 5 leituras, 80% de cobertura e nenhuma lacuna ou borda acima de 15 s. São critérios de qualidade do produto, não clínicos.');
  if (!observations.length) {
    if (insights.length < 4) insights.push({
      id: 'exercise-heart-rate-insufficient', kind: 'insufficient', title: 'Batimentos por exercício ainda sem base suficiente',
      evidence: sets.length ? 'Nenhuma série reuniu o registro de batimentos e a cobertura exigidos para este cruzamento.' : 'Não há séries concluídas com início e fim válidos para cruzar com os batimentos.',
      meaning: 'O app não atribui os batimentos da sessão a um exercício sem horários e leituras suficientes.',
      nextStep: 'Marque o início e o fim de cada série e sincronize uma fonte que forneça leituras de frequência cardíaca com horário.',
    });
  }
  if (!achievements.length && !observations.length && sets.length && insights.length < 4) insights.unshift({
    id: 'recorded-completion', kind: 'achievement', title: 'Suas séries ficaram registradas',
    evidence: `Você marcou ${sets.length} ${sets.length === 1 ? 'série concluída' : 'séries concluídas'} com início e fim.`,
    meaning: 'Essas marcações ajudam a acompanhar sua consistência de registro. Elas não comprovam carga executada ou qualidade do movimento.',
    nextStep: 'Registre somente as repetições e a carga que você realizou para permitir comparações futuras.',
  });
  const useful = achievements.length > 0 || observations.length > 0;
  return {
    methodologyVersion: WORKOUT_FEEDBACK_RULES.version,
    status: useful ? (session.enough && observations.length > 0 && !incomplete && coveredSets === sets.length ? 'available' : 'partial') : 'insufficient',
    session: { averageBpm: session.average === null ? null : round(session.average), maxBpm: session.max === null ? null : round(session.max), sampleCount: session.samples.length, coveragePercent: Math.floor(session.coverage * 100) },
    insights, limitations,
  };
}
