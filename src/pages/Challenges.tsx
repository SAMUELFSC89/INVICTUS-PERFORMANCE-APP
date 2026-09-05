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
import { VerifiedPresenceModal } from '../components/VerifiedPresenceModal';
import { auth, db } from '../firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { ActivitySession } from '../types';
import { cn } from '../lib/utils';
import { calculateDistance, formatPaceValue } from '../lib/runUtils';
import { useUser } from '../UserContext';
import { PrivateChallengesTab } from '../components/PrivateChallengesTab';
import { ActivityDetailScreen, ActivityHistorySection, ActivityHistoryItem } from '../components/ActivityHistorySection';
import { PowerLift } from './PowerLift';
import { RunShareCard } from '../components/RunShareCard';
import { CARDIO_OPTIONS, ChallengeActivityFlow, ChallengeFlowScreen, CardioOption, ActivityCompletion } from '../components/ChallengeActivityFlow';
import { getXPProgress } from '../lib/levelUtils';
import { normalizeActivityValidationStatus, readActivityTimestamp } from '../lib/workoutData';
import { ACHIEVEMENTS } from '../achievements';
import { ChallengesHubNew } from '../components/ChallengesHubNew';
import { ActivityHistoryPageNew } from '../components/ActivityHistoryPageNew';
import { communityChampionshipService } from '../services/communityChampionshipService';
import { championshipService } from '../services/championshipService';
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
  const gpsWatchIdRef = useRef<number | null>(null);
  const lastCheckpointTimeRef = useRef<number>(0);
  const lastRawGpsRef = useRef<{ lat: number; lng: number; timestamp: number; accuracy: number } | null>(null);

  // #44: estado do sinal de GPS e wake lock para o mapa ao vivo (LiveTrackingMap).
  // Antes a tela so mostrava numeros; agora tambem mostra o trajeto real sendo
  // percorrido, igual o RunTracker.tsx (que ficava orfao) fazia -- mas
  // continuando a alimentar activityService.addCheckpoint(), sem trocar o
  // caminho de envio ja unificado (ver auditoria da task #44).
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);
  const [gpsSignal, setGpsSignal] = useState<'SEARCHING' | 'WEAK' | 'STRONG'>('SEARCHING');
  const [gpsPermissionDenied, setGpsPermissionDenied] = useState(false);
  // #168: sem isto, um GPS que nunca consegue um fix (indoors, prédio alto,
  // erro silencioso do provedor nativo) deixava a tela presa para sempre em
  // "Buscando sinal..." sem nenhuma saída -- só fechando e reabrindo a
  // atividade. `gpsRetryKey` força o efeito de watchPosition a reiniciar do
  // zero quando o atleta toca em "Tentar novamente".
  const [gpsStalled, setGpsStalled] = useState(false);
  const [gpsRetryKey, setGpsRetryKey] = useState(0);
  const wakeLockRef = useRef<any>(null);

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
  const [championshipCheckInRequired, setChampionshipCheckInRequired] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([
      communityChampionshipService.status().catch(() => ({ enrolled: false, eventId: '' })),
      championshipService.getUserRegistrations().catch(() => []),
    ]).then(([community, registrations]) => {
      if (active) setChampionshipCheckInRequired(Boolean(community.enrolled || registrations.some((item) => item.status === 'ACTIVE')));
    });
    return () => { active = false; };
  }, [profile?.uid]);
  const [presenceCheckData, setPresenceCheckData] = useState<{ id: string; prompt: string } | null>(null);
  const [completion, setCompletion] = useState<ActivityCompletion | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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

  // GPS checkpoint tracking em tempo real para cardio ao ar livre (corrida/caminhada/bike).
  // Antes addCheckpoint() nunca era chamado durante a sessao, entao a "rota" virava so
  // uma linha reta entre inicio e fim, dando pouquissimo dado real pro antifraude
  // (GpsEngine) e nenhuma info de distancia/pace ao vivo pro usuario -- ver auditoria
  // antifraude 2026-08 (teste do onibus homologado sem dados).
  useEffect(() => {
    if (!activeSession || !activeSession.requiresGpsDistance || typeof navigator === 'undefined' || !navigator.geolocation) {
      setLiveDistanceKm(0);
      setLiveSpeedKmH(null);
      setLiveSpeedUpdatedAt(null);
      return;
    }

    setLiveDistanceKm(activityService.calculateSessionDistance(activeSession));
    setLiveSpeedKmH(null);
    setLiveSpeedUpdatedAt(null);
    lastCheckpointTimeRef.current = 0;
    lastRawGpsRef.current = null;
    setGpsAccuracy(null);
    setGpsSignal('SEARCHING');
    setGpsPermissionDenied(false);
    setGpsStalled(false);

    // #168: se nenhum fix chegar em 20s (prédio, GPS travado no provedor
    // nativo, callback perdido), a tela ficava presa para sempre em "Buscando
    // sinal..." sem nenhuma saída visível além de fechar e reabrir a
    // atividade. Isto dá ao atleta uma mensagem clara e um botão para
    // reiniciar o watch sem perder a sessão em andamento.
    const stallTimer = window.setTimeout(() => setGpsStalled(true), 20000);

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
        const rawAccuracy = Number(position.coords.accuracy);
        // A browser GPS fix without a finite accuracy cannot support either
        // route distance or a trustworthy live speed. Treat it as a weak fix
        // instead of letting NaN slip into the UI and audit payload.
        const accuracy = Number.isFinite(rawAccuracy) && rawAccuracy >= 0 ? rawAccuracy : 999;
        const { speed } = position.coords;
        // Qualquer fix real (mesmo fraco) prova que o GPS voltou a responder.
        clearTimeout(stallTimer);
        setGpsStalled(false);
        setGpsAccuracy(accuracy);
        setGpsSignal(accuracy < 20 ? 'STRONG' : accuracy < 50 ? 'WEAK' : 'SEARCHING');

        // #98: amostra a velocidade INSTANTANEA (Doppler do chip de GPS -- o
        // mesmo dado que Strava/Garmin usam pro pace ao vivo) em TODO fix
        // recebido, independente do throttle de checkpoints abaixo. Um pico
        // real de velocidade (ex: 60-70km/h dentro de um onibus) podia nunca
        // aparecer no calculo por distancia/tempo entre dois checkpoints
        // espaçados de ~10s, que naturalmente suaviza picos curtos.
        // `speed` vem em m/s e pode ser null (nem todo dispositivo/navegador
        // reporta); so propaga quando e um numero valido.
        let instantSpeedKmH = accuracy <= 50 && typeof speed === 'number' && Number.isFinite(speed) && speed >= 0
          ? speed * 3.6
          : null;
        // Alguns aparelhos Android não expõem coords.speed. Nesse caso,
        // deriva a velocidade entre fixes consecutivos, preservando a leitura
        // ao vivo em vez de cair na média da sessão inteira.
        const currentRaw = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          timestamp: position.timestamp || Date.now(),
          accuracy
        };
        const previousRaw = lastRawGpsRef.current;
        const currentSession = activityService.getCurrentSession();
        // Durante uma pausa o aparelho pode continuar entregando fixes, mas
        // eles não representam esforço da atividade. Não atualizamos a
        // velocidade nem a rota até o atleta retomar.
        if (currentSession?.isPaused) {
          setLiveSpeedKmH(null);
          setLiveSpeedUpdatedAt(null);
          return;
        }
        // Alguns bridges Android informam `0` quando a velocidade Doppler não
        // está disponível (em vez de `null`). Nesse caso o código antigo
        // aceitava zero para sempre e nunca executava o fallback, reproduzindo
        // exatamente a tela observada no teste de bike. Derivamos entre fixes
        // quando a leitura veio ausente/zerada e o deslocamento supera o ruído
        // compatível com a precisão dos dois pontos.
        if ((instantSpeedKmH === null || instantSpeedKmH <= 0.5) && previousRaw && accuracy <= 30) {
          const deltaSec = (currentRaw.timestamp - previousRaw.timestamp) / 1000;
          if (deltaSec > 0 && deltaSec <= 15) {
            const distanceMeters = calculateDistance(previousRaw.lat, previousRaw.lng, currentRaw.lat, currentRaw.lng);
            const noiseFloorMeters = Math.max(2.5, Math.min(8, (previousRaw.accuracy + accuracy) * 0.12));
            if (distanceMeters >= noiseFloorMeters) {
              instantSpeedKmH = (distanceMeters / deltaSec) * 3.6;
            }
          }
        }
        if (accuracy <= 30) lastRawGpsRef.current = currentRaw;
        // O mesmo teto de sanidade aplicado no acumulador da sessão evita
        // que um valor espúrio do bridge GPS apareça na tela ou seja salvo no
        // checkpoint, mesmo que a distância oficial do servidor descarte
        // esse pico depois.
        if (instantSpeedKmH !== null && instantSpeedKmH > 300) instantSpeedKmH = null;
        if (instantSpeedKmH !== null) {
          activityService.recordGpsSpeedSample(instantSpeedKmH, accuracy);
          // Suavizacao curta apenas para leitura ao vivo. A auditoria recebe
          // todas as amostras/checkpoints e nao confia neste valor visual.
          setLiveSpeedKmH((previous) => previous === null ? instantSpeedKmH : previous * 0.65 + instantSpeedKmH * 0.35);
          setLiveSpeedUpdatedAt(Date.now());
        }

        const now = Date.now();
        // Dois segundos preservam curvas, aceleração e velocidade como um
        // fluxo GPS esportivo. O servidor refaz distância e elimina outliers.
        if (now - lastCheckpointTimeRef.current < 2000) return;
        lastCheckpointTimeRef.current = now;

        activityService.addCheckpoint({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy,
          ...(instantSpeedKmH !== null ? { speedKmH: instantSpeedKmH } : {})
        }, position.timestamp);

        const current = activityService.getCurrentSession();
        if (current) {
          // addCheckpoint persiste no localStorage e devolve um novo snapshot;
          // sem atualizar o estado React, a tela continuava recebendo o array
          // antigo em `liveCheckpoints` e o Mapbox nunca desenhava a rota nem
          // o marcador da posição atual.
          setActiveSession(current);
          setLiveDistanceKm(activityService.calculateSessionDistance(current));
        }
      },
      (err) => {
        console.warn('[Challenges] GPS watchPosition error during cardio session:', err);
        if (err.code === 1) setGpsPermissionDenied(true);
        // #168: erro de posição indisponível/timeout (code 2/3) não travava
        // nada visualmente antes -- o indicador continuava "Buscando sinal..."
        // e o atleta não tinha como saber se era só demora ou uma falha real.
        // O timer de estagnação acima cobre o caso de nenhum callback chegar;
        // isto cobre o caso de o provedor nativo desistir e reportar erro.
        else if (err.code === 2 || err.code === 3) setGpsStalled(true);
      },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 }
    );
    gpsWatchIdRef.current = watchId;

    return () => {
      clearTimeout(stallTimer);
      if (gpsWatchIdRef.current !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(gpsWatchIdRef.current);
        gpsWatchIdRef.current = null;
      }
      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch(() => {});
        wakeLockRef.current = null;
      }
    };
  }, [activeSession?.id, activeSession?.requiresGpsDistance, gpsRetryKey]);

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
  const handleStartActivity = async (type: 'workout' | 'cardio', useCheckIn = false) => {
    setStartActivityError(null);
    setError(null);
    setStartingActivity(true);
    try {
      // #249: pedir permissao de sensor so quando ha campeonato/ranking ativo
      // de verdade (mesmo sinal ja usado abaixo pro check-in de academia) --
      // sem isso, todo mundo levava o mesmo pedido de permissao do iOS mesmo
      // so treinando/correndo por conta propria, sem nada em disputa.
      if (championshipCheckInRequired) {
        await activityService.requestMotionPermission();
      }
      const confirmedCheckIn = type === 'workout' && (useCheckIn || championshipCheckInRequired)
        ? await activityService.performGymCheckIn()
        : null;
      const session = await activityService.startSession(
        type,
        confirmedCheckIn?.location,
        type === 'cardio' ? selectedCardioOption.id : undefined,
        undefined,
        confirmedCheckIn?.checkInId,
        type === 'workout' ? selectedMuscleGroup : undefined
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
    const rawStatus = normalizeActivityValidationStatus(result.status);
    const historyStatus: ActivityHistoryItem['status'] = rawStatus === 'validated'
      ? 'homologada'
      : rawStatus === 'rejected' || rawStatus === 'not_eligible'
        ? 'rejeitada'
        : 'pendente';
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
      statusRaw: rawStatus || result.status,
      points: historyStatus === 'homologada' && typeof result.pointsAwarded === 'number' && Number.isFinite(result.pointsAwarded)
        ? result.pointsAwarded
        : 0,
      durationMins,
      distanceKm,
      calories: typeof rawCalories === 'number' && Number.isFinite(rawCalories) ? rawCalories : undefined,
      avgHeartRate: Number.isFinite(rawHeartRate) && rawHeartRate > 0 ? rawHeartRate : undefined,
      steps: Number.isFinite(rawSteps) && rawSteps > 0 ? rawSteps : undefined,
      pace,
      trajectory: validTrajectory,
      details: { healthSession: result.commitResult?.healthSession ?? healthSession },
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
      const rankingPoints = res.rankingPointsEarned ?? res.workout?.rankingPointsEarned;
      const points = typeof res.workout?.points === 'number' && Number.isFinite(res.workout.points) && res.workout.points > 0
        ? res.workout.points
        : undefined;

      // O registro retornado pelo servidor entra imediatamente no historico,
      // inclusive enquanto aguarda a decisao antifraude. Nenhum valor e
      // inventado no cliente e pontos so aparecem quando o servidor aprova.
      const timestampMs = res.workout?.timestamp ? Date.parse(res.workout.timestamp) : Number.NaN;
      if (res.workout?.id && Number.isFinite(timestampMs) && ['validated', 'pending', 'rejected', 'not_eligible'].includes(status)) {
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
        const historyStatus: ActivityHistoryItem['status'] = status === 'validated'
          ? 'homologada'
          : status === 'pending'
            ? 'pendente'
            : 'rejeitada';

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
          statusRaw: status,
          points: historyStatus === 'homologada' ? (points || 0) : 0,
          rankingPointsEarned: historyStatus === 'homologada' && typeof rankingPoints === 'number' ? rankingPoints : undefined,
          durationMins: serverDuration,
          distanceKm: serverDistance,
          calories,
          avgHeartRate: typeof (res.workout as any).avgHeartRate === 'number' ? (res.workout as any).avgHeartRate : undefined,
          pace,
          trajectory,
          photoUrl: (res.workout as any).photoUrl || (res.workout as any).verificationPhotoUrl,
          details: { healthSession: res.healthSession, healthSessionStatus: res.healthSessionStatus, healthSessionReason: res.healthSessionReason },
        };
        // The athlete reviews private health feedback before choosing whether
        // to share the existing public card, which contains no health record.
        setFinishedActivityItem(finishedItem);
        setHistoryRefreshKey((key) => key + 1);
      }

      if (status === 'validated') {
        setActiveSession(null);
        setCompletion({ status: 'approved', message: res.message, pointsAwarded: points });
        if (points !== undefined) {
          triggerXPToast(points, 'Atividade validada.', rankingPoints);
        }

        setFlowScreen(sessionType === 'cardio' ? null : 'workout-complete');
      } else if (status === 'pending') {
        setActiveSession(null);
        setCompletion({ status: 'pending', message: res.message });
        setFlowScreen(sessionType === 'cardio' ? null : 'workout-complete');
        setNotice(res.message || 'Atividade recebida e aguardando análise. Nenhuma pontuação foi liberada ainda.');
      } else if (status === 'rejected' || status === 'not_eligible') {
        setActiveSession(null);
        setCompletion({ status: 'rejected', message: res.message });
        setFlowScreen(sessionType === 'cardio' ? null : 'workout-complete');
        setError(res.message || 'A atividade não foi validada. Nenhuma pontuação foi concedida.');
      } else {
        // Sem decisão explícita do servidor, falhamos de forma segura: não
        // marcamos a atividade como homologada e não concedemos XP.
        setError(res.message || 'O servidor não confirmou o status da atividade. Nenhuma pontuação foi liberada.');
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

  // #168: reinicia o watch de GPS do zero sem descartar a sessão em
  // andamento -- o efeito acima reage a `gpsRetryKey` e refaz toda a
  // configuração (wake lock, watchPosition, timer de estagnação).
  const handleRetryGps = () => {
    setGpsStalled(false);
    setGpsRetryKey((key) => key + 1);
  };

  // #324: pausa/retoma a sessao ativa. So existia no componente orfao
  // RunTracker.tsx antes -- o fluxo de verdade nao tinha essa acao.
  const handleTogglePause = () => {
    const updated = activeSession?.isPaused
      ? activityService.resumeSession()
      : activityService.pauseSession();
    if (updated) {
      setActiveSession(updated);
      // O primeiro fix depois de uma pausa não pode derivar velocidade nem
      // conectar o trajeto com o ponto anterior ao intervalo parado.
      lastRawGpsRef.current = null;
      lastCheckpointTimeRef.current = updated.isPaused ? Date.now() : 0;
      if (updated.isPaused) {
        setLiveSpeedKmH(null);
        setLiveSpeedUpdatedAt(null);
      }
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


  const handleFlowStart = (type: 'workout' | 'cardio', options?: { checkIn?: boolean }) => {
    if (type === 'workout' && flowScreen === 'workout-details') {
      setFlowScreen('workout-checkin');
      return;
    }
    handleStartActivity(type, Boolean(options?.checkIn));
  };

  const handleFlowBack = () => {
    if (flowScreen === 'workout-checkin') setFlowScreen('workout-details');
    else closeFlow();
  };

  const showNewChallengesHub = !flowScreen
    && !finishedActivityItem
    && !shareCardData
    && !presenceCheckRequired
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
            pendingPresenceSessionRef.current = null;
            const sessionType = pendingPresence?.session.type || activeSession?.type;

            if (presenceStatus === 'validated') {
              await activityService.completeSessionAfterPresence();
              setActiveSession(null);
              const points = typeof result.pointsAwarded === 'number' && Number.isFinite(result.pointsAwarded) && result.pointsAwarded > 0
                ? result.pointsAwarded
                : undefined;
              setCompletion({ status: 'approved', message: result.userMessage, pointsAwarded: points });
              if (points !== undefined) triggerXPToast(points, 'Atividade validada.');
              if (pendingPresence) {
                const finishedItem = buildFinishedItemFromPresence(pendingPresence.session, pendingPresence.finishedAt, result, pendingPresence.healthSession);
                setFinishedActivityItem(finishedItem);
                setHistoryRefreshKey((key) => key + 1);
              }
              setFlowScreen(sessionType === 'cardio' ? null : 'workout-complete');
              setNotice(null);
            } else if (presenceStatus === 'pending') {
              await activityService.completeSessionAfterPresence();
              setActiveSession(null);
              setCompletion({ status: 'pending', message: result.userMessage });
              if (pendingPresence) {
                const finishedItem = buildFinishedItemFromPresence(pendingPresence.session, pendingPresence.finishedAt, result, pendingPresence.healthSession);
                setFinishedActivityItem(finishedItem);
                setHistoryRefreshKey((key) => key + 1);
              }
              setFlowScreen(sessionType === 'cardio' ? null : 'workout-complete');
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
          onCardio={(option) => { setSelectedCardioOption(option); setSelectedCardioType(option.id); }}
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
          checkInRequired={championshipCheckInRequired}
          completedChallengeIds={Object.keys(submissions)}
          completion={completion}
          startError={startActivityError}
          endError={error}
          loading={loading}
          startingActivity={startingActivity}
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
