import React, { useState, useEffect, useRef } from 'react';
import { 
  Trophy, Award, Star, Zap, Users, TrendingUp, Share2, X, CheckCircle, 
  Flame, Heart, Target, ChevronRight, Download, Sparkles, Crown, 
  Volume2, Activity, Play, Check 
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { auth, db } from '../firebase';
import { doc, updateDoc, arrayUnion, increment } from 'firebase/firestore';
import { UserProfile, Achievement, Workout } from '../types';
import { ACHIEVEMENTS } from '../achievements';
import { cn } from '../lib/utils';
import { useUser } from '../UserContext';
import { workoutService } from '../services/workoutService';
import { toPng } from 'html-to-image';
import confetti from 'canvas-confetti';

const CATEGORIES = [
  { id: 'all', label: 'TODAS', icon: <Trophy size={14} /> },
  { id: 'frequency', label: 'FREQUÊNCIA', icon: <Zap size={14} /> },
  { id: 'ranking', label: 'RANKING', icon: <Star size={14} /> },
  { id: 'performance', label: 'PERFORMANCE', icon: <Award size={14} /> },
  { id: 'social', label: 'SOCIAL', icon: <Users size={14} /> },
];

export function Achievements() {
  const { user, refreshUser } = useUser();
  const [activeCategory, setActiveCategory] = useState('all');
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [loadingWorkouts, setLoadingWorkouts] = useState(true);
  const [selectedShareCard, setSelectedShareCard] = useState<{
    type: 'derrete_gordura' | 'cardio' | 'oms';
    level: string;
    valueText: string;
    medalEmoji: string;
  } | null>(null);

  const [isGenerating, setIsGenerating] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(true);

  // Card element refs for exporting high-res images
  const dgCardRef = useRef<HTMLDivElement>(null);
  const cardioCardRef = useRef<HTMLDivElement>(null);
  const omsCardRef = useRef<HTMLDivElement>(null);

  // Play achievement sound synthesized with Web Audio API
  const playAchievementSound = () => {
    if (!audioEnabled) return;
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const now = ctx.currentTime;
      
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1400, now);
      filter.connect(ctx.destination);

      // Chime sequence (C5 -> E5 -> G5 -> C6)
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(523.25, now);
      osc.frequency.setValueAtTime(659.25, now + 0.12);
      osc.frequency.setValueAtTime(783.99, now + 0.24);
      osc.frequency.setValueAtTime(1046.50, now + 0.36);
      
      const gainSetting = ctx.createGain();
      gainSetting.gain.setValueAtTime(0.12, now);
      gainSetting.gain.exponentialRampToValueAtTime(0.001, now + 1.2);
      
      osc.connect(gainSetting);
      gainSetting.connect(filter);
      
      osc.start(now);
      osc.stop(now + 1.2);
    } catch (e) {
      console.warn('Web Audio Playback failed:', e);
    }
  };

  // Fetch recent workouts to calculate high-fidelity personal biometrics
  useEffect(() => {
    if (user) {
      setLoadingWorkouts(true);
      workoutService.getUserWorkouts(50)
        .then(setWorkouts)
        .catch(console.error)
        .finally(() => setLoadingWorkouts(false));
    }
  }, [user]);

  if (!user) return null;

  // Filter workouts inside the current week
  const currentWeekWorkouts = workouts.filter(w => {
    if (!w.timestamp) return false;
    const wDate = new Date(w.timestamp);
    const diffTime = Math.abs(new Date().getTime() - wDate.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays <= 7;
  });

  // Calculate high-fidelity metrics mirroring Home.tsx exactly
  const weeklyOMSMins = currentWeekWorkouts.reduce((sum, act) => sum + (act.duration || 0), 0);
  const currentWeekCalories = currentWeekWorkouts.reduce((sum, act) => {
    return sum + ((act as any).calories || (act.duration || 0) * 8.5);
  }, 0);

  const totalCaloriesEarned = Math.round((user.totalWorkouts || 0) * 380 + currentWeekCalories);

  // 1. Desafio Derrete Gordura
  const dgBronze = 3850;
  const dgPrata = 7700;
  const dgOuro = 11550;
  let dgLevel: 'Nenhum' | 'Bronze' | 'Prata' | 'Ouro' = 'Nenhum';
  let dgEmoji = '🔥';
  let dgNextTarget = dgBronze;
  let dgPercent = Math.min(100, Math.round((totalCaloriesEarned / dgBronze) * 100));

  if (totalCaloriesEarned >= dgOuro) {
    dgLevel = 'Ouro';
    dgEmoji = '🥇';
    dgNextTarget = dgOuro;
    dgPercent = 100;
  } else if (totalCaloriesEarned >= dgPrata) {
    dgLevel = 'Prata';
    dgEmoji = '🥈';
    dgNextTarget = dgOuro;
    dgPercent = Math.min(100, Math.round((totalCaloriesEarned / dgOuro) * 100));
  } else if (totalCaloriesEarned >= dgBronze) {
    dgLevel = 'Bronze';
    dgEmoji = '🥉';
    dgNextTarget = dgPrata;
    dgPercent = Math.min(100, Math.round((totalCaloriesEarned / dgPrata) * 100));
  }

  // 2. Elite Cardiovascular calculations mirroring Home.tsx
  const currentMaxHR = 220 - (user.age || 28);
  const icvWeekly = Math.round(
    currentWeekWorkouts.reduce((sum, act) => {
      const hr = Number((act as any).avgHeartRate) || 0;
      const intensityFactor = hr > 0 ? (hr / currentMaxHR) * 1.5 : 0.8;
      return sum + (act.duration || 0) * intensityFactor;
    }, 0)
  );
  const icvMonthly = Math.round(icvWeekly * 3.8 + (user.totalWorkouts || 5) * 12);
  const icvRecord = Math.max(750, Math.round(icvMonthly * 1.4 + 200));

  // Determine Elite Cardiovascular levels based on icvRecord
  let cvLevel: 'Nenhum' | 'Bronze' | 'Prata' | 'Ouro' | 'Diamante' = 'Nenhum';
  let cvEmoji = '❤️';
  let cvNextTarget = 1000;
  let cvPercent = Math.min(100, Math.round((icvRecord / 1000) * 100));

  if (icvRecord >= 2500) {
    cvLevel = 'Diamante';
    cvEmoji = '💎';
    cvNextTarget = 2500;
    cvPercent = 100;
  } else if (icvRecord >= 1800) {
    cvLevel = 'Ouro';
    cvEmoji = '🥇';
    cvNextTarget = 2500;
    cvPercent = Math.min(100, Math.round((icvRecord / 2500) * 100));
  } else if (icvRecord >= 1200) {
    cvLevel = 'Prata';
    cvEmoji = '🥈';
    cvNextTarget = 1800;
    cvPercent = Math.min(100, Math.round((icvRecord / 1800) * 100));
  } else if (icvRecord >= 750) {
    cvLevel = 'Bronze';
    cvEmoji = '🥉';
    cvNextTarget = 1200;
    cvPercent = Math.min(100, Math.round((icvRecord / 1200) * 100));
  }

  // 3. Meta OMS calculations
  const omsGoalMin = 150;
  const omsGoalOpt = 300;
  let omsStatus: 'Pendente' | 'Bronze' | 'Ouro' = 'Pendente';
  let omsEmoji = '🎯';
  let omsNextTarget = omsGoalMin;
  let omsPercent = Math.min(100, Math.round((weeklyOMSMins / omsGoalMin) * 100));

  if (weeklyOMSMins >= omsGoalOpt) {
    omsStatus = 'Ouro';
    omsEmoji = '🥇';
    omsNextTarget = omsGoalOpt;
    omsPercent = 100;
  } else if (weeklyOMSMins >= omsGoalMin) {
    omsStatus = 'Bronze';
    omsEmoji = '🥉';
    omsNextTarget = omsGoalOpt;
    omsPercent = Math.min(100, Math.round((weeklyOMSMins / omsGoalOpt) * 100));
  }

  // Auto-sync milestones to Firestore achievement log permanently
  const syncPersonalAchievements = async () => {
    const toUnlock: string[] = [];
    
    if (dgLevel === 'Ouro') toUnlock.push('dg_golden', 'dg_silver', 'dg_bronze');
    else if (dgLevel === 'Prata') toUnlock.push('dg_silver', 'dg_bronze');
    else if (dgLevel === 'Bronze') toUnlock.push('dg_bronze');

    if (cvLevel === 'Diamante') toUnlock.push('cv_diamond', 'cv_golden', 'cv_silver', 'cv_bronze');
    else if (cvLevel === 'Ouro') toUnlock.push('cv_golden', 'cv_silver', 'cv_bronze');
    else if (cvLevel === 'Prata') toUnlock.push('cv_silver', 'cv_bronze');
    else if (cvLevel === 'Bronze') toUnlock.push('cv_bronze');

    if (omsStatus === 'Ouro') toUnlock.push('oms_golden', 'oms_bronze');
    else if (omsStatus === 'Bronze') toUnlock.push('oms_bronze');

    const newToAward = toUnlock.filter(id => !user.achievements?.includes(id));
    if (newToAward.length > 0) {
      const userRef = doc(db, 'users', user.uid);
      try {
        await updateDoc(userRef, {
          achievements: arrayUnion(...newToAward),
          score: increment(newToAward.length * 50) // Grant 50 XP per milestone
        });
        await refreshUser();
        
        // Sensory feedback
        playAchievementSound();
        confetti({ particleCount: 160, spread: 90, origin: { y: 0.6 } });
        if (navigator.vibrate) navigator.vibrate([120, 60, 120]);
      } catch (err) {
        console.error('Error auto-syncing personal achievements:', err);
      }
    }
  };

  // Perform auto-sync on workout update
  useEffect(() => {
    if (user && workouts.length > 0) {
      syncPersonalAchievements();
    }
  }, [workouts, user]);

  // Standard category display
  const filteredAchievements = ACHIEVEMENTS.filter(a => 
    activeCategory === 'all' || a.category === activeCategory
  );

  const unlockedCount = user.achievements?.length || 0;
  const progressPercent = Math.round((unlockedCount / (ACHIEVEMENTS.length + 9)) * 100);

  // Manual trigger for a rewarding mock visual check
  const triggerCelebrationDemo = () => {
    playAchievementSound();
    confetti({
      particleCount: 200,
      spread: 100,
      colors: ['#eab308', '#2ecc71', '#ff5722', '#ffffff'],
      origin: { y: 0.6 }
    });
    if (navigator.vibrate) {
      navigator.vibrate([100, 50, 100, 50, 150]);
    }
  };

  // Handles exporting designated Share Card (PNG)
  const handleExportPNG = async () => {
    let targetElement: HTMLDivElement | null = null;
    if (selectedShareCard?.type === 'derrete_gordura') targetElement = dgCardRef.current;
    if (selectedShareCard?.type === 'cardio') targetElement = cardioCardRef.current;
    if (selectedShareCard?.type === 'oms') targetElement = omsCardRef.current;

    if (!targetElement) return;
    setIsGenerating(true);

    try {
      // Force waiting state for full render
      await new Promise(resolve => setTimeout(resolve, 500));
      const dataUrl = await toPng(targetElement, {
        canvasWidth: 1080,
        canvasHeight: 1920,
        pixelRatio: 2,
        style: {
          transform: 'scale(1)',
          left: '0',
          top: '0'
        }
      });

      const link = document.createElement('a');
      link.download = `invictus-conquista-${selectedShareCard.type}.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error('Failed to export achievement card image:', err);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="pb-32 min-h-screen bg-background">
      <div className="max-w-screen-md mx-auto">
        
        {/* Header Section */}
        <header className="px-4 pt-10 pb-6 space-y-6">
          <div className="flex justify-between items-start">
            <div className="flex flex-col gap-1">
              <span className="font-label text-primary text-[10px] font-black tracking-[0.3em] uppercase">SISTEMA CIENTÍFICO</span>
              <h1 className="font-headline italic font-black text-4xl uppercase tracking-tighter text-white">CONQUISTAS INVICTUS</h1>
            </div>
            
            {/* Audio Toggle button */}
            <button 
              onClick={() => {
                setAudioEnabled(!audioEnabled);
                triggerCelebrationDemo();
              }}
              className={cn(
                "p-3 rounded-2xl border transition-all flex items-center justify-center gap-1.5 cursor-pointer active:scale-95",
                audioEnabled 
                  ? "bg-primary/10 border-primary/20 text-primary" 
                  : "bg-surface-container border-white/5 text-on-surface-variant opacity-50"
              )}
              title="Testar áudio e efeitos"
            >
              <Volume2 size={16} />
              <span className="text-[9px] font-black tracking-wider uppercase">{audioEnabled ? 'Efeitos LIGADO' : 'MUDO'}</span>
            </button>
          </div>

          {/* Core Level Track / Summary */}
          <div className="bg-surface-container-low p-6 rounded-[28px] border border-outline-variant/15 space-y-4 shadow-xl">
            <div className="flex justify-between items-end">
              <div className="space-y-1">
                <span className="font-label text-[9px] font-black text-on-surface-variant uppercase tracking-widest">DESBLOQUEIOS REALIZADOS</span>
                <p className="text-[10px] text-on-surface-variant/70 uppercase font-semibold">SUA EVOLUÇÃO PESSOAL NA TEMPORADA</p>
              </div>
              <div className="text-right">
                <span className="font-headline italic font-black text-3xl text-primary">{unlockedCount}</span>
                <span className="font-label text-xs font-black text-on-surface-variant/40 block leading-none">TOTAL OBTIDO</span>
              </div>
            </div>
            <div className="h-4 w-full bg-surface-container-highest rounded-full overflow-hidden p-0.5 shadow-inner">
              <motion.div 
                initial={{ width: 0 }}
                animate={{ width: `${Math.max(8, progressPercent)}%` }}
                className="h-full bg-gradient-to-r from-amber-500 via-primary to-orange-600 rounded-full shadow-[0_0_15px_rgba(46,204,113,0.4)]"
              />
            </div>
          </div>
        </header>

        {/* 🏆 CONQUISTAS CIENTÍFICAS DE ALTA PERFORMANCE */}
        <section className="px-4 space-y-6 mb-12">
          <div className="flex items-center gap-2 px-1">
            <Sparkles size={16} className="text-primary animate-pulse" />
            <h2 className="text-xs font-black text-white uppercase tracking-[0.2em] font-headline italic">CONQUISTAS DE CATEGORIA DE ELITE</h2>
          </div>

          {/* CARD 1: DESAFIO DERRETE GORDURA */}
          <div className="bg-surface-container-low border border-outline-variant/10 rounded-[32px] p-6 space-y-5 relative overflow-hidden shadow-xl">
            {/* Glowing amber accent line */}
            <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-amber-500 via-primary to-orange-500" />
            
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-amber-500/20 to-orange-500/10 flex items-center justify-center text-orange-500 border border-orange-500/20 shadow-lg">
                  <Flame size={24} className="fill-current animate-pulse" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-sans text-[8px] font-black text-yellow-500 uppercase tracking-widest bg-yellow-500/10 border border-yellow-500/20 px-2 py-0.5 rounded-md">BIOLÓGICO</span>
                    {dgLevel !== 'Nenhum' && (
                      <span className="text-[8px] font-black text-white bg-green-500/20 border border-green-500/30 px-2 py-0.5 rounded-md uppercase">NÍVEL {dgLevel.toUpperCase()}</span>
                    )}
                  </div>
                  <h3 className="font-headline italic font-black text-xl text-white uppercase tracking-tight mt-1">DESAFIO DERRETE GORDURA</h3>
                </div>
              </div>
              <div className="text-right">
                <span className="text-3xl font-black text-white font-headline text-orange-500">{dgEmoji}</span>
              </div>
            </div>

            <p className="text-[11px] text-on-surface-variant uppercase font-semibold leading-relaxed">
              Estimular a prática contínua de redução do tecido adiposo através de gasto calórico sequencial acumulado.
            </p>

            <div className="bg-background/40 border border-white/5 p-4 rounded-2xl space-y-3">
              <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-wider text-on-surface-variant">
                <span>CONQUISTA ATUAL CONCLUÍDA</span>
                <span className="text-white font-mono">{totalCaloriesEarned.toLocaleString('pt-BR')} / {dgNextTarget.toLocaleString('pt-BR')} kcal</span>
              </div>
              
              {/* Linear milestone tracker */}
              <div className="relative">
                <div className="h-3 w-full bg-surface-container-highest rounded-full overflow-hidden p-0.5">
                  <div className="h-full rounded-full bg-gradient-to-r from-amber-500 to-orange-600" style={{ width: `${dgPercent}%` }} />
                </div>
                <div className="flex justify-between mt-2.5 text-[8px] font-black uppercase tracking-widest text-on-surface-variant/50">
                  <span className={cn(totalCaloriesEarned >= dgBronze ? "text-amber-500" : "")}>BRONZE (3.8k)</span>
                  <span className={cn(totalCaloriesEarned >= dgPrata ? "text-slate-400" : "")}>PRATA (7.7k)</span>
                  <span className={cn(totalCaloriesEarned >= dgOuro ? "text-yellow-400 font-bold" : "")}>OURO (11.5k)</span>
                </div>
              </div>
            </div>

            <div className="flex gap-3 pt-1">
              <button 
                disabled={dgLevel === 'Nenhum'}
                onClick={() => setSelectedShareCard({
                  type: 'derrete_gordura',
                  level: dgLevel,
                  valueText: `${totalCaloriesEarned.toLocaleString('pt-BR')} KCAL ACUMULADAS`,
                  medalEmoji: dgEmoji
                })}
                className={cn(
                  "flex-1 h-12 rounded-xl font-headline italic font-black text-xs uppercase tracking-widest transition-all flex items-center justify-center gap-2",
                  dgLevel !== 'Nenhum'
                    ? "bg-gradient-to-r from-amber-500 via-primary to-orange-600 text-white shadow-lg border border-yellow-400/20 hover:scale-[1.02] cursor-pointer"
                    : "bg-surface-container-highest text-on-surface-variant/40 border border-white/5 cursor-not-allowed"
                )}
              >
                <Share2 size={13} fill="currentColor" />
                Compartilhar Conquista
              </button>
            </div>
            
            {dgLevel === 'Nenhum' && (
              <p className="text-[8.5px] text-on-surface-variant/60 uppercase font-black tracking-widest text-center mt-1">
                Faltam {(dgBronze - totalCaloriesEarned).toLocaleString('pt-BR')} Kcal para atingir a Medalha Bronze 🥉
              </p>
            )}
          </div>

          {/* CARD 2: ELITE CARDIOVASCULAR */}
          <div className="bg-surface-container-low border border-outline-variant/10 rounded-[32px] p-6 space-y-5 relative overflow-hidden shadow-xl">
            {/* Glowing violet accent line */}
            <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-rose-500 via-violet-500 to-indigo-500" />

            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-rose-500/20 to-purple-500/10 flex items-center justify-center text-rose-500 border border-rose-500/20 shadow-lg">
                  <Heart size={24} className="fill-current animate-pulse" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-sans text-[8px] font-black text-rose-500 uppercase tracking-widest bg-rose-500/10 border border-rose-500/20 px-2 py-0.5 rounded-md">CARDIO</span>
                    {cvLevel !== 'Nenhum' && (
                      <span className="text-[8px] font-black text-white bg-purple-500/20 border border-purple-500/30 px-2 py-0.5 rounded-md uppercase">NÍVEL {cvLevel.toUpperCase()}</span>
                    )}
                  </div>
                  <h3 className="font-headline italic font-black text-xl text-white uppercase tracking-tight mt-1">ELITE CARDIOVASCULAR</h3>
                </div>
              </div>
              <div className="text-right">
                <span className="text-3xl font-black text-white font-headline text-rose-500">{cvEmoji}</span>
              </div>
            </div>

            <p className="text-[11px] text-on-surface-variant uppercase font-semibold leading-relaxed">
              Valorização da qualidade e saúde do tecido cardíaco através do monitoramento contínuo do ICV (Índice Cardiovascular).
            </p>

            {/* Grid display for heart evolution */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-background/40 border border-white/5 p-3 rounded-xl">
                <span className="text-[8px] font-black text-on-surface-variant/65 uppercase tracking-wider block">ICV DA SEMANA</span>
                <span className="font-headline italic font-black text-lg text-white mt-0.5 block">{icvWeekly.toLocaleString('pt-BR')} ICP</span>
              </div>
              <div className="bg-background/40 border border-white/5 p-3 rounded-xl text-right">
                <span className="text-[8px] font-black text-on-surface-variant/65 uppercase tracking-wider block">MELHOR ICV HISTÓRICO</span>
                <span className="font-headline italic font-black text-lg text-primary mt-0.5 block">{icvRecord.toLocaleString('pt-BR')} ICP</span>
              </div>
            </div>

            <div className="bg-background/40 border border-white/5 p-4 rounded-2xl space-y-3">
              {/* Evolução indicators */}
              <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-wider text-on-surface-variant">
                <span>PROGRESSO PARA PRÓXIMO NÍVEL</span>
                <span className="text-white font-mono">{icvRecord.toLocaleString('pt-BR')} / {cvNextTarget.toLocaleString('pt-BR')} ICV</span>
              </div>

              {/* Progress bar */}
              <div className="relative">
                <div className="h-3 w-full bg-surface-container-highest rounded-full overflow-hidden p-0.5">
                  <div className="h-full rounded-full bg-gradient-to-r from-rose-500 to-indigo-500" style={{ width: `${cvPercent}%` }} />
                </div>
                <div className="flex justify-between mt-2.5 text-[8px] font-black uppercase tracking-widest text-on-surface-variant/50">
                  <span className={cn(icvRecord >= 750 ? "text-amber-500" : "")}>BRONZE (750)</span>
                  <span className={cn(icvRecord >= 1200 ? "text-slate-400" : "")}>PRATA (1.2k)</span>
                  <span className={cn(icvRecord >= 1800 ? "text-yellow-400" : "")}>OURO (1.8k)</span>
                  <span className={cn(icvRecord >= 2500 ? "text-blue-400 font-bold" : "")}>DIAMANTE (2.5k)</span>
                </div>
              </div>
            </div>

            <div className="flex gap-3 pt-1">
              <button 
                disabled={cvLevel === 'Nenhum'}
                onClick={() => setSelectedShareCard({
                  type: 'cardio',
                  level: cvLevel,
                  valueText: `MELHOR ICV: ${icvRecord} RECORDE`,
                  medalEmoji: cvEmoji
                })}
                className={cn(
                  "flex-1 h-12 rounded-xl font-headline italic font-black text-xs uppercase tracking-widest transition-all flex items-center justify-center gap-2",
                  cvLevel !== 'Nenhum'
                    ? "bg-gradient-to-r from-rose-500 via-indigo-600 to-purple-600 text-white shadow-lg border border-purple-400/20 hover:scale-[1.02] cursor-pointer"
                    : "bg-surface-container-highest text-on-surface-variant/40 border border-white/5 cursor-not-allowed"
                )}
              >
                <Share2 size={13} fill="currentColor" />
                Compartilhar Conquista
              </button>
            </div>
            
            {cvLevel === 'Nenhum' && (
              <p className="text-[8.5px] text-on-surface-variant/60 uppercase font-black tracking-widest text-center mt-1">
                Faltam {(750 - icvRecord).toLocaleString('pt-BR')} pontos de ICV para atingir a Medalha Bronze 🥉
              </p>
            )}
          </div>

          {/* CARD 3: META OMS (ORGANIZAÇÃO MUNDIAL DA SAÚDE) */}
          <div className="bg-surface-container-low border border-outline-variant/10 rounded-[32px] p-6 space-y-5 relative overflow-hidden shadow-xl">
            {/* Glowing teal accent line */}
            <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-teal-500 via-cyan-500 to-emerald-500" />

            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-teal-500/20 to-emerald-500/10 flex items-center justify-center text-teal-400 border border-teal-500/20 shadow-lg">
                  <Target size={24} className="animate-spin-slow" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-sans text-[8px] font-black text-teal-400 uppercase tracking-widest bg-teal-400/10 border border-teal-400/20 px-2 py-0.5 rounded-md">DIRETRIZ MUNDIAL</span>
                    {omsStatus !== 'Pendente' && (
                      <span className="text-[8px] font-black text-white bg-green-500/20 border border-green-500/30 px-2 py-0.5 rounded-md uppercase">MEDALHA {omsStatus.toUpperCase()} OBTIDA</span>
                    )}
                  </div>
                  <h3 className="font-headline italic font-black text-xl text-white uppercase tracking-tight mt-1">META OMS (DIRETRIZ DA SAÚDE)</h3>
                </div>
              </div>
              <div className="text-right">
                <span className="text-3xl font-black text-white font-headline text-teal-400">{omsEmoji}</span>
              </div>
            </div>

            <p className="text-[11px] text-on-surface-variant uppercase font-semibold leading-relaxed">
              Incentivar hábitos consistentes focados nos níveis recomendados da OMS: 150 min (mínimo) ou 300 min (excelência cardiovascular) semanais.
            </p>

            <div className="bg-background/40 border border-white/5 p-4 rounded-2xl space-y-3">
              <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-wider text-on-surface-variant">
                <span>MINUTOS ACUMULADOS NA SEMANA</span>
                <span className="text-white font-mono">{weeklyOMSMins} / {omsNextTarget} min</span>
              </div>

              {/* Progress bar */}
              <div className="relative">
                <div className="h-3 w-full bg-surface-container-highest rounded-full overflow-hidden p-0.5">
                  <div className="h-full rounded-full bg-gradient-to-r from-teal-500 to-emerald-500" style={{ width: `${omsPercent}%` }} />
                </div>
                <div className="flex justify-between mt-2 text-[8px] font-black uppercase tracking-widest text-on-surface-variant/50">
                  <span className={cn(weeklyOMSMins >= 150 ? "text-teal-400 font-bold" : "")}>Bronze Mínimo (150 min)</span>
                  <span className={cn(weeklyOMSMins >= 300 ? "text-yellow-400 font-bold" : "")}>Ouro Ideal (300 min)</span>
                </div>
              </div>
            </div>

            <div className="flex gap-3 pt-1">
              <button 
                disabled={omsStatus === 'Pendente'}
                onClick={() => setSelectedShareCard({
                  type: 'oms',
                  level: omsStatus,
                  valueText: `${weeklyOMSMins} MINUTOS DE ATIVIDADE FÍSICA`,
                  medalEmoji: omsEmoji
                })}
                className={cn(
                  "flex-1 h-12 rounded-xl font-headline italic font-black text-xs uppercase tracking-widest transition-all flex items-center justify-center gap-2",
                  omsStatus !== 'Pendente'
                    ? "bg-gradient-to-r from-teal-500 via-emerald-600 to-green-600 text-white shadow-lg border border-emerald-400/20 hover:scale-[1.02] cursor-pointer"
                    : "bg-surface-container-highest text-on-surface-variant/40 border border-white/5 cursor-not-allowed"
                )}
              >
                <Share2 size={13} fill="currentColor" />
                Compartilhar Conquista
              </button>
            </div>

            {omsStatus === 'Pendente' && (
              <p className="text-[8.5px] text-on-surface-variant/60 uppercase font-black tracking-widest text-center mt-1">
                Faltam {150 - weeklyOMSMins} minutos para atingir a Meta Mínima da OMS e liberar a Medalha 🥉
              </p>
            )}
          </div>
        </section>

        {/* Categories / Standard accomplishments */}
        <section className="px-4 space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Trophy size={16} className="text-yellow-500" />
              <h2 className="text-xs font-black text-white uppercase tracking-[0.2em] font-headline italic">GALERIA DE COLECIONÁVEIS</h2>
            </div>
            <span className="text-[10px] font-bold text-on-surface-variant/50 uppercase">CLASSIQUE</span>
          </div>

          {/* Tab switches */}
          <div className="flex flex-wrap gap-2 mb-4 overflow-x-auto pb-1">
            {CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(cat.id)}
                className={cn(
                  "flex items-center gap-2 px-4 py-2.5 rounded-xl font-label text-[10px] font-black tracking-wider uppercase transition-all whitespace-nowrap border cursor-pointer",
                  activeCategory === cat.id
                    ? "bg-primary text-black border-primary font-black"
                    : "bg-surface-container text-on-surface-variant/70 border-white/5 hover:border-white/15"
                )}
              >
                {cat.icon}
                {cat.label}
              </button>
            ))}
          </div>

          {/* Grid display */}
          <div className="grid grid-cols-2 gap-4">
            {filteredAchievements.map((ach) => {
              const isUnlocked = user.achievements?.includes(ach.id);
              return (
                <div 
                  key={ach.id}
                  className={cn(
                    "p-5 rounded-3xl border transition-all flex items-start gap-4 shadow-md",
                    isUnlocked 
                      ? "bg-surface-container-low border-primary/20" 
                      : "bg-surface-container-low/40 border-white/5 opacity-50 grayscale"
                  )}
                >
                  <div className={cn(
                    "w-12 h-12 rounded-2xl flex items-center justify-center text-3xl shrink-0 shadow-inner",
                    isUnlocked ? "bg-primary/10 border border-primary/15" : "bg-surface-container border-white/5"
                  )}>
                    {ach.icon}
                  </div>
                  <div>
                    <h4 className="font-headline italic font-black text-sm uppercase tracking-tight text-white leading-tight">
                      {ach.name}
                    </h4>
                    <p className="text-[10px] text-on-surface-variant/70 mt-1 uppercase font-semibold leading-relaxed">
                      {ach.description}
                    </p>
                    <div className="mt-2.5 flex items-center gap-1.5">
                      <span className="text-[8px] font-mono font-black text-primary bg-primary/10 border border-primary/20 px-1.5 py-0.5 rounded uppercase">+{ach.points} XP</span>
                      {isUnlocked ? (
                        <span className="text-[8px] font-black text-green-400 uppercase tracking-widest flex items-center gap-0.5 font-mono">
                          <Check size={8} strokeWidth={4} /> OBTIDO
                        </span>
                      ) : (
                        <span className="text-[8px] tracking-wider text-on-surface-variant/40 uppercase font-bold font-mono">BLOQUEADO</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {/* REVOLUTIONARY SHARE OVERLAY CARD SPEC (stories sizes fully custom compiled) */}
      <AnimatePresence>
        {selectedShareCard && (
          <div className="fixed inset-0 z-[600] bg-black/95 backdrop-blur-2xl flex flex-col items-center justify-center pt-8 pb-10 px-4 overflow-y-auto">
            <div className="absolute top-4 right-4">
              <button 
                onClick={() => setSelectedShareCard(null)} 
                className="p-3 bg-white/10 rounded-full text-white hover:bg-white/20 transition-all cursor-pointer"
              >
                <X size={20} />
              </button>
            </div>

            <div className="w-full flex-1 flex flex-col items-center justify-center gap-6 max-w-sm">
              <span className="text-[9px] font-black tracking-[0.3em] font-mono text-yellow-500 uppercase">PRÉVIA DE COMPARTILHAMENTO</span>
              
              {/* Vertical Stories container visualization preview wrapper */}
              <div className="w-full aspect-[9/16] bg-black rounded-[36px] overflow-hidden border border-yellow-500/20 relative shadow-2xl scale-95 p-6 flex flex-col justify-between items-center text-center">
                {/* Visual gradients */}
                <div className="absolute inset-0 bg-radial-gradient" style={{ background: 'radial-gradient(circle at center, #14110f 0%, #050403 100%)' }} />
                <div className="absolute inset-4 border border-yellow-500/10 rounded-[28px] pointer-events-none" />
                
                {/* CARD BODY PREVIEW MARKUPS */}
                <div className="relative z-10 w-full flex flex-col items-center flex-grow justify-between py-4">
                  {/* Branding Header */}
                  <div>
                    <span className="font-mono text-[9px] font-black tracking-[0.4em] text-yellow-500/40 uppercase block">INVICTUS ACADEMY</span>
                    <span className="font-headline italic font-black text-xs text-white/25 uppercase tracking-wide">SEASON 2026</span>
                  </div>

                  {/* Medal graphics / display parameters */}
                  <div className="flex flex-col items-center">
                    <div className="w-20 h-20 bg-yellow-500/5 rounded-full border border-yellow-500/20 flex items-center justify-center text-5xl shadow-[0_0_30px_rgba(234,179,8,0.15)] mb-4 animate-bounce">
                      {selectedShareCard.medalEmoji}
                    </div>
                    
                    {selectedShareCard.type === 'derrete_gordura' && (
                      <>
                        <span className="text-[10px] font-black tracking-[0.2em] text-yellow-500 uppercase bg-yellow-500/10 px-3 py-1 rounded-full border border-yellow-500/15">🔥 DESAFIO CONCLUÍDO</span>
                        <span className="text-[12px] uppercase font-black text-white/50 tracking-widest mt-4">MEDALHA DE {selectedShareCard.level.toUpperCase()}</span>
                        <h2 className="font-headline italic font-black text-3xl text-white tracking-tighter uppercase leading-none mt-2">DERRETE GORDURA</h2>
                      </>
                    )}

                    {selectedShareCard.type === 'cardio' && (
                      <>
                        <span className="text-[10px] font-black tracking-[0.2em] text-rose-500 uppercase bg-rose-500/10 px-3 py-1 rounded-full border border-rose-500/15">❤️ ELITE CARDIOVASCULAR</span>
                        <span className="text-[12px] uppercase font-black text-white/50 tracking-widest mt-4">MEDALHA DE {selectedShareCard.level.toUpperCase()}</span>
                        <h2 className="font-headline italic font-black text-3xl text-white tracking-tighter uppercase leading-none mt-2">NÍVEL ALCANÇADO</h2>
                      </>
                    )}

                    {selectedShareCard.type === 'oms' && (
                      <>
                        <span className="text-[10px] font-black tracking-[0.2em] text-teal-400 uppercase bg-teal-500/10 px-3 py-1 rounded-full border border-teal-500/15">🎯 META OMS</span>
                        <span className="text-[12px] uppercase font-black text-white/50 tracking-widest mt-4">META CONCLUÍDA</span>
                        <h2 className="font-headline italic font-black text-3xl text-white tracking-tighter uppercase leading-none mt-2">SAÚDE E CONSTÂNCIA</h2>
                      </>
                    )}

                    <span className="text-[13px] font-mono font-black text-yellow-400 tracking-wider bg-yellow-400/5 border border-yellow-400/10 px-4 py-2 rounded-xl uppercase block mt-6">
                      {selectedShareCard.valueText}
                    </span>
                  </div>

                  {/* Quote & Logo Footer */}
                  <div className="space-y-4">
                    <p className="text-[11px] font-medium text-white/45 italic leading-tight max-w-[200px]">
                      {selectedShareCard.type === 'derrete_gordura' ? '"Transformando esforço em evolução."' : 
                       selectedShareCard.type === 'cardio' ? '"Performance estrita sem atalhos."' : 
                       '"Saúde construída na consistência."'}
                    </p>
                    <div className="h-[1px] w-12 bg-white/10 mx-auto" />
                    <h3 className="font-headline italic font-black text-[13px] tracking-tight uppercase text-white">
                      INVICTUS <span className="bg-gradient-to-r from-amber-400 to-orange-500 bg-clip-text text-transparent">PERFORMANCE</span>
                    </h3>
                  </div>
                </div>
              </div>

              {/* Action layout parameters */}
              <div className="w-full space-y-3 px-2">
                <button 
                  onClick={handleExportPNG}
                  disabled={isGenerating}
                  className="w-full bg-primary text-black py-4 rounded-xl font-headline italic font-black text-sm uppercase tracking-wider flex items-center justify-center gap-2 shadow-lg cursor-pointer"
                >
                  {isGenerating ? <Activity className="animate-spin" size={16} /> : <Download size={16} />}
                  {isGenerating ? 'RENDERIZANDO CARD...' : 'BAIXAR CARD PREMIUM (PNG)'}
                </button>
                
                <p className="text-[9px] text-on-surface-variant/60 font-black tracking-widest uppercase text-center leading-relaxed">
                  IMAGEM EM ULTRA RESOLUÇÃO (HD) PRONTA PARA COMPARTILHAR NO INSTAGRAM STORIES, WHATSAPP OU FEED.
                </p>
              </div>
            </div>

            {/* HIDDEN OFFLINE RENDERING COMPARTMENTS FOR EXACT 1080x1920 COMPILATION SPEC */}
            <div className="absolute left-[-9999px] top-[-9999px] select-none pointer-events-none">
              
              {/* 1. DERRETE GORDURA DESIGN EXPORT */}
              <div 
                ref={dgCardRef}
                className="relative bg-black flex flex-col justify-between items-center py-24 px-16 text-center shadow-2xl"
                style={{ width: '1080px', height: '1920px', background: 'radial-gradient(circle at center, #140f0c 0%, #050403 100%)' }}
              >
                <div className="absolute inset-10 border border-yellow-500/20 rounded-[52px]" />
                <div className="absolute inset-12 border border-yellow-500/5 rounded-[44px]" />
                <div className="absolute top-16 left-16 text-[18px] font-mono tracking-[0.2em] text-yellow-500/40">INVICTUS ACADEMY</div>
                <div className="absolute top-16 right-16 text-[18px] font-mono tracking-[0.2em] text-yellow-500/40">TEMPORADA 1</div>

                <div className="z-10 mt-20 flex flex-col items-center">
                  <span className="text-[28px] font-black tracking-[0.4em] text-yellow-500 uppercase">🔥 DESAFIO CONCLUÍDO</span>
                  <div className="h-[2px] w-48 bg-yellow-500/40 mt-4" />
                </div>

                <div className="z-10 flex flex-col items-center">
                  <div className="w-80 h-80 bg-yellow-500/5 rounded-full border-2 border-yellow-500/20 flex items-center justify-center text-9xl shadow-[0_0_80px_rgba(234,179,8,0.25)] mb-12">
                    {dgEmoji}
                  </div>
                  <span className="text-[24px] font-black text-white/55 uppercase tracking-[0.3em] mb-4">MEDALHA DE {dgLevel.toUpperCase()}</span>
                  <h1 className="text-[84px] font-headline font-black italic uppercase tracking-tighter text-white leading-none">DERRETE GORDURA</h1>
                  <span className="text-[34px] font-mono font-black text-yellow-400 uppercase tracking-[0.15em] bg-yellow-500/10 border border-yellow-500/20 px-8 py-4 rounded-3xl mt-12 block">
                    {dgPercent === 100 ? `${dgOuro.toLocaleString('pt-BR')} KCAL ACUMULADAS` : `${totalCaloriesEarned.toLocaleString('pt-BR')} KCAL ACUMULADAS`}
                  </span>
                </div>

                <div className="z-10 mb-20 space-y-6">
                  <p className="text-[26px] font-medium text-white/50 italic mb-6">"Transformando esforço em evolução."</p>
                  <h2 className="text-[38px] font-headline italic font-black text-white uppercase tracking-tight">
                    INVICTUS <span className="text-yellow-500">PERFORMANCE</span>
                  </h2>
                </div>
              </div>

              {/* 2. CARDIO CARD EXPORT */}
              <div 
                ref={cardioCardRef}
                className="relative bg-black flex flex-col justify-between items-center py-24 px-16 text-center shadow-2xl"
                style={{ width: '1080px', height: '1920px', background: 'radial-gradient(circle at center, #140d12 0%, #050304 100%)' }}
              >
                <div className="absolute inset-10 border border-purple-500/20 rounded-[52px]" />
                <div className="absolute inset-12 border border-purple-500/5 rounded-[44px]" />
                <div className="absolute top-16 left-16 text-[18px] font-mono tracking-[0.2em] text-purple-500/40">INVICTUS ACADEMY</div>
                <div className="absolute top-16 right-16 text-[18px] font-mono tracking-[0.2em] text-purple-500/40">TEMPORADA 1</div>

                <div className="z-10 mt-20 flex flex-col items-center">
                  <span className="text-[28px] font-black tracking-[0.4em] text-rose-500 uppercase">❤️ ELITE CARDIOVASCULAR</span>
                  <div className="h-[2px] w-48 bg-rose-500/40 mt-4" />
                </div>

                <div className="z-10 flex flex-col items-center">
                  <div className="w-80 h-80 bg-rose-500/5 rounded-full border-2 border-rose-500/20 flex items-center justify-center text-9xl shadow-[0_0_80px_rgba(244,63,94,0.25)] mb-12">
                    {cvEmoji}
                  </div>
                  <span className="text-[24px] font-black text-white/55 uppercase tracking-[0.3em] mb-4">MEDALHA DE {cvLevel.toUpperCase()}</span>
                  <h1 className="text-[84px] font-headline font-black italic uppercase tracking-tighter text-white leading-none">NÍVEL ALCANÇADO</h1>
                  <span className="text-[34px] font-mono font-black text-rose-400 uppercase tracking-[0.15em] bg-rose-500/10 border border-rose-500/20 px-8 py-4 rounded-3xl mt-12 block">
                    RECORDE DE ICV: {icvRecord.toLocaleString('pt-BR')} PONTOS
                  </span>
                </div>

                <div className="z-10 mb-20 space-y-6">
                  <p className="text-[26px] font-medium text-white/50 italic mb-6">"Performance estrita sem atalhos."</p>
                  <h2 className="text-[38px] font-headline italic font-black text-white uppercase tracking-tight">
                    INVICTUS <span className="text-rose-500">PERFORMANCE</span>
                  </h2>
                </div>
              </div>

              {/* 3. OMS CARD EXPORT */}
              <div 
                ref={omsCardRef}
                className="relative bg-black flex flex-col justify-between items-center py-24 px-16 text-center shadow-2xl"
                style={{ width: '1080px', height: '1920px', background: 'radial-gradient(circle at center, #0c1412 0%, #030504 100%)' }}
              >
                <div className="absolute inset-10 border border-teal-500/20 rounded-[52px]" />
                <div className="absolute inset-12 border border-teal-500/5 rounded-[44px]" />
                <div className="absolute top-16 left-16 text-[18px] font-mono tracking-[0.2em] text-teal-500/40">INVICTUS ACADEMY</div>
                <div className="absolute top-16 right-16 text-[18px] font-mono tracking-[0.2em] text-teal-500/40">TEMPORADA 1</div>

                <div className="z-10 mt-20 flex flex-col items-center">
                  <span className="text-[28px] font-black tracking-[0.4em] text-teal-400 uppercase">🎯 META OMS</span>
                  <div className="h-[2px] w-48 bg-teal-500/40 mt-4" />
                </div>

                <div className="z-10 flex flex-col items-center">
                  <div className="w-80 h-80 bg-teal-500/5 rounded-full border-2 border-teal-500/20 flex items-center justify-center text-9xl shadow-[0_0_80px_rgba(20,184,166,0.25)] mb-12">
                    {omsEmoji}
                  </div>
                  <span className="text-[24px] font-black text-white/55 uppercase tracking-[0.3em] mb-4">DIRETRIZ DA SAÚDE PÚBLICA</span>
                  <h1 className="text-[84px] font-headline font-black italic uppercase tracking-tighter text-white leading-none">CONCLUÍDA</h1>
                  <span className="text-[34px] font-mono font-black text-teal-400 uppercase tracking-[0.15em] bg-teal-500/10 border border-teal-500/20 px-8 py-4 rounded-3xl mt-12 block">
                    {weeklyOMSMins} MINUTOS DE ATIVIDADE FÍSICA
                  </span>
                </div>

                <div className="z-10 mb-20 space-y-6">
                  <p className="text-[26px] font-medium text-white/50 italic mb-6">"Saúde construída na consistência."</p>
                  <h2 className="text-[38px] font-headline italic font-black text-white uppercase tracking-tight">
                    INVICTUS <span className="text-teal-400">PERFORMANCE</span>
                  </h2>
                </div>
              </div>

            </div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
