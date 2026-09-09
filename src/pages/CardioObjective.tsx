import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, ArrowRight, CalendarDays, Check, ChevronRight, History,
  ShieldCheck, Sparkles, Target, Trophy, UsersRound
} from 'lucide-react';
import { InvictusLogo } from '../components/InvictusLogo';
import { useUser } from '../UserContext';
import { objectiveRequest, type ObjectiveView } from '../services/cardioObjectiveService';
import { localDate, onboardingSteps, safetyDecision } from '../core/cardioObjective/engine';
import { answersSchema } from '../core/cardioObjective/validation';
import {
  FOOD_LABELS, GOALS, type Mission, type ObjectiveAnswers, type SafetyAnswers,
  type WeeklyAnswers
} from '../core/cardioObjective/types';
import './CardioObjective.css';

const days = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const barriers = {
  time: 'Falta de tempo', fatigue: 'Cansaço', starting: 'Dificuldade para começar',
  hunger: 'Fome', sweets: 'Doces', anxiety: 'Ansiedade', dislike_running: 'Não gosto de correr',
  pain: 'Dor ou desconforto', restart: 'Começo e paro', unpredictable: 'Rotina imprevisível',
  food: 'Alimentação', other: 'Outro'
} as const;
const modalities = {
  walking: 'Caminhada', running: 'Corrida com pausas de caminhada', bike: 'Bicicleta',
  stationary_bike: 'Bike ergométrica', treadmill: 'Esteira'
} as const;
const signalLabels = {
  chest_pain: 'Dor no peito', fainting: 'Desmaio', dizziness: 'Tontura importante',
  unusual_breathlessness: 'Falta de ar incomum', surgical_recovery: 'Recuperação cirúrgica',
  pain: 'Dor durante atividade'
} as const;
const blankSafety: SafetyAnswers = { screened: false, signals: [], medicalClearance: null };
const initialAnswers = (): ObjectiveAnswers => ({
  goalType: 'sedentary', walkingMinutes: 5, runningAbility: 'none', availableMinutes: 10,
  availableDays: [], timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo',
  preferredMoment: 'any', preferredActivity: 'walking', barrier: 'starting', confidenceScore: 5,
  safety: { ...blankSafety }, productConsent: true
});

type ChoiceDeckProps<T extends string | number> = {
  value: T;
  options: Array<[T, string]>;
  onChange: (value: T) => void;
  label: string;
  recommended?: T[];
  compact?: boolean;
};

function ChoiceDeck<T extends string | number>({ value, options, onChange, label, recommended, compact }: ChoiceDeckProps<T>) {
  const [expanded, setExpanded] = useState(false);
  const ordered = useMemo(() => {
    const preferred = (recommended || []).flatMap(id => options.filter(([optionId]) => optionId === id));
    const rest = options.filter(([id]) => !preferred.some(([preferredId]) => preferredId === id));
    return [...preferred, ...rest];
  }, [options, recommended]);
  const primary = ordered.slice(0, 2);
  const secondary = ordered.slice(2);
  return <fieldset className={`objective-choice-deck ${compact ? 'is-compact' : ''}`}>
    <legend>{label}</legend>
    <div className="objective-choice-primary">
      {primary.map(([id, text]) => <button key={String(id)} type="button" aria-pressed={value === id} onClick={() => onChange(id)}>
        <span>{text}</span>{value === id ? <Check size={18} /> : <ChevronRight size={18} />}
      </button>)}
    </div>
    {secondary.length ? <>
      <button type="button" className="objective-more-choice" aria-expanded={expanded} onClick={() => setExpanded(current => !current)}>
        <span className="objective-dot-grid" aria-hidden="true"><i/><i/><i/><i/><i/><i/><i/><i/><i/></span>
        <span><b>Outros</b><small>{expanded ? 'Ocultar opções' : 'Ver mais opções'}</small></span><ChevronRight size={19} />
      </button>
      {expanded ? <div className="objective-choice-more">
        {secondary.map(([id, text]) => <button key={String(id)} type="button" aria-pressed={value === id} onClick={() => { onChange(id); setExpanded(false); }}>
          <span>{text}</span>{value === id ? <Check size={17} /> : null}
        </button>)}
      </div> : null}
    </> : null}
  </fieldset>;
}

