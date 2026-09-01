import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Activity, ArrowLeft, BarChart3, Bot, ChevronRight, Clock, Database, Heart, Info, Plus, ShieldCheck, Trophy, UserRound } from 'lucide-react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { useUser } from '../UserContext';
import { InvictusLogo } from '../components/InvictusLogo';
import { TimeRange } from '../core/performance/metricCatalog';
import { CalculatedMetricValue, processUserPerformance, RawWorkoutSession, UserPerformanceState } from '../core/performance/performanceEngine';
import { MetricMatrixModal } from '../components/performance/MetricMatrixModal';
import { TimelineView } from '../components/performance/TimelineView';
import { PerformanceAIModal } from '../components/performance/PerformanceAIModal';
import { ModuleDetailModal } from '../components/performance/ModuleDetailModal';
import { normalizeActivityValidationStatus, readActivityTimestamp } from '../lib/workoutData';
import './PerformanceNew.css';

type ModuleId = 'overview' | 'volume' | 'cardio' | 'energy' | 'recovery' | 'consistency' | 'records' | 'timeline';
const RANGES: { id: TimeRange; label: string }[] = [{id:'today',label:'HOJE'},{id:'7days',label:'7 DIAS'},{id:'30days',label:'30 DIAS'},{id:'90days',label:'90 DIAS'},{id:'1year',label:'1 ANO'},{id:'all',label:'TUDO'}];
const MODULES: { id: ModuleId; label: string; metrics: string[] }[] = [
  {id:'overview',label:'VISÃO GERAL',metrics:['total_volume_time','workout_count','avg_heart_rate','total_calories_burned']},
  {id:'volume',label:'TREINOS',metrics:['total_volume_time','workout_count','average_session_duration']},
  {id:'cardio',label:'CARDIO',metrics:['avg_heart_rate','max_heart_rate_session']},
  {id:'energy',label:'ENERGIA',metrics:['total_calories_burned','calorie_gate_ratio','acute_chronic_workload_ratio']},
  {id:'recovery',label:'RECUPERAÇÃO',metrics:['recovery_index','rest_interval_hours']},
  {id:'consistency',label:'CONSISTÊNCIA',metrics:['weekly_active_days','current_streak_days']},
  {id:'records',label:'RECORDES',metrics:[]},{id:'timeline',label:'LINHA DO TEMPO',metrics:[]}
];

