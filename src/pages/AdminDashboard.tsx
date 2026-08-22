import React, { useState, useEffect } from 'react';
import { 
  Users, 
  Dumbbell, 
  MapPin, 
  Globe, 
  DollarSign, 
  TrendingUp, 
  Search, 
  Filter, 
  ArrowRight, 
  BarChart2, 
  Activity,
  Award,
  ChevronRight,
  Trophy,
  UserCheck,
  Shield,
  CreditCard,
  RefreshCw,
  Sparkles,
  Sliders,
  Trash2,
  AlertTriangle,
  Loader2,
  X,
  Watch,
  Wrench,
FlaskConical
} from 'lucide-react';
import { motion } from 'motion/react';
import { db, auth } from '../firebase';
import { collection, query, getDocs, getDoc, limit, orderBy, where, getCountFromServer, doc, updateDoc, deleteDoc } from 'firebase/firestore';
import { UserProfile } from '../types';
import { REWARD_RULES } from '../constants';
import { rewardService } from '../services/rewardService';
import { rankingService } from '../services/rankingService';
import { cn } from '../lib/utils';
import { useNavigate } from 'react-router-dom';
import { CreatorSandbox } from '../components/CreatorSandbox';

export function AdminDashboard() {
  const navigate = useNavigate();
  const [stats, setStats] = useState({
    totalUsers: 0,
    totalSubscribers: 0,
    totalRevenue: 0,
    activePhase: 1,
    pools: { gym: 0, city: 0, national: 0 }
  });
  const [pagarmeStats, setPagarmeStats] = useState({
    activeSubscriptions: 0,
    cancellations: 0,
    inadimplencia: 0,
    receitaMensal: 0,
    receitaRecorrenteMensal: 0,
    churn: 0,
    churnRate: '0.0%',
    chargebacks: 0,
    pagamentosPendentes: 0
  });
  const [recentUsers, setRecentUsers] = useState<UserProfile[]>([]);
  const [topUsers, setTopUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'premium' | 'free'>('all');

  const [dbSearchResults, setDbSearchResults] = useState<UserProfile[]>([]);
  const [searching, setSearching] = useState(false);
  const [adminFeedback, setAdminFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showCreatorSandbox, setShowCreatorSandbox] = useState(false);

  // Deletion modal & loading states
  const [userToDelete, setUserToDelete] = useState<{ uid: string; name: string } | null>(null);
  const [deletingUser, setDeletingUser] = useState(false);
  const [deletingQueryLoading, setDeletingQueryLoading] = useState(false);

  // Simulation states
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [simulating, setSimulating] = useState(false);
  const [simError, setSimError] = useState<string | null>(null);
  const [simResult, setSimResult] = useState<{
    success: boolean;
    message: string;
    usersCount: number;
    clearedLegacyCount: number;
    users: { uid: string; name: string; age: number; objective: string; weeklyFrequency: string; tier: string }[];
  } | null>(null);

  const handleRunSimulation = async () => {
    setSimulating(true);
    setSimError(null);
    setSimResult(null);
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) {
        throw new Error('Sessão expirada. Por favor, refaça o login admin.');
      }
      const idToken = await currentUser.getIdToken();
      const response = await fetch('/api/admin?action=simulate-perf-users', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${idToken}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Erro inesperado na geração da simulação.');
      }

      const resData = await response.json();
      
      // Clear rankings/stats caches in localStorage to display fresh simulated metrics immediately across the app
      try {
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && (key.startsWith('rankings_data_') || key.startsWith('km_redis_') || key.includes('ranking') || key.includes('stats'))) {
            keysToRemove.push(key);
          }
        }
        keysToRemove.forEach(k => localStorage.removeItem(k));
      } catch (cacheErr) {
        console.warn('Failed to clear client-side ranking cache:', cacheErr);
      }

      setSimResult(resData);
      setRefreshTrigger(prev => prev + 1);
    } catch (err: any) {
      console.error('[Simulation Error]', err);
      setSimError(err.message || 'Falha ao processar simulação.');
    } finally {
      setSimulating(false);
    }
  };

  // Debounced search directly in Firestore to allow finding any user by Name, Email, or CPF
  useEffect(() => {
    const searchDbUsers = async () => {
      const trimmed = searchQuery.trim().toLowerCase();
      if (!trimmed) {
        setDbSearchResults([]);
        return;
      }
      setSearching(true);
      try {
        const usersCol = collection(db, 'users');
        const resultsMap = new Map<string, UserProfile>();

        // 1. Search by exact numeric CPF if digits are present
        const numericCpf = trimmed.replace(/\D/g, '');
        if (numericCpf && numericCpf.length >= 3) {
          const qCpf = query(usersCol, where('cpf', '==', numericCpf), limit(5));
          const snapCpf = await getDocs(qCpf);
          snapCpf.forEach(d => resultsMap.set(d.id, { uid: d.id, ...d.data() } as UserProfile));
        }

        // 2. Search by exact e-mail (all lowercase)
        if (trimmed.includes('@')) {
          const qEmail = query(usersCol, where('email', '==', trimmed), limit(5));
          const snapEmail = await getDocs(qEmail);
          snapEmail.forEach(d => resultsMap.set(d.id, { uid: d.id, ...d.data() } as UserProfile));
        }

        // 3. Prefix search by displayNameLower (case-insensitive indexing)
        const qName = query(
          usersCol, 
          where('displayNameLower', '>=', trimmed), 
          where('displayNameLower', '<=', trimmed + '\uf8ff'),
          limit(15)
        );
        const nameSnap = await getDocs(qName);
        nameSnap.forEach(d => resultsMap.set(d.id, { uid: d.id, ...d.data() } as UserProfile));

        // Fallback prefix search: search raw displayName for legacy entries
        if (resultsMap.size === 0) {
          const qNameCapitalized = query(
            usersCol,
            where('displayName', '>=', searchQuery.trim()),
            where('displayName', '<=', searchQuery.trim() + '\uf8ff'),
            limit(15)
          );
          const nameSnapCap = await getDocs(qNameCapitalized);
          nameSnapCap.forEach(d => resultsMap.set(d.id, { uid: d.id, ...d.data() } as UserProfile));
        }

        setDbSearchResults(Array.from(resultsMap.values()));
      } catch (err) {
        console.error('[-] Error searching in backend:', err);
      } finally {
        setSearching(false);
      }
    };

    const delayDebounce = setTimeout(() => {
      searchDbUsers();
    }, 450);

    return () => clearTimeout(delayDebounce);
  }, [searchQuery]);

  // Fast direct role toggler for admin list rows
  const handlePromoteToggle = async (targetUid: string, currentRole: 'user' | 'admin') => {
    const newRole: 'user' | 'admin' = currentRole === 'admin' ? 'user' : 'admin';
    try {
      const userDocRef = doc(db, 'users', targetUid);
      await updateDoc(userDocRef, { role: newRole });

      const updateList = (list: UserProfile[]): UserProfile[] => 
        list.map(u => u.uid === targetUid ? { ...u, role: newRole } : u);

      setRecentUsers(prev => updateList(prev));
      setDbSearchResults(prev => updateList(prev));

      setAdminFeedback({ 
        type: 'success', 
        text: `Perfil atualizado para ${newRole.toUpperCase()} com sucesso!` 
      });
      setTimeout(() => setAdminFeedback(null), 4000);
    } catch (err: any) {
      console.error('[-] Error updating user role:', err);
      setAdminFeedback({ 
        type: 'error', 
        text: `Erro ao atualizar papel: ${err.message || err}` 
      });
      setTimeout(() => setAdminFeedback(null), 5000);
    }
  };

  const handleDeleteUser = (targetUid: string, targetName?: string) => {
    setUserToDelete({ uid: targetUid, name: targetName || targetUid });
  };

  const confirmDeleteUserModal = async () => {
    if (!userToDelete) return;
    setDeletingUser(true);
    const targetUid = userToDelete.uid;
    const targetName = userToDelete.name;

    try {
      // 1. Call Backend API
      const currentUser = auth.currentUser;
      if (currentUser) {
        try {
          const idToken = await currentUser.getIdToken();
          const res = await fetch('/api/admin?action=delete-user', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify({ target: targetUid })
          });
          const data = await res.json();
          if (!res.ok) {
            console.warn('[Admin] Backend delete API notice:', data.error);
          }
        } catch (apiErr) {
          console.warn('[Admin] Backend API call failed:', apiErr);
        }
      }

      // 2. Direct client fallback deletion
      try {
        await deleteDoc(doc(db, 'users', targetUid));
      } catch (clientErr: any) {
        console.warn('[Admin] Client deleteDoc notice:', clientErr.message);
      }

      setRecentUsers(prev => prev.filter(u => u.uid !== targetUid));
      setDbSearchResults(prev => prev.filter(u => u.uid !== targetUid));
      setUserToDelete(null);
      setAdminFeedback({
        type: 'success',
        text: `Cadastro de "${targetName}" foi excluído permanentemente com sucesso!`
      });
      setTimeout(() => setAdminFeedback(null), 6000);
    } catch (err: any) {
      console.error('[-] Error deleting user:', err);
      setAdminFeedback({
        type: 'error',
        text: `Erro ao excluir usuário: ${err.message || err}`
      });
      setTimeout(() => setAdminFeedback(null), 6000);
    } finally {
      setDeletingUser(false);
    }
  };

  const handleDeleteUserByQuery = async (queryInput: string) => {
    const rawVal = queryInput.trim();
    if (!rawVal) {
      setAdminFeedback({ type: 'error', text: "Por favor, digite o e-mail ou o CPF do cadastro que deseja excluir." });
      setTimeout(() => setAdminFeedback(null), 5000);
      return;
    }
    
    setDeletingQueryLoading(true);
    const cleanCpf = rawVal.replace(/\D/g, '');
    const cleanEmail = rawVal.toLowerCase();
    
    try {
      let deletedUids: string[] = [];

      // 1. Try Backend API first for comprehensive deletion across auth & db
      const currentUser = auth.currentUser;
      if (currentUser) {
        try {
          const idToken = await currentUser.getIdToken();
          const res = await fetch('/api/admin?action=delete-user', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify({ target: rawVal })
          });
          const data = await res.json();
          if (res.ok && data.success) {
            deletedUids = data.deletedUids || [];
            
            setRecentUsers(prev => prev.filter(u => 
              !deletedUids.includes(u.uid) &&
              u.uid !== rawVal &&
              (!u.email || u.email.toLowerCase() !== cleanEmail) && 
              (!u.cpf || u.cpf.replace(/\D/g, '') !== cleanCpf)
            ));
            setDbSearchResults(prev => prev.filter(u => 
              !deletedUids.includes(u.uid) &&
              u.uid !== rawVal &&
              (!u.email || u.email.toLowerCase() !== cleanEmail) && 
              (!u.cpf || u.cpf.replace(/\D/g, '') !== cleanCpf)
            ));
            
            const inputEl = document.getElementById('delete-user-search') as HTMLInputElement;
            if (inputEl) inputEl.value = '';

            setAdminFeedback({
              type: 'success',
              text: data.message || `Cadastro referente a "${rawVal}" foi excluído permanentemente com sucesso!`
            });
            setTimeout(() => setAdminFeedback(null), 6000);
            return;
          }
        } catch (apiErr) {
          console.warn('[Admin] API delete attempt notice, falling back to direct Firestore:', apiErr);
        }
      }

      // 2. Comprehensive Client-side Firestore search and deletion
      const usersRef = collection(db, 'users');
      const foundUids = new Set<string>();

      // A. Direct doc check if rawVal is doc ID
      try {
        const directDoc = await getDoc(doc(db, 'users', rawVal));
        if (directDoc.exists()) {
          foundUids.add(directDoc.id);
        }
      } catch (e) {}

      // B. Query by exact email
      if (rawVal.includes('@')) {
        const snapEmail = await getDocs(query(usersRef, where('email', '==', cleanEmail)));
        snapEmail.docs.forEach(d => foundUids.add(d.id));

        const snapRawEmail = await getDocs(query(usersRef, where('email', '==', rawVal)));
        snapRawEmail.docs.forEach(d => foundUids.add(d.id));
      }

      // C. Query by CPF match
      if (cleanCpf.length >= 8) {
        const snapCpfClean = await getDocs(query(usersRef, where('cpf', '==', cleanCpf)));
        snapCpfClean.docs.forEach(d => foundUids.add(d.id));

        const snapCpfRaw = await getDocs(query(usersRef, where('cpf', '==', rawVal)));
        snapCpfRaw.docs.forEach(d => foundUids.add(d.id));
      }

      // D. Full collection scan fallback if no direct matches found
      if (foundUids.size === 0) {
        const allUsersSnap = await getDocs(query(usersRef, limit(200)));
        allUsersSnap.docs.forEach(d => {
          const u = d.data() || {};
          const uEmail = (u.email || '').toLowerCase();
          const uCpf = (u.cpf || '').replace(/\D/g, '');
          const uName = (u.displayName || '').toLowerCase();

          if (
            d.id === rawVal ||
            (cleanEmail && uEmail === cleanEmail) ||
            (cleanCpf && uCpf === cleanCpf) ||
            (rawVal.length > 3 && (uName.includes(rawVal.toLowerCase()) || uEmail.includes(rawVal.toLowerCase())))
          ) {
            foundUids.add(d.id);
          }
        });
      }

      if (foundUids.size === 0) {
        setAdminFeedback({ 
          type: 'error', 
          text: `Nenhum cadastro de atleta foi encontrado para "${rawVal}". Verifique o e-mail ou CPF digitado.` 
        });
        setTimeout(() => setAdminFeedback(null), 6000);
        return;
      }

      // Delete all matching documents from client Firestore
      for (const targetUid of foundUids) {
        try {
          await deleteDoc(doc(db, 'users', targetUid));
        } catch (delErr) {
          console.error(`Error deleting user doc ${targetUid}:`, delErr);
        }
      }

      setRecentUsers(prev => prev.filter(u => !foundUids.has(u.uid)));
      setDbSearchResults(prev => prev.filter(u => !foundUids.has(u.uid)));

      const inputEl = document.getElementById('delete-user-search') as HTMLInputElement;
      if (inputEl) inputEl.value = '';

      setAdminFeedback({
        type: 'success',
        text: `Cadastro referente a "${rawVal}" (${foundUids.size} registro(s)) foi excluído com sucesso!`
      });
      setTimeout(() => setAdminFeedback(null), 6000);
    } catch (err: any) {
      console.error("Erro ao excluir usuário:", err);
      setAdminFeedback({ type: 'error', text: "Erro ao excluir cadastro: " + (err.message || err) });
      setTimeout(() => setAdminFeedback(null), 6000);
    } finally {
      setDeletingQueryLoading(false);
    }
  };

  useEffect(() => {
    const fetchAdminData = async () => {
      setLoading(true);
      try {
        // 1. Core Metrics
        const usersCol = collection(db, 'users');
        const [totalUsersSnap, subUsersSnap] = await Promise.all([
          getCountFromServer(usersCol),
          getCountFromServer(query(usersCol, where('isSubscribed', '==', true)))
        ]);

        const totalUsers = totalUsersSnap.data().count;
        const totalSubscribers = subUsersSnap.data().count;
        const totalRevenue = totalSubscribers * REWARD_RULES.SUBSCRIPTION_PRICE;
        const activePhase = rewardService.getCurrentPhase(totalSubscribers);
        
        // Approximated pools for dashboard overview (national calculation)
        const values = rewardService.getValuesPerUserByLeague(totalSubscribers);
        // For simplicity in global view, we'll show national pool and potential total gym pool
        const pools = {
          gym: totalSubscribers * values.gym, // Total gym pool across all gyms
          city: totalSubscribers * values.city,
          national: totalSubscribers * values.national
        };

        setStats({
          totalUsers,
          totalSubscribers,
          totalRevenue,
          activePhase,
          pools
        });

        // Fetch Pagarme stats
        try {
          const currentUser = auth.currentUser;
          if (currentUser) {
            const token = await currentUser.getIdToken();
            const res = await fetch('/api/payments/pagarme?action=admin-dashboard', {
              headers: { 'Authorization': `Bearer ${token}` }
            });
            const pData = await res.json();
            if (pData?.success && pData.metrics) {
              setPagarmeStats(pData.metrics);
            }
          }
        } catch (e) {
          console.error('Error fetching Pagarme stats:', e);
        }

        // 2. Recent Users
        const recentQuery = query(usersCol, orderBy('createdAt', 'desc'), limit(10));
        const recentSnap = await getDocs(recentQuery);
        setRecentUsers(recentSnap.docs.map(d => ({ uid: d.id, ...d.data() } as UserProfile)));

        // 3. Top Users (XP)
        const topQuery = query(usersCol, orderBy('score', 'desc'), limit(10));
        const topSnap = await getDocs(topQuery);
        setTopUsers(topSnap.docs.map(d => ({ uid: d.id, ...d.data() } as UserProfile)));

      } catch (error) {
        console.error('Error fetching admin data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchAdminData();
  }, [refreshTrigger]);

  const activeUserList = searchQuery.trim() ? dbSearchResults : recentUsers;

  const filteredUsers = activeUserList.filter(u => {
    const matchesFilter = filter === 'all' ? true : 
                         filter === 'premium' ? u.isSubscribed : !u.isSubscribed;
    return matchesFilter;
  });

  if (loading) {
    return (
      <div className="p-12 flex flex-col items-center justify-center min-h-screen space-y-4">
        <Activity className="animate-spin text-primary" size={48} />
        <p className="font-headline italic font-black text-on-surface-variant uppercase tracking-widest animate-pulse">CARREGANDO SISTEMA...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <header className="px-6 pt-12 pb-8 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <Shield className="text-secondary" size={24} />
              <h1 className="font-headline italic font-black text-3xl text-on-surface uppercase tracking-tight">PAINEL DE CONTROLE</h1>
            </div>
            <p className="font-label text-[10px] font-black text-on-surface-variant uppercase tracking-widest leading-none mt-1">Visão geral do ecossistema moove</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setShowCreatorSandbox(true)}
              className="flex items-center gap-2 px-4 py-2 bg-red-600/20 border border-red-500/40 hover:bg-red-600/30 text-red-300 font-headline italic font-black text-xs uppercase tracking-wider rounded-full transition-colors cursor-pointer"
            >
              <Wrench className="w-4 h-4 text-red-400" />
              Módulo do Criador
            </button>
            <button
              onClick={() => navigate('/admin/security')}
              className="flex items-center gap-2 px-4 py-2 bg-rose-600/20 border border-rose-500/40 hover:bg-rose-600/30 text-rose-300 font-headline italic font-black text-xs uppercase tracking-wider rounded-full transition-colors"
            >
              <Shield className="w-4 h-4 text-rose-400" />
              Central de Segurança
            </button>
            <button
              onClick={() => navigate('/admin/gym-audit')}
              className="flex items-center gap-2 px-4 py-2 bg-neutral-800 border border-neutral-700 hover:bg-neutral-700 text-neutral-200 font-headline italic font-black text-xs uppercase tracking-wider rounded-full transition-colors"
            >
              Auditoria de Academias
            </button>
          </div>
        </div>
      </header>

      <div className="px-6 space-y-8">
        {/* Top-level Feedback Banner */}
        {adminFeedback && (
          <motion.div 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className={cn(
              "p-4 rounded-2xl flex items-center justify-between gap-4 font-bold text-xs uppercase tracking-wide border shadow-lg",
              adminFeedback.type === 'success' 
                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" 
                : "bg-red-500/10 border-red-500/30 text-red-400"
            )}
          >
            <div className="flex items-center gap-3">
              {adminFeedback.type === 'success' ? <UserCheck size={18} /> : <AlertTriangle size={18} />}
              <span>{adminFeedback.text}</span>
            </div>
            <button onClick={() => setAdminFeedback(null)} className="opacity-60 hover:opacity-100 transition-opacity">
              <X size={16} />
            </button>
          </motion.div>
        )}

        {/* Main Stats Grid */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard 
            label="Total Usuários" 
            value={stats.totalUsers.toLocaleString()} 
            icon={<Users size={20} />} 
            color="text-primary"
          />
          <StatCard 
            label="Membros PRO" 
            value={stats.totalSubscribers.toLocaleString()} 
            icon={<UserCheck size={20} />} 
            color="text-secondary"
          />
          <StatCard 
            label="Fase Ativa" 
            value={`FASE ${stats.activePhase}`} 
            icon={<TrendingUp size={20} />} 
            color="text-alert-orange"
            subtitle={stats.activePhase === 1 ? "Academia" : stats.activePhase === 2 ? "Cidade" : "Nacional"}
          />
          <StatCard 
            label="Receita Est." 
            value={`R$ ${stats.totalRevenue.toLocaleString()}`} 
            icon={<DollarSign size={20} />} 
            color="text-tertiary"
          />
        </section>

        {/* Pagar.me Telemetry Dashboard */}
        <section className="bg-surface-container-low p-6 sm:p-8 rounded-[40px] border border-outline-variant/15 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-white/5 pb-4 gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <CreditCard className="text-primary animate-pulse" size={22} />
                <h3 className="font-headline italic font-black text-xl text-on-surface uppercase tracking-tight">TELEMETRIA FINANCEIRA (PAGAR.ME)</h3>
              </div>
              <p className="text-[10px] sm:text-xs text-on-surface-variant font-mono uppercase tracking-wider">Gateway de Pagamentos Pagar.me integrado no Backend</p>
            </div>
            <span className="self-start sm:self-center bg-primary/10 text-primary border border-primary/20 text-[9px] font-mono font-black px-2.5 py-1 rounded-full uppercase tracking-widest">LIVE CONECTADO</span>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-black/30 p-5 rounded-3xl border border-white/5 space-y-2">
              <p className="text-[9px] font-mono font-black text-on-surface-variant uppercase tracking-widest">ASSINATURAS ATIVAS</p>
              <p className="font-headline italic font-black text-2xl text-secondary">{pagarmeStats.activeSubscriptions}</p>
              <div className="text-[9px] text-on-surface-variant uppercase font-medium">Recorrência ativa no sistema</div>
            </div>

            <div className="bg-black/30 p-5 rounded-3xl border border-white/5 space-y-2">
              <p className="text-[9px] font-mono font-black text-on-surface-variant uppercase tracking-widest">RECEITA MENSAL (ATUAL)</p>
              <p className="font-headline italic font-black text-2xl text-primary">R$ {pagarmeStats.receitaMensal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
              <div className="text-[9px] text-on-surface-variant uppercase font-medium">Faturamento real liquidado</div>
            </div>

            <div className="bg-black/30 p-5 rounded-3xl border border-white/5 space-y-2">
              <p className="text-[9px] font-mono font-black text-on-surface-variant uppercase tracking-widest">M.R.R. (RECORRENTE)</p>
              <p className="font-headline italic font-black text-2xl text-tertiary">R$ {pagarmeStats.receitaRecorrenteMensal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
              <div className="text-[9px] text-on-surface-variant uppercase font-medium">Receita mensal projetada</div>
            </div>

            <div className="bg-black/30 p-5 rounded-3xl border border-white/5 space-y-2">
              <p className="text-[9px] font-mono font-black text-on-surface-variant uppercase tracking-widest">CHURN RATE</p>
              <p className="font-headline italic font-black text-2xl text-red-400">{pagarmeStats.churnRate}</p>
              <div className="text-[9px] text-on-surface-variant uppercase font-medium">{pagarmeStats.churn} cancelamentos totais</div>
            </div>

            <div className="bg-black/30 p-5 rounded-3xl border border-white/5 space-y-2">
              <p className="text-[9px] font-mono font-black text-on-surface-variant uppercase tracking-widest">PAGAMENTOS PENDENTES</p>
              <p className="font-headline italic font-black text-2xl text-yellow-500">{pagarmeStats.pagamentosPendentes}</p>
              <div className="text-[9px] text-on-surface-variant uppercase font-medium">Pix/Boleto aguardando liquidação</div>
            </div>

            <div className="bg-black/30 p-5 rounded-3xl border border-white/5 space-y-2">
              <p className="text-[9px] font-mono font-black text-on-surface-variant uppercase tracking-widest">INADIMPLÊNCIA</p>
              <p className="font-headline italic font-black text-2xl text-orange-500">{pagarmeStats.inadimplencia}</p>
              <div className="text-[9px] text-on-surface-variant uppercase font-medium">Faturas vencidas não pagas</div>
            </div>

            <div className="bg-black/30 p-5 rounded-3xl border border-white/5 space-y-2">
              <p className="text-[9px] font-mono font-black text-on-surface-variant uppercase tracking-widest">CHARGEBACKS</p>
              <p className="font-headline italic font-black text-2xl text-red-500">{pagarmeStats.chargebacks}</p>
              <div className="text-[9px] text-on-surface-variant uppercase font-medium">Contestações registradas</div>
            </div>

            <div className="bg-black/30 p-5 rounded-3xl border border-white/5 space-y-2">
              <p className="text-[9px] font-mono font-black text-on-surface-variant uppercase tracking-widest">CANCELAMENTOS</p>
              <p className="font-headline italic font-black text-2xl text-on-surface-variant">{pagarmeStats.cancellations}</p>
              <div className="text-[9px] text-on-surface-variant uppercase font-medium">Assinaturas canceladas</div>
            </div>
          </div>
        </section>

        {/* Growth & Phase Progress */}
        <section className="bg-surface-container-low p-8 rounded-[40px] border border-outline-variant/10 space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="font-headline italic font-black text-xl text-on-surface uppercase tracking-tight">PROGRESSO DE LIGAS</h3>
            <div className="flex items-center gap-2">
              <span className="font-label text-[10px] font-black text-primary uppercase">META NACIONAL</span>
              <span className="font-mono text-xs text-on-surface-variant">{(stats.totalSubscribers / 10000 * 100).toFixed(1)}%</span>
            </div>
          </div>

          <div className="space-y-4">
            <ProgressBar 
              label="Cidade (5k)" 
              current={stats.totalSubscribers} 
              target={5000} 
              active={stats.activePhase >= 2}
            />
            <ProgressBar 
              label="Nacional (10k)" 
              current={stats.totalSubscribers} 
              target={10000} 
              active={stats.activePhase >= 3}
            />
          </div>
        </section>

        {/* Pools Overview */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <PoolCard 
            label="POOL ACADEMIAS" 
            value={stats.pools.gym} 
            icon={<Dumbbell size={24} />} 
            color="bg-primary/20 text-primary"
            description="Total distribuído entre todas as academias"
          />
          <PoolCard 
            label="POOL CIDADE" 
            value={stats.pools.city} 
            icon={<MapPin size={24} />} 
            color="bg-secondary/20 text-secondary"
            description="Liga municipal ativa a partir de 5k subs"
          />
          <PoolCard 
            label="POOL NACIONAL" 
            value={stats.pools.national} 
            icon={<Globe size={24} />} 
            color="bg-tertiary/20 text-tertiary"
            description="Liga nacional ativa a partir de 10k subs"
          />
        </section>

        {/* Quick Actions */}
        <section className="flex gap-4 overflow-x-auto no-scrollbar pb-2">
          <ActionButton label="Sandbox Smartwatch" icon={<Watch size={18} />} onClick={() => navigate('/wearables')} />
          <ActionButton label="Simulador de Rankings" icon={<Sliders size={18} />} onClick={() => navigate('/admin/ranking-simulator')} />
<ActionButton label="IGA Original (Teste)" icon={<FlaskConical size={18} />} onClick={() => navigate('/admin/iga-teste-original')} />
          <ActionButton label="Payouts" icon={<CreditCard size={18} />} onClick={() => navigate('/admin/payouts')} />
          <ActionButton label="Workouts" icon={<Activity size={18} />} onClick={() => navigate('/admin/workouts')} />
          <ActionButton label="Auditar Academias" icon={<MapPin size={18} />} onClick={() => navigate('/admin/gym-audit')} />
        </section>

        {/* Simulador de Atletas Performance */}
        <section className="bg-gradient-to-r from-secondary/15 via-primary/5 to-tertiary/15 p-8 rounded-[40px] border border-outline-variant/10 space-y-6">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <Users className="text-secondary animate-pulse shrink-0" size={26} />
                <h3 className="font-headline italic font-black text-2xl text-on-surface uppercase tracking-tight">GERENCIADOR DE BASE E POVOAMENTO DE ATLETAS</h3>
              </div>
              <p className="text-xs sm:text-sm text-on-surface-variant font-medium max-w-3xl leading-relaxed">
                Povoa a base administrativa com <strong>50 atletas categorizados no plano Performance e Open</strong> (idades de 18 a 65 anos). Cada perfil possui parâmetros fisiológicos, frequência semanal e treinos validados para estruturação inicial dos rankings da liga em produção!
              </p>
            </div>
            
            <button
              onClick={handleRunSimulation}
              disabled={simulating}
              className="lg:min-w-[240px] bg-secondary text-black px-8 py-5 rounded-[24px] font-headline italic font-black uppercase tracking-widest hover:scale-105 active:scale-95 disabled:opacity-50 disabled:pointer-events-none transition-all shadow-xl flex items-center justify-center gap-3 text-sm shrink-0 border border-secondary/20 cursor-pointer"
            >
              {simulating ? (
                <>
                  <RefreshCw size={18} className="animate-spin" />
                  GERANDO...
                </>
              ) : (
                <>
                  <Sparkles size={18} />
                  SIMULAR 50 ATLETAS
                </>
              )}
            </button>
          </div>

          {simError && (
            <div className="bg-red-500/10 border border-red-500/20 p-4 rounded-2xl text-xs font-bold text-red-400 uppercase tracking-wider text-center">
              ❌ Erro ao simular usuários: {simError}
            </div>
          )}

          {simResult && (
            <div className="bg-surface-container-high/60 border border-outline-variant/15 p-6 rounded-3xl space-y-4 animate-fadeIn">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-headline italic font-black text-sm text-secondary uppercase tracking-tight">SIMULAÇÃO DE CONTA PERFORMANCE EXECUTADA COM SUCESSO!</h4>
                  <p className="text-[10px] text-on-surface-variant uppercase font-mono mt-0.5">
                    {simResult.usersCount} atletas gerados | {simResult.clearedLegacyCount} robôs antigos limpos
                  </p>
                </div>
                <button 
                  onClick={() => setSimResult(null)}
                  className="font-mono text-[9px] font-black text-on-surface-variant/60 uppercase tracking-wider hover:text-white transition-colors cursor-pointer"
                >
                  [LIMPAR PAINEL DE SIMULAÇÃO]
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 max-h-[300px] overflow-y-auto no-scrollbar pr-1">
                {simResult.users.map((u, i) => (
                  <div key={u.uid} className="bg-black/30 p-3 rounded-2xl border border-white/5 space-y-2 hover:border-secondary/20 transition-all">
                    <div className="flex items-center gap-2">
                      <img 
                        src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${u.uid}`} 
                        alt="" 
                        className="w-8 h-8 rounded-full bg-secondary/10 border border-secondary/20 shrink-0" 
                      />
                      <div className="truncate">
                        <p className="text-xs font-bold text-white truncate">{u.name}</p>
                        <p className="text-[8px] font-mono text-secondary uppercase font-black tracking-widest">{u.tier}</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[9px] font-mono text-on-surface-variant uppercase leading-tight border-t border-white/5 pt-2">
                      <div>Idade: <span className="text-white font-bold">{u.age} anos</span></div>
                      <div>Freq: <span className="text-white font-bold">{u.weeklyFrequency}</span></div>
                      <div className="col-span-2 truncate">Objetivo: <span className="text-white font-bold">{u.objective}</span></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* Add Admin by CPF Section */}
        <section className="bg-surface-container-low p-8 rounded-[40px] border border-outline-variant/10 space-y-6">
          <div className="flex items-center gap-3">
            <Shield className="text-primary" size={24} />
            <h3 className="font-headline italic font-black text-xl text-on-surface uppercase tracking-tight">ADICIONAR ADMIN POR CPF</h3>
          </div>
          
          <div className="flex flex-col md:flex-row gap-4">
            <div className="relative flex-1">
              <input 
                type="text" 
                placeholder="CPF (apenas números)" 
                id="cpf-admin-search"
                className="w-full bg-surface-container-high border border-outline-variant/10 rounded-2xl px-6 py-4 text-sm font-bold focus:outline-none focus:border-primary/40"
              />
            </div>
            <button 
              id="promote-user-button"
              onClick={async () => {
                const cpfInput = document.getElementById('cpf-admin-search') as HTMLInputElement;
                const cpf = cpfInput?.value.replace(/\D/g, '');
                if (!cpf) {
                  setAdminFeedback({ type: 'error', text: "Por favor, insira o CPF comercial ou pessoal do usuário." });
                  return;
                }
                
                try {
                  const usersRef = collection(db, 'users');
                  const q = query(usersRef, where('cpf', '==', cpf));
                  const querySnapshot = await getDocs(q);
                  
                  if (querySnapshot.empty) {
                    setAdminFeedback({ type: 'error', text: "Nenhum atleta foi localizado com este CPF cadastrado." });
                    setSearchQuery(cpf); // Ajuda ele a ver se existe um usuário CPF parecido na lista
                    return;
                  }
                  
                  const userDoc = querySnapshot.docs[0];
                  await updateDoc(doc(db, 'users', userDoc.id), {
                    role: 'admin'
                  });
                  
                  const targetUid = userDoc.id;
                  const updateList = (list: UserProfile[]): UserProfile[] => 
                    list.map(u => u.uid === targetUid ? { ...u, role: 'admin' as const } : u);

                  setRecentUsers(prev => updateList(prev));
                  setDbSearchResults(prev => updateList(prev));
                  
                  setAdminFeedback({ 
                    type: 'success', 
                    text: `Atleta ${userDoc.data().displayName || 'identificado'} foi promovido a administrador!` 
                  });
                  if (cpfInput) cpfInput.value = '';
                  setTimeout(() => setAdminFeedback(null), 5000);
                } catch (error: any) {
                  console.error("Erro ao promover usuário por CPF:", error);
                  setAdminFeedback({ type: 'error', text: "Erro ao atualizar permissões do usuário: " + (error.message || error) });
                }
              }}
              className="bg-primary text-black px-8 py-4 rounded-2xl font-headline italic font-black uppercase tracking-widest hover:scale-105 active:scale-95 transition-all shadow-lg text-sm"
            >
              PROMOVER A ADMIN
            </button>
          </div>

          {adminFeedback && (
            <div className={cn(
              "p-4 rounded-2xl text-xs font-bold uppercase tracking-wider text-center border animate-pulse",
              adminFeedback.type === 'success' 
                ? "bg-primary/20 text-primary border-primary/20" 
                : "bg-red-500/20 text-red-400 border-red-500/20"
            )}>
              {adminFeedback.text}
            </div>
          )}

          <p className="font-label text-[10px] font-black text-on-surface-variant uppercase tracking-widest opacity-60">
            Cuidado: Esta ação concede acesso total ao sistema ao usuário indicado.
          </p>
        </section>

        {/* Delete User Section */}
        <section className="bg-red-500/5 p-8 rounded-[40px] border border-red-500/20 space-y-6">
          <div className="flex items-center gap-3">
            <Trash2 className="text-red-400" size={24} />
            <h3 className="font-headline italic font-black text-xl text-on-surface uppercase tracking-tight">EXCLUIR CADASTRO DO APP</h3>
          </div>
          <p className="text-xs text-on-surface-variant font-medium">
            Digite o e-mail ou o CPF do atleta para excluir totalmente o cadastro do banco de dados para que ele possa recadastrar.
          </p>
          
          <div className="flex flex-col md:flex-row gap-4">
            <div className="relative flex-1">
              <input 
                type="text" 
                placeholder="E-mail ou CPF (ex: valdocidasilva@gmail.com ou 44922027068)" 
                id="delete-user-search"
                className="w-full bg-surface-container-high border border-outline-variant/10 rounded-2xl px-6 py-4 text-sm font-bold focus:outline-none focus:border-red-500/40"
              />
            </div>
            <button 
              disabled={deletingQueryLoading}
              onClick={() => {
                const deleteInput = document.getElementById('delete-user-search') as HTMLInputElement;
                if (deleteInput) {
                  handleDeleteUserByQuery(deleteInput.value);
                }
              }}
              className="bg-red-500 text-white px-8 py-4 rounded-2xl font-headline italic font-black uppercase tracking-widest hover:bg-red-600 active:scale-95 transition-all shadow-lg text-sm shrink-0 flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {deletingQueryLoading ? (
                <>
                  <Loader2 className="animate-spin" size={18} />
                  <span>EXCLUINDO...</span>
                </>
              ) : (
                <>
                  <Trash2 size={18} />
                  <span>EXCLUIR CADASTRO</span>
                </>
              )}
            </button>
          </div>
        </section>

        {/* User Management List */}
        <section className="space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <h3 className="font-headline italic font-black text-xl text-on-surface uppercase tracking-tight">USUÁRIOS RECENTES</h3>
            <div className="flex items-center gap-4">
              <div className="relative flex-1 md:w-64">
                <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant/40" />
                <input 
                  type="text" 
                  placeholder="Buscar..." 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-surface-container-high border border-outline-variant/10 rounded-2xl pl-12 pr-4 py-3 text-xs font-bold focus:outline-none focus:border-primary/40"
                />
              </div>
              <button 
                onClick={() => setFilter(f => f === 'all' ? 'premium' : f === 'premium' ? 'free' : 'all')}
                className={cn(
                  "p-3 rounded-2xl border transition-all",
                  filter !== 'all' ? "bg-primary border-primary text-black" : "bg-surface-container-high border-outline-variant/10 text-on-surface-variant"
                )}
              >
                <Filter size={18} />
              </button>
            </div>
          </div>

          <div className="space-y-2">
            {searching && (
              <div className="text-center py-4 bg-surface-container-low border border-outline-variant/10 rounded-2xl animate-pulse">
                <span className="text-[10px] font-black uppercase text-secondary tracking-widest">Pesquisando usuários no banco...</span>
              </div>
            )}
            {!searching && filteredUsers.length === 0 && (
              <div className="text-center py-8 bg-surface-container-low border border-outline-variant/10 rounded-2xl">
                <span className="text-xs font-bold text-on-surface-variant uppercase">Nenhum usuário localizado</span>
              </div>
            )}
            {filteredUsers.map(user => (
              <UserRow 
                key={user.uid} 
                user={user} 
                onClick={() => navigate(`/profile/${user.uid}`)} 
                onPromoteToggle={handlePromoteToggle}
                onDelete={handleDeleteUser}
              />
            ))}
          </div>
        </section>

        {/* Leaderboard Summary */}
        <section className="bg-surface-container-high/40 p-8 rounded-[40px] border border-outline-variant/10 space-y-6">
          <div className="flex items-center gap-3">
             <Award className="text-secondary" size={24} />
             <h3 className="font-headline italic font-black text-xl text-on-surface uppercase tracking-tight leading-none">RANKING XP GLOBAL</h3>
          </div>
          <div className="space-y-3">
            {topUsers.map((user, i) => (
              <div key={user.uid} className="flex items-center justify-between p-3 bg-black/20 rounded-2xl border border-white/5">
                <div className="flex items-center gap-3">
                  <span className="font-headline italic font-black text-on-surface-variant/40 text-lg w-6">#{i + 1}</span>
                  <div className="w-10 h-10 rounded-xl bg-surface-container-highest overflow-hidden border border-white/5">
                    <img src={user.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.uid}`} alt="" className="w-full h-full object-cover" />
                  </div>
                  <div className="flex flex-col">
                    <span className="font-bold text-xs text-on-surface truncate max-w-[120px]">{user.displayName}</span>
                    <span className="font-label text-[8px] text-on-surface-variant uppercase tracking-widest">{user.gymName || 'NÃO ATRIBUÍDO'}</span>
                  </div>
                </div>
                <div className="text-right">
                  <span className="font-headline italic font-black text-primary leading-none">{user.score.toLocaleString()}</span>
                  <span className="font-label text-[8px] text-on-surface-variant uppercase ml-2">XP</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Creator Sandbox Section */}
        <section>
          <CreatorSandbox inline={true} />
        </section>
      </div>

      {/* Creator Sandbox Slide-over Drawer */}
      <CreatorSandbox isOpen={showCreatorSandbox} onClose={() => setShowCreatorSandbox(false)} />

      {/* Delete Confirmation Modal */}
      {userToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-surface-container p-8 rounded-[32px] border border-red-500/30 max-w-md w-full space-y-6 shadow-2xl relative"
          >
            <button 
              onClick={() => !deletingUser && setUserToDelete(null)}
              className="absolute top-6 right-6 p-2 text-on-surface-variant hover:text-on-surface transition-colors rounded-full bg-white/5"
            >
              <X size={18} />
            </button>

            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-red-500/20 text-red-400 flex items-center justify-center shrink-0 border border-red-500/30">
                <AlertTriangle size={24} />
              </div>
              <div>
                <h3 className="font-headline italic font-black text-lg text-on-surface uppercase tracking-tight">EXCLUIR CADASTRO</h3>
                <p className="text-[10px] font-mono font-bold text-red-400 uppercase tracking-widest mt-0.5">AÇÃO IRREVERSÍVEL</p>
              </div>
            </div>

            <p className="text-xs text-on-surface-variant font-medium leading-relaxed">
              Tem certeza de que deseja excluir permanentemente o cadastro de <strong className="text-on-surface">{userToDelete.name}</strong>? Esta ação apagará todos os dados no banco de dados e na autenticação.
            </p>

            <div className="flex items-center gap-3 pt-2">
              <button 
                disabled={deletingUser}
                onClick={() => setUserToDelete(null)}
                className="flex-1 py-3 px-4 rounded-xl border border-white/10 text-on-surface text-xs font-bold uppercase tracking-wider hover:bg-white/5 transition-colors disabled:opacity-50"
              >
                CANCELAR
              </button>
              <button 
                disabled={deletingUser}
                onClick={confirmDeleteUserModal}
                className="flex-1 py-3 px-4 rounded-xl bg-red-500 hover:bg-red-600 text-white text-xs font-headline italic font-black uppercase tracking-wider transition-colors shadow-lg flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {deletingUser ? (
                  <>
                    <Loader2 className="animate-spin" size={16} />
                    <span>EXCLUINDO...</span>
                  </>
                ) : (
                  <>
                    <Trash2 size={16} />
                    <span>EXCLUIR AGORA</span>
                  </>
                )}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, icon, color, subtitle }: { label: string, value: string, icon: React.ReactNode, color: string, subtitle?: string }) {
  return (
    <div className="bg-surface-container p-5 rounded-[32px] border border-outline-variant/10 space-y-2">
      <div className={cn("w-10 h-10 rounded-xl bg-surface-container-highest flex items-center justify-center", color)}>
        {icon}
      </div>
      <div>
        <p className="font-label text-[8px] font-black text-on-surface-variant uppercase tracking-widest leading-none mb-1">{label}</p>
        <p className="font-headline italic font-black text-2xl text-on-surface leading-none">{value}</p>
        {subtitle && <p className="font-label text-[8px] font-black text-on-surface/40 uppercase tracking-widest mt-1">{subtitle}</p>}
      </div>
    </div>
  );
}

function ProgressBar({ label, current, target, active }: { label: string, current: number, target: number, active: boolean }) {
  const percentage = Math.min(100, (current / target) * 100);
  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center text-[9px] font-black uppercase tracking-[0.2em]">
        <span className={cn(active ? "text-primary" : "text-on-surface-variant")}>{label}</span>
        <span className="text-on-surface-variant">{current.toLocaleString()} / {target.toLocaleString()}</span>
      </div>
      <div className="h-4 w-full bg-surface-container-highest rounded-xl p-1 border border-white/5 overflow-hidden">
        <motion.div 
          initial={{ width: 0 }}
          animate={{ width: `${percentage}%` }}
          className={cn(
            "h-full rounded-lg transition-all duration-1000",
            active ? "bg-primary shadow-[0_0_10px_rgba(var(--primary-rgb),0.5)]" : "bg-primary/20"
          )}
        />
      </div>
    </div>
  );
}

function PoolCard({ label, value, icon, color, description }: { label: string, value: number, icon: React.ReactNode, color: string, description: string }) {
  return (
    <div className="bg-surface-container-low p-6 rounded-[32px] border border-outline-variant/10 space-y-4">
      <div className="flex justify-between items-start">
        <div className={cn("w-12 h-12 rounded-2xl flex items-center justify-center", color)}>
          {icon}
        </div>
        <div className="text-right">
          <p className="font-label text-[9px] font-black text-on-surface-variant uppercase tracking-widest leading-none mb-1">{label}</p>
          <p className="font-headline italic font-black text-2xl text-on-surface">R$ {value.toLocaleString()}</p>
        </div>
      </div>
      <p className="text-[9px] font-medium text-on-surface-variant leading-relaxed opacity-60 uppercase tracking-tight">{description}</p>
    </div>
  );
}

function UserRow({ 
  user, 
  onClick, 
  onPromoteToggle,
  onDelete 
}: { 
  user: UserProfile, 
  onClick: () => void, 
  onPromoteToggle?: (uid: string, currentRole: 'user' | 'admin') => void,
  onDelete?: (uid: string, name?: string) => void
}) {
  return (
    <div 
      onClick={onClick}
      className="bg-surface-container p-4 rounded-2xl border border-outline-variant/10 flex flex-col sm:flex-row sm:items-center justify-between gap-4 group cursor-pointer hover:bg-surface-container-high transition-all"
    >
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-xl bg-surface-container-highest overflow-hidden border border-white/5 relative shrink-0">
          <img src={user.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.uid}`} alt="" className="w-full h-full object-cover" />
          {user.isSubscribed && (
            <div className="absolute top-0 right-0 w-4 h-4 bg-secondary rounded-bl-lg flex items-center justify-center">
              <TrendingUp size={8} className="text-black" />
            </div>
          )}
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="font-bold text-sm text-on-surface group-hover:text-primary transition-colors truncate">{user.displayName}</h4>
            {user.isSubscribed && <span className="bg-secondary/20 text-secondary text-[8px] font-black px-1.5 py-0.5 rounded uppercase font-mono">PRO</span>}
            {user.role === 'admin' && <span className="bg-primary/20 text-primary text-[8px] font-black px-1.5 py-0.5 rounded uppercase border border-primary/20 font-mono">ADMIN</span>}
          </div>
          <p className="text-[10px] text-on-surface-variant opacity-60 font-medium truncate max-w-[200px]">{user.email || 'Sem e-mail'}</p>
          {user.cpf && <p className="text-[9px] font-mono text-on-surface-variant/40 mt-0.5">CPF: {user.cpf}</p>}
        </div>
      </div>
      
      <div className="flex items-center gap-3 sm:gap-4 justify-between sm:justify-end w-full sm:w-auto shrink-0">
        {onPromoteToggle && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onPromoteToggle(user.uid, user.role || 'user');
            }}
            className={cn(
              "px-3 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-wider border transition-all text-center min-w-[100px]",
              user.role === 'admin' 
                ? "bg-red-500/10 hover:bg-red-500/20 text-red-400 border-red-500/10" 
                : "bg-primary/10 hover:bg-primary/20 text-primary border-primary/10"
            )}
          >
            {user.role === 'admin' ? 'REBAIXAR USER' : 'TORNAR ADMIN'}
          </button>
        )}
        {onDelete && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(user.uid, user.displayName || user.email || user.cpf);
            }}
            title="Excluir cadastro"
            className="p-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 transition-all"
          >
            <Trash2 size={16} />
          </button>
        )}
        <div className="hidden md:block text-right">
          <p className="font-label text-[8px] font-black text-on-surface-variant uppercase tracking-widest leading-none mb-1">DATA CADASTRO</p>
          <p className="font-mono text-[10px] text-on-surface">{user.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'N/A'}</p>
        </div>
        <ChevronRight size={18} className="text-on-surface-variant/40 group-hover:text-primary group-hover:translate-x-1 transition-all" />
      </div>
    </div>
  );
}

function ActionButton({ label, icon, onClick }: { label: string, icon: React.ReactNode, onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className="flex items-center gap-3 bg-surface-container border border-outline-variant/10 px-5 py-4 rounded-2xl hover:bg-primary hover:text-black transition-all shrink-0 active:scale-95 group"
    >
      <div className="text-primary group-hover:text-black transition-colors">
        {icon}
      </div>
      <span className="font-headline italic font-black text-sm uppercase tracking-tighter">{label}</span>
    </button>
  );
}
