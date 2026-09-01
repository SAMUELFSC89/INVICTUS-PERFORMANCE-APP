import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, ArrowRight, Brain, CalendarDays, Check, ChevronRight, Clock3,
  Dumbbell, Info, ListFilter, Pencil, Play, Plus,
  Search, ShieldCheck, Sparkles, Target, Trophy, UserRound
} from 'lucide-react';
import { InvictusLogo } from '../components/InvictusLogo';
import { useUser } from '../UserContext';
import { OFFICIAL_EXERCISES_BATCH_01, OFFICIAL_EXERCISE_BY_ID } from '../data/exerciseCatalog';
import { workoutPlanService } from '../services/workoutPlanService';
import { activityService } from '../services/activityService';
import type { PlannedExercise, PlannedWorkout, WorkoutPlan, WorkoutPlanAnswers, WorkoutPlanDraft } from '../types/workoutPlan';
import './Musculation.css';
import './MusculationAi.css';

type View = 'hub' | 'manual' | 'ai' | 'ai-processing' | 'ai-success' | 'plan' | 'workout';
type ManualDraft = WorkoutPlanDraft & { step: number; selectedWorkout: number };
type AiDraft = WorkoutPlanAnswers & { step: number };

const weekdays = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];
const equipmentOptions = [
  ['barra_anilhas', 'BARRA E ANILHAS'], ['halteres', 'HALTERES'], ['maquinas', 'APARELHOS DE MUSCULAÇÃO'],
  ['kettlebell', 'KETTLEBELL'], ['barra_fixa', 'BARRA FIXA'], ['elasticos', 'ELÁSTICOS'],
  ['banco', 'BANCO DE MUSCULAÇÃO'], ['crossover', 'CROSSOVER']
] as const;

const availableAiExerciseCount = (equipment: string[]) => {
  const has = (item: string) => equipment.includes(item);
  return 1
    + (has('banco') ? 2 : 0)
    + (has('barra_anilhas') ? 1 : 0)
    + (has('barra_anilhas') && has('banco') ? 1 : 0)
    + (has('halteres') && has('banco') ? 2 : 0)
    + (has('crossover') ? 1 : 0)
    + (has('maquinas') ? 2 : 0);
};

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

const initialAi = (): AiDraft => ({ step: 1, secondaryGoals: [], equipment: [], accessories: [], preferences: [], restrictions: [] });

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
    <button className="is-plus" onClick={() => navigate('/musculacao')} aria-label="Abrir musculação"><Plus /></button>
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

