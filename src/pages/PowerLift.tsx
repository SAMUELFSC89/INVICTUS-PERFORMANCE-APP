import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Coins,
  Crown,
  Diamond,
  Dumbbell,
  Home,
  Info,
  LockKeyhole,
  Medal,
  ShieldCheck,
  Target,
  TrendingUp,
  Trophy,
  Upload,
  UserRound,
  Video,
  Zap,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { deleteObject, getDownloadURL, ref, uploadBytesResumable, type StorageReference } from 'firebase/storage';
import { auth, storage } from '../firebase';
import { useUser } from '../UserContext';
import { validationService } from '../services/validationService';
import { API_CONFIG } from '../config';
import {
  POWER_LIFT_TIER_ORDER,
  calculatePowerVolume,
  canEnterEliteRanking,
  maxCountedReps,
  minimumEligibleSetWeight,
  nextPowerLiftTier,
  normalizeCompetitionSex,
  powerLiftDateKey,
  resolvePowerLiftSeason,
  scoredPowerLiftSets,
  tierThreshold,
  type PowerLiftExercise,
  type PowerLiftSetInput,
  type PowerLiftSeasonWindow,
  type PowerLiftSex,
  type PowerLiftTier,
} from '../core/powerLift/season';
import './PowerLiftSeason.css';

type Exercise = PowerLiftExercise;
type View = 'home' | 'modality' | 'register' | 'elite' | 'unlock' | 'general' | 'processing' | 'submitted';

type RecordRow = {
  id: string;
  userId: string;
  userName?: string;
  userPhoto?: string;
  gymId?: string;
  gymName?: string;
  exercise: Exercise;
  weight: number;
  series?: Array<PowerLiftSetInput & { countedReps?: number; eligible?: boolean; volume?: number }>;
  powerVolume?: number;
  seasonScore?: number;
  competitiveScore?: number;
  seasonTier?: PowerLiftTier;
  seasonId?: string;
  seasonNumber?: number;
  competitionSex?: PowerLiftSex;
  tierAdvancedTo?: PowerLiftTier | null;
  videoStatus?: 'approved' | 'manual_review' | 'rejected' | string;
  videoUrl?: string;
  userMessage?: string;
  motives?: string[];
  date?: string;
  dateKey?: string;
  createdAt?: string;
};

type ModalityMeta = {
  id: Exercise;
  title: string;
  short: string;
  image: string;
};

type SeriesDraft = { weight: string; reps: string };

type SeasonEntry = {
  id: string;
  seasonId: string;
  seasonNumber: number;
  userId: string;
  userName: string;
  userPhoto: string;
  competitionSex: PowerLiftSex;
  exercise: Exercise;
  tier: PowerLiftTier;
  bestVolume: number;
  bestWeight: number;
  rawScore: number;
  competitiveScore: number;
  defendingChampion: boolean;
  defenseMultiplier: number;
  eliteOptIn: boolean;
  validMarks: number;
  bestAchievedAt?: string | null;
};

type SeasonStatus = {
  season: PowerLiftSeasonWindow;
  competitionSex: PowerLiftSex;
  entries: Record<Exercise, SeasonEntry>;
  general: {
    eligible: boolean;
    optedIn: boolean;
    rawScore: number;
    competitiveScore: number;
    defendingMaster: boolean;
    defenseMultiplier: number;
  };
  rewards: {
    tier: Record<Exclude<PowerLiftTier, 'UNRANKED'>, number>;
    podium: Record<'1' | '2' | '3', number> | Record<number, number>;
    master: number;
  };
};

type GeneralRankingRow = {
  rank: number;
  userId: string;
  userName: string;
  userPhoto: string;
  rawScore: number;
  competitiveScore: number;
  defendingMaster: boolean;
  defenseMultiplier: number;
  scores: Record<Exercise, number>;
  bestVolumes: Record<Exercise, number>;
};

const modalities: ModalityMeta[] = [
  { id: 'supino', title: 'SUPINO', short: 'Supino', image: '/powerlift-supino.jpg' },
  { id: 'agachamento', title: 'AGACHAMENTO LIVRE', short: 'Agachamento', image: '/powerlift-agachamento.jpg' },
  { id: 'terra', title: 'LEVANTAMENTO TERRA', short: 'Terra', image: '/powerlift-terra.jpg' },
];

const emptySeries = (): SeriesDraft[] => [
  { weight: '', reps: '' },
  { weight: '', reps: '' },
  { weight: '', reps: '' },
];

const framesFromVideo = (file: File) => new Promise<string[]>((resolve) => {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  const frames: string[] = [];
  const targetFrames = 8;
  let step = 0;
  let finished = false;
  const timer = window.setTimeout(() => finish(), 15000);

  function finish() {
    if (finished) return;
    finished = true;
    window.clearTimeout(timer);
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
    resolve(frames);
  }

  video.muted = true;
  video.playsInline = true;
  video.preload = 'metadata';
  video.src = url;
  video.onloadedmetadata = () => {
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 1;
    const seek = () => {
      video.currentTime = Math.min(duration - 0.05, Math.max(0.05, duration * ((step + 1) / (targetFrames + 1))));
    };
    video.onseeked = () => {
      const canvas = document.createElement('canvas');
      const ratio = Math.min(1, 448 / (video.videoWidth || 448));
      canvas.width = Math.max(1, Math.round((video.videoWidth || 448) * ratio));
      canvas.height = Math.max(1, Math.round((video.videoHeight || 448) * ratio));
      canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
      frames.push(canvas.toDataURL('image/jpeg', .62));
      step += 1;
      if (step >= targetFrames) finish(); else seek();
    };
    seek();
  };
  video.onerror = finish;
});

export type ReconcileOutcome =
  | { status: 'confirmed'; record: RecordRow }
  | { status: 'uncertain' }
  | { status: 'rejected'; message?: string };

