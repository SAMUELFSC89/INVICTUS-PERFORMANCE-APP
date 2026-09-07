import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, ArrowRight, Brain, CalendarDays, Check, ChevronRight, Clock3,
  Dumbbell, Info, ListFilter, Pencil, Play, Plus,
  Search, ShieldCheck, Sparkles, Target, Trophy, UserRound
} from 'lucide-react';
import { OfficialExerciseMedia } from '../components/OfficialExerciseMedia';
import { InvictusLogo } from '../components/InvictusLogo';
import { useUser } from '../UserContext';
import { OFFICIAL_EXERCISES_BATCH_01, OFFICIAL_EXERCISE_BY_ID, OFFICIAL_MUSCLE_GROUP_LABELS, type OfficialMuscleGroup, isOfficialExerciseCompatible } from '../data/exerciseCatalog';
import {
  MAX_MANUAL_EXERCISES_PER_WORKOUT,
  areAllManualWorkoutsConfigured,
  isManualWorkoutConfigured,
  manualExerciseAddDecision,
  manualPlanExceedsExerciseLimit,
} from '../core/training/manualWorkoutRules';
import { workoutPlanService } from '../services/workoutPlanService';
import { activityService } from '../services/activityService';
import type { ActivityCompetitionPolicy } from '../types';
import type { PlannedExercise, PlannedWorkout, WorkoutPlan, WorkoutPlanAnswers, WorkoutPlanDraft } from '../types/workoutPlan';
import './Musculation.css';
import './MusculationAi.css';
import './MusculationManualFeedback.css';

type View = 'hub' | 'manual' | 'ai' | 'ai-processing' | 'ai-success' | 'plan' | 'workout';
type ManualDraft = WorkoutPlanDraft & { step: number; selectedWorkout: number };
type AiDraft = WorkoutPlanAnswers & { step: number };

const MIN_PLAN_COMMITMENT_DAYS = 30;
function daysSince(iso: string): number {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return MIN_PLAN_COMMITMENT_DAYS;
  return Math.floor((Date.now() - then) / 86400000);
}

const weekdays = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];
const weekdayLong = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const equipmentOptions = [
  ['barra_anilhas', 'BARRA E ANILHAS'], ['halteres', 'HALTERES'], ['maquinas', 'APARELHOS DE MUSCULAÇÃO'],
  ['kettlebell', 'KETTLEBELL'], ['barra_fixa', 'BARRA FIXA'], ['elasticos', 'ELÁSTICOS'],
  ['banco', 'BANCO DE MUSCULAÇÃO'], ['crossover', 'CROSSOVER']
] as const;

const availableAiExerciseCount = (equipment: string[]) => OFFICIAL_EXERCISES_BATCH_01.filter((exercise) =>
  isOfficialExerciseCompatible(exercise.id, equipment)
).length;

const emptyWorkout = (index: number): PlannedWorkout => ({
  id: `workout_${index + 1}`,
  name: `Treino ${String.fromCharCode(65 + index)}`,
  focus: '',
  weekdays: [Math.min(6, index + 1)],
  exercises: []
});

const initialManual = (): ManualDraft => ({
  step: 1, selectedWorkout: 0, name: '', description: '', source: 'manual', objective: 'Treino personalizado',
  durationMinutes: 60, daysPerWeek: 4, workouts: [0, 1, 2, 3].map(emptyWorkout)
});

const initialAi = (): AiDraft => ({
  step: 1,
  secondaryGoals: [],
  equipment: [],
  accessories: [],
  preferences: [],
  restrictions: [],
  availableWeekdays: []
});

function Header({ onBack, info = true }: { onBack?: () => void; info?: boolean }) {
  return <header className="mus-header">
    {onBack ? <button aria-label="Voltar" onClick={onBack}><ArrowLeft /></button> : <span />}
    <div><InvictusLogo size={44} /><b>INVICTUS</b><small>PERFORMANCE</small></div>
    {info ? <button aria-label="Informações sobre a musculação" onClick={() => window.dispatchEvent(new CustomEvent('invictus:musculation-info'))}><Info /></button> : <span />}
  </header>;
}

function Footer({ navigate }: { navigate: ReturnType<typeof useNavigate> }) {
  return <nav className="mus-footer" aria-label="Navegação principal">
    <button onClick={() => navigate('/')}><InvictusLogo size={25} /><span>Início</span></button>
    <button onClick={() => navigate('/championships')}><Trophy /><span>Campeonatos</span></button>
    <button className="is-plus" onClick={() => navigate('/activity')} aria-label="Escolher modalidade"><Plus /></button>
    <button onClick={() => navigate('/challenges')}><ShieldCheck /><span>Desafios</span></button>
    <button onClick={() => navigate('/profile')}><UserRound /><span>Perfil</span></button>
  </nav>;
}

function Steps({ current, mode }: { current: number; mode: 'manual' | 'ai' }) {
  const labels = mode === 'manual'
    ? ['Dados do treino', 'Divisão semanal', 'Exercícios', 'Revisão', 'Salvar treino']
    : ['Objetivo', 'Experiência', 'Rotina', 'Equipamentos', 'Preferências'];
  return <div className="mus-steps">{labels.map((label, index) => {
    const step = index + 1;
    return <div className={step === current ? 'is-current' : step < current ? 'is-done' : ''} key={label}>
      <i>{step < current ? <Check /> : step}</i><span>{step}</span><b>{label}</b>
    </div>;
  })}</div>;
}

function Choice({ selected, onClick, icon, title, detail }: { selected: boolean; onClick: () => void; icon?: React.ReactNode; title: string; detail?: string }) {
  return <button type="button" className={`mus-choice ${selected ? 'is-selected' : ''}`} onClick={onClick}>
    {icon}<strong>{title}</strong>{detail ? <span>{detail}</span> : null}<i>{selected ? <Check /> : null}</i>
  </button>;
}