function ExerciseRow({ exerciseId, onAdd }: { exerciseId: string; onAdd?: () => void }) {
  const exercise = OFFICIAL_EXERCISE_BY_ID.get(exerciseId);
  if (!exercise) return null;
  return <article className="mus-exercise-row">
    <img src={exercise.thumbUrl} alt="" /><div><strong>{exercise.name}</strong><span>{exercise.muscleGroup}</span></div>
    {onAdd ? <button type="button" aria-label={`Adicionar ${exercise.name}`} onClick={onAdd}><Plus /></button> : null}
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
  const [filter, setFilter] = useState<'todos' | 'peito' | 'costas'>('todos');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showInfo, setShowInfo] = useState(false);

  useEffect(() => {
    let active = true;
    workoutPlanService.list().then(data => {
      if (!active) return;
      setPlans(data); setSelectedPlan(data.find(plan => plan.status === 'active') || data[0] || null);
    }).catch(err => active && setError(err.message)).finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  useEffect(() => { if (view === 'manual') workoutPlanService.saveDraft(manual); }, [manual, view]);

  useEffect(() => {
    const openInfo = () => setShowInfo(true);
    window.addEventListener('invictus:musculation-info', openInfo);
    return () => window.removeEventListener('invictus:musculation-info', openInfo);
  }, []);

  const activePlan = selectedPlan || plans.find(plan => plan.status === 'active') || null;
  const todayWorkout = useMemo(() => {
    if (!activePlan) return null;
    const today = new Date().getDay();
    return activePlan.workouts.find(workout => workout.weekdays.includes(today)) || activePlan.workouts[0] || null;
  }, [activePlan]);
  const filteredExercises = useMemo(() => OFFICIAL_EXERCISES_BATCH_01.filter(exercise =>
    (filter === 'todos' || exercise.muscleGroup === filter) && exercise.name.toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR'))
  ), [filter, query]);

  const updateManualWorkout = (index: number, next: Partial<PlannedWorkout>) => setManual(current => ({
    ...current, workouts: current.workouts.map((workout, workoutIndex) => workoutIndex === index ? { ...workout, ...next } : workout)
  }));
  const addExercise = (exerciseId: string) => {
    const index = manual.selectedWorkout;
    const workout = manual.workouts[index];
    if (workout.exercises.some(item => item.exerciseId === exerciseId)) return;
    const exercise: PlannedExercise = { exerciseId, order: workout.exercises.length, sets: 4, repsMin: 8, repsMax: 12, restSeconds: 90 };
    updateManualWorkout(index, { exercises: [...workout.exercises, exercise] });
  };
  const updateExercise = (exerciseIndex: number, next: Partial<PlannedExercise>) => {
    const workout = manual.workouts[manual.selectedWorkout];
    updateManualWorkout(manual.selectedWorkout, { exercises: workout.exercises.map((exercise, index) => index === exerciseIndex ? { ...exercise, ...next } : exercise) });
  };

  const saveManual = async () => {
    setError(null); setLoading(true);
    try {
      const saved = await workoutPlanService.save({ ...manual, workouts: manual.workouts.filter(workout => workout.exercises.length) });
      setPlans(current => [saved, ...current]); setSelectedPlan(saved); setView('plan');
    } catch (err: any) { setError(err.message); } finally { setLoading(false); }
  };
  const generateAi = async () => {
    setError(null); setView('ai-processing');
    try {
      const generated = await workoutPlanService.generate(ai);
      const saved = await workoutPlanService.save(generated);
      setPlans(current => [saved, ...current]); setSelectedPlan(saved); setView('ai-success');
    } catch (err: any) { setError(err.message); setView('ai'); }
  };
  const startWorkout = async (plan: WorkoutPlan, workout: PlannedWorkout) => {
    setLoading(true); setError(null);
    try {
      await activityService.requestMotionPermission();
      await activityService.startSession('workout', undefined, undefined, undefined, undefined, workout.focus || 'Musculação', {
        workoutPlanId: plan.id, workoutId: workout.id, plannedExercises: workout.exercises
      });
      navigate('/challenges', { replace: true });
    } catch (err: any) { setError(err.message); } finally { setLoading(false); }
  };

  const content = <main className="mus-screen"><div className="mus-page">
    {view === 'hub' ? <Hub userName={user?.displayName || user?.name || 'Atleta'} plan={activePlan} today={todayWorkout} loading={loading} onManual={() => { setManual(initialManual()); setView('manual'); }} onAi={() => { setAi(initialAi()); setView('ai'); }} onPlan={() => setView('plan')} onWorkout={(workout) => { setSelectedWorkout(workout); setView('workout'); }} onStart={() => activePlan && todayWorkout && startWorkout(activePlan, todayWorkout)} /> : null}
    {view === 'manual' ? <ManualFlow draft={manual} setDraft={setManual} query={query} setQuery={setQuery} filter={filter} setFilter={setFilter} filteredExercises={filteredExercises} addExercise={addExercise} updateExercise={updateExercise} updateWorkout={updateManualWorkout} onBack={() => manual.step > 1 ? setManual(current => ({ ...current, step: current.step - 1 })) : setView('hub')} onSave={saveManual} loading={loading} /> : null}
    {view === 'ai' ? <AiFlow draft={ai} setDraft={setAi} onBack={() => ai.step > 1 ? setAi(current => ({ ...current, step: current.step - 1 })) : setView('hub')} onGenerate={generateAi} /> : null}
    {view === 'ai-processing' ? <Processing answers={ai} /> : null}
    {view === 'ai-success' && activePlan ? <AiSuccess plan={activePlan} onReview={() => setView('ai')} onPlan={() => setView('plan')} /> : null}
    {view === 'plan' && activePlan ? <PlanView plan={activePlan} onBack={() => setView('hub')} onWorkout={(workout) => { setSelectedWorkout(workout); setView('workout'); }} /> : null}
    {view === 'workout' && activePlan && selectedWorkout ? <WorkoutView plan={activePlan} workout={selectedWorkout} onBack={() => setView('plan')} onStart={() => startWorkout(activePlan, selectedWorkout)} loading={loading} /> : null}
    {error ? <div className="mus-error" role="alert">{error}<button onClick={() => setError(null)}>Fechar</button></div> : null}
    {showInfo ? <div className="mus-info-overlay" role="dialog" aria-modal="true" aria-labelledby="mus-info-title" onClick={() => setShowInfo(false)}><section onClick={event => event.stopPropagation()}><ShieldCheck /><h2 id="mus-info-title">COMO FUNCIONA</h2><p>Crie ou escolha um plano, inicie o treino do dia e registre a sessão completa. Somente atividades concluídas e homologadas alimentam sua evolução, seus desafios e o ranking.</p><button onClick={() => setShowInfo(false)}>ENTENDI</button></section></div> : null}
  </div><Footer navigate={navigate} /></main>;
  return createPortal(content, document.body);
}

function Hub({ userName, plan, today, loading, onManual, onAi, onPlan, onWorkout, onStart }: any) {
  return <><Header /><section className="mus-hero"><div><h1>MUSCULAÇÃO</h1><p>Organize seus treinos, acompanhe sua evolução e supere seus limites.</p></div></section>
    {plan && today ? <section><h2 className="mus-section-title"><CalendarDays /> TREINO DE HOJE</h2><article className="mus-today-card">
      {today.exercises[0] ? <img src={OFFICIAL_EXERCISE_BY_ID.get(today.exercises[0].exerciseId)?.thumbUrl} alt="" /> : null}
      <div><h3>{today.focus || today.name}</h3><span>{today.name}</span><p><Dumbbell /> {today.exercises.length} exercícios</p><p><Clock3 /> ~{plan.durationMinutes} min</p><button onClick={onStart} disabled={loading}><Play />{loading ? 'INICIANDO…' : 'INICIAR TREINO'}</button></div>
    </article></section> : <section className="mus-empty-plan"><h2>COMECE SEU PLANO</h2><p>{userName.split(' ')[0]}, escolha como deseja montar seus treinos.</p></section>}
    {plan ? <section><div className="mus-title-line"><h2>MEUS TREINOS</h2><button onClick={onPlan}>VER TODOS <ChevronRight /></button></div><div className="mus-workout-list">{plan.workouts.map((workout: PlannedWorkout, index: number) => <button key={workout.id} onClick={() => onWorkout(workout)}><i>{String.fromCharCode(65 + index)}</i><span><b>{workout.name}</b><small>{workout.focus}</small></span><em>{workout.exercises.length} exercícios</em><ChevronRight /></button>)}</div></section> : null}
    <section><h2 className="mus-section-title">CRIAR NOVO TREINO</h2><div className="mus-create-grid"><article><Brain /><h3>GERAR COM IA</h3><p>Responda algumas perguntas e receba um treino completo feito para você.</p><button onClick={onAi}>GERAR MEU TREINO <ChevronRight /></button></article><article><Pencil /><h3>CRIAR MANUALMENTE</h3><p>Monte seu treino escolhendo exercícios, séries, repetições, cargas e descansos.</p><button onClick={onManual}>MONTAR TREINO <ChevronRight /></button></article></div></section>
  </>;
}

function ManualFlow({ draft, setDraft, query, setQuery, filter, setFilter, filteredExercises, addExercise, updateExercise, updateWorkout, onBack, onSave, loading }: any) {
  const workout = draft.workouts[draft.selectedWorkout];
  const next = () => setDraft((current: ManualDraft) => ({ ...current, step: Math.min(5, current.step + 1) }));
  return <><Header onBack={onBack} /><Steps current={draft.step} mode="manual" /><section className="mus-flow">
    {draft.step === 1 ? <><h1>CRIAR MANUALMENTE</h1><p>Monte seu treino escolhendo exercícios, séries, repetições, cargas e descansos.</p><h2>1. DADOS DO TREINO</h2><div className="mus-form-card"><label>NOME DO PLANO<input maxLength={60} value={draft.name} placeholder="Ex.: Meu plano de hipertrofia" onChange={event => setDraft({ ...draft, name: event.target.value })} /></label><label>DESCRIÇÃO (OPCIONAL)<textarea maxLength={240} value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })} /></label></div><h2>2. CONFIGURAÇÕES DO TREINO</h2><div className="mus-setting-grid"><label>DIAS POR SEMANA<div>{[1,2,3,4,5,6].map(n => <button key={n} className={draft.daysPerWeek === n ? 'is-selected' : ''} onClick={() => setDraft({ ...draft, daysPerWeek: n, workouts: Array.from({length:n}, (_,i) => draft.workouts[i] || emptyWorkout(i)) })}>{n}</button>)}</div></label><label>TEMPO ESTIMADO<div>{[30,45,60,90].map(n => <button key={n} className={draft.durationMinutes === n ? 'is-selected' : ''} onClick={() => setDraft({ ...draft, durationMinutes: n })}>{n}{n === 90 ? '+' : ''} min</button>)}</div></label><label>NÍVEL DO TREINO<select value={draft.experienceLevel || ''} onChange={event => setDraft({ ...draft, experienceLevel: event.target.value })}><option value="">Selecione</option><option>Iniciante</option><option>Intermediário</option><option>Avançado</option></select></label><label>OBJETIVO PRINCIPAL<select value={draft.objective} onChange={event => setDraft({ ...draft, objective: event.target.value })}><option>Hipertrofia</option><option>Força</option><option>Condicionamento</option><option>Saúde e qualidade de vida</option></select></label></div></> : null}
    {draft.step === 2 ? <><h1>2. DIVISÃO SEMANAL</h1><p>Defina quantos treinos e como eles serão distribuídos na semana.</p><div className="mus-form-card"><h3>SELECIONE OS DIAS DE CADA TREINO</h3>{draft.workouts.map((item: PlannedWorkout, index: number) => <article className="mus-split-row" key={item.id}><i>{index + 1}</i><input value={item.name} onChange={event => updateWorkout(index, { name: event.target.value })} /><input placeholder="Grupo muscular" value={item.focus} onChange={event => updateWorkout(index, { focus: event.target.value })} /><div>{weekdays.map((day, dayIndex) => <button key={day} className={item.weekdays.includes(dayIndex) ? 'is-selected' : ''} onClick={() => updateWorkout(index, { weekdays: item.weekdays.includes(dayIndex) ? item.weekdays.filter((n:number) => n !== dayIndex) : [...item.weekdays, dayIndex] })}>{day}</button>)}</div></article>)}</div></> : null}
    {draft.step === 3 ? <><h1>3. EXERCÍCIOS</h1><p>Adicione os exercícios e configure séries, repetições e descanso.</p><div className="mus-workout-tabs">{draft.workouts.map((item: PlannedWorkout, index: number) => <button key={item.id} className={draft.selectedWorkout === index ? 'is-selected' : ''} onClick={() => setDraft({ ...draft, selectedWorkout: index })}>{item.name}</button>)}</div><div className="mus-library"><div className="mus-search"><Search /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar exercício na biblioteca" /><ListFilter /></div><div className="mus-filters">{['todos','peito','costas'].map(item => <button key={item} className={filter === item ? 'is-selected' : ''} onClick={() => setFilter(item)}>{item}</button>)}</div>{filteredExercises.map((exercise: any) => <ExerciseRow key={exercise.id} exerciseId={exercise.id} onAdd={() => addExercise(exercise.id)} />)}</div><h2>EXERCÍCIOS ADICIONADOS</h2><div className="mus-configured">{workout.exercises.map((exercise: PlannedExercise, index: number) => <article key={exercise.exerciseId}><ExerciseRow exerciseId={exercise.exerciseId} /><label>Séries<input type="number" value={exercise.sets} onChange={event => updateExercise(index, { sets: Number(event.target.value) })} /></label><label>Reps mín.<input type="number" value={exercise.repsMin} onChange={event => updateExercise(index, { repsMin: Number(event.target.value) })} /></label><label>Reps máx.<input type="number" value={exercise.repsMax} onChange={event => updateExercise(index, { repsMax: Number(event.target.value) })} /></label><label>Descanso<input type="number" value={exercise.restSeconds} onChange={event => updateExercise(index, { restSeconds: Number(event.target.value) })} /></label><label>Carga opcional<input type="number" value={exercise.initialLoadKg ?? ''} onChange={event => updateExercise(index, { initialLoadKg: event.target.value === '' ? undefined : Number(event.target.value) })} /></label></article>)}</div></> : null}
    {draft.step === 4 ? <><h1>4. REVISÃO</h1><p>Confira a estrutura antes de salvar.</p>{draft.workouts.map((item: PlannedWorkout, index: number) => <article className="mus-review-card" key={item.id}><i>{String.fromCharCode(65 + index)}</i><div><h3>{item.name}</h3><p>{item.focus || 'Foco não informado'}</p><span>{item.exercises.length} exercícios · {item.exercises.reduce((sum:number, exercise:PlannedExercise) => sum + exercise.sets, 0)} séries</span></div><button onClick={() => setDraft({ ...draft, selectedWorkout:index, step:3 })}><Pencil /></button></article>)}</> : null}
    {draft.step === 5 ? <><h1>5. SALVAR TREINO</h1><p>Finalize seu treino e comece a evoluir.</p><div className="mus-final-data"><h2>DADOS FINAIS</h2><p><Dumbbell /><span>Nome do treino<b>{draft.name || 'Meu plano'}</b></span></p><p><CalendarDays /><span>Divisão<b>{draft.daysPerWeek} treinos por semana</b></span></p><p><Target /><span>Objetivo principal<b>{draft.objective}</b></span></p><p><Clock3 /><span>Tempo estimado<b>~{draft.durationMinutes} min</b></span></p></div><div className="mus-tip"><ShieldCheck /><span><b>DICA INVICTUS</b>Registre suas cargas e evolua a cada sessão.</span></div></> : null}
    <div className="mus-flow-actions">{draft.step > 1 ? <button className="is-back" onClick={onBack}><ArrowLeft /> VOLTAR</button> : null}{draft.step < 5 ? <button className="is-primary" onClick={next} disabled={draft.step === 1 && !draft.name.trim()}>CONTINUAR <ArrowRight /></button> : <button className="is-primary" onClick={onSave} disabled={loading}>{loading ? 'SALVANDO…' : 'SALVAR E IR PARA MEUS TREINOS'} <Check /></button>}</div>
  </section></>;
}