export function Performance() {
  const { user } = useUser();
  const navigate = useNavigate();
  const [range, setRange] = useState<TimeRange>('7days');
  const [module, setModule] = useState<ModuleId>('overview');
  const [raw, setRaw] = useState<RawWorkoutSession[]>([]);
  const [state, setState] = useState<UserPerformanceState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [matrix, setMatrix] = useState(false);
  const [ai, setAi] = useState(false);
  const [metric, setMetric] = useState<CalculatedMetricValue | null>(null);
  const isPro = user?.subscriptionTier === 'performance' || user?.currentPlan === 'performance' || user?.isSubscribed === true || user?.premium === true;

  useEffect(() => {
    if (!user) return;
    let active = true;
    setLoading(true); setError('');
    getDocs(query(collection(db,'workouts'),where('userId','==',user.uid))).then(snapshot => {
      const sessions: RawWorkoutSession[] = snapshot.docs.flatMap(item => {
        const data = item.data();
        const timestamp = readActivityTimestamp(data.timestamp ?? data.createdAt);
        if (timestamp === null || normalizeActivityValidationStatus(data.validationStatus ?? data.status ?? data.validation?.status) !== 'validated') return [];
        const duration = Number(data.durationMinutes ?? data.duration);
        const avgHeartRate = Number(data.avgHeartRate ?? data.avgHr);
        const maxHeartRate = Number(data.maxHeartRate ?? data.maxHr);
        const calories = Number(data.caloriesBurned ?? data.calories);
        return [{id:item.id,userId:user.uid,timestamp,durationMinutes:Number.isFinite(duration)&&duration>=0?duration:0,avgHeartRate:Number.isFinite(avgHeartRate)&&avgHeartRate>0?avgHeartRate:undefined,maxHeartRate:Number.isFinite(maxHeartRate)&&maxHeartRate>0?maxHeartRate:undefined,caloriesBurned:Number.isFinite(calories)&&calories>=0?calories:0,workoutType:data.workoutType||data.type||'workout',workoutName:data.workoutName||data.title||data.type||'Atividade registrada',validationStatus:'validated',hasSensorData:Number.isFinite(avgHeartRate)&&avgHeartRate>0,hasGPSData:Boolean(data.distanceKm||data.gpsTracked)}];
      });
      if (active) setRaw(sessions);
    }).catch(reason => { if (active) setError(reason.message || 'Não foi possível carregar os dados.'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [user]);

  useEffect(() => {
    if (!user) return;
    setState(processUserPerformance(raw,{...user,uid:user.uid,name:user.name||user.displayName},range));
  }, [range, raw, user]);

  if (!user) return null;
  if (!isPro) return createPortal(<main className="pfn-screen"><div className="pfn-gate"><InvictusLogo size={72} /><small>INVICTUS PRO</small><h1>CENTRO DE PERFORMANCE</h1><p>Análises avançadas são liberadas no Plano Pro. Nenhuma métrica é estimada sem dados reais suficientes.</p><button onClick={() => navigate('/profile')}>VOLTAR AO PERFIL</button></div></main>,document.body);
  const activeConfig = MODULES.find(item => item.id === module)!;

  return createPortal(<main className="pfn-screen"><div className="pfn-page">
    <header className="pfn-header"><button onClick={() => navigate(-1)} aria-label="Voltar"><ArrowLeft /></button><div><InvictusLogo size={44}/><span><b>INVICTUS</b><small>PERFORMANCE</small></span></div><button onClick={() => setMatrix(true)} aria-label="Metodologia"><Info /></button></header>
    <section className="pfn-title"><small>CENTRO DE DADOS</small><h1>SUA <span>PERFORMANCE</span></h1><p>Análises calculadas exclusivamente com atividades validadas.</p></section>
    <nav className="pfn-ranges">{RANGES.map(item=><button key={item.id} className={range===item.id?'is-active':''} onClick={()=>setRange(item.id)}>{item.label}</button>)}</nav>
    {error ? <p className="pfn-error">{error}</p> : null}
    {loading || !state ? <section className="pfn-loading"><i/><p>Processando registros validados...</p></section> : <>
      <section className="pfn-readiness"><div><Activity/><span><small>PRONTIDÃO FISIOLÓGICA</small><h2>{state.readinessStatus.toUpperCase()}</h2><p>{state.readinessScore===null?'Dados de recuperação ainda insuficientes.':'Indicador calculado com os registros disponíveis.'}</p></span></div><b>{state.readinessScore??'—'}<small>{state.readinessScore!==null?'/100':''}</small></b></section>
      <nav className="pfn-modules">{MODULES.map(item=><button key={item.id} className={module===item.id?'is-active':''} onClick={()=>setModule(item.id)}>{item.label}</button>)}</nav>
      {module!=='records'&&module!=='timeline'?<section className="pfn-metrics">{activeConfig.metrics.map(id=><MetricCard key={id} metric={state.computedMetrics[id]} onClick={()=>setMetric(state.computedMetrics[id]||null)}/>)}</section>:null}
      {(module==='overview'||module==='cardio')?<section className="pfn-zones"><header><Heart/><h2>ZONAS CARDÍACAS</h2></header>{state.computedMetrics.hr_zones_distribution?.hasEnoughData?<div>{state.hrZones.map(zone=><article key={zone.zoneName}><span><b>{zone.zoneName}</b><small>{zone.range}</small></span><i><em style={{width:`${zone.percent}%`,backgroundColor:zone.color}}/></i><strong>{zone.percent}%</strong></article>)}</div>:<p>Sem frequência cardíaca real suficiente neste período.</p>}</section>:null}
      {module==='volume'?<section className="pfn-sessions"><header><Clock/><h2>SESSÕES VALIDADAS</h2><b>{state.timeframeWorkouts.length}</b></header>{state.timeframeWorkouts.length?state.timeframeWorkouts.map(item=><article key={item.id}><div><b>{item.workoutName}</b><small>{new Date(item.timestamp).toLocaleDateString('pt-BR')}</small></div><span>{item.durationMinutes>0?`${Math.round(item.durationMinutes)} min`:'—'}{item.avgHeartRate?<small>{Math.round(item.avgHeartRate)} bpm</small>:null}</span></article>):<p>Nenhuma sessão validada neste intervalo.</p>}</section>:null}
      {module==='records'?<section className="pfn-records">{state.personalRecords.length?state.personalRecords.map((item,index)=><article key={`${item.title}-${index}`}><Trophy/><small>{item.category}</small><h2>{item.title}</h2><b>{item.value}</b><span>{item.date}</span></article>):<p>Nenhum recorde validado disponível.</p>}</section>:null}
      {module==='timeline'?<section className="pfn-timeline"><TimelineView events={state.timelineEvents} userName={state.userName}/></section>:null}
      <section className="pfn-actions"><button onClick={()=>setMatrix(true)}><Database/>COMO CALCULAMOS</button><button onClick={()=>setAi(true)}><Bot/>ANALISAR COM IA</button></section>
    </>}
  </div>
  <MetricMatrixModal isOpen={matrix} onClose={()=>setMatrix(false)}/>{state?<PerformanceAIModal isOpen={ai} onClose={()=>setAi(false)} perfState={state}/>:null}<ModuleDetailModal isOpen={Boolean(metric)} onClose={()=>setMetric(null)} metricData={metric}/>
  <nav className="pfn-footer"><button onClick={()=>navigate('/')}><InvictusLogo size={24}/><span>Início</span></button><button onClick={()=>navigate('/championships')}><Trophy/><span>Campeonatos</span></button><button className="is-plus" onClick={()=>navigate('/musculacao')}><Plus/></button><button onClick={()=>navigate('/challenges')}><ShieldCheck/><span>Desafios</span></button><button onClick={()=>navigate('/profile')}><UserRound/><span>Perfil</span></button></nav>
  </main>,document.body);
}

function MetricCard({metric,onClick}:{metric?:CalculatedMetricValue;onClick:()=>void}) {
  if (!metric) return null;
  return <button className="pfn-metric" onClick={onClick}><header><BarChart3/><small>{metric.def.name}</small><em className={metric.reliability==='alta'?'is-high':''}>{metric.reliability}</em></header><div><b>{metric.hasEnoughData?metric.currentValue:'—'}</b><span>{metric.unit}</span></div><p>{metric.hasEnoughData?metric.def.simpleDescription:(metric.statusMessage||'Dados reais insuficientes.')}</p><footer>VER FONTE E CÁLCULO <ChevronRight/></footer></button>;
}
