import { useState, useRef, useEffect } from 'react';
import { useLocation, useNavigate, useOutletContext, useSearchParams } from 'react-router-dom';
import { activityService } from '../services/activityService';
import { activityNotificationService } from '../services/activityNotificationService';
import { activityLiveActivityService } from '../services/activityLiveActivityService';
import { webGpsTrackingService } from '../services/webGpsTrackingService';
import { VerifiedPresenceModal } from '../components/VerifiedPresenceModal';
import { auth, db } from '../firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { ActivityCompetitionPolicy, ActivitySession } from '../types';
import { formatPaceValue } from '../lib/runUtils';
import { hapticNotification } from '../lib/haptics';
import { useUser } from '../UserContext';
import { ActivityDetailScreen, ActivityHistoryItem } from '../components/ActivityHistorySection';
import { RunShareCard } from '../components/RunShareCard';
import { CARDIO_OPTIONS, ChallengeActivityFlow, ChallengeFlowScreen, CardioOption, ActivityCompletion } from '../components/ChallengeActivityFlow';
import { normalizeActivityValidationStatus, readActivityTimestamp, resolveActivityState } from '../lib/workoutData';
import { ChallengesHubNew } from '../components/ChallengesHubNew';
import { ActivityHistoryPageNew } from '../components/ActivityHistoryPageNew';
import { PrivateChallengesPageNew } from '../components/PrivateChallengesPageNew';
import type { WorkoutHealthRecord } from '../core/health/workoutHealthTypes';
import { bindObjectiveSession, objectiveRequest } from '../services/cardioObjectiveService';
import { localDate, safetyDecision } from '../core/cardioObjective/engine';

type CoreChallenge = { id: 'workout' | 'cardio' };
const CORE_CHALLENGES: CoreChallenge[] = [{ id: 'workout' }, { id: 'cardio' }];

