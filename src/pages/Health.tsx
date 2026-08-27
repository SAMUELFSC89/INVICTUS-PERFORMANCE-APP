import React, { useEffect, useMemo, useState } from 'react';
import { Activity, ArrowLeft, CalendarDays, ChevronDown, ChevronRight, Clock3, Download, Dumbbell, Flame, Footprints, Heart, Info, MapPin, SlidersHorizontal } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { useUser } from '../UserContext';
import { RawWorkoutSession, processUserPerformance, UserPerformanceState } from '../core/performance/performanceEngine';
import { TimeRange } from '../core/performance/metricCatalog';
import { cn } from '../lib/utils';
import { normalizeActivityValidationStatus, readActivityTimestamp } from '../lib/workoutData';

const ranges: { id: TimeRange; label: string }[] = [
  { id: 'today', label: 'Hoje' },
  { id: '7days', label: '7 Dias' },
  { id: '30days', label: '30 Dias' },
  { id: '90days', label: '3 Meses' },
  { id: 'all', label: 'Personalizado' }
];

function formatDuration(minutes: number) {
  const total = Math.max(0, Math.round(minutes));
  return `${Math.floor(total / 60)}h ${String(total % 60).padStart(2, '0')}m`;
}

function metricNumber(state: UserPerformanceState, key: string) {
  return Number(state.computedMetrics[key]?.currentValue || 0);
}

function useHealthData(range: TimeRange) {
  const { user } = useUser();
  const [state, setState] = useState<UserPerformanceState | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let active = true;
    const load = async () => {
      setLoading(true);
      try {
        const snapshot = await getDocs(query(collection(db, 'workouts'), where('userId', '==', user.uid)));
        const workouts = snapshot.docs.reduce<RawWorkoutSession[]>((result, entry) => {
          const item = entry.data();
          const timestamp = readActivityTimestamp(item.timestamp) ?? readActivityTimestamp(item.createdAt);
          const validationStatus = normalizeActivityValidationStatus(item.validationStatus ?? item.status ?? item.validation?.status);
          // A tela de saúde é uma fonte de dados reais: registros sem data
          // válida ou ainda não homologados não entram em relatórios.
          if (!timestamp || validationStatus !== 'validated') return result;
          result.push({
            id: entry.id,
            userId: item.userId || user.uid,
            timestamp,
            durationMinutes: Number(item.durationMinutes) || Number(item.duration) || 0,
            avgHeartRate: Number(item.avgHeartRate) || Number(item.avgHr) || 0,
            maxHeartRate: Number(item.maxHeartRate) || Number(item.maxHr) || 0,
            caloriesBurned: Number(item.caloriesBurned) || Number(item.calories) || 0,
            distanceKm: Number(item.distanceKm) || Number(item.distance) || 0,
            workoutType: item.workoutType || item.type || 'activity',
            workoutName: item.workoutName || item.title || item.cardioTypeLabel || 'Atividade registrada',
            validationStatus,
            hasSensorData: Boolean(item.avgHeartRate || item.maxHeartRate),
            hasGPSData: Boolean(item.distanceKm || item.distance || item.gpsTracked)
          });
          return result;
        }, []);
        if (active) setState(processUserPerformance(workouts, { ...user, uid: user.uid, name: user.name || user.displayName }, range));
      } catch (error) {
        console.error('[Health] Não foi possível carregar os dados de saúde:', error);
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    return () => { active = false; };
  }, [range, user]);

  return { user, state, loading };
}

function HealthHeader({ title, subtitle, onBack, right }: { title: string; subtitle: string; onBack: () => void; right?: React.ReactNode }) {
  return <header className="health-header"><button aria-label="Voltar" onClick={onBack} className="health-back"><ArrowLeft /></button><div className="health-heading"><div><h1>{title}</h1><span className="health-pro">PRO</span></div><p>{subtitle}</p></div>{right}</header>;
}

