import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Wallet as WalletIcon, 
  ArrowUpRight, 
  ArrowDownLeft, 
  Clock, 
  CheckCircle2, 
  AlertTriangle, 
  History, 
  ShieldCheck, 
  ShoppingBag, 
  Trophy, 
  Target, 
  RefreshCw,
  Sparkles,
  Lock,
  DollarSign
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { auth } from '../firebase';
import { useUser } from '../UserContext';
import { UserWallet, IVCoinTransaction, PIXWithdrawal, WithdrawalConfig } from '../types';
import { cn } from '../lib/utils';

export function Wallet() {
  const navigate = useNavigate();
  const { user } = useUser();

  const [wallet, setWallet] = useState<UserWallet | null>(null);
  const [config, setConfig] = useState<WithdrawalConfig | null>(null);
  const [transactions, setTransactions] = useState<IVCoinTransaction[]>([]);
  const [withdrawals, setWithdrawals] = useState<PIXWithdrawal[]>([]);
  
  const [loading, setLoading] = useState(true);
  const [isRedeeming, setIsRedeeming] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [pixKey, setPixKey] = useState('');
  const [pixType, setPixType] = useState<'cpf' | 'email' | 'phone' | 'random'>('cpf');
  
  const [withdrawLoading, setWithdrawLoading] = useState(false);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const [withdrawSuccess, setWithdrawSuccess] = useState<string | null>(null);

  const fetchWalletData = async () => {
    try {
      setLoading(true);
      const token = await auth.currentUser?.getIdToken();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      // 1. Fetch Wallet summary
      const summaryRes = await fetch('/api/financial?action=summary', { headers });
      if (summaryRes.ok) {
        const data = await summaryRes.json();
        if (data.success) {
          setWallet(data.wallet);
          setConfig(data.config);
        }
      }

      // 2. Fetch Transactions
      const txRes = await fetch('/api/financial?action=transactions', { headers });
      if (txRes.ok) {
        const data = await txRes.json();
        if (data.success) {
          setTransactions(data.transactions || []);
        }
      }

      // 3. Fetch Withdrawals
      const wRes = await fetch('/api/financial?action=withdrawals', { headers });
      if (wRes.ok) {
        const data = await wRes.json();
        if (data.success) {
          setWithdrawals(data.withdrawals || []);
        }
      }
    } catch (err) {
      console.error('[Wallet Page] Error loading wallet:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchWalletData();
  }, [user]);

  const handleRequestWithdrawal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!withdrawAmount || !pixKey || withdrawLoading) return;
    
    setWithdrawLoading(true);
    setWithdrawError(null);
    setWithdrawSuccess(null);

    try {
      const token = await auth.currentUser?.getIdToken();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch('/api/financial?action=withdraw', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          amount: Number(withdrawAmount),
          pixKey,
          pixKeyType: pixType
        })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Falha ao solicitar saque via PIX.');
      }

      setWithdrawSuccess(data.message || 'Solicitação de saque enviada com sucesso!');
      setWithdrawAmount('');
      setPixKey('');
      
      // Refresh data
      await fetchWalletData();
    } catch (err: any) {
      setWithdrawError(err.message || 'Erro ao processar saque.');
    } finally {
      setWithdrawLoading(false);
    }
  };

  const getOriginBadge = (origin: string) => {
    switch (origin) {
      case 'workout': return { label: 'Treino Musculação', color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' };
      case 'cardio': return { label: 'Cardio / GPS', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30' };
      case 'streak': return { label: 'Off-Streak Bônus', color: 'bg-amber-500/20 text-amber-400 border-amber-500/30' };
      case 'mission': return { label: 'Missão Cumprida', color: 'bg-purple-500/20 text-purple-400 border-purple-500/30' };
      case 'league': return { label: 'Prêmio de Liga', color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' };
      case 'sponsor': return { label: 'Desafio Patrocinado', color: 'bg-pink-500/20 text-pink-400 border-pink-500/30' };
      case 'referral': return { label: 'Indicação de Amigo', color: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30' };
      case 'store_purchase': return { label: 'Loja Invictus', color: 'bg-orange-500/20 text-orange-400 border-orange-500/30' };
      case 'withdrawal_hold': return { label: 'Bloqueio para Saque', color: 'bg-rose-500/20 text-rose-400 border-rose-500/30' };
      case 'withdrawal_refund': return { label: 'Estorno de Saque', color: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30' };
      default: return { label: 'Operação de Sistema', color: 'bg-surface-container-highest text-on-surface-variant border-outline' };
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'paid': return { label: 'Pago via PIX', color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30', icon: CheckCircle2 };
      case 'approved': return { label: 'Aprovado (Na Fila)', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30', icon: Clock };
      case 'under_review': return { label: 'Em Análise Antifraude', color: 'bg-amber-500/20 text-amber-400 border-amber-500/30', icon: AlertTriangle };
      case 'pending': return { label: 'Pendente', color: 'bg-purple-500/20 text-purple-400 border-purple-500/30', icon: Clock };
      case 'rejected': return { label: 'Recusado', color: 'bg-rose-500/20 text-rose-400 border-rose-500/30', icon: AlertTriangle };
      case 'cancelled': return { label: 'Cancelado', color: 'bg-gray-500/20 text-gray-400 border-gray-500/30', icon: AlertTriangle };
      default: return { label: status, color: 'bg-surface-container-highest text-on-surface-variant', icon: Clock };
    }
  };

  const redeemableVal = wallet?.redeemableBalance || 0;
  const minWithdrawalVal = config?.minWithdrawalAmount;
  const isWithdrawalAvailable = Boolean(config?.enabled && minWithdrawalVal !== undefined && wallet);

  return (
    <div className="min-h-screen bg-background pb-32 pt-8 px-4 sm:px-6">
      <div className="max-w-7xl mx-auto space-y-8">
        
        {/* Header Section */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="bg-primary/10 text-primary border border-primary/20 text-[10px] font-black uppercase px-3 py-1 rounded-full tracking-widest flex items-center gap-1.5">
                <DollarSign size={14} /> DINHEIRO REAL & SAQUES PIX
              </span>
            </div>
            <h1 className="font-headline italic font-black text-2xl sm:text-3xl uppercase tracking-tighter text-on-surface">
              CARTEIRA <span className="text-primary">INVICTUS</span>
            </h1>
            <p className="text-on-surface-variant text-sm mt-1 max-w-xl">
              Acompanhe seu saldo em Reais (R$) acumulado em ligas, missões e conquistas e realize saques via PIX diretamente na sua conta bancária.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => fetchWalletData()}
              className="p-3 bg-surface-container-high hover:bg-surface-container-highest border border-outline-variant/30 text-on-surface rounded-2xl transition-all active:scale-95 flex items-center justify-center"
              title="Atualizar saldo"
            >
              <RefreshCw size={20} className={loading ? "animate-spin text-primary" : ""} />
            </button>
            <button
              onClick={() => setIsRedeeming(true)}
              disabled={!isWithdrawalAvailable || (minWithdrawalVal !== undefined && redeemableVal < minWithdrawalVal)}
              className="px-6 py-3.5 bg-primary text-black font-headline italic font-black text-lg uppercase tracking-wider rounded-2xl shadow-lg shadow-primary/20 hover:scale-[1.02] active:scale-95 transition-all flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100"
            >
              <ArrowUpRight size={20} />
              SACAR VIA PIX
            </button>
          </div>
        </div>

        {/* Financial Rules Banner */}
        <div className="bg-surface-container-low border border-primary/20 rounded-3xl p-6 relative overflow-hidden shadow-xl">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-center">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-primary/10 border border-primary/30 flex items-center justify-center text-primary shrink-0">
                <DollarSign size={28} />
              </div>
              <div>
                <span className="text-[10px] font-black uppercase text-on-surface-variant tracking-widest block">MONETIZAÇÃO DIRETA</span>
                <p className="font-headline italic font-black text-2xl text-on-surface">
                  PAGAMENTO EM <span className="text-primary">REAIS (R$)</span>
                </p>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
                <ShieldCheck size={28} />
              </div>
              <div>
                <span className="text-[10px] font-black uppercase text-on-surface-variant tracking-widest block">SAQUE MÍNIMO PERMITIDO</span>
                <p className="font-headline italic font-black text-2xl text-on-surface">
                  {minWithdrawalVal !== undefined ? `R$ ${minWithdrawalVal.toFixed(2)}` : (loading ? 'Carregando...' : 'Indisponível')}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
                <Lock size={28} />
              </div>
              <div>
                <span className="text-[10px] font-black uppercase text-on-surface-variant tracking-widest block">SISTEMA ANTIFRAUDE ATIVO</span>
                <p className="text-xs font-bold text-on-surface-variant leading-tight">
                  Validação presencial, GPS e Health Connect. Saques em até 24h úteis.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Main Balance Dashboard Cards */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          
          {/* Main Card: Redeemable Balance */}
          <div className="lg:col-span-8 bg-gradient-to-br from-surface-container-low via-surface-container to-surface-container-high border border-outline-variant/30 rounded-[36px] p-8 md:p-10 relative overflow-hidden shadow-2xl flex flex-col justify-between">
            <div className="absolute top-0 right-0 w-80 h-80 bg-primary/10 rounded-full blur-3xl pointer-events-none -translate-y-12 translate-x-12" />

            <div className="relative z-10 space-y-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-xs font-black uppercase tracking-widest text-on-surface-variant">SALDO DISPONÍVEL (PIX)</span>
                </div>
                <span className="bg-primary/20 text-primary border border-primary/30 px-3 py-1 rounded-full text-xs font-black uppercase tracking-wider">
                  DINHEIRO REAL EM REAIS
                </span>
              </div>

              <div>
                <div className="flex items-baseline gap-3">
                  <span className="font-headline italic font-black text-2xl md:text-3xl text-emerald-400">R$</span>
                  <span className="font-headline italic font-black text-4xl sm:text-5xl md:text-6xl text-primary tracking-tighter">
                    {redeemableVal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="mt-2 flex items-center gap-2 text-on-surface">
                  <span className="text-xs font-bold text-on-surface-variant uppercase tracking-wider">MÉRITO ESPORTIVO VERIFICADO</span>
                </div>
              </div>

              {/* Sub-balances breakdown */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-6 border-t border-outline-variant/20">
                <div className="bg-surface-container-lowest/60 backdrop-blur-md p-4 rounded-2xl border border-outline-variant/20">
                  <span className="text-[10px] font-black text-on-surface-variant uppercase tracking-widest block mb-1">DISPONÍVEL PARA PIX</span>
                  <p className="font-headline italic font-black text-2xl text-emerald-400">
                    R$ {(wallet?.redeemableBalance || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                  <p className="text-[10px] text-on-surface-variant font-medium mt-0.5">Ligas & Saques PIX</p>
                </div>

                <div className="bg-surface-container-lowest/60 backdrop-blur-md p-4 rounded-2xl border border-outline-variant/20">
                  <span className="text-[10px] font-black text-on-surface-variant uppercase tracking-widest block mb-1">SALDO DE PRÊMIOS</span>
                  <p className="font-headline italic font-black text-2xl text-on-surface">
                    R$ {(wallet?.ecosystemBalance || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                  <p className="text-[10px] text-on-surface-variant font-medium mt-0.5">Missões & Loja</p>
                </div>

                <div className="bg-surface-container-lowest/60 backdrop-blur-md p-4 rounded-2xl border border-outline-variant/20">
                  <span className="text-[10px] font-black text-on-surface-variant uppercase tracking-widest block mb-1">RETIDO EM ANÁLISE (PIX)</span>
                  <p className="font-headline italic font-black text-2xl text-purple-400">
                    R$ {(wallet?.blockedBalance || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                  <p className="text-[10px] text-on-surface-variant font-medium mt-0.5">Saques em processamento</p>
                </div>
              </div>
            </div>

            <div className="mt-8 pt-6 flex flex-wrap items-center justify-between gap-4">
              <p className="text-xs text-on-surface-variant font-bold">
                Total Geral Acumulado: <span className="text-on-surface font-black">R$ {(wallet?.totalBalance || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </p>
              <button
                onClick={() => setIsRedeeming(true)}
                disabled={!isWithdrawalAvailable || (minWithdrawalVal !== undefined && redeemableVal < minWithdrawalVal)}
                className="w-full sm:w-auto px-8 py-3.5 bg-primary text-black font-headline italic font-black text-base uppercase tracking-wider rounded-2xl shadow-lg shadow-primary/20 active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ArrowUpRight size={18} /> RESGATAR VIA PIX
              </button>
            </div>
          </div>

          {/* Side Shortcuts Card */}
          <div className="lg:col-span-4 space-y-4 flex flex-col justify-between">
            <div className="bg-surface-container-low border border-outline-variant/20 rounded-[32px] p-6 space-y-4 shadow-xl">
              <h3 className="font-headline italic font-black text-xl uppercase tracking-tight text-on-surface flex items-center gap-2">
                <Sparkles className="text-primary" size={20} /> COMO GANHAR DINHEIRO REAL
              </h3>

              <div className="space-y-3">
                <div 
                  onClick={() => navigate('/challenges')}
                  className="p-4 rounded-2xl bg-surface-container-high border border-outline-variant/20 hover:border-primary/40 cursor-pointer transition-all flex items-center justify-between group"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-purple-500/10 text-purple-400 flex items-center justify-center group-hover:scale-110 transition-transform">
                      <Target size={20} />
                    </div>
                    <div>
                      <h4 className="font-bold text-sm text-on-surface">Missões & Desafios</h4>
                      <p className="text-xs text-on-surface-variant">Cumpra metas e acumule prêmios em Reais</p>
                    </div>
                  </div>
                  <ArrowUpRight size={18} className="text-on-surface-variant group-hover:text-primary transition-colors" />
                </div>

                <div 
                  onClick={() => navigate('/rankings')}
                  className="p-4 rounded-2xl bg-surface-container-high border border-outline-variant/20 hover:border-primary/40 cursor-pointer transition-all flex items-center justify-between group"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-yellow-500/10 text-yellow-400 flex items-center justify-center group-hover:scale-110 transition-transform">
                      <Trophy size={20} />
                    </div>
                    <div>
                      <h4 className="font-bold text-sm text-on-surface">Ligas & Premiações</h4>
                      <p className="text-xs text-on-surface-variant">Concorra aos prêmios em dinheiro da Liga</p>
                    </div>
                  </div>
                  <ArrowUpRight size={18} className="text-on-surface-variant group-hover:text-primary transition-colors" />
                </div>

                <div 
                  onClick={() => navigate('/settings')}
                  className="p-4 rounded-2xl bg-surface-container-high border border-outline-variant/20 hover:border-primary/40 cursor-pointer transition-all flex items-center justify-between group"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-orange-500/10 text-orange-400 flex items-center justify-center group-hover:scale-110 transition-transform">
                      <ShoppingBag size={20} />
                    </div>
                    <div>
                      <h4 className="font-bold text-sm text-on-surface">Loja & Benefícios</h4>
                      <p className="text-xs text-on-surface-variant">Troque prêmios por brindes e benefícios</p>
                    </div>
                  </div>
                  <ArrowUpRight size={18} className="text-on-surface-variant group-hover:text-primary transition-colors" />
                </div>
              </div>
            </div>

            {/* Plan Badge */}
            <div className="bg-surface-container-low border border-primary/20 rounded-[32px] p-6 shadow-xl flex items-center justify-between">
              <div>
                <span className="text-[10px] font-black uppercase text-primary tracking-widest block">PLANO ATUAL DO ATLETA</span>
                <p className="font-headline italic font-black text-2xl text-on-surface">
                  {user?.isSubscribed ? 'PLANO PREMIUM' : 'PLANO GRATUITO'}
                </p>
                <p className="text-xs text-on-surface-variant mt-0.5">
                  {user?.isSubscribed ? 'Acesso total a Ligas e Recompensas em Reais' : 'Acesso a missões gratuitas e treino'}
                </p>
              </div>
              {!user?.isSubscribed && (
                <button
                  onClick={() => navigate('/settings')}
                  className="px-4 py-2 bg-primary/10 border border-primary/30 text-primary font-headline italic font-black text-xs uppercase tracking-wider rounded-xl hover:bg-primary/20 transition-all"
                >
                  VIRAR PRO
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Transactions Ledger & PIX Withdrawals Section */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 mt-12">
          
          {/* Left Column: Ledger History */}
          <div className="lg:col-span-7 space-y-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <History className="text-primary" size={24} />
                <h3 className="font-headline italic font-black text-2xl uppercase tracking-tight text-on-surface">
                  EXTRATO DE MOVIMENTAÇÕES (R$)
                </h3>
              </div>
              <span className="text-xs text-on-surface-variant font-bold">
                {transactions.length} registros no livro-razão
              </span>
            </div>

            <div className="bg-surface-container-low border border-outline-variant/20 rounded-[32px] p-6 space-y-3 shadow-xl max-h-[500px] overflow-y-auto">
              {transactions.length === 0 ? (
                <div className="text-center py-16 text-on-surface-variant space-y-2">
                  <DollarSign className="mx-auto text-outline-variant" size={40} />
                  <p className="font-bold text-sm">Nenhuma movimentação registrada até o momento.</p>
                  <p className="text-xs">Faça um treino ou cumpra uma missão para acumular seus primeiros prêmios em Reais!</p>
                </div>
              ) : (
                transactions.map((tx) => {
                  const badge = getOriginBadge(tx.origin);
                  const isCredit = tx.type === 'credit';
                  return (
                    <div 
                      key={tx.id}
                      className="p-4 rounded-2xl bg-surface-container-high border border-outline-variant/15 flex items-center justify-between gap-4 hover:border-outline-variant/30 transition-all"
                    >
                      <div className="flex items-center gap-3.5">
                        <div className={cn(
                          "w-10 h-10 rounded-xl flex items-center justify-center shrink-0 font-bold",
                          isCredit ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400"
                        )}>
                          {isCredit ? <ArrowDownLeft size={20} /> : <ArrowUpRight size={20} />}
                        </div>
                        <div>
                          <p className="font-bold text-sm text-on-surface line-clamp-1">{tx.description}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <span className={cn("text-[9px] font-black uppercase px-2 py-0.5 rounded-full border", badge.color)}>
                              {badge.label}
                            </span>
                            <span className="text-[10px] text-on-surface-variant">
                              {new Date(tx.createdAt).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <span className={cn(
                          "font-headline italic font-black text-lg",
                          isCredit ? "text-emerald-400" : "text-rose-400"
                        )}>
                          {isCredit ? '+R$ ' : '-R$ '}{tx.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Right Column: PIX Withdrawals History */}
          <div className="lg:col-span-5 space-y-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <DollarSign className="text-emerald-400" size={24} />
                <h3 className="font-headline italic font-black text-2xl uppercase tracking-tight text-on-surface">
                  SAQUES PIX SOLICITADOS
                </h3>
              </div>
            </div>

            <div className="bg-surface-container-low border border-outline-variant/20 rounded-[32px] p-6 space-y-3 shadow-xl max-h-[500px] overflow-y-auto">
              {withdrawals.length === 0 ? (
                <div className="text-center py-16 text-on-surface-variant space-y-2">
                  <ShieldCheck className="mx-auto text-outline-variant" size={40} />
                  <p className="font-bold text-sm">Nenhum saque solicitado ainda.</p>
                  <p className="text-xs">
                    {minWithdrawalVal !== undefined 
                      ? `Quando tiver pelo menos R$ ${minWithdrawalVal.toFixed(2)} disponíveis, solicite a transferência via PIX!`
                      : 'Quando atingir o valor mínimo configurado pelo servidor, solicite a transferência via PIX!'}
                  </p>
                </div>
              ) : (
                withdrawals.map((w) => {
                  const status = getStatusBadge(w.status);
                  const StatusIcon = status.icon;
                  return (
                    <div 
                      key={w.id}
                      className="p-4 rounded-2xl bg-surface-container-high border border-outline-variant/15 space-y-3"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="text-[10px] text-on-surface-variant font-black uppercase tracking-widest block">CHAVE PIX ({w.pixKeyType.toUpperCase()})</span>
                          <p className="font-mono text-xs text-on-surface font-bold">{w.pixKey}</p>
                        </div>
                        <div className="text-right">
                          <span className="font-headline italic font-black text-xl text-emerald-400">
                            R$ {(w.amount || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        </div>
                      </div>

                      <div className="pt-2 border-t border-outline-variant/10 flex items-center justify-between text-xs">
                        <span className={cn("text-[10px] font-black uppercase px-2.5 py-1 rounded-full border flex items-center gap-1", status.color)}>
                          <StatusIcon size={12} /> {status.label}
                        </span>
                        <span className="text-[10px] text-on-surface-variant font-medium">
                          {new Date(w.createdAt).toLocaleDateString('pt-BR')}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

        </div>

      </div>

      {/* PIX Withdrawal Modal */}
      <AnimatePresence>
        {isRedeeming && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-surface-container-low border border-outline-variant/30 rounded-[36px] max-w-lg w-full p-6 sm:p-8 space-y-6 shadow-2xl relative"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-primary/10 border border-primary/30 flex items-center justify-center text-primary">
                    <ArrowUpRight size={24} />
                  </div>
                  <div>
                    <h3 className="font-headline italic font-black text-2xl uppercase text-on-surface">SOLICITAR SAQUE PIX</h3>
                    <p className="text-xs text-on-surface-variant font-bold">Transferência direta para sua conta bancária</p>
                  </div>
                </div>

                <button
                  onClick={() => {
                    setIsRedeeming(false);
                    setWithdrawError(null);
                    setWithdrawSuccess(null);
                  }}
                  className="p-2 text-on-surface-variant hover:text-on-surface rounded-xl hover:bg-surface-container-high transition-all"
                >
                  ✕
                </button>
              </div>

              {withdrawSuccess ? (
                <div className="bg-emerald-500/10 border border-emerald-500/30 p-6 rounded-2xl text-center space-y-3">
                  <CheckCircle2 className="mx-auto text-emerald-400" size={48} />
                  <h4 className="font-headline italic font-black text-xl text-emerald-400 uppercase">SOLICITAÇÃO RECEBIDA!</h4>
                  <p className="text-xs text-on-surface-variant leading-relaxed">{withdrawSuccess}</p>
                  <button
                    onClick={() => {
                      setIsRedeeming(false);
                      setWithdrawSuccess(null);
                    }}
                    className="w-full py-3 bg-emerald-500 text-black font-headline italic font-black text-base uppercase rounded-xl shadow-lg shadow-emerald-500/20"
                  >
                    ENTENDIDO
                  </button>
                </div>
              ) : (
                <form onSubmit={handleRequestWithdrawal} className="space-y-5">
                  
                  {/* Balance Available */}
                  <div className="bg-surface-container-high border border-outline-variant/20 p-4 rounded-2xl flex items-center justify-between">
                    <div>
                      <span className="text-[10px] font-black uppercase text-on-surface-variant tracking-widest block">SALDO DISPONÍVEL EM REAIS (R$)</span>
                      <p className="font-headline italic font-black text-2xl text-primary">
                        R$ {redeemableVal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </p>
                    </div>
                  </div>

                  {/* Input Amount */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-black uppercase tracking-wider text-on-surface-variant block">
                      VALOR DO SAQUE (R$)
                    </label>
                    <div className="relative">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 font-headline italic font-black text-xl text-primary">
                        R$
                      </span>
                      <input
                        type="number"
                        step="0.01"
                        min={minWithdrawalVal || 0}
                        max={redeemableVal}
                        value={withdrawAmount}
                        onChange={(e) => setWithdrawAmount(e.target.value)}
                        placeholder={minWithdrawalVal !== undefined ? `Mínimo R$ ${minWithdrawalVal.toFixed(2)}` : 'Indisponível'}
                        required
                        disabled={!isWithdrawalAvailable}
                        className="w-full h-14 bg-surface-container-lowest border border-outline-variant/30 rounded-2xl pl-12 pr-4 font-headline italic font-black text-2xl text-on-surface focus:border-primary focus:outline-none disabled:opacity-50"
                      />
                    </div>
                  </div>

                  {/* PIX Key Type & Key */}
                  <div className="space-y-3">
                    <label className="text-xs font-black uppercase tracking-wider text-on-surface-variant block">
                      TIPO E CHAVE PIX
                    </label>
                    
                    <div className="grid grid-cols-4 gap-2">
                      {(['cpf', 'email', 'phone', 'random'] as const).map((type) => (
                        <button
                          key={type}
                          type="button"
                          onClick={() => setPixType(type)}
                          className={cn(
                            "py-2 rounded-xl text-xs font-black uppercase tracking-wider border transition-all",
                            pixType === type 
                              ? "bg-primary text-black border-primary" 
                              : "bg-surface-container-lowest border-outline-variant/30 text-on-surface-variant hover:text-on-surface"
                          )}
                        >
                          {type === 'phone' ? 'Tel' : type.toUpperCase()}
                        </button>
                      ))}
                    </div>

                    <input
                      type="text"
                      value={pixKey}
                      onChange={(e) => setPixKey(e.target.value)}
                      placeholder={
                        pixType === 'cpf' ? '000.000.000-00' :
                        pixType === 'email' ? 'seuemail@exemplo.com' :
                        pixType === 'phone' ? '(00) 90000-0000' : 'Chave aleatória UUID'
                      }
                      required
                      disabled={!isWithdrawalAvailable}
                      className="w-full h-12 bg-surface-container-lowest border border-outline-variant/30 rounded-2xl px-4 font-mono text-sm text-on-surface focus:border-primary focus:outline-none disabled:opacity-50"
                    />
                  </div>

                  {withdrawError && (
                    <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-xs font-bold text-rose-400 flex items-center gap-2">
                      <AlertTriangle size={16} className="shrink-0" />
                      <span>{withdrawError}</span>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={withdrawLoading || !withdrawAmount || !pixKey || !isWithdrawalAvailable}
                    className="w-full h-14 bg-primary text-black font-headline italic font-black text-lg uppercase tracking-wider rounded-2xl shadow-xl shadow-primary/20 hover:scale-[1.01] active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {withdrawLoading ? (
                      <RefreshCw size={20} className="animate-spin" />
                    ) : (
                      <>
                        <ShieldCheck size={20} /> CONFIRMAR SAQUE VIA PIX
                      </>
                    )}
                  </button>
                </form>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}