function ExerciseRow({ exerciseId, onAdd, added = false, addDisabled = false }: { exerciseId: string; onAdd?: () => void; added?: boolean; addDisabled?: boolean }) {
  const exercise = OFFICIAL_EXERCISE_BY_ID.get(exerciseId);
  if (!exercise) return null;
  const disabled = added || addDisabled;
  const addLabel = added
    ? `${exercise.name} adicionado ao treino`
    : addDisabled
      ? `Limite de ${MAX_MANUAL_EXERCISES_PER_WORKOUT} exercícios atingido neste treino`
      : `Adicionar ${exercise.name}`;
  return <article className="mus-exercise-row">
    <OfficialExerciseMedia exercise={exercise} className="mus-exercise-media" />
    <div><strong>{exercise.name}</strong><span>{exercise.muscleSubgroup === 'biceps' ? 'Bíceps' : exercise.muscleSubgroup === 'triceps' ? 'Tríceps' : OFFICIAL_MUSCLE_GROUP_LABELS[exercise.muscleGroup]}</span></div>
    {onAdd ? <button type="button" className={added ? 'is-added' : ''} aria-label={addLabel} title={addLabel} onClick={onAdd} disabled={disabled}>{added ? <Check /> : <Plus />}</button> : null}
  </article>;
}

