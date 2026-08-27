import React, { useEffect, useState, useRef } from 'react';
import { MapPin, Award, TrendingUp, Medal, Star, Sun, Dumbbell, Flame, ChevronRight, Edit, LogOut, Bell, Camera, X, Check, BellOff, ShieldAlert, Share2, Copy, Utensils, Wallet, Calendar, Heart, Trophy, Building2, Globe, QrCode, Shield, Crown, RefreshCw, Activity as ActivityIcon, Settings as SettingsIcon, Trash2, Watch, Target, LockKeyhole, BarChart3, Landmark, Crosshair, CircleCheck, Mountain, BadgeCheck, HeartPulse } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { auth, db } from '../firebase';
import { doc, collection, query, where, orderBy, getDocs } from 'firebase/firestore';
import { UserProfile, Achievement } from '../types';
import { fitnessService } from '../services/fitnessService';
import { userService } from '../services/userService';
import { rankingService } from '../services/rankingService';
import { activityService } from '../services/activityService';
import { runningService, RunSession } from '../services/runningService';
import { stravaService, StravaStatus } from '../services/stravaService';
import { RunShareCard } from '../components/RunShareCard';
import { AchievementShareCard } from '../components/AchievementShareCard';
import { ACHIEVEMENTS } from '../achievements';
import { cn, compressImage } from '../lib/utils';
import { WearableManager } from '../services/wearables/WearableManager';
import type { WearableConfig } from '../services/wearables/types';

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
  const [wearableConfig, setWearableConfig] = useState<WearableConfig | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (user) {
      const loadWearableConfig = async () => {
        try {
          const config = await WearableManager.getInstance().loadConfig();
          setWearableConfig(config);
        } catch (err) {
          console.warn('[Profile] Aviso ao carregar o estado das conexões:', err);
        }
      };
      loadWearableConfig();
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
            setWearableConfig(await WearableManager.getInstance().loadConfig());
            
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

  if (!user) return null;

  // #244: onEdit/onAudit chamavam setIsEditing/setShowIGAModal, mas os modais
  // que dependiam desses states ficaram num bloco de JSX morto (Profile()
  // tinha um `return` antecipado pra ProfileReference e todo o codigo depois
  // dele -- ~750 linhas -- nunca era alcancado). Resultado pratico: clicar no
  // nome (editar perfil) ou no card "IGA" (ver auditoria) nao abria nada.
  // Restaurados aqui como irmaos do ProfileReference, reusando os mesmos
  // states/handlers que ja existiam (nada de logica nova). O campo PIX que
  // existia neste modal foi removido -- hoje ele mora na Carteira real
  // (/profile/wallet, ProfileSecondary.tsx), ter os dois editaveis criaria
  // duas fontes de verdade pra um mesmo dado.
  return (
    <>
      <ProfileReference
        user={user}
        progress={progress}
        onEdit={() => setIsEditing(true)}
        onPhotoChange={handlePhotoChange}
        photoInputRef={fileInputRef}
        onAudit={() => setShowIGAModal(true)}
        onNavigate={navigate}
        onLogout={handleLogout}
        stravaConnected={Boolean(stravaStatus?.connected)}
        appleHealthConnected={Boolean(wearableConfig?.appleHealthConnected)}
        healthConnectConnected={Boolean(wearableConfig?.healthConnectConnected)}
      />

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
        auditData={(user as any)?.igaAudit || calculateWeeklyIGA([], { age: user.age, weightKg: user.weight, maxHeartRate: user.maxHeartRate })}
        userName={user?.displayName}
      />
    </>
  );

}