function AiFlow({ draft, setDraft, onBack, onGenerate }: any) {
  const selectArray = (key: keyof AiDraft, value: string, max = 99) => setDraft((current: AiDraft) => { const list = (current[key] as string[]) || []; return { ...current, [key]: list.includes(value) ? list.filter(item => item !== value) : list.length < max ? [...list, value] : list }; });
  const equipmentExerciseCount = availableAiExerciseCount(draft.equipment);
  const canContinue = draft.step === 1
    ? Boolean(draft.primaryGoal)
    : draft.step === 2
      ? Boolean(draft.experienceLevel && draft.experienceTime)
      : draft.step === 3
        ? Boolean(draft.daysPerWeek && draft.durationMinutes && draft.preferredPeriod)
        : draft.step === 4
          ? equipmentExerciseCount >= 3
          : Boolean(draft.preferredTraining && draft.preferredSplit);
  const requirement = draft.step === 4 && draft.equipment.length > 0 && equipmentExerciseCount < 3
    ? 'Selecione uma combinação que ofereça pelo menos 3 exercícios oficiais, como banco + halteres, aparelhos ou barra + banco.'
    : 'Preencha as opções obrigatórias desta etapa para continuar.';
  const next = () => draft.step === 5 ? onGenerate() : setDraft((current: AiDraft) => ({ ...current, step: current.step + 1 }));
  return <><Header onBack={onBack} /><Steps current={draft.step} mode="ai" /><section className="mus-flow mus-ai-flow">
    {draft.step === 1 ? <><h1>CRIAR COM INVICTUS IA</h1><p>Responda algumas perguntas para que a IA monte o treino ideal para você.</p><h2>1. QUAL É O SEU PRINCIPAL OBJETIVO?</h2><div className="mus-choice-grid">{[['massa','GANHAR MASSA MUSCULAR'],['forca','GANHAR FORÇA'],['gordura','REDUZIR GORDURA CORPORAL'],['condicionamento','MELHORAR CONDICIONAMENTO'],['definicao','MELHORAR DEFINIÇÃO MUSCULAR'],['retorno','RETOMAR OS TREINOS'],['saude','SAÚDE E QUALIDADE DE VIDA']].map(([value,label]) => <Choice key={value} selected={draft.primaryGoal === value} onClick={() => setDraft({...draft,primaryGoal:value})} icon={<Target />} title={label} />)}</div><h2>OBJETIVOS SECUNDÁRIOS (OPCIONAL)</h2><div className="mus-check-grid">{['Aumentar força','Melhorar resistência','Ganhar mobilidade','Melhorar postura'].map(item => <Choice key={item} selected={draft.secondaryGoals.includes(item)} onClick={() => selectArray('secondaryGoals',item,3)} title={item} />)}</div></> : null}
    {draft.step === 2 ? <><h1>2. QUAL É A SUA EXPERIÊNCIA?</h1><p>Seu nível define volume, intensidade e complexidade dos movimentos.</p><div className="mus-choice-grid is-three">{[['iniciante','INICIANTE','Nunca treinei ou estou começando'],['intermediario','INTERMEDIÁRIO','Treino com consistência'],['avancado','AVANÇADO','Tenho ampla experiência']].map(([value,title,detail]) => <Choice key={value} selected={draft.experienceLevel === value} onClick={() => setDraft({...draft,experienceLevel:value})} icon={<Dumbbell />} title={title} detail={detail} />)}</div><h2>TEMPO DE EXPERIÊNCIA</h2><div className="mus-choice-grid is-four">{['Menos de 6 meses','6 a 12 meses','1 a 3 anos','Mais de 3 anos'].map(item => <Choice key={item} selected={draft.experienceTime === item} onClick={() => setDraft({...draft,experienceTime:item})} title={item} />)}</div></> : null}
    {draft.step === 3 ? <><h1>3. QUAL É A SUA ROTINA ATUAL?</h1><p>Isso ajuda a IA a montar um plano realista para o seu dia a dia.</p><h2>QUANTOS DIAS POR SEMANA VOCÊ TREINA?</h2><div className="mus-choice-grid is-seven">{[1,2,3,4,5,6,7].map(n => <Choice key={n} selected={draft.daysPerWeek === n} onClick={() => setDraft({...draft,daysPerWeek:n})} title={`${n} ${n === 1 ? 'dia' : 'dias'}`} />)}</div><h2>QUANTO TEMPO POR TREINO?</h2><div className="mus-choice-grid is-four">{[[45,'Até 45 minutos'],[60,'45 a 60 minutos'],[90,'60 a 90 minutos'],[120,'Mais de 90 minutos']].map(([n,label]) => <Choice key={String(n)} selected={draft.durationMinutes === n} onClick={() => setDraft({...draft,durationMinutes:n})} title={String(label)} />)}</div><h2>HORÁRIO PREFERIDO</h2><div className="mus-choice-grid is-three">{['Manhã','Tarde','Noite'].map(item => <Choice key={item} selected={draft.preferredPeriod === item} onClick={() => setDraft({...draft,preferredPeriod:item})} icon={<Clock3 />} title={item} />)}</div></> : null}
    {draft.step === 4 ? <><h1>4. QUAIS EQUIPAMENTOS VOCÊ TEM ACESSO?</h1><p>A IA limitará o plano aos equipamentos que você selecionar.</p><div className="mus-choice-grid is-four">{equipmentOptions.map(([value,label]) => <Choice key={value} selected={draft.equipment.includes(value)} onClick={() => selectArray('equipment',value)} icon={<Dumbbell />} title={label} />)}</div><h2>ACESSÓRIOS (OPCIONAL)</h2><div className="mus-check-grid">{['Cinto','Munhequeira','Joelheira','Straps'].map(item => <Choice key={item} selected={draft.accessories.includes(item)} onClick={() => selectArray('accessories',item)} title={item} />)}</div></> : null}
    {draft.step === 5 ? <><h1>5. QUAIS SÃO AS SUAS PREFERÊNCIAS?</h1><p>Esses detalhes ajudam a IA a personalizar ainda mais seu plano.</p><h2>TIPO DE TREINO PREFERIDO</h2><div className="mus-choice-grid is-three">{[['forca','TREINO DE FORÇA'],['funcional','TREINO FUNCIONAL'],['cardio','CONDICIONAMENTO E CARDIO']].map(([value,label]) => <Choice key={value} selected={draft.preferredTraining === value} onClick={() => setDraft({...draft,preferredTraining:value})} icon={<Dumbbell />} title={label} />)}</div><h2>DIVISÃO PREFERIDA</h2><div className="mus-choice-grid is-three">{['Full body','Upper / Lower','ABC (3x por semana)','Bro split','PPL','Outro'].map(item => <Choice key={item} selected={draft.preferredSplit === item} onClick={() => setDraft({...draft,preferredSplit:item})} title={item} />)}</div><h2>PREFERÊNCIAS ADICIONAIS</h2><div className="mus-check-grid">{['Prefiro treinos sem impacto','Quero queimar mais gordura','Tenho pouco tempo disponível','Quero treinos desafiadores'].map(item => <Choice key={item} selected={draft.preferences.includes(item)} onClick={() => selectArray('preferences',item)} title={item} />)}</div></> : null}
    <div className="mus-ai-note"><Brain /><span><b>A IA USA ESSES DADOS PARA:</b>Selecionar exercícios oficiais adequados à sua rotina e aos equipamentos disponíveis.</span></div>{!canContinue ? <p className="mus-ai-requirement" role="status">{requirement}</p> : null}<div className="mus-flow-actions"><button className="is-back" onClick={onBack}><ArrowLeft /> VOLTAR</button><button className="is-primary" onClick={next} disabled={!canContinue}>{draft.step === 5 ? 'GERAR MEU PLANO COM IA' : 'CONTINUAR'} <ArrowRight /></button></div>
  </section></>;
}