function SafetyQuestion({ value, onChange, gradual }: { value: SafetyAnswers; onChange: (value: SafetyAnswers) => void; gradual: boolean }) {
  const [showSignals, setShowSignals] = useState(value.signals.length > 0);
  const decision = value.screened ? safetyDecision(value, gradual) : null;
  return <div className="objective-question-block">
    <h2>Antes de começar, como você está?</h2>
    <p>Essa resposta define os limites de segurança da jornada.</p>
    <div className="objective-choice-primary">
      <button type="button" aria-pressed={value.screened && value.signals.length === 0} onClick={() => { setShowSignals(false); onChange({ ...value, screened: true, signals: [], medicalClearance: gradual ? value.medicalClearance : null }); }}>
        <span>Nenhum desses sinais</span>{value.screened && value.signals.length === 0 ? <Check size={18} /> : <ChevronRight size={18} />}
      </button>
      <button type="button" aria-pressed={value.signals.length > 0} onClick={() => setShowSignals(true)}>
        <span>Tenho algum sinal</span><ChevronRight size={18} />
      </button>
    </div>
    {showSignals ? <div className="objective-choice-more objective-safety-list">
      {Object.entries(signalLabels).map(([id, label]) => {
        const typedId = id as keyof typeof signalLabels;
        const selected = value.signals.includes(typedId);
        return <button type="button" key={id} aria-pressed={selected} onClick={() => onChange({
          ...value,
          screened: true,
          signals: selected ? value.signals.filter(signal => signal !== typedId) : [...value.signals, typedId]
        })}>{label}{selected ? <Check size={17} /> : null}</button>;
      })}
    </div> : null}
    {(gradual || value.signals.includes('surgical_recovery')) ? <ChoiceDeck
      label="Já recebeu liberação profissional para atividade física?"
      value={value.medicalClearance === true ? 'yes' : value.medicalClearance === false ? 'no' : ''}
      options={[['yes', 'Sim'], ['no', 'Ainda não']]}
      onChange={answer => onChange({ ...value, screened: true, medicalClearance: answer === 'yes' })}
    /> : null}
    {decision?.blocked ? <p role="alert" className="objective-warning">{decision.reason}</p> : null}
  </div>;
}

function goalRecommendations(view: ObjectiveView): ObjectiveAnswers['goalType'][] {
  if ((view.profile?.recentCardioSessions || 0) >= 4) return ['conditioning', 'weekly_distance'];
  if ((view.profile?.recentLongestRunKm || 0) >= 2) return ['run_5k', 'pace'];
  return ['sedentary', 'start_running'];
}

