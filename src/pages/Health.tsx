import React, { useEffect, useMemo, useState } from 'react';
import { Activity, AlertCircle, ArrowLeft, CalendarDays, ChevronDown, ChevronRight, Clock3, Download, Dumbbell, FileDown, Flame, Footprints, Heart, HeartPulse, Info, MapPin, Moon, ShieldCheck, SlidersHorizontal } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { useUser } from '../UserContext';
import { RawWorkoutSession, processUserPerformance, UserPerformanceState } from '../core/performance/performanceEngine';
import { TimeRange } from '../core/performance/metricCatalog';
import { cn } from '../lib/utils';
import { normalizeActivityValidationStatus, readActivityTimestamp } from '../lib/workoutData';
import { healthSummaryService, HealthSummaryResponse } from '../services/healthSummaryService';

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

function formatUltimaLeitura(timestamp?: string | null): string {
  if (!timestamp) return '';
  const data = new Date(timestamp);
  if (Number.isNaN(data.getTime())) return '';
  return data.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function trendPontos(entradas: Array<{ timestamp: string; value: number }>, maxPontos = 14): { value: number; label: string }[] {
  return entradas.slice(-maxPontos).map((item) => {
    const data = new Date(item.timestamp);
    const label = Number.isNaN(data.getTime()) ? '' : data.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    return { value: item.value, label };
  });
}

// #69: comparação simples "valor mais recente vs média dos 7 dias
// anteriores", usada nos cards e no bloco de tendências. Exige pelo menos
// 2 pontos ANTES da janela dos últimos 7 dias -- sem isso, retorna null em
// vez de inventar uma comparação a partir de amostra insuficiente (mesma
// filosofia de mediaAntesDepois() em healthSummaryService.ts).
interface DeltaInfo { direction: 'up' | 'down' | 'neutral'; diff: number; media: number; }

function deltaVs7Dias(pontos: Array<{ timestamp: string; value: number }> | undefined, valorAtual: number | null): DeltaInfo | null {
  if (!pontos || pontos.length < 3 || valorAtual === null || !Number.isFinite(valorAtual)) return null;
  const seteDiasAtras = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const anteriores = pontos.filter((p) => {
    const t = new Date(p.timestamp).getTime();
    return Number.isFinite(t) && t < seteDiasAtras;
  });
  if (anteriores.length < 2) return null;
  const media = anteriores.reduce((soma, p) => soma + p.value, 0) / anteriores.length;
  if (!Number.isFinite(media) || media === 0) return null;
  const diff = valorAtual - media;
  const direction = Math.abs(diff) < media * 0.01 ? 'neutral' : diff > 0 ? 'up' : 'down';
  return { direction, diff, media };
}

function formatDeltaCurto(delta: DeltaInfo, unidade: string, casasDecimais = 0): string {
  const seta = delta.direction === 'up' ? '↑' : delta.direction === 'down' ? '↓' : '→';
  const valorAbs = Math.abs(delta.diff).toLocaleString('pt-BR', { maximumFractionDigits: casasDecimais });
  return `${seta} ${valorAbs}${unidade ? ` ${unidade}` : ''}`;
}

// #69: "Melhorando/Estável/Observar" -- rótulo textual do bloco de
// Tendências. `direcaoBoa` indica qual direção do delta é considerada
// favorável para aquela métrica especificamente (ex.: FC repouso menor é
// tipicamente favorável, então direcaoBoa='down'; HRV e sono maiores são
// tipicamente favoráveis, então direcaoBoa='up'). Isso é só um rótulo
// visual de referência rápida, não uma avaliação clínica.
function statusPalavra(delta: DeltaInfo | null, direcaoBoa: 'up' | 'down'): string {
  if (!delta) return 'Sem dados';
  if (delta.direction === 'neutral') return 'Estável';
  return delta.direction === direcaoBoa ? 'Melhorando' : 'Observar';
}

function formatRelativo(timestamp?: string | null): string {
  if (!timestamp) return '';
  const data = new Date(timestamp);
  if (Number.isNaN(data.getTime())) return '';
  const diffMin = Math.floor((Date.now() - data.getTime()) / 60000);
  if (diffMin < 2) return 'agora há pouco';
  if (diffMin < 60) return `há ${diffMin} min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `há ${diffH}h`;
  const diffDias = Math.floor(diffH / 24);
  return diffDias === 1 ? 'há 1 dia' : `há ${diffDias} dias`;
}

interface EstadoHojeResultado { status: string; descricao: string; cor: string; }

// #69: heurística simples e NÃO-CLÍNICA para resumir o "estado de hoje" a
// partir de 3 sinais que já temos (FC repouso, HRV, sono), comparando o
// valor mais recente com a média dos 7 dias anteriores. NÃO é diagnóstico
// nem substitui orientação profissional -- é só um resumo visual rápido,
// e a própria tela deixa isso explícito. Com menos de 2 sinais disponíveis,
// mostra "sem dados suficientes" em vez de inventar um status.
function calcularEstadoDeHoje(fcDelta: DeltaInfo | null, hrvDelta: DeltaInfo | null, sonoDelta: DeltaInfo | null): EstadoHojeResultado {
  const sinaisDisponiveis = [fcDelta, hrvDelta, sonoDelta].filter((d) => d !== null).length;
  if (sinaisDisponiveis < 2) {
    return {
      status: 'SEM DADOS SUFICIENTES',
      descricao: 'Sincronize mais alguns dias de FC de repouso, HRV ou sono para ver um resumo do seu estado de hoje.',
      cor: '#8a8580'
    };
  }
  let pontos = 0;
  if (fcDelta) pontos += fcDelta.direction === 'down' ? 1 : fcDelta.direction === 'up' ? -1 : 0;
  if (hrvDelta) pontos += hrvDelta.direction === 'up' ? 1 : hrvDelta.direction === 'down' ? -1 : 0;
  if (sonoDelta) pontos += sonoDelta.direction === 'up' ? 1 : sonoDelta.direction === 'down' ? -1 : 0;

  if (pontos >= 2) return { status: 'MUITO BOM', descricao: 'Seus sinais recentes de FC de repouso, HRV e sono estão melhores do que a sua média dos últimos dias.', cor: '#46d47b' };
  if (pontos === 1) return { status: 'BOM', descricao: 'A maioria dos seus sinais recentes está estável ou melhorando em relação à sua média dos últimos dias.', cor: '#8fd47b' };
  if (pontos === 0) return { status: 'ESTÁVEL', descricao: 'Seus sinais recentes estão próximos da sua média dos últimos dias, sem grandes variações.', cor: '#ffb000' };
  return { status: 'ATENÇÃO', descricao: 'Alguns sinais recentes (FC de repouso, HRV ou sono) estão piores do que a sua média dos últimos dias. Considere priorizar recuperação.', cor: '#ff8a5b' };
}

function MiniSparkline({ points, color = '#ffb000' }: { points: number[]; color?: string }) {
  if (!points || points.length < 2) return null;
  const min = Math.min(...points);
  const max = Math.max(...points, min + 1);
  const largura = 100;
  const altura = 28;
  const coords = points.map((valor, indice) => {
    const x = (indice / (points.length - 1)) * largura;
    const y = altura - ((valor - min) / (max - min || 1)) * (altura - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg className="health-metric-spark" viewBox={`0 0 ${largura} ${altura}`} preserveAspectRatio="none" aria-hidden="true">
      <polyline points={coords.join(' ')} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// #253: leitura da Health Data Layer (health_samples) -- FC repouso, HRV,
// sono e passos. Puramente leitura, atualiza sozinho depois do primeiro
// carregamento, sem bloquear a tela (o RESUMO já mostra o que vier de
// `workouts`/performanceEngine enquanto isso).
function useHealthSummary() {
  const [summary, setSummary] = useState<HealthSummaryResponse | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(true);

  useEffect(() => {
    let active = true;
    healthSummaryService.fetchSummary().then((data) => {
      if (active) { setSummary(data); setLoadingSummary(false); }
    });
    return () => { active = false; };
  }, []);

  return { summary, loadingSummary };
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

const CORES_POR_TOM: Record<string, string> = { gold: '#ffb000', red: '#ff515b', violet: '#b98bff', blue: '#4d9fff', green: '#46d47b' };

function MetricCard({
  icon, label, value, unit, detail, tone = 'gold', progress, onTap, delta, deltaUnit = '', deltaDecimais = 0, sparklinePoints
}: {
  icon: React.ReactNode; label: string; value: string | number; unit?: string; detail: string;
  tone?: 'gold' | 'red' | 'violet' | 'blue' | 'green'; progress?: number; onTap?: () => void;
  delta?: DeltaInfo | null; deltaUnit?: string; deltaDecimais?: number; sparklinePoints?: number[];
}) {
  const cor = CORES_POR_TOM[tone] || CORES_POR_TOM.gold;
  const conteudo = <>
    <div className="health-metric-top">
      <div className={cn('health-metric-icon', tone === 'red' && 'is-red')} style={{ color: cor }}>{icon}</div>
      {onTap && <ChevronRight className="health-metric-chevron" aria-hidden="true" />}
    </div>
    <span>{label}</span>
    <strong>{value}<small>{unit}</small></strong>
    <p>{detail}</p>
    {delta && (
      <div className="health-metric-delta" style={{ color: cor }}>
        {formatDeltaCurto(delta, deltaUnit, deltaDecimais)} vs média 7 dias
      </div>
    )}
    {progress !== undefined && <div className="health-small-progress"><b style={{ width: `${Math.min(100, progress)}%` }} /></div>}
    {sparklinePoints && sparklinePoints.length >= 2 && <MiniSparkline points={sparklinePoints} color={cor} />}
  </>;
  if (onTap) {
    return <article role="button" tabIndex={0} onClick={onTap} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onTap(); } }} className="health-metric is-tappable">{conteudo}</article>;
  }
  return <article className="health-metric">{conteudo}</article>;
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

type SaudeTab = 'resumo' | 'coracao' | 'recuperacao' | 'atividade' | 'energia' | 'performance';

const SAUDE_TABS: { id: SaudeTab; label: string }[] = [
  { id: 'resumo', label: 'RESUMO' },
  { id: 'coracao', label: 'CORAÇÃO' },
  { id: 'recuperacao', label: 'RECUPERAÇÃO' },
  { id: 'atividade', label: 'ATIVIDADE' },
  { id: 'energia', label: 'ENERGIA' },
  { id: 'performance', label: 'PERFORMANCE' }
];

// #253/#53: bloco de Gasto Energético -- SEMPRE com o disclaimer. Regra
// explícita do usuário: nunca chamar isso de "kg perdidos". É só uma
// equivalência energética (1kg de gordura ≈ 7700kcal), não uma medida real
// de emagrecimento (que depende de ingestão, hidratação, sono, hormônios...).
const KCAL_POR_KG_GORDURA = 7700;

function EnergyBlock({ calories }: { calories: number }) {
  const kgEquivalente = calories > 0 ? calories / KCAL_POR_KG_GORDURA : 0;
  return (
    <article className="health-overview health-energy-card">
      <div className="health-section-line"><div><Flame /> GASTO ENERGÉTICO</div></div>
      <div className="health-energy-row">
        <div className="health-energy-icon"><Flame /></div>
        <div className="health-energy-values">
          <div className="health-energy-value"><strong>{calories.toLocaleString('pt-BR')}</strong><span>kcal no período</span></div>
          {calories > 0
            ? <div className="health-energy-kg">≈ {kgEquivalente.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} kg de gordura*</div>
            : <div className="health-energy-kg">Sem calorias registradas no período.</div>}
        </div>
      </div>
      <div className="health-energy-disclaimer">
        <AlertCircle />
        <span>*Equivalência energética, não peso realmente perdido — depende de ingestão, hidratação, sono e hormônios.</span>
      </div>
    </article>
  );
}

// #69: bloco "Estado de Hoje" -- combina o status calculado (ver
// calcularEstadoDeHoje, heurística simples e não-clínica) com a arte
// oficial enviada pelo usuário (public/estado-de-hoje.webp), posicionada ao
// lado do texto em vez de como imagem de topo isolada.
function EstadoDeHojeCard({ fcDelta, hrvDelta, sonoDelta, ultimaAtualizacao }: {
  fcDelta: DeltaInfo | null; hrvDelta: DeltaInfo | null; sonoDelta: DeltaInfo | null; ultimaAtualizacao: string | null;
}) {
  const resultado = calcularEstadoDeHoje(fcDelta, hrvDelta, sonoDelta);
  const relativo = formatRelativo(ultimaAtualizacao);
  return (
    <article className="health-hoje-card">
      <div className="health-hoje-text">
        <span className="health-hoje-label">ESTADO DE HOJE</span>
        <div className="health-hoje-status" style={{ color: resultado.cor }}>
          <ShieldCheck aria-hidden="true" /> {resultado.status}
        </div>
        <p>{resultado.descricao}</p>
        {relativo && <span className="health-hoje-updated">Atualizado {relativo}</span>}
      </div>
      <img src="/estado-de-hoje.webp" alt="Invictus" className="health-hoje-art" />
    </article>
  );
}

function HealthSummaryContent({ state, summary, loadingSummary, onGenerateReport, onOpenLegacyReport }: {
  state: UserPerformanceState;
  summary: HealthSummaryResponse | null;
  loadingSummary: boolean;
  onGenerateReport: () => void;
  onOpenLegacyReport: () => void;
}) {
  const [activeTab, setActiveTab] = useState<SaudeTab>('resumo');
  const [activitiesExpanded, setActivitiesExpanded] = useState(false);

  const calories = metricNumber(state, 'total_calories_burned');
  const minutes = metricNumber(state, 'total_volume_time');
  const workouts = metricNumber(state, 'workout_count');
  const heartRateAvg = metricNumber(state, 'avg_heart_rate');

  const fcRepouso = summary?.latest.heart_rate_resting || null;
  const hrv = summary?.latest.hrv_rmssd || null;
  const sono = summary?.latest.sleep_duration_min || null;
  const passos = summary?.latest.steps_daily || null;

  const semDado = loadingSummary ? 'Carregando…' : 'Sem dados sincronizados';

  // #69: séries de tendência (health_samples) usadas para os deltas "vs
  // média 7 dias" e as mini-sparklines dos cards, além do bloco de
  // Tendências. Cada uma vem direto de /api/health-summary -- nenhum valor
  // é inventado aqui, só comparado.
  const fcTrend = summary?.trends.heart_rate_resting || [];
  const hrvTrend = summary?.trends.hrv_rmssd || [];
  const sonoTrend = summary?.trends.sleep_duration_min || [];
  const passosTrend = summary?.trends.steps_daily || [];
  const exercicioTrend = summary?.trends.duration_min || [];

  const fcDelta = deltaVs7Dias(fcTrend, fcRepouso ? fcRepouso.value : null);
  const hrvDelta = deltaVs7Dias(hrvTrend, hrv ? hrv.value : null);
  const sonoDelta = deltaVs7Dias(sonoTrend, sono ? sono.value : null);
  const passosDelta = deltaVs7Dias(passosTrend, passos ? passos.value : null);
  // Exercício: usa o próprio último ponto da série de tendência como
  // "atual" (não o total do período do performanceEngine, que é uma janela
  // diferente) -- assim a comparação fica dentro da mesma fonte de dado.
  const exercicioUltimoPonto = exercicioTrend.length ? exercicioTrend[exercicioTrend.length - 1].value : null;
  const exercicioDelta = deltaVs7Dias(exercicioTrend, exercicioUltimoPonto);

  const ultimaAtualizacaoHoje = [fcRepouso?.timestamp, hrv?.timestamp, sono?.timestamp]
    .filter((t): t is string => Boolean(t))
    .sort()
    .pop() || null;

  return (
    <>
      <div className="health-tabs">
        {SAUDE_TABS.map((tab) => (
          <button key={tab.id} className={activeTab === tab.id ? 'is-active' : ''} onClick={() => setActiveTab(tab.id)}>{tab.label}</button>
        ))}
      </div>

      {activeTab === 'resumo' && (
        <>
          <EstadoDeHojeCard fcDelta={fcDelta} hrvDelta={hrvDelta} sonoDelta={sonoDelta} ultimaAtualizacao={ultimaAtualizacaoHoje} />

          <section id="health-overview" className="health-overview">
            <div className="health-section-line"><div><Activity /> RESUMO DE HOJE</div></div>
            <div className="health-metrics-grid-3">
              <MetricCard icon={<Heart />} label="FC REPOUSO" value={fcRepouso ? fcRepouso.value : '—'} unit={fcRepouso ? 'bpm' : ''} detail={fcRepouso ? `Última leitura: ${formatUltimaLeitura(fcRepouso.timestamp)}` : semDado} tone="red" onTap={() => setActiveTab('coracao')} delta={fcDelta} deltaUnit="bpm" sparklinePoints={fcTrend.map((p) => p.value)} />
              <MetricCard icon={<HeartPulse />} label="HRV" value={hrv ? hrv.value : '—'} unit={hrv ? 'ms' : ''} detail={hrv ? `Última leitura: ${formatUltimaLeitura(hrv.timestamp)}` : semDado} tone="violet" onTap={() => setActiveTab('coracao')} delta={hrvDelta} deltaUnit="ms" sparklinePoints={hrvTrend.map((p) => p.value)} />
              <MetricCard icon={<Moon />} label="SONO" value={sono ? formatDuration(sono.value) : '—'} detail={sono ? `Última noite: ${formatUltimaLeitura(sono.timestamp)}` : semDado} tone="blue" onTap={() => setActiveTab('recuperacao')} delta={sonoDelta} deltaUnit="min" sparklinePoints={sonoTrend.map((p) => p.value)} />
              <MetricCard icon={<Footprints />} label="PASSOS" value={passos ? passos.value.toLocaleString('pt-BR') : '—'} detail={passos ? `Registrado: ${formatUltimaLeitura(passos.timestamp)}` : semDado} tone="green" onTap={() => setActiveTab('atividade')} delta={passosDelta} sparklinePoints={passosTrend.map((p) => p.value)} />
              <MetricCard icon={<Clock3 />} label="EXERCÍCIO" value={formatDuration(minutes)} detail={workouts ? `${workouts} sessão(ões) homologada(s) no período` : 'Sem sessões homologadas'} onTap={() => setActiveTab('atividade')} delta={exercicioDelta} deltaUnit="min" sparklinePoints={exercicioTrend.map((p) => p.value)} />
              <MetricCard icon={<Flame />} label="CALORIAS" value={calories.toLocaleString('pt-BR')} unit="kcal" detail="Total do período" onTap={() => setActiveTab('energia')} />
            </div>
            <p className="health-tap-hint">Toque em um card para ver mais detalhes</p>
          </section>

          <EnergyBlock calories={calories} />

          <article className="health-overview health-trends-compact" style={{ marginTop: '1rem' }}>
            <div className="health-section-line"><div><Activity /> TENDÊNCIAS DOS ÚLTIMOS 30 DIAS</div></div>
            <div className="health-trend-cols">
              <div>
                <span>FC REPOUSO</span>
                <b style={{ color: fcDelta ? CORES_POR_TOM.red : '#65605a' }}>{fcDelta ? formatDeltaCurto(fcDelta, 'bpm') : '—'}</b>
                <em>{statusPalavra(fcDelta, 'down')}</em>
              </div>
              <div>
                <span>HRV</span>
                <b style={{ color: hrvDelta ? CORES_POR_TOM.violet : '#65605a' }}>{hrvDelta ? formatDeltaCurto(hrvDelta, 'ms') : '—'}</b>
                <em>{statusPalavra(hrvDelta, 'up')}</em>
              </div>
              <div>
                <span>SONO</span>
                <b style={{ color: sonoDelta ? CORES_POR_TOM.blue : '#65605a' }}>{sonoDelta ? formatDeltaCurto(sonoDelta, 'min') : '—'}</b>
                <em>{statusPalavra(sonoDelta, 'up')}</em>
              </div>
              <div>
                <span>EXERCÍCIO</span>
                <b style={{ color: exercicioDelta ? CORES_POR_TOM.gold : '#65605a' }}>{exercicioDelta ? formatDeltaCurto(exercicioDelta, 'min') : '—'}</b>
                <em>{statusPalavra(exercicioDelta, 'up')}</em>
              </div>
            </div>
            <button type="button" onClick={onGenerateReport} className="health-trend-link">VER ANÁLISE COMPLETA <ChevronRight /></button>
          </article>

          <div className="health-report-cta">
            <div><strong>Relatório Saúde &amp; Performance</strong><p>7, 30, 90 dias ou personalizado.</p></div>
            <button onClick={onGenerateReport}><FileDown /> GERAR RELATÓRIO</button>
          </div>

          <LatestWorkouts state={state} expanded={activitiesExpanded} onToggle={() => setActivitiesExpanded(value => !value)} />
        </>
      )}

      {activeTab === 'coracao' && (
        <>
          <section className="health-overview">
            <div className="health-section-line"><div><Heart /> CORAÇÃO</div></div>
            <div className="health-metrics-grid">
              <MetricCard icon={<Heart />} label="FC REPOUSO" value={fcRepouso ? fcRepouso.value : '—'} unit={fcRepouso ? 'bpm' : ''} detail={fcRepouso ? `Última leitura: ${formatUltimaLeitura(fcRepouso.timestamp)}` : semDado} tone="red" />
              <MetricCard icon={<HeartPulse />} label="HRV" value={hrv ? hrv.value : '—'} unit={hrv ? 'ms' : ''} detail={hrv ? `Última leitura: ${formatUltimaLeitura(hrv.timestamp)}` : semDado} />
              <MetricCard icon={<Heart />} label="FC MÉDIA" value={heartRateAvg || '—'} unit={heartRateAvg ? 'bpm' : ''} detail={heartRateAvg ? 'Média dos treinos do período' : 'Conecte um sensor cardíaco'} tone="red" />
            </div>
          </section>
          <div className="health-dual">
            <ZoneChart state={state} />
            <article className="health-trend-card">
              <div className="health-section-name">FC REPOUSO (30 DIAS) <Info /></div>
              <strong>{fcRepouso ? fcRepouso.value : '—'} <small>{fcRepouso ? 'bpm' : ''}</small></strong>
              <p>{summary?.trends.heart_rate_resting?.length ? 'Leituras sincronizadas do relógio/app de saúde' : 'Conecte um dispositivo compatível com FC de repouso'}</p>
              <ChartBars points={trendPontos(summary?.trends.heart_rate_resting || [])} color="violet" />
            </article>
          </div>
          <article className="health-overview" style={{ marginTop: '1rem' }}>
            <div className="health-section-line"><div><HeartPulse /> HRV (30 DIAS)</div></div>
            {summary?.trends.hrv_rmssd?.length ? <ChartBars points={trendPontos(summary.trends.hrv_rmssd)} /> : <p className="health-empty">Conecte um dispositivo compatível com HRV para ver esta tendência.</p>}
          </article>
        </>
      )}

      {activeTab === 'recuperacao' && (
        <section className="health-overview">
          <div className="health-section-line"><div><Moon /> RECUPERAÇÃO</div></div>
          <div className="health-metrics-grid">
            <MetricCard icon={<Moon />} label="SONO" value={sono ? formatDuration(sono.value) : '—'} detail={sono ? `Última noite: ${formatUltimaLeitura(sono.timestamp)}` : semDado} />
            <MetricCard icon={<Activity />} label="ÍNDICE DE RECUPERAÇÃO" value={state.computedMetrics.recovery_index?.hasEnoughData ? `${metricNumber(state, 'recovery_index')}%` : '—'} detail={state.computedMetrics.recovery_index?.hasEnoughData ? (state.readinessStatus || '') : 'Requer dados recentes de treino'} />
          </div>
          <div style={{ marginTop: '1rem' }}>
            <div className="health-section-line"><div>SONO (30 DIAS)</div></div>
            {summary?.trends.sleep_duration_min?.length ? <ChartBars points={trendPontos(summary.trends.sleep_duration_min.map((p) => ({ timestamp: p.timestamp, value: Math.round(p.value / 60 * 10) / 10 })))} color="violet" /> : <p className="health-empty">Conecte um dispositivo compatível com sono para ver esta tendência.</p>}
          </div>
        </section>
      )}

      {activeTab === 'atividade' && (
        <>
          <section className="health-overview">
            <div className="health-section-line"><div><Footprints /> ATIVIDADE</div></div>
            <div className="health-metrics-grid">
              <MetricCard icon={<Footprints />} label="PASSOS" value={passos ? passos.value.toLocaleString('pt-BR') : '—'} detail={passos ? `Registrado: ${formatUltimaLeitura(passos.timestamp)}` : semDado} />
              <MetricCard icon={<Dumbbell />} label="TREINOS" value={workouts} detail="Sessões homologadas no período" progress={workouts ? Math.min(100, Number(state.computedMetrics.weekly_active_days?.currentValue || 0) * 20) : 0} />
              <MetricCard icon={<Clock3 />} label="TEMPO ATIVO" value={formatDuration(minutes)} detail={workouts ? `Média por sessão: ${formatDuration(minutes / workouts)}` : 'Sem sessões homologadas'} />
            </div>
          </section>
          <LatestWorkouts state={state} expanded={activitiesExpanded} onToggle={() => setActivitiesExpanded(value => !value)} />
        </>
      )}

      {activeTab === 'energia' && (
        <>
          <EnergyBlock calories={calories} />
          <article className="health-overview" style={{ marginTop: '1rem' }}>
            <div className="health-section-line"><div>CALORIAS (30 DIAS)</div></div>
            {summary?.trends.calories_active?.length ? <ChartBars points={trendPontos(summary.trends.calories_active)} /> : <p className="health-empty">Ainda não há histórico suficiente para mostrar tendência.</p>}
          </article>
        </>
      )}

      {activeTab === 'performance' && (
        <section className="health-advanced">
          <div className="health-section-name">MÉTRICAS AVANÇADAS <Info /></div>
          <div>
            <span>VO₂ MÁX. ESTIMADO <b>{state.computedMetrics.vo2max_estimate?.hasEnoughData ? metricNumber(state, 'vo2max_estimate').toLocaleString('pt-BR', { maximumFractionDigits: 1 }) : '—'}</b><small>{state.computedMetrics.vo2max_estimate?.hasEnoughData ? 'ml/kg/min (estimado)' : (state.computedMetrics.vo2max_estimate?.statusMessage || 'Requer corrida/caminhada com GPS + FC')}</small></span>
            <span>CARGA DE TREINO <b>{state.computedMetrics.acute_chronic_workload_ratio?.hasEnoughData ? metricNumber(state, 'acute_chronic_workload_ratio') : '—'}</b><small>{state.computedMetrics.acute_chronic_workload_ratio?.statusMessage || 'Requer carga registrada'}</small></span>
            <span>RECUPERAÇÃO <b>{state.computedMetrics.recovery_index?.hasEnoughData ? `${metricNumber(state, 'recovery_index')}%` : '—'}</b><small>{state.readinessStatus}</small></span>
            <span>ÍNDICE DE CONSISTÊNCIA <b>{state.computedMetrics.consistency_index?.hasEnoughData ? `${metricNumber(state, 'consistency_index')}%` : '—'}</b><small>{state.computedMetrics.consistency_index?.hasEnoughData ? 'da meta de 5 dias/semana' : (state.computedMetrics.consistency_index?.statusMessage || 'Requer métrica auditada')}</small></span>
          </div>
          <button onClick={onOpenLegacyReport} className="health-tab-note" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', marginTop: '1rem', color: '#ffad00', fontFamily: 'Anton,sans-serif', fontSize: 14, fontStyle: 'italic', cursor: 'pointer' }}>VER RELATÓRIO DETALHADO EM TELA <ChevronRight /></button>
        </section>
      )}
    </>
  );
}

export function Health() {
  const navigate = useNavigate();
  const [range, setRange] = useState<TimeRange>('7days');
  const { user, state, loading } = useHealthData(range);
  const { summary, loadingSummary } = useHealthSummary();

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
          summary={summary}
          loadingSummary={loadingSummary}
          onGenerateReport={() => navigate('/health/report/full')}
          onOpenLegacyReport={() => navigate('/health/report')}
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