export function Musculation() {
  const navigate = useNavigate();
  const { user } = useUser();
  const [view, setView] = useState<View>('hub');
  const [plans, setPlans] = useState<WorkoutPlan[]>([]);
  const [selectedPlan, setSelectedPlan] = useState<WorkoutPlan | null>(null);
  const [selectedWorkout, setSelectedWorkout] = useState<PlannedWorkout | null>(null);
  const [manual, setManual] = useState<ManualDraft>(() => workoutPlanService.loadDraft<ManualDraft>() || initialManual());
  const [ai, setAi] = useState<AiDraft>(initialAi);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'todos' | OfficialMuscleGroup | 'biceps' | 'triceps'>('todos');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const [startPolicy, setStartPolicy] = useState<ActivityCompetitionPolicy | null>(null);
  const [policyLoading, setPolicyLoading] = useState(false);
  const [pendingNewPlanFlow, setPendingNewPlanFlow] = useState<'manual' | 'ai' | null>(null);

  useEffect(() => {
    let active = true;
    workoutPlanService.list().then(data => {
      if (!active) return;
      setPlans(data); setSelectedPlan(data.find(plan => plan.status === 'active') || data[0] || null);
    }).catch(err => active && setError(err.message)).finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!user?.uid) return;
    let active = true;
    setPolicyLoading(true);
    activityService.resolveCompetitionPolicy('workout')
      .then((policy) => { if (active) setStartPolicy(policy); })
      .catch((reason) => { if (active) setError(reason.message || 'Não foi possível preparar o início do treino.'); })
      .finally(() => { if (active) setPolicyLoading(false); });
    return () => { active = false; };
  }, [user?.uid]);

  useEffect(() => { if (view === 'manual') workoutPlanService.saveDraft(manual); }, [manual, view]);

  useEffect(() => {
    const openInfo = () => setShowInfo(true);
    window.addEventListener('invictus:musculation-info', openInfo);
    return () => window.removeEventListener('invictus:musculation-info', openInfo);
  }, []);

  const activePlan = selectedPlan || plans.find(plan => plan.status === 'active') || null;
  const activePlanAgeDays = activePlan ? daysSince(activePlan.createdAt) : null;
  const activePlanLocked = activePlanAgeDays !== null && activePlanAgeDays < MIN_PLAN_COMMITMENT_DAYS;
  const activePlanDaysRemaining = activePlanLocked ? MIN_PLAN_COMMITMENT_DAYS - (activePlanAgeDays as number) : 0;
  const startNewPlanFlow = (flow: 'manual' | 'ai') => {
    if (activePlanLocked) { setPendingNewPlanFlow(flow); return; }
    if (flow === 'manual') { setManual(initialManual()); setView('manual'); }
    else { setAi(initialAi()); setView('ai'); }
  };
  const confirmNewPlanFlow = () => {
    const flow = pendingNewPlanFlow;
    setPendingNewPlanFlow(null);
    if (flow === 'manual') { setManual(initialManual()); setView('manual'); }
    else if (flow === 'ai') { setAi(initialAi()); setView('ai'); }
  };
  const todayWorkout = useMemo(() => {
    if (!activePlan) return null;
    const today = new Date().getDay();
    return activePlan.workouts.find(workout => workout.weekdays.includes(today)) || activePlan.workouts[0] || null;
  }, [activePlan]);
  const filteredExercises = useMemo(() => OFFICIAL_EXERCISES_BATCH_01.filter(exercise =>
    (filter === 'todos' || exercise.muscleGroup === filter || exercise.muscleSubgroup === filter) && exercise.name.toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR'))
  ), [filter, query]);

  const updateManualWorkout = (index: number, next: Partial<PlannedWorkout>) => setManual(current => ({
    ...current, workouts: current.workouts.map((workout, workoutIndex) => workoutIndex === index ? { ...workout, ...next } : workout)
  }));
  const addExercise = (exerciseId: string) => {
    setManual(current => {
      const index = current.selectedWorkout;
      const workout = current.workouts[index];
      if (!workout || manualExerciseAddDecision(workout, exerciseId) !== 'allowed') return current;
      const exercise: PlannedExercise = { exerciseId, order: workout.exercises.length, sets: 4, repsMin: 8, repsMax: 12, restSeconds: 90 };
      return {
        ...current,
        workouts: current.workouts.map((item, workoutIndex) => workoutIndex === index
          ? { ...item, exercises: [...item.exercises, exercise] }
          : item),
      };
    });
  };
  const updateExercise = (exerciseIndex: number, next: Partial<PlannedExercise>) => {
    const workout = manual.workouts[manual.selectedWorkout];
    updateManualWorkout(manual.selectedWorkout, { exercises: workout.exercises.map((exercise, index) => index === exerciseIndex ? { ...exercise, ...next } : exercise) });
  };

  const saveManual = async () => {
    setError(null);
    if (!areAllManualWorkoutsConfigured(manual.workouts)) {
      setError('Adicione pelo menos um exercício em cada treino/dia antes de salvar o plano.');
      return;
    }
    if (manualPlanExceedsExerciseLimit(manual.workouts)) {
      setError(`Cada treino pode ter no máximo ${MAX_MANUAL_EXERCISES_PER_WORKOUT} exercícios.`);
      return;
    }
    setLoading(true);
    try {
      const rationale = `Treino manual configurado por você: ${manual.daysPerWeek} dia(s) por semana com foco em ${manual.objective.toLowerCase()}${manual.experienceLevel ? `, nível ${manual.experienceLevel.toLowerCase()}` : ''}. Ajuste séries, repetições e descanso sempre que quiser evoluir a carga.`;
      const saved = await workoutPlanService.save({ ...manual, rationale, workouts: manual.workouts.filter(workout => workout.exercises.length) });
      setPlans(current => [saved, ...current]); setSelectedPlan(saved); setView('plan');
    } catch (err: any) { setError(err.message); } finally { setLoading(false); }
  };
  const generateAi = async () => {
    setError(null); setView('ai-processing');
    try {
      const athleteProfile = user ? {
        age: user.age,
        weightKg: user.weight,
        heightCm: user.height,
        sex: user.sex
      } : undefined;
      const generated = await workoutPlanService.generate({ ...ai, athleteProfile });
      const saved = await workoutPlanService.save(generated);
      setPlans(current => [saved, ...current]); setSelectedPlan(saved); setView('ai-success');
    } catch (err: any) { setError(err.message); setView('ai'); }
  };
  const startWorkout = async (plan: WorkoutPlan, workout: PlannedWorkout) => {
    const policy = startPolicy;
    if (!policy || Date.parse(policy.startBy) < Date.now()) {
      setPolicyLoading(true);
      setError('Estamos renovando a autorização do treino. Quando a mensagem sumir, toque em iniciar novamente.');
      try {
        setStartPolicy(await activityService.resolveCompetitionPolicy('workout'));
        setError(null);
      } catch (err: any) {
        setError(err.message || 'Não foi possível preparar o treino.');
      } finally {
        setPolicyLoading(false);
      }
      return;
    }
    const motionPermission = policy.requiresMotionSensors
      ? activityService.requestMotionPermission()
      : Promise.resolve('granted' as const);
    setLoading(true); setError(null);
    try {
      await motionPermission;
      const checkIn = policy.requiresGymCheckIn
        ? await activityService.performGymCheckIn(policy)
        : undefined;
      await activityService.startSession('workout', checkIn?.location, undefined, undefined, checkIn?.checkInId, workout.focus || 'Musculação', {
        workoutPlanId: plan.id, workoutId: workout.id, plannedExercises: workout.exercises
      }, policy);
      navigate('/challenges', { replace: true });
    } catch (err: any) { setError(err.message); } finally { setLoading(false); }
  };

  const content = <main className="mus-screen"><div className="mus-page">
    {view === 'hub' ? <Hub userName={user?.displayName || user?.name || 'Atleta'} plan={activePlan} today={todayWorkout} loading={loading || policyLoading} planLocked={activePlanLocked} planDaysRemaining={activePlanDaysRemaining} onManual={() => startNewPlanFlow('manual')} onAi={() => startNewPlanFlow('ai')} onPlan={() => setView('plan')} onWorkout={(workout) => { setSelectedWorkout(workout); setView('workout'); }} onStart={() => activePlan && todayWorkout && startWorkout(activePlan, todayWorkout)} /> : null}
    {view === 'manual' ? <ManualFlow draft={manual} setDraft={setManual} query={query} setQuery={setQuery} filter={filter} setFilter={setFilter} filteredExercises={filteredExercises} addExercise={addExercise} updateExercise={updateExercise} updateWorkout={updateManualWorkout} onBack={() => manual.step > 1 ? setManual(current => ({ ...current, step: current.step - 1 })) : setView('hub')} onSave={saveManual} loading={loading} /> : null}
    {view === 'ai' ? <AiFlow draft={ai} setDraft={setAi} onBack={() => ai.step > 1 ? setAi(current => ({ ...current, step: current.step - 1 })) : setView('hub')} onGenerate={generateAi} /> : null}
    {view === 'ai-processing' ? <Processing answers={ai} /> : null}
    {view === 'ai-success' && activePlan ? <AiSuccess plan={activePlan} onReview={() => setView('ai')} onPlan={() => setView('plan')} /> : null}
    {view === 'plan' && activePlan ? <PlanView plan={activePlan} onBack={() => setView('hub')} onWorkout={(workout) => { setSelectedWorkout(workout); setView('workout'); }} /> : null}
    {view === 'workout' && activePlan && selectedWorkout ? <WorkoutView plan={activePlan} workout={selectedWorkout} onBack={() => setView('plan')} onStart={() => startWorkout(activePlan, selectedWorkout)} loading={loading || policyLoading} /> : null}
    {error ? <div className="mus-error" role="alert">{error}<button onClick={() => setError(null)}>Fechar</button></div> : null}
    {showInfo ? <div className="mus-info-overlay" role="dialog" aria-modal="true" aria-labelledby="mus-info-title" onClick={() => setShowInfo(false)}><section onClick={event => event.stopPropagation()}><ShieldCheck /><h2 id="mus-info-title">COMO FUNCIONA</h2><p>Crie ou escolha um plano e registre a sessão completa. Todo treino concluído alimenta sua evolução, XP e desafios. A verificação de segurança só é aplicada quando você participa de ranking ou campeonato.</p><button onClick={() => setShowInfo(false)}>ENTENDI</button></section></div> : null}
    {pendingNewPlanFlow ? <div className="mus-info-overlay" role="dialog" aria-modal="true" aria-labelledby="mus-lock-title" onClick={() => setPendingNewPlanFlow(null)}><section onClick={event => event.stopPropagation()}><CalendarDays /><h2 id="mus-lock-title">TROCAR DE TREINO?</h2><p>Seu plano atual está ativo há {(activePlanAgeDays ?? 0)} {(activePlanAgeDays ?? 0) === 1 ? 'dia' : 'dias'} -- faltam {activePlanDaysRemaining} para completar o período mínimo recomendado de {MIN_PLAN_COMMITMENT_DAYS} dias, necessário para o corpo se adaptar e você ver evolução real. Criar um novo treino agora vai substituir o atual. Deseja continuar mesmo assim?</p><button onClick={() => setPendingNewPlanFlow(null)}>MANTER TREINO ATUAL</button><button className="is-back" onClick={confirmNewPlanFlow}>CONTINUAR MESMO ASSIM</button></section></div> : null}
  </div><Footer navigate={navigate} /></main>;
  return createPortal(content, document.body);
}

