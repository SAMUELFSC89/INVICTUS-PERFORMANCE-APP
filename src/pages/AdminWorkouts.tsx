import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Eye,
  RefreshCw,
  Search,
  ShieldAlert,
  X,
  XCircle,
} from 'lucide-react';
import { collection, getDocs, limit, orderBy, query } from 'firebase/firestore';
import { db } from '../firebase';
import { useNavigate } from 'react-router-dom';

type ActivityFilter = 'all' | 'validated' | 'rejected' | 'pending';

type AdminActivity = Record<string, any> & {
  id: string;
  userId?: string;
};

function finalState(item: AdminActivity): 'validated' | 'rejected' | 'pending' | 'completed' {
  if (item.pendingReview === true || item.dataQualityStatus === 'dedup_pending') return 'pending';
  const validation = String(item.validationStatus || '').toLowerCase();
  const competition = String(item.competitionReviewStatus || item.competitionStatus || '').toLowerCase();
  const status = String(item.status || '').toLowerCase();
  if (validation === 'rejected' || competition === 'rejected' || ['invalid', 'rejected'].includes(status)) return 'rejected';
  if (validation === 'validated' || competition === 'approved' || status === 'valid') return 'validated';
  if (['pending', 'pending_review'].includes(validation) || ['pending', 'pending_review'].includes(competition) || status === 'pending') return 'pending';
  return 'completed';
}

