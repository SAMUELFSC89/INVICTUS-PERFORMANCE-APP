import React, { useState, useRef, useEffect } from 'react';
import {
  Dumbbell, TrendingUp, MapPin, CheckCircle, XCircle,
  Clock, Lock, Play, ShieldCheck, Flame, Trophy, Users, Camera, X,
  Zap, AlertCircle, ArrowRight, Sparkles, Watch, Calendar,
  Medal, Star, Building2, ChevronRight, Gift, Info, Target, Footprints
} from 'lucide-react';
import { useNavigate, useOutletContext, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { activityService } from '../services/activityService';
import { userService } from '../services/userService';
import { stravaService } from '../services/stravaService';
import { VerifiedPresenceModal } from '../components/VerifiedPresenceModal';
import { auth, db } from '../firebase';
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { ActivitySession } from '../types';
import { cn } from '../lib/utils';
import { calculatePace } from '../lib/runUtils';
import { useUser } from '../UserContext';
import { PrivateChallengesTab } from '../components/PrivateChallengesTab';
import { ActivityHistorySection, ActivityDetailScreen, ActivityHistoryItem } from '../components/ActivityHistorySection';
import { PowerLift } from './PowerLift';
import { RunShareCard } from '../components/RunShareCard';
import { CARDIO_OPTIONS, ChallengeActivityFlow, ChallengeFlowScreen, CardioOption, ActivityCompletion } from '../components/ChallengeActivityFlow';
import { getXPProgress } from '../lib/levelUtils';
import { normalizeActivityValidationStatus, readActivityTimestamp } from '../lib/workoutData';
import { ACHIEVEMENTS } from '../achievements';

export type ChallengeCategory =
  | 'all'
  | 'em_andamento'
  | 'diarios'
  | 'powerlift'
  | 'privados'
  | 'ranking'
  | 'conquistas';

interface CoreChallenge {
  id: 'workout' | 'cardio';
  title: string;
  subtitle: string;
  description: string;
  icon: React.ReactNode;
  tag: string;
  badgeColor: string;
}

const CORE_CHALLENGES: CoreChallenge[] = [
  {
    id: 'workout',
    title: 'Treino de Musculação',
    subtitle: 'Complete seu treino na academia',
    description: 'Complete uma sessão de musculação registrada no aplicativo.',
    icon: <Dumbbell size={28} className="text-amber-400" />,
    tag: 'Atividade Principal',
    badgeColor: 'bg-amber-500/10 text-amber-400 border-amber-500/20'
  },
  {
    id: 'cardio',
    title: 'Cardio Aeróbico',
    subtitle: 'Corrida ou caminhada ao ar livre via GPS',
    description: 'Corrida ou caminhada ao ar livre via GPS.',
    icon: <Footprints size={28} className="text-primary" />,
    tag: 'Resistência & Queima',
    badgeColor: 'bg-orange-500/10 text-orange-400 border-orange-500/20'
  }
];

const DAILY_CHALLENGES_ORDER = ['workout', 'cardio'] as const;

export function Challenges() {
  const { user: profile, refreshUser } = useUser();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Selected Category State
  const initialCategory = (searchParams.get('category') as ChallengeCategory) || 'all';
  const [selectedCategory, setSelectedCategory] = useState<ChallengeCategory>(initialCategory);

  const { triggerXPToast } = useOutletContext<{ triggerXPToast: (p: number, m?: string, rankingPoints?: number) => void }>();

  // Active activity session state
  const initialActive = activityService.getCurrentSession();
  const [activeSession, setActiveSession] = useState<ActivitySession | null>(initialActive);
  const [elapsedTime, setElapsedTime] = useState(0);

  // Live GPS tracking state (distância/pace em tempo real durante cardio ao ar livre)
  const [liveDistanceKm, setLiveDistanceKm] = useState(0);
  const gpsWatchIdRef = useRef<number | null>(null);
  const lastCheckpointTimeRef = useRef<number>(0);

  // #44: estado do sinal de GPS e wake lock para o mapa ao vivo (LiveTrackingMap).
  // Antes a tela so mostrava numeros; agora tambem mostra o trajeto real sendo
  // percorrido, igual o RunTracker.tsx (que ficava orfao) fazia -- mas
  // continuando a alimentar activityService.addCheckpoint(), sem trocar o
  // caminho de envio ja unificado (ver auditoria da task #44).
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);
  const [gpsSignal, setGpsSignal] = useState<'SEARCHING' | 'WEAK' | 'STRONG'>('SEARCHING');
  const [gpsPermissionDenied, setGpsPermissionDenied] = useState(false);
  const wakeLockRef = useRef<any>(null);

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
  // #234: HOME -> MUSCULACAO / CARDIO SEM ETAPA INTERMEDIARIA.
  //
  // A Home navega para /challenges?type=workout|cardio. Ate agora o fluxo era
  // aberto apenas pelo useEffect mais abaixo, que roda DEPOIS da primeira
  // pintura: a lista de Desafios aparecia por um instante antes do overlay
  // subir, dando a impressao de ter sido jogado numa tela intermediaria e de
  // precisar procurar a atividade de novo. Resolvendo no proprio useState o
  // fluxo ja nasce aberto -- a lista nunca chega a ser vista.
  const deepLinkType = searchParams.get('type');
  const deepLinkChallenge = (deepLinkType === 'workout' || deepLinkType === 'cardio')
    ? CORE_CHALLENGES.find((item) => item.id === deepLinkType) || null
    : null;
  // Guardado numa ref porque o parametro `type` e apagado da URL logo apos a
  // abertura (para fechar a tela nao reabrir o fluxo em loop). Sem a ref
  // perderiamos a informacao de que a origem foi a Home, e ao concluir o treino
  // o usuario cairia na lista de Desafios em vez de voltar para a Home.
  const openedFromHomeRef = useRef<boolean>(Boolean(deepLinkChallenge));
  // #250: trava contra o efeito abaixo silenciosamente descartar o deep link.
  // Guarda qual valor de `type` ja foi processado -- ao contrario do antigo
  // guard `!flowScreen`, nao depende do estado da tela no instante em que o
  // efeito roda (que na pratica variava: reproduzido ao vivo, o clique na Home
  // as vezes chegava com o componente ja tendo passado por um flowScreen nao
  // nulo por uma fracao de segundo, o efeito via a condicao falsa, apagava
  // `type` da URL do mesmo jeito e a musculacao/cardio nunca abria -- usuario
  // caia direto na lista de Desafios). Com a ref, o mesmo valor de `type` so e
  // consumido uma vez, mas SEMPRE abre a tela quando chega pela primeira vez,
  // independente do que `flowScreen` estava valendo naquele instante.
  const consumedDeepLinkRef = useRef<string | null>(deepLinkChallenge ? deepLinkType : null);
  const [pendingChallenge, setPendingChallenge] = useState<CoreChallenge | null>(deepLinkChallenge);
  const [flowScreen, setFlowScreen] = useState<ChallengeFlowScreen | null>(
    initialActive
      ? 'active'
      : deepLinkChallenge
        ? (deepLinkChallenge.id === 'workout' ? 'workout-details' : 'cardio-picker')
        : null
  );
  const [selectedMuscleGroup, setSelectedMuscleGroup] = useState(initialActive?.muscleGroup || 'Pernas');
  const [selectedCardioOption, setSelectedCardioOption] = useState<CardioOption>(
    (initialActive?.cardioType && CARDIO_OPTIONS.find(o => o.id === initialActive.cardioType)) || CARDIO_OPTIONS[0]
  );
  const [loading, setLoading] = useState(false);
  // #323: feedback visual imediato ao tocar em "INICIAR" -- startSession() faz
  // 2 idas ao Firestore + (pra cardio ao ar livre) uma leitura de GPS antes de
  // devolver, e sem isto o botao ficava parecendo travado por alguns segundos.
  const [startingActivity, setStartingActivity] = useState(false);
  // #323: permite abortar o fetch de /api/validate-activity que ficou pendurado
  // (ex: conexao instavel dentro de um veiculo em movimento) tocando em
  // "Descartar" durante a finalizacao, em vez de travar o atleta na tela.
  const endActivityAbortRef = useRef<AbortController | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [startActivityError, setStartActivityError] = useState<string | null>(null);
  const [presenceCheckRequired, setPresenceCheckRequired] = useState(false);
  const [presenceCheckData, setPresenceCheckData] = useState<{ id: string; prompt: string } | null>(null);
  const [completion, setCompletion] = useState<ActivityCompletion | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Cardio States
  const [selectedCardioType, setSelectedCardioType] = useState<string>(initialActive?.cardioType || 'running');
  const [stravaConnecting, setStravaConnecting] = useState(false);
  const levelProgress = getXPProgress(profile?.xp || 0);
  const unlockedBadges = ACHIEVEMENTS.filter((achievement) => profile?.achievements?.includes(achievement.id));

  // Load today's submissions
  const loadSubmissions = async () => {
    const firebaseUser = auth.currentUser;
    if (firebaseUser) {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const qSub = query(
        collection(db, 'workouts'),
        where('userId', '==', firebaseUser.uid)
      );
      try {
        const snap = await getDocs(qSub);
        const subs: Record<string, any> = {};
        snap.docs.forEach(d => {
          const data = d.data();
          const timestamp = readActivityTimestamp(data.timestamp ?? data.createdAt);
          const status = normalizeActivityValidationStatus(
            data.validationStatus ?? data.status ?? data.validation?.status
          );
          // Apenas uma atividade já validada pelo servidor entra no progresso
          // diário. Envios pendentes e recusados nunca simulam conclusão.
          if (
            (data.type === 'workout' || data.type === 'cardio') &&
            status === 'validated' &&
            timestamp !== null &&
            timestamp >= todayStart.getTime()
          ) {
            subs[data.type] = data;
          }
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
        if (!flowScreen) {
          setFlowScreen('active');
          if (current.cardioType) {
            const matched = CARDIO_OPTIONS.find(o => o.id === current.cardioType);
            if (matched) {
              setSelectedCardioOption(matched);
              setSelectedCardioType(matched.id);
            }
          }
          if (current.muscleGroup) {
            setSelectedMuscleGroup(current.muscleGroup);
          }
        }
      } else {
        setElapsedTime(0);
      }
    };

    syncSession();
    const interval = setInterval(syncSession, 1000);
    return () => clearInterval(interval);
  }, [flowScreen]);

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
    setGpsAccuracy(null);
    setGpsSignal('SEARCHING');
    setGpsPermissionDenied(false);

    // Tela ligada durante o cardio ao ar livre -- sem isto o celular apaga a
    // tela no bolso e o atleta perde o mapa/cronometro no meio da corrida.
    // Falha aqui (API indisponivel/negada) nunca deve travar o tracking.
    if ('wakeLock' in navigator) {
      (navigator as any).wakeLock.request('screen')
        .then((lock: any) => { wakeLockRef.current = lock; })
        .catch((err: any) => console.warn('[Challenges] Wake Lock request failed:', err));
    }

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const { accuracy } = position.coords;
        setGpsAccuracy(accuracy);
        setGpsSignal(accuracy < 20 ? 'STRONG' : accuracy < 50 ? 'WEAK' : 'SEARCHING');

        const now = Date.now();
        // Limita a no maximo 1 checkpoint a cada ~10s para nao sobrecarregar
        // Firestore/localStorage durante a sessao.
        if (now - lastCheckpointTimeRef.current < 10000) return;
        lastCheckpointTimeRef.current = now;

        activityService.addCheckpoint({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy
        });

        const current = activityService.getCurrentSession();
        if (current) {
          setLiveDistanceKm(activityService.calculateSessionDistance(current));
        }
      },
      (err) => {
        console.warn('[Challenges] GPS watchPosition error during cardio session:', err);
        if (err.code === 1) setGpsPermissionDenied(true);
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );
    gpsWatchIdRef.current = watchId;

    return () => {
      if (gpsWatchIdRef.current !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(gpsWatchIdRef.current);
        gpsWatchIdRef.current = null;
      }
      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch(() => {});
        wakeLockRef.current = null;
      }
    };
  }, [activeSession?.id, activeSession?.requiresGpsDistance]);

  // Open Challenge Modal
  const handleOpenChallenge = (challenge: CoreChallenge) => {
    setPendingChallenge(challenge);
    setStartActivityError(null);
    setError(null);
    setNotice(null);
    setCompletion(null);
    setFlowScreen(challenge.id === 'workout' ? 'workout-details' : 'cardio-picker');
  };

  // A Home pode abrir diretamente o fluxo correto. Consumimos o parâmetro após
  // a abertura para que fechar a tela não a reabra em loop.
  useEffect(() => {
    const requestedType = searchParams.get('type');
    if (requestedType !== 'workout' && requestedType !== 'cardio') return;
    // #250: so pula se ESTE MESMO valor de type ja foi aberto por este efeito
    // (ou pelo useState inicial) -- nao depende de flowScreen (ver comentario
    // na ref acima). Isso garante que o deep link sempre abre a tela certa na
    // primeira vez que aparece, mesmo se o componente ja tiver montado com
    // algum flowScreen setado por outro motivo.
    if (consumedDeepLinkRef.current !== requestedType) {
      consumedDeepLinkRef.current = requestedType;
      const challenge = CORE_CHALLENGES.find((item) => item.id === requestedType);
      if (challenge) { openedFromHomeRef.current = true; handleOpenChallenge(challenge); }
    }
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('type');
    setSearchParams(nextParams, { replace: true });
  }, [searchParams, setSearchParams]);

  // Fechar o fluxo deve devolver o usuario para ONDE ELE VEIO. Quem entrou pela
  // Home volta para a Home; quem abriu pela propria tela de Desafios continua
  // nela. Antes, todo mundo caia na lista de Desafios.
  const closeFlow = () => {
    setFlowScreen(null); setFinishedActivityItem(null); setPendingChallenge(null); setCompletion(null);
    if (openedFromHomeRef.current) { openedFromHomeRef.current = false; navigate('/'); }
  };

  // Start Session (Workout / Cardio)
  const handleStartActivity = async (type: 'workout' | 'cardio') => {
    setStartActivityError(null);
    setError(null);
    setStartingActivity(true);
    try {
      await activityService.requestMotionPermission();
      const session = await activityService.startSession(
        type,
        undefined,
        type === 'cardio' ? selectedCardioOption.id : undefined,
        undefined,
        undefined,
        type === 'workout' ? selectedMuscleGroup : undefined
      );
      setActiveSession(session);
      setPendingChallenge(null);
      setCompletion(null);
      setFlowScreen('active');
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
    } finally {
      setStartingActivity(false);
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
    setNotice(null);

    const sessionType = activeSession.type;
    // Captura o snapshot mais recente da sessao (com todos os checkpoints de GPS
    // coletados ate agora) ANTES de endSession() limpar/encerrar a sessao localmente,
    // para poder montar a rota real da tela de detalhe/card premium depois.
    const sessionBeforeEnd = activityService.getCurrentSession() || activeSession;

    // #323: guardado numa ref pra handleCancelActivity poder abortar este
    // fetch se o atleta tocar em "Descartar" enquanto a finalizacao ainda
    // esta pendurada (ex: sem sinal dentro de um onibus).
    const controller = new AbortController();
    endActivityAbortRef.current = controller;

    try {
      const res = await activityService.endSession(undefined, controller.signal);
      if (res.presenceCheckRequired) {
        if (!res.presenceCheckId) {
          throw new Error('A validação de presença foi solicitada sem um identificador válido. Tente finalizar novamente.');
        }
        // A sessão permanece ativa e não recebe XP até a decisão da prova de
        // presença. Repetir endSession aqui criava conclusões duplicadas.
        setPresenceCheckData({ id: res.presenceCheckId, prompt: res.livenessPrompt || 'Siga o gesto indicado' });
        setPresenceCheckRequired(true);
        setNotice(res.userMessage || 'Uma confirmação de presença é necessária antes da validação da atividade.');
        return;
      }

      const status = normalizeActivityValidationStatus(
        res.validation?.status ?? res.workout?.status
      );
      const rankingPoints = res.rankingPointsEarned ?? res.workout?.rankingPointsEarned;
      const points = typeof res.workout?.points === 'number' && Number.isFinite(res.workout.points) && res.workout.points > 0
        ? res.workout.points
        : undefined;

      if (status === 'validated') {
        setActiveSession(null);
        setCompletion({ status: 'approved', message: res.message, pointsAwarded: points });
        if (points !== undefined) {
          triggerXPToast(points, 'Atividade validada.', rankingPoints);
        }

        // A tela de detalhe é montada somente a partir de um registro retornado
        // pelo servidor. Não criamos IDs, timestamps ou pontuações locais.
        const timestampMs = res.workout?.timestamp ? Date.parse(res.workout.timestamp) : Number.NaN;
        if (res.workout?.id && Number.isFinite(timestampMs)) {
          const completedAt = new Date(timestampMs);
          const dateStr = completedAt.toLocaleDateString('pt-BR');
          const timeStr = completedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
          const cardioTypeLabels: Record<string, string> = Object.fromEntries(CARDIO_OPTIONS.map((option) => [option.id, option.label]));
          const serverDistance = typeof res.workout.distance === 'number' && Number.isFinite(res.workout.distance) ? res.workout.distance : undefined;
          const serverDuration = typeof res.workout.duration === 'number' && Number.isFinite(res.workout.duration) ? res.workout.duration : undefined;
          const rawCalories = (res.workout as any).calories;
          const calories = typeof rawCalories === 'number' && Number.isFinite(rawCalories) ? rawCalories : undefined;
          const rawTrajectory = (sessionBeforeEnd.checkpoints || [])
            .filter((cp: any) => cp.location)
            .map((cp: any) => ({ lat: cp.location.lat, lng: cp.location.lng }));
          const trajectory = rawTrajectory.length >= 2 ? rawTrajectory : undefined;
          const timeSeconds = serverDuration !== undefined ? serverDuration * 60 : undefined;
          const pace = sessionType === 'cardio' && serverDistance !== undefined && timeSeconds !== undefined
            ? calculatePace(serverDistance * 1000, timeSeconds)
            : undefined;

          const muscleGroup = (res.workout as any)?.muscleGroup || sessionBeforeEnd.muscleGroup || selectedMuscleGroup;
          const workoutTitle = muscleGroup ? `Treino de ${muscleGroup}` : 'Treino de Musculação';

          setFinishedActivityItem({
            id: res.workout.id,
            source: 'workout',
            type: sessionType === 'cardio' ? 'cardio' : 'workout',
            typeLabel: sessionType === 'cardio' ? 'Cardio' : 'Treino',
            title: sessionType === 'cardio' ? (cardioTypeLabels[res.workout.cardioType || selectedCardioType] || 'Cardio') : workoutTitle,
            dateStr,
            timeStr,
            rawTimestamp: timestampMs,
            status: 'homologada',
            statusRaw: 'valid',
            points,
            rankingPointsEarned: typeof rankingPoints === 'number' ? rankingPoints : undefined,
            durationMins: serverDuration,
            distanceKm: serverDistance,
            calories,
            pace,
            trajectory,
          });
        }
        setFlowScreen(sessionType === 'cardio' ? 'cardio-complete' : 'workout-complete');
      } else if (status === 'pending') {
        setActiveSession(null);
        setCompletion({ status: 'pending', message: res.message });
        setFlowScreen(null);
        setNotice(res.message || 'Atividade recebida e aguardando análise. Nenhuma pontuação foi liberada ainda.');
      } else if (status === 'rejected' || status === 'not_eligible') {
        setActiveSession(null);
        setError(res.message || 'A atividade não foi validada. Nenhuma pontuação foi concedida.');
      } else {
        // Sem decisão explícita do servidor, falhamos de forma segura: não
        // marcamos a atividade como homologada e não concedemos XP.
        setError(res.message || 'O servidor não confirmou o status da atividade. Nenhuma pontuação foi liberada.');
      }
      await refreshUser();
      await loadSubmissions();
    } catch (err: any) {
      // #323: cancelamento explicito (tocou em "Descartar" durante a
      // finalizacao) ja e tratado por handleCancelActivity -- aqui so evita
      // mostrar um erro de "falha" por cima de uma acao que o proprio atleta
      // escolheu.
      if (err?.userCancelled) return;
      console.error('Error ending activity:', err);
      // Não descarta a sessão automaticamente: o usuário pode repetir o envio
      // quando houver falha temporária de rede ou do serviço de validação.
      setError(err.message || 'Falha ao encerrar atividade.');
    } finally {
      if (endActivityAbortRef.current === controller) endActivityAbortRef.current = null;
      setLoading(false);
    }
  };

  // Cancel/Discard Workout/Cardio Session
  const handleCancelActivity = async () => {
    // #323: se houver um envio de finalizacao pendurado (loading=true, ex:
    // sem sinal dentro de um veiculo em movimento), descartar precisa
    // primeiro abortar esse fetch -- sem isso o atleta nao tinha NENHUMA
    // saida na tela quando a finalizacao travava, so fechando o app na forca.
    const pendingFinalize = Boolean(loading && endActivityAbortRef.current);
    const confirmMsg = pendingFinalize
      ? 'A finalização está demorando. Deseja cancelar o envio e descartar esta atividade? Nenhum ponto será salvo.'
      : 'Deseja realmente descartar e cancelar a sessão em andamento? Nenhum ponto será salvo.';
    if (confirm(confirmMsg)) {
      endActivityAbortRef.current?.abort();
      endActivityAbortRef.current = null;
      activityService.cancelSession();
      setActiveSession(null);
      setFlowScreen(null);
      setPendingChallenge(null);
      setError(null);
      setLoading(false);
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

  const handleFlowStart = (type: 'workout' | 'cardio') => {
    if (type === 'workout' && flowScreen === 'workout-details') {
      setFlowScreen('workout-checkin');
      return;
    }
    handleStartActivity(type);
  };

  const handleFlowBack = () => {
    if (flowScreen === 'workout-checkin') setFlowScreen('workout-details');
    else closeFlow();
  };

  return (
    <div className="challenge-screen min-h-screen bg-transparent pb-28 text-on-surface pt-4 px-0 max-w-[430px] mx-auto space-y-5">

      {/* CABEÇALHO MOBILE */}
      <header className="challenge-header space-y-4">
        <div>
          <h1 className="text-[30px] leading-[.9] font-headline tracking-tight uppercase text-white">Desafios</h1>
          <p className="mt-1.5 text-[12px] leading-none text-white/65 uppercase tracking-wide">Supere seus limites</p>
        </div>

        <div className="challenge-level-card">
          <div className="challenge-icon challenge-icon--level"><Zap size={31} strokeWidth={2.4} /></div>
          <div className="min-w-0 flex-1">
            <span className="block text-[12px] font-bold uppercase tracking-wide text-white/80">Seu nível atual</span>
            <p className="mt-1 font-headline text-[18px] leading-none italic uppercase text-white">Nível {levelProgress.currentLevel} <span className="text-primary">· {profile?.xp || 0} XP</span></p>
          </div>
          <div className="challenge-level-progress">
            <div className="challenge-progress-track"><div className="challenge-progress-value" style={{ width: `${levelProgress.percentage}%` }} /></div>
            <span>{Math.round(levelProgress.percentage)}%</span>
          </div>
        </div>
      </header>

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

      {notice && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-sky-500/10 border border-sky-500/30 text-sky-100 p-4 rounded-2xl text-xs shadow-sm flex items-start gap-3"
        >
          <Info size={18} className="text-sky-300 shrink-0 mt-0.5" />
          <div className="flex-1 space-y-1">
            <p className="font-bold uppercase tracking-wider text-[11px] text-sky-300">Status da atividade</p>
            <p className="whitespace-pre-line leading-relaxed text-[12px] text-sky-100/85">{notice}</p>
          </div>
          <button onClick={() => setNotice(null)} className="text-sky-300/60 hover:text-sky-200 p-1 shrink-0 cursor-pointer" aria-label="Fechar aviso">
            <X size={16} />
          </button>
        </motion.div>
      )}

      {/* DYNAMIC VIEW CONTENT BASED ON SELECTED CATEGORY */}

      {/* 1. POWER LIFT CATEGORY VIEW */}
      {selectedCategory === 'powerlift' ? (
        <div className="w-full">
          <PowerLift />
        </div>
      ) : selectedCategory === 'privados' ? (
        /* 2. PRIVATE CHALLENGES CATEGORY VIEW */
        <PrivateChallengesTab />
      ) : selectedCategory === 'ranking' ? (
        <div className="bg-surface-card border border-white/10 rounded-[28px] p-6 space-y-5 text-center">
          <Trophy className="mx-auto text-primary" size={34} />
          <div>
            <h2 className="text-xl font-headline italic font-black text-white uppercase">Ranking</h2>
            <p className="mt-2 text-sm text-on-surface-variant">A classificação é carregada apenas na tela oficial de ranking, com dados verificados do servidor.</p>
          </div>
          <button onClick={() => navigate('/rankings')} className="challenge-powerlift-button w-full rounded-xl bg-primary px-4 py-3 font-headline text-sm italic uppercase text-black">
            Abrir ranking
          </button>
        </div>
      ) : selectedCategory === 'conquistas' ? (
        /* 4. CONQUISTAS CONFIRMADAS PELO PERFIL */
        <div className="bg-surface-card border border-white/10 rounded-[28px] p-6 space-y-6">
          <div>
            <span className="text-[10px] font-mono font-black text-primary uppercase tracking-widest block">
              🎖️ GALERIA DE TROFÉUS E CONQUISTAS
            </span>
            <h2 className="text-xl font-headline italic font-black text-white uppercase">
              Badges & Medalhas Desbloqueadas
            </h2>
          </div>

          {unlockedBadges.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-black/20 px-5 py-8 text-center text-sm text-on-surface-variant">
              Nenhuma conquista validada foi registrada ainda.
            </div>
          ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            {unlockedBadges.map((badge) => (
              <div
                key={badge.id}
                className="p-4 rounded-2xl border flex flex-col justify-between gap-3 text-center transition-all bg-primary/5 border-primary/30"
              >
                <div className="space-y-2">
                  <div className="text-4xl mx-auto">{badge.icon}</div>
                  <h4 className="font-headline italic font-black text-sm text-white uppercase">{badge.name}</h4>
                  <p className="text-[11px] text-on-surface-variant line-clamp-3">{badge.description}</p>
                </div>

                <div className="pt-2 border-t border-white/5 flex items-center justify-between text-[10px] font-mono">
                  <span className="text-emerald-400 font-bold">Desbloqueado ✓</span>
                  <span className="text-on-surface-variant">Verificado</span>
                </div>
              </div>
            ))}
          </div>
          )}
        </div>
      ) : (
        /* 5. DEFAULT CHALLENGES CATALOGUE VIEW */
        <div className="challenge-catalogue flex flex-col gap-8">

          {/* POWER LIFT HIGHLIGHT BANNER (If in 'all', 'diarios', 'em_andamento') */}
          {(selectedCategory === 'all' || selectedCategory === 'diarios' || selectedCategory === 'em_andamento') && (
            <div className="challenge-powerlift order-2 relative min-h-[214px] overflow-hidden rounded-[22px] border border-primary/60 bg-[#100c06] shadow-[0_18px_40px_rgba(0,0,0,.50)]">
              <img src="/invictus-power-lift-badge-v2.png" alt="Emblema dourado do Invictus Power Lift" className="challenge-powerlift-art" />
              <div className="challenge-powerlift-shade" />
              <div className="relative flex min-h-[214px] flex-col justify-between p-3.5">
                <div className="max-w-[80%]">
                  <div className="challenge-icon challenge-icon--fire"><Flame size={20} fill="currentColor" /></div>
                  <h3 className="mt-2 font-headline text-[21px] leading-none italic uppercase text-white">Invictus Power Lift</h3>
                  <p className="mt-2 text-[10px] leading-snug text-white/75">Supino · Agachamento · Levantamento Terra.</p>
                  <p className="mt-2 max-w-[230px] text-[12px] leading-snug text-white/80">Registre marcas pessoais de carga com homologação de vídeo por IA e dispute o cinturão da sua academia!</p>
                </div>
                <button onClick={() => { setSelectedCategory('powerlift'); setSearchParams({ category: 'powerlift' }); }} className="challenge-powerlift-button flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 font-headline text-[12px] leading-none italic uppercase tracking-wide text-black transition-colors hover:bg-[#ffc13d]">
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
                  <h2 className="text-[18px] leading-none font-headline text-white uppercase tracking-wide">Desafios principais do dia</h2>
                  <span className="mt-1 block text-[12px] leading-none text-white/65">Atividades validadas atualizam seu progresso</span>
                </div>
                <Info size={22} strokeWidth={1.7} className="text-white/60" />
              </div>

              <div className="grid grid-cols-1 gap-2.5">
                {CORE_CHALLENGES.slice().sort((a, b) => DAILY_CHALLENGES_ORDER.indexOf(a.id) - DAILY_CHALLENGES_ORDER.indexOf(b.id)).map((ch) => {
                  const isCompletedToday = Boolean(submissions[ch.id]);
                  const isRunning = activeSession?.type === ch.id;

                  return (
                    <React.Fragment key={ch.id}>
                      {ch.id === 'cardio' && (
                        <div className="mt-2 border-t border-white/[.07] pt-5 md:col-span-3">
                          <h2 className="font-headline text-[16px] leading-none uppercase tracking-wide text-white">Outros desafios diários</h2>
                        </div>
                      )}
                    <div
                      key={ch.id}
                      className={cn(
                        "challenge-card relative overflow-hidden rounded-[23px] border bg-[#101010] p-4 transition-all group hover:border-primary/50",
                        isCompletedToday
                          ? "border-emerald-500/30 bg-emerald-950/10"
                          : isRunning
                            ? "border-primary/50 bg-primary/5"
                            : "border-white/10"
                      )}
                    >
                      <div className={ch.id === 'workout' ? 'min-h-[144px]' : 'min-h-[74px]'}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-3">
                            <div className="challenge-icon grid h-[50px] w-[50px] shrink-0 place-items-center group-hover:scale-105 transition-transform">
                              {ch.icon}
                            </div>
                            <div>
                              {isRunning && <span className="challenge-running">Em andamento</span>}
                              <h3 className="text-[16px] leading-none font-headline uppercase text-white group-hover:text-primary transition-colors">
                                {ch.title}
                              </h3>
                              <p className="mt-1.5 text-[12px] leading-snug text-white/65">{ch.subtitle}</p>
                            </div>
                          </div>

                          <div className="shrink-0 text-right">
                            <button onClick={() => handleOpenChallenge(ch)} disabled={isCompletedToday} className="challenge-xp-action disabled:opacity-50">
                              {isCompletedToday ? 'VALIDADO' : 'INICIAR'} <ArrowRight size={26} />
                            </button>
                            {ch.id !== 'workout' && <span className="challenge-mini-progress">{isCompletedToday ? '1 / 1' : '0 / 1'}</span>}
                          </div>
                        </div>

                        {ch.id === 'workout' && <div className="challenge-day-progress"><span><Clock size={19} /> Progresso do dia</span><strong>{isCompletedToday ? '1 / 1' : '0 / 1'}</strong><div className="challenge-day-progress-track"><i style={{ width: isCompletedToday ? '100%' : '0%' }} /></div></div>}
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

      {/* Anti-cheat presence modal if required */}
      {presenceCheckRequired && presenceCheckData && (
        <VerifiedPresenceModal
          presenceCheckId={presenceCheckData.id}
          livenessPrompt={presenceCheckData.prompt}
          isOpen={presenceCheckRequired}
          onSuccess={async (result) => {
            setPresenceCheckRequired(false);
            setPresenceCheckData(null);
            const presenceStatus = normalizeActivityValidationStatus(result.status);
            const sessionType = activeSession?.type;

            if (presenceStatus === 'validated') {
              await activityService.completeSessionAfterPresence();
              setActiveSession(null);
              const points = typeof result.pointsAwarded === 'number' && Number.isFinite(result.pointsAwarded) && result.pointsAwarded > 0
                ? result.pointsAwarded
                : undefined;
              setCompletion({ status: 'approved', message: result.userMessage, pointsAwarded: points });
              if (points !== undefined) triggerXPToast(points, 'Atividade validada.');
              setFlowScreen(sessionType === 'cardio' ? 'cardio-complete' : 'workout-complete');
              setNotice(null);
            } else if (presenceStatus === 'pending') {
              await activityService.completeSessionAfterPresence();
              setActiveSession(null);
              setCompletion({ status: 'pending', message: result.userMessage });
              setFlowScreen(null);
              setNotice(result.userMessage || 'Atividade recebida e aguardando análise. Nenhuma pontuação foi liberada ainda.');
            } else {
              activityService.cancelSession();
              setActiveSession(null);
              setFlowScreen(null);
              setError(result.userMessage || 'A confirmação de presença não foi aprovada. Nenhuma pontuação foi concedida.');
            }
            await refreshUser();
            await loadSubmissions();
          }}
          onClose={() => {
            setPresenceCheckRequired(false);
            setPresenceCheckData(null);
            setNotice('A atividade continua em andamento. Finalize novamente quando estiver pronto para concluir a confirmação de presença.');
          }}
        />
      )}

      {/* #217: tela de detalhe estilo Strava mostrada JA na hora de finalizar a atividade */}
      {finishedActivityItem && !flowScreen && (
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
      {flowScreen && (
        <ChallengeActivityFlow
          screen={flowScreen}
          group={selectedMuscleGroup}
          onGroup={setSelectedMuscleGroup}
          cardio={selectedCardioOption}
          onCardio={(option) => { setSelectedCardioOption(option); setSelectedCardioType(option.id); }}
          session={activeSession}
          elapsed={elapsedTime}
          distance={liveDistanceKm}
          trajectory={finishedActivityItem?.trajectory}
          liveCheckpoints={activeSession?.checkpoints}
          gpsAccuracy={gpsAccuracy}
          gpsSignal={gpsSignal}
          gpsPermissionDenied={gpsPermissionDenied}
          gymName={profile?.gymName || 'Sua academia'}
          completedChallengeIds={Object.keys(submissions)}
          completion={completion}
          startError={startActivityError}
          loading={loading}
          startingActivity={startingActivity}
          onBack={handleFlowBack}
          onStart={handleFlowStart}
          onEnd={handleEndActivity}
          onSummary={() => setFlowScreen(flowScreen === 'cardio-complete' ? 'cardio-summary' : 'day-progress')}
          onDone={closeFlow}
          onCancel={handleCancelActivity}
          onShare={finishedActivityItem ? () => setShareCardData(buildShareableFromItem(finishedActivityItem)) : undefined}
        />
      )}
    </div>
  );
}
