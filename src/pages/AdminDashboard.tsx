import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Building2,
  CheckCircle2,
  ChevronRight,
  CreditCard,
  PackageCheck,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShoppingBag,
  Trash2,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  collection,
  getCountFromServer,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import { auth, db } from '../firebase';
import { hasActiveProEntitlement } from '../lib/proEntitlement';
import type { UserProfile } from '../types';

interface OpsMetrics {
  totalUsers: number;
  totalPro: number;
  pendingActivities: number;
  pendingWithdrawals: number;
}

type Feedback = { type: 'success' | 'error'; text: string } | null;
type UserFilter = 'all' | 'pro' | 'free';

const MODULES = [
  {
    title: 'Pendências de atividade',
    description: 'Fila canônica de exceções técnicas que ainda exigem decisão administrativa.',
    path: '/admin/flagged-activities',
    icon: ShieldAlert,
    accent: 'amber',
  },
  {
    title: 'Atividades',
    description: 'Consulta e inspeção do histórico consolidado. Alterações competitivas passam pela fila canônica.',
    path: '/admin/workouts',
    icon: Activity,
    accent: 'gold',
  },
  {
    title: 'Antifraude',
    description: 'Diagnóstico do pipeline de segurança, rastreabilidade e readiness de produção.',
    path: '/admin/security',
    icon: ShieldCheck,
    accent: 'red',
  },
  {
    title: 'Financeiro',
    description: 'Saques PIX, estados do provedor e conciliação operacional.',
    path: '/admin/payouts',
    icon: CreditCard,
    accent: 'green',
  },
  {
    title: 'Academias',
    description: 'Auditoria de cadastro, coordenadas e geofence das unidades parceiras.',
    path: '/admin/gym-audit',
    icon: Building2,
    accent: 'blue',
  },
  {
    title: 'Loja · preços',
    description: 'Catálogo, valores, disponibilidade e regras comerciais da Invictus Store.',
    path: '/admin/store/pricing',
    icon: ShoppingBag,
    accent: 'gold',
  },
  {
    title: 'Loja · drops',
    description: 'Lançamentos e janelas de disponibilidade do catálogo.',
    path: '/admin/store/drops',
    icon: PackageCheck,
    accent: 'purple',
  },
  {
    title: 'Loja · pedidos',
    description: 'Acompanhamento operacional dos pedidos e estados de pagamento/entrega.',
    path: '/admin/store/orders',
    icon: PackageCheck,
    accent: 'green',
  },
] as const;

function moduleAccent(accent: string): string {
  switch (accent) {
    case 'red': return 'border-rose-500/25 bg-rose-500/[0.06] text-rose-300';
    case 'green': return 'border-emerald-500/20 bg-emerald-500/[0.05] text-emerald-300';
    case 'blue': return 'border-sky-500/20 bg-sky-500/[0.05] text-sky-300';
    case 'purple': return 'border-violet-500/20 bg-violet-500/[0.05] text-violet-300';
    case 'amber': return 'border-amber-500/25 bg-amber-500/[0.06] text-amber-300';
    default: return 'border-yellow-500/20 bg-yellow-500/[0.05] text-yellow-200';
  }
}

async function adminRequest<T = any>(action: string, init?: RequestInit): Promise<T> {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('Sessão administrativa expirada.');
  const token = await currentUser.getIdToken();
  const separator = action.includes('?') ? '&' : '?';
  const response = await fetch(`/api/admin?action=${encodeURIComponent(action.split('?')[0])}${action.includes('?') ? `&${action.split('?')[1]}` : ''}`, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  void separator;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.success === false) {
    throw new Error(payload?.error || payload?.message || 'Falha na operação administrativa.');
  }
  return payload as T;
}

function userCreatedAt(user: UserProfile): string {
  const raw = (user as any).createdAt;
  const date = raw?.toDate?.() || (raw ? new Date(raw) : null);
  if (!date || !Number.isFinite(date.getTime())) return 'Cadastro sem data';
  return date.toLocaleDateString('pt-BR');
}

