import React, { useState, useRef, useEffect } from 'react';
import {
  Dumbbell,
  Clock, Flame, Trophy, X,
  Zap, AlertCircle, ArrowRight,
  Info, Footprints
} from 'lucide-react';
import { useLocation, useNavigate, useOutletContext, useSearchParams } from 'react-router-dom';
import { motion } from 'motion/react';
import { activityService } from '../services/activityService';
import { activityNotificationService } from '../services/activityNotificationService';
import { activityLiveActivityService } from '../services/activityLiveActivityService';
import { webGpsTrackingService } from '../services/webGpsTrackingService';
import { VerifiedPresenceModal } from '../components/VerifiedPresenceModal';
import { auth, db } from '../firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { ActivityCompetitionPolicy, ActivitySession } from '../types';
import { cn } from '../lib/utils';
import { formatPaceValue } from '../lib/runUtils';
import { hapticNotification } from '../lib/haptics';
import { useUser } from '../UserContext';
import { PrivateChallengesTab } from '../components/PrivateChallengesTab';
import { ActivityDetailScreen, ActivityHistorySection, ActivityHistoryItem } from '../components/ActivityHistorySection';
import { PowerLift } from './PowerLift';
import { RunShareCard } from '../components/RunShareCard';
import { CARDIO_OPTIONS, ChallengeActivityFlow, ChallengeFlowScreen, CardioOption, ActivityCompletion } from '../components/ChallengeActivityFlow';
import { getXPProgress } from '../lib/levelUtils';
import { normalizeActivityValidationStatus, readActivityTimestamp, resolveActivityState } from '../lib/workoutData';
import { ACHIEVEMENTS } from '../achievements';
import { ChallengesHubNew } from '../components/ChallengesHubNew';
import { ActivityHistoryPageNew } from '../components/ActivityHistoryPageNew';
import type { WorkoutHealthRecord } from '../core/health/workoutHealthTypes';

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
    subtitle: 'Escolha uma modalidade ao ar livre ou indoor',
    description: 'Complete uma sessão de cardio registrada no aplicativo.',
    icon: <Footprints size={28} className="text-primary" />,
    tag: 'Resistência & Queima',
    badgeColor: 'bg-orange-500/10 text-orange-400 border-orange-500/20'
  }
];

const DAILY_CHALLENGES_ORDER = ['workout', 'cardio'] as const;

