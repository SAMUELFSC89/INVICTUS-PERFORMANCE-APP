import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  CreditCard,
  RefreshCw,
  Send,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { auth } from '../firebase';
import type { PIXWithdrawal, WithdrawalStatus } from '../types';

type FinanceFilter = 'attention' | 'approved' | 'processing' | 'paid' | 'closed' | 'all';
type Feedback = { type: 'success' | 'error'; text: string } | null;

const STATUS_META: Record<WithdrawalStatus, { label: string; className: string }> = {
  pending: { label: 'Pendente', className: 'border-amber-500/25 bg-amber-500/10 text-amber-300' },
  under_review: { label: 'Em análise', className: 'border-amber-500/25 bg-amber-500/10 text-amber-300' },
  approved: { label: 'Aprovado para envio', className: 'border-sky-500/25 bg-sky-500/10 text-sky-300' },
  processing: { label: 'Processando no Asaas', className: 'border-cyan-500/25 bg-cyan-500/10 text-cyan-300' },
  paid: { label: 'Pago', className: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300' },
  cancelled: { label: 'Cancelado', className: 'border-white/10 bg-white/[0.04] text-neutral-400' },
  rejected: { label: 'Recusado', className: 'border-rose-500/25 bg-rose-500/10 text-rose-300' },
};

async function requestAdmin(action: string, body?: Record<string, unknown>) {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('Sessão administrativa expirada.');
  const token = await currentUser.getIdToken();
  const response = await fetch(`/api/admin?action=${encodeURIComponent(action)}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.success === false) throw new Error(payload?.error || payload?.message || 'Falha na operação financeira.');
  return payload;
}

function money(value: number): string {
  return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function when(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString('pt-BR') : 'Data indisponível';
}

export function AdminPayouts() {
  const [withdrawals, setWithdrawals] = useState<PIXWithdrawal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FinanceFilter>('attention');
  const [actingId, setActingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await requestAdmin('list-withdrawals');
      const list: PIXWithdrawal[] = Array.isArray(payload) ? payload : payload?.withdrawals || [];
      list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setWithdrawals(list);
    } catch (err: any) {
      setError(err?.message || 'Não foi possível carregar os saques.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => withdrawals.filter((item) => {
    if (filter === 'all') return true;
    if (filter === 'attention') return item.status === 'pending' || item.status === 'under_review';
    if (filter === 'closed') return item.status === 'rejected' || item.status === 'cancelled';
    return item.status === filter;
  }), [filter, withdrawals]);

  const totals = useMemo(() => ({
    attention: withdrawals.filter((item) => item.status === 'pending' || item.status === 'under_review').length,
    approved: withdrawals.filter((item) => item.status === 'approved').length,
    processing: withdrawals.filter((item) => item.status === 'processing').length,
    paidAmount: withdrawals.filter((item) => item.status === 'paid').reduce((sum, item) => sum + Number(item.amount || 0), 0),
  }), [withdrawals]);

  const updateStatus = async (item: PIXWithdrawal, status: 'approved' | 'rejected' | 'cancelled') => {
    const actionText = status === 'approved' ? 'aprovar para pagamento' : status === 'rejected' ? 'recusar' : 'cancelar';
    if (!window.confirm(`Confirma ${actionText} o saque de ${money(item.amount)} de ${item.userDisplayName || item.userId}?`)) return;
    const reason = status === 'rejected' ? window.prompt('Motivo da recusa (opcional):') || undefined : undefined;

    setActingId(item.id);
    setFeedback(null);
    try {
      const result = await requestAdmin('update-withdrawal-status', { withdrawalId: item.id, status, reason });
      setFeedback({ type: 'success', text: result.message || 'Saque atualizado.' });
      await load();
    } catch (err: any) {
      setFeedback({ type: 'error', text: err?.message || 'Falha ao atualizar o saque.' });
    } finally {
      setActingId(null);
    }
  };

  const sendPix = async (item: PIXWithdrawal) => {
    if (!window.confirm(`Enviar agora ${money(item.amount)} por PIX via Asaas para ${item.userDisplayName || item.userId}? Esta é uma transferência real.`)) return;
    setActingId(item.id);
    setFeedback(null);
    try {
      const result = await requestAdmin('process-withdrawal-payment', { withdrawalId: item.id });
      setFeedback({ type: 'success', text: result.message || 'PIX enviado ao provedor.' });
      await load();
    } catch (err: any) {
      setFeedback({ type: 'error', text: err?.message || 'Falha ao enviar o PIX.' });
    } finally {
      setActingId(null);
    }
  };

  const reconcileProvider = async (item: PIXWithdrawal) => {
    if (!window.confirm('Consultar o Asaas para saber se a tentativa anterior criou uma transferência? Se nada existir, o saque voltará para Aprovado.')) return;
    setActingId(item.id);
    setFeedback(null);
    try {
      const result = await requestAdmin('reconcile-withdrawal-provider', { withdrawalId: item.id });
      setFeedback({ type: 'success', text: result.message || 'Conciliação concluída.' });
      await load();
    } catch (err: any) {
      setFeedback({ type: 'error', text: err?.message || 'Falha ao conciliar o saque com o Asaas.' });
    } finally {
      setActingId(null);
    }
  };

  const tabs: { key: FinanceFilter; label: string }[] = [
    { key: 'attention', label: 'Requer atenção' },
    { key: 'approved', label: 'Aprovados' },
    { key: 'processing', label: 'Processando' },
    { key: 'paid', label: 'Pagos' },
    { key: 'closed', label: 'Encerrados' },
    { key: 'all', label: 'Todos' },
  ];

  return (
    <div className="space-y-7 pb-16">
      <section className="rounded-[30px] border border-emerald-500/15 bg-gradient-to-br from-emerald-500/[0.06] via-neutral-950 to-neutral-950 p-6 md:p-8">
        <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="mb-3 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.24em] text-emerald-300"><CreditCard size={16} /> Financeiro</div>
            <h1 className="font-headline text-3xl font-black uppercase text-white">Saques PIX</h1>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-neutral-400">Aprovação administrativa e envio real via Asaas. Estado <strong className="text-white">Pago</strong> continua sendo confirmado pelo fluxo do provedor; não existe mais botão de saldo artificial ou modo de teste nesta tela.</p>
          </div>
          <button onClick={() => void load()} disabled={loading} className="flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-3 text-xs font-black uppercase text-neutral-300 disabled:opacity-50">
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Atualizar
          </button>
        </div>
      </section>

      {feedback && <div className={`rounded-2xl border p-4 text-xs font-bold ${feedback.type === 'success' ? 'border-emerald-500/25 bg-emerald-500/[0.07] text-emerald-300' : 'border-rose-500/25 bg-rose-500/[0.07] text-rose-300'}`}>{feedback.text}</div>}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <FinanceMetric label="Requer atenção" value={String(totals.attention)} icon={AlertTriangle} attention={totals.attention > 0} />
        <FinanceMetric label="Aprovados" value={String(totals.approved)} icon={ShieldCheck} />
        <FinanceMetric label="Processando" value={String(totals.processing)} icon={Clock3} />
        <FinanceMetric label="Total pago listado" value={money(totals.paidAmount)} icon={CheckCircle2} />
      </section>

      <section className="rounded-[28px] border border-white/[0.08] bg-white/[0.025] p-4 md:p-5">
        <div className="flex gap-2 overflow-x-auto pb-1">
          {tabs.map((tab) => <button key={tab.key} onClick={() => setFilter(tab.key)} className={`whitespace-nowrap rounded-xl border px-4 py-2 text-[10px] font-black uppercase tracking-wider ${filter === tab.key ? 'border-yellow-500/50 bg-yellow-500/15 text-yellow-300' : 'border-white/10 bg-black/20 text-neutral-500'}`}>{tab.label}</button>)}
        </div>

        {error ? (
          <div className="mt-5 rounded-2xl border border-rose-500/20 bg-rose-500/[0.06] p-6 text-center">
            <AlertTriangle className="mx-auto text-rose-400" size={28} />
            <p className="mt-3 text-sm text-rose-300">{error}</p>
            <button onClick={() => void load()} className="mt-4 rounded-xl border border-rose-500/30 px-4 py-2 text-xs font-black uppercase text-rose-300">Tentar novamente</button>
          </div>
        ) : loading ? (
          <div className="py-16 text-center text-xs font-black uppercase tracking-widest text-neutral-600">Carregando financeiro...</div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center text-xs text-neutral-500">Nenhum saque nesta categoria.</div>
        ) : (
          <div className="mt-5 space-y-3">
            {filtered.map((item) => {
              const meta = STATUS_META[item.status];
              const busy = actingId === item.id;
              return (
                <article key={item.id} className="rounded-[24px] border border-white/[0.07] bg-black/25 p-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-sm font-black text-white">{item.userDisplayName || item.userId}</h2>
                        <span className={`rounded-lg border px-2 py-1 text-[9px] font-black uppercase tracking-wider ${meta.className}`}>{meta.label}</span>
                      </div>
                      <p className="mt-2 break-all text-[10px] text-neutral-500">ID: {item.id} · Usuário: {item.userId}</p>
                      <p className="mt-1 text-[10px] text-neutral-500">Solicitado em {when(item.createdAt)}</p>
                    </div>
                    <div className="lg:text-right">
                      <p className="font-headline text-2xl font-black text-white">{money(item.amount)}</p>
                      <p className="mt-1 break-all text-[10px] text-neutral-500">PIX: {item.pixKey || 'chave indisponível'}</p>
                    </div>
                  </div>

                  {(item.status === 'pending' || item.status === 'under_review') && (
                    <div className="mt-5 flex flex-wrap gap-2 border-t border-white/[0.06] pt-4">
                      <button disabled={busy} onClick={() => void updateStatus(item, 'approved')} className="flex items-center gap-2 rounded-xl bg-yellow-500 px-4 py-2 text-[10px] font-black uppercase text-black disabled:opacity-50"><ShieldCheck size={14} /> Aprovar</button>
                      <button disabled={busy} onClick={() => void updateStatus(item, 'rejected')} className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/[0.06] px-4 py-2 text-[10px] font-black uppercase text-rose-300 disabled:opacity-50"><XCircle size={14} /> Recusar</button>
                    </div>
                  )}

                  {item.status === 'approved' && (
                    <div className="mt-5 flex flex-wrap gap-2 border-t border-white/[0.06] pt-4">
                      <button disabled={busy} onClick={() => void sendPix(item)} className="flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2 text-[10px] font-black uppercase text-black disabled:opacity-50"><Send size={14} /> {busy ? 'Enviando...' : 'Enviar PIX via Asaas'}</button>
                      <button disabled={busy} onClick={() => void updateStatus(item, 'cancelled')} className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/[0.06] px-4 py-2 text-[10px] font-black uppercase text-rose-300 disabled:opacity-50"><XCircle size={14} /> Cancelar e estornar</button>
                    </div>
                  )}

                  {item.status === 'processing' && item.reconciliationRequired && !item.providerTransferId && (
                    <div className="mt-5 border-t border-white/[0.06] pt-4">
                      <p className="mb-3 text-[10px] leading-relaxed text-amber-300">A tentativa anterior ficou sem ID de transferência. Consulte o Asaas antes de tentar novamente para evitar PIX duplicado.</p>
                      <button disabled={busy} onClick={() => void reconcileProvider(item)} className="flex items-center gap-2 rounded-xl bg-amber-400 px-4 py-2 text-[10px] font-black uppercase text-black disabled:opacity-50"><RefreshCw size={14} /> {busy ? 'Conciliando...' : 'Conciliar com Asaas'}</button>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function FinanceMetric({ label, value, icon: Icon, attention = false }: { label: string; value: string; icon: typeof CreditCard; attention?: boolean }) {
  return <div className={`rounded-[24px] border p-4 ${attention ? 'border-amber-500/30 bg-amber-500/[0.06]' : 'border-white/[0.08] bg-white/[0.025]'}`}><div className="flex items-start justify-between gap-3"><div><p className="text-[9px] font-black uppercase tracking-[0.18em] text-neutral-500">{label}</p><p className={`mt-2 font-headline text-2xl font-black ${attention ? 'text-amber-300' : 'text-white'}`}>{value}</p></div><div className={`grid h-10 w-10 place-items-center rounded-2xl ${attention ? 'bg-amber-500/10 text-amber-300' : 'bg-emerald-500/[0.08] text-emerald-300'}`}><Icon size={18} /></div></div></div>;
}
