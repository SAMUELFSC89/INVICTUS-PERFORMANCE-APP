import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  FileSearch,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { auth } from '../firebase';

type SecurityTab = 'fraud' | 'validation' | 'alerts' | 'system';
type LogEntry = Record<string, any> & { id?: string };

const TAB_CONFIG: Record<SecurityTab, { label: string; category: string }> = {
  fraud: { label: 'Antifraude', category: 'fraud_audit_logs' },
  validation: { label: 'Validação', category: 'activity_validation_logs' },
  alerts: { label: 'Alertas', category: 'system_alerts' },
  system: { label: 'Sistema', category: 'system_logs' },
};

async function adminGet(action: string, params: Record<string, string | number> = {}) {
  const user = auth.currentUser;
  if (!user) throw new Error('Sessão administrativa expirada.');
  const token = await user.getIdToken();
  const query = new URLSearchParams({ action });
  Object.entries(params).forEach(([key, value]) => query.set(key, String(value)));
  const response = await fetch(`/api/admin?${query.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error || 'Falha ao carregar dados de segurança.');
  return payload;
}

function severityClass(severity: unknown): string {
  const value = String(severity || '').toUpperCase();
  if (value === 'CRITICAL') return 'border-rose-500/30 bg-rose-500/10 text-rose-300';
  if (value === 'HIGH_RISK') return 'border-orange-500/30 bg-orange-500/10 text-orange-300';
  if (value === 'WARNING') return 'border-amber-500/30 bg-amber-500/10 text-amber-300';
  return 'border-white/10 bg-white/[0.04] text-neutral-300';
}

function formatDate(raw: unknown): string {
  const date = (raw as any)?.toDate?.() || (raw ? new Date(String(raw)) : null);
  return date && Number.isFinite(date.getTime()) ? date.toLocaleString('pt-BR') : 'Data indisponível';
}

export function AdminSecurityAudit() {
  const [tab, setTab] = useState<SecurityTab>('fraud');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [traceQuery, setTraceQuery] = useState('');
  const [traceLoading, setTraceLoading] = useState(false);
  const [trace, setTrace] = useState<any | null>(null);
  const [traceError, setTraceError] = useState<string | null>(null);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await adminGet('logs', { category: TAB_CONFIG[tab].category, limit: 100 });
      setLogs(Array.isArray(payload.logs) ? payload.logs : []);
    } catch (err: any) {
      setError(err?.message || 'Não foi possível carregar a auditoria.');
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => { void loadLogs(); }, [loadLogs]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return logs;
    return logs.filter((entry) => [entry.id, entry.message, entry.userId, entry.route, entry.severity, JSON.stringify(entry.details || {})]
      .some((value) => String(value || '').toLowerCase().includes(query)));
  }, [logs, search]);

  const metrics = useMemo(() => ({
    total: logs.length,
    critical: logs.filter((entry) => String(entry.severity).toUpperCase() === 'CRITICAL').length,
    highRisk: logs.filter((entry) => String(entry.severity).toUpperCase() === 'HIGH_RISK').length,
    warnings: logs.filter((entry) => String(entry.severity).toUpperCase() === 'WARNING').length,
  }), [logs]);

  const findTrace = async () => {
    const query = traceQuery.trim();
    if (!query) return;
    setTraceLoading(true);
    setTraceError(null);
    setTrace(null);
    try {
      const payload = await adminGet('get-trace', { traceId: query });
      if (!payload) throw new Error('Trace não encontrado.');
      setTrace(payload);
    } catch (err: any) {
      setTraceError(err?.message || 'Trace não encontrado.');
    } finally {
      setTraceLoading(false);
    }
  };

  return (
    <div className="space-y-7 pb-16">
      <section className="rounded-[30px] border border-rose-500/15 bg-gradient-to-br from-rose-500/[0.06] via-neutral-950 to-neutral-950 p-6 md:p-8">
        <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="mb-3 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.24em] text-rose-300"><ShieldCheck size={16} /> Segurança operacional</div>
            <h1 className="font-headline text-3xl font-black uppercase text-white">Antifraude e auditoria</h1>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-neutral-400">Dados reais gravados pelo backend: decisões, validações, alertas e logs do sistema. A antiga tela de “Production Readiness” simulada foi retirada para não apresentar números hardcoded como telemetria de produção.</p>
          </div>
          <button onClick={() => void loadLogs()} disabled={loading} className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-3 text-xs font-black uppercase text-neutral-300 disabled:opacity-50"><RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Atualizar</button>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Eventos carregados" value={metrics.total} icon={FileSearch} />
        <Metric label="Críticos" value={metrics.critical} icon={XCircle} danger={metrics.critical > 0} />
        <Metric label="Alto risco" value={metrics.highRisk} icon={ShieldAlert} danger={metrics.highRisk > 0} />
        <Metric label="Avisos" value={metrics.warnings} icon={AlertTriangle} attention={metrics.warnings > 0} />
      </section>

      <section className="rounded-[28px] border border-white/[0.08] bg-white/[0.025] p-4 md:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex gap-2 overflow-x-auto">
            {(Object.keys(TAB_CONFIG) as SecurityTab[]).map((key) => (
              <button key={key} onClick={() => setTab(key)} className={`whitespace-nowrap rounded-xl border px-4 py-2 text-[10px] font-black uppercase tracking-wider ${tab === key ? 'border-rose-500/45 bg-rose-500/12 text-rose-300' : 'border-white/10 bg-black/20 text-neutral-500'}`}>{TAB_CONFIG[key].label}</button>
            ))}
          </div>
          <div className="relative lg:w-[360px]">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-neutral-600" size={16} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar usuário, rota, mensagem ou detalhe..." className="w-full rounded-2xl border border-white/10 bg-black/30 py-3 pl-11 pr-4 text-xs text-white outline-none placeholder:text-neutral-600 focus:border-rose-500/35" />
          </div>
        </div>

        {error ? <div className="mt-5 rounded-2xl border border-rose-500/20 bg-rose-500/[0.06] p-6 text-center text-sm text-rose-300">{error}</div> : loading ? <div className="py-16 text-center text-xs font-black uppercase tracking-widest text-neutral-600">Carregando logs...</div> : filtered.length === 0 ? <div className="py-16 text-center text-xs text-neutral-500">Nenhum evento encontrado.</div> : (
          <div className="mt-5 space-y-2">
            {filtered.map((entry, index) => (
              <article key={entry.id || `${entry.timestamp}-${index}`} className="rounded-[22px] border border-white/[0.07] bg-black/25 p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2"><span className={`rounded-lg border px-2 py-1 text-[8px] font-black uppercase tracking-wider ${severityClass(entry.severity)}`}>{entry.severity || 'INFO'}</span>{entry.route && <span className="break-all text-[9px] text-neutral-600">{entry.route}</span>}</div>
                    <p className="mt-3 text-sm font-bold leading-relaxed text-neutral-200">{entry.message || 'Evento sem mensagem'}</p>
                    <p className="mt-2 break-all text-[10px] text-neutral-500">Usuário: {entry.userId || 'system'}</p>
                  </div>
                  <p className="shrink-0 text-[10px] text-neutral-600">{formatDate(entry.timestamp || entry.createdAt)}</p>
                </div>
                {entry.details && Object.keys(entry.details).length > 0 && <pre className="mt-4 max-h-48 overflow-auto rounded-2xl border border-white/[0.06] bg-black/35 p-3 text-[10px] leading-relaxed text-neutral-500">{JSON.stringify(entry.details, null, 2)}</pre>}
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-[28px] border border-white/[0.08] bg-white/[0.025] p-5 md:p-6">
        <div className="flex items-start gap-3"><div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-yellow-500/[0.08] text-yellow-400"><FileSearch size={19} /></div><div><p className="text-[10px] font-black uppercase tracking-[0.2em] text-yellow-400">Rastreabilidade</p><h2 className="mt-1 text-lg font-black uppercase text-white">Buscar pipeline trace</h2><p className="mt-1 text-xs text-neutral-500">Aceita trace ID, correlation ID ou activity ID gravado pelo pipeline.</p></div></div>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <input value={traceQuery} onChange={(event) => setTraceQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void findTrace(); }} placeholder="trc_..., corr_... ou activityId" className="flex-1 rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-xs text-white outline-none placeholder:text-neutral-600 focus:border-yellow-500/35" />
          <button disabled={traceLoading || !traceQuery.trim()} onClick={() => void findTrace()} className="rounded-2xl bg-yellow-500 px-5 py-3 text-xs font-black uppercase text-black disabled:opacity-40">{traceLoading ? 'Buscando...' : 'Buscar trace'}</button>
        </div>
        {traceError && <div className="mt-4 rounded-2xl border border-rose-500/20 bg-rose-500/[0.06] p-4 text-xs text-rose-300">{traceError}</div>}
        {trace && <div className="mt-4 rounded-2xl border border-white/[0.07] bg-black/30 p-4"><div className="flex flex-wrap items-center gap-2"><span className={`rounded-lg border px-2 py-1 text-[8px] font-black uppercase ${trace.status === 'COMPLETED' ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300' : trace.status === 'FAILED_AT_STAGE' ? 'border-rose-500/25 bg-rose-500/10 text-rose-300' : 'border-amber-500/25 bg-amber-500/10 text-amber-300'}`}>{trace.status || 'UNKNOWN'}</span><span className="text-[10px] text-neutral-500">Etapa atual: {trace.currentStage || '—'}</span></div><pre className="mt-4 max-h-80 overflow-auto text-[10px] leading-relaxed text-neutral-500">{JSON.stringify(trace, null, 2)}</pre></div>}
      </section>
    </div>
  );
}

function Metric({ label, value, icon: Icon, danger = false, attention = false }: { label: string; value: number; icon: typeof ShieldCheck; danger?: boolean; attention?: boolean }) {
  const className = danger ? 'border-rose-500/30 bg-rose-500/[0.06]' : attention ? 'border-amber-500/30 bg-amber-500/[0.06]' : 'border-white/[0.08] bg-white/[0.025]';
  const text = danger ? 'text-rose-300' : attention ? 'text-amber-300' : 'text-white';
  return <div className={`rounded-[24px] border p-4 ${className}`}><div className="flex items-start justify-between"><div><p className="text-[9px] font-black uppercase tracking-[0.16em] text-neutral-500">{label}</p><p className={`mt-2 font-headline text-3xl font-black ${text}`}>{value}</p></div><div className={`grid h-10 w-10 place-items-center rounded-2xl ${danger ? 'bg-rose-500/10 text-rose-300' : attention ? 'bg-amber-500/10 text-amber-300' : 'bg-yellow-500/[0.08] text-yellow-400'}`}><Icon size={18} /></div></div></div>;
}
