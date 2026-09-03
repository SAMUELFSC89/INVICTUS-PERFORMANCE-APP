import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, ArrowLeft, Check, ChevronRight, Flame, HeartPulse, MoreVertical, Pause, Play, Square } from 'lucide-react';
import type { ActivitySession } from '../types';
import { OFFICIAL_EXERCISES_BATCH_01 } from '../data/exerciseCatalog';
import { InvictusLogo } from './InvictusLogo';
import { activityService } from '../services/activityService';

const formatElapsed = (seconds: number) => `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor(seconds % 3600 / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;

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
    const catalogGroup = normalizedGroup.includes('peito') ? 'peito' : normalizedGroup.includes('costa') ? 'costas' : normalizedGroup.includes('perna') ? 'pernas' : null;
    return catalogGroup ? OFFICIAL_EXERCISES_BATCH_01.filter((exercise) => exercise.muscleGroup === catalogGroup).slice(0, 6).map(exercise => ({ ...exercise, planned: undefined })) : [];
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
  const [demoNotice, setDemoNotice] = useState(false);

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(progress));
  }, [progress, storageKey]);

  useEffect(() => {
    // A planned list is only an intention. The backend receives this signal
    // after the athlete completes at least one exercise, which improves the
    // musculação audit without inventing execution just because a plan exists.
    activityService.setHasExercises(progress.completedIds.length > 0);
  }, [progress.completedIds.length]);

  const currentExercise = exercises[progress.activeIndex];
  const nextExercise = exercises[progress.activeIndex + 1];
  const calories = Number(session.healthTelemetry?.calories ?? session.smartwatchData?.calories);
  const heartRate = Number(session.healthTelemetry?.avgHeartRate ?? session.smartwatchData?.avgHeartRate ?? session.smartwatchData?.heartRate);

  const completeCurrent = () => {
    if (!currentExercise) return;
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
      <article><HeartPulse /><b>{Number.isFinite(heartRate) && heartRate > 0 ? Math.round(heartRate) : '—'}</b><span>bpm</span></article>
    </div>

    {endError ? <div className="challenge-flow-end-error"><AlertCircle /><span>{endError}</span></div> : null}

    {currentExercise ? <>
      <article className="workout-live-current" style={{ backgroundImage: `linear-gradient(90deg,rgba(7,7,6,.98) 0%,rgba(7,7,6,.82) 38%,rgba(7,7,6,.08) 75%),url(${currentExercise.thumbUrl})` }}>
        <div><small>EXERCÍCIO ATUAL</small><h1>{currentExercise.name}</h1><span>{currentExercise.muscleGroup.toUpperCase()}</span><em>{currentExercise.planned ? `${currentExercise.planned.sets} séries · ${currentExercise.planned.repsMin}–${currentExercise.planned.repsMax} reps` : 'Plano selecionado'}</em></div>
        <button onClick={() => setDemoNotice(true)} aria-label={`Ver execução de ${currentExercise.name}`}><Play /><span>VER EXECUÇÃO</span></button>
      </article>
      {demoNotice ? <p className="workout-demo-notice" role="status">A demonstração será liberada após revisão técnica do vídeo. A imagem identifica o exercício e não substitui orientação profissional.</p> : null}

      {nextExercise ? <article className="workout-live-next" style={{ backgroundImage: `linear-gradient(90deg,rgba(8,8,7,.98),rgba(8,8,7,.48)),url(${nextExercise.thumbUrl})` }}><div><small>PRÓXIMO EXERCÍCIO</small><h2>{nextExercise.name}</h2><span>{nextExercise.muscleGroup.toUpperCase()}</span><em>{nextExercise.planned ? `${nextExercise.planned.sets} séries · ${nextExercise.planned.repsMin}–${nextExercise.planned.repsMax} reps` : 'Plano selecionado'}</em></div></article> : null}

      <div className="workout-live-list-head"><h2>TREINO DE HOJE</h2><span>{exercises.length} exercícios</span></div>
      <div className="workout-live-list">
        {exercises.map((exercise, index) => {
          const completed = progress.completedIds.includes(exercise.id);
          const active = index === progress.activeIndex && !completed;
          return <button key={exercise.id} className={active ? 'is-active' : ''} onClick={() => setProgress((current) => ({ ...current, activeIndex: index }))}>
            <img src={exercise.thumbUrl} alt="" /><b>{index + 1}</b><span><strong>{exercise.name}</strong><small>{exercise.muscleGroup.toUpperCase()} · {exercise.planned ? `${exercise.planned.sets} séries · ${exercise.planned.repsMin}–${exercise.planned.repsMax}` : 'Plano selecionado'}</small></span><i className={completed ? 'is-complete' : active ? 'is-current' : ''}>{completed ? <Check /> : active ? <Play /> : null}</i><em>{completed ? 'Concluído' : active ? 'Em andamento' : 'Pendente'}</em><ChevronRight />
          </button>;
        })}
      </div>
    </> : <article className="workout-library-pending"><h2>BIBLIOTECA EM PREPARAÇÃO</h2><p>Os assets oficiais para {session.muscleGroup || 'este grupo muscular'} ainda não foram aprovados. O treino continua registrando tempo e sensores normalmente.</p></article>}

    <footer className="workout-live-actions"><button className="is-finish" onClick={onEnd} disabled={loading}><Square />{loading ? 'FINALIZANDO…' : 'FINALIZAR TREINO'}</button>{onTogglePause ? <button className="is-pause" onClick={onTogglePause} disabled={loading}>{session.isPaused ? <Play /> : <Pause />}{session.isPaused ? 'RETOMAR TREINO' : 'PAUSAR TREINO'}</button> : null}</footer>
  </section>;
}