function stateMeta(state: ReturnType<typeof finalState>) {
  if (state === 'validated') return { label: 'Validada', className: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300', icon: CheckCircle2 };
  if (state === 'rejected') return { label: 'Fora da pontuação', className: 'border-rose-500/25 bg-rose-500/10 text-rose-300', icon: XCircle };
  if (state === 'pending') return { label: 'Pendência técnica', className: 'border-amber-500/25 bg-amber-500/10 text-amber-300', icon: AlertTriangle };
  return { label: 'Concluída', className: 'border-white/10 bg-white/[0.04] text-neutral-300', icon: CheckCircle2 };
}

function createdAt(item: AdminActivity): Date | null {
  const raw = item.createdAt || item.timestamp || item.completedAt || item.updatedAt;
  const value = raw?.toDate?.() || (raw ? new Date(raw) : null);
  return value && Number.isFinite(value.getTime()) ? value : null;
}

function label(item: AdminActivity): string {
  if (item.cardioTypeLabel) return String(item.cardioTypeLabel);
  if (item.cardioType) return String(item.cardioType).replaceAll('_', ' ');
  if (item.muscleGroup) return `Musculação · ${item.muscleGroup}`;
  if (item.type === 'cardio') return 'Cardio';
  if (item.type === 'checkin') return 'Check-in';
  return String(item.type || item.activityType || 'Atividade');
}

function durationLabel(item: AdminActivity): string {
  const seconds = Number(item.durationSeconds || item.elapsedSeconds || 0);
  const minutes = Number(item.duration || item.durationMinutes || (seconds > 0 ? seconds / 60 : 0));
  if (!Number.isFinite(minutes) || minutes <= 0) return '—';
  return `${Math.max(1, Math.round(minutes))} min`;
}

export function AdminWorkouts() {
  const navigate = useNavigate();
  const [items, setItems] = useState<AdminActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ActivityFilter>('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<AdminActivity | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let snapshot;
      try {
        snapshot = await getDocs(query(collection(db, 'workouts'), orderBy('createdAt', 'desc'), limit(150)));
      } catch {
        snapshot = await getDocs(query(collection(db, 'workouts'), orderBy('timestamp', 'desc'), limit(150)));
      }
      setItems(snapshot.docs.map((document) => ({ id: document.id, ...document.data() })));
    } catch (err: any) {
      console.error('[AdminWorkouts] load error', err);
      setError(err?.message || 'Não foi possível carregar as atividades.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const counts = useMemo(() => items.reduce((acc, item) => {
    acc[finalState(item)] += 1;
    return acc;
  }, { validated: 0, rejected: 0, pending: 0, completed: 0 }), [items]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((item) => {
      const state = finalState(item);
      if (filter !== 'all' && state !== filter) return false;
      if (!q) return true;
      return [item.id, item.userId, item.type, item.cardioType, item.muscleGroup, item.validationStatus, item.nonScoringReason]
        .some((value) => String(value || '').toLowerCase().includes(q));
    });
  }, [filter, items, search]);

  return (
    <div className="space-y-7 pb-16">
      <section className="rounded-[30px] border border-sky-500/15 bg-gradient-to-br from-sky-500/[0.05] via-neutral-950 to-neutral-950 p-6 md:p-8">
        <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="mb-3 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.24em] text-sky-300"><Activity size={16} /> Histórico operacional</div>
            <h1 className="font-headline text-3xl font-black uppercase text-white">Atividades</h1>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-neutral-400">Consulta dos registros canônicos. Esta tela não altera score, IGA, infrações ou estado competitivo diretamente. Exceções que realmente precisam de intervenção usam a fila de pendências.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => navigate('/admin/flagged-activities')} className="flex items-center gap-2 rounded-2xl border border-amber-500/25 bg-amber-500/[0.07] px-4 py-3 text-xs font-black uppercase text-amber-300"><ShieldAlert size={15} /> Fila de pendências</button>
            <button onClick={() => void load()} disabled={loading} className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-xs font-black uppercase text-neutral-300 disabled:opacity-50"><RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Atualizar</button>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Validadas" value={counts.validated} icon={CheckCircle2} />
        <Metric label="Fora da pontuação" value={counts.rejected} icon={XCircle} />
        <Metric label="Pendências" value={counts.pending} icon={AlertTriangle} attention={counts.pending > 0} />
        <Metric label="Outras concluídas" value={counts.completed} icon={Clock3} />
      </section>

      <section className="rounded-[28px] border border-white/[0.08] bg-white/[0.025] p-4 md:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex gap-2 overflow-x-auto">
            {([
              ['all', 'Todas'],
              ['validated', 'Validadas'],
              ['rejected', 'Fora da pontuação'],
              ['pending', 'Pendências'],
            ] as const).map(([key, text]) => <button key={key} onClick={() => setFilter(key)} className={`whitespace-nowrap rounded-xl border px-4 py-2 text-[10px] font-black uppercase tracking-wider ${filter === key ? 'border-yellow-500/50 bg-yellow-500/15 text-yellow-300' : 'border-white/10 bg-black/20 text-neutral-500'}`}>{text}</button>)}
          </div>
          <div className="relative min-w-0 lg:w-[340px]">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-neutral-600" size={16} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar ID, usuário, tipo ou motivo..." className="w-full rounded-2xl border border-white/10 bg-black/30 py-3 pl-11 pr-4 text-xs text-white outline-none placeholder:text-neutral-600 focus:border-yellow-500/35" />
          </div>
        </div>

        {error ? <div className="mt-5 rounded-2xl border border-rose-500/20 bg-rose-500/[0.06] p-6 text-center text-sm text-rose-300">{error}</div> : loading ? <div className="py-16 text-center text-xs font-black uppercase tracking-widest text-neutral-600">Carregando atividades...</div> : filtered.length === 0 ? <div className="py-16 text-center text-xs text-neutral-500">Nenhuma atividade encontrada.</div> : (
          <div className="mt-5 space-y-2">
            {filtered.map((item) => {
              const state = finalState(item);
              const meta = stateMeta(state);
              const StateIcon = meta.icon;
              const date = createdAt(item);
              return (
                <button key={item.id} onClick={() => setSelected(item)} className="flex w-full flex-col gap-4 rounded-[22px] border border-white/[0.07] bg-black/25 p-4 text-left transition hover:border-white/15 md:flex-row md:items-center md:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-white/10 bg-neutral-900 text-yellow-400"><Activity size={18} /></div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2"><span className="truncate text-sm font-black uppercase text-white">{label(item)}</span><span className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[8px] font-black uppercase tracking-wider ${meta.className}`}><StateIcon size={10} /> {meta.label}</span></div>
                      <p className="mt-1 truncate text-[10px] text-neutral-500">{item.userId || 'usuário desconhecido'} · {date ? date.toLocaleString('pt-BR') : 'sem data'}</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-5 md:justify-end">
                    <div className="text-right"><p className="text-xs font-black text-white">{durationLabel(item)}</p><p className="mt-1 text-[9px] uppercase text-neutral-600">{item.distance ? `${Number(item.distance).toFixed(2)} km` : item.calories ? `${Math.round(Number(item.calories))} kcal` : 'registro'}</p></div>
                    <Eye size={17} className="text-neutral-600" />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {selected && (
        <div className="fixed inset-0 z-[140] grid place-items-center bg-black/80 p-4 backdrop-blur-md" onClick={() => setSelected(null)}>
          <div className="max-h-[86dvh] w-full max-w-2xl overflow-y-auto rounded-[30px] border border-white/10 bg-[#0b0b0c] p-6 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-4">
              <div><p className="text-[9px] font-black uppercase tracking-[0.2em] text-yellow-400">Detalhes da atividade</p><h2 className="mt-1 font-headline text-2xl font-black uppercase text-white">{label(selected)}</h2><p className="mt-1 break-all text-[10px] text-neutral-500">{selected.id}</p></div>
              <button onClick={() => setSelected(null)} className="grid h-9 w-9 place-items-center rounded-xl border border-white/10 text-neutral-500"><X size={16} /></button>
            </div>

            {selected.photoUrl && <img src={selected.photoUrl} alt="Registro da atividade" className="mt-5 max-h-[360px] w-full rounded-2xl object-cover" referrerPolicy="no-referrer" />}

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <Detail label="Usuário" value={selected.userId || '—'} />
              <Detail label="Estado" value={stateMeta(finalState(selected)).label} />
              <Detail label="Validação" value={selected.validationStatus || selected.validation?.status || '—'} />
              <Detail label="Competição" value={selected.competitionReviewStatus || selected.competitionStatus || '—'} />
              <Detail label="Decisão antifraude" value={selected.securityDecision || '—'} />
              <Detail label="Motivo" value={selected.nonScoringReason || selected.rejectionReason || '—'} />
            </div>

            {finalState(selected) === 'pending' && <button onClick={() => navigate('/admin/flagged-activities')} className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-yellow-500 px-4 py-3 text-xs font-black uppercase text-black"><ShieldAlert size={15} /> Abrir fila canônica de pendências</button>}
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, icon: Icon, attention = false }: { label: string; value: number; icon: typeof Activity; attention?: boolean }) {
  return <div className={`rounded-[24px] border p-4 ${attention ? 'border-amber-500/30 bg-amber-500/[0.06]' : 'border-white/[0.08] bg-white/[0.025]'}`}><div className="flex items-start justify-between"><div><p className="text-[9px] font-black uppercase tracking-[0.16em] text-neutral-500">{label}</p><p className={`mt-2 font-headline text-3xl font-black ${attention ? 'text-amber-300' : 'text-white'}`}>{value}</p></div><div className={`grid h-10 w-10 place-items-center rounded-2xl ${attention ? 'bg-amber-500/10 text-amber-300' : 'bg-yellow-500/[0.08] text-yellow-400'}`}><Icon size={18} /></div></div></div>;
}

function Detail({ label, value }: { label: string; value: unknown }) {
  return <div className="rounded-2xl border border-white/[0.06] bg-black/25 p-4"><p className="text-[8px] font-black uppercase tracking-[0.18em] text-neutral-600">{label}</p><p className="mt-2 break-words text-xs font-bold text-neutral-200">{String(value ?? '—')}</p></div>;
}