function Processing({ answers }: { answers: AiDraft }) {
  const steps = ['Definindo objetivos e prioridades','Calculando volume e intensidade ideais','Organizando sua rotina semanal','Selecionando exercícios oficiais','Planejando progressão e periodização'];
  return <><Header /><Steps current={5} mode="ai" /><section className="mus-flow"><h1>CONSTRUÇÃO DO SEU PLANO</h1><p>A IA está processando suas respostas e montando um plano personalizado.</p><div className="mus-processing"><Brain /><div><h2>A IA ESTÁ TRABALHANDO…</h2><p>Objetivo: {answers.primaryGoal || 'não informado'} · {answers.daysPerWeek || '—'} dias por semana</p></div></div><h2>O QUE SUA IA ESTÁ ANALISANDO:</h2>{steps.map((step,index) => <div className="mus-processing-row" key={step}><Sparkles /><span><b>{step}</b><small>{index < 3 ? 'Concluído' : index === 3 ? 'Processando…' : 'Aguardando'}</small></span><i className={index < 3 ? 'is-done' : index === 3 ? 'is-loading' : ''}>{index < 3 ? <Check /> : null}</i></div>)}<div className="mus-tip"><Info /><span><b>PROCESSAMENTO REAL</b>Esta tela acompanha a resposta do servidor; não exibimos percentual inventado.</span></div></section></>;
}