export function Challenges() {
  const { user: profile, refreshUser } = useUser();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  // Selected Category State
  const initialCategory = (searchParams.get('category') as ChallengeCategory) || 'all';
  const [selectedCategory, setSelectedCategory] = useState<ChallengeCategory>(initialCategory);

  const { triggerXPToast } = useOutletContext<{ triggerXPToast: (p: number, m?: string, rankingPoints?: number) => void }>();

  // Active activity session state
  const initialActive = activityService.getCurrentSession();
  const initialActiveId = initialActive?.id || null;
  const [activeSession, setActiveSession] = useState<ActivitySession | null>(initialActive);
  const [elapsedTime, setElapsedTime] = useState(0);

  // Live GPS tracking state (distância/pace em tempo real durante cardio ao ar livre)
  const [liveDistanceKm, setLiveDistanceKm] = useState(0);
  const [liveSpeedKmH, setLiveSpeedKmH] = useState<number | null>(null);
  // Instante do último fix que alimentou a velocidade. Sem este marcador, a
  // tela continuava exibindo a última velocidade para sempre quando o GPS
  // perdia sinal, fazendo um valor antigo parecer "tempo real".
  const [liveSpeedUpdatedAt, setLiveSpeedUpdatedAt] = useState<number | null>(null);
  // #328: espelha liveDistanceKm p/ o tick de 1s da notificação Android poder
  // ler o valor mais recente sem precisar re-executar o efeito do GPS a cada
  // atualização de distância.
  const liveDistanceKmRef = useRef(0);
  useEffect(() => { liveDistanceKmRef.current = liveDistanceKm; }, [liveDistanceKm]);

  // #44 / ACT-10 (auditoria 6167c8f): estado do sinal de GPS e wake lock para
  // o mapa ao vivo (LiveTrackingMap). Antes o watchPosition/wake lock viviam
  // NESTE componente -- "Minimizar atividade" navega para /activity/exit,
  // que desmonta Challenges.tsx e derrubava o watcher junto (clearWatch no
  // cleanup do efeito), perdendo a rota percorrida enquanto o atleta
  // navegava por outras telas com o app aberto. Agora webGpsTrackingService
  // (src/services/webGpsTrackingService.ts) é o dono único do watcher,
  // iniciado/parado pelos mesmos pontos que controlam o coletor nativo em
  // activityService.ts -- esta tela só assina o snapshot para exibir sinal/
  // precisão/distância/velocidade ao vivo. Deixar de renderizá-la não para
  // mais a coleta.
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);
  const [gpsSignal, setGpsSignal] = useState<'SEARCHING' | 'WEAK' | 'STRONG'>('SEARCHING');
  const [gpsPermissionDenied, setGpsPermissionDenied] = useState(false);
  // #168: sem isto, um GPS que nunca consegue um fix (indoors, prédio alto,
  // erro silencioso do provedor nativo) deixava a tela presa para sempre em
  // "Buscando sinal..." sem nenhuma saída -- só fechando e reabrindo a
  // atividade. "Tentar novamente" agora chama webGpsTrackingService.retry()
  // diretamente (handleRetryGps abaixo).
  const [gpsStalled, setGpsStalled] = useState(false);

  // Tela de detalhe pos-atividade usada pelo fluxo de musculacao e pelo
  // historico. Cardio abre diretamente o banner novo de compartilhamento.
  const [finishedActivityItem, setFinishedActivityItem] = useState<ActivityHistoryItem | null>(null);
  // A primeira resposta da validacao de presenca ainda nao contem o registro
  // final. Guardamos o snapshot para montar o banner depois da selfie.
  const pendingPresenceSessionRef = useRef<{ session: ActivitySession; finishedAt: number; healthSession?: WorkoutHealthRecord } | null>(null);

  // Card premium de compartilhamento pós-atividade.
  const [shareCardData, setShareCardData] = useState<any>(null);

  // Today's completed submissions
  const [submissions, setSubmissions] = useState<Record<string, any>>({});
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);

  // Modals & Pending Operations
  // #234: HOME -> MUSCULACAO / CARDIO SEM ETAPA INTERMEDIARIA.
  //
  // A Home usa uma rota propria para cardio (/challenges/cardio). Mantemos a
  // query ?type=cardio como compatibilidade com links antigos, mas a rota sem
  // query e a entrada principal para o WKWebView do iPhone.
  // aberto apenas pelo useEffect mais abaixo, que roda DEPOIS da primeira
  // pintura: a lista de Desafios aparecia por um instante antes do overlay
  // subir, dando a impressao de ter sido jogado numa tela intermediaria e de
  // precisar procurar a atividade de novo. Resolvendo no proprio useState o
  // fluxo ja nasce aberto -- a lista nunca chega a ser vista.
  const directCardioPath = location.pathname === '/challenges/cardio';
  const deepLinkType = searchParams.get('type') || (directCardioPath ? 'cardio' : null);
  const deepLinkChallenge = deepLinkType === 'cardio'
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
  // Começa vazio de propósito. Mesmo quando o fluxo já nasce aberto pelo
  // useState acima, o efeito precisa ser a fonte única que consome o deep link
  // e marca a origem como Home. Inicializar com "cardio" fazia o efeito pular
  // justamente na primeira montagem e deixava a abertura dependente do timing
  // da transição de rota.
  const consumedDeepLinkRef = useRef<string | null>(null);
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
  const [startPolicy, setStartPolicy] = useState<ActivityCompetitionPolicy | null>(initialActive?.competitionPolicy || null);
  const [policyLoading, setPolicyLoading] = useState(false);
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

  // A política é preparada antes do toque em "Iniciar". Assim, se a sessão
  // competitiva precisar de movimento, o prompt do iOS nasce diretamente do
  // gesto do usuário, sem uma chamada de rede no meio.
  useEffect(() => {
    if (!profile?.uid || flowScreen !== 'cardio-picker' || activeSession) return;
    let active = true;
    setPolicyLoading(true);
    setStartPolicy(null);
    activityService.resolveCompetitionPolicy('cardio', selectedCardioOption.id)
      .then((policy) => { if (active) setStartPolicy(policy); })
      .catch((reason) => { if (active) setStartActivityError(reason.message || 'Não foi possível preparar o cardio.'); })
      .finally(() => { if (active) setPolicyLoading(false); });
    return () => { active = false; };
  }, [profile?.uid, flowScreen, selectedCardioOption.id, activeSession?.id]);

  // Cardio States
  const [selectedCardioType, setSelectedCardioType] = useState<string>(initialActive?.cardioType || 'running');
  const levelProgress = getXPProgress(profile?.xp || 0);
  const unlockedBadges = ACHIEVEMENTS.filter((achievement) => profile?.achievements?.includes(achievement.id));

  // Se a tela foi aberta depois de o app ser encerrado, o estado local pode
  // estar vazio mesmo com uma sessão ativa no servidor. Recuperar aqui faz as
  // rotas `/activity/ongoing` e `/running` abrirem diretamente a atividade,
  // sem mandar o atleta de volta para a seleção de modalidade.
  useEffect(() => {
    if (initialActiveId || !auth.currentUser) return undefined;
    let cancelled = false;
    void activityService.restoreActiveSession().then((restored) => {
      if (cancelled || !restored) return;
      setActiveSession(restored);
      setFlowScreen('active');
      if (restored.cardioType) {
        const matched = CARDIO_OPTIONS.find((option) => option.id === restored.cardioType);
        if (matched) {
          setSelectedCardioOption(matched);
          setSelectedCardioType(matched.id);
        }
      }
      if (restored.muscleGroup) setSelectedMuscleGroup(restored.muscleGroup);
    }).catch((restoreError) => {
      if (!cancelled) console.warn('[Challenges] Não foi possível restaurar a atividade em andamento:', restoreError);
    });
    return () => { cancelled = true; };
  }, [initialActiveId, profile?.uid]);

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
          const activityState = resolveActivityState(data);
          // Missões de frequência contam o registro concluído. A decisão de
          // ranking/campeonato não apaga a realização pessoal da atividade.
          if (
            (data.type === 'workout' || data.type === 'cardio') &&
            activityState.isCompleted &&
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
        // #324: tempo em pausa (inclusive a pausa que ainda esta correndo
        // agora) some do cronometro exibido -- senao ele continuava andando
        // parado, como se a pausa nao existisse na tela.
        const now = Date.now();
        const pausaCorrente = current.pauseStartedAt ? now - new Date(current.pauseStartedAt).getTime() : 0;
        const pausedMs = (current.pausedMs || 0) + Math.max(0, pausaCorrente);
        const duration = Math.max(0, Math.floor((now - startTimeMs - pausedMs) / 1000));
        setElapsedTime(duration);
        // #328: mantém a notificação persistente (Android) viva com o
        // cronômetro/distância atuais -- update() já se auto-throttla, então
        // pode ser chamado a cada tick sem sobrecarregar o sistema.
        activityNotificationService.update(current, duration, liveDistanceKmRef.current);
        activityLiveActivityService.update(current, duration, liveDistanceKmRef.current);
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

  // ACT-10 (auditoria 6167c8f): a coleta em si (watchPosition, wake lock,
  // addCheckpoint/recordGpsSpeedSample) já não vive mais aqui -- vive em
  // webGpsTrackingService, iniciada/parada pelos mesmos pontos que já
  // controlam o coletor nativo em activityService.ts (startSession/
  // endSession/cancelSession/pauseSession/resumeSession/restoreActiveSession),
  // e portanto sobrevive a esta tela desmontar quando o atleta minimiza a
  // atividade e navega para outras telas com o app aberto. Este efeito
  // apenas ASSINA o snapshot já em andamento para exibir sinal, precisão,
  // distância e velocidade -- é puramente apresentação, como pede o fix
  // sugerido pela própria auditoria.
  useEffect(() => {
    if (!activeSession || !activeSession.requiresGpsDistance) {
      setLiveDistanceKm(0);
      setLiveSpeedKmH(null);
      setLiveSpeedUpdatedAt(null);
      setGpsAccuracy(null);
      setGpsSignal('SEARCHING');
      setGpsPermissionDenied(false);
      setGpsStalled(false);
      return;
    }

    const applySnapshot = (snap: ReturnType<typeof webGpsTrackingService.getSnapshot>) => {
      // Um snapshot de uma sessão diferente (ex.: o watcher ainda está
      // encerrando a anterior) nunca deve pintar a tela da sessão atual.
      if (snap.sessionId !== activeSession.id) return;
      setGpsAccuracy(snap.accuracy);
      setGpsSignal(snap.signal);
      setGpsPermissionDenied(snap.permissionDenied);
      setGpsStalled(snap.stalled);
      setLiveDistanceKm(snap.liveDistanceKm);
      setLiveSpeedKmH(snap.liveSpeedKmH);
      setLiveSpeedUpdatedAt(snap.liveSpeedUpdatedAt);
    };

    // Hidrata imediatamente com o estado atual -- cobre tanto o caso normal
    // (watcher já rodando desde o startSession) quanto reabrir esta tela
    // depois de minimizar: o snapshot reflete tudo que foi coletado enquanto
    // o atleta estava em outras telas, sem esperar o próximo fix chegar.
    applySnapshot(webGpsTrackingService.getSnapshot());
    const unsubscribe = webGpsTrackingService.subscribe(applySnapshot);

    // NUNCA chama stop() aqui: encerrar esta assinatura ao desmontar não
    // pode derrubar a coleta -- só quem realmente encerra a sessão
    // (activityService.endSession/cancelSession) tem autoridade para isso.
    return unsubscribe;
  }, [activeSession?.id, activeSession?.requiresGpsDistance]);

  // Open Challenge Modal
  const handleOpenChallenge = (challenge: CoreChallenge) => {
    if (challenge.id === 'workout') {
      navigate('/musculacao');
      return;
    }
    setStartActivityError(null);
    setError(null);
    setNotice(null);
    setCompletion(null);
    setFlowScreen('cardio-picker');
  };

  // A Home pode abrir diretamente o fluxo correto. Consumimos o parâmetro após
  // a abertura para que fechar a tela não a reabra em loop.
  useEffect(() => {
    const requestedType = searchParams.get('type') || (location.pathname === '/challenges/cardio' ? 'cardio' : null);
    if (requestedType !== 'workout' && requestedType !== 'cardio') return;
    if (requestedType === 'workout') {
      navigate('/musculacao', { replace: true });
      return;
    }
    // #250: só pula se ESTE MESMO valor de type já foi processado por este
    // efeito. Não depende de flowScreen nem do timing da primeira renderização.
    // Assim o deep link sempre abre a tela certa na primeira vez que aparece,
    // mesmo se o componente já tiver montado com outro fluxo.
    if (consumedDeepLinkRef.current !== requestedType) {
      consumedDeepLinkRef.current = requestedType;
      const challenge = CORE_CHALLENGES.find((item) => item.id === requestedType);
      if (challenge) { openedFromHomeRef.current = true; handleOpenChallenge(challenge); }
    }
    if (searchParams.has('type')) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete('type');
      setSearchParams(nextParams, { replace: true });
    }
  }, [location.pathname, navigate, searchParams, setSearchParams]);

  // Fechar o fluxo deve devolver o usuario para ONDE ELE VEIO. Quem entrou pela
  // Home volta para a Home; quem abriu pela propria tela de Desafios continua
  // nela. Durante uma atividade, fechar/minimizar usa uma rota explícita de
  // saída e mantém a sessão ativa para o indicador flutuante reabrir depois.
  const closeFlow = () => {
    const minimizingActiveSession = Boolean(activeSession && flowScreen === 'active');
    setFlowScreen(null); setFinishedActivityItem(null); setCompletion(null);
    if (minimizingActiveSession) {
      navigate('/activity/exit', { replace: true });
      return;
    }
    if (openedFromHomeRef.current) { openedFromHomeRef.current = false; navigate('/'); }
  };

  // Start Session (Workout / Cardio)
  const handleStartActivity = async (type: 'workout' | 'cardio') => {
    setStartActivityError(null);
    setError(null);
    const policy = startPolicy;
    const expectedCardio = type === 'cardio' ? selectedCardioOption.id : undefined;
    if (!policy || policy.activityType !== type
      || String(policy.cardioType || '') !== String(expectedCardio || '')
      || Date.parse(policy.startBy) < Date.now()) {
      setPolicyLoading(true);
      setStartActivityError('Estamos renovando a autorização. Quando esta mensagem sumir, toque em iniciar novamente.');
      try {
        setStartPolicy(await activityService.resolveCompetitionPolicy(type, expectedCardio));
        setStartActivityError(null);
      } catch (err: any) {
        setStartActivityError(err.message || 'Não foi possível preparar a atividade.');
      } finally {
        setPolicyLoading(false);
      }
      return;
    }
    const motionPermission = policy.requiresMotionSensors
      ? activityService.requestMotionPermission()
      : Promise.resolve('granted' as const);
    setStartingActivity(true);
    try {
      await motionPermission;
      const confirmedCheckIn = type === 'workout' && policy.requiresGymCheckIn
        ? await activityService.performGymCheckIn(policy)
        : null;
      const session = await activityService.startSession(
        type,
        confirmedCheckIn?.location,
        type === 'cardio' ? selectedCardioOption.id : undefined,
        undefined,
        confirmedCheckIn?.checkInId,
        type === 'workout' ? selectedMuscleGroup : undefined,
        undefined,
        policy,
      );
      setActiveSession(session);
      setCompletion(null);
      setFlowScreen('active');
      // #328: sobe a notificação persistente Android assim que a sessão
      // realmente começa -- é best-effort e nunca bloqueia o fluxo (ver
      // implementação do service).
      activityNotificationService.start(session, 0, 0);
      activityLiveActivityService.start(session, 0, 0);
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
    status: item.status,
    validationStatus: item.statusRaw,
    recordStatus: item.recordStatus,
    activityMode: item.activityMode,
    competitionReviewStatus: item.competitionStatus,
    photoUrl: item.photoUrl,
  });

  const buildFinishedItemFromPresence = (
    session: ActivitySession,
    finishedAt: number,
    result: { status: string; pointsAwarded?: number; commitResult?: any },
    healthSession?: WorkoutHealthRecord
  ): ActivityHistoryItem => {
    const startMs = Date.parse(session.startTime);
    const durationMins = Number.isFinite(startMs)
      ? Math.max(0, Math.round(((finishedAt - startMs - (session.pausedMs || 0)) / 60000) * 100) / 100)
      : undefined;
    const distanceKm = session.requiresGpsDistance
      ? activityService.calculateSessionDistance(session)
      : undefined;
    const trajectory = (session.checkpoints || [])
      .filter((checkpoint) => checkpoint.location && Number.isFinite(checkpoint.location.lat) && Number.isFinite(checkpoint.location.lng))
      .map((checkpoint) => ({ lat: checkpoint.location.lat, lng: checkpoint.location.lng }));
    const validTrajectory = trajectory.length >= 2 ? trajectory : undefined;
    const pace = session.type === 'cardio' && distanceKm !== undefined && distanceKm > 0 && durationMins !== undefined && durationMins > 0
      ? formatPaceValue(distanceKm, durationMins * 60)
      : undefined;
    const activityState = resolveActivityState({
      ...(result.commitResult || {}),
      recordStatus: 'completed',
      activityMode: 'competitive',
      competitionReviewStatus: result.commitResult?.competitionReviewStatus || result.status,
    });
    const historyStatus: ActivityHistoryItem['status'] = activityState.competitionStatus === 'approved'
      ? 'homologada'
      : activityState.competitionStatus === 'rejected' || activityState.competitionStatus === 'ineligible'
        ? 'rejeitada'
        : activityState.competitionStatus === 'pending' || activityState.competitionStatus === 'resolution_pending'
          ? 'pendente'
          : 'registrada';
    const completedAt = new Date(Number.isFinite(startMs) ? finishedAt : Date.now());
    const cardioLabel = session.cardioTypeLabel || selectedCardioOption.label || 'Cardio';
    const rawCalories = session.healthTelemetry?.calories;
    const rawHeartRate = session.healthTelemetry?.avgHeartRate ?? Number(session.smartwatchData?.avgHeartRate ?? session.smartwatchData?.heartRate);
    const rawSteps = session.healthTelemetry?.steps ?? Number(session.smartwatchData?.steps ?? session.smartwatchData?.pedometerSteps);
    const activityId = result.commitResult?.activityId || result.commitResult?.id || `local_${session.id}`;

    return {
      id: activityId,
      source: 'workout',
      type: session.type === 'cardio' ? 'cardio' : 'workout',
      typeLabel: session.type === 'cardio' ? 'Cardio' : 'Treino',
      title: session.type === 'cardio' ? cardioLabel : `Treino de ${session.muscleGroup || selectedMuscleGroup}`,
      dateStr: completedAt.toLocaleDateString('pt-BR'),
      timeStr: completedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      rawTimestamp: completedAt.getTime(),
      status: historyStatus,
      statusRaw: result.status,
      recordStatus: activityState.recordStatus,
      activityMode: activityState.activityMode,
      competitionStatus: activityState.competitionStatus,
      points: typeof result.pointsAwarded === 'number' && Number.isFinite(result.pointsAwarded)
        ? result.pointsAwarded
        : 0,
      durationMins,
      distanceKm,
      calories: typeof rawCalories === 'number' && Number.isFinite(rawCalories) ? rawCalories : undefined,
      avgHeartRate: Number.isFinite(rawHeartRate) && rawHeartRate > 0 ? rawHeartRate : undefined,
      steps: Number.isFinite(rawSteps) && rawSteps > 0 ? rawSteps : undefined,
      pace,
      trajectory: validTrajectory,
      details: { ...result.commitResult, healthSession: result.commitResult?.healthSession ?? healthSession },
    };
  };

  // End Workout/Cardio Session
  const handleEndActivity = async () => {
    // #328: o botão "Finalizar" do app já é desabilitado durante `loading`,
    // mas o botão da notificação persistente/Live Activity chama este mesmo
    // handler direto via ref, sem passar pela UI -- sem esta guarda, um toque
    // na notificação enquanto uma finalização anterior ainda está em voo
    // (ex: rede lenta) disparava uma segunda chamada concorrente a
    // endSession(), duplicando o envio e deixando o estado inconsistente.
    if (!activeSession || loading) return;
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
        pendingPresenceSessionRef.current = {
          session: {
            ...sessionBeforeEnd,
            checkpoints: [...(sessionBeforeEnd.checkpoints || [])]
          },
          finishedAt: res.healthSession ? Date.parse(res.healthSession.endedAt) : Date.now(),
          healthSession: res.healthSession,
        };
        setPresenceCheckData({ id: res.presenceCheckId, prompt: res.livenessPrompt || 'Siga o gesto indicado' });
        setPresenceCheckRequired(true);
        setNotice(res.userMessage || 'Uma confirmação de presença é necessária antes da validação da atividade.');
        return;
      }

      // #328: a sessão deixou de estar "ativa" nesse ponto (validada, pendente
      // ou rejeitada) -- a notificação persistente não faz mais sentido em
      // nenhum desses desfechos.
      activityNotificationService.stop();
      activityLiveActivityService.stop();

      const status = normalizeActivityValidationStatus(
        res.validation?.status ?? res.workout?.status
      );
      const activityState = resolveActivityState({
        ...(res.workout as any),
        recordStatus: res.recordStatus || res.workout?.recordStatus,
        activityMode: res.activityMode || res.workout?.activityMode,
        competitionReviewStatus: res.competitionReviewStatus || res.workout?.competitionReviewStatus,
      });
      // Este card representa o ganho desta atividade, nunca o total semanal
      // do IGA retornado em `rankingPointsEarned` por compatibilidade.
      const rankingPoints = typeof res.workout?.competitionPoints === 'number'
        ? res.workout.competitionPoints
        : undefined;
      const points = typeof res.workout?.points === 'number' && Number.isFinite(res.workout.points) && res.workout.points > 0
        ? res.workout.points
        : undefined;

      // O registro retornado pelo servidor entra imediatamente no historico,
      // inclusive enquanto aguarda a decisao antifraude. Nenhum valor e
      // inventado no cliente e pontos so aparecem quando o servidor aprova.
      const timestampMs = res.workout?.timestamp ? Date.parse(res.workout.timestamp) : Number.NaN;
      if (res.workout?.id && Number.isFinite(timestampMs) && activityState.isCompleted) {
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
          ? formatPaceValue(serverDistance, timeSeconds)
          : undefined;
        const muscleGroup = (res.workout as any)?.muscleGroup || sessionBeforeEnd.muscleGroup || selectedMuscleGroup;
        const workoutTitle = muscleGroup ? `Treino de ${muscleGroup}` : 'Treino de Musculação';
        const historyStatus: ActivityHistoryItem['status'] = activityState.competitionStatus === 'approved'
          ? 'homologada'
          : activityState.competitionStatus === 'pending' || activityState.competitionStatus === 'resolution_pending'
            ? 'pendente'
            : activityState.competitionStatus === 'rejected' || activityState.competitionStatus === 'ineligible'
              ? 'rejeitada'
              : 'registrada';

        if (serverDistance !== undefined) setLiveDistanceKm(serverDistance);

        const finishedItem: ActivityHistoryItem = {
          id: res.workout.id,
          source: 'workout',
          type: sessionType === 'cardio' ? 'cardio' : 'workout',
          typeLabel: sessionType === 'cardio' ? 'Cardio' : 'Treino',
          title: sessionType === 'cardio' ? (cardioTypeLabels[res.workout.cardioType || selectedCardioType] || 'Cardio') : workoutTitle,
          dateStr,
          timeStr,
          rawTimestamp: timestampMs,
          status: historyStatus,
          statusRaw: status || res.validation?.status || 'recorded',
          recordStatus: activityState.recordStatus,
          activityMode: activityState.activityMode,
          competitionStatus: activityState.competitionStatus,
          points: points || 0,
          rankingPointsEarned: historyStatus === 'homologada' && typeof rankingPoints === 'number' ? rankingPoints : undefined,
          durationMins: serverDuration,
          distanceKm: serverDistance,
          calories,
          avgHeartRate: typeof (res.workout as any).avgHeartRate === 'number' ? (res.workout as any).avgHeartRate : undefined,
          pace,
          trajectory,
          photoUrl: (res.workout as any).photoUrl || (res.workout as any).verificationPhotoUrl,
          details: {
            healthSession: res.healthSession,
            healthSessionStatus: res.healthSessionStatus,
            healthSessionReason: res.healthSessionReason,
            activityMode: activityState.activityMode,
            competitionStatus: activityState.competitionStatus,
          },
        };
        // The athlete reviews private health feedback before choosing whether
        // to share the existing public card, which contains no health record.
        setFinishedActivityItem(finishedItem);
        setHistoryRefreshKey((key) => key + 1);
      }

      if (activityState.isCompleted) {
        setActiveSession(null);
        if (points !== undefined) {
          void hapticNotification('success');
          triggerXPToast(points, 'Atividade concluída.', activityState.isCompetitionApproved ? rankingPoints : undefined);
        }
        if (activityState.competitionStatus === 'approved') {
          setCompletion({ status: 'approved', message: res.message, pointsAwarded: points });
        } else if (activityState.competitionStatus === 'pending' || activityState.competitionStatus === 'resolution_pending') {
          setCompletion({ status: 'pending', message: res.message, pointsAwarded: points });
          setNotice(res.message || 'Atividade salva. Somente a pontuação competitiva está sendo processada.');
        } else if (activityState.competitionStatus === 'rejected' || activityState.competitionStatus === 'ineligible') {
          setCompletion({ status: 'rejected', message: res.message, pointsAwarded: points });
          setNotice(res.message || 'Atividade salva no histórico, mas fora da pontuação competitiva.');
        } else {
          setCompletion({ status: 'recorded', message: res.message, pointsAwarded: points });
        }
        setFlowScreen(sessionType === 'cardio' ? null : 'workout-complete');
      } else {
        setError(res.message || 'O servidor não confirmou o registro da atividade.');
      }
      // Perfil e historico sao independentes. Em serie, duas leituras remotas
      // prolongavam a tela de finalizacao mesmo depois de o servidor ja ter
      // devolvido a decisao antifraude.
      await Promise.allSettled([refreshUser(), loadSubmissions()]);
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
      activityNotificationService.stop();
      activityLiveActivityService.stop();
      setActiveSession(null);
      setFlowScreen(null);
      setError(null);
      setLoading(false);
      triggerXPToast(0, 'Sessão descartada.');
      navigate('/activity/exit', { replace: true });
    }
  };

  // #168 / ACT-10: reinicia o watch de GPS do zero sem descartar a sessão em
  // andamento. webGpsTrackingService.retry() já faz stop()+start() e notifica
  // os assinantes com o snapshot limpo -- não precisa mais de uma chave de
  // efeito para forçar o React a refazer nada.
  const handleRetryGps = () => {
    if (activeSession) webGpsTrackingService.retry(activeSession);
  };

  // #324: pausa/retoma a sessao ativa. So existia no componente orfao
  // RunTracker.tsx antes -- o fluxo de verdade nao tinha essa acao.
  const handleTogglePause = () => {
    const updated = activeSession?.isPaused
      ? activityService.resumeSession()
      : activityService.pauseSession();
    if (updated) {
      setActiveSession(updated);
      // #328: mudança de estado (pausar/retomar) atualiza a notificação na
      // hora -- não espera o próximo tick de 5s do throttle normal.
      activityNotificationService.update(updated, elapsedTime, liveDistanceKmRef.current, true);
      activityLiveActivityService.update(updated, elapsedTime, liveDistanceKmRef.current, true);
    }
  };

  // #328: registra o listener dos botões da notificação persistente (Pausar/
  // Retomar e Finalizar) uma única vez. Usa refs para sempre chamar a versão
  // mais recente dos handlers -- sem isso o listener (registrado com []) ficaria
  // preso na closure da primeira renderização, com estado desatualizado.
  const handleTogglePauseRef = useRef(handleTogglePause);
  handleTogglePauseRef.current = handleTogglePause;
  const handleEndActivityRef = useRef(handleEndActivity);
  handleEndActivityRef.current = handleEndActivity;
  useEffect(() => {
    activityNotificationService.registerButtonListener(
      () => handleTogglePauseRef.current(),
      () => handleEndActivityRef.current()
    );
    activityLiveActivityService.registerButtonListener(
      () => handleTogglePauseRef.current(),
      () => handleEndActivityRef.current()
    );
  }, []);


  const handleFlowStart = (type: 'workout' | 'cardio', _options?: { checkIn?: boolean }) => {
    void handleStartActivity(type);
  };

  const handleFlowBack = () => {
    if (flowScreen === 'workout-checkin') setFlowScreen('workout-details');
    else closeFlow();
  };

  const showNewChallengesHub = !flowScreen
    && !finishedActivityItem
    && !shareCardData
    && !presenceCheckRequired
    && !error
    && !notice
    && selectedCategory === 'all'
    && searchParams.get('view') !== 'history';

  if (!flowScreen && searchParams.get('view') === 'history') {
    return <ActivityHistoryPageNew />;
  }

  if (showNewChallengesHub) {
    const cardioChallenge = CORE_CHALLENGES.find(item => item.id === 'cardio');
    return <ChallengesHubNew
      onCardio={() => { if (cardioChallenge) handleOpenChallenge(cardioChallenge); }}
      onHistory={() => setSearchParams({ view: 'history' })}
    />;
  }

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
            <p className="font-bold uppercase tracking-wider text-[11px] text-rose-400">Não foi possível concluir</p>
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
              Nenhuma conquista desbloqueada foi registrada ainda.
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
        <div className="challenge-catalogue flex flex-col gap-4">

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
                  <span className="mt-1 block text-[12px] leading-none text-white/65">Atividades concluídas atualizam seu progresso</span>
                </div>
                <Info size={22} strokeWidth={1.7} className="text-white/60" />
              </div>

              <div className="grid grid-cols-1 gap-2.5">
                {CORE_CHALLENGES.slice().sort((a, b) => DAILY_CHALLENGES_ORDER.indexOf(a.id) - DAILY_CHALLENGES_ORDER.indexOf(b.id)).map((ch) => {
                  const isCompletedToday = Boolean(submissions[ch.id]);
                  const isRunning = activeSession?.type === ch.id;

                  return (
                    <React.Fragment key={ch.id}>
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
                            <button onClick={() => handleOpenChallenge(ch)} className="challenge-xp-action">
                              {isCompletedToday ? 'INICIAR OUTRA' : 'INICIAR'} <ArrowRight size={26} />
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

          {selectedCategory === 'all' && (
            <div className="order-3 mt-2">
              <ActivityHistorySection refreshKey={historyRefreshKey} />
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
            const pendingPresence = pendingPresenceSessionRef.current;
            const sessionType = pendingPresence?.session.type || activeSession?.type;
            const terminalStatus = presenceStatus === 'validated'
              || presenceStatus === 'pending'
              || presenceStatus === 'rejected'
              || presenceStatus === 'not_eligible';
            if (!terminalStatus) {
              setError(result.userMessage || 'A resposta da confirmação de presença não foi reconhecida. A atividade continua salva no aparelho.');
              return;
            }

            pendingPresenceSessionRef.current = null;
            await activityService.completeSessionAfterPresence();
            setActiveSession(null);
            const points = typeof result.pointsAwarded === 'number' && Number.isFinite(result.pointsAwarded) && result.pointsAwarded > 0
              ? result.pointsAwarded
              : undefined;
            const completionStatus: ActivityCompletion['status'] = presenceStatus === 'validated'
              ? 'approved'
              : presenceStatus === 'pending'
                ? 'pending'
                : 'rejected';
            setCompletion({ status: completionStatus, message: result.userMessage, pointsAwarded: points });
            if (points !== undefined) {
              void hapticNotification('success');
              triggerXPToast(points, 'Atividade concluída.');
            }
            if (pendingPresence) {
              const finishedItem = buildFinishedItemFromPresence(pendingPresence.session, pendingPresence.finishedAt, result, pendingPresence.healthSession);
              setFinishedActivityItem(finishedItem);
              setHistoryRefreshKey((key) => key + 1);
            }
            setFlowScreen(sessionType === 'cardio' ? null : 'workout-complete');
            setNotice(presenceStatus === 'validated'
              ? null
              : presenceStatus === 'pending'
                ? (result.userMessage || 'Atividade concluída. Somente a pontuação competitiva está em análise.')
                : (result.userMessage || 'Atividade concluída e salva no histórico, mas fora da pontuação competitiva.'));
            await Promise.allSettled([refreshUser(), loadSubmissions()]);
          }}
          onClose={() => {
            setPresenceCheckRequired(false);
            setPresenceCheckData(null);
            setNotice('A atividade continua em andamento. Finalize novamente quando estiver pronto para concluir a confirmação de presença.');
          }}
        />
      )}

      {/* Card premium de compartilhamento pós-atividade (estilo Strava) */}
      {shareCardData && (
        <RunShareCard session={shareCardData} onClose={() => { setShareCardData(null); if (!finishedActivityItem) closeFlow(); }} />
      )}
      {finishedActivityItem && !shareCardData && (
        <ActivityDetailScreen
          item={finishedActivityItem}
          onClose={closeFlow}
          onShare={() => setShareCardData(buildShareableFromItem(finishedActivityItem))}
        />
      )}
      {flowScreen && !finishedActivityItem && (
        <ChallengeActivityFlow
          screen={flowScreen}
          group={selectedMuscleGroup}
          onGroup={setSelectedMuscleGroup}
          cardio={selectedCardioOption}
          onCardio={(option) => { setStartPolicy(null); setSelectedCardioOption(option); setSelectedCardioType(option.id); }}
          session={activeSession}
          elapsed={elapsedTime}
          distance={liveDistanceKm}
          currentSpeedKmH={liveSpeedKmH}
          currentSpeedUpdatedAt={liveSpeedUpdatedAt}
          liveCheckpoints={activeSession?.checkpoints}
          gpsAccuracy={gpsAccuracy}
          gpsSignal={gpsSignal}
          gpsPermissionDenied={gpsPermissionDenied}
          gpsStalled={gpsStalled}
          onRetryGps={handleRetryGps}
          gymName={profile?.gymName || 'Sua academia'}
          checkInRequired={(startPolicy || activeSession?.competitionPolicy)?.requiresGymCheckIn === true}
          completedChallengeIds={Object.keys(submissions)}
          completion={completion}
          startError={startActivityError}
          endError={error}
          loading={loading}
          startingActivity={startingActivity || policyLoading}
          onBack={handleFlowBack}
          onStart={handleFlowStart}
          onEnd={handleEndActivity}
          onTogglePause={handleTogglePause}
          onSummary={() => setFlowScreen('day-progress')}
          onDone={closeFlow}
          onCancel={handleCancelActivity}
        />
      )}
    </div>
  );
}
