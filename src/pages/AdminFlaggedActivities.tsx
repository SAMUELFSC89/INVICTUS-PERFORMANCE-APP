import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Clock3,
  RefreshCw,
  Search,
  ShieldAlert,
  X,
} from 'lucide-react';
import { auth } from '../firebase';
import { VALIDATION_MESSAGES } from '../services/validationMessages';

type FlaggedActivity = Record<string, any> & { id: string; userId?: string };

function activityLabel(item: FlaggedActivity): string {
  if (item.cardioTypeLabel) return String(item.cardioTypeLabel);
  if (item.cardioType) return String(item.cardioType).replaceAll('_', ' ');
  if (item.muscleGroup) return `Musculação · ${item.muscleGroup}`;
  if (item.type === 'cardio') return 'Cardio';
  if (item.type === 'checkin') return 'Check-in';
  return String(item.type || 'Atividade');
}

function reasonLabel(item: FlaggedActivity): string {
  const raw = item.userMessage || item.rejectionReason || item.nonScoringReason || item.securityDecision;
  if (!raw) return 'Estado legado/inconsistente sem motivo explícito.';
  return VALIDATION_MESSAGES[String(raw)] || String(raw).replaceAll('_', ' ');
}

function formatDate(item: FlaggedActivity): string {
  const raw = item.createdAt || item.timestamp || item.updatedAt;
  const date = raw?.toDate?.() || (raw ? new Date(raw) : null);
  if (!date || !Number.isFinite(date.getTime())) return 'Data indisponível';
  return date.toLocaleString('pt-BR');
}

