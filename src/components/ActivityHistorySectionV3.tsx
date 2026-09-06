import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Dumbbell,
  Flame,
  Gauge,
  MapPin,
  RefreshCw,
  Route,
  Search,
  ShieldCheck,
  TimerReset,
  Trophy,
  X,
  XCircle,
} from 'lucide-react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { auth, db, onAuthStateChanged } from '../firebase';
import { readActivityTimestamp, resolveActivityState } from '../lib/workoutData';
import { VALIDATION_MESSAGES } from '../services/validationMessages';
import { ActivityDetailScreen, type ActivityHistoryItem } from './ActivityHistorySection';
import { RunShareCard } from './RunShareCard';
import './ActivityHistorySectionV3.css';

type ActivityFilter = 'all' | 'workout' | 'cardio' | 'power' | 'checkin';
type StatusFilter = 'all' | 'completed' | 'approved' | 'pending' | 'rejected';

function timestampOf(data: any, primary?: unknown, fallback?: unknown): number {
  return readActivityTimestamp(primary ?? data?.timestamp)
    ?? readActivityTimestamp(fallback ?? data?.createdAt)
    ?? 0;
}

function formatDate(ms: number): string {
  if (!ms) return 'Data indisponível';
  const date = new Date(ms);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return 'Hoje';
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return 'Ontem';
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatTime(ms: number): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function durationLabel(minutes?: number): string {
  const total = Math.max(0, Math.round((Number(minutes) || 0) * 60));
  const hours = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) return `${hours}h ${String(mins).padStart(2, '0')}m`;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function optionalNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function trajectoryOf(data: any): Array<{ lat: number; lng: number }> | undefined {
  const raw = Array.isArray(data?.trajectory) ? data.trajectory : Array.isArray(data?.checkpoints) ? data.checkpoints : [];
  const points = raw.flatMap((item: any) => {
    const location = item?.location || item;
    const lat = Number(location?.lat ?? location?.latitude);
    const lng = Number(location?.lng ?? location?.longitude);
    return Number.isFinite(lat) && Number.isFinite(lng) ? [{ lat, lng }] : [];
  });
  return points.length ? points : undefined;
}

function reasonOf(item: ActivityHistoryItem): string | undefined {
  const raw = item.rejectionReason || item.details?.nonScoringReason || item.details?.rejectionReason;
  if (!raw) return undefined;
  if (VALIDATION_MESSAGES[raw]) return VALIDATION_MESSAGES[raw];
  if (raw === 'SECURITY_PIPELINE_ERROR') return 'O processamento de segurança encontrou uma falha técnica e será tentado novamente automaticamente.';
  if (raw === 'DEDUPLICATION_UNAVAILABLE') return 'Estamos conciliando esta atividade com outras fontes antes de liberar qualquer pontuação.';
  if (String(raw).startsWith('SECURITY_PIPELINE_')) return 'O motor antifraude encontrou sinais que exigem uma revisão adicional antes de liberar a pontuação.';
  if (raw === 'GEOFENCE_CHECKIN_REQUIRED') return 'O check-in exigido para esta competição não foi confirmado nesta sessão.';
  if (raw === 'GEOFENCE_CHECKIN_INVALID') return 'O check-in desta sessão não correspondeu às regras da competição.';
  return String(raw).replaceAll('_', ' ').toLowerCase();
}

function pendingKind(item: ActivityHistoryItem): { label: string; helper: string; technical: boolean } {
  const reason = String(item.details?.nonScoringReason || item.rejectionReason || '').toUpperCase();
  const decision = String(item.details?.securityDecision || '').toUpperCase();
  if (item.source === 'power') return { label: 'REVISÃO DE VÍDEO', helper: 'Aguardando homologação do levantamento.', technical: false };
  if (reason === 'SECURITY_PIPELINE_ERROR' || reason === 'DEDUPLICATION_UNAVAILABLE' || item.details?.dataQualityStatus === 'dedup_pending') {
    return { label: 'PROCESSANDO', helper: 'Pendência técnica com nova tentativa automática.', technical: true };
  }
  if (decision === 'UNDER_REVIEW' || decision === 'PARTIALLY_APPROVED') {
    return { label: 'REVISÃO DE SEGURANÇA', helper: 'O antifraude pediu validação adicional.', technical: false };
  }
  return { label: 'EM ANÁLISE', helper: 'A pontuação competitiva ainda não foi concluída.', technical: false };
}

function statusClass(item: ActivityHistoryItem): string {
  if (item.status === 'homologada') return 'is-approved';
  if (item.status === 'rejeitada') return 'is-rejected';
  if (item.status === 'pendente') return 'is-pending';
  return 'is-completed';
}

function statusLabel(item: ActivityHistoryItem): string {
  if (item.status === 'homologada') return 'VALIDADA';
  if (item.status === 'rejeitada') return 'FORA DA PONTUAÇÃO';
  if (item.status === 'pendente') return pendingKind(item).label;
  return 'CONCLUÍDA';
}

function activityIcon(type: ActivityHistoryItem['type']) {
  if (type === 'cardio') return <Activity />;
  if (type === 'power') return <Trophy />;
  if (type === 'checkin') return <MapPin />;
  return <Dumbbell />;
}

function toShareSession(item: ActivityHistoryItem) {
  return {
    id: item.id,
    title: item.title,
    distanceKm: item.distanceKm,
    durationMins: item.durationMins,
    pace: item.pace,
    calories: item.calories,
    avgHeartRate: item.avgHeartRate,
    elevationGain: item.elevationGain,
    steps: item.steps,
    trajectory: item.trajectory,
    timestamp: item.rawTimestamp ? new Date(item.rawTimestamp).toISOString() : undefined,
    rankingPointsEarned: item.rankingPointsEarned,
    points: item.points,
    status: item.status,
    recordStatus: item.recordStatus,
    activityMode: item.activityMode,
    competitionReviewStatus: item.competitionStatus,
    photoUrl: item.photoUrl,
  } as any;
}

export function ActivityHistorySectionV3() {
  const [activities, setActivities] = useState<ActivityHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queryText, setQueryText] = useState('');
  const [typeFilter, setTypeFilter] = useState<ActivityFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [detail, setDetail] = useState<ActivityHistoryItem | null>(null);
  const [share, setShare] = useState<ActivityHistoryItem | null>(null);

  const load = useCallback(async (silent = false) => {
    const user = auth.currentUser;
    if (!user) {
      setActivities([]);
      setLoading(false);
      return;
    }
    if (!silent) setLoading(true);
    setError(null);
    try {
      const [workoutsSnap, checkinsSnap, powerSnap] = await Promise.all([
        getDocs(query(collection(db, 'workouts'), where('userId', '==', user.uid))),
        getDocs(query(collection(db, 'gym_checkins'), where('userId', '==', user.uid))),
        getDocs(query(collection(db, 'power_records'), where('userId', '==', user.uid))),
      ]);
      const next: ActivityHistoryItem[] = [];

      workoutsSnap.forEach((document) => {
        const data: any = document.data();
        if (data.dataQualityStatus === 'duplicate' || data.nonScoringReason === 'DUPLICATE_ACTIVITY') return;
        const state = resolveActivityState(data);
        let status: ActivityHistoryItem['status'] = 'registrada';
        if (state.competitionStatus === 'approved') status = 'homologada';
        else if (state.competitionStatus === 'rejected' || state.competitionStatus === 'ineligible') status = 'rejeitada';
        else if (state.competitionStatus === 'pending' || state.competitionStatus === 'resolution_pending') status = 'pendente';
        const ms = timestampOf(data, data.startTime ?? data.timestamp, data.createdAt);
        const duration = optionalNumber(data.duration ?? data.durationMins ?? data.durationMinutes);
        const distance = optionalNumber(data.distance ?? data.distanceKm);
        const type = data.type === 'cardio' ? 'cardio' : 'workout';
        next.push({
          id: document.id,
          source: 'workout',
          type,
          typeLabel: type === 'cardio' ? (data.cardioTypeLabel || 'Cardio') : 'Musculação',
          title: type === 'cardio' ? (data.cardioTypeLabel || (data.isIndoorCardio ? 'Cardio indoor' : 'Cardio ao ar livre')) : (data.muscleGroup ? `Treino de ${data.muscleGroup}` : 'Treino de musculação'),
          subtitle: data.gymName || undefined,
          dateStr: formatDate(ms),
          timeStr: formatTime(ms),
          rawTimestamp: ms,
          status,
          statusRaw: String(data.validationStatus || data.status || ''),
          recordStatus: state.recordStatus,
          activityMode: state.activityMode,
          competitionStatus: state.competitionStatus,
          competitionName: data.competitionName,
          points: numberOrZero(data.activityXpAwarded ?? data.scoreAwarded ?? data.points),
          rankingPointsEarned: optionalNumber(data.rankingPointsEarned),
          durationMins: duration,
          distanceKm: distance,
          photoUrl: data.photoUrl || data.verificationPhotoUrl,
          rejectionReason: data.userMessage || data.nonScoringReason || data.rejectionReason,
          avgHeartRate: optionalNumber(data.avgHeartRate),
          calories: optionalNumber(data.calories),
          pace: typeof data.pace === 'string' ? data.pace.replace(/\s*\/\s*km\s*$/i, '') : undefined,
          elevationGain: optionalNumber(data.elevationGain),
          steps: optionalNumber(data.steps),
          trajectory: trajectoryOf(data),
          details: { ...data, userId: data.userId },
        });
      });

      checkinsSnap.forEach((document) => {
        const data: any = document.data();
        const raw = String(data.status || '').toLowerCase();
        const status: ActivityHistoryItem['status'] = ['confirmed', 'valid', 'approved'].includes(raw)
          ? 'homologada' : ['rejected', 'invalid'].includes(raw) ? 'rejeitada' : 'pendente';
        const ms = timestampOf(data, data.checkInTime, data.createdAt);
        next.push({
          id: document.id,
          source: 'checkin',
          type: 'checkin',
          typeLabel: 'Check-in GPS',
          title: data.gymName ? `Check-in · ${data.gymName}` : 'Check-in presencial',
          dateStr: formatDate(ms),
          timeStr: formatTime(ms),
          rawTimestamp: ms,
          status,
          statusRaw: raw,
          points: status === 'homologada' ? numberOrZero(data.points) : 0,
          gymName: data.gymName,
          rejectionReason: data.error || data.rejectionReason,
          details: data,
        });
      });

      powerSnap.forEach((document) => {
        const data: any = document.data();
        const raw = String(data.videoStatus || data.status || '').toLowerCase();
        const status: ActivityHistoryItem['status'] = ['validated', 'valid', 'approved'].includes(raw)
          ? 'homologada' : ['rejected', 'invalid'].includes(raw) ? 'rejeitada' : 'pendente';
        const ms = timestampOf(data, data.timestamp, data.createdAt);
        next.push({
          id: document.id,
          source: 'power',
          type: 'power',
          typeLabel: 'Power Lift',
          title: `Power Lift · ${String(data.exercise || 'levantamento').toUpperCase()}`,
          subtitle: data.weight ? `${data.weight} kg` : undefined,
          dateStr: formatDate(ms),
          timeStr: formatTime(ms),
          rawTimestamp: ms,
          status,
          statusRaw: raw,
          points: status === 'homologada' ? numberOrZero(data.points) : 0,
          weightKg: optionalNumber(data.weight),
          exerciseName: data.exercise,
          rejectionReason: data.rejectionReason,
          details: data,
        });
      });

      next.sort((a, b) => b.rawTimestamp - a.rawTimestamp);
      setActivities(next);
    } catch (cause) {
      console.error('[ActivityHistorySectionV3] Falha ao carregar histórico:', cause);
      setError('Não foi possível carregar seu histórico agora.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, () => { void load(); });
    return unsubscribe;
  }, [load]);

  const pendingCount = activities.filter(item => item.status === 'pendente').length;
  useEffect(() => {
    if (!pendingCount) return;
    const timer = window.setInterval(() => void load(true), 20_000);
    return () => window.clearInterval(timer);
  }, [load, pendingCount]);

  const stats = useMemo(() => ({
    total: activities.length,
    approved: activities.filter(item => item.status === 'homologada').length,
    pending: pendingCount,
    cardio: activities.filter(item => item.type === 'cardio').length,
  }), [activities, pendingCount]);

  const filtered = useMemo(() => activities.filter((item) => {
    if (typeFilter !== 'all' && item.type !== typeFilter) return false;
    if (statusFilter === 'completed' && item.status !== 'registrada') return false;
    if (statusFilter === 'approved' && item.status !== 'homologada') return false;
    if (statusFilter === 'pending' && item.status !== 'pendente') return false;
    if (statusFilter === 'rejected' && item.status !== 'rejeitada') return false;
    const q = queryText.trim().toLowerCase();
    if (!q) return true;
    return [item.title, item.typeLabel, item.dateStr, item.gymName, reasonOf(item)]
      .filter(Boolean)
      .some(value => String(value).toLowerCase().includes(q));
  }), [activities, typeFilter, statusFilter, queryText]);

  const groups = useMemo(() => {
    const map = new Map<string, ActivityHistoryItem[]>();
    filtered.forEach((item) => {
      const key = item.dateStr || 'Sem data';
      map.set(key, [...(map.get(key) || []), item]);
    });
    return [...map.entries()];
  }, [filtered]);

  const refresh = () => {
    setRefreshing(true);
    void load(true);
  };

  return <section className="ahv3-shell">
    <div className="ahv3-overview">
      <article><span>ATIVIDADES</span><b>{stats.total}</b><small>registradas</small></article>
      <article><span>VALIDADAS</span><b>{stats.approved}</b><small>competitivas</small></article>
      <article className={stats.pending ? 'is-warning' : ''}><span>REVISÃO</span><b>{stats.pending}</b><small>{stats.pending ? 'acompanhando' : 'nenhuma pendência'}</small></article>
    </div>

    <div className="ahv3-controls">
      <div className="ahv3-search"><Search /><input value={queryText} onChange={event => setQueryText(event.target.value)} placeholder="Buscar atividade..." />{queryText && <button onClick={() => setQueryText('')} aria-label="Limpar busca"><X /></button>}</div>
      <button className="ahv3-refresh" onClick={refresh} disabled={refreshing || loading} aria-label="Atualizar histórico"><RefreshCw className={refreshing ? 'is-spinning' : ''} /></button>
    </div>

    <div className="ahv3-filter-row" aria-label="Filtrar modalidade">
      {([
        ['all', 'Todas'], ['workout', 'Musculação'], ['cardio', 'Cardio'], ['power', 'Power Lift'], ['checkin', 'Check-in'],
      ] as Array<[ActivityFilter, string]>).map(([id, label]) => <button key={id} onClick={() => setTypeFilter(id)} className={typeFilter === id ? 'is-active' : ''}>{label}</button>)}
    </div>
    <div className="ahv3-filter-row is-status" aria-label="Filtrar status">
      {([
        ['all', 'Todos'], ['completed', 'Concluídas'], ['approved', 'Validadas'], ['pending', 'Em revisão'], ['rejected', 'Fora da pontuação'],
      ] as Array<[StatusFilter, string]>).map(([id, label]) => <button key={id} onClick={() => setStatusFilter(id)} className={statusFilter === id ? 'is-active' : ''}>{label}</button>)}
    </div>

    {pendingCount > 0 && <div className="ahv3-pending-note"><TimerReset /><div><b>{pendingCount} {pendingCount === 1 ? 'atividade está' : 'atividades estão'} sendo acompanhada{pendingCount === 1 ? '' : 's'}</b><span>Pendências técnicas são reprocessadas automaticamente. Casos realmente duvidosos seguem para revisão de segurança.</span></div></div>}

    {loading ? <div className="ahv3-state"><RefreshCw className="is-spinning" /><span>Carregando seu histórico...</span></div>
      : error ? <div className="ahv3-state is-error"><AlertTriangle /><span>{error}</span><button onClick={() => void load()}>Tentar novamente</button></div>
        : filtered.length === 0 ? <div className="ahv3-state"><CalendarDays /><b>Nenhuma atividade encontrada</b><span>Ajuste os filtros ou registre uma nova atividade.</span></div>
          : <div className="ahv3-timeline">{groups.map(([label, items]) => <section className="ahv3-day" key={label}><header><span>{label}</span><i>{items.length}</i></header><div>{items.map((item) => {
            const pending = item.status === 'pendente' ? pendingKind(item) : null;
            const reason = reasonOf(item);
            return <article className={`ahv3-card ${statusClass(item)}`} key={`${item.source}:${item.id}`}>
              <button className="ahv3-card-main" onClick={() => setDetail(item)}>
                <span className="ahv3-icon">{activityIcon(item.type)}</span>
                <div className="ahv3-card-copy">
                  <div className="ahv3-card-topline"><span>{item.typeLabel}</span><em className={statusClass(item)}>{item.status === 'homologada' ? <ShieldCheck /> : item.status === 'rejeitada' ? <XCircle /> : item.status === 'pendente' ? <Clock3 /> : <CheckCircle2 />}{statusLabel(item)}</em></div>
                  <h3>{item.title}</h3>
                  <p>{item.timeStr}{item.gymName ? ` · ${item.gymName}` : item.subtitle ? ` · ${item.subtitle}` : ''}</p>
                </div>
                <ChevronRight className="ahv3-chevron" />
              </button>

              <div className="ahv3-metrics">
                <span><Clock3 /><b>{item.durationMins !== undefined ? durationLabel(item.durationMins) : '—'}</b><small>tempo</small></span>
                {item.type === 'power'
                  ? <span><Dumbbell /><b>{item.weightKg !== undefined ? `${item.weightKg} kg` : '—'}</b><small>carga</small></span>
                  : <span><Route /><b>{item.distanceKm !== undefined && item.distanceKm > 0 ? `${item.distanceKm.toFixed(2)} km` : item.trajectory?.length ? 'GPS' : '—'}</b><small>{item.trajectory?.length ? 'rota' : 'distância'}</small></span>}
                <span>{item.calories !== undefined ? <Flame /> : <Gauge />}<b>{item.calories !== undefined ? `${Math.round(item.calories)} kcal` : item.points > 0 ? `+${item.points} XP` : '—'}</b><small>{item.calories !== undefined ? 'energia' : 'recompensa'}</small></span>
              </div>

              {pending && <div className={`ahv3-review ${pending.technical ? 'is-technical' : ''}`}><Clock3 /><div><b>{pending.label}</b><span>{reason || pending.helper}</span></div></div>}
              {item.status === 'rejeitada' && <div className="ahv3-review is-rejected"><XCircle /><div><b>PONTUAÇÃO NÃO LIBERADA</b><span>{reason || 'A atividade continua salva no histórico pessoal, mas não conta para a competição.'}</span></div></div>}
            </article>;
          })}</div></section>)}</div>}

    {detail && <ActivityDetailScreen item={detail} onClose={() => setDetail(null)} onShare={() => setShare(detail)} />}
    {share && <RunShareCard session={toShareSession(share)} onClose={() => setShare(null)} />}
  </section>;
}

function numberOrZero(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
