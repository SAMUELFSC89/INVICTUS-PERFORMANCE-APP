import React, { useState, useRef, useEffect } from 'react';
import { 
  Dumbbell, TrendingUp, MapPin, RefreshCw, CheckCircle, XCircle,
  Clock, Lock, Play, ShieldCheck, Flame, Trophy, Users, Camera, X, 
  Zap, Award, AlertCircle, ArrowRight, Sparkles, Watch, Calendar,
  Medal, Star, Building2, ChevronRight, Gift
} from 'lucide-react';
import { useNavigate, useOutletContext, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { workoutService } from '../services/workoutService';
import { activityService } from '../services/activityService';
import { userService } from '../services/userService';
import { stravaService } from '../services/stravaService';
import { VerifiedPresenceModal } from '../components/VerifiedPresenceModal';
import { auth, db } from '../firebase';
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { ActivitySession } from '../types';
import { cn } from '../lib/utils';
import { getCurrentLocation } from '../lib/locationUtils';
import { useUser } from '../UserContext';
import { PrivateChallengesTab } from '../components/PrivateChallengesTab';
import { ActivityHistorySection } from '../components/ActivityHistorySection';
import { HabitTrackerSection } from '../components/HabitTrackerSection';
import { PowerModule } from './PowerModule';

export type ChallengeCategory = 
  | 'all'
  | 'em_andamento'
  | 'diarios'
  | 'powerlift'
  | 'privados'
  | 'ranking'
  | 'conquistas';

const CATEGORY_TABS: { id: ChallengeCategory; label: string; icon: string }[] = [
  { id: 'all', label: '🌟 Todos', icon: '🌟' },
  { id: 'diarios', label: '☀️ Diários', icon: '☀️' },
  { id: 'powerlift', label: '🔥 Invictus Power Lift', icon: '🔥' },
  { id: 'privados', label: '👥 Privados', icon: '👥' },
  { id: 'ranking', label: '📊 Ranking', icon: '📊' },
  { id: 'conquistas', label: '🎖️ Conquistas', icon: '🎖️' },
];

interface CoreChallenge {
  id: 'checkin' | 'workout' | 'cardio';
  title: string;
  subtitle: string;
  description: string;
  xp: number;
  icon: React.ReactNode;
  tag: string;
  badgeColor: string;
}

const CORE_CHALLENGES: CoreChallenge[] = [
  {
    id: 'checkin',
    title: 'Check-in Presencial GPS',
    subtitle: 'Validação na Academia',
    description: 'Confirme sua presença física na academia vinculada ao seu perfil via geolocalização para liberar a rotina e somar pontos.',
    xp: 20,
    icon: <MapPin size={28} className="text-emerald-400" />,
    tag: 'Desafio Diário',
    badgeColor: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
  },
  {
    id: 'workout',
    title: 'Desafio de Força Musculação',
    subtitle: 'Treino Auditado',
    description: 'Complete uma sessão de musculação verificando presença física e tempo de execução na sala de peso.',
    xp: 40,
    icon: <Dumbbell size={28} className="text-amber-400" />,
    tag: 'Atividade Principal',
    badgeColor: 'bg-amber-500/10 text-amber-400 border-amber-500/20'
  },
  {
    id: 'cardio',
    title: 'Queima de Gordura Aeróbica',
    subtitle: 'Cardio & Esteira',
    description: 'Registre caminhada ou corrida ao ar livre/esteira com telemetria GPS ou sincronização Strava / Smartwatch.',
    xp: 30,
    icon: <TrendingUp size={28} className="text-orange-400" />,
    tag: 'Resistência & Queima',
    badgeColor: 'bg-orange-500/10 text-orange-400 border-orange-500/20'
  }
];

// All Badges & Conquistas Data
const ALL_BADGES = [
  { id: 'b-1', title: 'Primeiro Check-in Presencial', category: 'Frequência', xp: 50, icon: '📍', unlocked: true, desc: 'Realizou o primeiro check-in de geolocalização validado na academia.' },
  { id: 'b-2', title: 'Titã da Musculação', category: 'Treino', xp: 150, icon: '🏋️', unlocked: true, desc: 'Completou 10 treinos de musculação auditados por IA.' },
  { id: 'b-3', title: 'Clube dos 100KG', category: 'Power Lift', xp: 250, icon: '🏆', unlocked: true, desc: 'Supino Reto com 100 kg ou mais homologado por vídeo.' },
  { id: 'b-4', title: 'Inabalável 30 Dias', category: 'Consistência', xp: 500, icon: '⚡', unlocked: false, desc: '30 dias seguidos de treinos validados sem interrupção.' },
  { id: 'b-5', title: 'Atleta Growth', category: 'Patrocinados', xp: 200, icon: '🤝', unlocked: true, desc: 'Completou o Desafio Semanal Growth Supplements.' },
  { id: 'b-6', title: 'Cinturão de Agachamento', category: 'Power Lift', xp: 400, icon: '👑', unlocked: false, desc: 'Maior carga homologada da academia no Agachamento.' },
  { id: 'b-7', title: 'Maratonista Centauro', category: 'Cardio', xp: 300, icon: '🏃', unlocked: false, desc: 'Acumulou 50km de corrida monitorados por GPS ou Strava.' },
  { id: 'b-8', title: 'Lenda da Temporada', category: 'Temporada', xp: 1000, icon: '🎖️', unlocked: false, desc: '100 treinos concluídos na temporada 2026.' }
];

// Challenge Ranking Leaderboard Data
const CHALLENGE_LEADERBOARD = [
  { rank: 1, name: 'Lucas "Gladiador" Silva', gym: 'Invictus Jardins', xp: 4250, challengesCount: 38, avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=200' },
  { rank: 2, name: 'Beatriz Ramos', gym: 'Invictus Moema', xp: 3980, challengesCount: 34, avatar: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&q=80&w=200' },
  { rank: 3, name: 'Carlos "Iron" Mendes', gym: 'Invictus Pinheiros', xp: 3720, challengesCount: 31, avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=200' },
  { rank: 4, name: 'Mariana Duarte', gym: 'Invictus Jardins', xp: 3450, challengesCount: 29, avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&q=80&w=200' },
  { rank: 5, name: 'Thiago "Power" Alcantara', gym: 'Invictus Vila Olímpia', xp: 3100, challengesCount: 26, avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&q=80&w=200' }
];

export function Challenges() {
  const { user: profile, refreshUser } = useUser();
  const [searchParams, setSearchParams] = useSearchParams();

  // Selected Category State
  const initialCategory = (searchParams.get('category') as ChallengeCategory) || 'all';
  const [selectedCategory, setSelectedCategory] = useState<ChallengeCategory>(initialCategory);

  const { triggerXPToast } = useOutletContext<{ triggerXPToast: (p: number, m?: string) => void }>();

  // Active activity session state
  const [activeSession, setActiveSession] = useState<ActivitySession | null>(activityService.getCurrentSession());
  const [elapsedTime, setElapsedTime] = useState(0);

  // Today's completed submissions
  const [submissions, setSubmissions] = useState<Record<string, any>>({});

  // Modals & Pending Operations
  const [pendingChallenge, setPendingChallenge] = useState<CoreChallenge | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [startActivityError, setStartActivityError] = useState<string | null>(null);
  const [presenceCheckRequired, setPresenceCheckRequired] = useState(false);
  const [presenceCheckData, setPresenceCheckData] = useState<{ id: string; prompt: string } | null>(null);

  // Gym Check-in Modal States
  const [gymCheckinStatus, setGymCheckinStatus] = useState<
    'not_started' | 'checking_location' | 'eligible' | 'blocked_out_of_range' | 'blocked_no_permission' | 'blocked_low_accuracy' | 'confirmed'
  >('not_started');
  const [gymCheckinError, setGymCheckinError] = useState<string | null>(null);
  const [gymCheckinDistance, setGymCheckinDistance] = useState<number | null>(null);
  const [gymCheckinAccuracy, setGymCheckinAccuracy] = useState<number | null>(null);
  const [verifiedCheckInId, setVerifiedCheckInId] = useState<string | null>(null);
  const [checkinSuccessMessage, setCheckinSuccessMessage] = useState<string | null>(null);
  const [isPerformingCheckin, setIsPerformingCheckin] = useState(false);
  const [checkinExpiresAt, setCheckinExpiresAt] = useState<string | null>(null);
  const [timeLeftStr, setTimeLeftStr] = useState<string>('');
  const [verifiedCheckinLocation, setVerifiedCheckinLocation] = useState<{ lat: number; lng: number; accuracy?: number } | null>(null);

  // Cardio States
  const [selectedCardioType, setSelectedCardioType] = useState<string>('running');
  const [smartwatchConnected, setSmartwatchConnected] = useState<boolean>(false);
  const [watchAvgHR] = useState<number>(142);
  const [watchMaxHR] = useState<number>(175);
  const [watchCalories] = useState<number>(380);
  const [stravaConnecting, setStravaConnecting] = useState(false);

  // Load today's submissions
  const loadSubmissions = async () => {
    const firebaseUser = auth.currentUser;
    if (firebaseUser) {
      const today = new Date().toISOString().split('T')[0];
      const qSub = query(
        collection(db, 'workouts'),
        where('userId', '==', firebaseUser.uid),
        where('timestamp', '>=', today)
      );
      try {
        const snap = await getDocs(qSub);
        const subs: Record<string, any> = {};
        snap.docs.forEach(d => {
          const data = d.data();
          subs[data.type] = data;
        });
        setSubmissions(subs);
      } catch (err) {
        console.error('Error fetching submissions:', err);
      }
    }
  };

  useEffect(() => {
    loadSubmissions();
  }, [profile]);

  // Active Session Timer & Live Sync
  useEffect(() => {
    const syncSession = () => {
      const current = activityService.getCurrentSession();
      setActiveSession(current);
      if (current) {
        const startTimeMs = typeof current.startTime === 'number'
          ? current.startTime
          : new Date(current.startTime).getTime();
        const duration = Math.floor((Date.now() - startTimeMs) / 1000);
        setElapsedTime(duration);
      } else {
        setElapsedTime(0);
      }
    };

    syncSession();
    const interval = setInterval(syncSession, 1000);
    return () => clearInterval(interval);
  }, []);

  // Checkin countdown timer
  useEffect(() => {
    if (gymCheckinStatus !== 'confirmed' || !checkinExpiresAt) {
      setTimeLeftStr('');
      return;
    }

    const interval = setInterval(() => {
      const remainingMs = new Date(checkinExpiresAt).getTime() - Date.now();
      if (remainingMs <= 0) {
        setGymCheckinStatus('not_started');
        setVerifiedCheckInId(null);
        setCheckinExpiresAt(null);
        setGymCheckinError('Seu check-in expirou. Realize um novo check-in para iniciar seu treino.');
        setTimeLeftStr('');
        clearInterval(interval);
      } else {
        const mins = Math.floor(remainingMs / 60000);
        const secs = Math.floor((remainingMs % 60000) / 1000);
        setTimeLeftStr(`${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [gymCheckinStatus, checkinExpiresAt]);

  // Gym Proximity Check
  const evaluateGymProximityCheck = async () => {
    setGymCheckinStatus('checking_location');
    setGymCheckinError(null);
    setGymCheckinDistance(null);
    setGymCheckinAccuracy(null);

    if (!profile?.gymId) {
      setGymCheckinStatus('blocked_out_of_range');
      setGymCheckinError('Academia não cadastrada. Por favor, vincule uma academia no seu perfil para fazer check-in.');
      return;
    }

    let location: { lat: number; lng: number; accuracy?: number };
    try {
      location = await getCurrentLocation(true, 15000);
      setVerifiedCheckinLocation(location);
      const acc = location.accuracy !== undefined ? Math.round(location.accuracy) : null;
      setGymCheckinAccuracy(acc);

      if (acc !== null && acc > 30) {
        setGymCheckinStatus('blocked_low_accuracy');
        setGymCheckinError(`📍 Sinal GPS impreciso (${acc}m). O check-in exige precisão de no máximo 30 metros. Vá para uma área aberta e tente novamente.`);
        return;
      }
    } catch (err: any) {
      console.error('GPS error:', err);
      setGymCheckinStatus('blocked_no_permission');
      setGymCheckinError(err?.message || 'Ative a localização do dispositivo para confirmar presença.');
      return;
    }

    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) {
        setGymCheckinStatus('blocked_no_permission');
        setGymCheckinError('Sessão expirada. Faça login novamente.');
        return;
      }

      const response = await fetch('/api/gyms/checkin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({
          action: 'verify',
          latitude: location.lat,
          longitude: location.lng,
          accuracy: location.accuracy || 15,
          isMock: false
        })
      });

      const data = await response.json();
      if (data.distanceMeters !== undefined) {
        setGymCheckinDistance(data.distanceMeters);
      }
      if (!response.ok) {
        setGymCheckinStatus(data.status || 'blocked_out_of_range');
        setGymCheckinError(data.error || 'Não foi possível confirmar sua proximidade com a academia.');
      } else {
        setGymCheckinStatus(data.status);
        if (data.status !== 'eligible') {
          setGymCheckinError(data.error || data.message || '📍 Aproxime-se da sua academia para realizar o check-in.');
        }
      }
    } catch (err: any) {
      console.error('Checkin validation error:', err);
      setGymCheckinStatus('blocked_out_of_range');
      setGymCheckinError('Falha ao comunicar com o servidor de check-in.');
    }
  };

  const handleConfirmGymCheckin = async () => {
    if (gymCheckinStatus !== 'eligible' || !verifiedCheckinLocation) return;
    setIsPerformingCheckin(true);
    setGymCheckinError(null);

    try {
      const location = await getCurrentLocation(true, 15000);
      const user = auth.currentUser;
      if (!user) throw new Error('Usuário não autenticado.');

      const idToken = await user.getIdToken();

      const response = await fetch('/api/gyms/checkin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({
          action: 'confirm',
          latitude: location.lat,
          longitude: location.lng,
          accuracy: location.accuracy || 15,
          isMock: false,
          deviceId: `web_${Math.random().toString(36).substring(2, 10)}`,
          deviceFingerprint: `usr_${user.uid}`
        })
      });

      if (!response.ok) {
        const errJson = await response.json();
        throw new Error(errJson.error || 'Check-in não aprovado.');
      }

      const resJson = await response.json();
      setVerifiedCheckInId(resJson.checkInId);
      setCheckinExpiresAt(resJson.expiresAt);
      setGymCheckinStatus('confirmed');
      setCheckinSuccessMessage(`Check-in verificado com sucesso na academia "${profile?.gymName || 'Academia'}"! Presença confirmada (+20 XP).`);
      
      triggerXPToast(20, 'Check-in Presencial Confirmado! 📍');
      await refreshUser();
    } catch (err: any) {
      console.error('Error confirming checkin:', err);
      setGymCheckinError(err?.message || 'Erro ao processar check-in.');
    } finally {
      setIsPerformingCheckin(false);
    }
  };

  // Open Challenge Modal
  const handleOpenChallenge = (challenge: CoreChallenge) => {
    setPendingChallenge(challenge);
    setStartActivityError(null);
    if (challenge.id === 'checkin' || challenge.id === 'workout') {
      evaluateGymProximityCheck();
    }
  };

  // Start Session (Workout / Cardio)
  const handleStartActivity = async (type: 'workout' | 'cardio') => {
    setStartActivityError(null);
    try {
      const session = await activityService.startSession(
        type,
        undefined,
        type === 'cardio' ? selectedCardioType : undefined,
        type === 'cardio' && smartwatchConnected ? {
          avgHR: watchAvgHR,
          maxHR: watchMaxHR,
          calories: watchCalories,
          source: 'manual_smartwatch'
        } : undefined,
        verifiedCheckInId || undefined
      );
      setActiveSession(session);
      setPendingChallenge(null);
    } catch (err: any) {
      console.error('Error starting activity:', err);
      let rawMsg = err.message || 'Falha ao iniciar atividade.';
      if (rawMsg.startsWith('{') && rawMsg.endsWith('}')) {
        try {
          const parsed = JSON.parse(rawMsg);
          rawMsg = parsed.title ? `${parsed.title}\n\n${parsed.message}` : (parsed.message || rawMsg);
        } catch (e) {
          // keep rawMsg
        }
      }
      setStartActivityError(rawMsg);
    }
  };

  // Strava Authorization
  const handleConnectStrava = async () => {
    setStravaConnecting(true);
    try {
      const url = await stravaService.authorize('/challenges');
      if (url) {
        window.location.href = url;
      }
    } catch (err: any) {
      setError('Erro ao conectar Strava: ' + (err.message || err));
    } finally {
      setStravaConnecting(false);
    }
  };

  // End Workout/Cardio Session
  const handleEndActivity = async () => {
    if (!activeSession) return;
    setLoading(true);
    setError(null);

    try {
      const res = await activityService.endSession();
      const points = res.workout?.points || (activeSession.type === 'workout' ? 40 : 30);
      setActiveSession(null);
      
      if (res.message && res.validation?.success === false) {
        triggerXPToast(0, 'Sessão encerrada.');
        setError(res.message);
      } else {
        triggerXPToast(points, `${activeSession.type === 'workout' ? 'Treino de Musculação' : 'Queima de Gordura'} Concluído! 🔥`);
      }
      await refreshUser();
      await loadSubmissions();
    } catch (err: any) {
      console.error('Error ending activity:', err);
      activityService.cancelSession();
      setActiveSession(null);
      setError(err.message || 'Falha ao encerrar atividade.');
    } finally {
      setLoading(false);
    }
  };

  // Cancel/Discard Workout/Cardio Session
  const handleCancelActivity = async () => {
    if (confirm('Deseja realmente descartar e cancelar a sessão em andamento? Nenhum ponto será salvo.')) {
      activityService.cancelSession();
      setActiveSession(null);
      setError(null);
      triggerXPToast(0, 'Sessão descartada.');
    }
  };

  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) {
      return `${h}h ${m.toString().padStart(2, '0')}m ${s.toString().padStart(2, '0')}s`;
    }
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="min-h-screen bg-surface-dark pb-28 text-on-surface pt-4 px-4 max-w-5xl mx-auto space-y-6">
      
      {/* HEADER BANNER */}
      <div className="bg-gradient-to-br from-surface-card via-surface-card to-surface-card/60 p-6 rounded-[28px] border border-white/10 shadow-xl relative overflow-hidden">
        <div className="absolute -right-10 -top-10 w-48 h-48 bg-primary/10 rounded-full blur-3xl pointer-events-none" />
        
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Trophy className="text-primary" size={26} />
              <h1 className="text-2xl sm:text-3xl font-black font-headline tracking-tight uppercase italic text-white">
                Central de Desafios & Evolução
              </h1>
            </div>
            <p className="text-xs text-on-surface-variant max-w-lg">
              Escolha sua modalidade, cumpra metas diárias, participe do Power Lift oficial e supere seus limites para conquistar badges e ranking.
            </p>
          </div>

          <div className="flex items-center gap-3 bg-black/40 backdrop-blur-md px-4 py-2.5 rounded-2xl border border-white/10 shrink-0">
            <Zap className="text-primary" size={20} />
            <div>
              <span className="text-[9px] font-mono text-on-surface-variant uppercase block">Seu Nível Atual</span>
              <span className="text-sm font-headline italic font-black text-white">
                Nível {profile?.level || 1} • <span className="text-primary">{profile?.xp || 0} XP</span>
              </span>
            </div>
          </div>
        </div>

        {/* CATEGORIES PILLS BAR */}
        <div className="mt-6 pt-4 border-t border-white/10 flex gap-2 overflow-x-auto no-scrollbar pb-1">
          {CATEGORY_TABS.map((cat) => (
            <button
              key={cat.id}
              onClick={() => {
                setSelectedCategory(cat.id);
                setSearchParams({ category: cat.id });
              }}
              className={cn(
                "px-4 py-2.5 rounded-2xl text-xs font-headline font-black italic uppercase tracking-wider transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 shrink-0 border",
                selectedCategory === cat.id
                  ? "bg-primary text-black border-primary shadow-lg shadow-primary/20 scale-105"
                  : "bg-surface-container/60 hover:bg-surface-container border-white/10 text-on-surface-variant hover:text-white"
              )}
            >
              <span>{cat.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ACTIVE SESSION RUNNING BANNER */}
      {activeSession && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-gradient-to-r from-amber-500/20 via-orange-500/20 to-primary/20 border border-primary/40 p-5 rounded-2xl shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4 relative overflow-hidden"
        >
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-primary/20 border border-primary/40 flex items-center justify-center text-primary animate-pulse shrink-0 mt-0.5">
              <Flame size={24} />
            </div>
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-widest text-primary flex items-center gap-1">
                  Sessão em Andamento
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping inline-block ml-1" />
                </span>

                {elapsedTime >= 1800 ? (
                  <span className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-[10px] font-mono font-bold px-2 py-0.5 rounded-md flex items-center gap-1">
                    <CheckCircle size={12} /> Meta de 30 min Concluída!
                  </span>
                ) : (
                  <span className="bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[10px] font-mono font-bold px-2 py-0.5 rounded-md">
                    Meta de 30 min em andamento (Faltam {Math.ceil((1800 - elapsedTime) / 60)} min)
                  </span>
                )}
              </div>

              <h3 className="text-lg font-bold text-white uppercase italic">
                {activeSession.type === 'workout' ? 'Treino de Musculação' : 'Queima de Gordura (Cardio)'}
              </h3>
              <p className="text-xs text-on-surface-variant flex items-center gap-1">
                <Clock size={13} className="text-primary" /> Tempo decorrido: <strong className="text-white font-mono text-sm">{formatTime(elapsedTime)}</strong>
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0 self-stretch md:self-auto justify-end">
            <button
              onClick={handleEndActivity}
              disabled={loading}
              className="flex-1 md:flex-initial px-5 py-3 bg-primary hover:bg-primary-hover text-black font-headline font-black italic text-xs uppercase tracking-wider rounded-xl shadow-lg transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              <CheckCircle size={16} />
              <span>{loading ? 'Finalizando...' : 'Finalizar Atividade'}</span>
            </button>

            <button
              onClick={handleCancelActivity}
              disabled={loading}
              className="px-4 py-3 bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/30 text-rose-300 font-headline font-black italic text-xs uppercase tracking-wider rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
              title="Descartar e encerrar sessão"
            >
              <XCircle size={16} />
              <span>Descartar</span>
            </button>
          </div>
        </motion.div>
      )}

      {/* DYNAMIC VIEW CONTENT BASED ON SELECTED CATEGORY */}

      {/* 1. POWER LIFT CATEGORY VIEW */}
      {selectedCategory === 'powerlift' ? (
        <div className="bg-surface-card border border-white/10 rounded-[28px] p-4 sm:p-6 shadow-2xl">
          <PowerModule />
        </div>
      ) : selectedCategory === 'privados' ? (
        /* 2. PRIVATE CHALLENGES CATEGORY VIEW */
        <PrivateChallengesTab />
      ) : selectedCategory === 'ranking' ? (
        /* 3. RANKING LEADERBOARD VIEW */
        <div className="bg-surface-card border border-white/10 rounded-[28px] p-6 space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-[10px] font-mono font-black text-primary uppercase tracking-widest block">
                📊 CLASSIFICAÇÃO DOS ATLETAS
              </span>
              <h2 className="text-xl font-headline italic font-black text-white uppercase">
                Ranking da Academia & Global
              </h2>
            </div>
            <span className="text-xs font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-3 py-1 rounded-xl">
              Atualizado em Tempo Real 🟢
            </span>
          </div>

          <div className="space-y-3">
            {CHALLENGE_LEADERBOARD.map((item) => (
              <div
                key={item.rank}
                className={cn(
                  "p-4 rounded-2xl border flex items-center justify-between gap-4 transition-all",
                  item.rank === 1 ? "bg-amber-500/10 border-amber-500/40 shadow-lg" : "bg-surface-container-low border-white/5 hover:border-white/20"
                )}
              >
                <div className="flex items-center gap-3">
                  <div className={cn(
                    "w-8 h-8 rounded-xl font-headline italic font-black text-sm flex items-center justify-center shrink-0",
                    item.rank === 1 ? "bg-amber-400 text-black" : item.rank === 2 ? "bg-slate-300 text-black" : item.rank === 3 ? "bg-amber-700 text-white" : "bg-white/10 text-on-surface-variant"
                  )}>
                    #{item.rank}
                  </div>
                  <img src={item.avatar} alt={item.name} className="w-10 h-10 rounded-full object-cover border border-white/20 shrink-0" />
                  <div>
                    <h4 className="font-bold text-sm text-white">{item.name}</h4>
                    <p className="text-xs text-on-surface-variant">{item.gym} • {item.challengesCount} desafios concluídos</p>
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <span className="text-sm font-headline italic font-black text-primary block">{item.xp} XP</span>
                  <span className="text-[9px] font-mono text-on-surface-variant uppercase">Total Acumulado</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : selectedCategory === 'conquistas' ? (
        /* 4. CONQUISTAS & BADGES GRID VIEW */
        <div className="bg-surface-card border border-white/10 rounded-[28px] p-6 space-y-6">
          <div>
            <span className="text-[10px] font-mono font-black text-primary uppercase tracking-widest block">
              🎖️ GALERIA DE TROFÉUS E CONQUISTAS
            </span>
            <h2 className="text-xl font-headline italic font-black text-white uppercase">
              Badges & Medalhas Desbloqueadas
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            {ALL_BADGES.map((badge) => (
              <div
                key={badge.id}
                className={cn(
                  "p-4 rounded-2xl border flex flex-col justify-between gap-3 text-center transition-all",
                  badge.unlocked ? "bg-primary/5 border-primary/30" : "bg-surface-container-low/40 border-white/5 opacity-60"
                )}
              >
                <div className="space-y-2">
                  <div className="text-4xl mx-auto">{badge.icon}</div>
                  <h4 className="font-headline italic font-black text-sm text-white uppercase">{badge.title}</h4>
                  <p className="text-[11px] text-on-surface-variant line-clamp-3">{badge.desc}</p>
                </div>

                <div className="pt-2 border-t border-white/5 flex items-center justify-between text-[10px] font-mono">
                  <span className="text-primary font-bold">+{badge.xp} XP</span>
                  <span className={badge.unlocked ? "text-emerald-400 font-bold" : "text-on-surface-variant"}>
                    {badge.unlocked ? 'Desbloqueado ✅' : 'Bloqueado 🔒'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        /* 5. DEFAULT CHALLENGES CATALOGUE VIEW */
        <div className="space-y-6">
          
          {/* POWER LIFT HIGHLIGHT BANNER (If in 'all', 'diarios', 'em_andamento') */}
          {(selectedCategory === 'all' || selectedCategory === 'diarios' || selectedCategory === 'em_andamento') && (
            <div className="bg-gradient-to-r from-amber-500/20 via-surface-container-high to-primary/20 border border-amber-500/40 p-6 rounded-[28px] relative overflow-hidden shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
              <div className="space-y-1 relative z-10 max-w-xl">
                <span className="bg-amber-500/20 text-amber-400 border border-amber-500/30 text-[9px] font-mono font-black uppercase tracking-wider px-2.5 py-0.5 rounded-full inline-flex items-center gap-1">
                  <Flame size={12} /> Categoria Destaque
                </span>
                <h3 className="text-xl sm:text-2xl font-headline italic font-black text-white uppercase">
                  🔥 Invictus Power Lift
                </h3>
                <p className="text-xs text-on-surface-variant">
                  Supino • Agachamento • Levantamento Terra. Registre marcas pessoais de carga com homologação de vídeo por IA e dispute o cinturão da sua academia!
                </p>
              </div>

              <button
                onClick={() => {
                  setSelectedCategory('powerlift');
                  setSearchParams({ category: 'powerlift' });
                }}
                className="px-5 py-3 bg-amber-400 hover:bg-amber-300 text-black font-headline font-black italic text-xs uppercase tracking-wider rounded-xl shadow-lg transition-all flex items-center gap-2 shrink-0 cursor-pointer"
              >
                <span>Acessar Desafios de Carga</span>
                <ArrowRight size={16} />
              </button>
            </div>
          )}

          {/* CORE DAILY CHALLENGES SECTION */}
          {(selectedCategory === 'all' || selectedCategory === 'diarios' || selectedCategory === 'em_andamento') && (
            <div className="space-y-4">
              <div className="flex items-center justify-between px-1">
                <h2 className="text-sm font-bold text-on-surface-variant uppercase tracking-widest flex items-center gap-2">
                  <Zap size={16} className="text-primary" /> Desafios Principais do Dia
                </h2>
                <span className="text-xs text-on-surface-variant">Validação GPS e Presença</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {CORE_CHALLENGES.map((ch) => {
                  const isCompletedToday = Boolean(
                    ch.id === 'checkin'
                      ? (gymCheckinStatus === 'confirmed' || verifiedCheckInId)
                      : submissions[ch.id]
                  );
                  const isRunning = activeSession?.type === ch.id;

                  return (
                    <div
                      key={ch.id}
                      className={cn(
                        "bg-surface-card border rounded-2xl p-5 flex flex-col justify-between transition-all relative overflow-hidden group hover:border-primary/40",
                        isCompletedToday
                          ? "border-emerald-500/30 bg-emerald-950/10"
                          : isRunning
                          ? "border-primary/50 bg-primary/5"
                          : "border-white/10"
                      )}
                    >
                      <div>
                        <div className="flex items-start justify-between gap-3 mb-3">
                          <div className="flex items-center gap-3">
                            <div className="p-3 bg-white/5 rounded-xl border border-white/10 group-hover:scale-105 transition-transform">
                              {ch.icon}
                            </div>
                            <div>
                              <span className={cn("text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md border", ch.badgeColor)}>
                                {ch.tag}
                              </span>
                              <h3 className="text-base font-bold text-white mt-1 group-hover:text-primary transition-colors">
                                {ch.title}
                              </h3>
                            </div>
                          </div>

                          <div className="bg-primary/10 border border-primary/20 text-primary px-2.5 py-1 rounded-xl text-xs font-black font-mono flex items-center gap-1">
                            <Award size={12} />
                            +{ch.xp} XP
                          </div>
                        </div>

                        <p className="text-xs text-on-surface-variant line-clamp-2 mb-4 leading-relaxed">
                          {ch.description}
                        </p>
                      </div>

                      <div className="pt-3 border-t border-white/5 flex items-center justify-between">
                        {isCompletedToday ? (
                          <div className="flex items-center gap-2 text-emerald-400 text-xs font-bold">
                            <CheckCircle size={16} />
                            <span>Concluído Hoje</span>
                          </div>
                        ) : isRunning ? (
                          <div className="flex items-center gap-2 text-primary text-xs font-bold animate-pulse">
                            <Flame size={16} />
                            <span>Em Andamento</span>
                          </div>
                        ) : (
                          <div className="text-xs text-on-surface-variant flex items-center gap-1">
                            <ShieldCheck size={14} className="text-emerald-400" />
                            <span>Validação Antifraude</span>
                          </div>
                        )}

                        <button
                          onClick={() => handleOpenChallenge(ch)}
                          disabled={isCompletedToday && ch.id !== 'checkin'}
                          className={cn(
                            "px-4 py-2 rounded-xl text-xs font-headline font-black italic uppercase tracking-wider transition-all flex items-center gap-1.5 shadow-md cursor-pointer",
                            isCompletedToday
                              ? "bg-white/5 text-on-surface-variant cursor-not-allowed border border-white/10"
                              : "bg-primary text-black hover:bg-primary-hover"
                          )}
                        >
                          {ch.id === 'checkin'
                            ? (verifiedCheckInId ? 'Check-in Ativo' : 'Fazer Check-in')
                            : ch.id === 'workout'
                            ? (isRunning ? 'Ver Treino' : 'Iniciar Treino')
                            : (isRunning ? 'Ver Cardio' : 'Iniciar Cardio')}
                          <ArrowRight size={14} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* CRIAR HÁBITO — vinculado exclusivamente à área de Cardio/Desafios */}
      <div className="mb-4">
        <HabitTrackerSection />
      </div>

      {/* HISTÓRICO DE ATIVIDADES NO FIM DA ABA DESAFIOS */}
      <ActivityHistorySection />

      {/* MODAL: Pending Challenge (Check-in / Workout / Cardio setup) */}
      <AnimatePresence>
        {pendingChallenge && (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-surface-card border border-white/10 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-5 relative"
            >
              <button
                onClick={() => setPendingChallenge(null)}
                className="absolute top-4 right-4 text-on-surface-variant hover:text-white p-1 rounded-lg bg-white/5 cursor-pointer"
              >
                <X size={18} />
              </button>

              <div className="flex items-center gap-3">
                <div className="p-3 bg-primary/10 border border-primary/20 rounded-xl text-primary">
                  {pendingChallenge.icon}
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white uppercase italic">
                    {pendingChallenge.title}
                  </h3>
                  <p className="text-xs text-on-surface-variant">{pendingChallenge.subtitle}</p>
                </div>
              </div>

              {/* Workout / Check-in Flow */}
              {pendingChallenge.id === 'checkin' && (
                <div className="space-y-4">
                  <div className="bg-surface-container p-4 rounded-xl border border-white/5 space-y-3">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-on-surface-variant">Academia Cadastrada:</span>
                      <strong className="text-white">{profile?.gymName || 'Não definida'}</strong>
                    </div>

                    {gymCheckinStatus === 'checking_location' && (
                      <div className="flex items-center gap-2 text-amber-400 text-xs py-2">
                        <RefreshCw className="animate-spin" size={16} />
                        <span>Validando sinal de GPS e geolocalização...</span>
                      </div>
                    )}

                    {gymCheckinError && (
                      <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg text-xs space-y-1">
                        <div className="flex items-center gap-1.5 font-bold">
                          <AlertCircle size={14} />
                          <span>Validação de Proximidade</span>
                        </div>
                        <p>{gymCheckinError}</p>
                      </div>
                    )}

                    {gymCheckinStatus === 'eligible' && (
                      <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-lg text-xs flex items-center gap-2">
                        <CheckCircle size={16} />
                        <span>Você está no raio da sua academia! Clique abaixo para confirmar presença.</span>
                      </div>
                    )}

                    {gymCheckinStatus === 'confirmed' && (
                      <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-lg text-xs space-y-1">
                        <div className="flex items-center gap-1.5 font-bold">
                          <CheckCircle size={16} />
                          <span>Check-in Verificado Ativo!</span>
                        </div>
                        {timeLeftStr && <p className="font-mono text-white">Tempo restante: {timeLeftStr}</p>}
                      </div>
                    )}
                  </div>

                  {gymCheckinStatus === 'eligible' && (
                    <button
                      onClick={handleConfirmGymCheckin}
                      disabled={isPerformingCheckin}
                      className="w-full py-3 bg-primary hover:bg-primary-hover text-black font-headline font-black italic text-xs uppercase tracking-wider rounded-xl shadow-lg transition-all flex items-center justify-center gap-2 cursor-pointer"
                    >
                      {isPerformingCheckin ? <RefreshCw className="animate-spin" size={16} /> : <MapPin size={16} />}
                      <span>Confirmar Check-in Presencial (+20 XP)</span>
                    </button>
                  )}
                </div>
              )}

              {startActivityError && (
                <div className="p-3.5 bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 rounded-2xl text-xs space-y-1.5 shadow-sm">
                  <div className="flex items-center gap-2 font-bold text-emerald-400">
                    <MapPin size={16} />
                    <span className="font-headline italic uppercase tracking-wider text-[11px]">Informação de Localização</span>
                  </div>
                  <p className="whitespace-pre-line leading-relaxed text-[11.5px] text-zinc-300 font-medium">{startActivityError}</p>
                </div>
              )}

              {pendingChallenge.id === 'workout' && (
                <div className="space-y-4">
                  <p className="text-xs text-on-surface-variant">
                    Para iniciar seu treino de musculação, o aplicativo valida sua presença presencial para liberar a contagem de tempo e auditoria do treino.
                  </p>

                  <button
                    onClick={() => handleStartActivity('workout')}
                    className="w-full py-3 bg-primary hover:bg-primary-hover text-black font-headline font-black italic text-xs uppercase tracking-wider rounded-xl shadow-lg transition-all flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <Play size={16} />
                    <span>Iniciar Cronômetro de Treino (+40 XP)</span>
                  </button>
                </div>
              )}

              {pendingChallenge.id === 'cardio' && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-on-surface-variant uppercase block">Tipo de Cardio</label>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { id: 'running', label: 'Corrida' },
                        { id: 'walking', label: 'Caminhada' },
                        { id: 'cycling', label: 'Ciclismo' }
                      ].map(type => (
                        <button
                          key={type.id}
                          onClick={() => setSelectedCardioType(type.id)}
                          className={cn(
                            "py-2 rounded-xl text-xs font-bold transition-all border cursor-pointer",
                            selectedCardioType === type.id
                              ? "bg-primary text-black border-primary"
                              : "bg-surface-container border-white/5 text-on-surface-variant hover:text-white"
                          )}
                        >
                          {type.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <button
                    onClick={() => handleStartActivity('cardio')}
                    className="w-full py-3 bg-orange-500 hover:bg-orange-400 text-black font-headline font-black italic text-xs uppercase tracking-wider rounded-xl shadow-lg transition-all flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <Play size={16} />
                    <span>Iniciar Cardio com Telemetria (+30 XP)</span>
                  </button>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>



      {/* Anti-cheat presence modal if required */}
      {presenceCheckRequired && presenceCheckData && (
        <VerifiedPresenceModal
          presenceCheckId={presenceCheckData.id}
          livenessPrompt={presenceCheckData.prompt}
          isOpen={presenceCheckRequired}
          onSuccess={() => {
            setPresenceCheckRequired(false);
            if (activeSession) handleEndActivity();
          }}
          onClose={() => setPresenceCheckRequired(false)}
        />
      )}
    </div>
  );
}