function Hub({ userName, plan, today, loading, planLocked, planDaysRemaining, onManual, onAi, onPlan, onWorkout, onStart }: any) {
  return <><Header /><section className="mus-hero"><div><h1>MUSCULAÇÃO</h1><p>Organize seus treinos, acompanhe sua evolução e supere seus limites.</p></div></section>
    {plan && today ? <section><h2 className="mus-section-title"><CalendarDays /> TREINO DE HOJE</h2><article className="mus-today-card">
      {today.exercises[0] ? <OfficialExerciseMedia exercise={OFFICIAL_EXERCISE_BY_ID.get(today.exercises[0].exerciseId)} label={today.exercises[0].exerciseId} className="mus-today-media" /> : null}
      <div><h3>{today.focus || today.name}</h3><span>{today.name}</span><p><Dumbbell /> {today.exercises.length} exercícios</p><p><Clock3 /> ~{plan.durationMinutes} min</p><button onClick={onStart} disabled={loading}><Play />{loading ? 'INICIANDO…' : 'INICIAR TREINO'}</button></div>
    </article></section> : <section className="mus-empty-plan"><h2>COMECE SEU PLANO</h2><p>{userName.split(' ')[0]}, escolha como deseja montar seus treinos.</p></section>}
    {plan ? <section><div className="mus-title-line"><h2>MEUS TREINOS</h2><button onClick={onPlan}>VER TODOS <ChevronRight /></button></div><div className="mus-workout-list">{plan.workouts.map((workout: PlannedWorkout, index: number) => <button key={workout.id} onClick={() => onWorkout(workout)}><i>{String.fromCharCode(65 + index)}</i><span><b>{workout.name}</b><small>{workout.focus}</small></span><em>{workout.exercises.length} exercícios</em><ChevronRight /></button>)}</div></section> : null}
    <section><h2 className="mus-section-title">CRIAR NOVO TREINO</h2>
      {planLocked ? <p className="mus-plan-lock-note"><CalendarDays size={14} /> Seu treino atual ainda está no período mínimo de {MIN_PLAN_COMMITMENT_DAYS} dias (faltam {planDaysRemaining} {planDaysRemaining === 1 ? 'dia' : 'dias'}). Você pode criar um novo mesmo assim, mas trocar cedo demais atrapalha a adaptação do corpo.</p> : null}
      <div className="mus-create-grid"><article><Brain /><h3>GERAR COM IA</h3><p>Responda algumas perguntas e receba um treino completo feito para você.</p><button onClick={onAi}>GERAR MEU TREINO <ChevronRight /></button></article><article><Pencil /><h3>CRIAR MANUALMENTE</h3><p>Monte seu treino escolhendo exercícios, séries, repetições, cargas e descansos.</p><button onClick={onManual}>MONTAR TREINO <ChevronRight /></button></article></div></section>
  </>;
}

