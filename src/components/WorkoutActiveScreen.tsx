import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, ArrowLeft, Bell, Check, ChevronRight, Flame, HeartPulse, MoreVertical, Pause, Play, Plus, SkipForward, Square } from 'lucide-react';
import type { ActivitySession } from '../types';
import { OFFICIAL_EXERCISES_BATCH_01, OFFICIAL_MUSCLE_GROUP_LABELS } from '../data/exerciseCatalog';
import { ExerciseDemoDialog, OfficialExerciseMedia } from './OfficialExerciseMedia';
import { InvictusLogo } from './InvictusLogo';
import { activityService } from '../services/activityService';
import { auth } from '../firebase';
import { workoutSetJournal, type WorkoutSetJournalState } from '../services/workoutSetJournal';
import './WorkoutSetRecorder.css';

const formatElapsed = (seconds: number) => `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor(seconds % 3600 / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
const formatRest = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
// #REST_TIMER: quando o plano da IA não define restSeconds para o exercício
// (ex.: treino montado localmente sem plano), usamos um padrão razoável de
// academia em vez de não oferecer descanso nenhum.
const DEFAULT_REST_SECONDS = 90;

// Alerta sonoro/vibração são best-effort: nunca devem quebrar o registro do
// treino. O AudioContext só é criado/retomado dentro de um gesto do usuário
// (toque em "Concluir série"), porque navegadores bloqueiam áudio programático
// fora de uma interação -- por isso desbloqueamos aqui e o beep em si acontece
// depois, quando o cronômetro de descanso chega a zero.
let restAudioContext: AudioContext | null = null;
function unlockRestAudio() {
  try {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    if (!restAudioContext) restAudioContext = new Ctor();
    if (restAudioContext.state === 'suspended') void restAudioContext.resume();
  } catch { /* alerta sonoro é um extra, nunca bloqueia o registro da série */ }
}
function playRestAlertSound() {
  try {
    const ctx = restAudioContext;
    if (!ctx) return;
    const now = ctx.currentTime;
    [0, 0.18, 0.36].forEach((offset, index) => {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = index === 2 ? 1050 : 840;
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.32, now + offset + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.16);
      oscillator.connect(gain).connect(ctx.destination);
      oscillator.start(now + offset);
      oscillator.stop(now + offset + 0.18);
    });
  } catch { /* alerta sonoro é um extra, nunca bloqueia o registro da série */ }
}
function vibrateRestAlert() {
  // #REST_TIMER: navigator.vibrate não existe no iOS (Safari/WKWebView nunca
  // implementou a API) -- por isso este alerta é só um reforço no Android/web,
  // nunca o único aviso (o beep sonoro e o card visual cobrem os dois).
  try { navigator.vibrate?.([200, 100, 200, 100, 400]); } catch { /* best-effort */ }
}

interface WorkoutProgress {
  activeIndex: number;
  completedIds: string[];
}

export function WorkoutActiveScreen({ session, elapsed, loading, endError, onBack, onTogglePause, onEnd, onCancel }: {
  session: ActivitySession;
  elapsed: number;
  loading: boolean;
  endError?: string | null;
  onBack: () => void;
  onTogglePause?: () => void;
  onEnd: () => void;
  onCancel?: () => void;
}) {
  const exercises = useMemo(() => {
    if (session.plannedExercises?.length) {
      return session.plannedExercises.flatMap((planned) => {
        const exercise = OFFICIAL_EXERCISES_BATCH_01.find((item) => item.id === planned.exerciseId);
        return exercise ? [{ ...exercise, planned }] : [];
      });
    }
    const normalizedGroup = (session.muscleGroup || '').toLocaleLowerCase('pt-BR');
    const catalogGroup = normalizedGroup.includes('peito') ? 'peito' : normalizedGroup.includes('costa') ? 'costas' : normalizedGroup.includes('perna') ? 'pernas' : normalizedGroup.includes('ombro') ? 'ombros' : /bra[cç]o|b[ií]cep|tr[ií]cep/.test(normalizedGroup) ? 'bracos' : /core|abd[oô]m/.test(normalizedGroup) ? 'core' : null;
    const catalogSubgroup = /b[ií]cep/.test(normalizedGroup) ? 'biceps' : /tr[ií]cep/.test(normalizedGroup) ? 'triceps' : null;
    return catalogGroup ? OFFICIAL_EXERCISES_BATCH_01.filter((exercise) => exercise.muscleGroup === catalogGroup && (!catalogSubgroup || exercise.muscleSubgroup === catalogSubgroup)).slice(0, 6).map(exercise => ({ ...exercise, planned: undefined })) : [];
  }, [session.muscleGroup, session.plannedExercises]);
  const storageKey = `invictus_workout_progress_${session.id}`;
  const [progress, setProgress] = useState<WorkoutProgress>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      return saved ? JSON.parse(saved) : { activeIndex: 0, completedIds: [] };
    } catch {
      return { activeIndex: 0, completedIds: [] };
    }
  });
  const [menuOpen, setMenuOpen] = useState(false);
  const [demoOpen, setDemoOpen] = useState(false);
  const ownsSession = auth.currentUser?.uid === session.userId;
  const [journal, setJournal] = useState<WorkoutSetJournalState>(() => workoutSetJournal.read(session.userId, session.id));
  const [actualReps, setActualReps] = useState('');
  const [actualLoad, setActualLoad] = useState('');
  const [resultSetId, setResultSetId] = useState<string | null>(null);
  const [recordNotice, setRecordNotice] = useState<string | null>(null);
  const [recordError, setRecordError] = useState<string | null>(null);
  // #REST_TIMER: restSecondsLeft === null significa "nenhum descanso ativo".
  // Contagem por segundo (não por timestamp) para respeitar a pausa do treino
  // sem drift -- ver useEffect abaixo.
  const [restSecondsLeft, setRestSecondsLeft] = useState<number | null>(null);
  const [restDone, setRestDone] = useState(false);

  useEffect(() => {
    setJournal(workoutSetJournal.read(session.userId, session.id));
    setActualReps('');
    setActualLoad('');
    setResultSetId(null);
    setRecordError(null);
    setRecordNotice(null);
    setRestSecondsLeft(null);
    setRestDone(false);
  }, [session.userId, session.id, ownsSession]);

  useEffect(() => {
    if (restSecondsLeft === null || restSecondsLeft <= 0 || session.isPaused) return;
    const timeout = window.setTimeout(() => setRestSecondsLeft((current) => (current !== null ? current - 1 : current)), 1000);
    return () => window.clearTimeout(timeout);
  }, [restSecondsLeft, session.isPaused]);

  useEffect(() => {
    if (restSecondsLeft === 0 && !restDone) {
      setRestDone(true);
      playRestAlertSound();
      vibrateRestAlert();
    }
  }, [restSecondsLeft, restDone]);

  const startRest = (seconds: number) => {
    unlockRestAudio();
    setRestSecondsLeft(Math.max(5, Math.round(seconds)));
    setRestDone(false);
  };
  const extendRest = (extraSeconds: number) => {
    setRestSecondsLeft((current) => (current !== null ? current + extraSeconds : extraSeconds));
    setRestDone(false);
  };
  const skipRest = () => {
    setRestSecondsLeft(null);
    setRestDone(false);
  };

  useEffect(() => {
    // The session service also closes a set when a native pause/end action
    // occurs. Refresh its persisted result when this screen becomes paused.
    if (session.isPaused || loading) setJournal(workoutSetJournal.read(session.userId, session.id));
  }, [session.isPaused, loading, session.userId, session.id]);

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(progress));
  }, [progress, storageKey]);

  useEffect(() => {
    // A planned list is only an intention. The backend receives this signal
    // after the athlete completes at least one exercise, which improves the
    // musculação audit without inventing execution just because a plan exists.
    if (ownsSession) activityService.setHasExercises(progress.completedIds.length > 0);
  }, [progress.completedIds.length, ownsSession]);

  const currentExercise = exercises[progress.activeIndex];
  const nextExercise = exercises[progress.activeIndex + 1];
  const calories = Number(session.healthTelemetry?.calories ?? session.smartwatchData?.calories);
  const heartRate = Number(session.healthTelemetry?.avgHeartRate ?? session.smartwatchData?.avgHeartRate);
  const activeSet = ownsSession ? journal.active : null;
  const recordedSets = ownsSession ? journal.sets.filter(set => set.status === 'completed' && set.exerciseId === currentExercise?.id) : [];

  const interruptOpenSet = () => {
    // Sair do exercício atual (trocar de exercício, pausar ou finalizar) torna
    // o descanso deste exercício irrelevante -- mesmo para quem não é dono da
    // sessão (ex.: espectador), então isto roda antes do early-return abaixo.
    skipRest();
    if (!ownsSession) return;
    try {
      const before = workoutSetJournal.read(session.userId, session.id);
      setJournal(workoutSetJournal.interrupt(session.userId, session.id));
      if (before.active) setRecordNotice('Série interrompida. Esse intervalo não será usado para relacionar batimentos ao exercício.');
      setActualReps('');
      setActualLoad('');
      setResultSetId(null);
    } catch (error) {
      setRecordError(error instanceof Error ? error.message : 'Não foi possível atualizar o registro da série.');
    }
  };

  const startSet = () => {
    if (!currentExercise || !ownsSession || session.isPaused || loading) return;
    setRecordError(null);
    setRecordNotice(null);
    // Voltou a treinar: o descanso anterior (se ainda contando) não faz mais sentido.
    skipRest();
    try {
      setJournal(workoutSetJournal.start(session.userId, session.id, {
        exerciseId: currentExercise.id,
        exerciseName: currentExercise.name,
        equipment: currentExercise.equipment,
      }));
      setActualReps('');
      setActualLoad('');
      setResultSetId(null);
    } catch (error) {
      setRecordError(error instanceof Error ? error.message : 'Não foi possível iniciar o registro da série.');
    }
  };

  const completeSet = () => {
    if (!ownsSession || session.isPaused || loading) return;
    setRecordError(null);
    try {
      // Stop at the explicit tap. Optional result entry happens afterwards,
      // so time spent typing is never counted as exercise execution.
      const completed = workoutSetJournal.complete(session.userId, session.id, { reps: null, loadKg: null });
      setJournal(completed);
      setResultSetId(completed.sets.at(-1)?.id || null);
      setActualReps('');
      setActualLoad('');
      setRecordNotice('Horário da série registrado. Você pode informar as repetições e a carga agora.');
      // #REST_TIMER: descanso começa assim que a execução para, independente
      // de o atleta preencher reps/carga depois. Usa o restSeconds do plano da
      // IA para este exercício quando existir; senão, um padrão de academia.
      startRest(currentExercise?.planned?.restSeconds ?? DEFAULT_REST_SECONDS);
    } catch (error) {
      setRecordError(error instanceof Error ? error.message : 'Não foi possível concluir o registro da série.');
    }
  };

  const saveSetResults = () => {
    if (!resultSetId || !ownsSession || loading) return;
    setRecordError(null);
    try {
      setJournal(workoutSetJournal.updateResults(session.userId, session.id, resultSetId, {
        reps: actualReps.trim() === '' ? null : Number(actualReps),
        loadKg: actualLoad.trim() === '' ? null : Number(actualLoad),
      }));
      setResultSetId(null);
      setActualReps('');
      setActualLoad('');
      setRecordNotice('Resultados salvos. A análise usará somente o que foi informado e os batimentos disponíveis no intervalo marcado.');
    } catch (error) {
      setRecordError(error instanceof Error ? error.message : 'Não foi possível salvar os resultados da série.');
    }
  };

  const completeCurrent = () => {
    if (!currentExercise) return;
    interruptOpenSet();
    setProgress((current) => ({
      activeIndex: Math.min(exercises.length - 1, current.activeIndex + 1),
      completedIds: current.completedIds.includes(currentExercise.id) ? current.completedIds : [...current.completedIds, currentExercise.id]
    }));
    setMenuOpen(false);
  };

  return <section className="workout-live-screen">
    <header className="workout-live-brand"><button className="workout-live-back" aria-label="Minimizar atividade" title="Sair sem encerrar a atividade" onClick={onBack}><ArrowLeft /></button><span className="workout-live-logo"><InvictusLogo size={34} /><span><b>INVICTUS</b><small>PERFORMANCE</small></span></span><button aria-label="Mais opções" onClick={() => setMenuOpen((value) => !value)}><MoreVertical /></button>{menuOpen ? <div className="workout-live-menu"><button onClick={completeCurrent} disabled={!currentExercise}>Concluir exercício atual</button>{onCancel ? <button className="is-danger" onClick={onCancel}>Descartar treino</button> : null}</div> : null}</header>

    <div className="workout-live-summary">
      <div><small><i />{session.isPaused ? 'TREINO PAUSADO' : 'TREINO EM ANDAMENTO'}</small><strong>{formatElapsed(elapsed)}</strong><span>Tempo decorrido</span></div>
      <article><Flame /><b>{Number.isFinite(calories) && calories > 0 ? Math.round(calories) : '—'}</b><span>kcal</span></article>
      <article><HeartPulse /><b>{Number.isFinite(heartRate) && heartRate > 0 ? Math.round(heartRate) : '—'}</b><span>FC média (bpm)</span></article>
    </div>
    <p className="workout-set-heart-note">A frequência exibida é uma média disponível, não uma leitura ao vivo. A análise final depende da sincronização do relógio.</p>

    {endError ? <div className="challenge-flow-end-error"><AlertCircle /><span>{endError}</span></div> : null}

    {currentExercise ? <>
      <article className="workout-live-current">
        <OfficialExerciseMedia exercise={currentExercise} priority className="workout-live-current-media" />
        <div className="workout-live-current-copy"><small>EXERCÍCIO SELECIONADO</small><h1>{currentExercise.name}</h1><span>{OFFICIAL_MUSCLE_GROUP_LABELS[currentExercise.muscleGroup].toLocaleUpperCase('pt-BR')}</span><em>{currentExercise.planned ? `Planejado: ${currentExercise.planned.sets} séries · ${currentExercise.planned.repsMin}–${currentExercise.planned.repsMax} reps` : 'Exercício selecionado'}</em></div>
        <button onClick={() => setDemoOpen(true)} aria-label={`Ver execução de ${currentExercise.name}`}><Play /><span>VER EXECUÇÃO</span></button>
      </article>
      <ExerciseDemoDialog exercise={currentExercise} open={demoOpen} onClose={() => setDemoOpen(false)} />

      <div className="workout-exercise-advance">
        <button type="button" onClick={completeCurrent}>
          <Check size={17} />
          <span>{nextExercise ? 'Concluir exercício e ir para o próximo' : 'Concluir exercício'}</span>
        </button>
      </div>

      {restSecondsLeft !== null ? <div className={`workout-rest-timer${restDone ? ' is-done' : ''}`} role="status" aria-live="polite">
        <div className="workout-rest-timer-head"><Bell size={18} /><span>{restDone ? 'Descanso concluído! Hora da próxima série.' : 'Descansando entre séries'}</span></div>
        <strong className="workout-rest-timer-clock">{formatRest(Math.max(0, restSecondsLeft))}</strong>
        <div className="workout-rest-timer-actions">
          <button type="button" onClick={() => extendRest(15)}><Plus size={14} />15s</button>
          <button type="button" onClick={skipRest}><SkipForward size={14} />Pular descanso</button>
        </div>
      </div> : null}

      <section className="workout-set-recorder" aria-labelledby="workout-set-title">
        <div className="workout-set-heading"><div><small>REGISTRO OPCIONAL</small><h2 id="workout-set-title">Registre a série que você fizer</h2></div><span>{recordedSets.length} {recordedSets.length === 1 ? 'série registrada' : 'séries registradas'}</span></div>
        <p>Marque o início e o fim de cada série para relacionar seus batimentos ao exercício, quando houver leituras suficientes.</p>
        {!ownsSession ? <p role="alert">Entre na conta que iniciou este treino para registrar suas séries.</p> : activeSet ? <>
          <p className="workout-set-active" role="status">Série aberta: <b>{activeSet.exerciseName}</b>. Toque em concluir quando terminar a execução.</p>
          <div className="workout-set-buttons"><button type="button" className="is-primary" onClick={completeSet} disabled={loading || session.isPaused}><Check size={17} />Concluir série</button><button type="button" onClick={interruptOpenSet} disabled={loading}>Interromper registro</button></div>
        </> : resultSetId ? <>
          <p>Execução encerrada. Informe somente o que você realizou nesta série.</p>
          <div className="workout-set-fields">
            <label>Repetições realizadas <span>(opcional)</span><input type="number" inputMode="numeric" min="1" max="1000" step="1" value={actualReps} onChange={event => setActualReps(event.target.value)} placeholder="Não informado" disabled={loading} /></label>
            <label>Carga externa total (kg) <span>(opcional)</span><input type="number" inputMode="decimal" min="0" max="1000" step="any" value={actualLoad} onChange={event => setActualLoad(event.target.value)} placeholder="Não informada" disabled={loading} /></label>
          </div>
          <p className="workout-set-hint">Some os pesos usados. Seu peso corporal não entra nessa carga. Os valores planejados não serão registrados como realizados.</p>
          <div className="workout-set-buttons"><button type="button" className="is-primary" onClick={saveSetResults} disabled={loading}><Check size={17} />Salvar resultados</button><button type="button" onClick={() => { setResultSetId(null); setActualReps(''); setActualLoad(''); setRecordNotice('Série mantida sem repetições ou carga informadas.'); }} disabled={loading}>Deixar sem informar</button></div>
        </> : <button type="button" className="workout-set-start is-primary" onClick={startSet} disabled={loading || session.isPaused || !ownsSession}><Play size={17} />{session.isPaused ? 'Retome o treino para iniciar uma série' : 'Iniciar série'}</button>}
        {recordedSets.length > 0 ? <ol className="workout-set-results">{recordedSets.slice(-4).map((set, index) => <li key={set.id}><b>Série {Math.max(0, recordedSets.length - 4) + index + 1}</b><span>{set.reps === null ? 'Repetições não informadas' : `${set.reps} repetições`}</span><span>{set.loadKg === null ? 'Carga não informada' : `${set.loadKg.toLocaleString('pt-BR')} kg externos`}</span></li>)}</ol> : null}
        {recordNotice ? <p className="workout-set-notice" role="status">{recordNotice}</p> : null}
        {recordError ? <p className="workout-set-error" role="alert">{recordError}</p> : null}
      </section>

      {nextExercise ? <article className="workout-live-next"><OfficialExerciseMedia exercise={nextExercise} className="workout-live-next-media" /><div className="workout-live-next-copy"><small>PRÓXIMO EXERCÍCIO</small><h2>{nextExercise.name}</h2><span>{OFFICIAL_MUSCLE_GROUP_LABELS[nextExercise.muscleGroup].toLocaleUpperCase('pt-BR')}</span><em>{nextExercise.planned ? `${nextExercise.planned.sets} séries · ${nextExercise.planned.repsMin}–${nextExercise.planned.repsMax} reps` : 'Plano selecionado'}</em></div></article> : null}

      <div className="workout-live-list-head"><h2>TREINO DE HOJE</h2><span>{exercises.length} exercícios</span></div>
      <div className="workout-live-list">
        {exercises.map((exercise, index) => {
          const completed = progress.completedIds.includes(exercise.id);
          const active = index === progress.activeIndex && !completed;
          return <button key={exercise.id} className={active ? 'is-active' : ''} onClick={() => { if (index !== progress.activeIndex) interruptOpenSet(); setProgress((current) => ({ ...current, activeIndex: index })); }}>
            <OfficialExerciseMedia exercise={exercise} className="workout-live-list-media" /><b>{index + 1}</b><span><strong>{exercise.name}</strong><small>{OFFICIAL_MUSCLE_GROUP_LABELS[exercise.muscleGroup].toLocaleUpperCase('pt-BR')} · {exercise.planned ? `${exercise.planned.sets} séries · ${exercise.planned.repsMin}–${exercise.planned.repsMax}` : 'Plano selecionado'}</small></span><i className={completed ? 'is-complete' : active ? 'is-current' : ''}>{completed ? <Check /> : active ? <Play /> : null}</i><em>{completed ? 'Concluído' : active ? 'Selecionado' : 'Pendente'}</em><ChevronRight />
          </button>;
        })}
      </div>
    </> : <article className="workout-library-pending"><h2>EXERCÍCIOS NÃO ENCONTRADOS</h2><p>Não foi possível localizar exercícios do plano para {session.muscleGroup || 'este grupo muscular'} no catálogo atual. O treino continua registrando tempo e sensores normalmente.</p></article>}

    <footer className="workout-live-actions"><button className="is-finish" onClick={() => { interruptOpenSet(); onEnd(); }} disabled={loading}><Square />{loading ? 'FINALIZANDO…' : 'FINALIZAR TREINO'}</button>{onTogglePause ? <button className="is-pause" onClick={() => { if (!session.isPaused) interruptOpenSet(); onTogglePause(); }} disabled={loading}>{session.isPaused ? <Play /> : <Pause />}{session.isPaused ? 'RETOMAR TREINO' : 'PAUSAR TREINO'}</button> : null}</footer>
  </section>;
}