function AiSuccess({ plan, onReview, onPlan }: { plan: WorkoutPlan; onReview: () => void; onPlan: () => void }) {
  const savedLocally = plan.id.startsWith('local_');
  const localFallback = plan.generationMode === 'local_fallback';
  return <><Header /><Steps current={5} mode="ai" /><section className="mus-flow"><h1>{localFallback ? 'PLANO PRONTO EM CONTINGÊNCIA' : 'PLANO CONSTRUÍDO COM SUCESSO!'}</h1><p>{localFallback ? 'O Gemini está temporariamente indisponível. Montamos um plano seguro com exercícios oficiais para você não ficar parado.' : 'A Invictus IA criou um plano usando apenas exercícios validados da biblioteca oficial.'}</p>{savedLocally ? <div className="mus-tip" role="status"><Info /><span><b>SINCRONIZAÇÃO PENDENTE</b>O banco está temporariamente indisponível. O plano foi salvo neste aparelho; tentaremos sincronizá-lo automaticamente na próxima abertura da musculação.</span></div> : null}<div className="mus-final-data"><h2>SEU PLANO EM RESUMO</h2><p><Target /><span>Objetivo<b>{plan.objective}</b></span></p><p><Dumbbell /><span>Nível<b>{plan.experienceLevel || 'Não informado'}</b></span></p><p><CalendarDays /><span>Dias por semana<b>{plan.daysPerWeek}</b></span></p><p><Clock3 /><span>Duração média<b>{plan.durationMinutes} min</b></span></p></div><div className="mus-plan-includes"><h2>SEU PLANO INCLUI</h2>{['Treinos personalizados','Progressão acompanhada','Histórico de cargas','Desempenho','Metas'].map(item => <span key={item}><ShieldCheck /><b>{item}</b></span>)}</div><div className="mus-week-preview">{plan.workouts.map((workout,index) => <article key={workout.id}><small>{workout.weekdays.map(day => weekdays[day]).join(' / ') || `TREINO ${index+1}`}</small><b>{workout.name}</b><span>{workout.focus}</span></article>)}</div><div className="mus-flow-actions"><button className="is-back" onClick={onReview}><ArrowLeft /> REVISAR RESPOSTAS</button><button className="is-primary" onClick={onPlan}>VER MEU PLANO <ArrowRight /></button></div></section></>;
}

