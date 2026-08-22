import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { Trophy, ChevronUp, ChevronDown, Zap, Filter, Lock, Clock, Info, CheckCircle, AlertCircle, MapPin, Building2, Globe, Dumbbell, TrendingUp, Star, Crown, Target, Sparkles, Timer, ArrowRight, Share2, Heart, Flag, ShieldAlert } from 'lucide-react';
import { cn } from '../lib/utils';
import { getNextSeasonCountdown } from '../lib/seasonUtils';
import { rankingService } from '../services/rankingService';
import { rewardService } from '../services/rewardService';
import { gymService } from '../services/gymService';
import { RankingSnapshot, UserProfile, RankingEntry } from '../types';
import { RankingShareCard } from '../components/RankingShareCard';
import { IGAAuditModal } from '../components/IGAAuditModal';
import { calculateWeeklyIGA } from '../core/iga';
import { auth, db } from '../firebase';
import { doc, getDoc } from 'firebase/firestore';
import { usePro } from '../ProContext';
import { QuotaExhaustedError } from '../services/errors';
import { seasonPrizeService, PremiacaoTemporada } from '../services/seasonPrizeService';

const TABS = [
  { id: 'gym', label: 'Academia', icon: <Building2 size={16} /> },
  { id: 'city', label: 'Cidade', icon: <MapPin size={16} /> },
  { id: 'global', label: 'Nacional', icon: <Globe size={16} /> }
];

import { useUser } from '../UserContext';

