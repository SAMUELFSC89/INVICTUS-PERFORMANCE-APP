import React, { useEffect, useState, useRef } from 'react';
import { MapPin, Award, TrendingUp, Medal, Star, Sun, Dumbbell, Flame, ChevronRight, Edit, LogOut, Bell, Camera, X, Check, BellOff, ShieldAlert, Share2, Copy, Utensils, Wallet, Calendar, Heart, Trophy, Building2, Globe, QrCode, Shield, Crown, RefreshCw, Activity as ActivityIcon, Settings as SettingsIcon, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { auth, db } from '../firebase';
import { doc, collection, query, where, orderBy, getDocs } from 'firebase/firestore';
import { UserProfile, Achievement } from '../types';
import { fitnessService } from '../services/fitnessService';
import { userService } from '../services/userService';
import { rankingService } from '../services/rankingService';
import { rewardService } from '../services/rewardService';
import { activityService } from '../services/activityService';
import { runningService, RunSession } from '../services/runningService';
import { stravaService, StravaStatus } from '../services/stravaService';
import { RunShareCard } from '../components/RunShareCard';
import { AchievementShareCard } from '../components/AchievementShareCard';
import { ACHIEVEMENTS } from '../achievements';
import { cn, compressImage } from '../lib/utils';
import { WearableManager } from '../services/wearables/WearableManager';

import { useUser } from '../UserContext';
import { getLevelFromXP, getXPProgress, getBarbellWeight } from '../lib/levelUtils';
import { PremiumLevelCard } from '../components/PremiumLevelCard';
import { IGAAuditModal } from '../components/IGAAuditModal';
import { calculateWeeklyIGA } from '../core/iga';

export function Profile() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useUser();
  const progress = getXPProgress(user?.xp || 0);
  const [showIGAModal, setShowIGAModal] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editHeight, setEditHeight] = useState('');
  const [editWeight, setEditWeight] = useState('');
  const [editAge, setEditAge] = useState('');
  const [editSex, setEditSex] = useState<UserProfile['sex']>('male');
  const [editFrequency, setEditFrequency] = useState<UserProfile['weeklyFrequency']>('3-4');
  const [editObjective, setEditObjective] = useState<UserProfile['objective']>('emagrecer');
  const [editSelfAssessment, setEditSelfAssessment] = useState<UserProfile['bodySelfAssessment']>('normal');
  const [editBio, setEditBio] = useState('');
  const [editPixKey, setEditPixKey] = useState('');
  const [editPixType, setEditPixType] = useState<UserProfile['pixKeyType']>('cpf');
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'achievements' | 'activity' | 'runs'>('achievements');
  const [runHistory, setRunHistory] = useState<RunSession[]>([]);
  const [selectedRun, setSelectedRun] = useState<RunSession | null>(null);
  const [sharingAchievement, setSharingAchievement] = useState<any>(null);
  const [stravaStatus, setStravaStatus] = useState<StravaStatus | null>(null);
  const [stravaLoading, setStravaLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (user) {
      if (searchParams.get('strava') === 'connected') {
        // Clear the param and refresh
        navigate('/profile', { replace: true });
        
        const handleConnectedCallback = async () => {
          try {
            setStravaLoading(true);
            // 1. Force refresh status cache and fetch the genuine status from the server
            const status = await stravaService.getStatus(true);
            setStravaStatus(status);
            
            // 2. Trigger WearableManager config loading, which will sync the genuine state to Firestore
            await WearableManager.getInstance().loadConfig();
            
            alert('Strava conectado com sucesso!');
          } catch (err) {
            console.error('[Profile] Error syncing connection status after callback:', err);
          } finally {
            setStravaLoading(false);
          }
        };
        handleConnectedCallback();
      } else {
        fetchStravaStatus();
      }
    }
  }, [user, searchParams]);

  const fetchStravaStatus = async (forceRefresh?: boolean) => {
    try {
      const status = await stravaService.getStatus(forceRefresh);
      setStravaStatus(status);
    } catch (err) {
      console.error('Strava status fetch error:', err);
    }
  };

  const handleConnectStrava = async () => {
    setStravaLoading(true);
    // Pre-open a blank window to bypass popup blockers in iframe environments
    let authWindow: Window | null = null;
    try {
      if (window.self !== window.top) {
        authWindow = window.open('about:blank', '_blank');
      }
    } catch (e) {
      console.warn('[Profile] Failed to pre-open popup window:', e);
    }

    try {
      const url = await stravaService.authorize();
      if (url) {
        if (authWindow) {
          authWindow.location.href = url;
        } else {
          // Inside top level or fallback when popup was blocked / not used
          try {
            if (window.self !== window.top) {
              window.top.location.href = url;
            } else {
              window.location.href = url;
            }
          } catch (iframeErr) {
            window.location.href = url;
          }
        }
      }
    } catch (err) {
      console.error('[Profile] Strava auth error:', err);
      if (authWindow) {
        authWindow.close();
      }
    } finally {
      setStravaLoading(false);
    }
  };

  const handleSyncStrava = async () => {
    setStravaLoading(true);
    try {
      const result = await stravaService.sync();
      fetchStravaStatus();
      if (activeTab === 'runs') fetchRunHistory();
    } catch (err) {
      console.error('Strava sync error:', err);
    } finally {
      setStravaLoading(false);
    }
  };

  const handleDisconnectStrava = async () => {
    if (!confirm('Deseja desconectar sua conta Strava? Novas atividades não serão sincronizadas.')) return;
    setStravaLoading(true);
    try {
      await stravaService.disconnect();
      try {
        await WearableManager.getInstance().disconnectProvider('strava');
      } catch (e) {
        console.warn('[Profile] Failed to disconnect Strava in WearableManager:', e);
      }
      fetchStravaStatus();
    } catch (err) {
      console.error('Strava disconnect error:', err);
    } finally {
      setStravaLoading(false);
    }
  };

  useEffect(() => {
    if (user) {
      setEditName(user.displayName);
      setEditPhone(user.phoneNumber || '');
      setEditHeight(user.height?.toString() || '');
      setEditWeight(user.weight?.toString() || '');
      setEditAge(user.age?.toString() || '');
      setEditSex(user.sex || 'male');
      setEditFrequency(user.weeklyFrequency || '3-4');
      setEditObjective(user.objective || 'emagrecer');
      setEditSelfAssessment(user.bodySelfAssessment || 'normal');
      setEditBio(user.bio || '');
      setEditPixKey(user.pixKey || '');
      setEditPixType(user.pixKeyType || 'cpf');
    }
  }, [user]);

  useEffect(() => {
    if (user && activeTab === 'runs') {
      fetchRunHistory();
    }
  }, [user, activeTab]);

  const fetchRunHistory = async () => {
    if (!user) return;
    try {
      const data = await runningService.getHistory(user.uid);
      setRunHistory(data.history);
    } catch (err) {
      console.error('History fetch error:', err);
    }
  };

  const handleLogout = async () => {
    await auth.signOut();
    // Forca reload completo (em vez de navigate SPA) para descartar estado/listeners
    // residuais das telas que estavam montadas antes do logout. Mesma correcao aplicada
    // em Settings.tsx: evita tela preta ao relogar com o app ja em uma tela aberta.
    window.location.href = '/';
  };

  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    try {
      const compressed = await compressImage(file, 400, 0.8);
      await userService.updateProfilePhoto(compressed);
    } catch (error) {
      console.error('Failed to update photo:', error);
      alert('Erro ao atualizar foto. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  const handleRemovePhoto = async () => {
    if (!user) return;
    if (!window.confirm('Deseja realmente remover sua foto de perfil?')) return;

    setLoading(true);
    try {
      await userService.removeProfilePhoto();
    } catch (error) {
      console.error('Failed to remove photo:', error);
      alert('Erro ao remover foto. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateProfile = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const h = parseFloat(editHeight);
      const w = parseFloat(editWeight);
      const age = parseInt(editAge);
      const imc = fitnessService.calculateIMC(w, h);
      const league = fitnessService.classifyLeague(imc, editFrequency, editSelfAssessment);
      const calories = fitnessService.calculateDailyCalories(w, h, age, editSex, editFrequency, editObjective);
      const macros = fitnessService.calculateMacros(calories, editObjective, w);

      await userService.updateProfile({
        displayName: editName,
        phoneNumber: editPhone,
        bio: editBio,
        pixKey: editPixKey,
        pixKeyType: editPixType,
        height: h,
        weight: w,
        age,
        sex: editSex,
        weeklyFrequency: editFrequency,
        objective: editObjective,
        bodySelfAssessment: editSelfAssessment,
        league,
        imc,
        dailyCalories: calories,
        macros
      });
      setIsEditing(false);
    } catch (error) {
      console.error('Failed to update profile:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleShareAchievement = async (achievement: any) => {
    if (!user) return;
    setSharingAchievement({
      ...achievement,
      title: achievement.name,
      description: achievement.criteria || achievement.description,
      rarity: achievement.rarity || 'common'
    });
  };

  const handlePanicStop = () => {
    if (confirm('Deseja forçar a limpeza de todos os treinos em andamento? Isso limpará qualquer cronômetro travado.')) {
      activityService.cancelSession();
      localStorage.removeItem('kmfatal_active_run');
      localStorage.removeItem('kmfatal_start_time');
      localStorage.removeItem('kmfatal_total_distance');
      localStorage.removeItem('kmfatal_run_points');
      window.location.reload();
    }
  };

  if (!user) return null;

  const unlockedAchievements = ACHIEVEMENTS.filter(a => user.achievements?.includes(a.id));
  const isTop3 = user.positions.league && user.positions.league <= 3;

  return (
    <div className="min-h-screen bg-background pb-32">
      {/* Profile Header */}
      <section className="px-4 md:px-6 pt-8 md:pt-12 pb-12 md:pb-16 bg-gradient-to-b from-surface-container-low to-background relative overflow-hidden">
        <div className="absolute inset-0 bg-grid-white/[0.02] bg-[size:32px_32px]" />
        <div className="max-w-4xl mx-auto relative z-10">
          <div className="flex flex-col md:flex-row items-center md:items-start gap-6 md:gap-12">
            {/* Avatar with Ring for Top 3 */}
            <div className="relative flex-shrink-0 group">
              <div className={cn(
                "w-28 h-28 md:w-40 md:h-40 rounded-[28px] md:rounded-[36px] p-1 overflow-hidden transition-all duration-500",
                user.subscriptionTier === 'performance' ? "bg-gradient-to-br from-[#EAB308] via-primary to-[#FC4C02] shadow-[0_0_30px_rgba(234,179,8,0.25)]" :
                isTop3 ? "bg-gradient-to-br from-primary via-alert-orange to-tertiary shadow-[0_0_30px_rgba(46,204,113,0.2)]" : "bg-surface-container-highest shadow-xl border border-white/10"
              )}>
                <img 
                  src={user.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.uid}`} 
                  alt="Profile" 
                  referrerPolicy="no-referrer"
                  className="w-full h-full rounded-[24px] md:rounded-[32px] object-cover bg-surface-container-high"
                  onError={(e) => {
                    e.currentTarget.onerror = null;
                    e.currentTarget.src = `https://api.dicebear.com/7.x/avataaars/svg?seed=${user?.uid || 'athlete'}`;
                  }}
                />
              </div>
              <div className="absolute -top-2 -right-2 w-9 h-9 md:w-11 md:h-11 bg-black border-2 border-background rounded-xl flex flex-col items-center justify-center shadow-lg">
                 <span className="font-label text-[6px] md:text-[7px] font-black text-primary uppercase leading-tight">LVL</span>
                 <span className="font-headline italic font-black text-xs md:text-base text-on-surface leading-tight">{getLevelFromXP(user?.xp || 0)}</span>
              </div>
              <div className="absolute -bottom-1 -left-1 flex items-center gap-1.5">
                <button 
                  onClick={() => fileInputRef.current?.click()}
                  className="w-8 h-8 md:w-9 md:h-9 bg-surface-container-highest text-white rounded-lg flex items-center justify-center shadow-lg border border-white/10 hover:bg-primary hover:text-black transition-all active:scale-95 cursor-pointer"
                  title="Alterar foto de perfil"
                >
                  <Camera size={14} />
                </button>
                {user.photoURL ? (
                  <button 
                    onClick={handleRemovePhoto}
                    className="w-8 h-8 md:w-9 md:h-9 bg-red-600/90 text-white rounded-lg flex items-center justify-center shadow-lg border border-white/10 hover:bg-red-700 transition-all active:scale-95 cursor-pointer"
                    title="Remover foto de perfil"
                  >
                    <Trash2 size={14} />
                  </button>
                ) : null}
              </div>
              <input 
                type="file" 
                ref={fileInputRef} 
                className="hidden" 
                accept="image/*"
                onChange={handlePhotoChange}
              />
            </div>

            {/* Info */}
            <div className="flex-grow space-y-3.5 text-center md:text-left w-full">
              {/* User Name & Verified Icon */}
              <div className="flex items-center justify-center md:justify-start gap-2 flex-wrap">
                <h2 className="font-headline italic font-black text-2xl md:text-4xl uppercase tracking-tighter text-on-surface leading-tight">
                  {user.displayName}
                </h2>
                {user.isSubscribed && (
                  <span className="inline-flex items-center justify-center text-primary bg-primary/10 p-1 rounded-full border border-primary/20 shrink-0" title="Atleta Verificado INVICTUS">
                    <Check className="w-3.5 h-3.5 md:w-4 md:h-4 text-primary stroke-[4]" />
                  </span>
                )}
              </div>

              {/* Status Badges & Actions */}
              <div className="flex items-center justify-center md:justify-start gap-2 flex-wrap">
                {user.subscriptionTier === 'performance' ? (
                  <span 
                    onClick={() => navigate('/performance')}
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[9px] md:text-[10px] font-black uppercase tracking-widest bg-gradient-to-r from-amber-500 via-primary to-orange-600 text-white shadow-[0_0_12px_rgba(234,179,8,0.25)] shrink-0 border border-yellow-400/30 cursor-pointer hover:scale-102 transition-all"
                  >
                    <Crown size={11} className="text-white fill-white/20 animate-bounce" />
                    PLANO PERFORMANCE
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[9px] md:text-[10px] font-black uppercase tracking-widest bg-slate-800 text-[#BDC3C7] shrink-0 border border-white/15">
                    <Check size={11} className="text-[#3498DB]" />
                    PLANO ESSENCIAL
                  </span>
                )}

                {user.role === 'admin' && (
                  <button 
                    onClick={() => navigate('/admin')}
                    className="inline-flex items-center gap-1.5 px-3 py-1 bg-prize-gold text-black font-black text-[9px] md:text-[10px] rounded-full hover:bg-prize-gold/80 transition-all uppercase tracking-widest shadow-md shrink-0"
                  >
                    <Shield size={12} fill="currentColor" />
                    ADMIN
                  </button>
                )}

                <button 
                  onClick={() => setIsEditing(true)}
                  className="inline-flex items-center gap-1 px-3 py-1 bg-surface-container-highest text-on-surface font-black text-[9px] md:text-[10px] rounded-full hover:bg-outline-variant/30 transition-all uppercase tracking-widest border border-white/10 shrink-0 cursor-pointer"
                >
                  <Edit size={11} />
                  Editar
                </button>

                <button 
                  onClick={() => navigate('/wallet')}
                  className="inline-flex items-center gap-1 px-3 py-1 bg-primary/20 text-primary font-black text-[9px] md:text-[10px] rounded-full hover:bg-primary/30 transition-all uppercase tracking-widest border border-primary/30 shrink-0 cursor-pointer"
                >
                  <Wallet size={11} />
                  Carteira
                </button>

                <button 
                  onClick={() => navigate('/settings')}
                  className="inline-flex items-center gap-1 px-3 py-1 bg-surface-container-highest text-on-surface font-black text-[9px] md:text-[10px] rounded-full hover:bg-outline-variant/30 transition-all uppercase tracking-widest border border-white/10 shrink-0 cursor-pointer"
                >
                  <SettingsIcon size={11} />
                  Configs
                </button>

                <button 
                  onClick={handleLogout}
                  className="p-1.5 text-on-surface-variant hover:text-error transition-colors rounded-lg bg-surface-container-low border border-white/5 shrink-0"
                  title="Sair da Conta"
                >
                  <LogOut size={14} />
                </button>
              </div>

              {/* Quick Stat Indicators */}
              <div className="flex items-center justify-center md:justify-start gap-2 flex-wrap">
                <div className="flex items-center gap-1.5 text-primary bg-primary/10 px-2.5 py-1 rounded-xl border border-primary/20 text-xs font-black">
                  <Heart size={13} fill="currentColor" />
                  <span>{(user as any).profileLikes?.length || 0}</span>
                </div>
                <div className="flex items-center gap-1.5 text-alert-orange bg-alert-orange/10 px-2.5 py-1 rounded-xl border border-alert-orange/20 text-xs font-black">
                  <Trophy size={13} />
                  <span>{user.league?.split(' ')[1]?.toUpperCase() || 'LIGA'}</span>
                </div>
                <div className="flex items-center gap-1.5 text-amber-400 bg-amber-400/10 px-2.5 py-1 rounded-xl border border-amber-400/20 text-xs font-black">
                  <Flame size={13} className="text-amber-400" />
                  <span>{user.streak || 0} DIAS</span>
                </div>
                <div className="flex items-center gap-1.5 text-blue-400 bg-blue-400/10 px-2.5 py-1 rounded-xl border border-blue-400/20 text-xs font-black">
                  <MapPin size={13} />
                  <span className="truncate max-w-[120px]">{user.city || 'BRASIL'}</span>
                </div>
              </div>

              {/* Biography */}
              {user.bio ? (
                <p className="text-on-surface-variant text-xs md:text-sm font-medium leading-relaxed max-w-md mx-auto md:mx-0 pt-1">
                  {user.bio}
                </p>
              ) : (
                <button onClick={() => setIsEditing(true)} className="text-primary text-[9px] md:text-[10px] font-black uppercase tracking-widest hover:underline pt-1 block mx-auto md:mx-0">
                  + Adicionar biografia
                </button>
              )}

              {/* Discrete Level Progress bar instead of the huge BarbellLifter at the top */}
              <div className="pt-2 max-w-lg md:max-w-xl mx-auto md:mx-0 w-full">
                <div className="bg-surface-container-low border border-white/[0.04] rounded-2xl p-4 md:p-5 shadow-lg relative overflow-hidden group">
                  {/* Subtle background glow */}
                  <div className="absolute -top-12 -right-12 w-28 h-28 bg-emerald-500/5 rounded-full blur-2xl pointer-events-none" />
                  
                  <div className="flex justify-between items-center mb-2.5">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-400">
                        <Dumbbell size={14} className="animate-pulse" />
                      </div>
                      <div>
                        <span className="text-[7.5px] text-on-surface-variant/70 uppercase font-black block tracking-widest leading-none mb-0.5">PROGRESSO DE FORÇA</span>
                        <span className="font-headline italic font-black text-xs md:text-sm text-white uppercase leading-none">HALTER {getBarbellWeight(progress.currentLevel)} KG</span>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-1 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-0.5 rounded-lg leading-none">
                      <span className="text-[7px] font-black text-emerald-400 uppercase tracking-widest">LVL</span>
                      <span className="text-xs font-black italic font-headline text-white leading-none">{progress.currentLevel}</span>
                    </div>
                  </div>

                  {/* High-visibility Segmented Neon Energy progress bar */}
                  <div className="relative">
                    <div className="h-4 w-full bg-surface-container-highest rounded-lg overflow-hidden border border-white/5 relative flex items-center">
                      {/* Active level progress indicator */}
                      <div 
                        className="h-full bg-gradient-to-r from-emerald-400 via-teal-400 to-cyan-400 rounded-l-lg transition-all duration-500 relative"
                        style={{
                          width: `${progress.percentage}%`,
                          boxShadow: '0 0 12px rgba(16, 185, 129, 0.4)'
                        }}
                      />

                      {/* Barbell-style segment division overlay to create distinct segments */}
                      <div className="absolute inset-0 flex justify-between pointer-events-none px-0.5">
                        {[...Array(9)].map((_, i) => (
                          <div key={i} className="w-[1px] h-full bg-black/50" />
                        ))}
                      </div>
                    </div>

                    {/* Progress details underneath */}
                    <div className="flex justify-between items-center text-[8.5px] font-black uppercase text-on-surface-variant/80 mt-2 px-0.5 tracking-wider">
                      <span>{progress.xpInCurrentLevel} / {progress.xpNeededForNextLevel} XP TOTAL</span>
                      <span className="text-emerald-400">
                        {Math.round(progress.percentage)}% PROGRESSO
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Main Stats Summary */}
      <section className="px-4 md:px-6 mb-8 md:mb-12">
        <div className="max-w-4xl mx-auto -translate-y-6 md:-translate-y-8">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3 md:gap-4">
            <StatBox label="RANK ACADEMIA" value={`#${user.positions.gym || '-'}`} subtitle={user.gymName || 'NÃO VINCULADO'} icon={<Building2 size={18} className="text-primary" />} />
            <StatBox label="RANK CIDADE" value={`#${user.positions.city || '-'}`} subtitle={user.city || 'NÃO VINCULADO'} icon={<MapPin size={18} className="text-blue-500" />} />
            <StatBox label="RANK NACIONAL" value={`#${user.positions.national || '-'}`} subtitle="BRASIL" icon={<Globe size={18} className="text-yellow-500" />} />
            <StatBox label="IGA SEMANAL" value={(user.weeklyScore || 0).toLocaleString()} subtitle="VER AUDITORIA" icon={<ActivityIcon size={18} className="text-emerald-400" />} onClick={() => setShowIGAModal(true)} highlight />
            <StatBox label="SCORE RANKING" value={(user.score || 0).toLocaleString()} subtitle="COMPETITIVO" icon={<Trophy size={18} className="text-prize-gold" />} />
            <StatBox label="EXPERIÊNCIA" value={`${(user.xp || 0).toLocaleString()} XP`} subtitle={`NÍVEL ${getLevelFromXP(user.xp || 0)}`} icon={<Star size={18} className="text-alert-orange" />} />
          </div>
        </div>
      </section>

      {/* Trust Score & Streak Freeze Advanced Retention Grid */}
      <section className="px-4 md:px-6 mb-8">
        <div className="max-w-4xl mx-auto grid grid-cols-1 gap-4">
          
          

          {/* Streak Freeze Hardcore Gamification Retention */}
          <div className="bg-surface-container-low p-6 rounded-3xl border border-outline-variant/10 shadow-xl flex flex-col justify-between relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:scale-110 transition-transform">
              <Flame size={120} className="text-alert-orange" strokeWidth={1} />
            </div>
            
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Flame size={18} className="text-alert-orange" />
                <span className="font-label text-[10px] font-black tracking-widest text-alert-orange uppercase">PROTEÇÃO DE STREAK</span>
              </div>
              
              <div className="space-y-1">
                <div className="flex items-baseline gap-2">
                  <h3 className="font-headline italic font-black text-3xl text-on-surface">
                    {localStorage.getItem('streak_freeze_active') === 'true' ? '1' : '0'} / 1 ATIVO
                  </h3>
                  <span className={cn(
                    "text-[10px] px-2 py-0.5 font-bold border rounded-full",
                    localStorage.getItem('streak_freeze_active') === 'true'
                      ? "bg-alert-orange/10 text-alert-orange border-alert-orange/20 animate-pulse"
                      : "bg-on-surface-variant/10 text-on-surface-variant border-surface-container-highest"
                  )}>
                    {localStorage.getItem('streak_freeze_active') === 'true' ? 'ESCUDO ATIVO' : 'SEM ESCUDO'}
                  </span>
                </div>
                <p className="text-[11px] font-semibold text-on-surface-variant uppercase">STREAK FREEZE PROTETOR CONTRA ADVERSIDADES</p>
              </div>

              {localStorage.getItem('streak_freeze_active') === 'true' ? (
                <p className="text-[10px] font-bold text-on-surface-variant uppercase italic">Sua ofensiva de {user.streak} dias está protegida hoje contra faltas involuntárias!</p>
              ) : (
                <button
                  onClick={() => {
                    if (user.appCredits < 15) {
                      alert('Você precisa de no mínimo 15 Créditos KM para obter um Streak Freeze Shield.');
                      return;
                    }
                    if (confirm('Comprar Streak Freeze Escudo por 15 Créditos? Seu streak estará totalmente imune por 24h.')) {
                      localStorage.setItem('streak_freeze_active', 'true');
                      alert('Streak Freeze ativado com sucesso! Você está blindado pelos próximos 1 dias.');
                      window.location.reload();
                    }
                  }}
                  className="w-full py-2.5 bg-alert-orange text-black font-black text-[10px] rounded-xl hover:bg-alert-orange/80 active:scale-95 transition-all uppercase tracking-widest"
                >
                  COMPRAR SHIELD (15 CRÉDITOS)
                </button>
              )}
            </div>
          </div>

        </div>
      </section>

      {/* Podium Highlight (Season Summary) */}
      {isTop3 && (
        <section className="px-6 mb-12">
          <div className="max-w-4xl mx-auto">
            <div className="bg-gradient-to-r from-yellow-500/20 via-yellow-500/5 to-transparent border border-yellow-500/30 rounded-3xl p-8 relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:scale-110 transition-transform">
                <Trophy size={160} />
              </div>
              <div className="relative z-10 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-yellow-500 rounded-full flex items-center justify-center text-black font-black text-2xl shadow-lg">
                    #{user.positions.league}
                  </div>
                  <div>
                    <h3 className="font-headline italic font-black text-2xl text-on-surface uppercase tracking-tighter">CAMPEÃO DA TEMPORADA</h3>
                    <p className="text-[10px] font-black text-yellow-500 uppercase tracking-widest">TEMPORADA 01: O INÍCIO</p>
                  </div>
                </div>
                <p className="text-on-surface-variant font-medium text-sm leading-relaxed max-w-sm">
                  Você dominou a disciplina e conquistou o topo. Sua dedicação é inspiração para toda a liga.
                </p>
                <button 
                  onClick={() => handleShareAchievement({ name: `TOP ${user.positions.league} DA TEMPORADA` })}
                  className="px-6 py-3 bg-yellow-500 text-black font-headline italic font-black text-sm rounded-xl flex items-center gap-2 hover:bg-yellow-400 transition-all active:scale-95"
                >
                  <Share2 size={16} />
                  COMPARTILHAR VITÓRIA
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Tabs / Content Section */}
      <section className="max-w-4xl mx-auto px-4 md:px-6">
        <div className="flex gap-4 md:gap-8 border-b border-outline-variant/10 mb-8 overflow-x-auto no-scrollbar whitespace-nowrap">
          <button 
            onClick={() => setActiveTab('achievements')}
            className={cn(
              "pb-4 border-b-2 font-black text-[10px] md:text-xs uppercase tracking-widest transition-all shrink-0",
              activeTab === 'achievements' ? "border-primary text-on-surface" : "border-transparent text-on-surface-variant hover:text-on-surface opacity-50"
            )}
          >
            CONQUISTAS
          </button>
          <button 
            onClick={() => setActiveTab('activity')}
            className={cn(
              "pb-4 border-b-2 font-black text-[10px] md:text-xs uppercase tracking-widest transition-all shrink-0",
              activeTab === 'activity' ? "border-primary text-on-surface" : "border-transparent text-on-surface-variant hover:text-on-surface opacity-50"
            )}
          >
            TEMPORADAS
          </button>
          <button 
            onClick={() => setActiveTab('runs')}
            className={cn(
              "pb-4 border-b-2 font-black text-[10px] md:text-xs uppercase tracking-widest transition-all shrink-0",
              activeTab === 'runs' ? "border-primary text-on-surface" : "border-transparent text-on-surface-variant hover:text-on-surface opacity-50"
            )}
          >
            ATIVIDADES
          </button>
        </div>

        {activeTab === 'achievements' && (
          <div className="space-y-6">
            {/* Banner Conquistas Invictus */}
            <div className="bg-gradient-to-r from-amber-600/25 via-primary/10 to-orange-600/15 p-6 rounded-[28px] border border-yellow-500/20 relative overflow-hidden shadow-2xl flex flex-col md:flex-row justify-between items-center gap-6">
              <div className="absolute -right-10 -bottom-10 w-40 h-40 bg-primary/10 rounded-full blur-3xl" />
              <div className="space-y-2 text-center md:text-left">
                <div className="flex items-center justify-center md:justify-start gap-2">
                  <span className="font-sans text-[8px] font-black text-yellow-400 uppercase tracking-widest bg-yellow-400/10 border border-yellow-400/20 px-2 py-0.5 rounded-md">🏆 NOVIDADE</span>
                  <span className="text-[8px] font-black text-white bg-white/10 px-2 py-0.5 rounded-md uppercase">RECOMPENSA DE ATLETA</span>
                </div>
                <h3 className="font-headline italic font-black text-2xl text-white uppercase tracking-tighter">🏆 CONQUISTAS INVICTUS</h3>
                <p className="text-[10px] text-on-surface-variant uppercase font-semibold tracking-wide leading-relaxed">
                  Ganhe medalhas de alta performance de acordo com seu gasto calórico (KCAL), saúde cardiovascular (ICV) e consistência ativa semanal (OMS).
                </p>
              </div>
              <button 
                onClick={() => navigate('/achievements')}
                className="w-full md:w-auto px-6 py-4 bg-primary hover:bg-primary/95 text-black rounded-2xl font-headline italic font-black text-xs uppercase tracking-widest transition-transform hover:scale-[1.02] shadow-xl flex items-center justify-center gap-2 cursor-pointer"
              >
                ACESSAR CENTRAL <ChevronRight size={14} strokeWidth={3} />
              </button>
            </div>

            {/* Rest of the standard achievements gallery */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {unlockedAchievements.length > 0 ? (
                unlockedAchievements.map((achievement) => (
                  <AchievementCard 
                    key={achievement.id} 
                    achievement={achievement} 
                    onShare={() => handleShareAchievement(achievement)}
                  />
                ))
              ) : (
                <div className="col-span-full py-20 text-center bg-surface-container-low rounded-3xl border border-dashed border-outline-variant/20">
                  <Award size={48} className="mx-auto text-outline-variant/20 mb-4" />
                  <p className="font-black text-xs text-on-surface-variant uppercase tracking-widest">Ainda não há conquistas desbloqueadas</p>
                  <p className="text-[10px] text-on-surface-variant/60 mt-2">Continue treinando para ganhar medalhas!</p>
                </div>
              )}
              
              {/* Show locked achievements as semi-transparent placeholders */}
              {ACHIEVEMENTS.filter(a => !user.achievements?.includes(a.id)).slice(0, 4).map(a => (
                <div key={a.id} className="p-6 bg-surface-container-low/30 rounded-3xl border border-outline-variant/10 opacity-40 grayscale flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full bg-surface-container flex items-center justify-center text-2xl">
                    {a.icon}
                  </div>
                  <div className="flex-grow">
                    <h4 className="font-headline italic font-black text-sm uppercase tracking-tighter mb-0.5">{a.name}</h4>
                    <p className="text-[9px] font-bold text-on-surface-variant/60 uppercase">{a.criteria}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'activity' && (
          <div className="space-y-4">
            <SeasonHistoryItem 
              season="TEMPORADA 01" 
              status="ATIVA" 
              rank={`#${user.positions.national || '?'}`} 
              xp={user?.xp || 0}
              isCurrent
            />
            {/* Simple Ranking History */}
            <div className="bg-surface-container-low border border-outline-variant/10 rounded-3xl p-6 space-y-4">
               <div className="flex items-center justify-between border-b border-outline-variant/10 pb-4">
                  <h4 className="font-headline italic font-black text-sm uppercase tracking-tight">MELHOR POSIÇÃO</h4>
                  <div className="flex items-center gap-2">
                     <Crown size={14} className="text-prize-gold" />
                     <span className="font-headline italic font-black text-xl">#{user.positions.gym || '-'}</span>
                  </div>
               </div>
               <div className="space-y-3">
                  <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-on-surface-variant">
                     <span>ÚLTIMOS RANKINGS</span>
                     <span>POSIÇÃO</span>
                  </div>
                  {[
                    { label: 'Semana Passada', pos: user.positions.gym ? user.positions.gym + 2 : '-', color: 'text-on-surface' },
                    { label: 'Mês Passado', pos: user.positions.gym ? user.positions.gym + 5 : '-', color: 'text-on-surface' }
                  ].map((h, i) => (
                    <div key={i} className="flex items-center justify-between p-3 bg-background/50 rounded-xl border border-outline-variant/5">
                      <span className="font-label text-[10px] font-black truncate">{h.label}</span>
                      <span className={cn("font-headline italic font-black", h.color)}>#{h.pos}</span>
                    </div>
                  ))}
               </div>
            </div>
            <div className="p-12 text-center border-t border-outline-variant/10 opacity-30">
               <Trophy size={32} className="mx-auto mb-3" />
               <p className="font-black text-[10px] uppercase tracking-[0.2em]">Histórico de temporadas anteriores aparecerá aqui</p>
            </div>
          </div>
        )}

        {activeTab === 'runs' && (
          <div className="space-y-4">
            {runHistory.length > 0 ? (
              runHistory.map((run) => (
                <div 
                  key={run.id || run.startTime}
                  className="bg-surface-container rounded-3xl p-6 border border-outline-variant/10 flex items-center justify-between group hover:border-primary/30 transition-all cursor-pointer"
                  onClick={() => setSelectedRun(run)}
                >
                   <div className="flex items-center gap-6">
                      <div className="w-16 h-16 bg-gradient-to-br from-primary/10 to-primary/5 rounded-2xl flex items-center justify-center text-primary group-hover:scale-110 transition-transform overflow-hidden relative border border-primary/10">
                         {/* Mini trajectory SVG */}
                         {run.points && run.points.length > 2 ? (
                            <div className="absolute inset-2 flex items-center justify-center opacity-40">
                               <svg viewBox="0 0 100 100" className="w-full h-full transform scale-90">
                                  {(() => {
                                     const lats = run.points.map(p => p.lat);
                                     const lngs = run.points.map(p => p.lng);
                                     const minLat = Math.min(...lats);
                                     const maxLat = Math.max(...lats);
                                     const minLng = Math.min(...lngs);
                                     const maxLng = Math.max(...lngs);
                                     
                                     const scaleX = (x: number) => ((x - minLng) / (maxLng - minLng)) * 100;
                                     const scaleY = (y: number) => 100 - ((y - minLat) / (maxLat - minLat)) * 100;

                                     const path = run.points.map((p, i) => 
                                        `${i === 0 ? 'M' : 'L'} ${scaleX(p.lng)} ${scaleY(p.lat)}`
                                     ).join(' ');

                                     return <path d={path} fill="none" stroke="currentColor" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />;
                                  })()}
                               </svg>
                            </div>
                         ) : (
                            <Star className="opacity-20 absolute" size={40} />
                         )}
                         <MapPin size={24} className="relative z-10" />
                      </div>
                      <div>
                         <p className="text-[10px] font-black text-on-surface-variant uppercase tracking-widest opacity-60 mb-1">
                           {new Date(run.startTime).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' })}
                         </p>
                         <h4 className="font-headline italic font-black text-2xl text-on-surface uppercase tracking-tighter leading-none">
                           {(run.totalDistance / 1000).toFixed(2)} KM
                         </h4>
                         <div className="flex gap-4 mt-2">
                            <span className="text-[9px] font-bold text-on-surface-variant uppercase tracking-widest">{run.avgPace} /KM</span>
                            <span className={cn(
                              "text-[9px] font-black uppercase tracking-widest",
                              run.validationStatus === 'VALID' ? "text-green-500" : "text-prize-gold"
                            )}>{run.validationStatus}</span>
                         </div>
                      </div>
                   </div>
                   <button className="w-12 h-12 bg-surface-container-high rounded-full flex items-center justify-center text-on-surface-variant group-hover:bg-primary group-hover:text-black transition-all">
                      <Share2 size={20} />
                   </button>
                </div>
              ))
            ) : (
              <div className="py-20 text-center bg-surface-container-low rounded-3xl border border-dashed border-outline-variant/20">
                <Flame size={48} className="mx-auto text-outline-variant/20 mb-4" />
                <p className="font-black text-xs text-on-surface-variant uppercase tracking-widest">Nenhuma corrida registrada ainda</p>
                <p className="text-[10px] text-on-surface-variant/60 mt-2">Suas conquistas aparecerão aqui após completar sua primeira corrida!</p>
              </div>
            )}
          </div>
        )}
      </section>

      {selectedRun && (
        <RunShareCard 
          session={selectedRun}
          onClose={() => setSelectedRun(null)}
        />
      )}

      <AnimatePresence>
        {sharingAchievement && (
           <AchievementShareCard 
             user={user}
             achievement={sharingAchievement}
             onClose={() => setSharingAchievement(null)}
           />
        )}
      </AnimatePresence>

      {/* Connected Apps Section */}
      <section className="max-w-4xl mx-auto px-6 mb-12">
        <div className="flex items-center gap-2 mb-6">
          <ActivityIcon size={20} className="text-on-surface-variant opacity-40" />
          <h3 className="font-headline italic font-black text-xl uppercase tracking-tighter text-on-surface">APPS CONECTADOS</h3>
        </div>

        <div className="bg-surface-container rounded-[32px] p-8 border border-outline-variant/10 relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-8 opacity-[0.03] group-hover:scale-110 transition-transform">
            <ActivityIcon size={120} />
          </div>
          
          <div className="flex flex-col md:flex-row items-center justify-between gap-8 relative z-10">
            <div className="flex items-center gap-6">
              <div className={cn(
                "w-20 h-20 rounded-[28px] flex items-center justify-center transition-all duration-500",
                stravaStatus?.connected ? "bg-[#FC4C02]/10 text-[#FC4C02] shadow-[0_0_30px_rgba(252,76,2,0.1)]" : "bg-surface-container-highest text-on-surface-variant opacity-40"
              )}>
                <svg viewBox="0 0 24 24" className="w-10 h-10 fill-current">
                   <path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169" />
                </svg>
              </div>
              <div className="text-center md:text-left">
                <div className="flex items-center gap-2 mb-1 justify-center md:justify-start">
                   <h4 className="font-headline italic font-black text-2xl text-on-surface uppercase tracking-tighter">STRAVA</h4>
                   {stravaStatus?.connected && (
                     <div className="px-2 py-0.5 bg-green-500/10 text-green-500 text-[8px] font-black rounded uppercase tracking-widest border border-green-500/20">
                        CONECTADO
                     </div>
                   )}
                </div>
                <p className="text-on-surface-variant font-label text-[10px] font-bold uppercase tracking-widest leading-none opacity-60">
                  {stravaStatus?.connected 
                    ? `Sincronizado em: ${stravaStatus.lastSync ? new Date(stravaStatus.lastSync).toLocaleString('pt-BR') : 'Aguardando'}` 
                    : 'VALIDE SUAS CORRIDAS AUTOMATICAMENTE'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
               {stravaStatus?.connected ? (
                 <>
                   <button 
                     onClick={handleSyncStrava}
                     disabled={stravaLoading}
                     className="h-14 px-6 bg-surface-container-highest text-on-surface rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-outline-variant/20 transition-all flex items-center gap-2"
                   >
                     <RefreshCw size={16} className={cn(stravaLoading && "animate-spin")} />
                     SINCRONIZAR
                   </button>
                   <button 
                     onClick={handleDisconnectStrava}
                     disabled={stravaLoading}
                     className="h-14 w-14 bg-error/10 text-error rounded-2xl flex items-center justify-center hover:bg-error/20 transition-all"
                   >
                     <X size={20} />
                   </button>
                 </>
               ) : (
                 <button 
                   onClick={handleConnectStrava}
                   disabled={stravaLoading}
                   className="h-14 px-8 bg-[#FC4C02] text-white rounded-2xl font-headline italic font-black text-lg uppercase tracking-widest shadow-xl hover:scale-105 active:scale-95 transition-all flex items-center gap-3"
                 >
                   {stravaLoading ? 'CARREGANDO...' : 'CONECTAR STRAVA'}
                   {!stravaLoading && <ChevronRight size={20} />}
                 </button>
               )}
            </div>
          </div>
        </div>
      </section>

      {/* Footer Actions */}
      <section className="max-w-4xl mx-auto mt-12 px-6 pb-24">
        <div className="bg-surface-container-low/55 rounded-[28px] border border-outline-variant/10 p-5 md:p-6 shadow-xl w-full">
          <div className="flex flex-col gap-3">
            {user.role === 'admin' && (
              <button 
                onClick={() => navigate('/admin')} 
                className="w-full flex items-center justify-between p-4 bg-secondary/10 hover:bg-secondary/15 text-secondary rounded-2xl border border-secondary/20 transition-all font-sans group"
              >
                <div className="flex items-center gap-3">
                  <Shield size={18} className="text-secondary" />
                  <span className="font-black text-xs uppercase tracking-widest leading-none">PAINEL DO ADMINISTRADOR</span>
                </div>
                <ChevronRight size={16} className="opacity-70 group-hover:translate-x-0.5 transition-transform" />
              </button>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <button 
                onClick={() => navigate('/wallet')} 
                className="flex items-center justify-between p-4 bg-surface-container-high/40 hover:bg-surface-container-high/80 rounded-2xl border border-outline-variant/5 transition-all font-sans group text-left"
              >
                <div className="flex items-center gap-3">
                  <Wallet size={18} className="text-primary" />
                  <span className="font-extrabold text-xs uppercase tracking-widest text-on-surface leading-none">MINHA CARTEIRA</span>
                </div>
                <ChevronRight size={14} className="text-on-surface-variant/40 group-hover:translate-x-0.5 transition-transform" />
              </button>

              <button 
                onClick={handleLogout} 
                className="flex items-center justify-between p-4 bg-surface-container-high/40 hover:bg-error/10 rounded-2xl border border-outline-variant/5 text-error transition-all font-sans group text-left"
              >
                <div className="flex items-center gap-3">
                  <LogOut size={18} />
                  <span className="font-extrabold text-xs uppercase tracking-widest leading-none">ENCERRAR SESSÃO</span>
                </div>
                <ChevronRight size={14} className="text-error/40 group-hover:translate-x-0.5 transition-transform" />
              </button>
            </div>

            <button 
              onClick={handlePanicStop}
              className="flex items-center justify-center gap-2 p-3 bg-alert-orange/5 hover:bg-alert-orange/10 text-alert-orange rounded-xl border border-alert-orange/15 transition-all text-[9px] font-black uppercase tracking-widest mt-2"
            >
              <ShieldAlert size={14} />
              <span>LIMPAR TREINOS TRAVADOS (SUPORTE TÉCNICO)</span>
            </button>
          </div>
        </div>
      </section>

      {/* Modals */}
      <AnimatePresence>
        {isEditing && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setIsEditing(false)} />
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="relative w-full max-w-md bg-surface-container rounded-2xl overflow-hidden shadow-2xl">
              <div className="p-6 flex justify-between items-center border-b border-outline-variant/10">
                <h3 className="font-headline italic font-bold text-xl uppercase">EDITAR PERFIL</h3>
                <button onClick={() => setIsEditing(false)} className="text-on-surface-variant hover:text-primary"><X size={24} /></button>
              </div>
              <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto no-scrollbar">
                <div className="space-y-2">
                  <label className="font-label text-[10px] font-bold text-on-surface-variant uppercase tracking-widest">Nome</label>
                  <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} className="w-full bg-surface-container-low border border-outline-variant/20 rounded-xl p-4 font-black italic text-xl text-on-surface uppercase" />
                </div>
                <div className="space-y-2">
                  <label className="font-label text-[10px] font-bold text-on-surface-variant uppercase tracking-widest">Bio (max 120)</label>
                  <textarea value={editBio} onChange={(e) => setEditBio(e.target.value.slice(0, 120))} rows={3} className="w-full bg-surface-container-low border border-outline-variant/20 rounded-xl p-4 font-bold text-sm text-on-surface" placeholder="Sua bio..." />
                </div>
                
                <div className="space-y-4 pt-4 border-t border-outline-variant/10">
                  <div className="flex items-center gap-2 mb-2">
                    <QrCode size={16} className="text-primary" />
                    <label className="font-label text-[10px] font-black text-on-surface uppercase tracking-widest">Configurações PIX (Para Incentivos)</label>
                  </div>
                  <div className="flex gap-2 overflow-x-auto no-scrollbar pb-2">
                    {['cpf', 'email', 'phone', 'random'].map((type) => (
                      <button
                        key={type}
                        type="button"
                        onClick={() => setEditPixType(type as any)}
                        className={cn(
                          "px-4 py-2 rounded-full font-label text-[9px] font-bold uppercase tracking-widest transition-all border whitespace-nowrap",
                          editPixType === type ? "bg-primary text-on-primary border-primary" : "bg-surface-container-low text-on-surface-variant border-outline-variant/20"
                        )}
                      >
                        {type === 'random' ? 'ALEATÓRIA' : type.toUpperCase()}
                      </button>
                    ))}
                  </div>
                  <input 
                    type="text" 
                    value={editPixKey}
                    onChange={(e) => setEditPixKey(e.target.value)}
                    placeholder="Sua chave Pix"
                    className="w-full bg-surface-container-low border border-outline-variant/20 rounded-xl p-4 font-bold text-sm text-on-surface uppercase tracking-[0.1em]"
                  />
                  <p className="text-[9px] font-bold text-on-surface-variant/60 uppercase leading-tight">
                    * Mantenha sua chave Pix atualizada para receber premiações automaticamente no final da temporada.
                  </p>
                </div>

                <button onClick={handleUpdateProfile} disabled={loading} className="w-full h-16 bg-primary text-on-primary font-headline italic font-black text-xl rounded-xl flex items-center justify-center gap-3 active:scale-95 transition-all">
                  {loading ? "SALVANDO..." : "SALVAR ALTERAÇÕES"}
                  <Check size={20} />
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      <IGAAuditModal
        isOpen={showIGAModal}
        onClose={() => setShowIGAModal(false)}
        auditData={(user as any)?.igaAudit || (user ? calculateWeeklyIGA([], { age: user.age, weightKg: user.weight, maxHeartRate: user.maxHeartRate }) : null)}
        userName={user?.name}
      />
    </div>
  );
}

function StatBox({ label, value, subtitle, icon, onClick, highlight }: any) {
  return (
    <div 
      onClick={onClick}
      className={cn(
        "bg-surface-container/90 backdrop-blur-md rounded-[24px] md:rounded-[32px] p-4 md:p-6 border shadow-xl transition-all group relative overflow-hidden flex flex-col justify-between min-h-[100px] md:min-h-0",
        highlight ? "border-emerald-500/40 hover:border-emerald-500/70 bg-emerald-500/10" : "border-[#F5A623]/25 hover:border-primary/50",
        onClick && "cursor-pointer active:scale-95"
      )}
    >
      <div className="absolute top-0 right-0 p-3 md:p-4 opacity-[0.08] group-hover:scale-110 transition-transform">
        {icon}
      </div>
      <div className="flex items-center justify-between mb-2 md:mb-6">
        <span className="font-label text-[7px] md:text-[9px] font-black text-white/80 uppercase tracking-[0.2em]">{label}</span>
      </div>
      <div className="space-y-0.5 md:space-y-1">
        <span className="block font-headline italic font-black text-2xl md:text-4xl text-white tracking-tighter leading-none">{value}</span>
        <span className={cn("block font-label text-[7px] md:text-[8px] font-black uppercase tracking-widest truncate", highlight ? "text-emerald-400 font-bold" : "text-[#F5A623]")}>{subtitle}</span>
      </div>
    </div>
  );
}

function AchievementCard({ achievement, onShare }: { achievement: Achievement; onShare: () => void }) {
  return (
    <div className="p-6 bg-surface-container border border-outline-variant/10 rounded-3xl flex items-center gap-6 group hover:translate-y-[-4px] transition-all">
      <div className="w-16 h-16 rounded-[24px] bg-primary/10 flex items-center justify-center text-3xl group-hover:scale-110 transition-transform shrink-0">
        {achievement.icon}
      </div>
      <div className="flex-grow min-w-0">
        <h4 className="font-headline italic font-black text-lg uppercase tracking-tighter text-on-surface truncate">
          {achievement.name}
        </h4>
        <p className="text-[10px] font-bold text-on-surface-variant uppercase tracking-widest mb-3">CONQUISTA SEASON 01</p>
        <button 
          onClick={onShare}
          className="flex items-center gap-2 text-primary font-black text-[10px] uppercase tracking-widest hover:opacity-70 active:scale-95 transition-all"
        >
          <Share2 size={12} />
          Compartilhar
        </button>
      </div>
    </div>
  );
}

function SeasonHistoryItem({ season, status, rank, xp, isCurrent }: any) {
  return (
    <div className={cn(
      "p-6 rounded-3xl flex items-center justify-between transition-all",
      isCurrent ? "bg-primary/5 border border-primary/20 shadow-lg" : "bg-surface-container-low border border-outline-variant/10"
    )}>
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Trophy size={16} className={isCurrent ? "text-primary" : "text-on-surface-variant"} />
          <h4 className="font-headline italic font-black text-xl uppercase tracking-tighter">{season}</h4>
        </div>
        <div className="flex items-center gap-3">
          <span className={cn("text-[9px] font-black px-2 py-0.5 rounded-full uppercase", isCurrent ? "bg-primary text-on-primary" : "bg-outline-variant/20 text-on-surface-variant")}>
            {status}
          </span>
          <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-widest">{xp.toLocaleString()} XP TOTAL</span>
        </div>
      </div>
      <div className="text-right">
        <span className={cn("block font-headline italic font-black text-4xl leading-none", isCurrent ? "text-primary" : "text-on-surface")}>
          {rank}
        </span>
        <span className="text-[9px] font-bold text-on-surface-variant uppercase tracking-widest">POSIÇÃO FINAL</span>
      </div>
    </div>
  );
}
