import React, { useState, useEffect, useMemo } from 'react';
import { 
  History, CheckCircle2, XCircle, AlertCircle, Clock, Dumbbell, 
  TrendingUp, MapPin, Flame, Trophy, RefreshCw, Search, Filter, 
  Calendar, Award, Eye, X, ShieldAlert, Sparkles, Zap, ChevronRight,
  Info, Check, AlertOctagon, Scale, ShieldCheck, Image as ImageIcon
} from 'lucide-react';
import { collection, query, where, getDocs, doc, deleteDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';

export interface ActivityHistoryItem {
  id: string;
  source: 'workout' | 'checkin' | 'power';
  type: 'workout' | 'cardio' | 'checkin' | 'power' | 'diet' | 'recovery';
  typeLabel: string;
  title: string;
  subtitle?: string;
  dateStr: string;
  timeStr: string;
  rawTimestamp: number;
  status: 'homologada' | 'rejeitada' | 'pendente';
  statusRaw: string;
  points: number;
  durationMins?: number;
  distanceKm?: number;
  weightKg?: number;
  exerciseName?: string;
  photoUrl?: string;
  rejectionReason?: string;
  aiAnalysis?: string;
  gymName?: string;
  details?: any;
}

function parseTimestamp(ts: any): { dateStr: string; timeStr: string; rawMs: number } {
  let dateObj: Date;

  if (!ts) {
    dateObj = new Date();
  } else if (typeof ts === 'string') {
    dateObj = new Date(ts);
  } else if (typeof ts === 'number') {
    dateObj = new Date(ts);
  } else if (ts.toDate && typeof ts.toDate === 'function') {
    dateObj = ts.toDate();
  } else if (ts.seconds) {
    dateObj = new Date(ts.seconds * 1000);
  } else {
    dateObj = new Date();
  }

  if (isNaN(dateObj.getTime())) {
    dateObj = new Date();
  }

  const day = dateObj.getDate().toString().padStart(2, '0');
  const month = (dateObj.getMonth() + 1).toString().padStart(2, '0');
  const year = dateObj.getFullYear();
  const dateStr = `${day}/${month}/${year}`;

  const hours = dateObj.getHours().toString().padStart(2, '0');
  const mins = dateObj.getMinutes().toString().padStart(2, '0');
  const secs = dateObj.getSeconds().toString().padStart(2, '0');
  const timeStr = `${hours}:${mins}:${secs}`;

  return { dateStr, timeStr, rawMs: dateObj.getTime() };
}

export function ActivityHistorySection() {
  const [activities, setActivities] = useState<ActivityHistoryItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Filters state
  const [statusFilter, setStatusFilter] = useState<'all' | 'homologada' | 'rejeitada' | 'pendente'>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | 'workout' | 'cardio' | 'checkin' | 'power' | 'other'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [visibleCount, setVisibleCount] = useState<number>(10);

  // Selected item modal for details
  const [selectedItem, setSelectedItem] = useState<ActivityHistoryItem | null>(null);
  const [previewPhotoUrl, setPreviewPhotoUrl] = useState<string | null>(null);

  const fetchHistory = async () => {
    const user = auth.currentUser;
    if (!user) {
      setActivities([]);
      setLoading(false);
      return;
    }

    try {
      setError(null);
      const items: ActivityHistoryItem[] = [];

      // 1. Fetch from 'workouts' collection
      try {
        const wQuery = query(
          collection(db, 'workouts'),
          where('userId', '==', user.uid)
        );
    const wSnap = await getDocs(wQuery);

    // One-time cleanup: remove legacy fake/simulated wearable-sync docs left over from
    // early integration testing. A real synced doc's id is always `${source}_${sourceActivityId}`
    // written by an actually-connected provider (source is exactly 'strava' or 'health_connect').
    // 'strava_sim_' is provably fake (StravaProvider never emits a 'sim' source). Bare
    // 'health_connect_' docs here are also leftover test data: this environment is a desktop
    // browser preview where the native Health Connect plugin (Android-only) can never sync.
    const FAKE_WORKOUT_PREFIXES = ['strava_sim_', 'health_connect_'];
    const fakeWorkoutDocs = wSnap.docs.filter(wd => FAKE_WORKOUT_PREFIXES.some(p => wd.id.startsWith(p)));
    const cleanWorkoutDocs = wSnap.docs.filter(wd => !FAKE_WORKOUT_PREFIXES.some(p => wd.id.startsWith(p)));
    if (fakeWorkoutDocs.length > 0) {
      for (const fwd of fakeWorkoutDocs) {
        try { await deleteDoc(doc(db, 'workouts', fwd.id)); } catch (e) { console.warn('[ActivityHistorySection] cleanup delete failed', fwd.id, e); }
      }
    }
    cleanWorkoutDocs.forEach(d => {
          const data = d.data();
          const { dateStr, timeStr, rawMs } = parseTimestamp(data.timestamp || data.createdAt);

          let mappedStatus: 'homologada' | 'rejeitada' | 'pendente' = 'homologada';
          const rawSt = (data.status || '').toLowerCase();

          if (['valid', 'approved', 'validated', 'confirmed'].includes(rawSt)) {
            mappedStatus = 'homologada';
          } else if (['invalid', 'rejected', 'not_validated', 'not_eligible', 'suspicious'].includes(rawSt)) {
            mappedStatus = 'rejeitada';
          } else if (['pending', 'under_review', 'manual_review', 'biometria_incompleta', 'partially_validated'].includes(rawSt)) {
            mappedStatus = 'pendente';
          } else if (data.isScoringEligible === false || data.nonScoringReason) {
            mappedStatus = 'rejeitada';
          }

          let typeLabel = 'Treino';
          let title = 'Treino de Musculação';
          if (data.type === 'cardio') {
            typeLabel = 'Cardio';
            title = data.cardioTypeLabel ? `Cardio (${data.cardioTypeLabel})` : 'Cardio & Aeróbico';
          } else if (data.type === 'diet') {
            typeLabel = 'Dieta';
            title = 'Refeição Auditada por IA';
          } else if (data.type === 'recovery') {
            typeLabel = 'Recuperação';
            title = 'Descanso Inteligente';
          } else if (data.type === 'power_video') {
            typeLabel = 'Power Lift';
            title = 'Power Lift Homologado';
          }

          // Extract reason
          let reason = data.userMessage || data.message || data.nonScoringReason || data.rejectionReason;
          if (!reason && data.validation) {
            reason = data.validation.userMessage || data.validation.reason || data.validation.details?.aiAnalysis;
          }
          if (reason === 'NO_MOVEMENT_DETECTED' || data.nonScoringReason === 'NO_MOVEMENT_DETECTED') {
            reason = '🚨 Nenhum deslocamento foi detectado no GPS durante a sessão de cardio (0.00 km). Atividades estáticas não são homologadas.';
          }

          items.push({
            id: d.id,
            source: 'workout',
            type: data.type === 'cardio' ? 'cardio' : data.type === 'diet' ? 'diet' : data.type === 'recovery' ? 'recovery' : 'workout',
            typeLabel,
            title,
            subtitle: data.cardioTypeLabel || (data.duration ? `${data.duration} minutos` : undefined),
            dateStr,
            timeStr,
            rawTimestamp: rawMs,
            status: mappedStatus,
            statusRaw: rawSt || mappedStatus,
            points: Number(data.points || 0),
            durationMins: data.duration ? Number(data.duration) : undefined,
            distanceKm: data.distance ? Number(data.distance) : undefined,
            photoUrl: data.photoUrl || data.verificationPhotoUrl,
            rejectionReason: reason,
            aiAnalysis: data.validation?.details?.aiAnalysis || data.validation?.reason,
            details: data.validation || data
          });
        });
      } catch (err) {
        console.warn('[ActivityHistory] Error fetching workouts:', err);
      }

      // 2. Fetch from 'gym_checkins' collection
      try {
        const cQuery = query(
          collection(db, 'gym_checkins'),
          where('userId', '==', user.uid)
        );
        const cSnap = await getDocs(cQuery);
        cSnap.forEach(d => {
          const data = d.data();
          const { dateStr, timeStr, rawMs } = parseTimestamp(data.checkInTime || data.timestamp || data.createdAt);

          let mappedStatus: 'homologada' | 'rejeitada' | 'pendente' = 'homologada';
          const rawSt = (data.status || '').toLowerCase();
          if (['confirmed', 'valid', 'approved'].includes(rawSt)) {
            mappedStatus = 'homologada';
          } else if (['rejected', 'invalid'].includes(rawSt)) {
            mappedStatus = 'rejeitada';
          } else {
            mappedStatus = 'pendente';
          }

          items.push({
            id: d.id,
            source: 'checkin',
            type: 'checkin',
            typeLabel: 'Check-in Presencial',
            title: 'Check-in Presencial GPS',
            subtitle: data.gymName || 'Academia Vinculada',
            dateStr,
            timeStr,
            rawTimestamp: rawMs,
            status: mappedStatus,
            statusRaw: rawSt,
            points: mappedStatus === 'homologada' ? 20 : 0,
            gymName: data.gymName,
            rejectionReason: mappedStatus === 'rejeitada' ? (data.error || 'Check-in fora do raio da academia.') : undefined,
            details: data
          });
        });
      } catch (err) {
        console.warn('[ActivityHistory] Error fetching gym_checkins:', err);
      }

      // 3. Fetch from 'power_records' collection
      try {
        const pQuery = query(
          collection(db, 'power_records'),
          where('userId', '==', user.uid)
        );
        const pSnap = await getDocs(pQuery);
        pSnap.forEach(d => {
          const data = d.data();
          const { dateStr, timeStr, rawMs } = parseTimestamp(data.timestamp || data.createdAt);

          let mappedStatus: 'homologada' | 'rejeitada' | 'pendente' = 'homologada';
          const rawSt = (data.videoStatus || data.status || '').toLowerCase();
          if (['validated', 'valid', 'approved'].includes(rawSt)) {
            mappedStatus = 'homologada';
          } else if (['rejected', 'invalid'].includes(rawSt)) {
            mappedStatus = 'rejeitada';
          } else {
            mappedStatus = 'pendente';
          }

          const exName = (data.exercise || '').toUpperCase();
          items.push({
            id: d.id,
            source: 'power',
            type: 'power',
            typeLabel: 'Power Lift',
            title: `Invictus Power Lift (${exName})`,
            subtitle: `${data.weight || 0} kg`,
            dateStr,
            timeStr,
            rawTimestamp: rawMs,
            status: mappedStatus,
            statusRaw: rawSt,
            points: mappedStatus === 'homologada' ? 100 : 0,
            weightKg: data.weight ? Number(data.weight) : undefined,
            exerciseName: exName,
            photoUrl: data.videoUrl,
            rejectionReason: data.rejectionReason,
            details: data
          });
        });
      } catch (err) {
        console.warn('[ActivityHistory] Error fetching power_records:', err);
      }

      // Sort all items descending by rawTimestamp
      items.sort((a, b) => b.rawTimestamp - a.rawTimestamp);
      setActivities(items);
    } catch (err: any) {
      console.error('[ActivityHistory] Unexpected error fetching history:', err);
      setError('Falha ao carregar o histórico de atividades.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchHistory();
  };

  // Filtered Items
  const filteredActivities = useMemo(() => {
    return activities.filter(act => {
      // Status Filter
      if (statusFilter !== 'all' && act.status !== statusFilter) {
        return false;
      }

      // Type Filter
      if (typeFilter !== 'all') {
        if (typeFilter === 'workout' && act.type !== 'workout') return false;
        if (typeFilter === 'cardio' && act.type !== 'cardio') return false;
        if (typeFilter === 'checkin' && act.type !== 'checkin') return false;
        if (typeFilter === 'power' && act.type !== 'power') return false;
        if (typeFilter === 'other' && !['diet', 'recovery'].includes(act.type)) return false;
      }

      // Search Query
      if (searchQuery.trim() !== '') {
        const q = searchQuery.toLowerCase();
        const matchTitle = act.title.toLowerCase().includes(q);
        const matchType = act.typeLabel.toLowerCase().includes(q);
        const matchDate = act.dateStr.includes(q);
        const matchTime = act.timeStr.includes(q);
        const matchGym = act.gymName?.toLowerCase().includes(q);
        const matchReason = act.rejectionReason?.toLowerCase().includes(q);
        if (!matchTitle && !matchType && !matchDate && !matchTime && !matchGym && !matchReason) {
          return false;
        }
      }

      return true;
    });
  }, [activities, statusFilter, typeFilter, searchQuery]);

  // Statistics
  const stats = useMemo(() => {
    const total = activities.length;
    const homologadas = activities.filter(a => a.status === 'homologada').length;
    const rejeitadas = activities.filter(a => a.status === 'rejeitada').length;
    const pendentes = activities.filter(a => a.status === 'pendente').length;
    const totalXp = activities.reduce((acc, curr) => acc + (curr.points || 0), 0);
    const rate = total > 0 ? Math.round((homologadas / total) * 100) : 0;

    return { total, homologadas, rejeitadas, pendentes, totalXp, rate };
  }, [activities]);

  const visibleItems = filteredActivities.slice(0, visibleCount);

  return (
    <div id="activity-history-section" className="bg-surface-card border border-white/10 rounded-[28px] p-6 space-y-6 shadow-2xl relative overflow-hidden">
      {/* Background glow effect */}
      <div className="absolute top-0 right-0 w-80 h-80 bg-primary/5 rounded-full blur-3xl pointer-events-none" />

      {/* HEADER BAR */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/10 pb-5">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-primary/10 border border-primary/20 rounded-2xl text-primary shrink-0">
            <History size={24} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono font-black text-primary uppercase tracking-widest block">
                AUDITORIA & HISTÓRICO DE SUBMISSÕES
              </span>
              <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[9px] font-mono font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Sincronizado
              </span>
            </div>
            <h2 className="text-xl sm:text-2xl font-headline italic font-black text-white uppercase tracking-tight">
              Histórico Completo de Atividades
            </h2>
            <p className="text-xs text-on-surface-variant">
              Status, data, hora e parecer de validação antifraude para cada atividade registrada.
            </p>
          </div>
        </div>

        <button
          onClick={handleRefresh}
          disabled={refreshing || loading}
          className="px-4 py-2.5 bg-surface-container hover:bg-surface-container-high border border-white/10 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-2 shrink-0 self-start md:self-auto cursor-pointer"
        >
          <RefreshCw size={15} className={cn(refreshing && "animate-spin text-primary")} />
          <span>{refreshing ? 'Atualizando...' : 'Atualizar Histórico'}</span>
        </button>
      </div>

      {/* STATS OVERVIEW CARDS */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-surface-container-low/60 border border-white/5 p-3.5 rounded-2xl flex flex-col justify-between">
          <span className="text-[10px] font-mono uppercase text-on-surface-variant font-bold">Total Registrado</span>
          <div className="flex items-baseline gap-1.5 mt-1">
            <span className="text-xl font-headline italic font-black text-white">{stats.total}</span>
            <span className="text-[10px] text-on-surface-variant">atividades</span>
          </div>
        </div>

        <div className="bg-emerald-500/10 border border-emerald-500/20 p-3.5 rounded-2xl flex flex-col justify-between">
          <div className="flex items-center justify-between text-emerald-400">
            <span className="text-[10px] font-mono uppercase font-bold">Homologadas</span>
            <CheckCircle2 size={14} />
          </div>
          <div className="flex items-baseline gap-1.5 mt-1">
            <span className="text-xl font-headline italic font-black text-emerald-400">{stats.homologadas}</span>
            <span className="text-[10px] text-emerald-300/80">({stats.rate}% de aprovação)</span>
          </div>
        </div>

        <div className="bg-rose-500/10 border border-rose-500/20 p-3.5 rounded-2xl flex flex-col justify-between">
          <div className="flex items-center justify-between text-rose-400">
            <span className="text-[10px] font-mono uppercase font-bold">Rejeitadas</span>
            <XCircle size={14} />
          </div>
          <div className="flex items-baseline gap-1.5 mt-1">
            <span className="text-xl font-headline italic font-black text-rose-400">{stats.rejeitadas}</span>
            <span className="text-[10px] text-rose-300/80">não pontuaram</span>
          </div>
        </div>

        <div className="bg-primary/10 border border-primary/20 p-3.5 rounded-2xl flex flex-col justify-between">
          <div className="flex items-center justify-between text-primary">
            <span className="text-[10px] font-mono uppercase font-bold">XP Conquistado</span>
            <Zap size={14} />
          </div>
          <div className="flex items-baseline gap-1.5 mt-1">
            <span className="text-xl font-headline italic font-black text-primary">+{stats.totalXp}</span>
            <span className="text-[10px] text-primary/80">XP acumulado</span>
          </div>
        </div>
      </div>

      {/* FILTERS & SEARCH TOOLBAR */}
      <div className="space-y-3 bg-black/30 p-4 rounded-2xl border border-white/5">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          {/* SEARCH INPUT */}
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-on-surface-variant" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar por tipo, data (DD/MM/AAAA), horário, academia..."
              className="w-full bg-surface-container/80 border border-white/10 rounded-xl pl-9 pr-8 py-2 text-xs text-white placeholder:text-on-surface-variant/60 focus:outline-none focus:border-primary transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-white"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* STATUS FILTER PILLS */}
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1 sm:pb-0">
            {[
              { id: 'all', label: 'Todas' },
              { id: 'homologada', label: '🟢 Homologadas' },
              { id: 'rejeitada', label: '🔴 Rejeitadas' },
              { id: 'pendente', label: '🟡 Em Análise' },
            ].map(pill => (
              <button
                key={pill.id}
                onClick={() => setStatusFilter(pill.id as any)}
                className={cn(
                  "px-3 py-1.5 rounded-xl text-[11px] font-bold transition-all border cursor-pointer whitespace-nowrap shrink-0",
                  statusFilter === pill.id
                    ? "bg-white text-black border-white shadow-md font-extrabold"
                    : "bg-surface-container/60 hover:bg-surface-container border-white/5 text-on-surface-variant hover:text-white"
                )}
              >
                {pill.label}
              </button>
            ))}
          </div>
        </div>

        {/* TYPE FILTER PILLS */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pt-1 border-t border-white/5">
          <span className="text-[10px] font-mono text-on-surface-variant uppercase tracking-wider shrink-0 mr-1 flex items-center gap-1">
            <Filter size={12} /> Modalidade:
          </span>
          {[
            { id: 'all', label: 'Todas' },
            { id: 'workout', label: '🏋️ Musculação' },
            { id: 'cardio', label: '🏃 Cardio' },
            { id: 'checkin', label: '📍 Check-in GPS' },
            { id: 'power', label: '🔥 Power Lift' },
            { id: 'other', label: '🥗 Outros' },
          ].map(typePill => (
            <button
              key={typePill.id}
              onClick={() => setTypeFilter(typePill.id as any)}
              className={cn(
                "px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all border cursor-pointer whitespace-nowrap shrink-0",
                typeFilter === typePill.id
                  ? "bg-primary/20 text-primary border-primary/40"
                  : "bg-surface-container-low border-white/5 text-on-surface-variant hover:text-white"
              )}
            >
              {typePill.label}
            </button>
          ))}
        </div>
      </div>

      {/* HISTORY LIST CONTENT */}
      {loading ? (
        <div className="py-12 flex flex-col items-center justify-center space-y-3 text-on-surface-variant">
          <RefreshCw className="animate-spin text-primary" size={28} />
          <p className="text-xs font-mono">Carregando histórico de atividades...</p>
        </div>
      ) : error ? (
        <div className="p-4 bg-rose-500/10 border border-rose-500/30 text-rose-300 rounded-2xl text-xs flex items-center gap-3">
          <AlertCircle size={18} className="shrink-0 text-rose-400" />
          <p>{error}</p>
        </div>
      ) : filteredActivities.length === 0 ? (
        <div className="py-12 px-4 text-center space-y-3 bg-surface-container-low/30 border border-white/5 rounded-2xl">
          <div className="w-12 h-12 mx-auto rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-on-surface-variant">
            <History size={24} />
          </div>
          <h3 className="text-sm font-bold text-white uppercase">Nenhuma atividade encontrada</h3>
          <p className="text-xs text-on-surface-variant max-w-md mx-auto">
            {searchQuery || statusFilter !== 'all' || typeFilter !== 'all'
              ? 'Nenhuma atividade corresponde aos filtros selecionados. Tente limpar a busca ou os filtros.'
              : 'Você ainda não possui atividades registradas. Inicie um treino, cardio ou check-in para começar seu histórico!'}
          </p>
          {(searchQuery || statusFilter !== 'all' || typeFilter !== 'all') && (
            <button
              onClick={() => {
                setSearchQuery('');
                setStatusFilter('all');
                setTypeFilter('all');
              }}
              className="mt-2 px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-bold transition-all cursor-pointer"
            >
              Limpar Filtros
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {visibleItems.map((act) => {
            const isHomologada = act.status === 'homologada';
            const isRejeitada = act.status === 'rejeitada';
            const isPendente = act.status === 'pendente';

            return (
              <div
                key={act.id}
                className={cn(
                  "p-4 rounded-2xl border transition-all space-y-3 relative overflow-hidden group",
                  isHomologada
                    ? "bg-surface-container-low/60 border-emerald-500/20 hover:border-emerald-500/40"
                    : isRejeitada
                    ? "bg-rose-950/10 border-rose-500/30 hover:border-rose-500/50"
                    : "bg-amber-950/10 border-amber-500/30 hover:border-amber-500/50"
                )}
              >
                {/* CARD HEADER */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  
                  {/* LEFT: ICON + TITLE + BADGES */}
                  <div className="flex items-start gap-3">
                    <div className={cn(
                      "p-2.5 rounded-xl border shrink-0 mt-0.5",
                      act.type === 'workout' ? "bg-amber-500/10 border-amber-500/30 text-amber-400" :
                      act.type === 'cardio' ? "bg-orange-500/10 border-orange-500/30 text-orange-400" :
                      act.type === 'checkin' ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" :
                      act.type === 'power' ? "bg-yellow-500/10 border-yellow-500/30 text-yellow-400" :
                      "bg-purple-500/10 border-purple-500/30 text-purple-400"
                    )}>
                      {act.type === 'workout' && <Dumbbell size={20} />}
                      {act.type === 'cardio' && <TrendingUp size={20} />}
                      {act.type === 'checkin' && <MapPin size={20} />}
                      {act.type === 'power' && <Trophy size={20} />}
                      {['diet', 'recovery'].includes(act.type) && <Flame size={20} />}
                    </div>

                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {/* TYPE BADGE */}
                        <span className="text-[10px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-on-surface-variant">
                          {act.typeLabel}
                        </span>

                        {/* STATUS BADGE */}
                        <span className={cn(
                          "text-[10px] font-mono font-black uppercase tracking-wider px-2 py-0.5 rounded-md border flex items-center gap-1",
                          isHomologada && "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
                          isRejeitada && "bg-rose-500/15 text-rose-400 border-rose-500/30",
                          isPendente && "bg-amber-500/15 text-amber-400 border-amber-500/30"
                        )}>
                          {isHomologada && <CheckCircle2 size={12} />}
                          {isRejeitada && <XCircle size={12} />}
                          {isPendente && <Clock size={12} />}
                          <span>
                            {isHomologada ? 'HOMOLOGADA' : isRejeitada ? 'REJEITADA' : 'EM AUDITORIA'}
                          </span>
                        </span>
                      </div>

                      <h4 className="font-bold text-sm sm:text-base text-white group-hover:text-primary transition-colors">
                        {act.title}
                      </h4>

                      {/* DATE & TIME DETAILS */}
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-on-surface-variant font-mono">
                        <span className="flex items-center gap-1 text-zinc-300">
                          <Calendar size={13} className="text-primary" />
                          <strong>Data:</strong> {act.dateStr}
                        </span>
                        <span className="flex items-center gap-1 text-zinc-300">
                          <Clock size={13} className="text-primary" />
                          <strong>Hora:</strong> {act.timeStr}
                        </span>
                        {act.gymName && (
                          <span className="flex items-center gap-1 text-zinc-400">
                            <MapPin size={13} className="text-emerald-400" />
                            {act.gymName}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* RIGHT: METRICS & POINTS */}
                  <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-center border-t sm:border-t-0 border-white/5 pt-2 sm:pt-0 shrink-0 gap-1.5">
                    <div className={cn(
                      "px-3 py-1 rounded-xl font-headline italic font-black text-xs sm:text-sm flex items-center gap-1 border",
                      isHomologada
                        ? "bg-primary/10 border-primary/30 text-primary"
                        : "bg-zinc-800 border-zinc-700 text-zinc-400"
                    )}>
                      <Award size={14} />
                      <span>{isHomologada ? `+${act.points} XP` : '0 XP'}</span>
                    </div>

                    <div className="flex items-center gap-2 text-[11px] font-mono text-on-surface-variant">
                      {act.durationMins !== undefined && (
                        <span>⏱️ {act.durationMins} min</span>
                      )}
                      {act.distanceKm !== undefined && act.distanceKm > 0 && (
                        <span>🏃 {act.distanceKm.toFixed(2)} km</span>
                      )}
                      {act.weightKg !== undefined && (
                        <span>🏋️ {act.weightKg} kg</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* REJEITADA CALLOUT REASON BOX */}
                {isRejeitada && act.rejectionReason && (
                  <div className="bg-rose-500/10 border border-rose-500/30 p-3 rounded-xl flex items-start gap-2.5 text-xs text-rose-300 font-sans">
                    <AlertOctagon size={16} className="text-rose-400 shrink-0 mt-0.5" />
                    <div className="space-y-0.5">
                      <p className="font-bold text-rose-400 uppercase tracking-wider text-[10px]">
                        PARECER DE REJEIÇÃO / INDEFERIMENTO ANTIFRAUDE:
                      </p>
                      <p className="leading-relaxed text-[11.5px] text-rose-200/90">
                        {act.rejectionReason}
                      </p>
                    </div>
                  </div>
                )}

                {/* PHOTO THUMBNAIL IF AVAILABLE */}
                {act.photoUrl && (
                  <div className="pt-2 flex items-center gap-3">
                    <button
                      onClick={() => setPreviewPhotoUrl(act.photoUrl!)}
                      className="group/img relative rounded-xl overflow-hidden border border-white/10 hover:border-primary transition-all cursor-pointer shrink-0"
                    >
                      <img
                        src={act.photoUrl}
                        alt="Comprovante de atividade"
                        className="w-16 h-16 object-cover group-hover/img:scale-105 transition-transform"
                      />
                      <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover/img:opacity-100 transition-opacity">
                        <Eye size={16} className="text-white" />
                      </div>
                    </button>
                    <div className="text-[11px] text-on-surface-variant space-y-0.5">
                      <span className="font-bold text-white flex items-center gap-1">
                        <ImageIcon size={12} className="text-primary" /> Registro de Foto/Anexo
                      </span>
                      <p className="text-[10px] text-zinc-400">Clique na miniatura para visualizar o comprovante anexado.</p>
                    </div>
                  </div>
                )}

                {/* FOOTER ACTIONS / DETAILS TOGGLE */}
                <div className="pt-2 border-t border-white/5 flex items-center justify-between text-[11px] text-on-surface-variant">
                  <span className="font-mono text-[10px]">
                    ID: {act.id.substring(0, 12)}...
                  </span>

                  <button
                    onClick={() => setSelectedItem(act)}
                    className="text-xs font-bold text-primary hover:text-primary-hover flex items-center gap-1 cursor-pointer transition-colors"
                  >
                    <span>Ver Detalhes Técnicos</span>
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* LOAD MORE BUTTON */}
      {filteredActivities.length > visibleCount && (
        <div className="text-center pt-2">
          <button
            onClick={() => setVisibleCount(prev => prev + 15)}
            className="px-6 py-3 bg-surface-container hover:bg-surface-container-high border border-white/10 text-white font-headline font-black italic text-xs uppercase tracking-wider rounded-xl shadow-lg transition-all cursor-pointer"
          >
            Carregar Mais Atividades ({filteredActivities.length - visibleCount} restantes)
          </button>
        </div>
      )}

      {/* MODAL: ITEM TECHNICAL DETAILS */}
      <AnimatePresence>
        {selectedItem && (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-surface-card border border-white/10 rounded-2xl p-6 max-w-lg w-full shadow-2xl space-y-5 relative max-h-[90vh] overflow-y-auto"
            >
              <button
                onClick={() => setSelectedItem(null)}
                className="absolute top-4 right-4 text-on-surface-variant hover:text-white p-1 rounded-lg bg-white/5 cursor-pointer"
              >
                <X size={18} />
              </button>

              <div className="flex items-center gap-3">
                <div className="p-3 bg-primary/10 border border-primary/20 rounded-xl text-primary">
                  <ShieldCheck size={24} />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white uppercase italic">
                    Relatório de Auditoria IA
                  </h3>
                  <p className="text-xs text-on-surface-variant font-mono">
                    ID: {selectedItem.id}
                  </p>
                </div>
              </div>

              <div className="space-y-3 text-xs bg-black/40 p-4 rounded-xl border border-white/5 font-mono">
                <div className="flex justify-between py-1 border-b border-white/5">
                  <span className="text-on-surface-variant">Tipo de Atividade:</span>
                  <span className="text-white font-bold">{selectedItem.title}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-white/5">
                  <span className="text-on-surface-variant">Data do Registro:</span>
                  <span className="text-white">{selectedItem.dateStr}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-white/5">
                  <span className="text-on-surface-variant">Hora Exata:</span>
                  <span className="text-white">{selectedItem.timeStr}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-white/5">
                  <span className="text-on-surface-variant">Status da Homologação:</span>
                  <span className={cn(
                    "font-bold uppercase",
                    selectedItem.status === 'homologada' && "text-emerald-400",
                    selectedItem.status === 'rejeitada' && "text-rose-400",
                    selectedItem.status === 'pendente' && "text-amber-400"
                  )}>
                    {selectedItem.status.toUpperCase()}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-white/5">
                  <span className="text-on-surface-variant">XP Atribuído:</span>
                  <span className="text-primary font-bold">+{selectedItem.points} XP</span>
                </div>

                {selectedItem.durationMins !== undefined && (
                  <div className="flex justify-between py-1 border-b border-white/5">
                    <span className="text-on-surface-variant">Duração Auditada:</span>
                    <span className="text-white">{selectedItem.durationMins} minutos</span>
                  </div>
                )}

                {selectedItem.distanceKm !== undefined && (
                  <div className="flex justify-between py-1 border-b border-white/5">
                    <span className="text-on-surface-variant">Distância Percorrida:</span>
                    <span className="text-white">{selectedItem.distanceKm.toFixed(2)} km</span>
                  </div>
                )}
              </div>

              {selectedItem.rejectionReason && (
                <div className="p-3 bg-rose-500/10 border border-rose-500/30 text-rose-300 rounded-xl text-xs space-y-1">
                  <span className="font-bold uppercase text-[10px] text-rose-400 block">Motivo do Indeferimento:</span>
                  <p>{selectedItem.rejectionReason}</p>
                </div>
              )}

              {selectedItem.aiAnalysis && (
                <div className="p-3 bg-primary/10 border border-primary/20 text-primary-light rounded-xl text-xs space-y-1">
                  <span className="font-bold uppercase text-[10px] text-primary block">Parecer IA / Biomecânica:</span>
                  <p className="text-zinc-200">{selectedItem.aiAnalysis}</p>
                </div>
              )}

              {selectedItem.photoUrl && (
                <div className="space-y-2">
                  <span className="text-xs font-bold text-white uppercase block">Comprovante de Imagem:</span>
                  <img
                    src={selectedItem.photoUrl}
                    alt="Anexo"
                    className="w-full max-h-56 object-cover rounded-xl border border-white/10"
                  />
                </div>
              )}

              <button
                onClick={() => setSelectedItem(null)}
                className="w-full py-2.5 bg-surface-container hover:bg-surface-container-high text-white font-bold text-xs uppercase rounded-xl cursor-pointer"
              >
                Fechar Detalhes
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* MODAL: FULL PHOTO PREVIEW */}
      <AnimatePresence>
        {previewPhotoUrl && (
          <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-lg flex items-center justify-center p-4">
            <div className="relative max-w-2xl w-full">
              <button
                onClick={() => setPreviewPhotoUrl(null)}
                className="absolute -top-10 right-0 text-white/80 hover:text-white p-2 rounded-full bg-white/10 cursor-pointer"
              >
                <X size={20} />
              </button>
              <img
                src={previewPhotoUrl}
                alt="Comprovante em tamanho real"
                className="w-full max-h-[80vh] object-contain rounded-2xl border border-white/20 shadow-2xl"
              />
            </div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