function PeriodControl({ value, onChange, compact = false }: { value: TimeRange; onChange: (value: TimeRange) => void; compact?: boolean }) {
  if (compact) return <div className="health-period-bar"><span>PERÍODO</span>{ranges.map((range) => <button key={range.id} onClick={() => onChange(range.id)} className={cn(value === range.id && 'is-selected')}>{range.label}</button>)}<CalendarDays aria-hidden="true" /></div>;
  const selected = ranges.find((item) => item.id === value) || ranges[1];
  return <button className="health-period-picker" onClick={() => onChange(value === '7days' ? '30days' : '7days')}><CalendarDays />{selected.label.toUpperCase()}<ChevronDown /></button>;
}

function MetricCard({ icon, label, value, unit, detail, tone = 'gold', progress }: { icon: React.ReactNode; label: string; value: string | number; unit?: string; detail: string; tone?: 'gold' | 'red'; progress?: number }) {
  return <article className="health-metric"><div className={cn('health-metric-icon', tone === 'red' && 'is-red')}>{icon}</div><span>{label}</span><strong>{value}<small>{unit}</small></strong><p>{detail}</p>{progress !== undefined && <div className="health-small-progress"><b style={{ width: `${Math.min(100, progress)}%` }} /></div>}</article>;
}

function ChartBars({ points, color = 'gold' }: { points: { value: number; label: string }[]; color?: 'gold' | 'violet' }) {
  if (!points.length) return <p className="health-empty">Sem dados registrados para este gráfico.</p>;
  const max = Math.max(...points.map((item) => item.value), 1);
  return <div className={cn('health-chart-bars', color === 'violet' && 'is-violet')} aria-label="Gráfico de tendência">{points.map((point, index) => <div key={`${point.label}-${index}`}><i style={{ height: `${Math.max(4, Math.round((point.value / max) * 100))}%` }} /><span>{point.label}</span></div>)}</div>;
}

function HeartLineChart({ points }: { points: { value: number; label: string }[] }) {
  const values = points.length ? points.map((point) => Number.isFinite(point.value) ? point.value : 0) : [0, 0, 0, 0, 0, 0, 0];
  const min = Math.min(...values);
  const max = Math.max(...values, min + 1);
  const coordinates = values.map((value, index) => {
    const x = values.length === 1 ? 125 : (index / (values.length - 1)) * 250;
    const y = 48 - ((value - min) / (max - min)) * 38;
    return `${x.toFixed(1)} ${y.toFixed(1)}`;
  });
  const path = `M${coordinates.join(' L')}`;
  const peak = values.indexOf(max);
  const [peakX, peakY] = (coordinates[peak] || '125 29').split(' ');
  return <div className="health-heart-line" aria-label="Variação da frequência cardíaca média"><svg viewBox="0 0 250 58" role="img" aria-label="Linha de frequência cardíaca"><defs><linearGradient id="health-heart-gradient" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stopColor="#ff9235" /><stop offset=".48" stopColor="#ff3f4c" /><stop offset="1" stopColor="#ff752e" /></linearGradient></defs><path className="health-heart-line-glow" d={path} /><path className="health-heart-line-trace" d={path} /><circle className="health-heart-line-dot" cx={peakX} cy={peakY} r="3" /></svg></div>;
}

function ZoneChart({ state, onDetails }: { state: UserPerformanceState; onDetails?: () => void }) {
  const total = metricNumber(state, 'total_volume_time');
  const zones = state.hrZones;
  const hasZoneData = Boolean(state.computedMetrics.hr_zones_distribution?.hasEnoughData);
  if (!hasZoneData) return <article className="health-zone-card"><div className="health-section-name">DISTRIBUIÇÃO DE ZONAS CARDÍACAS <Info /></div><p className="health-empty">Conecte um sensor que registre zonas cardíacas para visualizar esta distribuição.</p></article>;
  const stops = zones.reduce<string[]>((result, zone, index) => {
    const previous = zones.slice(0, index).reduce((sum, item) => sum + item.percent, 0);
    return [...result, `${zone.color} ${previous}% ${previous + zone.percent}%`];
  }, []);
  return <article className="health-zone-card"><div className="health-section-name">DISTRIBUIÇÃO DE ZONAS CARDÍACAS <Info /></div><div className="health-zone-body"><div className="health-donut" style={{ background: `conic-gradient(${stops.join(',')})` }}><div><small>Tempo total</small><strong>{formatDuration(total)}</strong></div></div><div className="health-zone-list">{zones.map((zone) => <div key={zone.zoneName}><i style={{ background: zone.color, boxShadow: `0 0 9px ${zone.color}` }} /><span>{zone.zoneName.replace(/ \(.+\)/, '')}</span><b>{formatDuration(zone.minutes)}</b><em>{zone.percent}%</em></div>)}</div></div>{onDetails && <button onClick={onDetails} className="health-card-link">VER DETALHES <ChevronRight /></button>}</article>;
}