export async function reconcilePowerLiftSubmission(
  uploadedRef: StorageReference,
  exercise: Exercise,
  weight: number,
  context?: { series?: PowerLiftSetInput[]; seasonId?: string; competitionSex?: PowerLiftSex },
): Promise<ReconcileOutcome> {
  try {
    const firebaseUser = auth.currentUser;
    if (!firebaseUser) return { status: 'uncertain' };
    const token = await Promise.race([
      firebaseUser.getIdToken(),
      new Promise<undefined>((resolve) => window.setTimeout(() => resolve(undefined), 12000)),
    ]);
    if (!token) return { status: 'uncertain' };

    const videoUrl = await getDownloadURL(uploadedRef);
    const controller = new AbortController();
    const requestTimeout = window.setTimeout(() => controller.abort(), 20000);
    let response: Response;
    try {
      response = await fetch(`${API_CONFIG.baseUrl}/api/powerlift?action=submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          exercise,
          weight,
          videoUrl,
          ...(context?.series ? { series: context.series } : {}),
          ...(context?.seasonId ? { seasonId: context.seasonId } : {}),
          ...(context?.competitionSex ? { competitionSex: context.competitionSex } : {}),
        }),
        signal: controller.signal,
      });
    } catch {
      return { status: 'uncertain' };
    } finally {
      window.clearTimeout(requestTimeout);
    }

    const payload = await response.json().catch(() => null);
    if (response.ok && payload?.record) return { status: 'confirmed', record: payload.record as RecordRow };
    return { status: 'rejected', message: payload?.error };
  } catch (error) {
    console.warn('[PowerLift] Falha na reconciliação do envio:', error);
    return { status: 'uncertain' };
  }
}

function tierLabel(tier: PowerLiftTier) {
  return tier === 'UNRANKED' ? 'NÃO CLASSIFICADO' : tier;
}

function formatNumber(value: number, maximumFractionDigits = 0) {
  return Number(value || 0).toLocaleString('pt-BR', { maximumFractionDigits });
}

function previewStatus(sex: PowerLiftSex): SeasonStatus {
  const season = resolvePowerLiftSeason();
  const make = (exercise: Exercise, tier: PowerLiftTier, bestVolume: number, bestWeight: number, rawScore: number): SeasonEntry => ({
    id: `preview_${exercise}`,
    seasonId: season.id,
    seasonNumber: season.number,
    userId: 'preview-user',
    userName: 'Você',
    userPhoto: '',
    competitionSex: sex,
    exercise,
    tier,
    bestVolume,
    bestWeight,
    rawScore,
    competitiveScore: rawScore,
    defendingChampion: false,
    defenseMultiplier: 1,
    eliteOptIn: tier === 'DIAMANTE',
    validMarks: POWER_LIFT_TIER_ORDER.indexOf(tier),
  });
  const entries = {
    supino: make('supino', 'OURO', 1420, 180, 676),
    agachamento: make('agachamento', 'PLATINA', 2680, 220, 865),
    terra: make('terra', 'DIAMANTE', 3560, 250, 1047),
  };
  return {
    season,
    competitionSex: sex,
    entries,
    general: { eligible: false, optedIn: false, rawScore: 2588, competitiveScore: 2588, defendingMaster: false, defenseMultiplier: 1 },
    rewards: {
      tier: { FERRO: 20, BRONZE: 40, PRATA: 60, OURO: 100, PLATINA: 150, DIAMANTE: 300 },
      podium: { 1: 1000, 2: 600, 3: 400 },
      master: 4000,
    },
  };
}

function TierBadge({ tier, compact = false }: { tier: PowerLiftTier; compact?: boolean }) {
  const normalized = tier.toLowerCase();
  return (
    <span className={`pl-tier-badge pl-tier-badge--${normalized} ${compact ? 'is-compact' : ''}`} aria-label={tierLabel(tier)}>
      <span className="pl-tier-badge-core"><Diamond size={compact ? 10 : 14} /></span>
      {!compact ? <b>{tierLabel(tier)}</b> : null}
    </span>
  );
}

function AthleteAvatar({ photo, name }: { photo?: string; name?: string }) {
  if (photo) return <img className="pl-avatar" src={photo} alt="" />;
  return <span className="pl-avatar pl-avatar--fallback" aria-hidden="true">{(name || 'I').slice(0, 1).toUpperCase()}</span>;
}

function CoinMark({ size = 24 }: { size?: number }) {
  return <img className="pl-coin-mark" src="/assets/coins/invictus-coins-stack.png" alt="" width={size} height={size} />;
}

export function PowerLift() {
  const navigate = useNavigate();
  const { user } = useUser();
  const profileSex = normalizeCompetitionSex(user?.sex);
  const preview = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('preview') === '1';

  const [view, setView] = useState<View>('home');
  const [selected, setSelected] = useState<Exercise>('supino');
  const [status, setStatus] = useState<SeasonStatus | null>(null);
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [generalRanking, setGeneralRanking] = useState<GeneralRankingRow[]>([]);
  const [myRecords, setMyRecords] = useState<RecordRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [series, setSeries] = useState<SeriesDraft[]>(emptySeries);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [submissionError, setSubmissionError] = useState('');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [submissionMessage, setSubmissionMessage] = useState('');
  const [optInBusy, setOptInBusy] = useState(false);

  const effectiveStatus = useMemo(() => {
    if (preview) return previewStatus(profileSex || 'male');
    return status;
  }, [preview, profileSex, status]);
  const season = effectiveStatus?.season || resolvePowerLiftSeason();
  const competitionSex = effectiveStatus?.competitionSex || profileSex;
  const sexLabel = competitionSex === 'female' ? 'Categoria feminina' : competitionSex === 'male' ? 'Categoria masculina' : 'Categoria competitiva pendente';

  const loadData = async () => {
    setLoading(true);
    setLoadError('');
    if (preview) {
      setStatus(previewStatus(profileSex || 'male'));
      setLoading(false);
      return;
    }
    try {
      const firebaseUser = auth.currentUser;
      if (!firebaseUser) throw new Error('Usuário não autenticado.');
      const token = await firebaseUser.getIdToken();
      const headers = { Authorization: `Bearer ${token}` };
      const [statusResponse, rankingResponse, mineResponse] = await Promise.all([
        fetch(`${API_CONFIG.baseUrl}/api/powerlift?action=status`, { headers }),
        fetch(`${API_CONFIG.baseUrl}/api/powerlift?action=ranking&limit=100`, { headers }),
        fetch(`${API_CONFIG.baseUrl}/api/powerlift?action=me`, { headers }),
      ]);
      const [statusPayload, rankingPayload, minePayload] = await Promise.all([
        statusResponse.json().catch(() => ({})),
        rankingResponse.json().catch(() => ({})),
        mineResponse.json().catch(() => ({})),
      ]);
      if (!statusResponse.ok || !rankingResponse.ok || !mineResponse.ok) {
        throw new Error(statusPayload.error || rankingPayload.error || minePayload.error || 'Não foi possível carregar o Power Lift.');
      }
      setStatus(statusPayload as SeasonStatus);
      setRecords(Array.isArray(rankingPayload.records) ? rankingPayload.records as RecordRow[] : []);
      setGeneralRanking(Array.isArray(rankingPayload.generalRanking) ? rankingPayload.generalRanking as GeneralRankingRow[] : []);
      setMyRecords(Array.isArray(minePayload.records) ? minePayload.records as RecordRow[] : []);
    } catch (error: any) {
      console.warn('[PowerLift] Falha ao carregar dados:', error);
      setLoadError(error?.message || 'Não foi possível carregar o Power Lift.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadData(); }, [user?.uid, preview]);

  const todayKey = powerLiftDateKey();
  const modalityStats = useMemo(() => {
    const source = effectiveStatus;
    const result = {} as Record<Exercise, SeasonEntry & { todayUsed: boolean; history: RecordRow[] }>;
    for (const modality of modalities) {
      const entry = source?.entries?.[modality.id] || {
        id: `empty_${modality.id}`,
        seasonId: season.id,
        seasonNumber: season.number,
        userId: user?.uid || '',
        userName: user?.displayName || 'Atleta',
        userPhoto: user?.photoURL || '',
        competitionSex: competitionSex || 'male',
        exercise: modality.id,
        tier: 'UNRANKED' as PowerLiftTier,
        bestVolume: 0,
        bestWeight: 0,
        rawScore: 0,
        competitiveScore: 0,
        defendingChampion: false,
        defenseMultiplier: 1,
        eliteOptIn: false,
        validMarks: 0,
      };
      const history = myRecords
        .filter((row) => row.exercise === modality.id && row.seasonId === season.id)
        .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
      const todayUsed = history.some((row) => (row.dateKey || row.date) === todayKey && row.videoStatus !== 'rejected');
      result[modality.id] = { ...entry, todayUsed, history };
    }
    return result;
  }, [effectiveStatus, myRecords, season, todayKey, user?.uid, user?.displayName, user?.photoURL, competitionSex]);

  const selectedMeta = modalities.find((item) => item.id === selected) || modalities[0];
  const selectedStats = modalityStats[selected];
  const diamondCount = Object.values(modalityStats).filter((entry) => entry.tier === 'DIAMANTE').length;
  const generalEligible = effectiveStatus?.general.eligible === true;
  const generalOptIn = effectiveStatus?.general.optedIn === true;
  const generalRawScore = effectiveStatus?.general.rawScore || 0;
  const generalCompetitive = effectiveStatus?.general.competitiveScore || 0;

  const publicRanking = useMemo(() => {
    if (!preview) {
      return records
        .filter((row) => row.exercise === selected)
        .sort((a, b) => Number(b.competitiveScore || b.seasonScore || 0) - Number(a.competitiveScore || a.seasonScore || 0))
        .slice(0, 20);
    }
    const names = ['Rafael Medeiros', 'Bruno Carvalho', 'Lucas Ferreira', 'Felipe Andrade', 'Daniel Costa', 'Gustavo Lima', 'Matheus Rocha', 'Thiago Martins', 'Eduardo Santos', 'Vitor Almeida', user?.displayName || 'Você'];
    return names.map((name, index) => ({
      id: `preview-${selected}-${index}`,
      userId: index === 10 ? user?.uid || 'me' : `preview-${index}`,
      userName: name,
      exercise: selected,
      weight: 230 - index * 4,
      powerVolume: 5230 - index * 255,
      seasonScore: 4980 - index * 265,
      competitiveScore: 4980 - index * 265,
      competitionSex: competitionSex || 'male',
      seasonTier: 'DIAMANTE',
    } as RecordRow));
  }, [records, selected, preview, user?.uid, user?.displayName, competitionSex]);

  const visibleGeneralRanking = useMemo(() => {
    if (!preview) return generalRanking.slice(0, 20);
    const names = ['Bruno Almeida', 'Felipe Souza', 'Lucas Carvalho', user?.displayName || 'Você', 'Rafael Mendes', 'Gabriel Pereira', 'Matheus Torres', 'Diego Santos', 'Caio Nascimento', 'Leonardo Pinto'];
    return names.map((name, index) => ({
      rank: index + 1,
      userId: index === 3 ? user?.uid || 'me' : `general-${index}`,
      userName: name,
      userPhoto: '',
      rawScore: 8420 - index * 260,
      competitiveScore: 8420 - index * 260,
      defendingMaster: index === 0,
      defenseMultiplier: index === 0 ? 0.95 : 1,
      scores: {
        supino: 2810 - index * 90,
        agachamento: 2920 - index * 100,
        terra: 2690 - index * 70,
      },
      bestVolumes: { supino: 2300, agachamento: 3450, terra: 3700 },
    } as GeneralRankingRow));
  }, [generalRanking, preview, user?.uid, user?.displayName]);

  const parsedSeries: PowerLiftSetInput[] = useMemo(() => series.map((item) => ({
    weight: Number(item.weight) || 0,
    reps: Number(item.reps) || 0,
  })), [series]);
  const scoredSeries = useMemo(() => competitionSex ? scoredPowerLiftSets(parsedSeries, selected, competitionSex) : [], [parsedSeries, selected, competitionSex]);
  const calculatedVolume = competitionSex ? calculatePowerVolume(parsedSeries, selected, competitionSex) : 0;
  const declaredWeight = parsedSeries.reduce((best, item) => Math.max(best, item.weight), 0);
  const minimumSetWeight = minimumEligibleSetWeight(parsedSeries);

  const resetRegistration = () => {
    setSeries(emptySeries());
    setVideoFile(null);
    setSubmissionError('');
    setUploadProgress(0);
  };

  const submitMark = async () => {
    if (!user || !videoFile) {
      setSubmissionError('Anexe o vídeo completo da marca antes de enviar.');
      return;
    }
    if (!competitionSex) {
      setSubmissionError('Complete o campo Sexo Biológico no perfil antes de registrar uma marca competitiva.');
      return;
    }
    const validSeries = parsedSeries.filter((item) => item.weight > 0 && item.reps > 0);
    if (declaredWeight <= 0 || calculatedVolume <= 0 || !validSeries.length) {
      setSubmissionError('Informe pelo menos uma série válida com carga e repetições.');
      return;
    }
    if (!videoFile.type.startsWith('video/') || videoFile.size <= 0 || videoFile.size > 100 * 1024 * 1024) {
      setSubmissionError('O vídeo precisa ser válido e ter no máximo 100 MB.');
      return;
    }
    if (selectedStats.todayUsed) {
      setSubmissionError('A marca oficial de hoje desta modalidade já foi utilizada.');
      return;
    }

    setSubmissionError('');
    setUploadProgress(0);
    setView('processing');
    const localVideo = videoFile;
    let uploadedRef: StorageReference | null = null;
    let persisted = false;

    try {
      const safeFileName = localVideo.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = ref(storage, `power_records/${user.uid}/${Date.now()}_${safeFileName}`);
      const uploadTask = uploadBytesResumable(path, localVideo, { contentType: localVideo.type });
      const uploaded = await new Promise<typeof uploadTask.snapshot>((resolve, reject) => {
        const timeout = window.setTimeout(() => {
          uploadTask.cancel();
          reject(new Error('O envio demorou demais. Verifique a conexão e tente novamente.'));
        }, 15 * 60 * 1000);
        uploadTask.on('state_changed',
          (snapshot) => setUploadProgress(Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100)),
          (error) => { window.clearTimeout(timeout); reject(error); },
          () => { window.clearTimeout(timeout); resolve(uploadTask.snapshot); },
        );
      });
      uploadedRef = uploaded.ref;
      const videoUrl = await getDownloadURL(uploadedRef);
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('Sua sessão expirou. Entre novamente.');

      const response = await fetch(`${API_CONFIG.baseUrl}/api/powerlift?action=submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          exercise: selected,
          weight: declaredWeight,
          videoUrl,
          series: validSeries,
          seasonId: season.id,
          competitionSex,
          dateKey: todayKey,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.record) throw new Error(payload?.error || 'Não foi possível registrar a marca.');
      persisted = true;
      const pendingRecord = payload.record as RecordRow;
      setMyRecords((current) => [pendingRecord, ...current.filter((item) => item.id !== pendingRecord.id)]);

      const frames = await framesFromVideo(localVideo);
      const validation = await validationService.validatePowerVideo(frames, selected, declaredWeight);
      if (validation.validationId) {
        const auditResponse = await fetch(`${API_CONFIG.baseUrl}/api/powerlift?action=finalize-audit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ recordId: pendingRecord.id, validationId: validation.validationId }),
        });
        const auditPayload = await auditResponse.json().catch(() => ({}));
        if (auditResponse.ok && auditPayload?.record) {
          const audited = auditPayload.record as RecordRow;
          setMyRecords((current) => [audited, ...current.filter((item) => item.id !== audited.id)]);
          if (auditPayload.decision === 'approved') {
            const advanced = auditPayload.progression?.tierAdvanced as PowerLiftTier | undefined;
            const reward = Number(auditPayload.progression?.rewardCoins) || 0;
            setSubmissionMessage(advanced
              ? `Marca aprovada. ${advanced} conquistado${reward ? ` · +${formatNumber(reward)} Invictus Coins` : ''}.`
              : 'Marca aprovada. Sua melhor performance e pontuação da temporada foram conciliadas.');
          } else if (auditPayload.decision === 'rejected') {
            setSubmissionMessage('A marca foi revisada e não entrou na pontuação.');
          } else {
            setSubmissionMessage('Marca enviada e aguardando revisão técnica.');
          }
        } else {
          setSubmissionMessage('Marca salva e aguardando revisão técnica.');
        }
      } else {
        setSubmissionMessage('Marca salva e aguardando revisão técnica.');
      }

      resetRegistration();
      setView('submitted');
    } catch (error: any) {
      console.warn('[PowerLift] Falha no envio da marca:', error);
      if (!persisted && uploadedRef) {
        const outcome = await reconcilePowerLiftSubmission(uploadedRef, selected, declaredWeight, {
          series: validSeries,
          seasonId: season.id,
          competitionSex,
        });
        if (outcome.status === 'confirmed') {
          setMyRecords((current) => [outcome.record, ...current.filter((item) => item.id !== outcome.record.id)]);
          setSubmissionMessage('Marca recebida pelo servidor e encaminhada para revisão.');
          resetRegistration();
          setView('submitted');
          return;
        }
        if (outcome.status === 'rejected') {
          await deleteObject(uploadedRef).catch(() => undefined);
          setSubmissionError(outcome.message || 'O servidor recusou este envio.');
          setView('register');
          return;
        }
        setSubmissionMessage('O envio ficou pendente de confirmação. Não excluímos o vídeo para preservar a prova da marca.');
        setView('submitted');
        return;
      }
      setSubmissionError(error?.message || 'Não foi possível enviar a marca.');
      setView('register');
    }
  };

  const updateOptIn = async (scope: 'elite' | 'general', optedIn: boolean, exercise?: Exercise) => {
    if (preview) return;
    setOptInBusy(true);
    setLoadError('');
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('Sua sessão expirou.');
      const response = await fetch(`${API_CONFIG.baseUrl}/api/powerlift?action=opt-in`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ scope, exercise, optedIn }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Não foi possível atualizar sua participação.');
      await loadData();
      if (scope === 'general' && optedIn) setView('general');
    } catch (error: any) {
      setLoadError(error?.message || 'Não foi possível atualizar sua participação.');
    } finally {
      setOptInBusy(false);
    }
  };

  const openModality = (exercise: Exercise) => {
    setSelected(exercise);
    setView('modality');
  };

  const back = () => {
    if (view === 'home') navigate('/championships');
    else if (view === 'register' || view === 'elite') setView('modality');
    else setView('home');
  };

  const Header = ({ title, accent, subtitle, image }: { title: string; accent?: string; subtitle?: string; image?: string }) => (
    <header className="pl-approved-header">
      <div className="pl-header-art" style={image ? { backgroundImage: `linear-gradient(90deg,rgba(4,4,4,.1),rgba(4,4,4,.72)),url(${image})` } : undefined} />
      <div className="pl-topbar">
        <button className="pl-back" type="button" aria-label="Voltar" onClick={back}><ArrowLeft size={19} /></button>
        <div className="pl-brand">INVICTUS</div>
        <div className="pl-season-chip"><CalendarDays size={13} /> T{season.number} · {season.daysRemaining} dias</div>
      </div>
      <h1 className="pl-title">{title} {accent ? <em>{accent}</em> : null}</h1>
      {subtitle ? <p className="pl-subtitle">{subtitle}</p> : null}
    </header>
  );

  const BottomNav = () => (
    <nav className="pl-bottom-nav" aria-label="Navegação principal do Power Lift">
      <button type="button" onClick={() => navigate('/')}><Home size={22} /><span>Início</span></button>
      <button type="button" className="is-active" onClick={() => setView('home')}><Dumbbell size={22} /><span>Power Lift</span></button>
      <button type="button" onClick={() => navigate('/challenges')}><Trophy size={22} /><span>Desafios</span></button>
      <button type="button" onClick={() => navigate('/profile')}><UserRound size={22} /><span>Perfil</span></button>
    </nav>
  );

  const Dashboard = () => (
    <>
      <Header title="POWER" accent="LIFT" subtitle={`Temporada ${season.number} · ${sexLabel}`} image="/powerlift-terra.jpg" />
      <section className="pl-hero pl-hero--season-score">
        <div className="pl-score-icon"><BarChart3 size={25} /></div>
        <div>
          <div className="pl-eyebrow">Pontuação geral da temporada</div>
          <div className="pl-score">
            <strong>{formatNumber(generalRawScore)} pts</strong>
            {effectiveStatus?.general.defendingMaster ? <small>Defesa de título Master: ranking usa {formatNumber(generalCompetitive)} pts · fator 0,95×</small> : <small>Histórico permanente disponível</small>}
          </div>
        </div>
        <div className="pl-legacy-mark">EVOLUÇÃO<br />CONQUISTA<br />LEGADO</div>
      </section>

      <section className="pl-section">
        <div className="pl-section-head"><h2>Minhas modalidades</h2><span>Três lifts. Uma grande versão sua.</span></div>
        <div className="pl-modality-grid">
          {modalities.map((modality) => {
            const stat = modalityStats[modality.id];
            const progress = Math.min(100, (POWER_LIFT_TIER_ORDER.indexOf(stat.tier) / 6) * 100);
            return (
              <article key={modality.id} className="pl-card pl-modality" onClick={() => openModality(modality.id)}>
                <img className="pl-modality-image" src={modality.image} alt="" />
                <div className="pl-modality-body">
                  <h3>{modality.title}</h3>
                  <small>1 marca oficial por dia</small>
                  <div className="pl-modality-data">
                    <span><small>Power Volume (temporada)</small><b>{stat.bestVolume ? `${formatNumber(stat.bestVolume)} kg` : '—'}</b></span>
                    <span><small>Pontuação</small><b>{formatNumber(stat.rawScore)} pts</b></span>
                  </div>
                  <div className="pl-modality-meta">
                    <TierBadge tier={stat.tier} />
                    <div className="pl-progress" aria-label="Progresso de categoria"><span style={{ width: `${progress}%` }} /></div>
                  </div>
                  {stat.defendingChampion ? <small className="pl-defense-copy">Defesa de título: score competitivo {formatNumber(stat.competitiveScore)} · 0,97×</small> : null}
                </div>
                <ChevronRight className="pl-chevron" size={19} />
              </article>
            );
          })}
        </div>
      </section>

      <section className="pl-section">
        <div className="pl-section-head"><h2>Acesso aos rankings</h2><span>Compare. Evolua. Faça história.</span></div>
        <div className="pl-ranking-grid">
          {modalities.map((modality) => {
            const stat = modalityStats[modality.id];
            const open = canEnterEliteRanking(stat.tier);
            return (
              <button
                type="button"
                key={modality.id}
                className={`pl-rank-card ${open ? 'is-open' : 'is-locked'}`}
                onClick={() => { if (open) { setSelected(modality.id); setView('elite'); } }}
              >
                <span className="pl-rank-status">{open ? <CheckCircle2 size={17} /> : <LockKeyhole size={17} />}</span>
                <Trophy size={20} />
                <h3>Ranking Elite {modality.short}</h3>
                <p>{open ? (stat.eliteOptIn ? 'Disponível · participando' : 'Disponível · participação opcional') : 'Bloqueado · alcance Diamante'}</p>
              </button>
            );
          })}
        </div>
        <button type="button" className="pl-card pl-general-card" onClick={() => generalEligible && setView(generalOptIn ? 'general' : 'unlock')}>
          <Crown size={26} />
          <div>
            <h3>Ranking Geral Power Lift</h3>
            <p>{generalEligible ? (generalOptIn ? 'Triplo Diamante · você está participando.' : 'Triplo Diamante conquistado · entrada opcional.') : `Desbloqueado ao atingir Diamante nas 3 modalidades · ${diamondCount}/3`}</p>
          </div>
          <ChevronRight className="pl-chevron" size={19} />
        </button>
      </section>

      <section className="pl-section">
        <div className="pl-section-head"><h2>Premiação da temporada</h2><span>Invictus Coins</span></div>
        <div className="pl-rules pl-rules--rewards">
          <div className="pl-rule-card"><CoinMark /> <span><b>Categorias</b><small>20 → 300 Coins por modalidade</small></span></div>
          <div className="pl-rule-card"><Medal size={19} /> <span><b>Elite</b><small>1º {formatNumber(Number(effectiveStatus?.rewards.podium[1] || 1000))} · 2º {formatNumber(Number(effectiveStatus?.rewards.podium[2] || 600))} · 3º {formatNumber(Number(effectiveStatus?.rewards.podium[3] || 400))}</small></span></div>
          <div className="pl-rule-card"><Crown size={19} /> <span><b>Master Geral</b><small>{formatNumber(effectiveStatus?.rewards.master || 4000)} Coins</small></span></div>
        </div>
      </section>
      {loadError ? <p className="pl-error">{loadError}</p> : null}
    </>
  );

  const Modality = () => {
    const nextTier = nextPowerLiftTier(selectedStats.tier);
    const target = nextTier && competitionSex ? tierThreshold(selected, competitionSex, nextTier) : null;
    const latest = selectedStats.history.slice(0, 5);
    const nextReward = nextTier && nextTier !== 'UNRANKED' ? effectiveStatus?.rewards.tier[nextTier] || 0 : 0;
    const careerRecords = myRecords.filter((row) => row.exercise === selected && row.videoStatus === 'approved');
    const careerBest = careerRecords.reduce((best, row) => Math.max(best, Number(row.powerVolume ?? row.weight) || 0), 0);
    const completedSeasons = new Set(careerRecords.map((row) => row.seasonId).filter(Boolean)).size;

    return (
      <>
        <Header title={selectedMeta.title} subtitle={`Temporada ${season.number} · ${sexLabel} · 1 marca oficial por dia`} image={selectedMeta.image} />
        <section className="pl-hero pl-hero--modality">
          <div className="pl-eyebrow"><Medal size={14} /> Minha marca da temporada</div>
          <div className="pl-stat-grid">
            <div className="pl-stat"><small>Power Volume</small><strong>{selectedStats.bestVolume ? `${formatNumber(selectedStats.bestVolume)} kg` : '—'}</strong></div>
            <div className="pl-stat"><small>Pontos da temporada</small><strong>{formatNumber(selectedStats.rawScore)} pts</strong></div>
            <div className="pl-stat pl-stat--tier"><small>Melhor marca oficial</small><TierBadge tier={selectedStats.tier} /></div>
          </div>
          {selectedStats.defendingChampion ? <small className="pl-defense-copy">Defesa de título ativa · ranking: {formatNumber(selectedStats.competitiveScore)} pts (0,97×). Seu score real continua {formatNumber(selectedStats.rawScore)}.</small> : <small>Melhor carga da temporada: {selectedStats.bestWeight ? `${formatNumber(selectedStats.bestWeight)} kg` : '—'}</small>}
        </section>

        <section className="pl-card pl-career-card">
          <BarChart3 size={24} />
          <div><small>Histórico permanente</small><b>Melhor Power Volume ({selectedMeta.short})</b><strong>{careerBest ? `${formatNumber(careerBest)} kg` : '—'}</strong></div>
          <div className="pl-career-side"><small>Temporadas com marca</small><strong>{completedSeasons || '—'}</strong></div>
        </section>

        <section className="pl-section">
          <div className="pl-section-head"><h2>Evolução da temporada</h2><span>Três lifts. Uma grande versão sua.</span></div>
          <div className="pl-tier-track">
            {POWER_LIFT_TIER_ORDER.slice(1).map((tier) => {
              const activeIndex = POWER_LIFT_TIER_ORDER.indexOf(selectedStats.tier);
              const currentIndex = POWER_LIFT_TIER_ORDER.indexOf(tier);
              const reward = tier !== 'UNRANKED' ? effectiveStatus?.rewards.tier[tier] || 0 : 0;
              return (
                <div key={tier} className={`pl-tier-step ${currentIndex <= activeIndex ? 'done' : ''} ${tier === selectedStats.tier ? 'current' : ''}`}>
                  <TierBadge tier={tier} compact />
                  <span>{tier}</span>
                  {reward ? <small>+{reward}</small> : null}
                </div>
              );
            })}
          </div>
          <div className="pl-card pl-target-card">
            <Target size={24} />
            <div>
              <div className="pl-eyebrow">Próximo alvo pessoal</div>
              <strong>{nextTier && target !== null ? `${formatNumber(target)} kg` : 'Diamante conquistado'}</strong>
              <p>{nextTier && target !== null
                ? `Faltam ${formatNumber(Math.max(0, target - selectedStats.bestVolume))} kg de Power Volume para ${nextTier}${nextReward ? ` · +${formatNumber(nextReward)} Coins` : ''}.`
                : 'Agora cada melhora da sua melhor marca pode mexer no Ranking Elite.'}</p>
            </div>
          </div>
        </section>

        <section className="pl-section">
          <div className="pl-section-head"><h2>Resumo da regra</h2></div>
          <div className="pl-rules">
            <div className="pl-rule-card"><Dumbbell size={17} /> Até 3 séries válidas</div>
            <div className="pl-rule-card"><BarChart3 size={17} /> 5 a 10 reps pontuam conforme a carga</div>
            <div className="pl-rule-card"><ShieldCheck size={17} /> Série precisa ter ≥70% da maior carga</div>
            <div className="pl-rule-card"><Clock3 size={17} /> 1 resultado oficial/dia</div>
            <div className="pl-rule-card"><TrendingUp size={17} /> Somente melhora da melhor marca aumenta o ranking</div>
          </div>
        </section>

        <section className="pl-section">
          <div className="pl-section-head"><h2>Últimas marcas oficiais</h2><span>Sempre em evolução.</span></div>
          <div className="pl-history">
            {latest.length ? latest.map((row) => (
              <div className="pl-history-row" key={row.id}>
                <small>{row.date || '—'}</small>
                <b>{formatNumber(Number(row.powerVolume ?? row.weight) || 0)} kg</b>
                <small>{row.videoStatus === 'approved' ? 'Validada' : row.videoStatus === 'manual_review' ? 'Em revisão' : 'Reprovada'}</small>
              </div>
            )) : <div className="pl-card" style={{ padding: 16, color: '#9d9da5' }}>Nenhuma marca registrada nesta temporada.</div>}
          </div>
        </section>

        <button className="pl-primary" type="button" disabled={selectedStats.todayUsed} onClick={() => { resetRegistration(); setView('register'); }}>
          <Dumbbell size={18} /> {selectedStats.todayUsed ? 'Marca oficial de hoje já utilizada' : 'Registrar marca oficial de hoje'}
        </button>
        {canEnterEliteRanking(selectedStats.tier) ? <button className="pl-secondary" type="button" onClick={() => setView('elite')}><Trophy size={17} /> Abrir Ranking Elite</button> : null}
      </>
    );
  };

  const Register = () => {
    const validSeriesCount = scoredSeries.filter((item) => item.eligible && item.volume > 0).length;
    const ready = Boolean(videoFile && calculatedVolume > 0 && validSeriesCount > 0 && !selectedStats.todayUsed);
    return (
      <>
        <Header title="REGISTRAR" accent="MARCA OFICIAL" subtitle={`${selectedMeta.title} · Temporada ${season.number} · Tentativa de hoje`} image={selectedMeta.image} />
        <section className="pl-hero pl-hero--best-mark">
          <div className="pl-score-icon"><Crown size={24} /></div>
          <div>
            <div className="pl-eyebrow">Sua melhor marca da temporada</div>
            <div className="pl-score"><strong>{selectedStats.bestVolume ? `${formatNumber(selectedStats.bestVolume)} kg` : '—'}</strong><small>Só pontua se superar sua melhor marca atual</small></div>
          </div>
          <div className="pl-legacy-mark">EVOLUÇÃO<br />CONQUISTA<br />LEGADO</div>
        </section>

        <section className="pl-section">
          <div className="pl-section-head"><h2>Séries válidas do Power Lift</h2><span>Três séries. Um grande resultado.</span></div>
          {series.map((item, index) => {
            const parsed = parsedSeries[index];
            const scored = scoredSeries[index];
            const repCap = competitionSex && parsed.weight > 0 ? maxCountedReps(selected, competitionSex, parsed.weight) : 5;
            return (
              <div className="pl-form-card" key={index}>
                <div className="pl-form-card-head"><b>Série {index + 1}</b><small>até {repCap} reps pontuam nesta carga</small></div>
                <div className="pl-form-grid">
                  <div className="pl-field"><label>Carga (kg)</label><input inputMode="decimal" value={item.weight} onChange={(event) => setSeries((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, weight: event.target.value } : row))} placeholder="0" /></div>
                  <div className="pl-field"><label>Repetições</label><input inputMode="numeric" value={item.reps} onChange={(event) => setSeries((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, reps: event.target.value } : row))} placeholder="0" /></div>
                  <div className="pl-volume"><small>{scored?.eligible === false && parsed.weight > 0 ? 'Não pontua' : 'Volume'}</small><strong>{formatNumber(scored?.volume || 0)} kg</strong></div>
                </div>
                {scored?.eligible === false && parsed.weight > 0 ? <small style={{ color: '#ffbe55' }}>Carga abaixo de 70% da maior série ({formatNumber(minimumSetWeight)} kg).</small> : null}
                {scored?.eligible && Number(parsed.reps) > (scored.countedReps || 0) ? <small>{parsed.reps} reps executadas · {scored.countedReps} contabilizadas pela faixa de carga.</small> : null}
              </div>
            );
          })}
        </section>

        <section className="pl-card pl-volume-summary">
          <div className="pl-score-icon"><BarChart3 size={23} /></div>
          <div><div className="pl-eyebrow">Power Volume calculado</div><strong>{formatNumber(calculatedVolume)} kg</strong><small>Maior carga {formatNumber(declaredWeight)} kg · piso das séries {formatNumber(minimumSetWeight)} kg</small></div>
        </section>

        <div className="pl-upload">
          <input id="powerlift-season-video" type="file" accept="video/*" capture="environment" onChange={(event) => setVideoFile(event.target.files?.[0] || null)} />
          <label htmlFor="powerlift-season-video"><Video size={24} /> {videoFile ? videoFile.name : 'Anexar vídeo completo da marca'}<small>obrigatório para validação</small></label>
        </div>

        <section className="pl-validation-checklist">
          <div className={videoFile ? 'is-ok' : ''}><CheckCircle2 /> <span><b>Vídeo anexado</b><small>{videoFile ? '1 arquivo selecionado' : 'Pendente'}</small></span></div>
          <div className={calculatedVolume > 0 ? 'is-ok' : ''}><CheckCircle2 /> <span><b>Execução informada</b><small>{calculatedVolume > 0 ? 'Séries calculadas' : 'Preencha as séries'}</small></span></div>
          <div className={validSeriesCount > 0 ? 'is-ok' : ''}><CheckCircle2 /> <span><b>Repetições na regra</b><small>{validSeriesCount} série(s) pontuável(is)</small></span></div>
          <div className={ready ? 'is-ok' : ''}><CheckCircle2 /> <span><b>Pronta para envio</b><small>{ready ? 'Sem pendências' : 'Revise os itens'}</small></span></div>
        </section>

        <div className="pl-warning"><Info size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />A marca do dia pode conquistar no máximo uma categoria. O score usa sempre sua melhor marca válida da temporada.</div>
        {submissionError ? <p className="pl-error">{submissionError}</p> : null}
        <button className="pl-primary" type="button" onClick={() => void submitMark()}><Upload size={18} /> Enviar para validação</button>
      </>
    );
  };

  const RankingNav = ({ active }: { active: Exercise | 'general' }) => (
    <div className="pl-ranking-nav">
      {modalities.map((modality) => {
        const available = canEnterEliteRanking(modalityStats[modality.id].tier);
        return (
          <button
            key={modality.id}
            type="button"
            className={active === modality.id ? 'is-active' : ''}
            disabled={!available}
            onClick={() => { setSelected(modality.id); setView('elite'); }}
          >
            <Dumbbell size={17} /><span>Elite {modality.short}</span>
          </button>
        );
      })}
      <button type="button" className={active === 'general' ? 'is-active' : ''} disabled={!generalEligible} onClick={() => setView(generalOptIn ? 'general' : 'unlock')}><BarChart3 size={17} /><span>Geral</span></button>
    </div>
  );

  const EliteRanking = () => {
    const reward1 = Number(effectiveStatus?.rewards.podium[1] || 1000);
    const reward2 = Number(effectiveStatus?.rewards.podium[2] || 600);
    const reward3 = Number(effectiveStatus?.rewards.podium[3] || 400);
    const myIndex = publicRanking.findIndex((row) => row.userId === user?.uid);
    return (
      <>
        <Header title="RANKING" accent="ELITE" subtitle={`${selectedMeta.short.toUpperCase()} · ${sexLabel} · Diamante obrigatório`} image={selectedMeta.image} />
        <section className="pl-elite-status">
          <TierBadge tier="DIAMANTE" compact />
          <div><small>Status Elite</small><b>{selectedStats.eliteOptIn || preview ? 'Você está elegível e participando do ranking' : 'Você está elegível para o ranking'}</b><p>Continue registrando suas marcas para subir na classificação.</p></div>
        </section>
        <section className="pl-hero pl-hero--elite-summary">
          <div className="pl-stat-grid">
            <div className="pl-stat"><small>Sua posição</small><strong>{myIndex >= 0 ? `#${myIndex + 1}` : '—'}</strong></div>
            <div className="pl-stat"><small>Seu melhor volume na temporada</small><strong>{formatNumber(selectedStats.bestVolume)} kg</strong></div>
            <div className="pl-stat"><small>Sua pontuação na temporada</small><strong>{formatNumber(selectedStats.defendingChampion ? selectedStats.competitiveScore : selectedStats.rawScore)} pts</strong></div>
          </div>
          <small>{selectedStats.defendingChampion ? `Power Score real ${formatNumber(selectedStats.rawScore)} · defesa 0,97×` : `${formatNumber(selectedStats.rawScore)} Power Points acumulados desde a primeira marca`}</small>
        </section>

        <section className="pl-card pl-elite-prizes">
          <div className="pl-eyebrow"><CoinMark /> Prêmios no fechamento</div>
          <div><span><b>1º</b><strong>{formatNumber(reward1)}</strong></span><span><b>2º</b><strong>{formatNumber(reward2)}</strong></span><span><b>3º</b><strong>{formatNumber(reward3)}</strong></span><small>Invictus Coins</small></div>
        </section>

        {!selectedStats.eliteOptIn && !preview ? (
          <section className="pl-card pl-unlock">
            <Trophy size={36} />
            <h2>Você conquistou o direito de disputar</h2>
            <p>Seu score já foi construído desde a primeira marca da temporada. Entrar no ranking é opcional e não zera sua pontuação.</p>
            <button className="pl-primary" type="button" disabled={optInBusy} onClick={() => void updateOptIn('elite', true, selected)}>{optInBusy ? 'ATIVANDO…' : 'PARTICIPAR DO RANKING ELITE'}</button>
            <button className="pl-secondary" type="button" onClick={() => setView('modality')}>Agora não</button>
          </section>
        ) : (
          <>
            <section className="pl-section">
              <div className="pl-section-head"><h2>Top 10 Ranking Elite {selectedMeta.short}</h2><span>Força real reconhece resultados.</span></div>
              <div className="pl-leaderboard">
                {publicRanking.length ? publicRanking.slice(0, 10).map((row, index) => {
                  const competitive = Number(row.competitiveScore || row.seasonScore || 0);
                  const raw = Number(row.seasonScore || competitive);
                  const defending = Boolean((row as any).defendingChampion);
                  return (
                    <div key={row.id} className={`pl-leader-row ${row.userId === user?.uid ? 'is-me' : ''}`}>
                      <div className="pl-rank-num">{index + 1}</div>
                      <div className="pl-athlete"><AthleteAvatar photo={row.userPhoto} name={row.userName} /><div><b>{row.userId === user?.uid ? 'Você' : row.userName || 'Atleta'}</b><small>{formatNumber(Number(row.powerVolume || 0))} kg · {defending ? 'defesa de título' : 'temporada atual'}</small></div></div>
                      <div className="pl-leader-points"><strong>{formatNumber(competitive)} pts</strong><small>{defending ? `real ${formatNumber(raw)}` : 'ranking'}</small></div>
                    </div>
                  );
                }) : <div className="pl-card" style={{ padding: 18, color: '#9d9da5' }}>Ainda não há atletas participantes nesta categoria.</div>}
              </div>
            </section>
            {!preview ? <button className="pl-secondary" type="button" disabled={optInBusy} onClick={() => void updateOptIn('elite', false, selected)}>Sair do Ranking Elite</button> : null}
          </>
        )}
        <div className="pl-warning">O ranking mostra atletas Diamante da temporada. Seus Power Points vêm desde a primeira marca válida; entrar no ranking não zera o score.</div>
        <section className="pl-section"><div className="pl-section-head"><h2>Outros rankings Elite</h2></div><RankingNav active={selected} /></section>
        {loadError ? <p className="pl-error">{loadError}</p> : null}
      </>
    );
  };

  const Unlock = () => (
    <>
      <Header title="TRIPLO" accent="DIAMANTE" subtitle="Força total. Sem limites." image="/powerlift-terra.jpg" />
      <section className="pl-triplo-grid">
        {modalities.map((modality) => (
          <article key={modality.id} style={{ backgroundImage: `linear-gradient(180deg,rgba(0,0,0,.2),rgba(0,0,0,.86)),url(${modality.image})` }}>
            <h3>{modality.title}</h3>
            <TierBadge tier="DIAMANTE" />
          </article>
        ))}
      </section>
      <section className="pl-card pl-unlock pl-unlock--general">
        <div className="pl-unlock-icon"><Crown size={42} /></div>
        <small>Ranking Geral Power Lift</small>
        <h2>Desbloqueado</h2>
        <p>Três lifts. Uma grande versão sua.</p>
      </section>
      <section className="pl-card pl-unlock-score-card">
        <Zap size={22} />
        <div><span>Sua pontuação acumulada da temporada</span><b>já entra no ranking geral.</b></div>
      </section>
      <section className="pl-card pl-unlock-total">
        <BarChart3 size={26} />
        <div><small>Pontuação geral atual</small><strong>{formatNumber(generalRawScore)} pts</strong></div>
        <div className="pl-legacy-mark">EVOLUÇÃO<br />CONQUISTA<br />LEGADO</div>
      </section>
      <section className="pl-section">
        <div className="pl-section-head"><h2>Detalhamento da pontuação</h2><span>Sua força te trouxe até aqui.</span></div>
        <div className="pl-breakdown pl-breakdown--score">
          {modalities.map((modality) => <div key={modality.id}><small>{modality.title}</small><b>{formatNumber(modalityStats[modality.id].rawScore)} pts</b></div>)}
        </div>
      </section>
      <div className="pl-warning">Você não começa do zero. Toda a pontuação conquistada desde o primeiro registro válido da temporada conta para o Ranking Geral.</div>
      <div className="pl-master-reward"><CoinMark /><span>Premiação Master da temporada</span><b>{formatNumber(effectiveStatus?.rewards.master || 4000)} Coins</b></div>
      <button className="pl-primary" type="button" disabled={optInBusy} onClick={() => void updateOptIn('general', true)}><Crown size={18} /> {optInBusy ? 'ATIVANDO…' : 'PARTICIPAR DO RANKING GERAL'}</button>
      <button className="pl-secondary" type="button" onClick={() => setView('home')}>Agora não</button>
      {loadError ? <p className="pl-error">{loadError}</p> : null}
    </>
  );

  const GeneralRanking = () => {
    const myIndex = visibleGeneralRanking.findIndex((item) => item.userId === user?.uid);
    return (
      <>
        <Header title="RANKING GERAL" accent="POWER LIFT" subtitle={`Temporada ${season.number} · ${sexLabel}`} image="/powerlift-terra.jpg" />
        <section className="pl-general-filters">
          <span>{sexLabel}</span><span>Temporada {season.number}</span><span><CoinMark size={18} /> Premiação em Invictus Coins</span>
        </section>
        <section className="pl-hero pl-hero--general-position">
          <div><small>{season.daysRemaining} dias restantes</small><span>Mais força<br />Mais evolução<br />Um você mais forte</span></div>
          <div><small>Sua posição atual</small><strong>{myIndex >= 0 ? `#${myIndex + 1}` : '—'} &nbsp; {formatNumber(effectiveStatus?.general.defendingMaster ? generalCompetitive : generalRawScore)} pts</strong>{myIndex > 0 ? <span>Faltam {formatNumber(Math.max(0, visibleGeneralRanking[myIndex - 1].competitiveScore - (effectiveStatus?.general.defendingMaster ? generalCompetitive : generalRawScore)))} pts para subir uma posição</span> : null}</div>
          <div className="pl-legacy-mark">EVOLUÇÃO<br />CONQUISTA<br />LEGADO</div>
        </section>
        <section className="pl-card pl-master-prize-card">
          <div><CoinMark /><span>Premiação Master</span></div>
          <strong>{formatNumber(effectiveStatus?.rewards.master || 4000)} Invictus Coins</strong>
          <small>#1 do Ranking Geral no fechamento da temporada.</small>
        </section>
        <section className="pl-section">
          <div className="pl-section-head"><h2>Top 10 atletas da temporada</h2><span>Força real aparece nos resultados.</span></div>
          <div className="pl-general-headings"><span>Pos.</span><span>Atleta</span><span>Pontuação total</span><span>Desempenho por modalidade</span></div>
          <div className="pl-leaderboard pl-leaderboard--general">
            {visibleGeneralRanking.length ? visibleGeneralRanking.slice(0, 10).map((item, index) => (
              <div key={item.userId} className={`pl-leader-row ${item.userId === user?.uid ? 'is-me' : ''}`}>
                <div className="pl-rank-num">{item.rank || index + 1}</div>
                <div className="pl-athlete"><AthleteAvatar photo={item.userPhoto} name={item.userName} /><div><b>{item.userId === user?.uid ? 'Você' : item.userName || 'Atleta'}</b><small>{item.defendingMaster ? '👑 defesa de título Master' : 'temporada atual'}</small></div></div>
                <div className="pl-leader-points"><strong>{formatNumber(item.competitiveScore)} pts</strong><small>{item.defendingMaster ? `real ${formatNumber(item.rawScore)} · 0,95×` : 'total'}</small></div>
                <div className="pl-lift-split"><span>S {formatNumber(item.scores.supino || 0)}</span><span>A {formatNumber(item.scores.agachamento || 0)}</span><span>T {formatNumber(item.scores.terra || 0)}</span></div>
              </div>
            )) : <div className="pl-card" style={{ padding: 18, color: '#9d9da5' }}>Ainda não há atletas Triplo Diamante participando.</div>}
          </div>
        </section>
        <div className="pl-warning"><CalendarDays size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />A cada 30 dias o ranking reinicia, mas seu histórico permanente continua salvo. Campeões defendem o título com 0,97× na modalidade e o Master com 0,95× no Geral; os fatores não se acumulam.</div>
        <RankingNav active="general" />
        {!preview ? <button className="pl-secondary" type="button" disabled={optInBusy} onClick={() => void updateOptIn('general', false)}>Sair do Ranking Geral</button> : null}
        {loadError ? <p className="pl-error">{loadError}</p> : null}
      </>
    );
  };

  const Processing = () => (
    <>
      <Header title="VALIDANDO" accent="MARCA" image={selectedMeta.image} />
      <section className="pl-message-card"><div className="pl-spinner" /><h2>Enviando sua marca</h2><p>Upload {uploadProgress}% · o vídeo será preservado mesmo se a conexão oscilar após o envio.</p></section>
    </>
  );

  const Submitted = () => (
    <>
      <Header title="MARCA" accent="REGISTRADA" image={selectedMeta.image} />
      <section className="pl-message-card"><ShieldCheck size={42} /><h2>Registro recebido</h2><p>{submissionMessage || 'Sua marca foi recebida e está seguindo o fluxo de validação.'}</p><button className="pl-primary" type="button" onClick={() => { void loadData(); setView('modality'); }}>Voltar para {selectedMeta.short}</button></section>
    </>
  );

  return (
    <main className={`pl-season pl-view-${view}`}>
      <div className="pl-shell">
        {loading && view === 'home' ? <section className="pl-message-card"><div className="pl-spinner" /><h2>Carregando Power Lift</h2></section> : null}
        {!loading && view === 'home' ? <Dashboard /> : null}
        {view === 'modality' ? <Modality /> : null}
        {view === 'register' ? <Register /> : null}
        {view === 'elite' ? <EliteRanking /> : null}
        {view === 'unlock' ? <Unlock /> : null}
        {view === 'general' ? <GeneralRanking /> : null}
        {view === 'processing' ? <Processing /> : null}
        {view === 'submitted' ? <Submitted /> : null}
      </div>
      {view !== 'processing' ? <BottomNav /> : null}
    </main>
  );
}
