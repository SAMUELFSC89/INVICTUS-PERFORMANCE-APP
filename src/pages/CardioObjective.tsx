import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, Target, Trophy } from 'lucide-react';
import { InvictusLogo } from '../components/InvictusLogo';
import { useUser } from '../UserContext';
import { objectiveRequest, type ObjectiveView } from '../services/cardioObjectiveService';
import { localDate, onboardingSteps, safetyDecision } from '../core/cardioObjective/engine';
import { answersSchema } from '../core/cardioObjective/validation';
import { FOOD_LABELS, GOALS, type Mission, type ObjectiveAnswers, type SafetyAnswers, type WeeklyAnswers } from '../core/cardioObjective/types';
import './CardioObjective.css';

const days = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const barriers = { time: 'Falta de tempo', fatigue: 'Cansaço', starting: 'Dificuldade para começar', hunger: 'Fome', sweets: 'Doces', anxiety: 'Ansiedade', dislike_running: 'Não gosto de correr', pain: 'Dor ou desconforto', restart: 'Começo e paro', unpredictable: 'Rotina imprevisível', food: 'Alimentação', other: 'Outro' };
const modalities = { walking: 'Caminhada', running: 'Corrida com pausas de caminhada', bike: 'Bicicleta', stationary_bike: 'Bike ergométrica', treadmill: 'Esteira' };
const signalLabels = { chest_pain: 'Dor no peito', fainting: 'Desmaio', dizziness: 'Tontura importante', unusual_breathlessness: 'Falta de ar incomum', surgical_recovery: 'Recuperação cirúrgica', pain: 'Dor durante atividade' };
const blankSafety: SafetyAnswers = { screened: false, signals: [], medicalClearance: null };
const initialAnswers = (): ObjectiveAnswers => ({ goalType: 'sedentary', walkingMinutes: 5, runningAbility: 'none', availableMinutes: 10, availableDays: [], timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo', preferredMoment: 'any', preferredActivity: 'walking', barrier: 'starting', confidenceScore: 5, safety: { ...blankSafety }, productConsent: true });

function Choices<T extends string | number>({ value, options, onChange, label }: { value: T; options: Array<[T, string]>; onChange: (v: T) => void; label: string }) {
  return <fieldset className="objective-choices"><legend>{label}</legend>{options.map(([id, text]) => <button key={id} type="button" aria-pressed={value === id} onClick={() => onChange(id)}>{text}{value === id ? <Check size={17} /> : null}</button>)}</fieldset>;
}
function SafetyQuestion({ value, onChange, gradual }: { value: SafetyAnswers; onChange: (v: SafetyAnswers) => void; gradual: boolean }) {
  return <><h2>Antes de começar, como você está?</h2><p>Você teve algum destes sinais recentemente ou durante atividade? Isso não substitui uma avaliação de saúde.</p><div className="objective-choices">{Object.entries(signalLabels).map(([id, label]) => <button type="button" key={id} aria-pressed={value.signals.includes(id as keyof typeof signalLabels)} onClick={() => onChange({ ...value, screened: true, signals: value.signals.includes(id as keyof typeof signalLabels) ? value.signals.filter(s => s !== id) : [...value.signals, id as keyof typeof signalLabels] })}>{label}</button>)}<button type="button" aria-pressed={value.screened && value.signals.length === 0} onClick={() => onChange({ ...value, screened: true, signals: [] })}>Nenhum desses sinais</button></div>{gradual || value.signals.includes('surgical_recovery') ? <Choices label="Já recebeu liberação do profissional responsável para atividade física?" value={value.medicalClearance === true ? 'yes' : value.medicalClearance === false ? 'no' : ''} options={[['yes', 'Sim'], ['no', 'Ainda não']]} onChange={v => onChange({ ...value, medicalClearance: v === 'yes' })} /> : null}{value.screened && safetyDecision(value, gradual).blocked ? <p role="alert" className="objective-warning">{safetyDecision(value, gradual).reason}</p> : null}</>;
}

function Onboarding({ view, onSave, busy }: { view: ObjectiveView; onSave: (a: ObjectiveAnswers) => void; busy: boolean }) {
  const [a, setA] = useState(initialAnswers);
  const [step, setStep] = useState(0);
  const [consent, setConsent] = useState(false);
  const [food, setFood] = useState<keyof typeof FOOD_LABELS>('soda');
  const [error, setError] = useState('');
  const steps = onboardingSteps(a.goalType);
  const key = steps[Math.min(step, steps.length - 1)];
  const patch = (update: Partial<ObjectiveAnswers>) => setA(prev => ({ ...prev, ...update }));
  const nutrition = a.nutrition || { meals: 'variable' as const, frequencies: {}, hardestTime: 'night' as const };
  const next = () => {
    setError('');
    if (key === 'safety' && !a.safety.screened) { setError('Selecione uma resposta sobre os sinais de segurança.'); return; }
    if (key === 'schedule' && !a.availableDays.length) { setError('Escolha ao menos um dia possível.'); return; }
    if (key === 'weight' && (!a.weightConfirmed || !a.currentWeightKg)) { setError('Confirme seu peso atual.'); return; }
    if (key === 'nutrition' && !a.nutrition) patch({ nutrition });
    if (step < steps.length - 1) { setStep(step + 1); return; }
    const parsed = answersSchema.safeParse(a);
    if (!consent || !parsed.success) { setError('Confirme o consentimento e revise as respostas necessárias.'); return; }
    onSave(a);
  };
  return <section className="objective-card"><small>{step + 1} de {steps.length}</small><progress value={step + 1} max={steps.length} aria-label="Progresso da conversa" />
    {key === 'goal' ? <><h2>O que você quer alcançar?</h2><Choices label="Seu objetivo" value={a.goalType} options={Object.entries(GOALS) as [ObjectiveAnswers['goalType'], string][]} onChange={goalType => { setA({ ...initialAnswers(), goalType, ...(goalType === 'post_workout' ? { preferredMoment: 'post_workout' } : goalType === 'rest_days' ? { preferredMoment: 'rest_days' } : {}) }); }} /></> : null}
    {key === 'otherGoal' ? <label>Onde você quer chegar?<input maxLength={160} value={a.otherGoal || ''} onChange={e => patch({ otherGoal: e.target.value })} placeholder="Quero brincar com meu filho sem cansar tanto" /></label> : null}
    {key === 'safety' ? <SafetyQuestion value={a.safety} onChange={safety => patch({ safety })} gradual={a.goalType === 'gradual_return'} /> : null}
    {key === 'weight' && view.profile?.weightMeasuredAt ? <p>Peso sugerido a partir de {view.profile.weightSource === 'apple_health' ? 'Apple Saúde' : 'Health Connect'}, medido em {new Date(view.profile.weightMeasuredAt).toLocaleString('pt-BR')}. Confirme se ainda representa seu peso atual.</p> : null}
    {key === 'capacity' ? <><h2>Só para encontrar seu ponto de partida</h2><Choices label="Quanto tempo você caminha confortavelmente hoje?" value={a.walkingMinutes} options={[[5, 'Menos de 10 min'], [15, '10–20 min'], [30, '20–40 min'], [45, 'Mais de 40 min']]} onChange={walkingMinutes => patch({ walkingMinutes })} /><Choices label="Hoje você consegue correr?" value={a.runningAbility} options={[[ 'none', 'Ainda não'], ['seconds', 'Alguns segundos'], ['minutes', 'Alguns minutos'], ['regular', 'Corro regularmente'], ['structured', 'Já sigo treinamento estruturado']]} onChange={runningAbility => patch({ runningAbility })} /></> : null}
    {key === 'availability' ? <><h2>Quanto tempo cabe de verdade?</h2><Choices label="Tempo por atividade" value={a.availableMinutes} options={[[10, '10 min'], [15, '15 min'], [25, '20–30 min'], [40, '30–45 min'], [50, 'Mais de 45 min']]} onChange={availableMinutes => patch({ availableMinutes })} /></> : null}
    {key === 'schedule' ? <><h2>Quando fica mais possível?</h2>{view.profile?.strengthDays.length ? <><p>Encontramos seus dias atuais de musculação: {view.profile.strengthDays.map(d => days[d]).join(', ')}.</p><button type="button" onClick={() => patch({ availableDays: a.preferredMoment === 'rest_days' ? [0,1,2,3,4,5,6].filter(d => !view.profile!.strengthDays.includes(d)) : view.profile!.strengthDays })}>USAR ESSA ROTINA</button></> : null}<fieldset><legend>Em quais dias?</legend><div className="objective-days">{days.map((d, i) => <button type="button" key={d} aria-pressed={a.availableDays.includes(i)} onClick={() => patch({ availableDays: a.availableDays.includes(i) ? a.availableDays.filter(n => n !== i) : [...a.availableDays, i] })}>{d}</button>)}</div></fieldset><Choices label="Momento preferido" value={a.preferredMoment} options={[[ 'post_workout', 'Pós-musculação'], ['pre_workout', 'Antes da musculação'], ['rest_days', 'Dias sem musculação'], ['morning', 'Manhã'], ['afternoon', 'Tarde'], ['night', 'Noite'], ['any', 'Tanto faz']]} onChange={preferredMoment => patch({ preferredMoment })} /></> : null}
    {key === 'modality' ? <><h2>Como você prefere se movimentar?</h2><Choices label="Modalidade preferida" value={a.preferredActivity} options={Object.entries(modalities) as [ObjectiveAnswers['preferredActivity'], string][]} onChange={preferredActivity => patch({ preferredActivity })} /></> : null}
    {key === 'barrier' ? <><h2>O que mais costuma atrapalhar?</h2><Choices label="Sua principal barreira" value={a.barrier} options={Object.entries(barriers) as [ObjectiveAnswers['barrier'], string][]} onChange={barrier => patch({ barrier, ...(barrier === 'pain' ? { safety: { ...a.safety, signals: [...new Set([...a.safety.signals, 'pain' as const])] } } : {}) })} /></> : null}
    {key === 'weight' ? <><h2>Vamos confirmar seu peso</h2>{view.profile?.weightKg && !a.weightConfirmed ? <><p>Seu peso atual ainda é {view.profile.weightKg} kg?</p><button type="button" onClick={() => patch({ currentWeightKg: view.profile!.weightKg!, weightConfirmed: true })}>SIM</button></> : null}<label>Peso atual (kg)<input type="number" inputMode="decimal" min={30} max={350} step="0.1" value={a.currentWeightKg || ''} onChange={e => patch({ currentWeightKg: Number(e.target.value), weightConfirmed: false })} /></label><button type="button" onClick={() => patch({ weightConfirmed: true })} disabled={!a.currentWeightKg}>{a.weightConfirmed ? 'PESO CONFIRMADO ✓' : 'CONFIRMAR PESO ATUAL'}</button></> : null}
    {key === 'weightTarget' ? <><h2>Quanto você deseja perder?</h2><Choices label="Objetivo em kg" value={a.loseKg || 0} options={[[3, '3 kg'], [5, '5 kg'], [10, '10 kg']]} onChange={loseKg => patch({ loseKg })} /><label>Outro valor (kg)<input type="number" inputMode="decimal" min={1} max={30} value={a.loseKg || ''} onChange={e => patch({ loseKg: Number(e.target.value) })} /></label><p>Não prometemos um prazo de perda de peso. Sua evolução vai além da balança.</p></> : null}
    {key === 'nutrition' ? <><h2>Uma pequena mudança de cada vez</h2><Choices label="Quantas refeições costuma fazer?" value={nutrition.meals} options={[[ '2', '2'], ['3', '3'], ['4', '4'], ['5+', '5 ou mais'], ['variable', 'Varia muito']]} onChange={meals => patch({ nutrition: { ...nutrition, meals } })} /><label>Qual hábito você quer nos contar primeiro?<select value={food} onChange={e => setFood(e.target.value as keyof typeof FOOD_LABELS)}>{Object.entries(FOOD_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label><Choices label={`Frequência: ${FOOD_LABELS[food]}`} value={nutrition.frequencies[food] || ''} options={[[ 'rarely', 'Raramente'], ['weekly', 'Algumas vezes na semana'], ['daily', 'Diariamente'], ['multiple_daily', 'Várias vezes ao dia']]} onChange={frequency => patch({ nutrition: { ...nutrition, frequencies: { ...nutrition.frequencies, [food]: frequency } } })} /><p>Você pode selecionar outro hábito acima, se quiser. Vamos trabalhar só uma mudança por vez.</p><Choices label="Qual horário costuma ser mais difícil?" value={nutrition.hardestTime} options={[[ 'morning', 'Manhã'], ['afternoon', 'Tarde'], ['night', 'Noite'], ['late_night', 'Madrugada'], ['weekend', 'Fim de semana']]} onChange={hardestTime => patch({ nutrition: { ...nutrition, hardestTime } })} /></> : null}
    {key === 'distance' ? <label>Qual é a distância da prova (km)?<input type="number" min={1} max={42.2} step="0.1" value={a.targetDistanceKm || ''} onChange={e => patch({ targetDistanceKm: Number(e.target.value) })} /></label> : null}
    {key === 'confidence' ? <><h2>Vamos escolher um começo possível</h2><label>De 0 a 10, quanto acredita que consegue manter uma pequena meta?<input type="range" min={0} max={10} value={a.confidenceScore} onChange={e => patch({ confidenceScore: Number(e.target.value) })} /><output>{a.confidenceScore}/10</output></label><p>Podemos começar menor. O importante é encontrar algo que funcione para você.</p></> : null}
    {key === 'consent' ? <><h2>Sua jornada, seus dados</h2><p>Usaremos as respostas, o perfil necessário e suas atividades para acompanhar e ajustar esta jornada. O histórico é privado e você pode encerrar a jornada sem perder seus registros.</p><label><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} /> Concordo com esse uso dos dados para minha jornada.</label><p>Isso não autoriza pesquisa nem compartilhamento com profissionais. Não geramos dieta clínica nem substituímos avaliação de saúde.</p></> : null}
    {error ? <p role="alert" className="objective-warning">{error}</p> : null}<div className="objective-actions"><button type="button" disabled={step === 0 || busy} onClick={() => setStep(step - 1)}>VOLTAR</button><button type="button" className="objective-primary" disabled={busy} onClick={next}>{busy ? 'SALVANDO…' : step === steps.length - 1 ? 'CRIAR MEU OBJETIVO' : 'CONTINUAR'}<ArrowRight size={18} /></button></div>
  </section>;
}

function WeeklyCheckin({ weightRelevant, gradual, onSave, onBack, busy }: { weightRelevant: boolean; gradual: boolean; onSave: (a: WeeklyAnswers) => void; onBack: () => void; busy: boolean }) {
  const [a, setA] = useState<WeeklyAnswers>({ difficulty: 'appropriate', energy: 'fair', confidenceScore: 5, habitAdherence: 'partly', barrier: 'starting', safety: { ...blankSafety } });
  const [step, setStep] = useState(0);
  const patch = (v: Partial<WeeklyAnswers>) => setA(prev => ({ ...prev, ...v }));
  const total = weightRelevant ? 6 : 5;
  return <section className="objective-card"><small>REVISÃO DA SEMANA · {step + 1}/{total}</small><h2>Como essa semana ficou para você?</h2><p>As sessões já são contadas pelo app. Queremos saber como você se sentiu.</p>
    {step === 0 ? <Choices label="Dificuldade do cardio" value={a.difficulty} options={[[ 'easy', 'Muito fácil'], ['appropriate', 'Adequado'], ['hard', 'Difícil'], ['very_hard', 'Muito difícil']]} onChange={difficulty => patch({ difficulty })} /> : null}
    {step === 1 ? <Choices label="Como ficou sua energia?" value={a.energy} options={[[ 'poor', 'Ruim'], ['fair', 'Razoável'], ['good', 'Boa'], ['great', 'Ótima']]} onChange={energy => patch({ energy })} /> : null}
    {step === 2 ? <><Choices label="Conseguiu praticar o foco da semana?" value={a.habitAdherence} options={[[ 'yes', 'Consegui'], ['partly', 'Parcialmente'], ['no', 'Ainda não']]} onChange={habitAdherence => patch({ habitAdherence })} /><Choices label="O que mais atrapalhou?" value={a.barrier} options={Object.entries(barriers) as [WeeklyAnswers['barrier'], string][]} onChange={barrier => patch({ barrier })} /></> : null}
    {step === 3 ? <label>Quanto acredita que consegue cumprir a próxima semana?<input type="range" min={0} max={10} value={a.confidenceScore} onChange={e => patch({ confidenceScore: Number(e.target.value) })} /><output>{a.confidenceScore}/10</output></label> : null}
    {step === 4 ? <SafetyQuestion value={a.safety} onChange={safety => patch({ safety })} gradual={gradual} /> : null}
    {step === 5 ? <><p>Se houver uma pesagem confiável já sincronizada pelo Apple Saúde ou Health Connect nesta semana, vamos usá-la automaticamente.</p><label>Peso atual, apenas se quiser atualizar manualmente (kg)<input type="number" inputMode="decimal" min={30} max={350} step="0.1" value={a.weightKg || ''} onChange={e => patch({ weightKg: e.target.value ? Number(e.target.value) : undefined })} /></label><Choices label="Como ficou sua fome?" value={a.hunger || 'normal'} options={[[ 'low', 'Baixa'], ['normal', 'Normal'], ['high', 'Alta'], ['very_high', 'Muito alta']]} onChange={hunger => patch({ hunger })} /></> : null}
    <div className="objective-actions"><button type="button" onClick={() => step ? setStep(step - 1) : onBack()} disabled={busy}>VOLTAR</button><button type="button" className="objective-primary" disabled={busy || (step >= 4 && !a.safety.screened)} onClick={() => step === total - 1 ? onSave(a) : setStep(step + 1)}>{busy ? 'SALVANDO…' : step === total - 1 ? 'CONFIRMAR REVISÃO' : 'CONTINUAR'}</button></div>
  </section>;
}

export function CardioObjective() {
  const { user } = useUser();
  const navigate = useNavigate();
  const [view, setView] = useState<ObjectiveView | null>(null);
  const [history, setHistory] = useState<NonNullable<ObjectiveView['items']>>([]);
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [safety, setSafety] = useState<SafetyAnswers>({ ...blankSafety });
  const [rescheduleDate, setRescheduleDate] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setView(null); setError(''); setHistory([]); setHistoryCursor(null);
    objectiveRequest(undefined, '', controller.signal).then(setView).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [user?.uid]);
  const mutate = async (body: Record<string, unknown>) => {
    setBusy(true); setError('');
    try { setView(await objectiveRequest(body)); setReviewing(false); setResuming(false); }
    catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível salvar.'); }
    finally { setBusy(false); }
  };
  const j = view?.journey;
  const loadHistory = async (more = false) => {
    setBusy(true); setError('');
    try {
      const result = await objectiveRequest(undefined, `?history=true${more && historyCursor ? `&before=${encodeURIComponent(historyCursor)}` : ''}`);
      setHistory(previous => more ? [...previous, ...(result.items || [])] : result.items || []);
      setHistoryCursor(result.nextCursor || null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível carregar o histórico.'); }
    finally { setBusy(false); }
  };
  const next = view?.missions?.find(m => ['available', 'started'].includes(m.state)) as Mission | undefined;
  const completed = view?.missions?.filter(m => m.state === 'completed').length || 0;
  const latestWeight = view?.weights?.[0]?.kg;
  const reviewDue = !!j && Date.now() - Date.parse(j.weekStartedAt) >= 7 * 86400000;
  return createPortal(<main className="objective-page"><div className="objective-shell"><header><button aria-label="Voltar ao Cardio" onClick={() => navigate('/challenges/cardio')}><ArrowLeft /></button><InvictusLogo size={46} /><span>INVICTUS<small>PERFORMANCE</small></span></header><small>CARDIO</small><h1>{j ? 'MEU OBJETIVO' : 'BUSCAR OBJETIVO'}</h1>{error ? <p role="alert" className="objective-warning">{error}<button onClick={() => objectiveRequest().then(setView).catch(e => setError(e.message))}>TENTAR ATUALIZAR</button></p> : null}
    {!view && !error ? <p role="status">Preparando sua jornada…</p> : null}
    {view && !j ? <Onboarding view={view} busy={busy} onSave={answers => void mutate({ action: 'create', answers })} /> : null}
    {j && reviewing ? <WeeklyCheckin busy={busy} weightRelevant={j.goalType === 'lose_weight'} gradual={j.goalType === 'gradual_return'} onBack={() => setReviewing(false)} onSave={answers => void mutate({ action: 'review', journeyId: j.id, week: j.currentWeek, answers })} /> : null}
    {j && !reviewing ? <><section className="objective-card"><Target /><h2>{j.goalLabel}</h2>{j.outcome.weightKg && view?.baseline?.startingWeightKg ? <p>{view.baseline.startingWeightKg} kg → {j.outcome.weightKg} kg{latestWeight ? ` · Atual: ${latestWeight} kg` : ''}</p> : null}<p>Semana {j.currentWeek} · {completed} de {view?.missions?.length || 0} metas</p><progress value={completed} max={view?.missions?.length || 1} aria-label="Metas desta semana" /></section>
      {j.status === 'active' && next ? <section className="objective-card objective-next"><small>{reviewDue ? 'REVISÃO DA SEMANA' : `PRÓXIMA META · ${next.localDate.split('-').reverse().join('/')}`}</small><h2>{modalities[next.prescription.modality]}</h2><strong>{next.prescription.targetMetric === 'distance' ? `${next.prescription.distanceKm?.toLocaleString('pt-BR')} km` : `${next.prescription.durationMinutes} minutos`}</strong><p>{next.prescription.runSecondsPerInterval ? `Alterne ${next.prescription.runSecondsPerInterval}s de corrida leve com ${next.prescription.walkSecondsPerInterval}s caminhando. ` : ''}Mantenha um esforço confortável, em que consiga conversar.</p><button className="objective-primary" disabled={busy || reviewDue || next.localDate > localDate(new Date().toISOString(), j.timeZone)} onClick={() => navigate(`/challenges/cardio?journeyId=${j.id}&missionId=${next.id}&modality=${next.prescription.modality}`)}>{reviewDue ? 'FAÇA O CHECK-IN ABAIXO' : next.state === 'started' ? 'CONTINUAR NO CARDIO' : 'INICIAR NO CARDIO'}<ArrowRight size={18} /></button><button disabled={busy} onClick={() => { if (window.confirm('Esta meta ficou difícil? Vamos registrar e manter sua jornada para você retomar.')) void mutate({ action: 'skip', journeyId: j.id, missionId: next.id }); }}>HOJE NÃO CONSIGO</button></section> : j.status === 'active' ? <section className="objective-card"><Check /><h2>Metas desta semana registradas</h2><p>A próxima etapa será preparada após seu check-in.</p></section> : null}
      {j.status === 'paused' ? <section className="objective-card"><h2>Vamos cuidar do seu retorno</h2><p>{safetyDecision(j.safety, j.goalType === 'gradual_return').reason}</p>{!resuming ? <button onClick={() => setResuming(true)}>REAVALIAR MEU RETORNO</button> : <><SafetyQuestion value={safety} onChange={setSafety} gradual={j.goalType === 'gradual_return'} /><button disabled={busy || safetyDecision(safety, j.goalType === 'gradual_return').blocked} onClick={() => void mutate({ action: 'resume', journeyId: j.id, safety })}>RETOMAR</button></>}</section> : null}
      {j.status === 'active' && next?.state === 'started' ? <section className="objective-card"><p>Já finalizou o Cardio? Confira o registro salvo para atualizar sua meta, inclusive depois de reabrir o aplicativo.</p><button disabled={busy} onClick={() => void mutate({ action: 'complete', journeyId: j.id, missionId: next.id })}>SINCRONIZAR ATIVIDADE CONCLUÍDA</button></section> : null}
      {j.status === 'active' && next?.state === 'available' ? <section className="objective-card"><label>Precisa de outro dia nesta semana?<input type="date" value={rescheduleDate} min={localDate(new Date().toISOString(), j.timeZone)} max={localDate(new Date(Date.parse(j.weekStartedAt) + 6 * 86400000).toISOString(), j.timeZone)} onChange={e => setRescheduleDate(e.target.value)} /></label><button disabled={busy || !rescheduleDate} onClick={() => void mutate({ action: 'reschedule', journeyId: j.id, missionId: next.id, localDate: rescheduleDate })}>REAGENDAR META</button></section> : null}
      <section className="objective-card"><small>FOCO DA SEMANA</small><h2>{j.habit.text}</h2><p>Uma mudança possível de cada vez.</p></section>
      {view?.reviews?.[0] ? <section className="objective-card"><small>EVOLUÇÃO</small><p>{view.explanation?.text || view.reviews[0].reason}</p><p>{j.totalCompleted} metas concluídas desde o início.</p><button disabled={busy} onClick={() => void mutate({ action: 'explain', journeyId: j.id })}>EXPLICAR DE FORMA SIMPLES</button>{view.explanation?.source === 'gemini' ? <small>Explicação da Invictus IA; a decisão e os limites vêm dos motores de segurança.</small> : null}</section> : null}
      {j.consolidated ? <section className="objective-card"><Trophy /><h2>BASE CONSTRUÍDA</h2><p>Seu histórico mostra consistência ao longo de várias semanas. Essa evolução é sua.</p></section> : null}
      {view?.achievements?.length ? <section className="objective-card"><Trophy /><h2>CONQUISTAS</h2>{view.achievements.map(item => <p key={item.id}>{item.label} · {new Date(item.createdAt).toLocaleDateString('pt-BR')}</p>)}</section> : null}
      <section className="objective-card"><h2>{j.consolidated ? 'PRÓXIMO NÍVEL CONQUISTADO' : 'ACOMPANHAMENTO PROFISSIONAL'}</h2><p>{view?.professional?.kind === 'nutritionist' ? 'Nutricionista' : view?.professional?.kind === 'running_coach' ? 'Treinador de corrida' : view?.professional?.kind === 'physiotherapist' ? 'Fisioterapeuta' : 'Personal trainer'}: parcerias em preparação. Sua jornada continua aqui; consultas, condições comerciais e compartilhamento ainda não estão disponíveis.</p><button disabled>EM BREVE</button></section>
      {['completed', 'cancelled'].includes(j.status) ? <button disabled={busy} onClick={() => { setBusy(true); objectiveRequest(undefined, '?new=true').then(setView).catch(e => setError(e.message)).finally(() => setBusy(false)); }}>BUSCAR UM NOVO OBJETIVO</button> : null}
      <section className="objective-card"><button disabled={busy} onClick={() => void loadHistory()}>HISTÓRICO DE JORNADAS</button>{history.map(item => <button key={item.id} disabled={busy} onClick={() => { setBusy(true); objectiveRequest(undefined, `?journeyId=${encodeURIComponent(item.id)}`).then(setView).catch(e => setError(e.message)).finally(() => setBusy(false)); }}>{item.goalLabel} · {new Date(item.createdAt).toLocaleDateString('pt-BR')} · {{ active: 'Ativa', paused: 'Pausada', completed: 'Concluída', cancelled: 'Encerrada' }[item.status]}</button>)}{historyCursor ? <button disabled={busy} onClick={() => void loadHistory(true)}>CARREGAR MAIS</button> : null}</section>
      {['active', 'paused'].includes(j.status) ? <div className="objective-actions"><button disabled={busy || Date.now() - Date.parse(j.weekStartedAt) < 7 * 86400000} onClick={() => setReviewing(true)}>CHECK-IN SEMANAL</button>{j.status === 'active' ? <button disabled={busy} onClick={() => void mutate({ action: 'pause', journeyId: j.id })}>PAUSAR</button> : null}<button disabled={busy} onClick={() => { if (window.confirm('Encerrar esta jornada? O histórico será preservado.')) void mutate({ action: 'cancel', journeyId: j.id }); }}>ENCERRAR JORNADA</button></div> : <p>Jornada encerrada. Seus registros estão preservados.</p>}
    </> : null}<footer>Sem promessas de prazo, dietas clínicas ou substituição de avaliação profissional.</footer></div></main>, document.body);
}
