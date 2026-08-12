import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Flame, Star, Dumbbell, ArrowRight, ChevronRight, Clock, TrendingUp, Crown, Building2, Trophy, Map, Zap, Calendar, Heart, Activity, Check, Watch, Coins, Play, Swords, Share2, Plus, X, Camera, Image as ImageIcon, Send, RefreshCw, Lock, Utensils, Wallet, DollarSign } from 'lucide-react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { auth } from '../firebase';
import { UserProfile, Workout } from '../types';
import { rewardService } from '../services/rewardService';
import { rankingService } from '../services/rankingService';
import { workoutService } from '../services/workoutService';
import { getSeasonStatus, SeasonInfo, getNextSeasonCountdown } from '../lib/seasonUtils';
import { runningService, RunningStatsBase } from '../services/runningService';
import { QuotaExhaustedError } from '../services/errors';
import { useUser } from '../UserContext';
import { usePro } from '../ProContext';
import { cn } from '../lib/utils';
import { getLevelFromXP } from '../lib/levelUtils';
import { ProfileShareCard } from '../components/ProfileShareCard';
import { socialService } from '../services/socialService';
import { Post } from '../types';

import { eliteChallengeService, Season } from '../services/eliteChallengeService';
import { WearableManager } from '../services/wearables/WearableManager';