async function adminRequest(action: string, body?: Record<string, unknown>) {
  const user = auth.currentUser;
  if (!user) throw new Error('Sessão administrativa expirada.');
  const token = await user.getIdToken();
  const response = await fetch(`/api/admin?action=${encodeURIComponent(action)}${body ? '' : '&limit=100'}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.success === false) throw new Error(payload?.error || payload?.message || 'Falha na operação administrativa.');
  return payload;
}

export function AdminFlaggedActivities() {
  const [activities, setActivities] = useState<FlaggedActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const payload = await adminRequest('list-flagged-activities');
      setActivities(Array.isArray(payload.activities) ? payload.activities : []);
    } catch (err: any) {
      setError(err?.message || 'Não foi possível carregar a fila.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return activities;
    return activities.filter((item) => [item.id, item.userId, activityLabel(item), reasonLabel(item)].some((value) => String(value || '').toLowerCase().includes(q)));
  }, [activities, search]);

  const review = async (item: FlaggedActivity, status: 'valid' | 'invalid') => {
    const verb = status === 'valid' ? 'APROVAR' : 'REJEITAR';
    if (!window.confirm(`${verb} manualmente esta exceção competitiva? A decisão será registrada na auditoria e o IGA/ranking serão recalculados pelo backend.`)) return;
    const resolution = window.prompt('Observação da decisão (opcional):') || undefined;
    setReviewingId(item.id);
    setFeedback(null);
    try {
      const result = await adminRequest('review-activity', { activityId: item.id, status, resolution });
      setActivities((current) => current.filter((activity) => activity.id !== item.id));
      setFeedback(result.message || 'Decisão registrada com sucesso.');
    } catch (err: any) {
      setError(err?.message || 'Não foi possível revisar a atividade.');
    } finally {
      setReviewingId(null);
    }
  };

  return (
    <div className="space-y-7 pb-16">
      <section className="rounded-[30px] border border-amber-500/20 bg-gradient-to-br from-amber-500/[0.07] via-neutral-950 to-neutral-950 p-6 md:p-8">
        <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="mb-3 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.24em] text-amber-300"><ShieldAlert size={16} /> Exceções manuais</div>
            <h1 className="font-headline text-3xl font-black uppercase text-white">Fila de pendências</h1>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-neutral-400">O antifraude automático é terminal: APPROVED valida; BLOCKED, UNDER_REVIEW e PARTIALLY_APPROVED rejeitam. Esta fila existe apenas para estados legados/inconsistentes ou exceções que permaneceram marcadas como <strong className="text-white">pendingReview</strong> e realmente precisam de decisão humana.</p>
          </div>
          <button onClick={() => { setRefreshing(true); void load(true); }} disabled={refreshing || loading} className="flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-3 text-xs font-black uppercase text-neutral-300 disabled:opacity-50"><RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} /> Atualizar fila</button>
        </div>
      </section>

      {feedback && <div className="flex items-center gap-3 rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.07] p-4 text-xs font-bold text-emerald-300"><Check size={17} /> {feedback}</div>}

      <section className="grid gap-3 sm:grid-cols-2">
        <div className={`rounded-[24px] border p-5 ${activities.length > 0 ? 'border-amber-500/30 bg-amber-500/[0.06]' : 'border-white/[0.08] bg-white/[0.025]'}`}><p className="text-[9px] font-black uppercase tracking-[0.18em] text-neutral-500">Pendências atuais</p><p className={`mt-2 font-headline text-3xl font-black ${activities.length > 0 ? 'text-amber-300' : 'text-white'}`}>{activities.length}</p></div>
        <div className="rounded-[24px] border border-white/[0.08] bg-white/[0.025] p-5"><p className="text-[9px] font-black uppercase tracking-[0.18em] text-neutral-500">Política vigente</p><p className="mt-2 text-sm font-black uppercase text-white">Sem revisão humana do antifraude automático</p><p className="mt-1 text-[10px] text-neutral-500">Só exceções legadas/inconsistentes chegam aqui.</p></div>
      </section>

      <section className="rounded-[28px] border border-white/[0.08] bg-white/[0.025] p-4 md:p-5">
        <div className="relative max-w-xl">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-neutral-600" size={16} />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar atividade, usuário ou motivo..." className="w-full rounded-2xl border border-white/10 bg-black/30 py-3 pl-11 pr-4 text-xs text-white outline-none placeholder:text-neutral-600 focus:border-yellow-500/35" />
        </div>

        {error ? <div className="mt-5 rounded-2xl border border-rose-500/20 bg-rose-500/[0.06] p-6 text-center"><AlertTriangle className="mx-auto text-rose-400" size={28} /><p className="mt-3 text-sm text-rose-300">{error}</p><button onClick={() => void load()} className="mt-4 rounded-xl border border-rose-500/30 px-4 py-2 text-xs font-black uppercase text-rose-300">Tentar novamente</button></div> : loading ? <div className="py-16 text-center text-xs font-black uppercase tracking-widest text-neutral-600">Carregando pendências...</div> : filtered.length === 0 ? <div className="py-16 text-center"><Check className="mx-auto text-emerald-400" size={28} /><p className="mt-3 text-xs text-neutral-500">Nenhuma exceção manual pendente.</p></div> : (
          <div className="mt-5 space-y-3">
            {filtered.map((item) => {
              const busy = reviewingId === item.id;
              return <article key={item.id} className="rounded-[24px] border border-amber-500/15 bg-black/25 p-5">
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="text-sm font-black uppercase text-white">{activityLabel(item)}</h2><span className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-2 py-1 text-[8px] font-black uppercase tracking-wider text-amber-300">Pendente manual</span></div><p className="mt-2 break-all text-[10px] text-neutral-500">ID: {item.id} · Atleta: {item.userId || '—'}</p><p className="mt-1 flex items-center gap-1 text-[10px] text-neutral-500"><Clock3 size={11} /> {formatDate(item)}</p></div>
                  <div className="text-xs text-neutral-400">{item.duration ? `${item.duration} min` : ''}{item.distance ? ` · ${Number(item.distance).toFixed(2)} km` : ''}</div>
                </div>
                <div className="mt-4 flex items-start gap-2 rounded-2xl border border-amber-500/10 bg-amber-500/[0.04] p-3 text-xs text-amber-100/80"><AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-400" /><span>{reasonLabel(item)}</span></div>
                <div className="mt-4 flex flex-wrap gap-2 border-t border-white/[0.06] pt-4">
                  <button disabled={busy} onClick={() => void review(item, 'valid')} className="flex items-center gap-2 rounded-xl bg-yellow-500 px-4 py-2 text-[10px] font-black uppercase text-black disabled:opacity-50"><Check size={13} /> Aprovar</button>
                  <button disabled={busy} onClick={() => void review(item, 'invalid')} className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/[0.06] px-4 py-2 text-[10px] font-black uppercase text-rose-300 disabled:opacity-50"><X size={13} /> Rejeitar</button>
                  {busy && <span className="self-center text-[10px] text-neutral-500">Salvando decisão...</span>}
                </div>
              </article>;
            })}
          </div>
        )}
      </section>
    </div>
  );
}