function ManualFlow({ draft, setDraft, query, setQuery, filter, setFilter, filteredExercises, addExercise, updateExercise, updateWorkout, onBack, onSave, loading }: any) {
  const workout = draft.workouts[draft.selectedWorkout];
  const allWorkoutsConfigured = areAllManualWorkoutsConfigured(draft.workouts);
  const missingWorkoutCount = draft.workouts.filter((item: PlannedWorkout) => !isManualWorkoutConfigured(item)).length;
  const workoutConfigured = isManualWorkoutConfigured(workout);
  const workoutAtLimit = workout.exercises.length >= MAX_MANUAL_EXERCISES_PER_WORKOUT;
  const selectedExerciseIds = new Set(workout.exercises.map((exercise: PlannedExercise) => exercise.exerciseId));
  const manualCanContinue = draft.step === 1 ? Boolean(draft.name.trim()) : draft.step === 3 ? allWorkoutsConfigured : true;
  const next = () => {
    if (!manualCanContinue) return;
    setDraft((current: ManualDraft) => ({ ...current, step: Math.min(5, current.step + 1) }));
  };
  const [confirmCommitment, setConfirmCommitment] = useState(false);
  return <><Header onBack={onBack} /><Steps current={draft.step} mode="manual" /><section className="mus-flow">
    {draft.step === 1 ? <><h1>CRIAR MANUALMENTE</h1><p>Monte seu treino escolhendo exercícios, séries, repetições, cargas e descansos.</p><h2>1. DADOS DO TREINO</h2><div className="mus-form-card"><label>NOME DO PLANO<input maxLength={60} value={draft.name} placeholder="Ex.: Meu plano de hipertrofia" onChange={event => setDraft({ ...draft, name: event.target.value })} /></label><label>DESCRIÇÃO (OPCIONAL)<textarea maxLength={240} value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })} /></label></div><h2>2. CONFIGURAÇÕES DO TREINO</h2><div className="mus-setting-grid"><label>DIAS POR SEMANA<div>{[1,2,3,4,5,6].map(n => <button key={n} className={draft.daysPerWeek === n ? 'is-selected' : ''} onClick={() => setDraft({ ...draft, daysPerWeek: n, workouts: Array.from({length:n}, (_,i) => draft.workouts[i] || emptyWorkout(i)), selectedWorkout: Math.min(draft.selectedWorkout, n - 1) })}>{n}</button>)}</div></label><label>TEMPO ESTIMADO<div>{[30,45,60,90].map(n => <button key={n} className={draft.durationMinutes === n ? 'is-selected' : ''} onClick={() => setDraft({ ...draft, durationMinutes: n })}>{n}{n === 90 ? '+' : ''} min</button>)}</div></label><label>NÍVEL DO TREINO<select value={draft.experienceLevel || ''} onChange={event => setDraft({ ...draft, experienceLevel: event.target.value })}><option value="">Selecione</option><option>Iniciante</option><option>Intermediário</option><option>Avançado</option></select></label><label>OBJETIVO PRINCIPAL<select value={draft.objective} onChange={event => setDraft({ ...draft, objective: event.target.value })}><option>Hipertrofia</option><option>Força</option><option>Condicionamento</option><option>Saúde e qualidade de vida</option></select></label></div></> : null}
    {draft.step === 2 ? <><h1>2. DIVISÃO SEMANAL</h1><p>Defina quantos treinos e como eles serão distribuídos na semana.</p><div className="mus-form-card"><h3>SELECIONE OS DIAS DE CADA TREINO</h3>{draft.workouts.map((item: PlannedWorkout, index: number) => <article className="mus-split-row" key={item.id}><i>{index + 1}</i><input value={item.name} onChange={event => updateWorkout(index, { name: event.target.value })} /><input placeholder="Grupo muscular" value={item.focus} onChange={event => updateWorkout(index, { focus: event.target.value })} /><div>{weekdays.map((day, dayIndex) => <button key={day} className={item.weekdays.includes(dayIndex) ? 'is-selected' : ''} onClick={() => updateWorkout(index, { weekdays: item.weekdays.includes(dayIndex) ? item.weekdays.filter((n:number) => n !== dayIndex) : [...item.weekdays, dayIndex] })}>{day}</button>)}</div></article>)}</div></> : null}
    {draft.step === 3 ? <><h1>3. EXERCÍCIOS</h1><p>Adicione os exercícios e configure séries, repetições e descanso. Cada treino aceita até {MAX_MANUAL_EXERCISES_PER_WORKOUT} exercícios.</p><div className="mus-workout-tabs">{draft.workouts.map((item: PlannedWorkout, index: number) => { const configured = isManualWorkoutConfigured(item); return <button key={item.id} className={`${draft.selectedWorkout === index ? 'is-selected' : ''} ${configured ? 'is-complete' : ''}`.trim()} onClick={() => setDraft({ ...draft, selectedWorkout: index })} aria-label={`${item.name}: ${item.exercises.length} de ${MAX_MANUAL_EXERCISES_PER_WORKOUT} exercícios${configured ? ', configurado' : ', ainda sem exercícios'}`}><span>{item.name}{configured ? <Check className="mus-workout-tab-check" aria-hidden="true" /> : null}</span><small>{item.exercises.length}/{MAX_MANUAL_EXERCISES_PER_WORKOUT}</small></button>; })}</div><div className={`mus-manual-workout-status ${workoutConfigured ? 'is-confirmed' : ''} ${workoutAtLimit ? 'is-limit' : ''}`} role="status" aria-live="polite"><span><b>{workout.name}</b>{workout.exercises.length} de {MAX_MANUAL_EXERCISES_PER_WORKOUT} exercícios adicionados</span><i>{workoutConfigured ? <Check /> : <Plus />}</i></div>{workoutAtLimit ? <p className="mus-manual-limit-note">Limite atingido neste treino. Selecione o próximo treino/dia acima para continuar.</p> : workoutConfigured ? <p className="mus-manual-limit-note">{workout.name} confirmado. Você pode continuar adicionando ou tocar no próximo treino/dia acima.</p> : null}<div className="mus-library"><div className="mus-search"><Search /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar exercício na biblioteca" /><ListFilter /></div><div className="mus-filters">{[['todos','Todos'],...Object.entries(OFFICIAL_MUSCLE_GROUP_LABELS),['biceps','Bíceps'],['triceps','Tríceps']].map(([item,label]) => <button key={item} className={filter === item ? 'is-selected' : ''} onClick={() => setFilter(item)}>{label}</button>)}</div>{filteredExercises.map((exercise: any) => { const added = selectedExerciseIds.has(exercise.id); return <ExerciseRow key={exercise.id} exerciseId={exercise.id} added={added} addDisabled={workoutAtLimit && !added} onAdd={() => addExercise(exercise.id)} />; })}</div><h2>EXERCÍCIOS ADICIONADOS</h2><div className="mus-configured">{workout.exercises.map((exercise: PlannedExercise, index: number) => <article key={exercise.exerciseId}><ExerciseRow exerciseId={exercise.exerciseId} /><label>Séries<input type="number" value={exercise.sets} onChange={event => updateExercise(index, { sets: Number(event.target.value) })} /></label><label>Reps mín.<input type="number" value={exercise.repsMin} onChange={event => updateExercise(index, { repsMin: Number(event.target.value) })} /></label><label>Reps máx.<input type="number" value={exercise.repsMax} onChange={event => updateExercise(index, { repsMax: Number(event.target.value) })} /></label><label>Descanso<input type="number" value={exercise.restSeconds} onChange={event => updateExercise(index, { restSeconds: Number(event.target.value) })} /></label><label>Carga opcional<input type="number" value={exercise.initialLoadKg ?? ''} onChange={event => updateExercise(index, { initialLoadKg: event.target.value === '' ? undefined : Number(event.target.value) })} /></label></article>)}</div>{!allWorkoutsConfigured ? <p className="mus-manual-requirement" role="status"><Info /> Falta preencher {missingWorkoutCount} {missingWorkoutCount === 1 ? 'treino/dia' : 'treinos/dias'}. Toque nas abas acima e adicione pelo menos um exercício em cada uma para continuar.</p> : <p className="mus-manual-requirement" role="status"><Check /> Todos os treinos/dias receberam exercícios. Você já pode continuar para a revisão.</p>}</> : null}
    {draft.step === 4 ? <><h1>4. REVISÃO</h1><p>Confira a estrutura antes de salvar.</p>{draft.workouts.map((item: PlannedWorkout, index: number) => <article className="mus-review-card" key={item.id}><i>{String.fromCharCode(65 + index)}</i><div><h3>{item.name}</h3><p>{item.focus || 'Foco não informado'}</p><span>{item.exercises.length} exercícios · {item.exercises.reduce((sum:number, exercise:PlannedExercise) => sum + exercise.sets, 0)} séries</span></div><button onClick={() => setDraft({ ...draft, selectedWorkout:index, step:3 })}><Pencil /></button></article>)}</> : null}
    {draft.step === 5 ? <><h1>5. SALVAR TREINO</h1><p>Finalize seu treino e comece a evoluir.</p><div className="mus-final-data"><h2>DADOS FINAIS</h2><p><Dumbbell /><span>Nome do treino<b>{draft.name || 'Meu plano'}</b></span></p><p><CalendarDays /><span>Divisão<b>{draft.daysPerWeek} treinos por semana</b></span></p><p><Target /><span>Objetivo principal<b>{draft.objective}</b></span></p><p><Clock3 /><span>Tempo estimado<b>~{draft.durationMinutes} min</b></span></p></div><div className="mus-tip"><ShieldCheck /><span><b>DICA INVICTUS</b>Registre suas cargas e evolua a cada sessão.</span></div>
      <label className="mus-commitment-check"><input type="checkbox" checked={confirmCommitment} onChange={event => setConfirmCommitment(event.target.checked)} /><span>Entendo que, ao salvar, este treino ficará ativo por no mínimo {MIN_PLAN_COMMITMENT_DAYS} dias -- o tempo mínimo pro corpo se adaptar e a evolução aparecer de verdade.</span></label>
    </> : null}
    <div className="mus-flow-actions">{draft.step > 1 ? <button className="is-back" onClick={onBack}><ArrowLeft /> VOLTAR</button> : null}{draft.step < 5 ? <button className="is-primary" onClick={next} disabled={!manualCanContinue}>CONTINUAR <ArrowRight /></button> : <button className="is-primary" onClick={onSave} disabled={loading || !confirmCommitment}>{loading ? 'SALVANDO…' : 'SALVAR E IR PARA MEUS TREINOS'} <Check /></button>}</div>
  </section></>;
}

