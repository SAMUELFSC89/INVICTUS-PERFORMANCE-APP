import React, { useState, useEffect, useCallback } from 'react';
import { DollarSign, ShieldAlert, ArrowRight, Copy, CheckCircle, XCircle, Clock, AlertTriangle, RefreshCw, Filter } from 'lucide-react';
import { auth } from '../firebase';
import { useNavigate } from 'react-router-dom';
import { cn } from '../lib/utils';
import { PIXWithdrawal, WithdrawalStatus } from '../types';

type FilterTab = 'pending_review' | WithdrawalStatus | 'all';

const STATUS_LABELS: Record<WithdrawalStatus, { label: string; color: string }> = {
  pending: { label: 'Pendente', color: 'bg-purple-500/20 text-purple-400 border-purple-500/30' },
  under_review: { label: 'Em Análise Antifraude', color: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
  approved: { label: 'Aprovado (Na Fila)', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
  paid: { label: 'Pago via PIX', color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
  cancelled: { label: 'Cancelado', color: 'bg-gray-500/20 text-gray-400 border-gray-500/30' },
  rejected: { label: 'Recusado', color: 'bg-rose-500/20 text-rose-400 border-rose-500/30' }
};

export function AdminPayouts() {
  const navigate = useNavigate();
  const [withdrawals, setWithdrawals] = useState<PIXWithdrawal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterTab>('pending_review');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [creditingTest, setCreditingTest] = useState(false);
  const [updatingMin, setUpdatingMin] = useState(false);

  const fetchWithdrawals = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error('Sessão de administrador expirada. Faça login novamente.');
      const idToken = await currentUser.getIdToken();

      const statusParam = filter === 'all' || filter === 'pending_review' ? '' : `&status=${filter}`;
      const res = await fetch(`/api/admin?action=list-withdrawals${statusParam}`, {
        headers: { 'Authorization': `Bearer ${idToken}` }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao carregar saques.');

      let list: PIXWithdrawal[] = Array.isArray(data) ? data : (data.withdrawals || []);
      if (filter === 'pending_review') {
        list = list.filter(w => w.status === 'pending' || w.status === 'under_review');
      }
      list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setWithdrawals(list);
    } catch (err: any) {
      console.error('[AdminPayouts] Error fetching withdrawals:', err);
      setError(err.message || 'Falha ao carregar solicitações de saque.');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    fetchWithdrawals();
  }, [fetchWithdrawals]);

  const handleUpdateStatus = async (withdrawal: PIXWithdrawal, status: WithdrawalStatus) => {
    const actionLabel = status === 'paid' ? 'marcar como PAGO' : status === 'rejected' ? 'REJEITAR' : `mudar para ${status}`;
    const confirmMsg = status === 'paid'
      ? `Confirma que o PIX de R$ ${withdrawal.amount.toFixed(2)} para ${withdrawal.userDisplayName} (chave ${withdrawal.pixKey}) já foi transferido manualmente? Esta ação libera definitivamente o saldo retido.`
      : `Confirma ${actionLabel} a solicitação de R$ ${withdrawal.amount.toFixed(2)} de ${withdrawal.userDisplayName}? O saldo retido será estornado para a carteira do atleta.`;

    if (!window.confirm(confirmMsg)) return;

    let reason: string | undefined;
    if (status === 'rejected') {
      reason = window.prompt('Motivo da rejeição (opcional, será salvo para auditoria):') || undefined;
    }

    setActionLoadingId(withdrawal.id);
    setFeedback(null);
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error('Sessão de administrador expirada.');
      const idToken = await currentUser.getIdToken();

      const res = await fetch('/api/admin?action=update-withdrawal-status', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({ withdrawalId: withdrawal.id, status, reason })
      });
      const data = await res.json();
      if (!res.ok || data.success === false) throw new Error(data.error || 'Falha ao atualizar o saque.');

      setFeedback({ type: 'success', text: data.message || `Saque ${withdrawal.id} atualizado com sucesso.` });
      await fetchWithdrawals();
    } catch (err: any) {
      console.error('[AdminPayouts] Error updating withdrawal:', err);
      setFeedback({ type: 'error', text: err.message || 'Erro ao atualizar solicitação de saque.' });
    } finally {
      setActionLoadingId(null);
      setTimeout(() => setFeedback(null), 6000);
    }
  };

  const handleProcessPayment = async (withdrawal: PIXWithdrawal) => {
    const confirmMsg = `Confirma o envio AUTOMÁTICO do PIX de R$ ${withdrawal.amount.toFixed(2)} para ${withdrawal.userDisplayName} (chave ${withdrawal.pixKey})? O valor será transferido de verdade agora mesmo via Asaas e o saldo retido será liberado definitivamente.`;

    if (!window.confirm(confirmMsg)) return;

    setActionLoadingId(withdrawal.id);
    setFeedback(null);
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error('Sessão de administrador expirada.');
      const idToken = await currentUser.getIdToken();

      const res = await fetch('/api/admin?action=process-withdrawal-payment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({ withdrawalId: withdrawal.id })
      });
      const data = await res.json();
      if (!res.ok || data.success === false) throw new Error(data.error || 'Falha ao processar o pagamento PIX.');

      setFeedback({ type: 'success', text: data.message || `PIX de R$ ${withdrawal.amount.toFixed(2)} enviado com sucesso via Asaas.` });
      await fetchWithdrawals();
    } catch (err: any) {
      console.error('[AdminPayouts] Error processing payment:', err);
      setFeedback({ type: 'error', text: err.message || 'Erro ao processar pagamento PIX via Asaas.' });
    } finally {
      setActionLoadingId(null);
      setTimeout(() => setFeedback(null), 6000);
    }
  };

    
  const handleCreditTestBalance = async () => {
    if (!window.confirm('Creditar R$ 1,00 de saldo de TESTE (ledger interno, sem dinheiro real) na sua propria carteira para validar o saque automatizado via Asaas?')) return;
    setCreditingTest(true);
    setFeedback(null);
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error('Sessao de administrador expirada.');
      const idToken = await currentUser.getIdToken();

      const res = await fetch('/api/admin?action=credit-test-balance', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({ userId: currentUser.uid, amount: 1, description: 'Credito de teste - validacao fluxo Asaas' })
      });
      const data = await res.json();
      if (!res.ok || data.success === false) throw new Error(data.error || 'Falha ao creditar saldo de teste.');

      setFeedback({ type: 'success', text: data.message || 'Saldo de teste creditado.' });
    } catch (err: any) {
      console.error('[AdminPayouts] Error crediting test balance:', err);
      setFeedback({ type: 'error', text: err.message || 'Erro ao creditar saldo de teste.' });
    } finally {
      setCreditingTest(false);
      setTimeout(() => setFeedback(null), 6000);
    }
  };

  
  const handleSetWithdrawalMin = async (amount: number) => {
    if (!window.confirm('Alterar o saque minimo para R$ ' + amount.toFixed(2) + '?')) return;
    setUpdatingMin(true);
    setFeedback(null);
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error('Sessao de administrador expirada.');
      const idToken = await currentUser.getIdToken();
      const res = await fetch('/api/admin?action=update-withdrawal-min-amount', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
        body: JSON.stringify({ minWithdrawalAmount: amount })
      });
      const data = await res.json();
      if (!res.ok || data.success === false) throw new Error(data.error || 'Falha ao atualizar saque minimo.');
      setFeedback({ type: 'success', text: data.message || 'Saque minimo atualizado.' });
    } catch (err: any) {
      console.error('[AdminPayouts] Error updating withdrawal min:', err);
      setFeedback({ type: 'error', text: err.message || 'Erro ao atualizar saque minimo.' });
    } finally {
      setUpdatingMin(false);
      setTimeout(() => setFeedback(null), 6000);
    }
  };