export function Challenges() {
  const { user: profile, refreshUser } = useUser();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const objectiveJourneyId = searchParams.get('journeyId');
  const objectiveMissionId = searchParams.get('missionId');

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
  // o mapa ao vivo. A coleta pertence ao webGpsTrackingService e sobrevive ao
  // ciclo de vida desta tela; aqui apenas exibimos o snapshot atual.
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);
  const [gpsSignal, setGpsSignal] = useState<'SEARCHING' | 'WEAK' | 'STRONG'>('SEARCHING');
  const [gpsPermissionDenied, setGpsPermissionDenied] = useState(false);
  const [gpsStalled, setGpsStalled] = useState(false);

  // Tela de detalhe pós-atividade usada pelo fluxo real de atividade.
  const [finishedActivityItem, setFinishedActivityItem] = useState<ActivityHistoryItem | null>(null);
  const pendingPresenceSessionRef = useRef<{ session: ActivitySession; finishedAt: number; healthSession?: WorkoutHealthRecord } | null>(null);
  const [shareCardData, setShareCardData] = useState<any>(null);

  // Today's completed submissions — ainda alimenta o fluxo atual e as missões.
  const [submissions, setSubmissions] = useState<Record<string, any>>({});

  // #234: HOME -> CARDIO sem catálogo intermediário. Musculação possui o
  // próprio fluxo atual em /musculacao.
  const directCardioPath = location.pathname === '/challenges/cardio';
  const deepLinkType = searchParams.get('type') || (directCardioPath ? 'cardio' : null);
  const deepLinkChallenge = deepLinkType === 'cardio'
    ? CORE_CHALLENGES.find((item) => item.id === deepLinkType) || null
    : null;
  const openedFromHomeRef = useRef<boolean>(Boolean(deepLinkChallenge));
  const consumedDeepLinkRef = useRef<string | null>(null);
  const [flowScreen, setFlowScreen] = useState<ChallengeFlowScreen | null>(
    initialActive
      ? 'active'
      : deepLinkChallenge
        ? 'cardio-picker'
        : null
  );
  const [selectedMuscleGroup, setSelectedMuscleGroup] = useState(initialActive?.muscleGroup || 'Pernas');
  const [selectedCardioOption, setSelectedCardioOption] = useState<CardioOption>(
    CARDIO_OPTIONS.find(o => o.id === (initialActive?.cardioType || searchParams.get('modality'))) || CARDIO_OPTIONS[0]
  );
  const [startPolicy, setStartPolicy] = useState<ActivityCompetitionPolicy | null>(initialActive?.competitionPolicy || null);
  const [policyLoading, setPolicyLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [startingActivity, setStartingActivity] = useState(false);
  const endActivityAbortRef = useRef<AbortController | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [startActivityError, setStartActivityError] = useState<string | null>(null);
  const [presenceCheckRequired, setPresenceCheckRequired] = useState(false);
  const [presenceCheckData, setPresenceCheckData] = useState<{ id: string; prompt: string } | null>(null);
  const [completion, setCompletion] = useState<ActivityCompletion | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!objectiveJourneyId || !objectiveMissionId || activeSession?.type !== 'cardio') return;
    let current = true;
    void bindObjectiveSession(objectiveJourneyId, objectiveMissionId, activeSession.id)
      .catch(() => { if (current) setNotice('Seu Cardio está ativo, mas a meta não foi vinculada. Volte a Meu Objetivo para tentar novamente antes de finalizar.'); });
    return () => { current = false; };
  }, [objectiveJourneyId, objectiveMissionId, activeSession?.id]);

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

  const [selectedCardioType, setSelectedCardioType] = useState<string>(initialActive?.cardioType || 'running');

  // Links antigos de categorias não podem mais reativar o catálogo removido.
  // Encaminhamos cada destino ainda válido para a tela nova correspondente e
  // apagamos parâmetros sem equivalente atual.
  useEffect(() => {
    const legacyCategory = searchParams.get('category');
    if (!legacyCategory) return;
    if (legacyCategory === 'powerlift') { navigate('/power', { replace: true }); return; }
    if (legacyCategory === 'ranking') { navigate('/championships?section=ranking', { replace: true }); return; }
    if (legacyCategory === 'conquistas') { navigate('/achievements', { replace: true }); return; }
    const next = new URLSearchParams(searchParams);
    next.delete('category');
    if (legacyCategory === 'privados') next.set('view', 'private');
    setSearchParams(next, { replace: true });
  }, [navigate, searchParams, setSearchParams]);

  // Se a tela foi aberta depois de o app ser encerrado, o estado local pode
  // estar vazio mesmo com uma sessão ativa no servidor. Recuperar aqui faz as
  // rotas de atividade abrirem diretamente a sessão atual.
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
        const now = Date.now();
        const pausaCorrente = current.pauseStartedAt ? now - new Date(current.pauseStartedAt).getTime() : 0;
        const pausedMs = (current.pausedMs || 0) + Math.max(0, pausaCorrente);
        const duration = Math.max(0, Math.floor((now - startTimeMs - pausedMs) / 1000));
        setElapsedTime(duration);
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
          if (current.muscleGroup) setSelectedMuscleGroup(current.muscleGroup);
        }
      } else {
        setElapsedTime(0);
      }
    };

    syncSession();
    const interval = setInterval(syncSession, 1000);
    return () => clearInterval(interval);
  }, [flowScreen]);

  // ACT-10: a coleta vive em webGpsTrackingService; esta tela só assina.
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
      if (snap.sessionId !== activeSession.id) return;
      setGpsAccuracy(snap.accuracy);
      setGpsSignal(snap.signal);
      setGpsPermissionDenied(snap.permissionDenied);
      setGpsStalled(snap.stalled);
      setLiveDistanceKm(snap.liveDistanceKm);
      setLiveSpeedKmH(snap.liveSpeedKmH);
      setLiveSpeedUpdatedAt(snap.liveSpeedUpdatedAt);
    };

    applySnapshot(webGpsTrackingService.getSnapshot());
    const unsubscribe = webGpsTrackingService.subscribe(applySnapshot);
    return unsubscribe;
  }, [activeSession?.id, activeSession?.requiresGpsDistance]);

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

  const closeFlow = () => {
    const minimizingActiveSession = Boolean(activeSession && flowScreen === 'active');
    setFlowScreen(null); setFinishedActivityItem(null); setCompletion(null);
    if (minimizingActiveSession) {
      navigate('/activity/exit', { replace: true });
      return;
    }
    if (openedFromHomeRef.current) { openedFromHomeRef.current = false; navigate('/'); }
  };

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
      if (type === 'cardio' && objectiveJourneyId && objectiveMissionId) {
        const objective = await objectiveRequest(undefined, `?journeyId=${encodeURIComponent(objectiveJourneyId)}`);
        const mission = objective.missions?.find(m => m.id === objectiveMissionId);
        if (!mission || !('prescription' in mission) || objective.journey?.status !== 'active'
          || mission.prescription.modality !== selectedCardioOption.id || !['available', 'started'].includes(mission.state)
          || mission.localDate > localDate(new Date().toISOString(), objective.journey.timeZone)
          || Date.now() - Date.parse(objective.journey.weekStartedAt) >= 7 * 86400000
          || safetyDecision(objective.journey.safety, objective.journey.goalType === 'gradual_return').blocked) {
          throw new Error('Escolha a modalidade indicada em Meu Objetivo ou retorne à jornada para atualizar sua meta.');
        }
      }
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
      activityNotificationService.start(session, 0, 0);
      activityLiveActivityService.start(session, 0, 0);
    } catch (err: any) {
      console.error('Error starting activity:', err);
      let rawMsg = err.message || 'Falha ao iniciar atividade.';
      if (rawMsg.startsWith('{') && rawMsg.endsWith('}')) {
        try {
          const parsed = JSON.parse(rawMsg);
          rawMsg = parsed.title ? `${parsed.title}\n\n${parsed.message}` : (parsed.message || rawMsg);
        } catch {
          // keep rawMsg
        }
      }
      setStartActivityError(rawMsg);
    } finally {
      setStartingActivity(false);
    }
  };

  const buildShareableFromItem = (item: ActivityHistoryItem) => ({
    id: item.id,
    title: item.title,
    activityType: item.type,
    distanceKm: item.distanceKm,
    durationMins: item.durationMins,
    pace: item.pace,
    calories: item.calories,
    weightKg: item.weightKg,
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

  const handleEndActivity = async () => {
    if (!activeSession || loading) return;
    setLoading(true);
    setError(null);
    setNotice(null);

    const sessionType = activeSession.type;
    const sessionBeforeEnd = activityService.getCurrentSession() || activeSession;
    const controller = new AbortController();
    endActivityAbortRef.current = controller;

    try {
      const res = await activityService.endSession(undefined, controller.signal);
      if (res.presenceCheckRequired) {
        if (!res.presenceCheckId) {
          throw new Error('A validação de presença foi solicitada sem um identificador válido. Tente finalizar novamente.');
        }
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
      const rankingPoints = typeof res.workout?.competitionPoints === 'number'
        ? res.workout.competitionPoints
        : undefined;
      if (res.workout?.id && activityState.isCompleted && objectiveJourneyId && objectiveMissionId) {
        void objectiveRequest({ action: 'complete', journeyId: objectiveJourneyId, missionId: objectiveMissionId, activityId: res.workout.id })
          .catch(() => setNotice('Atividade salva. Confira Meu Objetivo para sincronizar a meta e verificar os critérios.'));
      }
      const points = typeof res.workout?.points === 'number' && Number.isFinite(res.workout.points) && res.workout.points > 0
        ? res.workout.points
        : undefined;

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
        setFinishedActivityItem(finishedItem);
        if (sessionType === 'cardio') {
          setShareCardData(buildShareableFromItem(finishedItem));
        }
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
      await Promise.allSettled([refreshUser(), loadSubmissions()]);
    } catch (err: any) {
      if (err?.userCancelled) return;
      console.error('Error ending activity:', err);
      setError(err.message || 'Falha ao encerrar atividade.');
    } finally {
      if (endActivityAbortRef.current === controller) endActivityAbortRef.current = null;
      setLoading(false);
    }
  };

  const handleCancelActivity = async () => {
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

  const handleRetryGps = () => {
    if (activeSession) webGpsTrackingService.retry(activeSession);
  };

  // #324: pausa/retoma a sessão ativa.
  const handleTogglePause = () => {
    const updated = activeSession?.isPaused
      ? activityService.resumeSession()
      : activityService.pauseSession();
    if (updated) {
      setActiveSession(updated);
      activityNotificationService.update(updated, elapsedTime, liveDistanceKmRef.current, true);
      activityLiveActivityService.update(updated, elapsedTime, liveDistanceKmRef.current, true);
    }
  };

  // #328: listener dos botões da notificação persistente/Live Activity.
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

  // Views novas são exclusivas. Não existe mais fallback para o catálogo
  // antigo — erro/status são exibidos pelo hub atual e nunca fazem a UI antiga
  // reaparecer por baixo do novo shell.
  if (!flowScreen && searchParams.get('view') === 'history') {
    return <ActivityHistoryPageNew />;
  }

  if (!flowScreen && searchParams.get('view') === 'private') {
    return <PrivateChallengesPageNew />;
  }

  const showNewChallengesHub = !flowScreen
    && !finishedActivityItem
    && !shareCardData
    && !presenceCheckRequired;

  if (showNewChallengesHub) {
    const cardioChallenge = CORE_CHALLENGES.find(item => item.id === 'cardio');
    return <ChallengesHubNew
      onCardio={() => { if (cardioChallenge) handleOpenChallenge(cardioChallenge); }}
      onHistory={() => setSearchParams({ view: 'history' })}
      onPrivate={() => setSearchParams({ view: 'private' })}
      errorMessage={error}
      statusMessage={notice}
    />;
  }

  return (
    <>
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
            if (sessionType === 'cardio' && result.commitResult?.activityId && objectiveJourneyId && objectiveMissionId) {
              void objectiveRequest({ action: 'complete', journeyId: objectiveJourneyId, missionId: objectiveMissionId, activityId: result.commitResult.activityId })
                .catch(() => setNotice('Atividade salva. Abra Meu Objetivo para verificar a sincronização da meta.'));
            }
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
              if (sessionType === 'cardio') {
                setShareCardData(buildShareableFromItem(finishedItem));
              }
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

      {shareCardData && (
        <RunShareCard
          session={shareCardData}
          onClose={() => {
            setShareCardData(null);
            if (!finishedActivityItem || finishedActivityItem.type === 'cardio') closeFlow();
          }}
        />
      )}
      {finishedActivityItem && !shareCardData && finishedActivityItem.type !== 'cardio' && (
        <ActivityDetailScreen
          item={finishedActivityItem}
          onClose={closeFlow}
          onShare={() => setShareCardData(buildShareableFromItem(finishedActivityItem))}
        />
      )}
      {flowScreen && !finishedActivityItem && (
        <ChallengeActivityFlow
          screen={flowScreen}
          statusMessage={objectiveJourneyId ? notice : null}
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
    </>
  );
}