function AiFlow({ draft, setDraft, onBack, onGenerate }: any) {
  const selectArray = (key: keyof AiDraft, value: string, max = 99) => setDraft((current: AiDraft) => { const list = (current[key] as string[]) || []; return { ...current, [key]: list.includes(value) ? list.filter(item => item !== value) : list.length < max ? [...list, value] : list }; });
  const equipmentExerciseCount = availableAiExerciseCount(draft.equipment);
  const [confirmCommitment, setConfirmCommitment] = useState(false);
  const selectedWeekdays: number[] = Array.isArray(draft.availableWeekdays) ? draft.availableWeekdays : [];
  const toggleWeekday = (dayIndex: number) => setDraft((current: AiDraft) => {
    const currentDays = Array.isArray(current.availableWeekdays) ? current.availableWeekdays : [];
    if (currentDays.includes(dayIndex)) return { ...current, availableWeekdays: currentDays.filter(day => day !== dayIndex) };
    const maxDays = Math.max(1, Math.min(6, Number(current.daysPerWeek) || 6));
    if (currentDays.length >= maxDays) return current;
    return { ...current, availableWeekdays: [...currentDays, dayIndex].sort((a, b) => a - b) };
  });
  const canContinue = draft.step === 1
    ? Boolean(draft.primaryGoal)
    : draft.step === 2
      ? Boolean(draft.experienceLevel && draft.experienceTime)
      : draft.step === 3
        ? Boolean(draft.daysPerWeek && selectedWeekdays.length === draft.daysPerWeek && draft.durationMinutes && draft.preferredPeriod)
        : draft.step === 4
          ? equipmentExerciseCount >= 3
          : Boolean(draft.preferredTraining && draft.preferredSplit && confirmCommitment);
  const requirement = draft.step === 3 && draft.daysPerWeek && selectedWeekdays.length !== draft.daysPerWeek
    ? `Escolha exatamente ${draft.daysPerWeek} ${draft.daysPerWeek === 1 ? 'dia' : 'dias'} da semana para o seu plano.`
    : draft.step === 4 && draft.equipment.length > 0 && equipmentExerciseCount < 3
      ? 'Selecione uma combinação que ofereça pelo menos 3 exercícios oficiais, como banco + halteres, aparelhos ou barra + banco.'
      : draft.step === 5 && Boolean(draft.preferredTraining && draft.preferredSplit) && !confirmCommitment
        ? `Confirme que entendeu o compromisso mínimo de ${MIN_PLAN_COMMITMENT_DAYS} dias para gerar seu plano.`
        : 'Preencha as opções obrigatórias desta etapa para continuar.';
  const next = () => draft.step === 5 ? onGenerate() : setDraft((current: AiDraft) => ({ ...current, step: current.step + 1 }));
  return <><Header onBack={onBack} /><Steps current={draft.step} mode="ai" /><section className="mus-flow mus-ai-flow">
    {draft.step === 1 ? <><h1>CRIAR COM INVICTUS IA</h1><p>Responda algumas perguntas para que o Training Engine monte a base do seu treino e a Invictus IA personalize quando disponível.</p><h2>1. QUAL É O SEU PRINCIPAL OBJETIVO?</h2><div className="mus-choice-grid">{[['massa','GANHAR MASSA MUSCULAR'],['forca','GANHAR FORÇA'],['gordura','REDUZIR GORDURA CORPORAL'],['condicionamento','MELHORAR CONDICIONAMENTO'],['definicao','MELHORAR DEFINIÇÃO MUSCULAR'],['retorno','RETOMAR OS TREINOS'],['saude','SAÚDE E QUALIDADE DE VIDA']].map(([value,label]) => <Choice key={value} selected={draft.primaryGoal === value} onClick={() => setDraft({...draft,primaryGoal:value})} icon={<Target />} title={label} />)}</div><h2>OBJETIVOS SECUNDÁRIOS (OPCIONAL)</h2><div className="mus-check-grid">{['Aumentar força','Melhorar resistência','Ganhar mobilidade','Melhorar postura'].map(item => <Choice key={item} selected={draft.secondaryGoals.includes(item)} onClick={() => selectArray('secondaryGoals',item,3)} title={item} />)}</div></> : null}
    {draft.step === 2 ? <><h1>2. QUAL É A SUA EXPERIÊNCIA?</h1><p>Seu nível define o ponto de partida de volume, intensidade e complexidade. A evolução depois passa a considerar o que você realmente executa.</p><div className="mus-choice-grid is-three">{[['iniciante','INICIANTE','Nunca treinei ou estou começando'],['intermediario','INTERMEDIÁRIO','Treino com consistência'],['avancado','AVANÇADO','Tenho ampla experiência']].map(([value,title,detail]) => <Choice key={value} selected={draft.experienceLevel === value} onClick={() => setDraft({...draft,experienceLevel:value})} icon={<Dumbbell />} title={title} detail={detail} />)}</div><h2>TEMPO DE EXPERIÊNCIA</h2><div className="mus-choice-grid is-four">{['Menos de 6 meses','6 a 12 meses','1 a 3 anos','Mais de 3 anos'].map(item => <Choice key={item} selected={draft.experienceTime === item} onClick={() => setDraft({...draft,experienceTime:item})} title={item} />)}</div></> : null}
    {draft.step === 3 ? <><h1>3. QUAL É A SUA ROTINA ATUAL?</h1><p>Agora o plano usa os dias reais que você tem disponível — não cria mais uma sequência automática começando no domingo.</p><h2>QUANTOS DIAS POR SEMANA VOCÊ QUER TREINAR?</h2><div className="mus-choice-grid is-seven">{[1,2,3,4,5,6].map(n => <Choice key={n} selected={draft.daysPerWeek === n} onClick={() => setDraft((current: AiDraft) => ({...current,daysPerWeek:n,availableWeekdays:(current.availableWeekdays || []).slice(0,n)}))} title={`${n} ${n === 1 ? 'dia' : 'dias'}`} />)}</div><h2>EM QUAIS DIAS VOCÊ PODE TREINAR?</h2><div className="mus-choice-grid is-seven">{weekdayLong.map((day, dayIndex) => <Choice key={day} selected={selectedWeekdays.includes(dayIndex)} onClick={() => toggleWeekday(dayIndex)} icon={<CalendarDays />} title={weekdays[dayIndex]} detail={day} />)}</div><h2>QUANTO TEMPO POR TREINO?</h2><div className="mus-choice-grid is-four">{[[45,'Até 45 minutos'],[60,'45 a 60 minutos'],[90,'60 a 90 minutos'],[120,'Mais de 90 minutos']].map(([n,label]) => <Choice key={String(n)} selected={draft.durationMinutes === n} onClick={() => setDraft({...draft,durationMinutes:n})} title={String(label)} />)}</div><h2>HORÁRIO PREFERIDO</h2><div className="mus-choice-grid is-three">{['Manhã','Tarde','Noite'].map(item => <Choice key={item} selected={draft.preferredPeriod === item} onClick={() => setDraft({...draft,preferredPeriod:item})} icon={<Clock3 />} title={item} />)}</div></> : null}
    {draft.step === 4 ? <><h1>4. QUAIS EQUIPAMENTOS VOCÊ TEM ACESSO?</h1><p>O Training Engine limita o plano aos equipamentos que você selecionar.</p><div className="mus-choice-grid is-four">{equipmentOptions.map(([value,label]) => <Choice key={value} selected={draft.equipment.includes(value)} onClick={() => selectArray('equipment',value)} icon={<Dumbbell />} title={label} />)}</div><h2>ACESSÓRIOS (OPCIONAL)</h2><div className="mus-check-grid">{['Cinto','Munhequeira','Joelheira','Straps'].map(item => <Choice key={item} selected={draft.accessories.includes(item)} onClick={() => selectArray('accessories',item)} title={item} />)}</div></> : null}
    {draft.step === 5 ? <><h1>5. QUAIS SÃO AS SUAS PREFERÊNCIAS?</h1><p>Esses detalhes completam o perfil usado para escolher divisão e exercícios.</p><h2>TIPO DE TREINO PREFERIDO</h2><div className="mus-choice-grid is-three">{[['forca','TREINO DE FORÇA'],['funcional','TREINO FUNCIONAL'],['cardio','CONDICIONAMENTO E CARDIO']].map(([value,label]) => <Choice key={value} selected={draft.preferredTraining === value} onClick={() => setDraft({...draft,preferredTraining:value})} icon={<Dumbbell />} title={label} />)}</div><h2>DIVISÃO PREFERIDA</h2><div className="mus-choice-grid is-three">{[['Full body','Treina o corpo inteiro em cada sessão — bom pra quem tem poucos dias livres na semana.'],['Upper / Lower','Alterna treinos de membros superiores e inferiores em dias diferentes.'],['ABC (3x por semana)','Divide os grupos musculares em 3 treinos (A, B, C) repetidos ao longo da semana.'],['Bro split','Um grupo muscular principal por dia (peito, costas, pernas…), com mais volume por músculo.'],['PPL','Push, Pull, Legs — separa por empurrar, puxar e pernas, podendo repetir o ciclo na semana.'],['Outro','Sem preferência definida — o Training Engine escolhe a divisão com base nas suas outras respostas.']].map(([item,detail]) => <Choice key={item} selected={draft.preferredSplit === item} onClick={() => setDraft({...draft,preferredSplit:item})} title={item} detail={detail} />)}</div><h2>PREFERÊNCIAS ADICIONAIS</h2><div className="mus-check-grid">{['Prefiro treinos sem impacto','Quero queimar mais gordura','Tenho pouco tempo disponível','Quero treinos desafiadores'].map(item => <Choice key={item} selected={draft.preferences.includes(item)} onClick={() => selectArray('preferences',item)} title={item} />)}</div>
      <label className="mus-commitment-check"><input type="checkbox" checked={confirmCommitment} onChange={event => setConfirmCommitment(event.target.checked)} /><span>Entendo que, ao gerar, este treino ficará ativo por no mínimo {MIN_PLAN_COMMITMENT_DAYS} dias -- o tempo mínimo pro corpo se adaptar e a evolução aparecer de verdade.</span></label>
    </> : null}
    <div className="mus-ai-note"><Brain /><span><b>O TRAINING ENGINE USA:</b>Objetivo, experiência, dias reais, tempo, equipamentos, preferências e, quando relevantes, idade, peso e altura já cadastrados no seu perfil. Peso e idade nunca são usados sozinhos para inventar carga.</span></div>{!canContinue ? <p className="mus-ai-requirement" role="status">{requirement}</p> : null}<div className="mus-flow-actions"><button className="is-back" onClick={onBack}><ArrowLeft /> VOLTAR</button><button className="is-primary" onClick={next} disabled={!canContinue}>{draft.step === 5 ? 'GERAR MEU PLANO' : 'CONTINUAR'} <ArrowRight /></button></div>
  </section></>;
}