const tabs: { key: FilterTab; label: string }[] = [
    { key: 'pending_review', label: 'Pendentes' },
    { key: 'approved', label: 'Aprovados' },
    { key: 'paid', label: 'Pagos' },
    { key: 'rejected', label: 'Recusados/Cancelados' },
    { key: 'all', label: 'Todos' }
  ];

  return (
    <div className="min-h-screen bg-background pb-32">
      <header className="px-6 py-12 space-y-4">
        <button
          onClick={() => navigate('/admin')}
          className="flex items-center gap-2 text-on-surface-variant hover:text-primary transition-colors font-label text-[10px] font-black uppercase tracking-widest mb-4"
        >
          <ArrowRight className="rotate-180" size={14} /> VOLTAR AO PAINEL
        </button>
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <DollarSign className="text-prize-gold" size={32} />
            <h1 className="font-headline italic font-black text-4xl uppercase tracking-tighter text-on-surface">SAQUES PIX</h1>
          </div>
          <button
            onClick={() => fetchWithdrawals()}
            className="bg-primary/10 text-primary px-4 py-2 rounded-xl font-label text-[10px] font-black uppercase tracking-widest flex items-center gap-2 hover:bg-primary/20 transition-all"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> ATUALIZAR
          </button>
          <button
            onClick={handleCreditTestBalance}
            disabled={creditingTest}
            className="bg-amber-500/10 text-amber-400 border border-amber-500/20 px-4 py-2 rounded-xl font-label text-[10px] font-black uppercase tracking-widest flex items-center gap-2 hover:bg-amber-500/20 transition-all disabled:opacity-50"
          >
            <DollarSign size={14} /> CREDITAR R$1 TESTE
          </button>
      <button
        onClick={() => handleSetWithdrawalMin(1)}
        disabled={updatingMin}
        className="bg-sky-500/10 text-sky-400 border border-sky-500/20 px-4 py-2 rounded-xl font-label text-[10px] font-black uppercase tracking-widest flex items-center gap-2 hover:bg-sky-500/20 transition-all disabled:opacity-50"
      >
        MIN R$1 (TESTE)
      </button>
      <button
        onClick={() => handleSetWithdrawalMin(20)}
        disabled={updatingMin}
        className="bg-slate-500/10 text-slate-400 border border-slate-500/20 px-4 py-2 rounded-xl font-label text-[10px] font-black uppercase tracking-widest flex items-center gap-2 hover:bg-slate-500/20 transition-all disabled:opacity-50"
      >
        MIN R$20 (PADRAO)
      </button>
        </div>
        <p className="text-on-surface-variant font-label text-xs uppercase tracking-widest text-shadow-sm">
          Libere ou recuse solicitações reais de saque via PIX. O dinheiro é retido (bloqueado) na carteira do atleta até você marcar como pago.
        </p>
      </header>

      <div className="px-6 space-y-6">
        {feedback && (
          <div className={cn(
            'p-4 rounded-2xl text-xs font-bold uppercase tracking-wider flex items-center gap-3 border',
            feedback.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-red-500/10 border-red-500/30 text-red-400'
          )}>
            {feedback.type === 'success' ? <CheckCircle size={16} /> : <AlertTriangle size={16} />}
            {feedback.text}
          </div>
        )}

        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
          <Filter size={16} className="text-on-surface-variant shrink-0" />
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => setFilter(t.key)}
              className={cn(
                'px-4 py-2 rounded-xl font-label text-[10px] font-black uppercase tracking-widest whitespace-nowrap transition-all',
                filter === t.key ? 'bg-prize-gold text-white' : 'bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest'
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="space-y-4">
          {loading ? (
            <div className="flex justify-center py-20">
              <div className="w-8 h-8 border-4 border-prize-gold border-t-transparent rounded-full animate-spin" />
            </div>
          ) : error ? (
            <div className="text-center py-16 space-y-3">
              <AlertTriangle className="mx-auto text-red-400" size={32} />
              <p className="font-label text-xs text-red-400 uppercase tracking-widest">{error}</p>
            </div>
          ) : withdrawals.length === 0 ? (
            <div className="text-center py-20 space-y-4">
              <div className="w-16 h-16 bg-surface-container-high rounded-full flex items-center justify-center mx-auto opacity-20">
                <DollarSign size={32} />
              </div>
              <p className="font-label text-xs text-on-surface-variant uppercase tracking-widest">Nenhuma solicitação de saque encontrada nesse filtro</p>
            </div>
          ) : (
            withdrawals.map(w => {
              const statusInfo = STATUS_LABELS[w.status] || { label: w.status, color: 'bg-surface-container-highest text-on-surface-variant' };
              const canAct = w.status === 'pending' || w.status === 'under_review' || w.status === 'approved';
              const isActing = actionLoadingId === w.id;
              return (
                <div key={w.id} className="bg-surface-container-low p-6 rounded-3xl border border-outline-variant/10 space-y-4">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div>
                      <h3 className="font-headline italic font-black text-xl uppercase leading-tight">{w.userDisplayName}</h3>
                      <p className="font-label text-[9px] text-on-surface-variant uppercase tracking-widest">{w.userEmail}</p>
                      <span className={cn('inline-flex items-center gap-1 mt-2 text-[10px] font-black uppercase px-2.5 py-1 rounded-full border', statusInfo.color)}>
                        {statusInfo.label}
                      </span>
                    </div>
                    <div className="text-right">
                      <p className="font-label text-[9px] text-prize-gold uppercase tracking-widest font-black">VALOR DO SAQUE</p>
                      <p className="font-headline italic font-black text-2xl text-prize-gold">R$ {w.amount.toFixed(2)}</p>
                      <p className="font-label text-[8px] text-on-surface-variant uppercase mt-1">{new Date(w.createdAt).toLocaleString('pt-BR')}</p>
                    </div>
                  </div>

                  <div className="pt-4 border-t border-outline-variant/10 flex items-center justify-between flex-wrap gap-4">
                    <div className="flex flex-col min-w-[160px]">
                      <span className="font-label text-[8px] text-prize-gold uppercase tracking-widest font-black">CHAVE PIX ({w.pixKeyType.toUpperCase()})</span>
                      <div className="flex items-center gap-2">
                        <span className="font-label font-bold text-xs uppercase truncate max-w-[220px]">{w.pixKey}</span>
                        <button
                          onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(w.pixKey); alert('Chave Pix copiada!'); }}
                          className="p-1 hover:text-prize-gold transition-colors"
                        >
                          <Copy size={12} />
                        </button>
                      </div>
                    </div>

                    <div className="flex flex-col">
                      <span className="font-label text-[8px] text-on-surface-variant uppercase tracking-widest">SCORE ANTIFRAUDE</span>
                      <span className={cn('font-label font-bold text-xs uppercase', w.antiFraudScore < 80 ? 'text-amber-400' : 'text-emerald-400')}>
                        {w.antiFraudScore}/100 {w.antiFraudFlags?.length ? `(${w.antiFraudFlags.join(', ')})` : ''}
                      </span>
                    </div>

                    {canAct && (
                      <div className="flex gap-2">
                        <button
                          disabled={isActing}
                          onClick={() => handleUpdateStatus(w, 'rejected')}
                          className="bg-red-500/10 text-red-400 border border-red-500/20 px-4 py-2 rounded-xl font-label text-[10px] font-black uppercase tracking-widest flex items-center gap-2 hover:bg-red-500/20 transition-all disabled:opacity-50"
                        >
                          <XCircle size={14} /> RECUSAR
                        </button>
                        <button
                          disabled={isActing}
                          onClick={() => handleProcessPayment(w)}
                          className="bg-prize-gold text-white px-4 py-2 rounded-xl font-label text-[10px] font-black uppercase tracking-widest flex items-center gap-2 hover:scale-105 transition-transform disabled:opacity-50"
                        >
                          {isActing ? <RefreshCw size={14} className="animate-spin" /> : <CheckCircle size={14} />} MARCAR PAGO
                        </button>
                      </div>
                    )}
                  </div>

                  {w.adminNote && (
                    <p className="text-[10px] text-on-surface-variant italic">Observação do admin: {w.adminNote}</p>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