function Onboarding({ view, onSave, busy }: { view: ObjectiveView; onSave: (answers: ObjectiveAnswers) => void; busy: boolean }) {
  const [answers, setAnswers] = useState(initialAnswers);
  const [step, setStep] = useState(0);
  const [consent, setConsent] = useState(false);
  const [food, setFood] = useState<keyof typeof FOOD_LABELS>('soda');
  const [error, setError] = useState('');
  const steps = onboardingSteps(answers.goalType);
  const key = steps[Math.min(step, steps.length - 1)];
  const patch = (update: Partial<ObjectiveAnswers>) => setAnswers(previous => ({ ...previous, ...update }));
  const nutrition = answers.nutrition || { meals: 'variable' as const, frequencies: {}, hardestTime: 'night' as const };
  const runnerGoal = ['start_running', 'run_5k', 'run_10k', 'pace', 'race', 'weekly_distance', 'endurance'].includes(answers.goalType);

  const next = () => {
    setError('');
    if (key === 'otherGoal' && (answers.otherGoal || '').trim().length < 3) { setError('Escreva seu objetivo em uma frase.'); return; }
    if (key === 'safety' && !answers.safety.screened) { setError('Precisamos dessa resposta para definir os limites de segurança.'); return; }
    if (key === 'schedule' && !answers.availableDays.length) { setError('Escolha ao menos um dia possível.'); return; }
    if (key === 'weight' && (!answers.weightConfirmed || !answers.currentWeightKg)) { setError('Confirme seu peso atual.'); return; }
    if (key === 'nutrition' && !answers.nutrition) patch({ nutrition });
    if (step < steps.length - 1) { setStep(current => current + 1); return; }
    const parsed = answersSchema.safeParse(answers);
    if (!consent || !parsed.success) { setError('Confirme o consentimento e revise as respostas necessárias.'); return; }
    onSave(answers);
  };

  const setGoal = (goalType: ObjectiveAnswers['goalType']) => {
    setAnswers({
      ...initialAnswers(), goalType,
      ...(goalType === 'post_workout' ? { preferredMoment: 'post_workout' as const } : {}),
      ...(goalType === 'rest_days' ? { preferredMoment: 'rest_days' as const } : {})
    });
    setStep(0);
  };

  return <section className="objective-onboarding" aria-label="Criação de objetivo">
    <div className="objective-onboarding-hero" aria-hidden="true" />
    <div className="objective-onboarding-content">
      <div className="objective-progress-row">
        <strong>{step + 1} de {steps.length}</strong>
        <div className="objective-progress-segments" aria-label={`Etapa ${step + 1} de ${steps.length}`}>
          {steps.map((_, index) => <i key={index} className={index <= step ? 'is-active' : ''} />)}
        </div>
      </div>

      {key === 'goal' ? <>
        <h1>O que você quer alcançar <em>primeiro?</em></h1>
        <p className="objective-lead">A jornada vai mudar conforme suas respostas. Você não precisa montar o plano sozinho.</p>
        <ChoiceDeck label="Escolha o que mais combina com você" value={answers.goalType}
          options={Object.entries(GOALS) as [ObjectiveAnswers['goalType'], string][]}
          recommended={goalRecommendations(view)} onChange={setGoal} />
        <button className="objective-write-goal" type="button" onClick={() => { setGoal('other'); setStep(1); }}>
          <Sparkles size={20}/><span><b>Escrever meu objetivo</b><small>Conte com suas próprias palavras</small></span><ChevronRight size={20}/>
        </button>
      </> : null}

      {key === 'otherGoal' ? <>
        <h1>Conte do seu <em>jeito.</em></h1>
        <p className="objective-lead">Uma frase já é suficiente. A Invictus usa isso para adaptar o restante.</p>
        <label className="objective-free-answer">Meu objetivo
          <textarea maxLength={160} value={answers.otherGoal || ''} onChange={event => patch({ otherGoal: event.target.value })}
            placeholder="Ex.: Quero correr 5 km sem parar e ter mais energia no dia a dia." />
        </label>
      </> : null}

      {key === 'safety' ? <SafetyQuestion value={answers.safety} onChange={safety => patch({ safety })} gradual={answers.goalType === 'gradual_return'} /> : null}

      {key === 'capacity' ? <>
        <h1>Qual é o seu <em>ponto de partida?</em></h1>
        <p className="objective-lead">Vamos começar em um nível que seja possível manter.</p>
        <ChoiceDeck label="Quanto tempo você caminha confortavelmente hoje?" value={answers.walkingMinutes}
          options={[[5, 'Menos de 10 min'], [15, '10–20 min'], [30, '20–40 min'], [45, 'Mais de 40 min']]}
          recommended={runnerGoal ? [15, 30] : [5, 15]} onChange={walkingMinutes => patch({ walkingMinutes })}/>
        <ChoiceDeck label="Hoje você consegue correr?" value={answers.runningAbility}
          options={[[ 'none', 'Ainda não'], ['seconds', 'Alguns segundos'], ['minutes', 'Alguns minutos'], ['regular', 'Corro regularmente'], ['structured', 'Já sigo treinamento estruturado']]}
          recommended={runnerGoal ? ['seconds', 'minutes'] : ['none', 'seconds']} onChange={runningAbility => patch({ runningAbility })}/>
      </> : null}

      {key === 'availability' ? <>
        <h1>Quanto tempo cabe <em>de verdade?</em></h1>
        <p className="objective-lead">A meta precisa caber na sua vida, não o contrário.</p>
        <ChoiceDeck label="Tempo por atividade" value={answers.availableMinutes}
          options={[[10, '10 min'], [15, '15 min'], [25, '20–30 min'], [40, '30–45 min'], [50, 'Mais de 45 min']]}
          recommended={answers.walkingMinutes <= 15 ? [10, 15] : [25, 40]} onChange={availableMinutes => patch({ availableMinutes })}/>
      </> : null}

      {key === 'schedule' ? <>
        <h1>Quando fica mais <em>possível?</em></h1>
        {view.profile?.strengthDays.length ? <button className="objective-smart-routine" type="button" onClick={() => patch({
          availableDays: answers.preferredMoment === 'rest_days'
            ? [0,1,2,3,4,5,6].filter(day => !view.profile!.strengthDays.includes(day))
            : view.profile!.strengthDays
        })}><Sparkles size={18}/><span>Usar minha rotina atual de musculação</span></button> : null}
        <fieldset className="objective-days-wrap"><legend>Quais dias costumam funcionar?</legend><div className="objective-days">
          {days.map((day, index) => <button type="button" key={day} aria-pressed={answers.availableDays.includes(index)} onClick={() => patch({
            availableDays: answers.availableDays.includes(index) ? answers.availableDays.filter(item => item !== index) : [...answers.availableDays, index]
          })}>{day}</button>)}
        </div></fieldset>
        <ChoiceDeck label="Momento preferido" value={answers.preferredMoment}
          options={[[ 'post_workout', 'Pós-musculação'], ['pre_workout', 'Antes da musculação'], ['rest_days', 'Dias sem musculação'], ['morning', 'Manhã'], ['afternoon', 'Tarde'], ['night', 'Noite'], ['any', 'Tanto faz']]}
          recommended={answers.goalType === 'post_workout' ? ['post_workout', 'any'] : answers.goalType === 'rest_days' ? ['rest_days', 'any'] : ['morning', 'night']}
          onChange={preferredMoment => patch({ preferredMoment })}/>
      </> : null}

      {key === 'modality' ? <>
        <h1>Como você prefere <em>se movimentar?</em></h1>
        <p className="objective-lead">Essa escolha também pode mudar ao longo da jornada.</p>
        <ChoiceDeck label="Modalidade preferida" value={answers.preferredActivity}
          options={Object.entries(modalities) as [ObjectiveAnswers['preferredActivity'], string][]}
          recommended={runnerGoal && answers.runningAbility !== 'none' ? ['running', 'treadmill'] : ['walking', 'bike']}
          onChange={preferredActivity => patch({ preferredActivity })}/>
      </> : null}

      {key === 'barrier' ? <>
        <h1>O que costuma te <em>atrapalhar?</em></h1>
        <p className="objective-lead">A próxima meta precisa contornar isso, não ignorar.</p>
        <ChoiceDeck label="Principal barreira" value={answers.barrier}
          options={Object.entries(barriers) as [ObjectiveAnswers['barrier'], string][]}
          recommended={answers.goalType === 'sedentary' ? ['starting', 'time'] : ['time', 'restart']}
          onChange={barrier => patch({ barrier, ...(barrier === 'pain' ? { safety: { ...answers.safety, signals: [...new Set([...answers.safety.signals, 'pain' as const])] } } : {}) })}/>
      </> : null}

      {key === 'weight' ? <>
        <h1>Vamos confirmar seu <em>peso.</em></h1>
        {view.profile?.weightMeasuredAt ? <p className="objective-lead">Encontramos uma medição recente em {view.profile.weightSource === 'apple_health' ? 'Apple Saúde' : 'Health Connect'}.</p> : null}
        {view.profile?.weightKg && !answers.weightConfirmed ? <button className="objective-confirm-card" type="button" onClick={() => patch({ currentWeightKg: view.profile!.weightKg!, weightConfirmed: true })}>
          <span><small>Seu peso atual ainda é</small><b>{view.profile.weightKg} kg?</b></span><strong>SIM</strong>
        </button> : null}
        <label className="objective-free-answer">Peso atual (kg)<input type="number" inputMode="decimal" min={30} max={350} step="0.1" value={answers.currentWeightKg || ''} onChange={event => patch({ currentWeightKg: Number(event.target.value), weightConfirmed: false })}/></label>
        <button type="button" className="objective-secondary-action" disabled={!answers.currentWeightKg} onClick={() => patch({ weightConfirmed: true })}>{answers.weightConfirmed ? 'PESO CONFIRMADO ✓' : 'CONFIRMAR PESO'}</button>
      </> : null}

      {key === 'weightTarget' ? <>
        <h1>Qual mudança você quer <em>buscar?</em></h1>
        <ChoiceDeck label="Objetivo inicial" value={answers.loseKg || 0} options={[[3, '3 kg'], [5, '5 kg'], [10, '10 kg']]} recommended={[3,5]} onChange={loseKg => patch({ loseKg })}/>
        <label className="objective-free-answer">Outro valor (kg)<input type="number" inputMode="decimal" min={1} max={30} value={answers.loseKg || ''} onChange={event => patch({ loseKg: Number(event.target.value) })}/></label>
        <p className="objective-soft-note">Não prometemos prazo de perda de peso. A jornada acompanha comportamento e evolução de forma responsável.</p>
      </> : null}

      {key === 'nutrition' ? <>
        <h1>Uma mudança <em>por vez.</em></h1>
        <ChoiceDeck label="Quantas refeições costuma fazer?" value={nutrition.meals}
          options={[[ '2', '2'], ['3', '3'], ['4', '4'], ['5+', '5 ou mais'], ['variable', 'Varia muito']]}
          recommended={['3','4']} onChange={meals => patch({ nutrition: { ...nutrition, meals } })}/>
        <label className="objective-select-label">Qual hábito você quer nos contar primeiro?<select value={food} onChange={event => setFood(event.target.value as keyof typeof FOOD_LABELS)}>{Object.entries(FOOD_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
        <ChoiceDeck label={`Frequência: ${FOOD_LABELS[food]}`} value={nutrition.frequencies[food] || ''}
          options={[[ 'rarely', 'Raramente'], ['weekly', 'Algumas vezes na semana'], ['daily', 'Diariamente'], ['multiple_daily', 'Várias vezes ao dia']]}
          recommended={['weekly','daily']} onChange={frequency => patch({ nutrition: { ...nutrition, frequencies: { ...nutrition.frequencies, [food]: frequency } } })}/>
        <ChoiceDeck label="Qual horário costuma ser mais difícil?" value={nutrition.hardestTime}
          options={[[ 'morning', 'Manhã'], ['afternoon', 'Tarde'], ['night', 'Noite'], ['late_night', 'Madrugada'], ['weekend', 'Fim de semana']]}
          recommended={['night','weekend']} onChange={hardestTime => patch({ nutrition: { ...nutrition, hardestTime } })}/>
      </> : null}

      {key === 'distance' ? <>
        <h1>Qual distância está no seu <em>radar?</em></h1>
        <label className="objective-free-answer">Distância da prova (km)<input type="number" min={1} max={42.2} step="0.1" value={answers.targetDistanceKm || ''} onChange={event => patch({ targetDistanceKm: Number(event.target.value) })}/></label>
      </> : null}

      {key === 'confidence' ? <>
        <h1>Vamos escolher um começo <em>possível.</em></h1>
        <label className="objective-confidence">Quanto acredita que consegue manter uma pequena meta?<input type="range" min={0} max={10} value={answers.confidenceScore} onChange={event => patch({ confidenceScore: Number(event.target.value) })}/><output>{answers.confidenceScore}/10</output></label>
        <p className="objective-soft-note">Se a confiança estiver baixa, a primeira meta será menor de propósito.</p>
      </> : null}

      {key === 'consent' ? <>
        <h1>Sua jornada, <em>seus dados.</em></h1>
        <div className="objective-consent-card"><ShieldCheck/><div><b>Personalização privada</b><p>Usaremos suas respostas, perfil necessário e atividades para acompanhar e ajustar esta jornada.</p></div></div>
        <label className="objective-consent"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)}/><span>Concordo com esse uso dos dados para minha jornada.</span></label>
        <p className="objective-soft-note">Isso não autoriza pesquisa nem compartilhamento com profissionais e não substitui avaliação de saúde.</p>
      </> : null}

      {error ? <p role="alert" className="objective-warning">{error}</p> : null}
      <div className="objective-onboarding-actions">
        <button type="button" className="objective-back-action" disabled={step === 0 || busy} onClick={() => setStep(current => current - 1)}>VOLTAR</button>
        <button type="button" className="objective-primary" disabled={busy} onClick={next}>{busy ? 'SALVANDO…' : step === steps.length - 1 ? 'CRIAR MINHA JORNADA' : 'CONTINUAR'}<ArrowRight size={19}/></button>
      </div>
      <div className="objective-motivation"><Sparkles/><span><b>Todo grande resultado começa com uma escolha.</b><small>Você está construindo um caminho possível.</small></span></div>
    </div>
  </section>;
}