function Processing({ answers }: { answers: AiDraft }) {
  const steps = ['Definindo objetivos e prioridades','Aplicando regras de evidência','Organizando os dias reais da semana','Selecionando exercícios oficiais','Validando volume, tempo e recuperação'];
  const days = Array.isArray(answers.availableWeekdays) ? answers.availableWeekdays.map(day => weekdays[day]).join(' · ') : '';
  return <><Header /><Steps current={5} mode="ai" /><section className="mus-flow"><h1>CONSTRUÇÃO DO SEU PLANO</h1><p>O Training Engine calcula a prescrição-base e a Invictus IA pode complementar a personalização.</p><div className="mus-processing"><Brain /><div><h2>SEU PLANO ESTÁ SENDO MONTADO…</h2><p>Objetivo: {answers.primaryGoal || 'não informado'} · {days || `${answers.daysPerWeek || '—'} dias por semana`}</p></div></div><h2>O QUE ESTÁ SENDO ANALISADO:</h2>{steps.map((step,index) => <div className="mus-processing-row" key={step}><Sparkles /><span><b>{step}</b><small>{index < 3 ? 'Concluído' : index === 3 ? 'Processando…' : 'Aguardando'}</small></span><i className={index < 3 ? 'is-done' : index === 3 ? 'is-loading' : ''}>{index < 3 ? <Check /> : null}</i></div>)}<div className="mus-tip"><Info /><span><b>PROCESSAMENTO REAL</b>Esta tela acompanha a resposta do motor/servidor; não exibimos percentual inventado.</span></div></section></>;
}