function ProfileReference({
  user,
  progress,
  onEdit,
  onPhotoChange,
  photoInputRef,
  onAudit,
  onNavigate,
  onLogout,
  stravaConnected,
  appleHealthConnected,
  healthConnectConnected
}: {
  user: any;
  progress: ReturnType<typeof getXPProgress>;
  onEdit: () => void;
  onPhotoChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  photoInputRef: React.RefObject<HTMLInputElement | null>;
  onAudit: () => void;
  onNavigate: (path: string) => void;
  onLogout: () => void;
  stravaConnected: boolean;
  appleHealthConnected: boolean;
  healthConnectConnected: boolean;
}) {
  const level = getLevelFromXP(user.xp || 0);
  // So o primeiro nome no Perfil -- nome completo ficava grande demais e
  // truncava com "...", pedido explicito do usuario para mostrar so o
  // primeiro nome aqui (igual ja fazia a Home).
  const firstName = (user.displayName || '').trim().split(' ')[0] || user.displayName;
  // #236: cada card abre o fluxo DA SUA integracao, nao a lista generica.
  // Quem ja esta conectado vai para a tela de dispositivos (para poder revisar
  // ou desconectar); quem nao esta cai direto no fluxo de conexao daquele
  // provedor (?connect=<id>), sem precisar procurar a integracao de novo.
  const connectionItems = [
    { name: 'Apple Health', id: 'apple_health', icon: <Heart size={21} fill="currentColor" />, className: 'profile-provider-apple', connected: appleHealthConnected },
    { name: 'Health Connect', id: 'health_connect', icon: <ActivityIcon size={22} />, className: 'profile-provider-health', connected: healthConnectConnected },
    { name: 'Strava', id: 'strava', icon: <Mountain size={22} />, className: 'profile-provider-strava', connected: stravaConnected }
  ];
  const menuItems = [
    { label: 'Dispositivos e relógios', detail: 'Gerencie seus dispositivos e sincronizações', icon: <Watch size={27} />, action: () => onNavigate('/profile/wearables') },
    { label: 'Saúde', detail: 'Dados, métricas e relatório de saúde', icon: <HeartPulse size={27} />, action: () => onNavigate('/health') },
    { label: 'Minha academia', detail: user.gymName || 'Vincule sua academia', icon: <Landmark size={27} />, action: () => onNavigate('/profile/academy') },
    { label: 'Carteira', detail: 'Meu saldo, histórico e saques', icon: <Wallet size={27} />, action: () => onNavigate('/profile/wallet') },
    { label: 'Metas', detail: 'Defina e acompanhe suas metas', icon: <Crosshair size={27} />, action: () => onNavigate('/profile/goals') },
    { label: 'Segurança e privacidade', detail: 'Dados, permissões e segurança da conta', icon: <LockKeyhole size={27} />, action: () => onNavigate('/profile/security') },
    { label: 'Configurações', detail: 'Preferências do app', icon: <SettingsIcon size={27} />, action: () => onNavigate('/profile/preferences') }
  ];

  return (
    <div className="profile-reference-screen min-h-screen pb-28 text-white">
      <input ref={photoInputRef} type="file" className="hidden" accept="image/*" onChange={onPhotoChange} />
      <div className="profile-content mx-auto w-full max-w-[430px] px-4 pt-5">
        <header className="profile-heading">
          <h1>Perfil</h1>
          <p>Gerencie sua conta e sua performance</p>
        </header>

        <section className="profile-identity">
          <button onClick={() => photoInputRef.current?.click()} className="profile-avatar" aria-label="Alterar foto de perfil">
            <img
              src={user.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.uid}`}
              alt={`Foto de ${user.displayName}`}
              referrerPolicy="no-referrer"
              onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.uid || 'athlete'}`; }}
            />
          </button>
          <div className="profile-identity-details min-w-0 flex-1">
            <div className="profile-name-line">
              <button onClick={onEdit} className="profile-name truncate text-left">{firstName}</button>
              {user.subscriptionTier === 'performance' && <button onClick={() => onNavigate('/performance')} className="profile-pro">PRO</button>}
              <BadgeCheck size={25} className="profile-association shrink-0" />
            </div>
            <p className="profile-gym"><Shield size={18} /> {user.gymName || 'Invictus Gym'}</p>
            <div className="profile-levels"><span className="profile-level">LVL {level}</span><span className="profile-xp">{progress.xpInCurrentLevel} / {progress.xpNeededForNextLevel} XP</span></div>
            <div className="profile-progress"><div className="profile-xp-track"><div style={{ width: `${progress.percentage}%` }} /></div><strong>{Math.round(progress.percentage)}%</strong></div>
          </div>
        </section>

        <section className="profile-stats">
          <button type="button" className="profile-stat"><Flame size={31} /><strong>{user.streak || 0}</strong><span>Sequência<br />dias</span></button>
          <button type="button" className="profile-stat" onClick={onAudit}><Trophy size={31} /><strong>{(user.weeklyScore || 0).toLocaleString('pt-BR')}</strong><span>IGA</span></button>
          <button type="button" className="profile-stat" onClick={() => onNavigate('/achievements')}><Star size={31} /><strong>{user.achievements?.length || 0}</strong><span>Conquistas</span></button>
          <button type="button" className="profile-stat"><BarChart3 size={31} /><strong>{Math.max(1, Math.ceil((user.streak || 0) / 7))}</strong><span>Semanas<br />ativas</span></button>
        </section>

        <section className="profile-panel profile-connections">
          <div className="profile-panel-heading"><h2>Conexões</h2><button onClick={() => onNavigate('/profile/wearables')}>Gerenciar</button></div>
          {connectionItems.map((item, index) => (
            <button key={item.name} onClick={() => onNavigate(item.connected ? '/profile/wearables' : `/profile/wearables?connect=${item.id}`)} className={cn('profile-connection', index > 0 && 'profile-row-divider')}>
              <span className={cn('profile-provider', item.className)}>{item.icon}</span>
              <span className="flex-1 text-left"><b>{item.name}</b><small>{item.connected ? 'Conectado' : 'Conectar'}</small></span>
              {item.connected && <CircleCheck className="profile-connected" size={25} />}<ChevronRight className="profile-chevron" size={25} />
            </button>
          ))}
        </section>

        <section className="profile-panel profile-menu">
          {menuItems.map((item, index) => (
            <button key={item.label} onClick={item.action} className={cn('profile-menu-item', index > 0 && 'profile-row-divider')}>
              <span className="profile-menu-icon">{item.icon}</span><span className="flex-1 text-left"><b>{item.label}</b><small>{item.detail}</small></span><ChevronRight className="profile-chevron" size={27} />
            </button>
          ))}
        </section>

        <section className="profile-brand-card">
          <img
            src="/capacete.webp"
            alt="Capacete Invictus"
            onError={(e) => {
              const target = e.currentTarget;
              if (!target.src.endsWith('/capacete.png')) {
                target.src = '/capacete.png';
              }
            }}
          />
          <div className="flex-1"><h2>Invictus Performance</h2><p>Versão 1.0.0<br />Construindo uma comunidade invencível.</p></div>
          <button onClick={onLogout}>Sair da conta <LogOut size={24} /></button>
        </section>
      </div>
    </div>
  );
}
