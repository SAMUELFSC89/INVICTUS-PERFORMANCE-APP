import { auth } from '../firebase';
import type { RecordedExerciseSet } from '../core/health/workoutHealthTypes';

export type ActiveRecordedExerciseSet = Omit<RecordedExerciseSet, 'endedAt' | 'status' | 'reps' | 'loadKg'>;
export interface WorkoutSetJournalState {
  sets: RecordedExerciseSet[];
  active: ActiveRecordedExerciseSet | null;
}

const PREFIX = 'invictus_health_sets_v1';
export const MAX_RECORDED_SETS = 200;
const empty = (): WorkoutSetJournalState => ({ sets: [], active: null });
const owned = (uid: string, sessionId: string) => Boolean(uid && sessionId && auth.currentUser?.uid === uid);
const keyFor = (uid: string, sessionId: string) => `${PREFIX}:${encodeURIComponent(uid)}:${encodeURIComponent(sessionId)}`;
const validTime = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));

function validIdentity(value: any): boolean {
  return value && typeof value.id === 'string' && value.id.length > 0 && value.id.length <= 200
    && typeof value.exerciseId === 'string' && value.exerciseId.length > 0 && value.exerciseId.length <= 120
    && typeof value.exerciseName === 'string' && value.exerciseName.length > 0 && value.exerciseName.length <= 200
    && (value.equipment === null || (typeof value.equipment === 'string' && value.equipment.length <= 200))
    && value.timingSource === 'user_marked' && validTime(value.startedAt);
}

function validResult(value: any): value is RecordedExerciseSet {
  return validIdentity(value) && validTime(value.endedAt)
    && (value.status === 'completed' || value.status === 'interrupted')
    && (value.reps === null || (Number.isInteger(value.reps) && value.reps >= 1 && value.reps <= 1000))
    && (value.loadKg === null || (typeof value.loadKg === 'number' && Number.isFinite(value.loadKg) && value.loadKg >= 0 && value.loadKg <= 1000));
}

function requireOwner(uid: string, sessionId: string): void {
  if (!owned(uid, sessionId)) throw new Error('Entre na conta que iniciou este treino para registrar suas séries.');
}

function read(uid: string, sessionId: string): WorkoutSetJournalState {
  if (!owned(uid, sessionId)) return empty();
  try {
    const raw = localStorage.getItem(keyFor(uid, sessionId));
    if (!raw || raw.length > 250_000) return empty();
    const parsed = JSON.parse(raw);
    if (parsed.version !== 1 || parsed.uid !== uid || parsed.sessionId !== sessionId || !Array.isArray(parsed.sets)) return empty();
    return {
      sets: parsed.sets.filter(validResult).slice(0, MAX_RECORDED_SETS),
      active: validIdentity(parsed.active) ? parsed.active : null,
    };
  } catch {
    return empty();
  }
}

function write(uid: string, sessionId: string, state: WorkoutSetJournalState): WorkoutSetJournalState {
  requireOwner(uid, sessionId);
  try {
    localStorage.setItem(keyFor(uid, sessionId), JSON.stringify({ version: 1, uid, sessionId, ...state }));
  } catch {
    throw new Error('Não foi possível salvar a série neste aparelho. Libere espaço e tente novamente.');
  }
  return state;
}

function timestamp(now: number): string {
  if (!Number.isFinite(now)) throw new Error('Não foi possível registrar o horário. Confira o relógio do aparelho.');
  return new Date(now).toISOString();
}

/** User-marked execution only. Selecting an exercise never creates a record.
 * This journal is private health context and must never set hasExercises or score inputs.
 */
export const workoutSetJournal = {
  read,
  start(uid: string, sessionId: string, exercise: { exerciseId: string; exerciseName: string; equipment: string | null }, now = Date.now()): WorkoutSetJournalState {
    requireOwner(uid, sessionId);
    const state = read(uid, sessionId);
    if (state.active) throw new Error('Conclua ou interrompa a série aberta antes de iniciar outra.');
    if (state.sets.length >= MAX_RECORDED_SETS) throw new Error('O limite de registros desta sessão foi atingido. Você pode finalizar o treino normalmente.');
    const startedAt = timestamp(now);
    if (state.sets.some(set => Date.parse(set.endedAt) > now)) throw new Error('O relógio do aparelho mudou. Confira o horário antes de iniciar outra série.');
    const active: ActiveRecordedExerciseSet = {
      id: globalThis.crypto?.randomUUID?.() || `${now}-${Math.random().toString(36).slice(2)}`,
      exerciseId: exercise.exerciseId,
      exerciseName: exercise.exerciseName,
      equipment: exercise.equipment,
      startedAt,
      timingSource: 'user_marked',
    };
    if (!validIdentity(active)) throw new Error('Não foi possível identificar este exercício. Selecione-o novamente.');
    return write(uid, sessionId, { ...state, active });
  },
  complete(uid: string, sessionId: string, result: { reps: number | null; loadKg: number | null }, now = Date.now()): WorkoutSetJournalState {
    requireOwner(uid, sessionId);
    const state = read(uid, sessionId);
    if (!state.active) throw new Error('Inicie a série antes de registrar a conclusão.');
    if (now <= Date.parse(state.active.startedAt)) throw new Error('O fim da série precisa acontecer depois do início. Confira o relógio do aparelho.');
    const completed: RecordedExerciseSet = { ...state.active, endedAt: timestamp(now), status: 'completed', reps: result.reps, loadKg: result.loadKg };
    if (!validResult(completed)) throw new Error('Informe repetições de 1 a 1.000 e carga de 0 a 1.000 kg, ou deixe os campos vazios.');
    return write(uid, sessionId, { sets: [...state.sets, completed], active: null });
  },
  /** Enter results after stopping the timer; typing must not lengthen execution. */
  updateResults(uid: string, sessionId: string, setId: string, result: { reps: number | null; loadKg: number | null }): WorkoutSetJournalState {
    requireOwner(uid, sessionId);
    const state = read(uid, sessionId);
    const index = state.sets.findIndex(set => set.id === setId && set.status === 'completed');
    if (index < 0) throw new Error('Não foi encontrada uma série concluída para atualizar.');
    const updated = { ...state.sets[index], reps: result.reps, loadKg: result.loadKg };
    if (!validResult(updated)) throw new Error('Informe repetições de 1 a 1.000 e carga de 0 a 1.000 kg, ou deixe os campos vazios.');
    return write(uid, sessionId, { ...state, sets: state.sets.map((set, itemIndex) => itemIndex === index ? updated : set) });
  },
  interrupt(uid: string, sessionId: string, now = Date.now()): WorkoutSetJournalState {
    requireOwner(uid, sessionId);
    const state = read(uid, sessionId);
    if (!state.active) return state;
    // Preserve the real action time even if the clock moved backwards.
    // Interrupted records never support a heart-rate attribution.
    const interrupted: RecordedExerciseSet = { ...state.active, endedAt: timestamp(now), status: 'interrupted', reps: null, loadKg: null };
    return write(uid, sessionId, { sets: [...state.sets, interrupted], active: null });
  },
  finish(uid: string, sessionId: string, now = Date.now()): RecordedExerciseSet[] {
    return this.interrupt(uid, sessionId, now).sets;
  },
  clear(uid: string, sessionId: string): void {
    requireOwner(uid, sessionId);
    localStorage.removeItem(keyFor(uid, sessionId));
  },
};
