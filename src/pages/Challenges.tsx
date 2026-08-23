import React, { useState, useRef, useEffect } from 'react';
import {
  Dumbbell, TrendingUp, MapPin, RefreshCw, CheckCircle, XCircle,
  Clock, Lock, Play, ShieldCheck, Flame, Trophy, Users, Camera, X,
  Zap, AlertCircle, ArrowRight, Sparkles, Watch, Calendar,
  Medal, Star, Building2, ChevronRight, Gift, Info, Target
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
import { calculatePace } from '../lib/runUtils';
import { useUser } from '../UserContext';
import { PrivateChallengesTab } from '../components/PrivateChallengesTab';
import { ActivityHistorySection, ActivityDetailScreen, ActivityHistoryItem } from '../components/ActivityHistorySection';
import { PowerModule } from './PowerModule';
import { RunShareCard } from '../components/RunShareCard';

export type ChallengeCategory =
  | 'all'
  | 'em_andamento'
  | 'diarios'
  | 'powerlift'
  | 'privados'
  | 'ranking'
  | 'conquistas';

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
    title: 'Check-in de Presença',
    subtitle: 'Validação da presença na academia',
    description: 'Validação da presença na academia.',
    xp: 20,
    icon: <MapPin size={28} className="text-emerald-400" />,
    tag: 'Desafio Diário',
    badgeColor: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
  },
  {
    id: 'workout',
    title: 'Treino de Musculação',
    subtitle: 'Check-in na academia',
    description: 'Complete uma sessão de musculação com presença validada.',
    xp: 100,
    icon: <Dumbbell size={28} className="text-amber-400" />,
    tag: 'Atividade Principal',
    badgeColor: 'bg-amber-500/10 text-amber-400 border-amber-500/20'
  },
  {
    id: 'cardio',
    title: 'Cardio Aeróbico',
    subtitle: 'Corrida ou caminhada ao ar livre via GPS',
    description: 'Corrida ou caminhada ao ar livre via GPS.',
    xp: 80,
    icon: <TrendingUp size={28} className="text-orange-400" />,
    tag: 'Resistência & Queima',
    badgeColor: 'bg-orange-500/10 text-orange-400 border-orange-500/20'
  }
];