function WeeklyCheckin({ weightRelevant, gradual, onSave, onBack, busy }: { weightRelevant: boolean; gradual: boolean; onSave: (answers: WeeklyAnswers) => void; onBack: () => void; busy: boolean }) {
  const [answers, setAnswers] = useState<WeeklyAnswers>({ difficulty: 'appropriate', energy: 'fair', confidenceScore: 5, habitAdherence: 'partly', barrier: 'starting', safety: { ...blankSafety } });
  const [step, setStep] = useState(0);
  const patch = (value: Partial<WeeklyAnswers>) => setAnswers(previous => ({ ...previous, ...value }));
  const total = weightRelevant ? 6 : 5;
  return <section className="objective-review-card">
    <small>REVISÃO DA SEMANA · {step + 1}/{total}</small><h2>Como essa semana ficou para você?</h2><p>Os treinos já são contados pelo app. Aqui queremos entender como você se sentiu.</p>
    {step === 0 ? <ChoiceDeck label="Dificuldade do cardio" value={answers.difficulty} options={[[ 'easy', 'Muito fácil'], ['appropriate', 'Adequado'], ['hard', 'Difícil'], ['very_hard', 'Muito difícil']]} recommended={['appropriate','hard']} onChange={difficulty => patch({ difficulty })}/> : null}
    {step === 1 ? <ChoiceDeck label="Como ficou sua energia?" value={answers.energy} options={[[ 'poor', 'Ruim'], ['fair', 'Razoável'], ['good', 'Boa'], ['great', 'Ótima']]} recommended={['fair','good']} onChange={energy => patch({ energy })}/> : null}
    {step === 2 ? <><ChoiceDeck label="Conseguiu praticar o foco da semana?" value={answers.habitAdherence} options={[[ 'yes', 'Consegui'], ['partly', 'Parcialmente'], ['no', 'Ainda não']]} recommended={['yes','partly']} onChange={habitAdherence => patch({ habitAdherence })}/><ChoiceDeck label="O que mais atrapalhou?" value={answers.barrier} options={Object.entries(barriers) as [WeeklyAnswers['barrier'], string][]} recommended={['time','restart']} onChange={barrier => patch({ barrier })}/></> : null}
    {step === 3 ? <label className="objective-confidence">Quanto acredita que consegue cumprir a próxima semana?<input type="range" min={0} max={10} value={answers.confidenceScore} onChange={event => patch({ confidenceScore: Number(event.target.value) })}/><output>{answers.confidenceScore}/10</output></label> : null}
    {step === 4 ? <SafetyQuestion value={answers.safety} onChange={safety => patch({ safety })} gradual={gradual}/> : null}
    {step === 5 ? <><label className="objective-free-answer">Peso atual, apenas se quiser atualizar (kg)<input type="number" inputMode="decimal" min={30} max={350} step="0.1" value={answers.weightKg || ''} onChange={event => patch({ weightKg: event.target.value ? Number(event.target.value) : undefined })}/></label><ChoiceDeck label="Como ficou sua fome?" value={answers.hunger || 'normal'} options={[[ 'low', 'Baixa'], ['normal', 'Normal'], ['high', 'Alta'], ['very_high', 'Muito alta']]} recommended={['normal','high']} onChange={hunger => patch({ hunger })}/></> : null}
    <div className="objective-onboarding-actions"><button type="button" className="objective-back-action" onClick={() => step ? setStep(current => current - 1) : onBack()} disabled={busy}>VOLTAR</button><button type="button" className="objective-primary" disabled={busy || (step >= 4 && !answers.safety.screened)} onClick={() => step === total - 1 ? onSave(answers) : setStep(current => current + 1)}>{busy ? 'SALVANDO…' : step === total - 1 ? 'CONFIRMAR REVISÃO' : 'CONTINUAR'}</button></div>
  </section>;
}