function LatestWorkouts({ state, expanded, onToggle }: { state: UserPerformanceState; expanded: boolean; onToggle: () => void }) {
  const allWorkouts = [...state.timeframeWorkouts].sort((a, b) => b.timestamp - a.timestamp);
  const workouts = expanded ? allWorkouts : allWorkouts.slice(0, 2);
  return <article id="health-activities" className="health-latest"><div className="health-section-line"><div>ÚLTIMOS TREINOS</div><button type="button" onClick={onToggle}>{expanded ? 'MOSTRAR MENOS' : 'VER TODOS'}</button></div>{workouts.length ? workouts.map((workout) => { const isRun = /corrida|run/i.test(workout.workoutType || ''); return <div className="health-workout" key={workout.id}><span className={cn('health-workout-icon', isRun && 'is-run')}>{isRun ? <Footprints /> : <Dumbbell />}</span><div><b>{workout.workoutName}</b><small>{new Date(workout.timestamp).toLocaleDateString('pt-BR', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</small></div><span><Clock3 />{formatDuration(workout.durationMinutes)}</span><span><Flame />{Math.round(workout.caloriesBurned || 0)} kcal</span><span><Heart />{workout.avgHeartRate || '—'} bpm</span><ChevronRight /></div>; }) : <p className="health-empty">Quando seu próximo treino for validado, ele aparecerá aqui.</p>}</article>;
}

function HealthSummaryContent({ state, onReport }: { state: UserPerformanceState; onReport: () => void }) {
  const [activeTab, setActiveTab] = useState<'summary' | 'report'>('summary');
  const [activitiesExpanded, setActivitiesExpanded] = useState(false);
  const calories = metricNumber(state, 'total_calories_burned');
  const minutes = metricNumber(state, 'total_volume_time');
  const workouts = metricNumber(state, 'workout_count');
  const heartRate = metricNumber(state, 'avg_heart_rate');
  const lastWorkout = [...state.timeframeWorkouts].sort((a, b) => b.timestamp - a.timestamp)[0];
  const lastUpdate = lastWorkout ? new Date(lastWorkout.timestamp).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : null;

  return (
    <>
      <div className="health-tabs">
        <button className={activeTab === 'summary' ? 'is-active' : ''} onClick={() => setActiveTab('summary')}>
          RESUMO
        </button>
        <button className={activeTab === 'report' ? 'is-active' : ''} onClick={() => { setActiveTab('report'); onReport(); }}>
          RELATÓRIOS
        </button>
      </div>

      <section id="health-overview" className="health-overview">
        <div className="health-section-line">
          <div><Activity /> VISÃO GERAL</div>
          <small>{lastUpdate ? `Última atividade: ${lastUpdate}` : 'Nenhuma atividade sincronizada'} <span>●</span></small>
        </div>
        <div className="health-metrics-grid">
          <MetricCard 
            icon={<Flame />} 
            label="CALORIAS" 
            value={calories.toLocaleString('pt-BR')} 
            unit="kcal" 
            detail={state.computedMetrics.total_calories_burned?.hasEnoughData ? `Média por sessão: ${workouts ? Math.round(calories / workouts) : 0} kcal` : 'Sem calorias registradas'} 
          />
          <MetricCard 
            icon={<Clock3 />} 
            label="TEMPO ATIVO" 
            value={formatDuration(minutes)} 
            detail={workouts ? `Média por sessão: ${formatDuration(minutes / workouts)}` : 'Sem sessões homologadas'} 
          />
          <MetricCard 
            icon={<Dumbbell />} 
            label="TREINOS" 
            value={workouts} 
            detail="Sessões homologadas no período" 
            progress={workouts ? Math.min(100, Number(state.computedMetrics.weekly_active_days?.currentValue || 0) * 20) : 0} 
          />
          <MetricCard 
            icon={<Heart />} 
            label="FC MÉDIA" 
            value={heartRate || '—'} 
            unit={heartRate ? 'bpm' : ''} 
            detail={heartRate ? 'Dados reais do sensor' : 'Conecte o relógio'} 
            tone="red" 
          />
        </div>
      </section>

      <LatestWorkouts state={state} expanded={activitiesExpanded} onToggle={() => setActivitiesExpanded(value => !value)} />
    </>
  );
}

export function Health() {
  const navigate = useNavigate();
  const [range, setRange] = useState<TimeRange>('7days');
  const { user, state, loading } = useHealthData(range);
  if (!user) return null;
  if (loading || !state) return <div className="health-screen health-loading">Preparando os seus dados de saúde…</div>;
  return (
    <main className="health-screen">
      <div className="health-content">
        <HealthHeader 
          title="SAÚDE" 
          subtitle="Sua saúde. Seus dados. Seu desempenho." 
          onBack={() => navigate('/profile')} 
          right={<PeriodControl value={range} onChange={setRange} />} 
        />
        <HealthSummaryContent 
          state={state} 
          onReport={() => navigate('/health/report')} 
        />
      </div>
    </main>
  );
}

export function HealthReport() {
  const navigate = useNavigate();
  const [range, setRange] = useState<TimeRange>('30days');
  const [filterOpen, setFilterOpen] = useState(false);
  const [activitiesExpanded, setActivitiesExpanded] = useState(false);
  const { user, state, loading } = useHealthData(range);
  const weeklyRows = useMemo(() => state?.timeframeWorkouts.slice(-6).reverse() || [], [state]);
  if (!user) return null;
  if (loading || !state) return <div className="health-screen health-loading">Gerando relatório de saúde…</div>;
  const calories = metricNumber(state, 'total_calories_burned');
  const active = metricNumber(state, 'total_volume_time');
  const heartRate = metricNumber(state, 'avg_heart_rate');
  const workoutCount = metricNumber(state, 'workout_count');
  const points = state.computedMetrics.total_calories_burned?.historyPoints.map((item) => ({ label: item.date, value: item.value })) || [];
  const allActivities = [...state.timeframeWorkouts].sort((a, b) => b.timestamp - a.timestamp);
  const distance = state.timeframeWorkouts.reduce((sum, workout) => sum + (workout.distanceKm || 0), 0);
  const heartPoints = state.computedMetrics.avg_heart_rate?.historyPoints.map((item) => ({ label: item.date, value: item.value })) || [];
  return <main className="health-screen"><div className="health-content health-report"><HealthHeader title="RELATÓRIO DE SAÚDE" subtitle="Análise completa do seu desempenho e evolução." onBack={() => navigate('/health')} right={<div className="health-report-actions"><button onClick={() => window.print()}><Download />EXPORTAR</button><button onClick={() => setFilterOpen(value => !value)} aria-expanded={filterOpen}><SlidersHorizontal />FILTRAR</button></div>} />{filterOpen && <div className="health-period-bar">{ranges.map(item => <button key={item.id} className={range === item.id ? 'is-selected' : ''} onClick={() => { setRange(item.id); setFilterOpen(false); }}>{item.label}</button>)}</div>}<PeriodControl value={range} onChange={setRange} compact /><section className="health-report-metrics"><MetricCard icon={<Flame />} label="CALORIAS" value={state.computedMetrics.total_calories_burned?.hasEnoughData ? calories.toLocaleString('pt-BR') : '—'} unit={state.computedMetrics.total_calories_burned?.hasEnoughData ? 'kcal' : ''} detail="Total registrado no período" /><MetricCard icon={<Clock3 />} label="TEMPO ATIVO" value={formatDuration(active)} detail="Total do período" /><MetricCard icon={<Dumbbell />} label="TREINOS" value={workoutCount} detail="Sessões homologadas" /><MetricCard icon={<Heart />} label="FC MÉDIA" value={heartRate || '—'} unit={heartRate ? 'bpm' : ''} detail="Dados do sensor" tone="red" /><MetricCard icon={<MapPin />} label="DISTÂNCIA" value={distance > 0 ? distance.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) : '—'} unit={distance > 0 ? 'km' : ''} detail={distance > 0 ? 'GPS registrado' : 'Sem percurso GPS no período'} /></section><section className="health-report-chart"><div><h2>TENDÊNCIA DE CALORIAS <Info /></h2><strong>{state.computedMetrics.total_calories_burned?.hasEnoughData ? calories.toLocaleString('pt-BR') : '—'} <small>{state.computedMetrics.total_calories_burned?.hasEnoughData ? 'kcal' : ''}</small></strong><p>Total de calorias registradas no período</p></div><ChartBars points={points} /></section><section className="health-dual health-report-dual"><ZoneChart state={state} onDetails={() => document.getElementById('health-report-heart')?.scrollIntoView({ behavior: 'smooth', block: 'start' })} /><article id="health-report-heart" className="health-trend-card"><div className="health-section-name">FC MÉDIA (POR DIA) <Info /></div><strong>{heartRate || '—'} <small>{heartRate ? 'bpm' : ''}</small></strong><p>{heartRate ? 'Média dos dados sincronizados' : 'Conecte um sensor cardíaco'}</p><ChartBars points={heartPoints} color="violet" /><button onClick={() => document.getElementById('health-report-heart')?.scrollIntoView({ behavior: 'smooth', block: 'center' })} className="health-card-link">VER DETALHES DE FC <ChevronRight /></button></article></section><section className="health-dual"><article className="health-activity-card"><div className="health-section-name">ATIVIDADE POR TIPO <Info /></div><div className="health-activity-total"><strong>{workoutCount}</strong><span>Treinos</span></div><button onClick={() => setActivitiesExpanded(value => !value)} className="health-card-link">{activitiesExpanded ? 'MOSTRAR MENOS' : 'VER TODOS OS TREINOS'} <ChevronRight /></button></article><article className="health-weekly-card"><div className="health-section-name">RESUMO SEMANAL <Info /></div>{weeklyRows.length ? weeklyRows.map((workout) => <div key={workout.id}><span>{new Date(workout.timestamp).toLocaleDateString('pt-BR')}</span><b>{workout.caloriesBurned ? `${Math.round(workout.caloriesBurned)} kcal` : '—'}</b><span>{formatDuration(workout.durationMinutes)}</span></div>) : <p className="health-empty">Nenhuma atividade no período.</p>}</article></section>{activitiesExpanded && <LatestWorkouts state={{ ...state, timeframeWorkouts: allActivities } as UserPerformanceState} expanded onToggle={() => setActivitiesExpanded(false)} />}<section className="health-advanced"><div className="health-section-name">MÉTRICAS AVANÇADAS <Info /></div><div><span>VO₂ MÁX. ESTIMADO <b>{state.computedMetrics.vo2max_estimate?.hasEnoughData ? metricNumber(state, 'vo2max_estimate').toLocaleString('pt-BR', { maximumFractionDigits: 1 }) : '—'}</b><small>{state.computedMetrics.vo2max_estimate?.hasEnoughData ? 'ml/kg/min (estimado)' : (state.computedMetrics.vo2max_estimate?.statusMessage || 'Requer corrida/caminhada com GPS + FC')}</small></span><span>CARGA DE TREINO <b>{state.computedMetrics.acute_chronic_workload_ratio?.hasEnoughData ? metricNumber(state, 'acute_chronic_workload_ratio') : '—'}</b><small>{state.computedMetrics.acute_chronic_workload_ratio?.statusMessage || 'Requer carga registrada'}</small></span><span>RECUPERAÇÃO <b>{state.computedMetrics.recovery_index?.hasEnoughData ? `${metricNumber(state, 'recovery_index')}%` : '—'}</b><small>{state.readinessStatus}</small></span><span>ÍNDICE DE CONSISTÊNCIA <b>{state.computedMetrics.consistency_index?.hasEnoughData ? `${metricNumber(state, 'consistency_index')}%` : '—'}</b><small>{state.computedMetrics.consistency_index?.hasEnoughData ? 'da meta de 5 dias/semana' : (state.computedMetrics.consistency_index?.statusMessage || 'Requer métrica auditada')}</small></span></div></section></div></main>;
}