const DAILY_CHALLENGES_ORDER = ['workout', 'cardio', 'checkin'] as const;

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

  const { triggerXPToast } = useOutletContext<{ triggerXPToast: (p: number, m?: string, rankingPoints?: number) => void }>();

  // Active activity session state
  const [activeSession, setActiveSession] = useState<ActivitySession | null>(activityService.getCurrentSession());
  const [elapsedTime, setElapsedTime] = useState(0);

  // Live GPS tracking state (distância/pace em tempo real durante cardio ao ar livre)
  const [liveDistanceKm, setLiveDistanceKm] = useState(0);
  const gpsWatchIdRef = useRef<number | null>(null);
  const lastCheckpointTimeRef = useRef<number>(0);

  // #217: tela de detalhe estilo Strava mostrada IMEDIATAMENTE ao finalizar uma
  // atividade (cardio ou treino) -- antes so aparecia depois, no Historico >
  // Ver Detalhes. Reaproveita o mesmo componente exportado de
  // ActivityHistorySection.tsx, alimentado com os dados reais da sessao que
  // acabou de ser encerrada.
  const [finishedActivityItem, setFinishedActivityItem] = useState<ActivityHistoryItem | null>(null);

  // Card premium de compartilhamento pós-atividade (estilo Strava), aberto a
  // partir do botao "Compartilhar" da tela de detalhe acima.
  const [shareCardData, setShareCardData] = useState<any>(null);

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

  // GPS checkpoint tracking em tempo real para cardio ao ar livre (corrida/caminhada/bike).
  // Antes addCheckpoint() nunca era chamado durante a sessao, entao a "rota" virava so
  // uma linha reta entre inicio e fim, dando pouquissimo dado real pro antifraude
  // (GpsEngine) e nenhuma info de distancia/pace ao vivo pro usuario -- ver auditoria
  // antifraude 2026-08 (teste do onibus homologado sem dados).
  useEffect(() => {
    if (!activeSession || !activeSession.requiresGpsDistance || typeof navigator === 'undefined' || !navigator.geolocation) {
      setLiveDistanceKm(0);
      return;
    }

    setLiveDistanceKm(activityService.calculateSessionDistance(activeSession));
    lastCheckpointTimeRef.current = 0;

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const now = Date.now();
        // Limita a no maximo 1 checkpoint a cada ~10s para nao sobrecarregar
        // Firestore/localStorage durante a sessao.
        if (now - lastCheckpointTimeRef.current < 10000) return;
        lastCheckpointTimeRef.current = now;

        activityService.addCheckpoint({
          lat: position.coords.latitude,
          lng: position.coords.longitude
        });

        const current = activityService.getCurrentSession();
        if (current) {
          setLiveDistanceKm(activityService.calculateSessionDistance(current));
        }
      },
      (err) => {
        console.warn('[Challenges] GPS watchPosition error during cardio session:', err);
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );
    gpsWatchIdRef.current = watchId;

    return () => {
      if (gpsWatchIdRef.current !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(gpsWatchIdRef.current);
        gpsWatchIdRef.current = null;
      }
    };
  }, [activeSession?.id, activeSession?.requiresGpsDistance]);

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
    setError(null);
    if (challenge.id === 'checkin' || challenge.id === 'workout') {
      evaluateGymProximityCheck();
    }
  };

  // Start Session (Workout / Cardio)
  const handleStartActivity = async (type: 'workout' | 'cardio') => {
    setStartActivityError(null);
    setError(null);
    // IMPORTANTE: solicitar permissao de sensores (acelerometro/giroscopio) como a
    // PRIMEIRA acao, de forma sincrona em relacao ao clique do usuario. No iOS Safari,
    // DeviceMotionEvent.requestPermission() so exibe o prompt real se chamado dentro da
    // mesma pilha de execucao do gesto do usuario -- se colocado depois de qualquer await
    // (ex.: startSession fazendo consultas no Firestore), o Safari ja descartou a "user
    // activation" e o prompt nunca aparece (bug reportado: so pedia microfone/localização).
    // Ver auditoria antifraude 2026-08.
    await activityService.requestMotionPermission();
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
          rawMsg = parsed.title ? `${parsed.title}

${parsed.message}` : (parsed.message || rawMsg);
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

  // Converte o item exibido na tela de detalhe pos-atividade para o formato
  // aceito pelo RunShareCard (ShareableSession) -- mesmo mapeamento ja usado
  // pelo botao "Compartilhar" do historico em ActivityHistorySection.tsx.
  const buildShareableFromItem = (item: ActivityHistoryItem) => ({
    id: item.id,
    title: item.title,
    distanceKm: item.distanceKm,
    durationMins: item.durationMins,
    pace: item.pace,
    calories: item.calories,
    elevationGain: item.elevationGain,
    steps: item.steps,
    trajectory: item.trajectory,
    timestamp: new Date(item.rawTimestamp).toISOString(),
    rankingPointsEarned: item.rankingPointsEarned,
    points: item.points,
  });

  // End Workout/Cardio Session
  const handleEndActivity = async () => {
    if (!activeSession) return;
    setLoading(true);
    setError(null);

    const sessionType = activeSession.type;
    // Captura o snapshot mais recente da sessao (com todos os checkpoints de GPS
    // coletados ate agora) ANTES de endSession() limpar/encerrar a sessao localmente,
    // para poder montar a rota real da tela de detalhe/card premium depois.
    const sessionBeforeEnd = activityService.getCurrentSession() || activeSession;

    try {
      const res = await activityService.endSession();
      const points = res.workout?.points || (sessionType === 'workout' ? 40 : 30);
      const rankingPoints = (res).rankingPointsEarned ?? res.workout?.rankingPointsEarned;
      setActiveSession(null);

      if (res.message && res.validation?.success === false) {
        triggerXPToast(0, 'Sessão encerrada.');
        setError(res.message);
      } else {
        triggerXPToast(points, `${sessionType === 'workout' ? 'Treino de Musculação' : 'Queima de Gordura'} Concluído! 🔥`, rankingPoints);

        // #217: mostra a tela de detalhe estilo Strava JA na hora de finalizar,
        // com os dados reais desta sessao -- nao inventados. O mapa so aparece
        // se realmente houver checkpoints de GPS coletados durante a sessao.
        const now = new Date();
        const dateStr = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
        const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
        const cardioTypeLabels: Record<string, string> = { running: 'Corrida ao ar livre', walking: 'Caminhada', cycling: 'Ciclismo' };

        let trajectory: Array<{ lat: number; lng: number }> | undefined;
        let distanceKm: number | undefined;
        let durationMins: number | undefined;
        let calories: number | undefined;
        let pace: string | undefined;
        let steps: number | undefined;

        if (sessionType === 'cardio') {
          distanceKm = (res.workout?.distance ?? activityService.calculateSessionDistance(sessionBeforeEnd)) || 0;
          const durationMinsRaw = res.workout?.duration;
          const timeSeconds = durationMinsRaw ? durationMinsRaw * 60 : elapsedTime;
          durationMins = Math.round(timeSeconds / 60);
          pace = calculatePace(distanceKm * 1000, timeSeconds);
          calories = Math.round(distanceKm * 62);
          steps = Math.round(distanceKm * 1350);
          const rawTrajectory = (sessionBeforeEnd.checkpoints || [])
            .filter((cp: any) => cp.location)
            .map((cp: any) => ({ lat: cp.location.lat, lng: cp.location.lng }));
          trajectory = rawTrajectory.length >= 2 ? rawTrajectory : undefined;
        } else {
          durationMins = res.workout?.duration ? Number(res.workout.duration) : Math.round(elapsedTime / 60);
        }

        setFinishedActivityItem({
          id: res.workout?.id || `local_${Date.now()}`,
          source: 'workout',
          type: sessionType === 'cardio' ? 'cardio' : 'workout',
          typeLabel: sessionType === 'cardio' ? 'Cardio ao ar livre' : 'Treino',
          title: sessionType === 'cardio' ? (cardioTypeLabels[selectedCardioType] || 'Corrida ao ar livre') : 'Treino de Musculação',
          dateStr,
          timeStr,
          rawTimestamp: now.getTime(),
          status: 'homologada',
          statusRaw: 'valid',
          points,
          rankingPointsEarned: rankingPoints || undefined,
          durationMins,
          distanceKm,
          calories,
          pace,
          steps,
          elevationGain: sessionType === 'cardio' ? 0 : undefined,
          trajectory,
        });
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
    <div className="min-h-screen bg-[#090909] pb-28 text-on-surface pt-5 px-4 max-w-5xl mx-auto space-y-6">

      {/* CABEÇALHO MOBILE */}
      <header className="space-y-3">
        <div>
          <div>
            <h1 className="text-[26px] leading-none font-headline font-black tracking-tight uppercase italic text-white">Desafios</h1>
            <p className="mt-1 text-[10px] text-white/45 uppercase tracking-wide">Supere seus limites</p>
          </div>
        </div>

        <div className="relative overflow-hidden rounded-2xl border border-primary/25 bg-gradient-to-r from-[#14100a] via-[#11100d] to-[#0b0b0b] px-4 py-3 shadow-[0_12px_36px_rgba(0,0,0,.32)]">
          <div className="absolute -left-6 top-0 h-full w-24 bg-primary/5 blur-2xl" />
          <div className="relative flex items-center gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-primary/45 bg-primary/10 text-primary shadow-[0_0_16px_rgba(246,168,0,.16)]">
              <Zap size={20} fill="currentColor" />
            </div>
            <div className="min-w-0 flex-1">
              <span className="block text-[8px] font-bold uppercase tracking-widest text-white/50">Seu nível atual</span>
              <p className="font-headline text-base font-black italic uppercase text-white">Nível {profile?.level || 1} <span className="text-primary">· {profile?.xp || 0} XP</span></p>
            </div>
            <div className="w-24">
              <div className="mb-1 flex justify-end text-[10px] font-black text-primary">88%</div>
              <div className="h-1.5 overflow-hidden rounded-full bg-white/15"><div className="h-full w-[88%] rounded-full bg-primary" /></div>
            </div>
          </div>
        </div>
      </header>

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
              {activeSession.requiresGpsDistance && (
                <p className="text-xs text-on-surface-variant flex items-center gap-1 flex-wrap">
                  <MapPin size={13} className="text-primary" /> Distância: <strong className="text-white font-mono text-sm">{liveDistanceKm.toFixed(2)} km</strong>
                  {liveDistanceKm > 0.01 && elapsedTime > 0 && (
                    <span className="ml-1">• Pace: <strong className="text-white font-mono text-sm">{calculatePace(liveDistanceKm * 1000, elapsedTime)}</strong></span>
                  )}
                </p>
              )}
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

      {/* MENSAGEM REAL DE APROVAÇÃO/REJEIÇÃO DA ÚLTIMA ATIVIDADE ENCERRADA */}
      {error && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-rose-500/10 border border-rose-500/30 text-rose-300 p-4 rounded-2xl text-xs shadow-sm flex items-start gap-3"
        >
          <AlertCircle size={18} className="text-rose-400 shrink-0 mt-0.5" />
          <div className="flex-1 space-y-1">
            <p className="font-bold uppercase tracking-wider text-[11px] text-rose-400">Atividade Não Homologada</p>
            <p className="whitespace-pre-line leading-relaxed text-[12px] text-rose-200">{error}</p>
          </div>
          <button onClick={() => setError(null)} className="text-rose-400/60 hover:text-rose-300 p-1 shrink-0 cursor-pointer">
            <X size={16} />
          </button>
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
        <div className="flex flex-col gap-6">

          {/* POWER LIFT HIGHLIGHT BANNER (If in 'all', 'diarios', 'em_andamento') */}
          {(selectedCategory === 'all' || selectedCategory === 'diarios' || selectedCategory === 'em_andamento') && (
            <div className="order-2 relative min-h-[184px] overflow-hidden rounded-[22px] border border-primary/45 bg-[#120d06] shadow-[0_18px_40px_rgba(0,0,0,.44)]">
              <img src="/invictus-power-lift-card.png" alt="Arte do Invictus Power Lift" className="absolute inset-0 h-full w-full object-cover object-center opacity-70" />
              <div className="absolute inset-0 bg-gradient-to-r from-[#100b05] via-[#100b05]/90 to-[#100b05]/25" />
              <div className="relative flex min-h-[184px] flex-col justify-between p-4">
                <div className="max-w-[72%]">
                  <span className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-[.16em] text-primary"><Flame size={13} fill="currentColor" /> Categoria destaque</span>
                  <h3 className="mt-1 font-headline text-xl font-black italic uppercase text-white">Invictus Power Lift</h3>
                  <p className="mt-1 text-[10px] leading-snug text-white/70">Supino · Agachamento · Levantamento Terra. Registre marcas pessoais de carga com homologação de vídeo por IA.</p>
                </div>
                <button onClick={() => { setSelectedCategory('powerlift'); setSearchParams({ category: 'powerlift' }); }} className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 font-headline text-[11px] font-black italic uppercase tracking-wide text-black transition-colors hover:bg-[#ffc13d]">
                  <span>Acessar desafios de carga</span><ArrowRight size={16} />
                </button>
              </div>
            </div>
          )}

          {/* CORE DAILY CHALLENGES SECTION */}
          {(selectedCategory === 'all' || selectedCategory === 'diarios' || selectedCategory === 'em_andamento') && (
            <div className="order-1 space-y-3">
              <div className="flex items-center justify-between px-0.5">
                <div>
                  <h2 className="text-sm font-black text-white uppercase tracking-wide">Desafios principais do dia</h2>
                  <span className="text-[10px] text-white/45">Complete os desafios e ganhe XP</span>
                </div>
                <Info size={18} className="text-white/50" />
              </div>

              <div className="grid grid-cols-1 gap-2.5 md:grid-cols-3">
                {CORE_CHALLENGES.slice().sort((a, b) => DAILY_CHALLENGES_ORDER.indexOf(a.id) - DAILY_CHALLENGES_ORDER.indexOf(b.id)).map((ch) => {
                  const isCompletedToday = Boolean(
                    ch.id === 'checkin'
                      ? (gymCheckinStatus === 'confirmed' || verifiedCheckInId)
                      : submissions[ch.id]
                  );
                  const isRunning = activeSession?.type === ch.id;

                  return (
                    <React.Fragment key={ch.id}>
                      {ch.id === 'cardio' && (
                        <div className="mt-2 border-t border-white/[.07] pt-5 md:col-span-3">
                          <h2 className="text-sm font-black uppercase tracking-wide text-white">Outros desafios diários</h2>
                        </div>
                      )}
                    <div
                      key={ch.id}
                      className={cn(
                        "relative overflow-hidden rounded-2xl border bg-[#101010] p-4 transition-all group hover:border-primary/50",
                        isCompletedToday
                          ? "border-emerald-500/30 bg-emerald-950/10"
                          : isRunning
                            ? "border-primary/50 bg-primary/5"
                            : "border-white/10"
                      )}
                    >
                      <div>
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-3">
                            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-primary/35 bg-primary/[.06] shadow-[0_0_16px_rgba(246,168,0,.10)] group-hover:scale-105 transition-transform">
                              {ch.icon}
                            </div>
                            <div>
                              {ch.id === 'workout' && <span className="text-[8px] font-black uppercase tracking-widest text-primary">Em andamento</span>}
                              <h3 className="text-[13px] font-black uppercase text-white group-hover:text-primary transition-colors">
                                {ch.title}
                              </h3>
                              <p className="text-[10px] text-white/50">{ch.subtitle}</p>
                            </div>
                          </div>

                          <div className="shrink-0 rounded-lg border border-primary/45 bg-primary/[.06] px-2.5 py-1.5 text-[10px] font-black text-primary">
                            +{ch.xp} XP <ArrowRight className="ml-2 inline" size={13} />
                          </div>
                        </div>

                        <p className="mt-2 text-[10px] leading-snug text-white/55">
                          {ch.description}
                        </p>
                      </div>

                      <div className="mt-3 border-t border-white/[.07] pt-2.5 flex items-center justify-between">
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
                          <div className="text-[10px] text-white/45 flex items-center gap-1">
                            <Target size={13} className="text-primary" />
                            <span>Progresso do dia</span>
                          </div>
                        )}

                        <button
                          onClick={() => handleOpenChallenge(ch)}
                          disabled={isCompletedToday && ch.id !== 'checkin'}
                          className={cn(
                            "px-3 py-1.5 rounded-lg text-[10px] font-headline font-black italic uppercase tracking-wider transition-all flex items-center gap-1.5 shadow-md cursor-pointer",
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
                    </React.Fragment>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

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

      {/* #217: tela de detalhe estilo Strava mostrada JA na hora de finalizar a atividade */}
      {finishedActivityItem && (
        <ActivityDetailScreen
          item={finishedActivityItem}
          onClose={() => setFinishedActivityItem(null)}
          onShare={() => setShareCardData(buildShareableFromItem(finishedActivityItem))}
        />
      )}

      {/* Card premium de compartilhamento pós-atividade (estilo Strava) */}
      {shareCardData && (
        <RunShareCard session={shareCardData} onClose={() => setShareCardData(null)} />
      )}
    </div>
  );
}