export function Rankings() {
  const navigate = useNavigate();
  const { user } = useUser();
  const { showProInvitation } = usePro();
  const [activeTab, setActiveTab] = useState('gym');
  const [activePeriod, setActivePeriod] = useState<'all' | 'weekly' | 'monthly'>('all');
  const [activeTier, setActiveTier] = useState<'performance' | 'open'>(() => {
    return (user?.subscriptionTier === 'performance') ? 'performance' : 'open';
  });
  const [ranking, setRanking] = useState<RankingSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [totalUsersCount, setTotalUsersCount] = useState(0);
  const [isNewUserThisSeason, setIsNewUserThisSeason] = useState(false);
  const [seasonStatus, setSeasonStatus] = useState<any>(null);
  const [categoryPools, setCategoryPools] = useState<any>(null);
  const [rewards, setRewards] = useState<number[]>([]);
  const [activeParticipants, setActiveParticipants] = useState(0);
  const [countdown, setCountdown] = useState('');
  const [seasonDaysRemaining, setSeasonDaysRemaining] = useState(() => getNextSeasonCountdown().time.days);
  const realSeasonEndDateRef = useRef<Date | null>(null);

  useEffect(() => {
    const timer = setInterval(() => {
      if (realSeasonEndDateRef.current) {
        const diffDays = Math.max(0, Math.ceil((realSeasonEndDateRef.current.getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
        setSeasonDaysRemaining(diffDays);
      } else {
        setSeasonDaysRemaining(getNextSeasonCountdown().time.days);
      }
    }, 10000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'system_config', 'season_tracker'));
        if (!cancelled && snap.exists()) {
          const data = snap.data();
          if (data && data.endDate) {
            const realEnd = new Date(data.endDate);
            if (!isNaN(realEnd.getTime())) {
              realSeasonEndDateRef.current = realEnd;
              const diffDays = Math.max(0, Math.ceil((realEnd.getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
              setSeasonDaysRemaining(diffDays);
            }
          }
        }
      } catch (err) {
        console.warn('Failed to fetch real season anchor from system_config/season_tracker, using local estimate', err);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const [showShareCard, setShowShareCard] = useState(false);
  const [shareUserData, setShareUserData] = useState<UserProfile | null>(null);
  const [showIGAModal, setShowIGAModal] = useState(false);

  // Premiacao real da temporada (20% da receita arrecadada). Fica null quando
  // nao foi possivel obter -- e nesse caso a tela nao mostra valor nenhum,
  // em vez de exibir zero ou um numero estimado.
  const [premiacao, setPremiacao] = useState<PremiacaoTemporada | null>(null);
  const [mostrarFaixas, setMostrarFaixas] = useState(false);

  useEffect(() => {
    let cancelado = false;
    seasonPrizeService.buscarPremiacao().then((dados) => {
      if (!cancelado) setPremiacao(dados);
    });
    return () => { cancelado = true; };
  }, [user?.uid]);

  // States & handlers for interactive podium liking / cheering
  const [podiumLikes, setPodiumLikes] = useState<Record<string, number>>({});
  const [floatingHearts, setFloatingHearts] = useState<Record<string, Array<{ id: number; x: number; y: number }>>>({});

  useEffect(() => {
    if (ranking?.topUsers) {
      const freshLikes: Record<string, number> = {};
      ranking.topUsers.slice(0, 3).forEach((u, i) => {
        const storedLikes = localStorage.getItem(`podium_likes_${u.uid}`);
        const userAddedLikes = storedLikes ? parseInt(storedLikes, 10) : 0;
        // Sem base ficticia: o contador reflete apenas apoios reais.
        // Atencao: hoje esses apoios ficam so no localStorage do aparelho,
        // entao nao sao compartilhados entre usuarios.
        freshLikes[u.uid] = userAddedLikes;
      });
      setPodiumLikes(freshLikes);
    }
  }, [ranking?.topUsers]);

  const handleLikePodium = (uid: string, event: React.MouseEvent) => {
    event.stopPropagation();
    
    const storedLikes = localStorage.getItem(`podium_likes_${uid}`);
    const userAddedLikes = (storedLikes ? parseInt(storedLikes, 10) : 0) + 1;
    localStorage.setItem(`podium_likes_${uid}`, userAddedLikes.toString());
    
    setPodiumLikes(prev => ({
      ...prev,
      [uid]: (prev[uid] || 0) + 1
    }));

    const heartId = Date.now() + Math.random();
    const newHeart = {
      id: heartId,
      x: Math.random() * 40 - 20,
      y: -20
    };

    setFloatingHearts(prev => ({
      ...prev,
      [uid]: [...(prev[uid] || []), newHeart]
    }));

    setTimeout(() => {
      setFloatingHearts(prev => ({
        ...prev,
        [uid]: (prev[uid] || []).filter(h => h.id !== heartId)
      }));
    }, 1000);
  };

  // Countdown timer for Weekly Challenge
  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      const nextMonday = new Date();
      nextMonday.setDate(now.getDate() + ((1 + 7 - now.getDay()) % 7 || 7));
      nextMonday.setHours(0, 0, 0, 0);
      
      const diff = nextMonday.getTime() - now.getTime();
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);
      
      setCountdown(`${days}d ${hours}h ${minutes}m ${seconds}s`);
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!user) return;
    
    // Initial data load
    const loadMetadata = async () => {
      const count = await rankingService.getTotalUserCount();
      setTotalUsersCount(count);
      
      const status = rankingService.getSeasonStatus();
      setSeasonStatus(status);

      setIsNewUserThisSeason(user.seasonEntryStatus === 'next_season');
    };
    
    loadMetadata();
  }, [user?.uid]);

  useEffect(() => {
    const fetchRanking = async () => {
      if (!user) return;
      setLoading(true);

      const cacheKey = `rankings_data_${activeTab}_${activePeriod}_${activeTier}_${user.uid}`;
      // Always fetch fresh data for production stats
      try {
        // 1. Parallel fetch counts and ranking
        const [totalSubscribers, usersInGym, usersInCity] = await Promise.all([
          rankingService.getActiveUserCount(),
          user.gymId ? rankingService.getActiveUserCount('gymId' as any, user.gymId) : Promise.resolve(0),
          user.city ? rankingService.getActiveUserCount('city' as any, user.city) : Promise.resolve(0)
        ]);

        setTotalUsersCount(totalSubscribers);

        let levelId = '';
        if (activeTab === 'gym') levelId = user.gymId || '';
        else if (activeTab === 'city') levelId = user.city || '';

        const rankingData = await rankingService.getRanking(activeTab as any, levelId, activePeriod, activeTier);
        setRanking(rankingData);

        // 2. Calculate pools
        const pools = rewardService.calculatePools(totalSubscribers, usersInGym, usersInCity);
        setCategoryPools(pools);

        let currentPool = 0;
        if (activeTab === 'gym') currentPool = pools.gym;
        else if (activeTab === 'city') currentPool = pools.city;
        else currentPool = pools.national;

        setActiveParticipants(rankingData.topUsers.length);
        const calculatedRewards = rewardService.calculateTop10Rewards(currentPool);
        setRewards(calculatedRewards);

        // Update local cache
        localStorage.setItem(cacheKey, JSON.stringify({
          data: {
            totalUsersCount: totalSubscribers,
            pools,
            ranking: rankingData,
            currentPool
          },
          timestamp: Date.now()
        }));
      } catch (error: any) {
        console.error('Failed to fetch ranking:', error);
        if (error instanceof QuotaExhaustedError) {
          showProInvitation(error.message);
        }
      } finally {
        setLoading(false);
      }
    };

    fetchRanking();
  }, [activeTab, activePeriod, activeTier, user?.score, user?.streak, user?.gymId, user?.city, user?.uid]);

  const getResolvedRewardForRank = (userEntry: any, rank: number) => {
    const standardReward = rewards[rank - 1] || 0;
    const pos = userEntry.positions || {};

    if (activeTab === 'gym') {
      if (rank === 1) {
        const isTopCity = pos.city === 1;
        const isTopNational = pos.national === 1;
        if (isTopCity || isTopNational) {
          return 0; // Promoted, gets 0 here
        }
      } else if (rank === 2) {
        const top1User = ranking?.topUsers.find(tu => tu.positions?.gym === 1 || tu.rank === 1);
        if (top1User) {
          const t1Pos = top1User.positions || {};
          const isTopCity = t1Pos.city === 1;
          const isTopNational = t1Pos.national === 1;
          if (isTopCity || isTopNational) {
            return rewards[0] || 0; // Gets the Rank 1 reward!
          }
        }
      }
    } else if (activeTab === 'city') {
      if (rank === 1) {
        const isTopNational = pos.national === 1;
        if (isTopNational) {
          return 0; // Promoted, gets 0 here
        }
      } else if (rank === 2) {
        const top1User = ranking?.topUsers.find(tu => tu.positions?.city === 1 || tu.rank === 1);
        if (top1User) {
          const t1Pos = top1User.positions || {};
          const isTopNational = t1Pos.national === 1;
          if (isTopNational) {
            return rewards[0] || 0; // Gets the Rank 1 reward!
          }
        }
      }
    }

    return standardReward;
  };

  if (!user) return null;


  return (
    <div className="pb-32 min-h-screen bg-background">
      <div className="relative z-10 max-w-screen-xl mx-auto">
        {/* Sub-Header / Tab Navigation - Sticky and Sleek */}
        <div className="sticky top-16 md:top-20 z-40 bg-background backdrop-blur-2xl border-b border-white/[0.06] px-4 md:px-6">
          <div className="flex gap-4 md:gap-10 py-1 overflow-x-auto no-scrollbar justify-start md:justify-center whitespace-nowrap">
            {TABS.map((tab) => {
              const isLocked = (tab.id === 'city' && !categoryPools?.status?.isCityUnlocked) || 
                               (tab.id === 'global' && !categoryPools?.status?.isNationalUnlocked);
              return (
                <button
                  key={tab.id}
                  id={`tab-${tab.id}`}
                  onClick={() => {
                    if (!isLocked) {
                      setActiveTab(tab.id);
                    }
                  }}
                  disabled={isLocked}
                  className={cn(
                    "flex flex-col items-center justify-center min-w-[60px] md:min-w-[70px] h-14 md:h-16 transition-all relative group shrink-0",
                    activeTab === tab.id ? "text-primary" : "text-on-surface-variant/40 hover:text-white",
                    isLocked && "opacity-40 grayscale cursor-not-allowed"
                  )}
                >
                  <div className={cn(
                    "mb-1 transition-transform group-hover:scale-110",
                    activeTab === tab.id ? "scale-110" : ""
                  )}>
                    {React.cloneElement(tab.icon as React.ReactElement<{ size?: number }>, { size: 16 })}
                  </div>
                  <span className="font-headline font-black text-[8px] md:text-[9px] uppercase tracking-[0.2em]">
                    {tab.label}
                  </span>
                  {activeTab === tab.id && (
                    <motion.div 
                      layoutId="activeTabIndicator"
                      className="absolute bottom-0 w-full h-0.5 bg-primary rounded-full shadow-[0_0_10px_rgba(255,204,0,0.6)]"
                    />
                  )}
                  {isLocked && <Lock size={10} className="absolute top-2 right-2 opacity-50" />}
                </button>
              );
            })}
          </div>
        </div>

        {/* Fila de atalhos removida: a tela de Ranking passa a mostrar apenas
            classificacao. Combates & Duelos continua acessivel pela rota /power.
            Central de Treinos era duplicata da aba Desafios da barra inferior. */}

        {/* Period Filter - Minimalist Pills */}
        <div className="px-4 md:px-6 py-4 md:py-4 flex justify-center gap-2 md:gap-3 overflow-x-auto no-scrollbar whitespace-nowrap">
          {(['all', 'weekly', 'monthly'] as const).map((period) => (
            <button
              key={period}
              onClick={() => setActivePeriod(period)}
              className={cn(
                "px-4 md:px-6 py-2.5 rounded-xl text-[8px] md:text-[9px] font-black uppercase tracking-[0.2em] transition-all border shrink-0 cursor-pointer",
                activePeriod === period
                  ? "bg-primary text-black border-primary shadow-[0_0_20px_rgba(245,166,35,0.35)]"
                  : "bg-surface-container/80 text-white/90 border-white/10 hover:border-primary/40 hover:bg-surface-container-high"
              )}
            >
              {period === 'all' ? 'TEMPORADA' : period === 'weekly' ? 'SEMANAL' : 'MENSAL'}
            </button>
          ))}
        </div>


        {/* Premiacao da temporada, compacta. O valor real fica atras do toque. */}
        <div className="px-4 md:px-6 pb-1">
          <button
            onClick={() => setMostrarFaixas(true)}
            className="w-full flex items-center gap-3 bg-surface-container/80 border border-[#F5A623]/35 rounded-2xl p-3.5 text-left active:scale-[0.99] transition-transform"
          >
            <div className="w-10 h-10 rounded-full border border-primary/60 bg-primary/10 flex items-center justify-center shrink-0">
              <Trophy size={18} className="text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <span className="font-label text-[9px] font-black uppercase tracking-[0.15em] text-on-surface-variant block leading-none mb-1">
                Premiação da temporada
              </span>
              {!premiacao ? (
                <span className="font-headline font-black text-sm text-on-surface-variant uppercase block">
                  Carregando
                </span>
              ) : premiacao.faixaAtual === 0 ? (
                <>
                  <span className="font-headline font-black text-base text-white uppercase block leading-tight">
                    Ainda não ativada
                  </span>
                  <span className="text-[10px] text-on-surface-variant font-semibold">
                    Faixa 1 abre com {premiacao.faixas[0]?.minimoAtletas ?? 50} atletas
                  </span>
                </>
              ) : (
                <>
                  <span className="font-headline font-black text-lg text-primary uppercase block leading-tight">
                    Faixa {premiacao.faixaAtual}
                  </span>
                  <span className="text-[10px] text-on-surface-variant font-semibold">
                    {premiacao.premiados} primeiros são premiados
                  </span>
                </>
              )}
            </div>
            <ArrowRight size={18} className="text-primary shrink-0" />
          </button>
        </div>

        {/* Seletor de plano removido da tela. O estado activeTier continua
            sendo inicializado pelo plano do usuario e enviado a consulta do
            ranking, que separa Performance de Open. */}

        {/* Interactive 3D Podium Section */}
        {!loading && ranking && ranking.topUsers.length >= 3 && (
          <section className="px-4 sm:px-6 pt-6 pb-12 max-w-3xl mx-auto w-full">
            <div className="text-center mb-6 space-y-1">
              <span className="font-label text-primary text-[9px] font-black tracking-[0.2em] uppercase">MURAL DOS CAMPEÕES</span>
              <h2 className="font-headline font-black text-3xl uppercase tracking-tighter text-white">PÓDIO INTERATIVO DOS TOP 3</h2>
              <p className="text-[10px] text-on-surface-variant font-bold uppercase tracking-wider">Envie coraçõezinhos para apoiar os líderes da rodada!</p>
            </div>

            <div className="flex justify-center items-end gap-3 sm:gap-6 pt-12 relative select-none">
              
              {/* RANK 2: SILVER PEDESTAL (LEFT) */}
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.5, delay: 0.1 }}
                className="flex flex-col items-center w-1/3 group cursor-pointer"
                onClick={() => {
                  setShareUserData(ranking.topUsers[1] as any);
                  setShowShareCard(true);
                }}
              >
                {/* Avatar wrapper */}
                <div className="relative mb-3 flex flex-col items-center">
                  <div className="w-16 h-16 sm:w-24 sm:h-24 rounded-2xl md:rounded-3xl border-2 sm:border-4 border-prize-silver/50 overflow-hidden shadow-xl active:scale-95 transition-transform bg-surface-container-high shrink-0 relative">
                    <img 
                      src={ranking.topUsers[1].photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=silver`} 
                      className="w-full h-full object-cover" 
                      alt="Silver avatar"
                      referrerPolicy="no-referrer"
                      onError={(e) => {
                        e.currentTarget.onerror = null;
                        e.currentTarget.src = `https://api.dicebear.com/7.x/avataaars/svg?seed=silver`;
                      }}
                    />
                  </div>
                  {/* Badge */}
                  <div className="absolute -top-3 right-1/2 translate-x-1/2 bg-prize-silver text-white w-5 h-5 rounded-md flex items-center justify-center font-headline font-black text-[10px] shadow-lg">
                    2
                  </div>
                </div>

                {/* Pedestal Block */}
                <div className="w-full bg-gradient-to-t from-prize-silver/15 via-surface-container-low/80 to-surface-container rounded-t-[24px] border-t border-x border-prize-silver/30 shadow-2xl flex flex-col items-center pt-4 pb-6 min-h-[140px] sm:min-h-[180px] justify-between relative">
                  <div className="text-center px-1">
                    <span className="font-headline font-black text-3xl sm:text-4xl text-prize-silver/60 block leading-none mb-1">2º</span>
                    <p className="font-label text-[9px] sm:text-xs font-black text-white uppercase truncate max-w-[80px] sm:max-w-[120px] mb-0.5 leading-none">
                      {ranking.topUsers[1].displayName}
                    </p>
                    <p className="font-headline font-black text-[10px] sm:text-sm text-prize-silver">
                      {ranking.topUsers[1].score.toLocaleString()}
                    </p>
                  </div>

                  {/* Like reactor on pedestal */}
                  <div className="relative mt-2">
                    <AnimatePresence>
                      {(floatingHearts[ranking.topUsers[1].uid] || []).map((h) => (
                        <motion.div
                          key={h.id}
                          initial={{ opacity: 1, scale: 0.8, y: 0, x: h.x }}
                          animate={{ opacity: 0, scale: 1.5, y: -70, x: h.x + (Math.random() * 20 - 10) }}
                          exit={{ opacity: 0 }}
                          className="absolute pointer-events-none text-primary z-50"
                          style={{ left: '50%', top: '-24px', marginLeft: '-10px' }}
                        >
                          <Heart fill="currentColor" size={16} />
                        </motion.div>
                      ))}
                    </AnimatePresence>

                    <button
                      type="button"
                      onClick={(e) => handleLikePodium(ranking.topUsers[1].uid, e)}
                      className="px-2.5 py-1.5 rounded-full bg-surface-container-high/60 hover:bg-primary/20 active:scale-90 transition-all border border-white/10 flex items-center justify-center gap-1 group/btn shadow-inner cursor-pointer"
                    >
                      <Heart size={12} className="text-primary group-hover/btn:scale-125 transition-transform" fill={localStorage.getItem(`podium_likes_${ranking.topUsers[1].uid}`) ? "currentColor" : "none"} />
                      <span className="text-[10px] font-black text-white font-mono leading-none">
                        {podiumLikes[ranking.topUsers[1].uid] || 0}
                      </span>
                    </button>
                  </div>
                </div>
              </motion.div>

              {/* RANK 1: GOLD PEDESTAL (CENTER - TALLER & GLOWING) */}
              <motion.div 
                initial={{ opacity: 0, y: -20, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.5 }}
                className="flex flex-col items-center w-1/3 group cursor-pointer z-10"
                onClick={() => {
                  setShareUserData(ranking.topUsers[0] as any);
                  setShowShareCard(true);
                }}
              >
                {/* Avatar wrapper */}
                <div className="relative mb-3 flex flex-col items-center">
                  <motion.div 
                    animate={{ rotate: 360 }}
                    transition={{ duration: 24, repeat: Infinity, ease: "linear" }}
                    className="absolute -inset-2 sm:-inset-4 bg-gradient-to-r from-prize-gold/40 via-transparent to-prize-gold/40 blur-md sm:blur-lg rounded-full opacity-60 group-hover:opacity-100 transition-opacity pointer-events-none" 
                  />
                  
                  <div className="w-20 h-20 sm:w-28 sm:h-28 rounded-2xl md:rounded-3xl border-2 sm:border-4 border-prize-gold overflow-hidden shadow-2xl active:scale-95 transition-transform bg-surface-container-high shrink-0 relative z-10">
                    <img 
                      src={ranking.topUsers[0].photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=gold`} 
                      className="w-full h-full object-cover" 
                      alt="Gold avatar"
                      referrerPolicy="no-referrer"
                      onError={(e) => {
                        e.currentTarget.onerror = null;
                        e.currentTarget.src = `https://api.dicebear.com/7.x/avataaars/svg?seed=gold`;
                      }}
                    />
                  </div>
                  {/* King's Crown */}
                  <div className="absolute -top-6 left-1/2 -translate-x-1/2 z-20">
                    <motion.div
                      animate={{ y: [0, -3, 0] }}
                      transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
                    >
                      <Crown fill="#FFD700" className="w-[28px] h-[28px] sm:w-[34px] sm:h-[34px] text-prize-gold drop-shadow-[0_0_12px_rgba(255,215,0,0.8)]" />
                    </motion.div>
                  </div>
                </div>

                {/* Tall Gold Pedestal Block */}
                <div className="w-full bg-gradient-to-t from-prize-gold/20 via-surface-container-low/90 to-surface-container rounded-t-[28px] border-t border-x border-prize-gold/40 shadow-2xl flex flex-col items-center pt-4 pb-7 min-h-[170px] sm:min-h-[220px] justify-between relative ring-1 ring-prize-gold/10">
                  <div className="text-center px-1">
                    <span className="font-headline font-black text-4xl sm:text-5xl text-prize-gold/70 block leading-none mb-1">1º</span>
                    <p className="font-label text-[10px] sm:text-sm font-black text-white uppercase truncate max-w-[80px] sm:max-w-[120px] mb-0.5 leading-none">
                      {ranking.topUsers[0].displayName}
                    </p>
                    <div className="flex items-center justify-center gap-0.5">
                      <Sparkles size={10} className="text-prize-gold animate-pulse" />
                      <p className="font-headline font-black text-xs sm:text-base text-prize-gold leading-none money-glow">
                        {ranking.topUsers[0].score.toLocaleString()}
                      </p>
                    </div>
                  </div>

                  {/* Like reactor on pedestal */}
                  <div className="relative mt-2">
                    <AnimatePresence>
                      {(floatingHearts[ranking.topUsers[0].uid] || []).map((h) => (
                        <motion.div
                          key={h.id}
                          initial={{ opacity: 1, scale: 0.8, y: 0, x: h.x }}
                          animate={{ opacity: 0, scale: 1.5, y: -70, x: h.x + (Math.random() * 20 - 10) }}
                          exit={{ opacity: 0 }}
                          className="absolute pointer-events-none text-primary z-50"
                          style={{ left: '50%', top: '-24px', marginLeft: '-10px' }}
                        >
                          <Heart fill="currentColor" size={18} />
                        </motion.div>
                      ))}
                    </AnimatePresence>

                    <button
                      type="button"
                      onClick={(e) => handleLikePodium(ranking.topUsers[0].uid, e)}
                      className="px-3 py-1.5 rounded-full bg-surface-container-highest/80 hover:bg-primary/20 active:scale-90 transition-all border border-prize-gold/20 flex items-center justify-center gap-1 group/btn shadow-[0_0_15px_rgba(255,215,0,0.1)] cursor-pointer"
                    >
                      <Heart size={13} className="text-primary group-hover/btn:scale-125 transition-transform" fill={localStorage.getItem(`podium_likes_${ranking.topUsers[0].uid}`) ? "currentColor" : "none"} />
                      <span className="text-[10px] font-black text-white font-mono leading-none">
                        {podiumLikes[ranking.topUsers[0].uid] || 0}
                      </span>
                    </button>
                  </div>
                </div>
              </motion.div>

              {/* RANK 3: BRONZE PEDESTAL (RIGHT) */}
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.5, delay: 0.2 }}
                className="flex flex-col items-center w-1/3 group cursor-pointer"
                onClick={() => {
                  setShareUserData(ranking.topUsers[2] as any);
                  setShowShareCard(true);
                }}
              >
                {/* Avatar wrapper */}
                <div className="relative mb-3 flex flex-col items-center">
                  <div className="w-16 h-16 sm:w-24 sm:h-24 rounded-2xl md:rounded-3xl border-2 sm:border-4 border-prize-bronze/50 overflow-hidden shadow-xl active:scale-95 transition-transform bg-surface-container-high shrink-0 relative">
                    <img 
                      src={ranking.topUsers[2].photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=bronze`} 
                      className="w-full h-full object-cover" 
                      alt="Bronze avatar"
                      referrerPolicy="no-referrer"
                      onError={(e) => {
                        e.currentTarget.onerror = null;
                        e.currentTarget.src = `https://api.dicebear.com/7.x/avataaars/svg?seed=bronze`;
                      }}
                    />
                  </div>
                  {/* Badge */}
                  <div className="absolute -top-3 right-1/2 translate-x-1/2 bg-prize-bronze text-white w-5 h-5 rounded-md flex items-center justify-center font-headline font-black text-[10px] shadow-lg">
                    3
                  </div>
                </div>

                {/* Pedestal Block */}
                <div className="w-full bg-gradient-to-t from-prize-bronze/15 via-surface-container-low/80 to-surface-container rounded-t-[24px] border-t border-x border-prize-bronze/30 shadow-2xl flex flex-col items-center pt-4 pb-6 min-h-[125px] sm:min-h-[155px] justify-between relative">
                  <div className="text-center px-1">
                    <span className="font-headline font-black text-2xl sm:text-3xl text-prize-bronze/60 block leading-none mb-1">3º</span>
                    <p className="font-label text-[9px] sm:text-xs font-black text-white uppercase truncate max-w-[80px] sm:max-w-[120px] mb-0.5 leading-none">
                      {ranking.topUsers[2].displayName}
                    </p>
                    <p className="font-headline font-black text-[10px] sm:text-sm text-prize-bronze">
                      {ranking.topUsers[2].score.toLocaleString()}
                    </p>
                  </div>

                  {/* Like reactor on pedestal */}
                  <div className="relative mt-2">
                    <AnimatePresence>
                      {(floatingHearts[ranking.topUsers[2].uid] || []).map((h) => (
                        <motion.div
                          key={h.id}
                          initial={{ opacity: 1, scale: 0.8, y: 0, x: h.x }}
                          animate={{ opacity: 0, scale: 1.5, y: -70, x: h.x + (Math.random() * 20 - 10) }}
                          exit={{ opacity: 0 }}
                          className="absolute pointer-events-none text-primary z-50"
                          style={{ left: '50%', top: '-24px', marginLeft: '-10px' }}
                        >
                          <Heart fill="currentColor" size={16} />
                        </motion.div>
                      ))}
                    </AnimatePresence>

                    <button
                      type="button"
                      onClick={(e) => handleLikePodium(ranking.topUsers[2].uid, e)}
                      className="px-2.5 py-1.5 rounded-full bg-surface-container-high/60 hover:bg-primary/20 active:scale-90 transition-all border border-white/10 flex items-center justify-center gap-1 group/btn shadow-inner cursor-pointer"
                    >
                      <Heart size={12} className="text-primary group-hover/btn:scale-125 transition-transform" fill={localStorage.getItem(`podium_likes_${ranking.topUsers[2].uid}`) ? "currentColor" : "none"} />
                      <span className="text-[10px] font-black text-white font-mono leading-none">
                        {podiumLikes[ranking.topUsers[2].uid] || 0}
                      </span>
                    </button>
                  </div>
                </div>
              </motion.div>

            </div>
          </section>
        )}


        {/* User Progression Banner */}
        {!loading && ranking && (
           <UserProgressionBanner 
            ranking={ranking}
            user={user}
            activeTab={activeTab}
           />
        )}


        {loading ? (
          <div className="flex justify-center py-20">
            <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <section className="px-6 space-y-3 max-w-3xl mx-auto w-full">
            {ranking?.topUsers.length === 0 ? (
               <div className="text-center py-20 bg-surface-container-low rounded-[40px] border border-outline-variant/10 shadow-inner">
                <Dumbbell className="mx-auto text-on-surface-variant/20 mb-4" size={60} />
                <p className="font-label text-xs font-black text-on-surface-variant uppercase tracking-widest leading-relaxed">Prepare seus equipamentos.<br/>Nenhum gladiador entrou na arena ainda.</p>
              </div>
            ) : (
              <>
                {(() => {
                  const todos = ranking?.topUsers || [];
                  // Quando o podio aparece (3 ou mais atletas), ele ja representa
                  // o top 3. A lista comeca no 4o lugar para nao repetir.
                  const temPodio = todos.length >= 3;
                  const inicio = temPodio ? 3 : 0;
                  const restante = todos.slice(inicio);

                  if (temPodio && restante.length === 0) {
                    return (
                      <p className="text-center py-10 font-label text-[10px] font-black text-on-surface-variant/70 uppercase tracking-widest leading-relaxed">
                        A classificação completa aparece a partir do 4º colocado.
                      </p>
                    );
                  }

                  return restante.map((u, i) => {
                    const idx = inicio + i;
                    return (
                      <RankingItem
                        key={u.uid}
                        entry={u}
                        isMe={u.uid === user.uid}
                        rank={idx + 1}
                        reward={getResolvedRewardForRank(u, idx + 1)}
                        pointsToNext={idx > 0 ? todos[idx - 1].score - u.score : 0}
                        tab={activeTab}
                      />
                    );
                  });
                })()}
              </>
            )}
          </section>
        )}

        {/* Blocos secundarios: descem para baixo da classificacao para que
            o ranking apareca antes. Nenhum conteudo foi removido. */}
        {/* Challenge of the Week (Banner style) */}
        {activePeriod === 'weekly' && !loading && (
           <section className="px-6 mb-8 max-w-3xl mx-auto w-full">
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-gradient-to-r from-primary/20 to-secondary/10 border border-primary/30 rounded-[32px] p-6 relative overflow-hidden"
              >
                 <div className="flex items-center justify-between relative z-10">
                    <div className="space-y-1">
                       <span className="bg-primary/20 text-primary text-[8px] font-black px-2 py-0.5 rounded-full border border-primary/20 uppercase tracking-widest">MISSÃO TEMPORÁRIA</span>
                       <h3 className="font-headline font-black text-2xl text-on-surface uppercase tracking-tighter">DESAFIO DA SEMANA</h3>
                       <div className="flex items-center gap-2 text-on-surface-variant text-[10px] font-black uppercase tracking-widest">
                          <Timer size={14} className="text-primary" />
                          <span>EXPIRA EM: {countdown}</span>
                       </div>
                    </div>
                    <div className="text-right">
                       <Zap size={32} className="text-primary fill-current ml-auto mb-1 animate-pulse" />
                       <span className="font-label text-[9px] font-bold text-on-surface-variant uppercase tracking-widest">TOP 3 GANHAM BÔNUS</span>
                    </div>
                 </div>
                 <div className="absolute top-0 right-0 p-4 opacity-[0.03] scale-150">
                    <Trophy size={120} />
                 </div>
              </motion.div>
           </section>
        )}


        {/* Pro Waiting Info banner above list */}
        {user.isSubscribed && user.seasonStatus === 'WAITING_NEXT_SEASON' && (
          <div className="mx-6 p-4 md:p-5 bg-primary/5 border border-primary/20 rounded-3xl text-center space-y-1.5 max-w-xl md:mx-auto my-4">
            <Clock className="mx-auto text-primary animate-pulse" size={24} />
            <h4 className="font-headline font-black text-base text-primary uppercase tracking-tight">Sua participação oficial começa em:</h4>
            <p className="text-xl font-bold text-white font-mono">{seasonDaysRemaining} DIAS</p>
            <p className="text-[10px] text-on-surface-variant uppercase font-semibold leading-relaxed">
              Continue treinando forte! Seus treinos estão sendo contabilizados no perfil, mas sua inserção oficial no ranking inicia na próxima temporada.
            </p>
          </div>
        )}
      </div>

      {/* Sticky User Position Bar */}
      {/* Reserva espaco a direita para o botao flutuante da IA, que fica na
          mesma altura (bottom-20 right-4) e cobria a pontuacao do usuario. */}
      <div id="user-position-bar" className="fixed bottom-20 md:bottom-24 left-0 right-0 z-40 pl-4 pr-[88px] md:px-4 pointer-events-none flex justify-center pb-safe">
        {user.seasonStatus === 'WAITING_NEXT_SEASON' ? (
          <div
            className="bg-surface-container shadow-2xl shadow-black/40 p-4 rounded-2xl md:rounded-3xl flex items-center justify-between border border-primary/20 pointer-events-auto w-full max-w-md"
          >
            <div className="flex items-center gap-3">
              <Clock size={16} className="text-primary animate-pulse" />
              <p className="font-headline text-xs md:text-sm font-black text-white uppercase tracking-tight text-left">
                Sua participação começa em {seasonDaysRemaining} dias.
              </p>
            </div>
            <span className="font-label text-[8px] font-black text-primary uppercase bg-primary/10 px-2.5 py-1 rounded-md border border-primary/20">
              VAGA SEGURA
            </span>
          </div>
        ) : (
          <div
            onClick={() => {
               setShareUserData(user);
               setShowShareCard(true);
            }}
            className="bg-primary shadow-2xl shadow-black/40 p-4 md:p-5 rounded-2xl md:rounded-3xl flex items-center justify-between border border-white/20 pointer-events-auto w-full max-w-md backdrop-blur-lg cursor-pointer active:scale-95 transition-transform"
          >
            <div className="flex items-center gap-3 md:gap-4 font-bold">
              <div className="bg-white/20 text-white p-2 rounded-lg flex items-center justify-center min-w-[36px] md:min-w-[40px]">
                <span className="font-headline text-xl md:text-2xl font-black leading-none">
                  {activeTab === 'gym' ? (user.positions.gym || '-') : 
                   activeTab === 'city' ? (user.positions.city || '-') : 
                   (user.positions.national || '-')}
                </span>
              </div>
              <div className="flex flex-col">
                <span className="font-label text-[8px] md:text-[10px] font-black text-white/60 uppercase tracking-widest leading-none mb-1">
                  POSIÇÃO {activeTab === 'gym' ? 'ACADEMIA' : activeTab === 'city' ? 'CIDADE' : 'BRASIL'}
                </span>
                <div className="flex items-center gap-1">
                  <ChevronUp className="text-white w-[10px] h-[10px] md:w-[12px] md:h-[12px]" />
                  <span className="font-label text-[9px] md:text-xs font-bold text-white uppercase flex items-center gap-1">SUBINDO!</span>
                </div>
              </div>
            </div>
            <div className="text-right flex flex-col items-end gap-1">
              <span className="font-headline text-lg md:text-xl font-black text-white tracking-tighter block leading-none">
                {activePeriod === 'weekly' ? user.weeklyScore?.toLocaleString() : 
                 activePeriod === 'monthly' ? user.monthlyScore?.toLocaleString() : 
                 user.score.toLocaleString()} PTS
              </span>
              {activePeriod === 'weekly' && (
                <button
                  onClick={() => setShowIGAModal(true)}
                  className="text-[10px] font-black uppercase tracking-wider text-primary bg-primary/20 border border-primary/40 px-2.5 py-0.5 rounded-full hover:bg-primary/30 transition-colors flex items-center gap-1 cursor-pointer"
                >
                  <Sparkles size={10} />
                  <span>Auditoria IGA</span>
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <AnimatePresence>
         {showShareCard && shareUserData && (
            <RankingShareCard 
               user={shareUserData}
               rankingType={activeTab as any}
               period={activePeriod}
               onClose={() => setShowShareCard(false)}
            />
         )}
      </AnimatePresence>

      <IGAAuditModal
        isOpen={showIGAModal}
        onClose={() => setShowIGAModal(false)}
        auditData={(user as any)?.igaAudit || (user ? calculateWeeklyIGA([], { age: user.age, weightKg: user.weight, maxHeartRate: user.maxHeartRate }) : null)}
        userName={user?.name}
      />

      {/* Folha de faixas de premiacao. Mostra os valores REAIS vindos de
          /api/season-prize (20% da receita arrecadada), nunca estimativa. */}
      <AnimatePresence>
        {mostrarFaixas && (
          <div
            className="fixed inset-0 z-[130] flex items-end justify-center bg-black/85 backdrop-blur-md"
            onClick={() => setMostrarFaixas(false)}
          >
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 280 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md bg-surface-container-low border-t border-x border-[#F5A623]/35 rounded-t-[28px] p-5 pb-10 max-h-[85vh] overflow-y-auto"
            >
              <div className="w-10 h-1 rounded-full bg-white/15 mx-auto mb-4" />

              <h3 className="font-headline font-black text-xl text-white uppercase tracking-tight">
                Faixas de premiação
              </h3>
              <p className="text-[11px] text-on-surface-variant leading-relaxed mt-1 mb-4">
                A premiação da Liga Invictus é nacional e única: uma parte da receita
                de assinaturas da temporada é dividida entre os primeiros colocados
                do ranking nacional.
              </p>

              {premiacao && premiacao.pote > 0 && (
                <div className="bg-background/40 border border-white/5 rounded-2xl p-4 mb-4">
                  <span className="font-label text-[9px] font-black uppercase tracking-widest text-on-surface-variant block mb-1">
                    Prêmio acumulado até agora
                  </span>
                  <span className="font-headline font-black text-3xl text-primary block leading-none">
                    R$ {premiacao.pote.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </span>
                  {premiacao.porPosicao.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-white/[0.06] space-y-1.5">
                      {premiacao.porPosicao.map((linha) => (
                        <div key={linha.posicao} className="flex items-center justify-between">
                          <span className="text-[11px] font-bold text-on-surface-variant uppercase">
                            {linha.posicao}º lugar
                          </span>
                          <span className="font-headline font-black text-sm text-white">
                            R$ {linha.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  <p className="text-[9px] text-on-surface-variant/70 mt-3 leading-relaxed">
                    O valor cresce conforme novas assinaturas entram e só é fechado no
                    encerramento da temporada.
                  </p>
                </div>
              )}

              {premiacao && premiacao.pote === 0 && (
                <div className="bg-background/40 border border-white/5 rounded-2xl p-4 mb-4">
                  <p className="text-[11px] text-on-surface-variant leading-relaxed">
                    Nenhum valor acumulado nesta temporada ainda.
                  </p>
                </div>
              )}

              <div className="space-y-2">
                {(premiacao?.faixas || []).map((faixa) => {
                  const atual = premiacao?.faixaAtual === faixa.numero;
                  return (
                    <div
                      key={faixa.numero}
                      className={cn(
                        'flex items-center gap-3 rounded-2xl p-3 border',
                        atual
                          ? 'border-primary bg-primary/10'
                          : 'border-white/[0.07]'
                      )}
                    >
                      <span className={cn('font-headline font-black text-base w-16 shrink-0', atual ? 'text-primary' : 'text-on-surface-variant')}>
                        Faixa {faixa.numero}
                      </span>
                      <div className="flex-1 min-w-0">
                        <span className={cn('text-[12px] font-bold block', atual ? 'text-white' : 'text-on-surface-variant')}>
                          A partir de {faixa.minimoAtletas} atletas
                        </span>
                        {atual && (
                          <span className="font-label text-[9px] font-black uppercase tracking-widest text-primary">
                            Faixa atual
                          </span>
                        )}
                      </div>
                      <span className={cn('text-[11px] font-bold uppercase shrink-0', atual ? 'text-primary' : 'text-on-surface-variant')}>
                        Top {faixa.premiados}
                      </span>
                    </div>
                  );
                })}
              </div>

              <p className="text-on-surface-variant/70 text-[9px] font-semibold uppercase tracking-wide leading-relaxed mt-4 pt-4 border-t border-white/[0.06]">
                Os incentivos exibidos nesta temporada fazem parte de campanhas
                promocionais, ações de engajamento e programas de reconhecimento
                esportivo disponibilizados pela plataforma e parceiros participantes.
              </p>

              <button
                onClick={() => setMostrarFaixas(false)}
                className="w-full mt-5 py-3.5 rounded-2xl bg-primary text-black font-label text-[11px] font-black uppercase tracking-widest active:scale-95 transition-transform"
              >
                Fechar
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}

function RankingItem({ entry, isMe, rank, reward, pointsToNext, tab }: any) {
  const [movement, setMovement] = useState<'up' | 'down' | 'same'>('same');
  const [showDenounceConfirm, setShowDenounceConfirm] = useState(false);
  const [denouncing, setDenouncing] = useState(false);
  const [denounced, setDenounced] = useState(false);

  useEffect(() => {
    if (isMe) {
      const prevRankKey = `prev_rank_${tab}`;
      const prevRank = sessionStorage.getItem(prevRankKey);
      if (prevRank) {
        const pr = parseInt(prevRank);
        if (rank < pr) setMovement('up');
        else if (rank > pr) setMovement('down');
        else setMovement('same');
      }
      sessionStorage.setItem(prevRankKey, rank.toString());
    }
  }, [rank, isMe, tab]);

  const getBadgeForTop5 = (r: number) => {
    if (r === 1) return { label: 'REI', color: 'bg-prize-gold text-black' };
    if (r === 2) return { label: 'ELITE', color: 'bg-prize-silver text-white' };
    if (r === 3) return { label: 'ÁS', color: 'bg-prize-bronze text-white' };
    if (r <= 5) return { label: 'PRÓ', color: 'bg-primary text-black' };
    return null;
  };

  const badge = getBadgeForTop5(rank);

  return (
    <div className={cn(
      "flex items-center justify-between p-4 md:p-5 bg-surface-container/90 backdrop-blur-md rounded-[24px] md:rounded-[28px] hover:bg-surface-container-high/90 transition-all border border-[#F5A623]/25 group relative overflow-hidden gap-3 shadow-lg",
      isMe && "border-primary bg-primary/10 shadow-[0_0_30px_rgba(245,166,35,0.15)] ring-1 ring-primary/40",
      rank <= 3 && "bg-surface-container-high/95 border-[#F5A623]/40"
    )}>
      {showDenounceConfirm && (
        <div className="absolute inset-0 bg-[#0A0806]/98 backdrop-blur-md flex items-center justify-between px-6 z-30 animate-in fade-in zoom-in-95 duration-150">
          <div className="flex items-center gap-2">
            <ShieldAlert size={16} className="text-[#FC4C02]" />
            <span className="font-label text-[9px] font-black text-white uppercase tracking-widest leading-none">Denunciar atleta por treino suspeito?</span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={async (e) => {
                e.stopPropagation();
                setDenouncing(true);
                try {
                  const idToken = await auth.currentUser?.getIdToken();
                  const response = await fetch('/api/denounce', {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      'Authorization': `Bearer ${idToken}`
                    },
                    body: JSON.stringify({
                      suspectId: entry.uid,
                      reason: 'Reportado por atividade suspeita ou fora do padrão.'
                    })
                  });
                  if (response.ok) {
                    setDenounced(true);
                    alert('Denúncia enviada com sucesso! Nossa auditoria analisará o score de presença do atleta.');
                  } else {
                    alert('Ocorreu um erro ao enviar denúncia.');
                  }
                } catch (err) {
                  console.error(err);
                } finally {
                  setDenouncing(false);
                  setShowDenounceConfirm(false);
                }
              }}
              disabled={denouncing}
              className="px-3 py-1.5 bg-[#FC4C02] text-white text-[9px] font-black uppercase rounded-lg active:scale-95 transition-all"
            >
              {denouncing ? 'ENVIANDO...' : 'CONFIRMAR'}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); setShowDenounceConfirm(false); }}
              className="px-3 py-1.5 bg-surface-container-high text-white text-[9px] font-black uppercase rounded-lg active:scale-95 transition-all"
            >
              CANCELAR
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center gap-3 md:gap-5 flex-1 overflow-hidden relative z-10">
        <div className={cn(
          "min-w-[36px] md:min-w-[44px] h-9 md:h-11 rounded-xl md:rounded-2xl flex items-center justify-center font-headline font-black text-xl md:text-2xl transition-all group-hover:scale-110",
          rank === 1 ? 'text-prize-gold' : 
          rank === 2 ? 'text-prize-silver' : 
          rank === 3 ? 'text-prize-bronze' : 
          'text-white/60 font-bold'
        )}>
          {rank}
        </div>
        <div className="relative group/avatar shrink-0">
          <div className="w-10 h-10 md:w-14 md:h-14 rounded-[16px] md:rounded-[20px] overflow-hidden bg-background border border-white/20 group-hover/avatar:rotate-3 transition-transform shadow-md">
            <img 
              src={entry.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${entry.displayName}`} 
              alt={entry.displayName} 
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover" 
              onError={(e) => {
                e.currentTarget.onerror = null;
                e.currentTarget.src = `https://api.dicebear.com/7.x/avataaars/svg?seed=${entry.displayName || 'athlete'}`;
              }}
            />
          </div>
          {entry.isSubscribed && (
             <div className="absolute -bottom-1 -right-1 w-4 h-4 md:w-5 md:h-5 bg-secondary rounded-lg border-2 border-background flex items-center justify-center shadow-md">
                <Crown size={10} className="text-black" fill="currentColor" />
             </div>
          )}
        </div>
        <div className="flex flex-col gap-0.5 md:gap-1 overflow-hidden min-w-[70px]">
          <div className="flex items-center flex-wrap gap-1 md:gap-2">
            <span className={cn(
              "font-headline font-black text-[12px] md:text-sm uppercase tracking-tight truncate max-w-[100px] md:max-w-[140px]",
              isMe ? "text-primary" : "text-white font-bold"
            )}>
              {entry.displayName?.split(' ')[0]}
            </span>
            {!isMe && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowDenounceConfirm(true);
                }}
                title="Denunciar atividade suspeita"
                className="opacity-0 group-hover:opacity-100 focus:opacity-100 ml-1.5 p-1 rounded-md text-white/50 hover:text-red-400 hover:scale-110 active:scale-95 cursor-pointer transition-all shrink-0"
              >
                <Flag size={11} className="stroke-[2.5]" />
              </button>
            )}
            {badge && (
               <div className={cn("px-1.5 md:px-2 py-0.5 text-[6px] md:text-[7px] font-black rounded-lg uppercase tracking-[0.2em] shadow-sm whitespace-nowrap", badge.color)}>
                  {badge.label}
               </div>
            )}
          </div>
          <div className="flex items-center gap-1.5">
             <span className="font-headline font-black text-[10px] md:text-xs text-white/70 uppercase tracking-widest">{entry.score.toLocaleString()} PTS</span>
             {pointsToNext > 0 && (
               <div className="flex items-center gap-1 text-[7px] md:text-[8px] font-black text-primary/80 uppercase whitespace-nowrap">
                  <TrendingUp className="w-[8px] h-[8px] md:w-[10px] md:h-[10px]" />
                  <span>+{pointsToNext}</span>
               </div>
             )}
          </div>
        </div>
      </div>
      
      <div className="flex flex-col items-end gap-1 shrink-0 border-l border-white/[0.03] pl-4 md:pl-6 ml-1 md:ml-2 relative z-10 min-w-[60px] md:min-w-[80px]">
        {reward > 0 ? (
          <div className="text-right">
            {!entry.isSubscribed ? (
               <div className="flex flex-col items-end opacity-20">
                 <span className="font-label text-[7px] md:text-[8px] font-black text-on-surface-variant uppercase tracking-widest block mb-1">BLOQ</span>
                 <Lock className="text-on-surface-variant w-[10px] h-[10px] md:w-[12px] md:h-[12px]" />
               </div>
            ) : (
              <>
                <span className="font-label text-[7px] md:text-[8px] font-black text-on-surface-variant uppercase tracking-widest block mb-1 opacity-40">PRIZE</span>
                <span className="font-headline font-black text-base md:text-xl text-primary money-glow">R${reward}</span>
              </>
            )}
          </div>
        ) : (
          <div className="text-right opacity-20 group-hover:opacity-40 transition-opacity">
            <span className="font-headline font-black text-[9px] md:text-[10px] uppercase">
              {movement === 'up' ? 'SB' : movement === 'down' ? 'DS' : '--'}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function UserProgressionBanner({ ranking, user, activeTab }: any) {
  const currentPos = activeTab === 'gym' ? (user.positions.gym || 0) : activeTab === 'city' ? (user.positions.city || 0) : (user.positions.national || 0);
  
  if (currentPos === 0) return null;

  const getTargetInfo = () => {
    if (currentPos === 1) return { message: "Você é o LÍDER ABSOLUTO! Mantenha o posto.", target: null };
    
    // Distância para o próximo
    const nextUser = ranking.topUsers[currentPos - 2];
    if (!nextUser) return null;

    const pointsToNext = nextUser.score - (user.monthlyScore || 0);
    
    if (currentPos > 5) {
      const top5User = ranking.topUsers[Math.min(4, ranking.topUsers.length - 1)];
      const pointsToTop5 = top5User.score - (user.monthlyScore || 0);
      
      return {
        message: `Faltam ${pointsToTop5.toLocaleString()} XP para o TOP 5`,
        subMessage: `Você está a ${currentPos - 5} posições do Cluster Premiado`,
        progress: 100 - Math.min(100, (pointsToTop5 / top5User.score) * 100),
        isClose: currentPos <= 10
      };
    }

    return {
      message: `Apenas ${pointsToNext.toLocaleString()} XP para subir de posição`,
      subMessage: `Você está na disputa pelo TOP 3!`,
      progress: 100 - Math.min(100, (pointsToNext / nextUser.score) * 100),
      isClose: true
    };
  };

  const info = getTargetInfo();
  if (!info) return null;

  return (
    <section className="px-6 py-2 max-w-3xl mx-auto w-full">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-surface-container-highest/50 border border-outline-variant/10 rounded-2xl p-4 overflow-hidden relative"
      >
        <div className="flex items-center justify-between gap-4 mb-2 relative z-10">
          <div className="flex items-center gap-3">
             <div className={cn(
               "w-8 h-8 rounded-lg flex items-center justify-center",
               info.isClose ? "bg-primary text-black" : "bg-surface-container-highest text-on-surface-variant"
             )}>
                <Target size={16} />
             </div>
             <div>
                <p className="font-label text-[10px] font-black text-on-surface uppercase tracking-tight">{info.message}</p>
                <p className="text-[8px] font-bold text-on-surface-variant uppercase tracking-widest">{info.subMessage}</p>
             </div>
          </div>
          {info.isClose && (
            <div className="bg-primary/10 px-2 py-1 rounded text-primary text-[7px] font-black uppercase animate-pulse border border-primary/20">
               QUASE LÁ!
            </div>
          )}
        </div>
        {info.progress !== undefined && (
          <div className="h-1 w-full bg-surface-container rounded-full overflow-hidden">
            <motion.div 
              initial={{ width: 0 }}
              animate={{ width: `${info.progress}%` }}
              className="h-full bg-primary"
            />
          </div>
        )}
      </motion.div>
    </section>
  );
}
