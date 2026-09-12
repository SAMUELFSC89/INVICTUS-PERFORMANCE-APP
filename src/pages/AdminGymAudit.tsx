import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  MapPin,
  RefreshCw,
  Search,
  ShieldAlert,
  Wrench,
  XCircle,
} from 'lucide-react';
import { auth } from '../firebase';

type AuditFilter = 'all' | 'errors' | 'warnings' | 'ok';

type AuditItem = {
  id: string;
  placeId: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  registeredAddress: string;
  googleMapsAddress: string;
  googleMapsLat: number | null;
  googleMapsLng: number | null;
  distanceMeters: number | null;
  status: 'OK' | 'WARNING' | 'ERROR';
  errors: string[];
  warnings: string[];
};

type AuditReport = {
  success: true;
  providerConfigured: boolean;
  gymsCount: number;
  errorsCount: number;
  warningsCount: number;
  results: AuditItem[];
  timestamp: string;
};

async function adminRequest(action: string, body?: Record<string, unknown>) {
  const user = auth.currentUser;
  if (!user) throw new Error('Sessão administrativa expirada.');
  const token = await user.getIdToken();
  const response = await fetch(`/api/admin?action=${encodeURIComponent(action)}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.success === false) throw new Error(payload?.error || payload?.message || 'Falha na auditoria de academias.');
  return payload;
}

function statusClass(status: AuditItem['status']): string {
  if (status === 'ERROR') return 'border-rose-500/25 bg-rose-500/[0.06]';
  if (status === 'WARNING') return 'border-amber-500/25 bg-amber-500/[0.06]';
  return 'border-emerald-500/15 bg-emerald-500/[0.035]';
}

export function AdminGymAudit() {
  const [report, setReport] = useState<AuditReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<AuditFilter>('all');
  const [search, setSearch] = useState('');
  const [fixingId, setFixingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await adminRequest('gyms-audit');
      setReport(payload as AuditReport);
    } catch (err: any) {
      setError(err?.message || 'Não foi possível executar a auditoria.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (report?.results || []).filter((item) => {
      if (filter === 'errors' && item.status !== 'ERROR') return false;
      if (filter === 'warnings' && item.status !== 'WARNING') return false;
      if (filter === 'ok' && item.status !== 'OK') return false;
      if (!q) return true;
      return [item.id, item.name, item.registeredAddress, item.googleMapsAddress, item.placeId]
        .some((value) => String(value || '').toLowerCase().includes(q));
    });
  }, [filter, report, search]);

  const fixGym = async (item: AuditItem) => {
    if (!window.confirm(`Sincronizar "${item.name}" com a localização canônica do Google Places?`)) return;
    setFixingId(item.id);
    setFeedback(null);
    try {
      const result = await adminRequest('fix-gym-coordinates', { gymId: item.id });
      setFeedback(`Academia sincronizada. ${Number(result.affectedUsers || 0)} perfil(is) vinculado(s) atualizado(s).`);
      await load();
    } catch (err: any) {
      setError(err?.message || 'Não foi possível corrigir a academia.');
    } finally {
      setFixingId(null);
    }
  };

  const healthy = report ? Math.max(0, report.gymsCount - report.errorsCount - report.warningsCount) : 0;

  return (
    <div className="space-y-7 pb-16">
      <section className="rounded-[30px] border border-sky-500/15 bg-gradient-to-br from-sky-500/[0.06] via-neutral-950 to-neutral-950 p-6 md:p-8">
        <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="mb-3 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.24em] text-sky-300"><Building2 size={16} /> Geofence canônica</div>
            <h1 className="font-headline text-3xl font-black uppercase text-white">Academias</h1>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-neutral-400">Compara o cadastro usado pelo check-in com o ponto oficial do Google Places. Divergências acima de 30 metros são tratadas como erro. Correções são feitas pelo servidor e sincronizam os perfis vinculados.</p>
          </div>
          <button onClick={() => void load()} disabled={loading} className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-3 text-xs font-black uppercase text-neutral-300 disabled:opacity-50"><RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Auditar novamente</button>
        </div>
      </section>

      {feedback && <div className="flex items-center gap-3 rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.07] p-4 text-xs font-bold text-emerald-300"><CheckCircle2 size={17} /> {feedback}</div>}
      {report && !report.providerConfigured && <div className="flex items-start gap-3 rounded-2xl border border-amber-500/25 bg-amber-500/[0.07] p-4 text-xs text-amber-200"><AlertTriangle size={17} className="shrink-0" /><span>Google Places não está configurado neste ambiente. A tela continua validando estrutura e coordenadas locais, mas não consegue fazer comparação externa.</span></div>}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Academias" value={report?.gymsCount ?? 0} icon={Building2} />
        <Metric label="Consistentes" value={healthy} icon={CheckCircle2} />
        <Metric label="Avisos" value={report?.warningsCount ?? 0} icon={AlertTriangle} attention={(report?.warningsCount || 0) > 0} />
        <Metric label="Erros" value={report?.errorsCount ?? 0} icon={ShieldAlert} danger={(report?.errorsCount || 0) > 0} />
      </section>

      <section className="rounded-[28px] border border-white/[0.08] bg-white/[0.025] p-4 md:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex gap-2 overflow-x-auto">
            {([
              ['all', 'Todas'], ['errors', 'Erros'], ['warnings', 'Avisos'], ['ok', 'Consistentes'],
            ] as const).map(([key, label]) => <button key={key} onClick={() => setFilter(key)} className={`whitespace-nowrap rounded-xl border px-4 py-2 text-[10px] font-black uppercase tracking-wider ${filter === key ? 'border-yellow-500/50 bg-yellow-500/15 text-yellow-300' : 'border-white/10 bg-black/20 text-neutral-500'}`}>{label}</button>)}
          </div>
          <div className="relative lg:w-[360px]"><Search className="absolute left-4 top-1/2 -translate-y-1/2 text-neutral-600" size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar academia, endereço ou Place ID..." className="w-full rounded-2xl border border-white/10 bg-black/30 py-3 pl-11 pr-4 text-xs text-white outline-none placeholder:text-neutral-600 focus:border-yellow-500/35" /></div>
        </div>

        {error ? <div className="mt-5 rounded-2xl border border-rose-500/20 bg-rose-500/[0.06] p-6 text-center"><XCircle className="mx-auto text-rose-400" size={28} /><p className="mt-3 text-sm text-rose-300">{error}</p><button onClick={() => void load()} className="mt-4 rounded-xl border border-rose-500/30 px-4 py-2 text-xs font-black uppercase text-rose-300">Tentar novamente</button></div> : loading ? <div className="py-16 text-center text-xs font-black uppercase tracking-widest text-neutral-600">Auditando academias...</div> : filtered.length === 0 ? <div className="py-16 text-center text-xs text-neutral-500">Nenhuma academia encontrada.</div> : (
          <div className="mt-5 space-y-3">
            {filtered.map((item) => (
              <article key={item.id} className={`rounded-[24px] border p-5 ${statusClass(item.status)}`}>
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="text-sm font-black text-white">{item.name}</h2><span className={`rounded-lg border px-2 py-1 text-[8px] font-black uppercase ${item.status === 'ERROR' ? 'border-rose-500/30 text-rose-300' : item.status === 'WARNING' ? 'border-amber-500/30 text-amber-300' : 'border-emerald-500/25 text-emerald-300'}`}>{item.status}</span></div><p className="mt-2 break-all text-[10px] text-neutral-500">ID: {item.id} · Place ID: {item.placeId || '—'}</p></div>
                  <div className="flex items-center gap-2 text-xs text-neutral-400"><MapPin size={14} /> {item.distanceMeters === null ? 'Sem comparação externa' : `${item.distanceMeters.toLocaleString('pt-BR')} m de diferença`}</div>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-2"><LocationBlock title="Cadastro Invictus" address={item.registeredAddress} lat={item.latitude} lng={item.longitude} /><LocationBlock title="Google Places" address={item.googleMapsAddress} lat={item.googleMapsLat} lng={item.googleMapsLng} /></div>

                {(item.errors.length > 0 || item.warnings.length > 0) && <div className="mt-4 space-y-2">{item.errors.map((message) => <div key={`e-${message}`} className="flex items-start gap-2 text-xs text-rose-300"><XCircle size={14} className="mt-0.5 shrink-0" /> {message}</div>)}{item.warnings.map((message) => <div key={`w-${message}`} className="flex items-start gap-2 text-xs text-amber-300"><AlertTriangle size={14} className="mt-0.5 shrink-0" /> {message}</div>)}</div>}

                {item.googleMapsLat !== null && item.googleMapsLng !== null && item.status !== 'OK' && <div className="mt-4 border-t border-white/[0.06] pt-4"><button disabled={fixingId === item.id} onClick={() => void fixGym(item)} className="flex items-center gap-2 rounded-xl bg-yellow-500 px-4 py-2 text-[10px] font-black uppercase text-black disabled:opacity-50"><Wrench size={14} /> {fixingId === item.id ? 'Sincronizando...' : 'Sincronizar com Google'}</button></div>}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Metric({ label, value, icon: Icon, attention = false, danger = false }: { label: string; value: number; icon: typeof Building2; attention?: boolean; danger?: boolean }) {
  const frame = danger ? 'border-rose-500/30 bg-rose-500/[0.06]' : attention ? 'border-amber-500/30 bg-amber-500/[0.06]' : 'border-white/[0.08] bg-white/[0.025]';
  const text = danger ? 'text-rose-300' : attention ? 'text-amber-300' : 'text-white';
  return <div className={`rounded-[24px] border p-4 ${frame}`}><div className="flex items-start justify-between"><div><p className="text-[9px] font-black uppercase tracking-[0.16em] text-neutral-500">{label}</p><p className={`mt-2 font-headline text-3xl font-black ${text}`}>{value}</p></div><div className={`grid h-10 w-10 place-items-center rounded-2xl ${danger ? 'bg-rose-500/10 text-rose-300' : attention ? 'bg-amber-500/10 text-amber-300' : 'bg-sky-500/[0.08] text-sky-300'}`}><Icon size={18} /></div></div></div>;
}

function LocationBlock({ title, address, lat, lng }: { title: string; address: string; lat: number | null; lng: number | null }) {
  return <div className="rounded-2xl border border-white/[0.06] bg-black/25 p-4"><p className="text-[8px] font-black uppercase tracking-[0.18em] text-neutral-600">{title}</p><p className="mt-2 text-xs font-bold text-neutral-300">{address || 'Endereço indisponível'}</p><p className="mt-2 text-[10px] text-neutral-600">{lat === null || lng === null ? 'Coordenadas indisponíveis' : `${lat.toFixed(6)}, ${lng.toFixed(6)}`}</p></div>;
}
