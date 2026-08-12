import React, { useState, useEffect } from 'react';
import { useUser } from '../UserContext';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Heart, Activity, Flame, Crown, Clock, Sparkles, TrendingUp, TrendingDown,
  CheckCircle, AlertTriangle, Download, Award, Smartphone, Users, ChevronLeft,
  Info, Calendar, Share2, HelpCircle, X, ChevronRight, Zap, Shield, RefreshCw, FileText,
  FileCode2, Milestone, Bot, ShieldCheck, Database, BarChart3, PieChart, Layers, ArrowRight
} from 'lucide-react';
import { db } from '../firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { cn } from '../lib/utils';

import { TimeRange, METRIC_CATALOG, PerformanceMetricDef } from '../core/performance/metricCatalog';
import { processUserPerformance, RawWorkoutSession, UserPerformanceState, CalculatedMetricValue } from '../core/performance/performanceEngine';
import { MetricMatrixModal } from '../components/performance/MetricMatrixModal';
import { TimelineView } from '../components/performance/TimelineView';
import { PerformanceAIModal } from '../components/performance/PerformanceAIModal';
import { ModuleDetailModal } from '../components/performance/ModuleDetailModal';

export function Performance() {
  const { user, refreshUser } = useUser();
  const navigate = useNavigate();

  // Selected Time Horizon
  const [selectedRange, setSelectedRange] = useState<TimeRange>('7days');
  const [activeModule, setActiveModule] = useState<'overview' | 'volume' | 'cardio' | 'energy' | 'recovery' | 'consistency' | 'records' | 'timeline'>('overview');

  // Firestore & Real Engine State
  const [loading, setLoading] = useState(true);
  const [rawWorkouts, setRawWorkouts] = useState<RawWorkoutSession[]>([]);
  const [perfState, setPerfState] = useState<UserPerformanceState | null>(null);

  // Modals Control
  const [showMatrixModal, setShowMatrixModal] = useState(false);
  const [showAIModal, setShowAIModal] = useState(false);
  const [selectedMetricForDetail, setSelectedMetricForDetail] = useState<CalculatedMetricValue | null>(null);

  useEffect(() => {
    if (!user) return;

    const fetchUserPerformanceData = async () => {
      setLoading(true);
      try {
        const workoutsQuery = query(
          collection(db, 'workouts'),
          where('userId', '==', user.uid)
        );
        const snap = await getDocs(workoutsQuery);
        
        const fetchedWorkouts: RawWorkoutSession[] = snap.docs.map(doc => {
          const d = doc.data();
          const timestamp = d.createdAt?.seconds ? d.createdAt.seconds * 1000 : (d.timestamp || Date.now());
          return {
            id: doc.id,
            userId: d.userId || user.uid,
            timestamp,
            durationMinutes: Number(d.durationMinutes) || Number(d.duration) || 30,
            avgHeartRate: Number(d.avgHeartRate) || Number(d.avgHr) || 0,
            maxHeartRate: Number(d.maxHeartRate) || Number(d.maxHr) || 0,
            caloriesBurned: Number(d.caloriesBurned) || Number(d.calories) || 0,
            workoutType: d.workoutType || d.type || 'workout',
            workoutName: d.workoutName || d.title || 'Treino Validado Invictus',
            validationStatus: d.validationStatus || 'validated',
            hasSensorData: !!(d.avgHeartRate || d.maxHeartRate),
            hasGPSData: !!(d.distanceKm || d.gpsTracked)
          };
        });

        setRawWorkouts(fetchedWorkouts);

        // Compute Analytics Engine State
        const computedState = processUserPerformance(
          fetchedWorkouts,
          {
            ...user,
            uid: user.uid,
            name: user.name || user.displayName
          },
          selectedRange
        );

        setPerfState(computedState);
      } catch (err) {
        console.error('[Performance] Error fetching user workouts:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchUserPerformanceData();
  }, [user, selectedRange]);

  // Handle Range Filter Change
  const handleRangeChange = (range: TimeRange) => {
    setSelectedRange(range);
    if (perfState && user) {
      const updatedState = processUserPerformance(
        rawWorkouts,
        {
          ...user,
          uid: user.uid,
          name: user.name || user.displayName
        },
        range
      );
      setPerfState(updatedState);
    }
  };

  const ranges: { id: TimeRange; label: string }[] = [
    { id: 'today', label: 'Hoje' },
    { id: 'yesterday', label: 'Ontem' },
    { id: '7days', label: '7 Dias' },
    { id: '30days', label: '30 Dias' },
    { id: '90days', label: '90 Dias' },
    { id: '1year', label: '1 Ano' },
    { id: 'all', label: 'Todo o Histórico' }
  ];

  const modules = [
    { id: 'overview', label: 'Visão Geral' },
    { id: 'volume', label: 'Volume & Treinos' },
    { id: 'cardio', label: 'Cardiovascular' },
    { id: 'energy', label: 'Energia & Carga' },
    { id: 'recovery', label: 'Recuperação' },
    { id: 'consistency', label: 'Consistência' },
    { id: 'records', label: 'Recordes (PRs)' },
    { id: 'timeline', label: 'Linha do Tempo' }
  ];

  if (!user) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center p-6">
        <p className="text-zinc-400 font-mono text-xs">Aguardando autenticação...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white pb-24 font-sans selection:bg-emerald-500 selection:text-black">
      {/* Top Banner Header */}
      <header className="sticky top-0 z-40 bg-zinc-950/90 backdrop-blur-md border-b border-zinc-800/80 px-4 md:px-8 py-4">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate(-1)}
              className="w-9 h-9 rounded-2xl bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
            >
              <ChevronLeft size={20} />
            </button>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-headline italic font-black text-xl md:text-2xl uppercase tracking-tight text-white flex items-center gap-2">
                  <span>Centro de Performance Invictus</span>
                  <span className="text-[10px] bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 font-bold px-2.5 py-0.5 rounded-full not-italic">
                    Plataforma Esportiva
                  </span>
                </h1>
              </div>
              <p className="text-xs text-zinc-400 font-medium">
                Análise biométrica e inteligência de dados reais • {user.name || user.displayName}
              </p>
            </div>
          </div>

          {/* Top Action Buttons (Matrix & AI) */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowMatrixModal(true)}
              className="bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-emerald-500/40 text-emerald-400 font-bold text-xs px-3.5 py-2 rounded-2xl flex items-center gap-2 transition-all cursor-pointer shadow-sm"
            >
              <FileCode2 size={16} />
              <span>Matriz de Métricas</span>
            </button>

            {perfState && (
              <button
                onClick={() => setShowAIModal(true)}
                className="bg-gradient-to-r from-emerald-500 to-teal-600 text-black font-black text-xs px-4 py-2 rounded-2xl flex items-center gap-2 transition-all hover:scale-[1.02] cursor-pointer shadow-lg shadow-emerald-500/20"
              >
                <Sparkles size={16} />
                <span>Invictus Performance AI</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="max-w-7xl mx-auto px-4 md:px-8 pt-6 space-y-6">
        {/* Time Range Selector Bar */}
        <div className="bg-zinc-950/80 border border-zinc-800/80 p-2 rounded-3xl flex items-center gap-1 overflow-x-auto">
          {ranges.map((r) => (
            <button
              key={r.id}
              onClick={() => handleRangeChange(r.id)}
              className={cn(
                "text-xs font-bold px-4 py-2 rounded-2xl whitespace-nowrap transition-all cursor-pointer",
                selectedRange === r.id
                  ? "bg-emerald-500 text-black font-black shadow-md shadow-emerald-500/20"
                  : "text-zinc-400 hover:text-white hover:bg-zinc-900"
              )}
            >
              {r.label}
            </button>
          ))}
        </div>

        {/* Global Data Reliability & Device Status Bar */}
        {perfState && (
          <div className="bg-gradient-to-r from-zinc-950 via-zinc-900 to-zinc-950 p-4 md:p-5 rounded-3xl border border-zinc-800/80 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center border border-emerald-500/30 shrink-0">
                <ShieldCheck size={22} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-black uppercase text-white tracking-wider">
                    Confiabilidade dos Dados no Período:
                  </span>
                  <span className={cn(
                    "text-[10px] font-black px-2.5 py-0.5 rounded-full border uppercase font-mono",
                    perfState.overallReliability === 'alta'
                      ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                      : "bg-amber-500/20 text-amber-300 border-amber-500/40"
                  )}>
                    Nível {perfState.overallReliability}
                  </span>
                </div>
                <p className="text-xs text-zinc-400 mt-0.5">
                  {perfState.aiStructuredPayload.confidenceAssessment}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 text-xs border-t md:border-t-0 md:border-l border-zinc-800 pt-3 md:pt-0 md:pl-4">
              <div className="text-right">
                <p className="text-[10px] uppercase text-zinc-500 font-bold">Total no Histórico</p>
                <p className="font-headline italic font-black text-lg text-white">
                  {perfState.allWorkouts.length} <span className="text-xs text-zinc-400 font-normal">treinos</span>
                </p>
              </div>
              <div className="w-px h-8 bg-zinc-800 hidden md:block" />
              <div className="text-right">
                <p className="text-[10px] uppercase text-zinc-500 font-bold">Amostra Biométrica</p>
                <p className="font-headline italic font-black text-lg text-emerald-400">
                  {perfState.aiStructuredPayload.dataCompleteness}% <span className="text-xs text-zinc-400 font-normal">validado</span>
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Module Tab Selector */}
        <div className="flex items-center gap-2 overflow-x-auto pb-2 border-b border-zinc-800/60">
          {modules.map((mod) => (
            <button
              key={mod.id}
              onClick={() => setActiveModule(mod.id as any)}
              className={cn(
                "text-xs font-bold px-4 py-2.5 rounded-2xl whitespace-nowrap transition-all cursor-pointer border",
                activeModule === mod.id
                  ? "bg-zinc-900 text-emerald-400 border-emerald-500/40 shadow-sm"
                  : "bg-zinc-950/40 text-zinc-400 border-zinc-800/60 hover:text-white"
              )}
            >
              {mod.label}
            </button>
          ))}
        </div>

        {/* LOADING STATE */}
        {loading || !perfState ? (
          <div className="py-20 text-center text-zinc-500 space-y-3">
            <RefreshCw size={32} className="mx-auto text-emerald-500 animate-spin" />
            <p className="text-xs font-mono">Processando matriz analítica de biometria...</p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* 1. VISÃO GERAL (OVERVIEW MODULE) */}
            {activeModule === 'overview' && (
              <div className="space-y-6">
                {/* Top Readiness Hero Card */}
                <div className="bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-950 p-6 md:p-8 rounded-3xl border border-emerald-500/30 space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center border border-emerald-500/30">
                        <Activity size={26} />
                      </div>
                      <div>
                        <span className="text-xs font-black uppercase tracking-widest text-emerald-400">
                          Prontidão Fisiológica & Recuperação
                        </span>
                        <h2 className="font-headline italic font-black text-2xl text-white">
                          Status: {perfState.readinessStatus}
                        </h2>
                      </div>
                    </div>

                    <div className="text-left sm:text-right">
                      <span className="font-headline italic font-black text-5xl text-emerald-400">
                        {perfState.readinessScore}
                      </span>
                      <span className="text-zinc-400 font-bold text-lg ml-1">/ 100</span>
                    </div>
                  </div>

                  <p className="text-xs text-zinc-300 leading-relaxed font-medium">
                    Seus marcadores de intervalo de treino e estabilidade biométrica indicam um bom momento para absorver estímulos esportivos.
                  </p>
                </div>

                {/* Core Metric Cards Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <MetricCard
                    metric={perfState.computedMetrics['total_volume_time']}
                    onClick={() => setSelectedMetricForDetail(perfState.computedMetrics['total_volume_time'])}
                  />
                  <MetricCard
                    metric={perfState.computedMetrics['workout_count']}
                    onClick={() => setSelectedMetricForDetail(perfState.computedMetrics['workout_count'])}
                  />
                  <MetricCard
                    metric={perfState.computedMetrics['avg_heart_rate']}
                    onClick={() => setSelectedMetricForDetail(perfState.computedMetrics['avg_heart_rate'])}
                  />
                  <MetricCard
                    metric={perfState.computedMetrics['total_calories_burned']}
                    onClick={() => setSelectedMetricForDetail(perfState.computedMetrics['total_calories_burned'])}
                  />
                </div>

                {/* HR Zones Preview */}
                <div className="bg-zinc-950 p-6 rounded-3xl border border-zinc-800 space-y-4">
                  <h3 className="font-headline italic font-black text-lg uppercase text-white flex items-center gap-2">
                    <Heart size={20} className="text-emerald-400" />
                    <span>Zonas de Frequência Cardíaca no Período</span>
                  </h3>

                  <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                    {perfState.hrZones.map((z, idx) => (
                      <div key={idx} className="bg-zinc-900 p-4 rounded-2xl border border-zinc-800 space-y-2">
                        <div className="flex items-center justify-between text-xs font-bold">
                          <span style={{ color: z.color }}>{z.zoneName.split(' ')[0]} {z.zoneName.split(' ')[1]}</span>
                          <span className="font-mono text-zinc-400">{z.percent}%</span>
                        </div>
                        <div className="w-full bg-zinc-800 h-2 rounded-full overflow-hidden">
                          <div className="h-full transition-all" style={{ width: `${z.percent}%`, backgroundColor: z.color }} />
                        </div>
                        <p className="text-[10px] text-zinc-500 font-mono">{z.range}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* 2. VOLUME & TREINOS */}
            {activeModule === 'volume' && (
              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <MetricCard
                    metric={perfState.computedMetrics['total_volume_time']}
                    onClick={() => setSelectedMetricForDetail(perfState.computedMetrics['total_volume_time'])}
                  />
                  <MetricCard
                    metric={perfState.computedMetrics['workout_count']}
                    onClick={() => setSelectedMetricForDetail(perfState.computedMetrics['workout_count'])}
                  />
                  <MetricCard
                    metric={perfState.computedMetrics['average_session_duration']}
                    onClick={() => setSelectedMetricForDetail(perfState.computedMetrics['average_session_duration'])}
                  />
                </div>

                {/* Session Breakdown List */}
                <div className="bg-zinc-950 p-6 rounded-3xl border border-zinc-800 space-y-4">
                  <h3 className="font-headline italic font-black text-lg uppercase text-white">
                    Sessões Auditadas no Período ({perfState.timeframeWorkouts.length})
                  </h3>

                  {perfState.timeframeWorkouts.length === 0 ? (
                    <div className="py-8 text-center text-zinc-500 text-xs">
                      Nenhuma sessão registrada neste intervalo de tempo.
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                      {perfState.timeframeWorkouts.map((w, idx) => (
                        <div key={w.id} className="bg-zinc-900 p-4 rounded-2xl border border-zinc-800 flex items-center justify-between text-xs">
                          <div>
                            <p className="font-bold text-white text-sm">{w.workoutName}</p>
                            <p className="text-[10px] text-zinc-500 font-mono">
                              {new Date(w.timestamp).toLocaleDateString('pt-BR')} • Status: {w.validationStatus}
                            </p>
                          </div>
                          <div className="text-right">
                            <span className="font-headline italic font-black text-base text-emerald-400">
                              {w.durationMinutes} min
                            </span>
                            {w.avgHeartRate ? (
                              <p className="text-[10px] text-zinc-400">{w.avgHeartRate} bpm méd</p>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 3. CARDIOVASCULAR */}
            {activeModule === 'cardio' && (
              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <MetricCard
                    metric={perfState.computedMetrics['avg_heart_rate']}
                    onClick={() => setSelectedMetricForDetail(perfState.computedMetrics['avg_heart_rate'])}
                  />
                  <MetricCard
                    metric={perfState.computedMetrics['max_heart_rate_session']}
                    onClick={() => setSelectedMetricForDetail(perfState.computedMetrics['max_heart_rate_session'])}
                  />
                </div>
              </div>
            )}

            {/* 4. ENERGIA & CARGA */}
            {activeModule === 'energy' && (
              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <MetricCard
                    metric={perfState.computedMetrics['total_calories_burned']}
                    onClick={() => setSelectedMetricForDetail(perfState.computedMetrics['total_calories_burned'])}
                  />
                  <MetricCard
                    metric={perfState.computedMetrics['calorie_gate_ratio']}
                    onClick={() => setSelectedMetricForDetail(perfState.computedMetrics['calorie_gate_ratio'])}
                  />
                  <MetricCard
                    metric={perfState.computedMetrics['acute_chronic_workload_ratio']}
                    onClick={() => setSelectedMetricForDetail(perfState.computedMetrics['acute_chronic_workload_ratio'])}
                  />
                </div>
              </div>
            )}

            {/* 5. RECUPERAÇÃO */}
            {activeModule === 'recovery' && (
              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <MetricCard
                    metric={perfState.computedMetrics['recovery_index']}
                    onClick={() => setSelectedMetricForDetail(perfState.computedMetrics['recovery_index'])}
                  />
                  <MetricCard
                    metric={perfState.computedMetrics['rest_interval_hours']}
                    onClick={() => setSelectedMetricForDetail(perfState.computedMetrics['rest_interval_hours'])}
                  />
                </div>
              </div>
            )}

            {/* 6. CONSISTÊNCIA */}
            {activeModule === 'consistency' && (
              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <MetricCard
                    metric={perfState.computedMetrics['weekly_active_days']}
                    onClick={() => setSelectedMetricForDetail(perfState.computedMetrics['weekly_active_days'])}
                  />
                  <MetricCard
                    metric={perfState.computedMetrics['current_streak_days']}
                    onClick={() => setSelectedMetricForDetail(perfState.computedMetrics['current_streak_days'])}
                  />
                </div>
              </div>
            )}

            {/* 7. RECORDES & EVOLUÇÃO */}
            {activeModule === 'records' && (
              <div className="space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {perfState.personalRecords.map((pr, idx) => (
                    <div key={idx} className="bg-zinc-950 p-6 rounded-3xl border border-amber-500/30 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-black uppercase text-amber-400 bg-amber-500/10 border border-amber-500/30 px-2.5 py-0.5 rounded-full">
                          {pr.category}
                        </span>
                        <Crown size={20} className="text-amber-400" />
                      </div>
                      <p className="text-xs text-zinc-400 uppercase font-bold">{pr.title}</p>
                      <p className="font-headline italic font-black text-3xl text-white">{pr.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 8. LINHA DO TEMPO */}
            {activeModule === 'timeline' && (
              <TimelineView events={perfState.timelineEvents} userName={perfState.userName} />
            )}
          </div>
        )}
      </main>

      {/* MODALS */}
      <MetricMatrixModal
        isOpen={showMatrixModal}
        onClose={() => setShowMatrixModal(false)}
      />

      {perfState && (
        <PerformanceAIModal
          isOpen={showAIModal}
          onClose={() => setShowAIModal(false)}
          perfState={perfState}
        />
      )}

      <ModuleDetailModal
        isOpen={!!selectedMetricForDetail}
        onClose={() => setSelectedMetricForDetail(null)}
        metricData={selectedMetricForDetail}
      />
    </div>
  );
}

// Sub-component for clean Metric Display Cards
function MetricCard({ metric, onClick }: { metric?: CalculatedMetricValue; onClick: () => void }) {
  if (!metric) return null;
  const def = metric.def;

  return (
    <div
      onClick={onClick}
      className="bg-zinc-950 hover:bg-zinc-900 border border-zinc-800 hover:border-emerald-500/50 p-5 rounded-3xl transition-all cursor-pointer space-y-3 group relative overflow-hidden"
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-black uppercase tracking-wider text-zinc-400 group-hover:text-emerald-400 transition-colors">
          {def.name}
        </span>
        <span className={cn(
          "text-[9px] font-mono px-2 py-0.5 rounded-full border uppercase font-bold",
          metric.reliability === 'alta'
            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
            : "bg-amber-500/10 text-amber-400 border-amber-500/30"
        )}>
          {metric.reliability}
        </span>
      </div>

      <div className="flex items-baseline justify-between">
        <div>
          <span className="font-headline italic font-black text-3xl md:text-4xl text-white group-hover:scale-105 transition-transform inline-block">
            {metric.currentValue}
          </span>
          <span className="text-zinc-500 font-bold ml-1.5 text-xs">{metric.unit}</span>
        </div>
      </div>

      <p className="text-[10px] text-zinc-500 line-clamp-2 leading-relaxed">
        {def.simpleDescription}
      </p>

      <div className="pt-2 border-t border-zinc-900 flex items-center justify-between text-[10px] text-emerald-400 font-bold">
        <span>Inspecionar Fórmulas & Fonte</span>
        <ArrowRight size={12} className="group-hover:translate-x-1 transition-transform" />
      </div>
    </div>
  );
}