function missionTitle(mission: Mission) {
  const label = modalities[mission.prescription.modality];
  const target = mission.prescription.targetMetric === 'distance'
    ? `${mission.prescription.distanceKm?.toLocaleString('pt-BR')} km`
    : `${mission.prescription.durationMinutes} min`;
  return { label, target };
}

export function CardioObjective() {
  const { user } = useUser();
  const navigate = useNavigate();
  const [view, setView] = useState<ObjectiveView | null>(null);
  const [history, setHistory] = useState<NonNullable<ObjectiveView['items']>>([]);
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [safety, setSafety] = useState<SafetyAnswers>({ ...blankSafety });
  const [rescheduleDate, setRescheduleDate] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setView(null); setError(''); setHistory([]); setHistoryCursor(null); setHistoryOpen(false);
    objectiveRequest(undefined, '', controller.signal).then(setView).catch(requestError => { if (!controller.signal.aborted) setError(requestError.message); });
    return () => controller.abort();
  }, [user?.uid]);

  const mutate = async (body: Record<string, unknown>) => {
    setBusy(true); setError('');
    try { setView(await objectiveRequest(body)); setReviewing(false); setResuming(false); }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Não foi possível salvar.'); }
    finally { setBusy(false); }
  };

  const journey = view?.journey;
  const fullMissions = (view?.missions || []).filter((mission): mission is Mission => 'prescription' in mission);
  const nextMission = fullMissions.find(mission => ['available', 'started'].includes(mission.state));
  const displayMission = nextMission || fullMissions.find(mission => !['completed', 'rescheduled'].includes(mission.state));
  const completed = fullMissions.filter(mission => mission.state === 'completed').length;
  const planned = fullMissions.length;
  const progress = planned ? Math.round(completed / planned * 100) : 0;
  const latestWeight = view?.weights?.[0]?.kg;
  const reviewDue = !!journey && Date.now() - Date.parse(journey.weekStartedAt) >= 7 * 86400000;

  const loadHistory = async (more = false) => {
    setBusy(true); setError('');
    try {
      const result = await objectiveRequest(undefined, `?history=true${more && historyCursor ? `&before=${encodeURIComponent(historyCursor)}` : ''}`);
      setHistory(previous => more ? [...previous, ...(result.items || [])] : result.items || []);
      setHistoryCursor(result.nextCursor || null);
      setHistoryOpen(true);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Não foi possível carregar o histórico.'); }
    finally { setBusy(false); }
  };

  const startMission = (mission: Mission) => {
    if (!journey) return;
    const params = new URLSearchParams({
      journeyId: journey.id,
      missionId: mission.id,
      modality: mission.prescription.modality,
      autostart: '1'
    });
    navigate(`/challenges/cardio?${params.toString()}`);
  };

  return createPortal(<main className={`objective-page ${journey ? 'has-journey' : 'is-onboarding'}`}>
    <div className="objective-shell">
      <header className="objective-topbar">
        <button aria-label="Voltar ao Cardio" onClick={() => navigate('/challenges/cardio')}><ArrowLeft /></button>
        <div className="objective-brand"><InvictusLogo size={42}/><span>INVICTUS<small>PERFORMANCE</small></span></div>
      </header>

      {error ? <p role="alert" className="objective-warning objective-global-warning">{error}<button onClick={() => objectiveRequest().then(setView).catch(requestError => setError(requestError.message))}>TENTAR NOVAMENTE</button></p> : null}
      {!view && !error ? <div className="objective-loading"><InvictusLogo size={48}/><span>Preparando sua jornada…</span></div> : null}

      {view && !journey ? <Onboarding view={view} busy={busy} onSave={answers => void mutate({ action: 'create', answers })}/> : null}
      {journey && reviewing ? <WeeklyCheckin busy={busy} weightRelevant={journey.goalType === 'lose_weight'} gradual={journey.goalType === 'gradual_return'} onBack={() => setReviewing(false)} onSave={answers => void mutate({ action: 'review', journeyId: journey.id, week: journey.currentWeek, answers })}/> : null}

      {journey && !reviewing ? <div className="objective-journey-dashboard">
        <section className="objective-journey-hero" aria-label="Sua Jornada">
          <div className="objective-hero-copy"><small>DISCIPLINA HOJE. RESULTADOS SEMPRE.</small><h1>SUA <em>JORNADA</em></h1></div>
        </section>

        <section className="objective-journey-summary">
          <div><small>OBJETIVO</small><h2>{journey.goalLabel}</h2><p>{journey.outcome.weightKg && view?.baseline?.startingWeightKg ? `${view.baseline.startingWeightKg} kg → ${journey.outcome.weightKg} kg${latestWeight ? ` · Atual ${latestWeight} kg` : ''}` : 'Pequenas ações, grandes mudanças. Você está no caminho certo.'}</p></div>
          <span className="objective-week-pill"><CalendarDays size={17}/>SEMANA {journey.currentWeek}</span>
        </section>

        <section className="objective-week-progress">
          <div className="objective-section-heading"><span><small>PROGRESSO SEMANAL</small><b>{completed} de {planned} treinos concluídos</b></span>{reviewDue ? <button onClick={() => setReviewing(true)}>FAZER CHECK-IN <ChevronRight size={17}/></button> : null}</div>
          <div className="objective-progress-body">
            <div className="objective-progress-ring" style={{ '--journey-progress': `${progress * 3.6}deg` } as React.CSSProperties}><strong>{progress}%</strong></div>
            <div className="objective-mission-dots">{fullMissions.map(mission => <article key={mission.id} className={mission.state === 'completed' ? 'is-done' : ''}><span>{mission.state === 'completed' ? <Check size={17}/> : null}</span><small>{days[new Date(`${mission.localDate}T12:00:00`).getDay()]}</small></article>)}</div>
            <div className="objective-progress-message"><b>{completed ? 'Você está evoluindo!' : 'Sua semana começa agora.'}</b><span>{Math.max(0, planned - completed)} treino{planned - completed === 1 ? '' : 's'} para completar sua meta.</span></div>
          </div>
        </section>

        {journey.status === 'active' && displayMission ? <section className={`objective-next-step ${nextMission ? '' : 'is-waiting'}`}>
          <div className="objective-next-icon"><Target/></div>
          <div><small>{reviewDue ? 'REVISÃO DA SEMANA' : nextMission ? 'PRÓXIMO PASSO' : 'PRÓXIMA ETAPA'}</small><h2>{missionTitle(displayMission).label} {missionTitle(displayMission).target}</h2><p>{nextMission?.prescription.runSecondsPerInterval ? `Alterne ${nextMission.prescription.runSecondsPerInterval}s de corrida leve com ${nextMission.prescription.walkSecondsPerInterval}s caminhando.` : nextMission ? 'Movimento gera progresso.' : 'Conclua ou reagende a etapa pendente para continuar sua jornada.'}</p></div>
          <button aria-label="Iniciar próximo passo" disabled={!nextMission || busy || reviewDue || nextMission.localDate > localDate(new Date().toISOString(), journey.timeZone)} onClick={() => nextMission && startMission(nextMission)}><ArrowRight/></button>
        </section> : journey.status === 'active' ? <section className="objective-next-step is-complete"><div className="objective-next-icon"><Check/></div><div><small>SEMANA EM DIA</small><h2>Metas registradas</h2><p>A próxima etapa será preparada após seu check-in semanal.</p></div></section> : null}

        <section className="objective-week-plan">
          <div className="objective-section-heading"><span><small>PLANO DA SEMANA</small></span></div>
          <div className="objective-week-plan-grid">{fullMissions.map(mission => {
            const title = missionTitle(mission);
            const canStart = journey.status === 'active' && ['available', 'started'].includes(mission.state) && mission.localDate <= localDate(new Date().toISOString(), journey.timeZone) && !reviewDue;
            return <button type="button" key={mission.id} className={mission.state === 'completed' ? 'is-done' : ''} disabled={!canStart} onClick={() => canStart && startMission(mission)}>
              <small>{days[new Date(`${mission.localDate}T12:00:00`).getDay()]}</small><b>{title.label}</b><span>{title.target}</span><i>{mission.state === 'completed' ? <Check size={15}/> : null}</i>
            </button>;
          })}</div>
        </section>

        {journey.status === 'paused' ? <section className="objective-safety-return"><ShieldCheck/><div><h2>Vamos cuidar do seu retorno</h2><p>{safetyDecision(journey.safety, journey.goalType === 'gradual_return').reason}</p>{!resuming ? <button onClick={() => setResuming(true)}>REAVALIAR MEU RETORNO</button> : <><SafetyQuestion value={safety} onChange={setSafety} gradual={journey.goalType === 'gradual_return'}/><button disabled={busy || safetyDecision(safety, journey.goalType === 'gradual_return').blocked} onClick={() => void mutate({ action: 'resume', journeyId: journey.id, safety })}>RETOMAR</button></>}</div></section> : null}

        {journey.status === 'active' && nextMission?.state === 'started' ? <section className="objective-utility-card"><b>Atividade já iniciada?</b><p>Sincronize o treino salvo para atualizar a missão.</p><button disabled={busy} onClick={() => void mutate({ action: 'complete', journeyId: journey.id, missionId: nextMission.id })}>SINCRONIZAR ATIVIDADE</button></section> : null}
        {journey.status === 'active' && nextMission?.state === 'available' ? <section className="objective-reschedule"><label>Precisa de outro dia nesta semana?<input type="date" value={rescheduleDate} min={localDate(new Date().toISOString(), journey.timeZone)} max={localDate(new Date(Date.parse(journey.weekStartedAt) + 6 * 86400000).toISOString(), journey.timeZone)} onChange={event => setRescheduleDate(event.target.value)}/></label><button disabled={busy || !rescheduleDate} onClick={() => void mutate({ action: 'reschedule', journeyId: journey.id, missionId: nextMission.id, localDate: rescheduleDate })}>REAGENDAR</button></section> : null}

        <section className="objective-dashboard-links">
          <button type="button" disabled={busy || !reviewDue} onClick={() => setReviewing(true)}><CalendarDays/><span><b>CHECK-IN SEMANAL</b><small>{reviewDue ? 'Conte como foi sua semana' : 'Libera ao fim da semana'}</small></span><ChevronRight/></button>
          <button type="button" disabled={busy} onClick={() => void loadHistory()}><History/><span><b>HISTÓRICO DE JORNADAS</b><small>Veja sua evolução</small></span><ChevronRight/></button>
          <button type="button" disabled><UsersRound/><span><b>ACOMPANHAMENTO PROFISSIONAL</b><small>Parcerias em preparação</small></span><em>EM BREVE</em></button>
        </section>

        {historyOpen ? <section className="objective-history-panel"><div className="objective-section-heading"><span><small>HISTÓRICO DE JORNADAS</small></span><button onClick={() => setHistoryOpen(false)}>FECHAR</button></div>{history.length ? history.map(item => <article key={item.id}><b>{item.goalLabel}</b><span>{new Date(item.createdAt).toLocaleDateString('pt-BR')} · {{ active: 'Ativa', paused: 'Pausada', completed: 'Concluída', cancelled: 'Encerrada' }[item.status]}</span></article>) : <p>Nenhuma jornada anterior encontrada.</p>}{historyCursor ? <button disabled={busy} onClick={() => void loadHistory(true)}>CARREGAR MAIS</button> : null}</section> : null}

        <section className="objective-focus-card"><Sparkles/><div><small>FOCO DA SEMANA</small><h2>{journey.habit.text}</h2><p>Uma mudança possível de cada vez.</p></div></section>

        {view?.reviews?.[0] ? <section className="objective-insight-card"><small>EVOLUÇÃO</small><p>{view.explanation?.text || view.reviews[0].reason}</p><strong>{journey.totalCompleted} metas concluídas desde o início.</strong><button disabled={busy} onClick={() => void mutate({ action: 'explain', journeyId: journey.id })}>EXPLICAR DE FORMA SIMPLES</button></section> : null}

        {view?.achievements?.length ? <section className="objective-achievements"><Trophy/><div><small>CONQUISTAS</small>{view.achievements.map(item => <p key={item.id}>{item.label} · {new Date(item.createdAt).toLocaleDateString('pt-BR')}</p>)}</div></section> : null}

        <section className="objective-remember-card"><span className="objective-trophy-css"><Trophy/></span><div><small>LEMBRE-SE</small><h2>Você já começou. Agora é consistência.</h2><p>Disciplina de hoje. Liberdade amanhã.</p></div><ChevronRight/></section>

        {['active', 'paused'].includes(journey.status) ? <button type="button" className="objective-continue-journey" disabled={busy || journey.status !== 'active' || !nextMission || reviewDue || nextMission.localDate > localDate(new Date().toISOString(), journey.timeZone)} onClick={() => nextMission && startMission(nextMission)}>CONTINUAR JORNADA <ChevronRight/></button> : null}
        {['completed', 'cancelled'].includes(journey.status) ? <button className="objective-primary objective-new-goal" disabled={busy} onClick={() => { setBusy(true); objectiveRequest(undefined, '?new=true').then(setView).catch(requestError => setError(requestError.message)).finally(() => setBusy(false)); }}>BUSCAR UM NOVO OBJETIVO</button> : null}
        {['active', 'paused'].includes(journey.status) ? <div className="objective-journey-management">{journey.status === 'active' ? <button disabled={busy} onClick={() => void mutate({ action: 'pause', journeyId: journey.id })}>PAUSAR JORNADA</button> : null}<button disabled={busy} onClick={() => { if (window.confirm('Encerrar esta jornada? O histórico será preservado.')) void mutate({ action: 'cancel', journeyId: journey.id }); }}>ENCERRAR JORNADA</button></div> : <p className="objective-ended-note">Jornada encerrada. Seus registros continuam preservados.</p>}
      </div> : null}

      <footer className="objective-footer">Sem promessas de prazo, dietas clínicas ou substituição de avaliação profissional.</footer>
    </div>
  </main>, document.body);
}