export function Home() {
  const navigate = useNavigate();
  const { user } = useUser();
  const { showProInvitation } = usePro();
  const { triggerXPToast } = useOutletContext<{ triggerXPToast: (p: number, m?: string) => void }>();
  const [recentActivities, setRecentActivities] = useState<Workout[]>([]);
  const [seasonInfo, setSeasonInfo] = useState<SeasonInfo | null>(null);
  const [countdown, setCountdown] = useState(() => getNextSeasonCountdown());

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown(getNextSeasonCountdown());
    }, 1000);
    return () => clearInterval(timer);
  }, []);
  const [showProfileShare, setShowProfileShare] = useState(false);
  const [showWorkoutModal, setShowWorkoutModal] = useState(false);
  const [runningStats, setRunningStats] = useState<RunningStatsBase | null>(null);
  const [activeSeason, setActiveSeason] = useState<Season | null>(null);
  const [feedPosts, setFeedPosts] = useState<Post[]>([]);
  const [isWatchConnected, setIsWatchConnected] = useState(false);
  const [connectedProviders, setConnectedProviders] = useState<string[]>([]);

  // States for new community post
  const [showPostModal, setShowPostModal] = useState(false);
  const [postCaption, setPostCaption] = useState('');
  const [postImageFile, setPostImageFile] = useState<File | null>(null);
  const [postImagePreview, setPostImagePreview] = useState<string | null>(null);
  const [selectedPresetUrl, setSelectedPresetUrl] = useState<string | null>(null);
  const [isPosting, setIsPosting] = useState(false);
  const [postProgress, setPostProgress] = useState(0);
  const [postError, setPostError] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setPostImageFile(file);
      setSelectedPresetUrl(null); // Clear preset if file is picked
      const url = URL.createObjectURL(file);
      setPostImagePreview(url);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) {
      setPostImageFile(file);
      setSelectedPresetUrl(null); // Clear preset if file is dropped
      const url = URL.createObjectURL(file);
      setPostImagePreview(url);
    }
  };

  const handleSelectPreset = (url: string) => {
    setSelectedPresetUrl(url);
    setPostImageFile(null); // Clear uploaded file if preset is selected
    setPostImagePreview(url);
  };

  const handleCreatePost = async () => {
    if (!postCaption.trim()) {
      setPostError('Escreva uma frase inspiradora para a comunidade.');
      return;
    }
    setIsPosting(true);
    setPostError(null);
    setPostProgress(0);

    try {
      let imageBlob: Blob | null = null;
      if (postImageFile) {
        imageBlob = postImageFile;
      } else if (selectedPresetUrl) {
        try {
          const res = await fetch(selectedPresetUrl);
          imageBlob = await res.blob();
        } catch (fetchErr) {
          console.warn('Preset fetch failed due to CORS or network. Proceeding with text-only post or default.');
        }
      }

      const newPost = await socialService.createPost(
        user.uid,
        user.displayName || 'Atleta',
        user.photoURL,
        imageBlob,
        postCaption,
        150, // XP award
        undefined,
        (p) => setPostProgress(p)
      );

      if (newPost) {
        // Optimistically update local posts state
        setFeedPosts(prev => [newPost, ...prev]);
        triggerXPToast(150, 'MURAL DE SUPERAÇÃO DENTRO!');
        setShowPostModal(false);
        // Reset states
        setPostCaption('');
        setPostImageFile(null);
        setPostImagePreview(null);
        setSelectedPresetUrl(null);
      } else {
        setPostError('Erro ao salvar postagem. Tente novamente.');
      }
    } catch (err: any) {
      console.error('Error creating post:', err);
      setPostError(err.message || 'Falha ao criar postagem.');
    } finally {
      setIsPosting(false);
    }
  };

  useEffect(() => {
    setSeasonInfo(getSeasonStatus());
    eliteChallengeService.getActiveSeason().then(setActiveSeason);

    // Detect wearable connectivity status
    if (auth.currentUser) {
      WearableManager.getInstance().loadConfig().then((cfg) => {
        const isApple = cfg.appleHealthConnected;
        const isAndroid = cfg.healthConnectConnected;
        const isStrava = cfg.stravaConnected;
        
        setIsWatchConnected(isApple || isAndroid || isStrava);
        const providers = [];
        if (isApple) providers.push('Apple HealthKit');
        if (isAndroid) providers.push('Android Health Connect');
        if (isStrava) providers.push('Strava Link');
        setConnectedProviders(providers);
      }).catch(err => {
        console.warn('[Home] Failed to load wearable config:', err);
        const isApple = localStorage.getItem('wearable_conn_apple_health') === 'true';
        const isAndroid = localStorage.getItem('wearable_conn_health_connect') === 'true';
        const isStrava = localStorage.getItem('wearable_conn_strava') === 'true';
        
        setIsWatchConnected(isApple || isAndroid || isStrava);
        const providers = [];
        if (isApple) providers.push('Apple HealthKit');
        if (isAndroid) providers.push('Android Health Connect');
        if (isStrava) providers.push('Strava Link');
        setConnectedProviders(providers);
      });
    } else {
      const isApple = localStorage.getItem('wearable_conn_apple_health') === 'true';
      const isAndroid = localStorage.getItem('wearable_conn_health_connect') === 'true';
      const isStrava = localStorage.getItem('wearable_conn_strava') === 'true';
      
      setIsWatchConnected(isApple || isAndroid || isStrava);
      const providers = [];
      if (isApple) providers.push('Apple HealthKit');
      if (isAndroid) providers.push('Android Health Connect');
      if (isStrava) providers.push('Strava Link');
      setConnectedProviders(providers);
    }
    
    if (user) {
      workoutService.getUserWorkouts(3).then(setRecentActivities).catch(console.error);
      socialService.getPosts([], 'explore').then(res => {
        if (res && res.posts) {
          setFeedPosts(res.posts);
        }
      }).catch(console.error);
      runningService.getMyStats()
        .then(setRunningStats)
        .catch(err => {
          if (err instanceof QuotaExhaustedError) {
            showProInvitation(err.message);
          } else {
            console.error('Home stats error:', err);
          }
        });
    }
  }, [user, showProInvitation]);

  if (!user) return null;

  // Set gym goals and weekly workout details
  const gymWorkoutsThisWeek = recentActivities.filter(w => w.type !== 'cardio').length;
  const weeklyFrequencyGoal = user.weeklyFrequency ? (parseInt(user.weeklyFrequency) || 5) : 5;
  const weeklyProgressPercent = Math.min(100, Math.round((gymWorkoutsThisWeek / weeklyFrequencyGoal) * 100));

  // OMS Goal calculations (for everyone)
  const now = new Date();
  const currentWeekWorkouts = recentActivities.filter(activity => {
    if (!activity.timestamp) return false;
    const activityDate = new Date(activity.timestamp);
    const diffTime = Math.abs(now.getTime() - activityDate.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays <= 7;
  });
  
  const weeklyOMSMins = currentWeekWorkouts.reduce((sum, act) => sum + (act.duration || 0), 0);
  const omsGoalMin = 150;
  const omsGoalOpt = 300;
  const omsPercent = Math.min(100, Math.round((weeklyOMSMins / omsGoalOpt) * 100));
  const isOMSAchieved = weeklyOMSMins >= 150;

  // ICV & Derrete Gordura calculations
  const currentMaxHR = user ? (220 - (user.age || 28)) : 190;
  
  const lastWorkoutWithHR = recentActivities.find(act => (act as any).avgHeartRate);
  const currentBPM = lastWorkoutWithHR ? (lastWorkoutWithHR as any).avgHeartRate : null;

  const workoutsWithHR = recentActivities.filter(act => (act as any).avgHeartRate);
  const avgActiveHR = workoutsWithHR.length > 0 
    ? Math.round(workoutsWithHR.reduce((sum, act) => sum + ((act as any).avgHeartRate || 0), 0) / workoutsWithHR.length) 
    : null;
  
  const icvWeekly = Math.round(
    currentWeekWorkouts.reduce((sum, act) => {
      const hr = (act as any).avgHeartRate;
      if (!hr) return sum;
      return sum + (act.duration || 0) * (hr / currentMaxHR) * 1.5;
    }, 0)
  );
  
  const icvMonthly = icvWeekly > 0 ? Math.round(icvWeekly * 3.8 + (user.totalWorkouts || 0) * 12) : 0;
  const icvRecord = icvMonthly > 0 ? Math.round(icvMonthly * 1.4 + 200) : 0;

  // Calories burned (for Derrete Gordura)
  const currentWeekCalories = currentWeekWorkouts.reduce((sum, act) => {
    return sum + ((act as any).calories || (act.duration || 0) * 8.5);
  }, 0);
  const totalCaloriesEarned = (user.totalWorkouts || 0) > 0 
    ? Math.round((user.totalWorkouts || 0) * 380 + currentWeekCalories) 
    : currentWeekCalories; // season cumulative

  const dgBronze = 3850;
  const dgPrata = 7700;
  const dgOuro = 11550;
  
  let dgLevel: 'Nenhum' | 'Bronze 🥉' | 'Prata 🥈' | 'Ouro 🥇' = 'Nenhum';
  let dgNextTarget = dgBronze;
  let dgPercent = Math.min(100, Math.round((totalCaloriesEarned / dgBronze) * 100));
  
  if (totalCaloriesEarned >= dgOuro) {
    dgLevel = 'Ouro 🥇';
    dgNextTarget = dgOuro;
    dgPercent = 100;
  } else if (totalCaloriesEarned >= dgPrata) {
    dgLevel = 'Prata 🥈';
    dgNextTarget = dgOuro;
    dgPercent = Math.min(100, Math.round((totalCaloriesEarned / dgOuro) * 100));
  } else if (totalCaloriesEarned >= dgBronze) {
    dgLevel = 'Bronze 🥉';
    dgNextTarget = dgPrata;
    dgPercent = Math.min(100, Math.round((totalCaloriesEarned / dgPrata) * 100));
  }

  const isPerformance = user.subscriptionTier === 'performance';

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Bom dia';
    if (hour < 18) return 'Boa tarde';
    return 'Boa noite';
  };

  return (
    <div className="relative min-h-screen bg-background pb-32 px-4 md:px-6 pt-4 max-w-2xl mx-auto space-y-6">

      {/* 1. TOP BAR / USER GREETING & QUICK BADGES */}
      <div className="flex items-center justify-between gap-4 pt-2">
        <div className="flex items-center gap-3">
          <button 
            onClick={() => navigate('/profile')} 
            className="relative group shrink-0 focus:outline-none"
          >
            <div className="w-12 h-12 md:w-14 md:h-14 rounded-2xl overflow-hidden p-0.5 bg-gradient-to-tr from-primary via-emerald-400 to-primary shadow-md">
              <img 
                src={user.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.uid}`} 
                alt="Avatar"
                className="w-full h-full rounded-[14px] object-cover bg-surface-container"
                referrerPolicy="no-referrer"
                onError={(e) => {
                  e.currentTarget.onerror = null;
                  e.currentTarget.src = `https://api.dicebear.com/7.x/avataaars/svg?seed=${user?.uid || 'athlete'}`;
                }}
              />
            </div>
            <div className="absolute -bottom-1 -right-1 bg-black text-primary border border-primary/30 text-[8px] font-black px-1.5 py-0.5 rounded-md leading-none">
              LVL {getLevelFromXP(user.xp || 0)}
            </div>
          </button>

          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-black text-on-surface-variant uppercase tracking-widest">
                {getGreeting()},
              </span>
              {isPerformance && (
                <span className="text-[8px] font-black uppercase px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30">
                  PRO
                </span>
              )}
            </div>
            <h1 className="font-headline italic font-black text-xl md:text-2xl text-on-surface uppercase tracking-tight leading-tight">
              {user.displayName.split(' ')[0]}
            </h1>
          </div>
        </div>

        {/* Streak & Coin Pills */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 bg-amber-500/10 border border-amber-500/20 px-3 py-1.5 rounded-2xl text-amber-400">
            <Flame size={14} className="fill-amber-400 text-amber-400 animate-pulse" />
            <span className="font-headline italic font-black text-xs">{user.streak || 0}d</span>
          </div>
          <div 
            onClick={() => navigate('/wallet')}
            className="flex items-center gap-1 bg-primary/10 border border-primary/20 px-2 py-1.5 rounded-2xl text-primary cursor-pointer active:scale-95 transition-all shrink-0"
            title="Carteira Invictus"
          >
            <DollarSign size={14} className="text-primary font-bold shrink-0" />
            <span className="font-headline italic font-black text-xs whitespace-nowrap">
              {(user.walletBalance || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
        </div>
      </div>

      {/* 2. HERO ACTION: "INICIAR TREINO" */}
      <div className="flex flex-col items-center text-center space-y-4 py-2">
        <div className="w-16 h-16 md:w-20 md:h-20 rounded-full bg-primary text-black flex items-center justify-center shadow-[0_0_25px_rgba(46,204,113,0.4)] animate-pulse">
          <Dumbbell size={32} className="md:w-10 md:h-10" />
        </div>

        <div className="space-y-1">
          <span className="text-[10px] md:text-xs font-black text-primary uppercase tracking-[0.2em] bg-primary/10 border border-primary/20 px-3 py-1 rounded-full">
            TREINO DO DIA
          </span>
          <h2 className="font-headline italic font-black text-3xl md:text-4xl text-white uppercase tracking-tighter pt-1">
            INICIAR TREINO
          </h2>
          <p className="text-xs md:text-sm text-on-surface-variant font-medium max-w-sm mx-auto">
            Musculação ou Cardio
          </p>
        </div>

        <button
          onClick={() => setShowWorkoutModal(true)}
          className="w-full py-4 md:py-5 bg-gradient-to-r from-primary via-emerald-400 to-primary text-black rounded-2xl font-headline italic font-black text-lg md:text-xl uppercase tracking-wider shadow-[0_10px_30px_rgba(46,204,113,0.3)] hover:scale-[1.02] active:scale-98 transition-all flex items-center justify-center gap-3 cursor-pointer"
        >
          <Play size={22} fill="currentColor" />
          <span>TREINAR AGORA</span>
        </button>
      </div>

      {/* 3. DESAFIOS DE HOJE (3 DISPONÍVEIS + VER TODOS) */}
      <div className="bg-surface-container-low border border-outline-variant/10 rounded-[28px] p-5 space-y-3 shadow-lg">
        <div className="flex items-center justify-between border-b border-white/5 pb-2.5">
          <div className="flex items-center gap-2">
            <Check size={16} className="text-primary" />
            <h3 className="font-headline italic font-black text-sm text-white uppercase tracking-tight">DESAFIOS DE HOJE</h3>
          </div>
          <span className="text-[9px] font-black text-primary bg-primary/10 px-2 py-0.5 rounded-full border border-primary/20 uppercase tracking-widest">3 DISPONÍVEIS</span>
        </div>

        <div className="space-y-2">
          {/* Missão Treino */}
          <div 
            onClick={() => navigate('/challenges?type=workout')}
            className="p-3.5 bg-surface-container/60 hover:bg-surface-container rounded-2xl border border-white/5 flex items-center justify-between cursor-pointer transition-all active:scale-98"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <Dumbbell size={20} />
              </div>
              <div>
                <h4 className="font-headline italic font-black text-sm text-white uppercase tracking-tight">TREINO DE MUSCULAÇÃO</h4>
                <p className="text-[10px] text-on-surface-variant font-medium">Check-in na academia e validação de presença</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[9px] font-black text-primary bg-primary/10 px-2 py-1 rounded-lg border border-primary/20">+100 XP</span>
              <ChevronRight size={16} className="text-on-surface-variant" />
            </div>
          </div>

          {/* Missão Cardio */}
          <div 
            onClick={() => navigate('/challenges?type=cardio')}
            className="p-3.5 bg-surface-container/60 hover:bg-surface-container rounded-2xl border border-white/5 flex items-center justify-between cursor-pointer transition-all active:scale-98"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-400 flex items-center justify-center shrink-0">
                <TrendingUp size={20} />
              </div>
              <div>
                <h4 className="font-headline italic font-black text-sm text-white uppercase tracking-tight">CARDIO AERÓBICO</h4>
                <p className="text-[10px] text-on-surface-variant font-medium">Corrida ou caminhada ao ar livre via GPS</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[9px] font-black text-amber-400 bg-amber-400/10 px-2 py-1 rounded-lg border border-amber-400/20">+80 XP</span>
              <ChevronRight size={16} className="text-on-surface-variant" />
            </div>
          </div>

        </div>

        {/* Botão Ver Todos */}
        <button
          type="button"
          onClick={() => navigate('/challenges')}
          className="w-full py-3 bg-surface-container-high hover:bg-surface-container-highest text-primary border border-primary/20 rounded-2xl font-headline italic font-black text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2 active:scale-98"
        >
          <span>VER TODOS OS DESAFIOS</span>
          <ArrowRight size={14} />
        </button>
      </div>

      {/* 4. PRÓXIMA TEMPORADA (COMPACT CARD) */}
      <div 
        onClick={() => navigate('/rankings')}
        className="bg-surface-container-low border border-outline-variant/10 hover:border-primary/30 rounded-[28px] p-4 flex items-center justify-between cursor-pointer transition-all active:scale-98"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-tertiary/10 text-tertiary flex items-center justify-center shrink-0">
            <Trophy size={20} />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-[8px] font-black uppercase text-tertiary tracking-widest bg-tertiary/10 px-1.5 py-0.5 rounded">LIGA INVICTUS</span>
              <span className="text-[8px] font-black uppercase text-white font-mono">{countdown.time.days}d {countdown.time.hours}h restantes</span>
            </div>
            <h4 className="font-headline italic font-black text-sm text-white uppercase tracking-tight">PRÓXIMA TEMPORADA DE PREMIAÇÃO</h4>
          </div>
        </div>
        <ChevronRight size={18} className="text-on-surface-variant" />
      </div>

      {/* 5. SINCRONIZAÇÃO PENDENTE (INDICADOR DISCRETO - APENAS SE HOUVER PENDÊNCIA) */}
      {localStorage.getItem('pending_offline_workouts') && (
        <div 
          onClick={() => navigate('/settings?tab=integrations')}
          className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-3 flex items-center justify-between cursor-pointer active:scale-98 transition-all"
        >
          <div className="flex items-center gap-2.5">
            <RefreshCw size={16} className="text-amber-400 animate-spin shrink-0" />
            <span className="text-xs font-bold text-amber-400 uppercase tracking-tight">
              Sincronização pendente
            </span>
          </div>
          <span className="text-[10px] font-black uppercase tracking-widest text-white/70">
            Resolver →
          </span>
        </div>
      )}

      {/* WORKOUT SELECTION MODAL */}
      <AnimatePresence>
        {showWorkoutModal && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/80 backdrop-blur-md">
            <motion.div 
              initial={{ opacity: 0, y: 100 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 100 }}
              className="w-full max-w-md bg-surface-container-low border border-white/10 rounded-[32px] p-6 space-y-5 shadow-2xl relative"
            >
              <button 
                onClick={() => setShowWorkoutModal(false)}
                className="absolute top-5 right-5 p-2 text-on-surface-variant hover:text-white rounded-full bg-white/5"
              >
                <X size={20} />
              </button>

              <div className="space-y-1 text-center pt-2">
                <span className="text-[9px] font-black uppercase text-primary tracking-[0.2em]">INVICTUS WORKOUT ENGINE</span>
                <h3 className="font-headline italic font-black text-2xl text-white uppercase tracking-tight">QUAL SEU TREINO DE HOJE?</h3>
              </div>

              <div className="space-y-3 pt-2">
                {/* Option Musculação */}
                <button 
                  onClick={() => {
                    setShowWorkoutModal(false);
                    navigate('/challenges?type=workout');
                  }}
                  className="w-full p-4 bg-surface-container hover:bg-surface-container-high border border-white/10 rounded-2xl flex items-center justify-between transition-all group active:scale-98 cursor-pointer"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-primary text-black flex items-center justify-center shrink-0 shadow-md">
                      <Dumbbell size={24} />
                    </div>
                    <div className="text-left">
                      <h4 className="font-headline italic font-black text-base text-white uppercase tracking-tight">MUSCULAÇÃO</h4>
                      <p className="text-[10px] text-on-surface-variant font-medium">Com validação de presença na academia</p>
                    </div>
                  </div>
                  <ChevronRight size={20} className="text-on-surface-variant group-hover:text-primary transition-colors" />
                </button>

                {/* Option Cardio */}
                <button 
                  onClick={() => {
                    setShowWorkoutModal(false);
                    navigate('/challenges?type=cardio');
                  }}
                  className="w-full p-4 bg-surface-container hover:bg-surface-container-high border border-white/10 rounded-2xl flex items-center justify-between transition-all group active:scale-98 cursor-pointer"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-amber-500 text-black flex items-center justify-center shrink-0 shadow-md">
                      <TrendingUp size={24} />
                    </div>
                    <div className="text-left">
                      <h4 className="font-headline italic font-black text-base text-white uppercase tracking-tight">CARDIO AERÓBICO</h4>
                      <p className="text-[10px] text-on-surface-variant font-medium">Corrida ou caminhada ao ar livre via GPS</p>
                    </div>
                  </div>
                  <ChevronRight size={20} className="text-on-surface-variant group-hover:text-amber-400 transition-colors" />
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showProfileShare && user && (
          <ProfileShareCard 
            user={user}
            onClose={() => setShowProfileShare(false)}
          />
        )}
      </AnimatePresence>

    </div>
  );
}