export function AdminDashboard() {
  const navigate = useNavigate();
  const [metrics, setMetrics] = useState<OpsMetrics>({ totalUsers: 0, totalPro: 0, pendingActivities: 0, pendingWithdrawals: 0 });
  const [recentUsers, setRecentUsers] = useState<UserProfile[]>([]);
  const [searchResults, setSearchResults] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<UserFilter>('all');
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [roleUpdatingUid, setRoleUpdatingUid] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<UserProfile | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadOverview = useCallback(async () => {
    setLoading(true);
    try {
      const usersCol = collection(db, 'users');
      const [usersCountResult, proResult, recentResult, flaggedResult, withdrawalsResult] = await Promise.allSettled([
        getCountFromServer(usersCol),
        getDocs(query(usersCol, where('subscriptionTier', 'in', ['performance', 'pro']))),
        getDocs(query(usersCol, orderBy('createdAt', 'desc'), limit(12))),
        adminRequest<any>('list-flagged-activities?limit=100'),
        adminRequest<any>('list-withdrawals'),
      ]);

      const totalUsers = usersCountResult.status === 'fulfilled' ? usersCountResult.value.data().count : 0;
      const totalPro = proResult.status === 'fulfilled'
        ? proResult.value.docs.filter((document) => hasActiveProEntitlement(document.data())).length
        : 0;
      const recent = recentResult.status === 'fulfilled'
        ? recentResult.value.docs.map((document) => ({ uid: document.id, ...document.data() } as UserProfile))
        : [];
      const pendingActivities = flaggedResult.status === 'fulfilled'
        ? Number(flaggedResult.value?.count ?? flaggedResult.value?.activities?.length ?? 0)
        : 0;
      const withdrawals = withdrawalsResult.status === 'fulfilled'
        ? (Array.isArray(withdrawalsResult.value) ? withdrawalsResult.value : withdrawalsResult.value?.withdrawals || [])
        : [];
      const pendingWithdrawals = withdrawals.filter((item: any) => item?.status === 'pending' || item?.status === 'under_review' || item?.status === 'approved' || item?.status === 'processing').length;

      setMetrics({ totalUsers, totalPro, pendingActivities, pendingWithdrawals });
      setRecentUsers(recent);
    } catch (error: any) {
      console.error('[AdminDashboard] overview error', error);
      setFeedback({ type: 'error', text: error?.message || 'Não foi possível carregar o painel.' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadOverview(); }, [loadOverview]);

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      const trimmed = searchQuery.trim();
      if (!trimmed) {
        setSearchResults([]);
        setSearching(false);
        return;
      }

      setSearching(true);
      try {
        const usersCol = collection(db, 'users');
        const normalized = trimmed.toLowerCase();
        const found = new Map<string, UserProfile>();
        const jobs: Promise<any>[] = [];

        if (normalized.includes('@')) {
          jobs.push(getDocs(query(usersCol, where('email', '==', normalized), limit(5))));
        }
        const cpf = trimmed.replace(/\D/g, '');
        if (cpf.length >= 3) {
          jobs.push(getDocs(query(usersCol, where('cpf', '==', cpf), limit(5))));
        }
        jobs.push(getDocs(query(
          usersCol,
          where('displayNameLower', '>=', normalized),
          where('displayNameLower', '<=', `${normalized}\uf8ff`),
          limit(20),
        )));

        const settled = await Promise.allSettled(jobs);
        settled.forEach((result) => {
          if (result.status !== 'fulfilled') return;
          result.value.docs.forEach((document: any) => found.set(document.id, { uid: document.id, ...document.data() } as UserProfile));
        });
        setSearchResults(Array.from(found.values()));
      } catch (error) {
        console.error('[AdminDashboard] user search error', error);
      } finally {
        setSearching(false);
      }
    }, 350);

    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  const visibleUsers = useMemo(() => {
    const source = searchQuery.trim() ? searchResults : recentUsers;
    return source.filter((user) => {
      if (filter === 'all') return true;
      const pro = hasActiveProEntitlement(user);
      return filter === 'pro' ? pro : !pro;
    });
  }, [filter, recentUsers, searchQuery, searchResults]);

  const changeRole = async (user: UserProfile) => {
    const nextRole = user.role === 'admin' ? 'user' : 'admin';
    const verb = nextRole === 'admin' ? 'promover a administrador' : 'remover o acesso administrativo de';
    if (!window.confirm(`Confirma ${verb} ${user.displayName || user.email || user.uid}?`)) return;

    setRoleUpdatingUid(user.uid);
    setFeedback(null);
    try {
      await adminRequest('set-user-role', {
        method: 'POST',
        body: JSON.stringify({ targetUid: user.uid, role: nextRole }),
      });
      const patch = (list: UserProfile[]) => list.map((item) => item.uid === user.uid ? { ...item, role: nextRole } : item);
      setRecentUsers(patch);
      setSearchResults(patch);
      setFeedback({ type: 'success', text: `${user.displayName || 'Usuário'} agora está como ${nextRole === 'admin' ? 'ADMINISTRADOR' : 'USUÁRIO'}.` });
    } catch (error: any) {
      setFeedback({ type: 'error', text: error?.message || 'Não foi possível alterar o papel do usuário.' });
    } finally {
      setRoleUpdatingUid(null);
    }
  };

  const deactivateUser = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setFeedback(null);
    try {
      const result = await adminRequest<any>('delete-user', {
        method: 'POST',
        body: JSON.stringify({ target: deleteTarget.uid }),
      });
      const deletedIds = Array.isArray(result.deletedUids) ? result.deletedUids : [deleteTarget.uid];
      setRecentUsers((list) => list.filter((item) => !deletedIds.includes(item.uid)));
      setSearchResults((list) => list.filter((item) => !deletedIds.includes(item.uid)));
      setFeedback({ type: 'success', text: result.message || 'Conta desativada com sucesso.' });
      setDeleteTarget(null);
    } catch (error: any) {
      setFeedback({ type: 'error', text: error?.message || 'Não foi possível desativar a conta.' });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-7 pb-16">
      <section className="overflow-hidden rounded-[32px] border border-yellow-500/20 bg-gradient-to-br from-yellow-500/[0.08] via-neutral-950 to-neutral-950 p-6 md:p-8">
        <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div className="max-w-2xl">
            <div className="mb-3 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.24em] text-yellow-400">
              <Shield size={16} /> Operação Invictus
            </div>
            <h1 className="font-headline text-3xl font-black uppercase tracking-tight text-white md:text-4xl">Central administrativa</h1>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-neutral-400">
              Um painel focado em operação real: usuários, segurança, atividades, financeiro, academias e loja. Ferramentas de laboratório e geração de usuários artificiais foram removidas do ambiente de produção.
            </p>
          </div>
          <button
            onClick={() => void loadOverview()}
            className="rounded-2xl border border-yellow-500/30 bg-yellow-500/10 px-5 py-3 text-xs font-black uppercase tracking-wider text-yellow-300 transition hover:bg-yellow-500/15"
          >
            Atualizar visão geral
          </button>
        </div>
      </section>

      {feedback && (
        <div className={`flex items-center justify-between gap-4 rounded-2xl border p-4 text-xs font-bold ${feedback.type === 'success' ? 'border-emerald-500/25 bg-emerald-500/[0.07] text-emerald-300' : 'border-rose-500/25 bg-rose-500/[0.07] text-rose-300'}`}>
          <div className="flex items-center gap-3">
            {feedback.type === 'success' ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
            <span>{feedback.text}</span>
          </div>
          <button onClick={() => setFeedback(null)} aria-label="Fechar aviso"><X size={16} /></button>
        </div>
      )}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Usuários" value={loading ? '—' : metrics.totalUsers.toLocaleString('pt-BR')} icon={Users} />
        <Metric label="PRO ativos" value={loading ? '—' : metrics.totalPro.toLocaleString('pt-BR')} icon={UserCheck} />
        <Metric label="Pendências técnicas" value={loading ? '—' : metrics.pendingActivities.toLocaleString('pt-BR')} icon={ShieldAlert} attention={metrics.pendingActivities > 0} />
        <Metric label="Saques em fluxo" value={loading ? '—' : metrics.pendingWithdrawals.toLocaleString('pt-BR')} icon={CreditCard} attention={metrics.pendingWithdrawals > 0} />
      </section>

      <section>
        <div className="mb-4">
          <p className="text-[10px] font-black uppercase tracking-[0.24em] text-yellow-400">Operação</p>
          <h2 className="mt-1 font-headline text-2xl font-black uppercase text-white">Áreas administrativas</h2>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {MODULES.map((module) => {
            const Icon = module.icon;
            return (
              <button
                key={module.path}
                onClick={() => navigate(module.path)}
                className={`group min-h-[166px] rounded-[26px] border p-5 text-left transition hover:-translate-y-0.5 ${moduleAccent(module.accent)}`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="grid h-11 w-11 place-items-center rounded-2xl border border-current/20 bg-black/20"><Icon size={21} /></div>
                  <ChevronRight className="opacity-45 transition group-hover:translate-x-1 group-hover:opacity-100" size={19} />
                </div>
                <h3 className="mt-5 text-sm font-black uppercase tracking-wide text-white">{module.title}</h3>
                <p className="mt-2 text-xs leading-relaxed text-neutral-400">{module.description}</p>
              </button>
            );
          })}
        </div>
      </section>

      <section className="rounded-[30px] border border-white/[0.08] bg-white/[0.025] p-5 md:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-yellow-400">Acesso e contas</p>
            <h2 className="mt-1 font-headline text-2xl font-black uppercase text-white">Gerenciar usuários</h2>
            <p className="mt-2 max-w-xl text-xs text-neutral-500">Busque por nome, e-mail ou CPF. Promoções de administrador e desativações passam pelo backend autenticado e entram na trilha de auditoria.</p>
          </div>
          <div className="flex gap-2">
            {(['all', 'pro', 'free'] as const).map((key) => (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={`rounded-xl border px-3 py-2 text-[10px] font-black uppercase tracking-wider ${filter === key ? 'border-yellow-500/60 bg-yellow-500/15 text-yellow-300' : 'border-white/10 bg-black/20 text-neutral-500'}`}
              >
                {key === 'all' ? 'Todos' : key === 'pro' ? 'PRO' : 'Open'}
              </button>
            ))}
          </div>
        </div>

        <div className="relative mt-5">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-neutral-600" size={18} />
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Buscar usuário por nome, e-mail ou CPF..."
            className="h-13 w-full rounded-2xl border border-white/10 bg-black/30 py-4 pl-12 pr-4 text-sm text-white outline-none transition placeholder:text-neutral-600 focus:border-yellow-500/40"
          />
        </div>

        <div className="mt-4 space-y-2">
          {searching && <div className="rounded-2xl border border-white/5 bg-black/20 p-4 text-center text-[10px] font-black uppercase tracking-widest text-yellow-400">Buscando...</div>}
          {!searching && visibleUsers.length === 0 && <div className="rounded-2xl border border-white/5 bg-black/20 p-8 text-center text-xs text-neutral-500">Nenhum usuário encontrado.</div>}
          {!searching && visibleUsers.map((user) => (
            <div key={user.uid} className="flex flex-col gap-4 rounded-2xl border border-white/[0.07] bg-black/25 p-4 md:flex-row md:items-center md:justify-between">
              <button onClick={() => navigate(`/profile/${user.uid}`)} className="flex min-w-0 items-center gap-3 text-left">
                <div className="h-11 w-11 shrink-0 overflow-hidden rounded-2xl border border-white/10 bg-neutral-900">
                  {user.photoURL ? <img src={user.photoURL} alt="" className="h-full w-full object-cover" /> : <div className="grid h-full w-full place-items-center text-yellow-400"><Users size={18} /></div>}
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-black text-white">{user.displayName || 'Usuário sem nome'}</span>
                    {user.role === 'admin' && <span className="rounded-md border border-yellow-500/30 bg-yellow-500/10 px-2 py-0.5 text-[8px] font-black uppercase tracking-wider text-yellow-300">Admin</span>}
                    {hasActiveProEntitlement(user) && <span className="rounded-md border border-violet-500/25 bg-violet-500/10 px-2 py-0.5 text-[8px] font-black uppercase tracking-wider text-violet-300">PRO</span>}
                  </div>
                  <p className="mt-1 truncate text-[10px] text-neutral-500">{user.email || user.uid} · {userCreatedAt(user)}</p>
                </div>
              </button>

              <div className="flex items-center gap-2 self-end md:self-auto">
                <button
                  disabled={roleUpdatingUid === user.uid}
                  onClick={() => void changeRole(user)}
                  className="rounded-xl border border-white/10 bg-white/[0.035] px-3 py-2 text-[9px] font-black uppercase tracking-wider text-neutral-300 transition hover:border-yellow-500/30 hover:text-yellow-300 disabled:opacity-40"
                >
                  {roleUpdatingUid === user.uid ? 'Salvando...' : user.role === 'admin' ? 'Remover admin' : 'Tornar admin'}
                </button>
                <button
                  onClick={() => setDeleteTarget(user)}
                  className="grid h-9 w-9 place-items-center rounded-xl border border-rose-500/20 bg-rose-500/[0.06] text-rose-400 transition hover:bg-rose-500/10"
                  aria-label={`Desativar ${user.displayName || 'usuário'}`}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {deleteTarget && (
        <div className="fixed inset-0 z-[140] grid place-items-center bg-black/80 p-4 backdrop-blur-md">
          <div className="w-full max-w-md rounded-[30px] border border-rose-500/25 bg-[#0b0b0c] p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div className="grid h-12 w-12 place-items-center rounded-2xl border border-rose-500/25 bg-rose-500/10 text-rose-400"><Trash2 size={21} /></div>
              <button disabled={deleting} onClick={() => setDeleteTarget(null)} className="grid h-9 w-9 place-items-center rounded-xl border border-white/10 text-neutral-500"><X size={16} /></button>
            </div>
            <h3 className="mt-5 font-headline text-xl font-black uppercase text-white">Desativar conta</h3>
            <p className="mt-2 text-sm leading-relaxed text-neutral-400">O acesso de <strong className="text-white">{deleteTarget.displayName || deleteTarget.email || deleteTarget.uid}</strong> será bloqueado, sessões serão revogadas e o tombstone de auditoria será preservado.</p>
            <div className="mt-6 flex gap-3">
              <button disabled={deleting} onClick={() => setDeleteTarget(null)} className="flex-1 rounded-2xl border border-white/10 px-4 py-3 text-xs font-black uppercase text-neutral-300">Cancelar</button>
              <button disabled={deleting} onClick={() => void deactivateUser()} className="flex-1 rounded-2xl bg-rose-500 px-4 py-3 text-xs font-black uppercase text-white disabled:opacity-50">{deleting ? 'Desativando...' : 'Desativar'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, icon: Icon, attention = false }: { label: string; value: string; icon: typeof Users; attention?: boolean }) {
  return (
    <div className={`rounded-[24px] border p-4 md:p-5 ${attention ? 'border-amber-500/30 bg-amber-500/[0.06]' : 'border-white/[0.08] bg-white/[0.025]'}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[9px] font-black uppercase tracking-[0.18em] text-neutral-500">{label}</p>
          <p className={`mt-2 font-headline text-3xl font-black ${attention ? 'text-amber-300' : 'text-white'}`}>{value}</p>
        </div>
        <div className={`grid h-10 w-10 place-items-center rounded-2xl ${attention ? 'bg-amber-500/10 text-amber-300' : 'bg-yellow-500/[0.08] text-yellow-400'}`}><Icon size={19} /></div>
      </div>
    </div>
  );
}