function PlanView({ plan, onBack, onWorkout }: { plan: WorkoutPlan; onBack: () => void; onWorkout: (workout: PlannedWorkout) => void }) {
  const origin = plan.generationMode === 'local_fallback' ? 'Contingência oficial (IA indisponível)' : plan.source === 'ai' ? 'Invictus IA' : 'Criado manualmente';
  return <><Header onBack={onBack} /><section className="mus-flow"><h1>MEU PLANO</h1><p>{plan.description || 'Seu plano de musculação atual.'}</p><div className="mus-final-data"><h2>VISÃO GERAL</h2><p><Target /><span>Objetivo<b>{plan.objective}</b></span></p><p><CalendarDays /><span>Frequência<b>{plan.daysPerWeek} dias por semana</b></span></p><p><Clock3 /><span>Duração média<b>{plan.durationMinutes} min</b></span></p><p><Brain /><span>Origem<b>{origin}</b></span></p></div><h2>PROGRAMAÇÃO SEMANAL</h2><div className="mus-workout-list">{plan.workouts.map((workout,index) => <button key={workout.id} onClick={() => onWorkout(workout)}><i>{String.fromCharCode(65+index)}</i><span><b>{workout.name}</b><small>{workout.focus}</small></span><em>{workout.exercises.length} exercícios</em><ChevronRight /></button>)}</div></section></>;
}

function WorkoutView({ workout, onBack, onStart, loading }: { plan: WorkoutPlan; workout: PlannedWorkout; onBack: () => void; onStart: () => void; loading: boolean }) {
  return <><Header onBack={onBack} /><section className="mus-flow"><h1>{workout.name}</h1><p>{workout.focus}</p><div className="mus-workout-detail">{workout.exercises.map((item,index) => { const exercise = OFFICIAL_EXERCISE_BY_ID.get(item.exerciseId); return <article key={`${item.exerciseId}-${index}`}><img src={exercise?.thumbUrl} alt="" /><i>{index+1}</i><span><b>{exercise?.name || item.exerciseId}</b><small>{item.sets} × {item.repsMin}–{item.repsMax} · {item.restSeconds}s descanso{item.initialLoadKg !== undefined ? ` · ${item.initialLoadKg} kg inicial` : ''}</small></span></article>; })}</div><button className="mus-start-workout" onClick={onStart} disabled={loading}><Play />{loading ? 'INICIANDO…' : 'INICIAR TREINO'}</button></section></>;
}