function AiSuccess({ plan, onReview, onPlan }: { plan: WorkoutPlan; onReview: () => void; onPlan: () => void }) {
  const savedLocally = plan.id.startsWith('local_');
  const localFallback = plan.generationMode === 'local_fallback';
  const engineOnly = plan.generationMode === 'training_engine';
  const title = localFallback ? 'PLANO PRONTO EM CONTINGÊNCIA' : engineOnly ? 'PLANO CONSTRUÍDO PELO TRAINING ENGINE' : 'PLANO CONSTRUÍDO COM SUCESSO!';
  const description = localFallback
    ? 'A camada de IA está indisponível, mas o mesmo Training Engine baseado em regras de evidência montou e validou seu plano.'
    : engineOnly
      ? 'Seu plano foi calculado pelo Training Engine com os dados do seu perfil, rotina e biblioteca oficial.'
      : 'O Training Engine calculou a base e a Invictus IA aplicou a personalização adicional sem sair das regras validadas.';
  return <><Header /><Steps current={5} mode="ai" /><section className="mus-flow"><h1>{title}</h1><p>{description}</p>{savedLocally ? <div className="mus-tip" role="status"><Info /><span><b>SINCRONIZAÇÃO PENDENTE</b>O banco está temporariamente indisponível. O plano foi salvo neste aparelho; tentaremos sincronizá-lo automaticamente na próxima abertura da musculação.</span></div> : null}<div className="mus-final-data"><h2>SEU PLANO EM RESUMO</h2><p><Target /><span>Objetivo<b>{plan.objective}</b></span></p><p><Dumbbell /><span>Nível<b>{plan.experienceLevel || 'Não informado'}</b></span></p><p><CalendarDays /><span>Dias por semana<b>{plan.daysPerWeek}</b></span></p><p><Clock3 /><span>Duração média<b>{plan.durationMinutes} min</b></span></p></div><div className="mus-plan-includes"><h2>SEU PLANO INCLUI</h2>{['Treinos personalizados','Dias reais da sua rotina','Regras de evidência versionadas','Histórico de cargas','Base para progressão'].map(item => <span key={item}><ShieldCheck /><b>{item}</b></span>)}</div><div className="mus-week-preview">{plan.workouts.map((workout,index) => <article key={workout.id}><small>{workout.weekdays.map(day => weekdays[day]).join(' / ') || `TREINO ${index+1}`}</small><b>{workout.name}</b><span>{workout.focus}</span></article>)}</div><div className="mus-flow-actions"><button className="is-back" onClick={onReview}><ArrowLeft /> REVISAR RESPOSTAS</button><button className="is-primary" onClick={onPlan}>VER MEU PLANO <ArrowRight /></button></div></section></>;
}

function PlanView({ plan, onBack, onWorkout }: { plan: WorkoutPlan; onBack: () => void; onWorkout: (workout: PlannedWorkout) => void }) {
  const origin = plan.generationMode === 'local_fallback'
    ? 'Training Engine (contingência)'
    : plan.generationMode === 'training_engine'
      ? 'Training Engine Invictus'
      : plan.source === 'ai' ? 'Training Engine + Invictus IA' : 'Criado manualmente';
  const rationale = plan.rationale || 'Este plano foi montado com a biblioteca oficial de exercícios de acordo com as respostas do seu questionário. Gere um novo plano para ver a explicação detalhada do porquê de cada escolha.';
  return <><Header onBack={onBack} /><section className="mus-flow"><h1>MEU PLANO</h1><p>{plan.description || 'Seu plano de musculação atual.'}</p><div className="mus-final-data"><h2>VISÃO GERAL</h2><p><Target /><span>Objetivo<b>{plan.objective}</b></span></p><p><CalendarDays /><span>Frequência<b>{plan.daysPerWeek} dias por semana</b></span></p><p><Clock3 /><span>Duração média<b>{plan.durationMinutes} min</b></span></p><p><Brain /><span>Origem<b>{origin}</b></span></p></div><div className="mus-tip mus-plan-rationale"><Info /><span><b>POR QUE ESSE TREINO</b>{rationale}</span></div><h2>PROGRAMAÇÃO SEMANAL</h2><div className="mus-workout-list">{plan.workouts.map((workout,index) => <button key={workout.id} onClick={() => onWorkout(workout)}><i>{String.fromCharCode(65+index)}</i><span><b>{workout.name}</b><small>{workout.weekdays.map(day => weekdays[day]).join(' · ')} · {workout.focus}</small></span><em>{workout.exercises.length} exercícios</em><ChevronRight /></button>)}</div></section></>;
}

function WorkoutView({ workout, onBack, onStart, loading }: { plan: WorkoutPlan; workout: PlannedWorkout; onBack: () => void; onStart: () => void; loading: boolean }) {
  return <><Header onBack={onBack} /><section className="mus-flow"><h1>{workout.name}</h1><p>{workout.focus}</p><div className="mus-workout-detail">{workout.exercises.map((item,index) => { const exercise = OFFICIAL_EXERCISE_BY_ID.get(item.exerciseId); return <article key={`${item.exerciseId}-${index}`}><OfficialExerciseMedia exercise={exercise} label={item.exerciseId} className="mus-detail-media" /><i>{index+1}</i><span><b>{exercise?.name || item.exerciseId}</b><small>{item.sets} × {item.repsMin}–{item.repsMax} · {item.restSeconds}s descanso{item.targetRir !== undefined ? ` · RIR ${item.targetRir}` : ''}{item.initialLoadKg !== undefined ? ` · ${item.initialLoadKg} kg inicial` : ''}</small></span></article>; })}</div><button className="mus-start-workout" onClick={onStart} disabled={loading}><Play />{loading ? 'INICIANDO…' : 'INICIAR TREINO'}</button></section></>;
}
