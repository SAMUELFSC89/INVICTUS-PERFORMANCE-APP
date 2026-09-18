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
  Info,
  LockKeyhole,
  Medal,
  ShieldCheck,
  Trophy,
  Upload,
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
    const names = ['Bruno Almeida', 'Felipe Souza', 'Lucas Carvalho', user?.displayName || 'Você', 'Rafael Mendes', 'Gabriel Pereira'];
    return names.map((name, index) => ({
      id: `preview-${selected}-${index}`,
      userId: index === 3 ? user?.uid || 'me' : `preview-${index}`,
      userName: name,
      exercise: selected,
      weight: 220 - index * 5,
      powerVolume: 2400 - index * 80,
      seasonScore: 1120 - index * 35,
      competitiveScore: 1120 - index * 35,
      competitionSex: competitionSex || 'male',
      seasonTier: 'DIAMANTE',
    } as RecordRow));
  }, [records, selected, preview, user?.uid, user?.displayName, competitionSex]);

  const visibleGeneralRanking = useMemo(() => {
    if (!preview) return generalRanking.slice(0, 20);
    const names = ['Bruno Almeida', 'Felipe Souza', 'Lucas Carvalho', user?.displayName || 'Você', 'Rafael Mendes'];
    return names.map((name, index) => ({
      rank: index + 1,
      userId: index === 3 ? user?.uid || 'me' : `general-${index}`,
      userName: name,
      userPhoto: '',
      rawScore: 3300 - index * 80,
      competitiveScore: 3300 - index * 80,
      defendingMaster: index === 0,
      defenseMultiplier: index === 0 ? 0.95 : 1,
      scores: { supino: 1100 - index * 20, agachamento: 1120 - index * 30, terra: 1080 - index * 30 },
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

  const Header = ({ title, accent, subtitle }: { title: string; accent?: string; subtitle?: string }) => (
    <>
      <div className="pl-topbar">
        <button className="pl-back" type="button" aria-label="Voltar" onClick={back}><ArrowLeft size={19} /></button>
        <div className="pl-brand">INVICTUS PERFORMANCE</div>
        <div className="pl-season-chip"><CalendarDays size={13} /> T{season.number} · {season.daysRemaining} dias</div>
      </div>
      <h1 className="pl-title">{title} {accent ? <em>{accent}</em> : null}</h1>
      {subtitle ? <p className="pl-subtitle">{subtitle}</p> : null}
    </>
  );

  const Dashboard = () => (
    <>
      <Header title="POWER" accent="LIFT" subtitle={`Temporada ${season.number} · ${sexLabel}`} />
      <section className="pl-hero">
        <div className="pl-eyebrow"><BarChart3 size={14} /> Power Score geral da temporada</div>
        <div className="pl-score">
          <strong>{formatNumber(generalRawScore)} pts</strong>
          {effectiveStatus?.general.defendingMaster ? <small>Defesa de título Master: ranking usa {formatNumber(generalCompetitive)} pts · fator 0,95×</small> : <small>Histórico permanente preservado</small>}
        </div>
      </section>

      <section className="pl-section">
        <div className="pl-section-head"><h2>Minhas modalidades</h2><span>1 marca oficial por dia</span></div>
        <div className="pl-modality-grid">
          {modalities.map((modality) => {
            const stat = modalityStats[modality.id];
            const progress = Math.min(100, (POWER_LIFT_TIER_ORDER.indexOf(stat.tier) / 6) * 100);
            return (
              <article key={modality.id} className="pl-card pl-modality" onClick={() => openModality(modality.id)}>
                <img className="pl-modality-image" src={modality.image} alt="" />
                <div>
                  <h3>{modality.title}</h3>
                  <p>Power Volume: <b>{stat.bestVolume ? `${formatNumber(stat.bestVolume)} kg` : '—'}</b> · {formatNumber(stat.rawScore)} pts</p>
                  <div className="pl-modality-meta">
                    <span className={`pl-tier ${stat.tier === 'DIAMANTE' ? 'pl-tier--diamond' : ''}`}><Diamond size={11} /> {tierLabel(stat.tier)}</span>
                    <div className="pl-progress" aria-label="Progresso de categoria"><span style={{ width: `${progress}%` }} /></div>
                  </div>
                  {stat.defendingChampion ? <small>🏆 Defesa de título: score competitivo {formatNumber(stat.competitiveScore)} · 0,97×</small> : null}
                </div>
                <ChevronRight className="pl-chevron" size={19} />
              </article>
            );
          })}
        </div>
      </section>

      <section className="pl-section">
        <div className="pl-section-head"><h2>Acesso aos rankings</h2><span>Diamante libera a elite</span></div>
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
                <span className="pl-rank-status">{open ? <CheckCircle2 size={15} /> : <LockKeyhole size={15} />}</span>
                <Trophy size={20} />
                <h3>Ranking Elite {modality.short}</h3>
                <p>{open ? (stat.eliteOptIn ? 'Participando da temporada' : 'Elegível · participação opcional') : 'Alcance Diamante para liberar'}</p>
              </button>
            );
          })}
        </div>
        <button type="button" className="pl-card pl-general-card" onClick={() => generalEligible && setView(generalOptIn ? 'general' : 'unlock')}>
          <Crown size={26} />
          <div>
            <h3>Ranking Geral Power Lift</h3>
            <p>{generalEligible ? (generalOptIn ? 'Triplo Diamante · você está participando.' : 'Triplo Diamante conquistado · entrada opcional.') : `${diamondCount}/3 modalidades em Diamante`}</p>
          </div>
          <ChevronRight className="pl-chevron" size={19} />
        </button>
      </section>

      <section className="pl-section">
        <div className="pl-section-head"><h2>Premiação da temporada</h2><span>Invictus Coins</span></div>
        <div className="pl-rules">
          <div className="pl-rule-card"><Coins size={17} /> Categorias: 20 → 300 Coins por modalidade</div>
          <div className="pl-rule-card"><Medal size={17} /> Elite: 1º {formatNumber(Number(effectiveStatus?.rewards.podium[1] || 1000))} · 2º {formatNumber(Number(effectiveStatus?.rewards.podium[2] || 600))} · 3º {formatNumber(Number(effectiveStatus?.rewards.podium[3] || 400))}</div>
          <div className="pl-rule-card"><Crown size={17} /> Master Geral: {formatNumber(effectiveStatus?.rewards.master || 4000)} Coins</div>
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
    return (
      <>
        <Header title={selectedMeta.title} subtitle={`${sexLabel} · 1 marca oficial por dia`} />
        <section className="pl-hero">
          <div className="pl-eyebrow"><Medal size={14} /> Minha marca da temporada</div>
          <div className="pl-stat-grid">
            <div className="pl-stat"><small>Power Volume</small><strong>{selectedStats.bestVolume ? `${formatNumber(selectedStats.bestVolume)} kg` : '—'}</strong></div>
            <div className="pl-stat"><small>Power Score</small><strong>{formatNumber(selectedStats.rawScore)} pts</strong></div>
            <div className="pl-stat"><small>Categoria</small><strong>{tierLabel(selectedStats.tier)}</strong></div>
          </div>
          {selectedStats.defendingChampion ? <small>Defesa de título ativa · ranking: {formatNumber(selectedStats.competitiveScore)} pts (0,97×). Seu score real continua {formatNumber(selectedStats.rawScore)}.</small> : <small>Melhor carga da temporada: {selectedStats.bestWeight ? `${formatNumber(selectedStats.bestWeight)} kg` : '—'}</small>}
        </section>

        <section className="pl-section">
          <div className="pl-section-head"><h2>Evolução da temporada</h2><span>máximo 1 avanço/dia</span></div>
          <div className="pl-tier-track">
            {POWER_LIFT_TIER_ORDER.slice(1).map((tier) => {
              const activeIndex = POWER_LIFT_TIER_ORDER.indexOf(selectedStats.tier);
              const currentIndex = POWER_LIFT_TIER_ORDER.indexOf(tier);
              const reward = tier !== 'UNRANKED' ? effectiveStatus?.rewards.tier[tier] || 0 : 0;
              return <div key={tier} className={`pl-tier-step ${currentIndex <= activeIndex ? 'done' : ''} ${tier === selectedStats.tier ? 'current' : ''}`}><i>{currentIndex <= activeIndex ? '✓' : '•'}</i>{tier}{reward ? <small>+{reward}</small> : null}</div>;
            })}
          </div>
          <div className="pl-card" style={{ padding: 16 }}>
            <div className="pl-eyebrow"><Zap size={13} /> Próximo objetivo</div>
            <p style={{ marginBottom: 0 }}>{nextTier && target !== null
              ? `Valide em outro dia uma marca com pelo menos ${formatNumber(target)} kg de Power Volume para conquistar ${nextTier}${nextReward ? ` e +${formatNumber(nextReward)} Coins` : ''}.`
              : 'Diamante conquistado. Agora cada melhora da sua melhor marca pode mexer no Ranking Elite.'}</p>
          </div>
        </section>

        <section className="pl-section">
          <div className="pl-section-head"><h2>Resumo da regra</h2></div>
          <div className="pl-rules">
            <div className="pl-rule-card"><Dumbbell size={17} /> Até 3 séries válidas</div>
            <div className="pl-rule-card"><BarChart3 size={17} /> 5 a 10 reps pontuam conforme a carga</div>
            <div className="pl-rule-card"><ShieldCheck size={17} /> Série precisa ter ≥70% da maior carga</div>
            <div className="pl-rule-card"><Clock3 size={17} /> 1 marca oficial por modalidade/dia</div>
            <div className="pl-rule-card"><Trophy size={17} /> Só melhorar a melhor marca aumenta o score</div>
          </div>
        </section>

        <section className="pl-section">
          <div className="pl-section-head"><h2>Últimas marcas oficiais</h2><span>histórico da temporada</span></div>
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

  const Register = () => (
    <>
      <Header title="REGISTRAR" accent="MARCA" subtitle={`${selectedMeta.title} · Tentativa oficial de hoje`} />
      <section className="pl-hero">
        <div className="pl-eyebrow"><Trophy size={14} /> Melhor marca da temporada</div>
        <div className="pl-score"><strong>{selectedStats.bestVolume ? `${formatNumber(selectedStats.bestVolume)} kg` : '—'}</strong><small>só aumenta o Power Score se superar sua melhor marca</small></div>
      </section>

      <section className="pl-section">
        <div className="pl-section-head"><h2>Séries válidas do Power Lift</h2><span>máximo 3</span></div>
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

      <section className="pl-card" style={{ padding: 18, marginTop: 14 }}>
        <div className="pl-eyebrow"><BarChart3 size={14} /> Power Volume calculado</div>
        <div className="pl-score"><strong>{formatNumber(calculatedVolume)} kg</strong><small>maior carga: {formatNumber(declaredWeight)} kg · piso das séries: {formatNumber(minimumSetWeight)} kg</small></div>
      </section>

      <div className="pl-upload">
        <input id="powerlift-season-video" type="file" accept="video/*" capture="environment" onChange={(event) => setVideoFile(event.target.files?.[0] || null)} />
        <label htmlFor="powerlift-season-video"><Video size={24} /> {videoFile ? videoFile.name : 'Anexar vídeo completo da marca'}<small>obrigatório para validação</small></label>
      </div>

      <div className="pl-warning"><Info size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />A marca do dia pode conquistar no máximo uma categoria. O score usa sempre sua melhor marca válida da temporada.</div>
      {submissionError ? <p className="pl-error">{submissionError}</p> : null}
      <button className="pl-primary" type="button" onClick={() => void submitMark()}><Upload size={18} /> Enviar para validação</button>
    </>
  );

  const EliteRanking = () => {
    const reward1 = Number(effectiveStatus?.rewards.podium[1] || 1000);
    const reward2 = Number(effectiveStatus?.rewards.podium[2] || 600);
    const reward3 = Number(effectiveStatus?.rewards.podium[3] || 400);
    return (
      <>
        <Header title="RANKING ELITE" accent={selectedMeta.short.toUpperCase()} subtitle={`${sexLabel} · Diamante obrigatório`} />
        <section className="pl-hero">
          <div className="pl-eyebrow"><Diamond size={14} /> Status Elite</div>
          <div className="pl-score">
            <strong>{formatNumber(selectedStats.defendingChampion ? selectedStats.competitiveScore : selectedStats.rawScore)} pts</strong>
            <small>{selectedStats.defendingChampion ? `Power Score real ${formatNumber(selectedStats.rawScore)} · defesa 0,97×` : `${formatNumber(selectedStats.rawScore)} Power Points acumulados desde a primeira marca`}</small>
          </div>
        </section>

        <section className="pl-card" style={{ padding: 16, marginBottom: 14 }}>
          <div className="pl-eyebrow"><Coins size={13} /> Prêmios no fechamento</div>
          <p style={{ marginBottom: 0 }}>🥇 {formatNumber(reward1)} · 🥈 {formatNumber(reward2)} · 🥉 {formatNumber(reward3)} Invictus Coins.</p>
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
              <div className="pl-section-head"><h2>Ranking da temporada</h2><span>melhor marca da temporada</span></div>
              <div className="pl-leaderboard">
                {publicRanking.length ? publicRanking.map((row, index) => {
                  const competitive = Number(row.competitiveScore || row.seasonScore || 0);
                  const raw = Number(row.seasonScore || competitive);
                  const defending = Boolean((row as any).defendingChampion);
                  return (
                    <div key={row.id} className={`pl-leader-row ${row.userId === user?.uid ? 'is-me' : ''}`}>
                      <div className="pl-rank-num">#{index + 1}</div>
                      <div className="pl-athlete"><img className="pl-avatar" src={row.userPhoto || '/avatar-placeholder.png'} alt="" /><div><b>{row.userId === user?.uid ? 'Você' : row.userName || 'Atleta'}</b><small>{formatNumber(Number(row.powerVolume || 0))} kg Power Volume{defending ? ' · defesa' : ''}</small></div></div>
                      <div className="pl-leader-points"><strong>{formatNumber(competitive)} pts</strong><small>{defending ? `real ${formatNumber(raw)}` : 'ranking'}</small></div>
                    </div>
                  );
                }) : <div className="pl-card" style={{ padding: 18, color: '#9d9da5' }}>Ainda não há atletas participantes nesta categoria.</div>}
              </div>
            </section>
            {!preview ? <button className="pl-secondary" type="button" disabled={optInBusy} onClick={() => void updateOptIn('elite', false, selected)}>Sair do Ranking Elite</button> : null}
          </>
        )}
        <div className="pl-warning">Diamante libera a disputa, mas não inicia a pontuação. Seus Power Points vêm desde a primeira marca válida da temporada.</div>
        {loadError ? <p className="pl-error">{loadError}</p> : null}
      </>
    );
  };

  const Unlock = () => (
    <>
      <Header title="TRIPLO" accent="DIAMANTE" subtitle="Supino + Agachamento + Terra" />
      <section className="pl-card pl-unlock">
        <div className="pl-unlock-icon"><Crown size={42} /></div>
        <h2>Ranking Geral desbloqueado</h2>
        <p>Você não começa do zero. Toda a pontuação das três modalidades desde o primeiro registro válido desta temporada já entra no Ranking Geral.</p>
        <div className="pl-score" style={{ justifyContent: 'center' }}><strong>{formatNumber(generalRawScore)} pts</strong></div>
        <div className="pl-breakdown">
          {modalities.map((modality) => <div key={modality.id}><small>{modality.title}</small><b>{formatNumber(modalityStats[modality.id].rawScore)} pts</b></div>)}
        </div>
        <p><Coins size={14} style={{ verticalAlign: 'middle' }} /> Campeão Master: <b>{formatNumber(effectiveStatus?.rewards.master || 4000)} Invictus Coins</b></p>
        <button className="pl-primary" type="button" disabled={optInBusy} onClick={() => void updateOptIn('general', true)}><Crown size={18} /> {optInBusy ? 'ATIVANDO…' : 'PARTICIPAR DO RANKING GERAL'}</button>
        <button className="pl-secondary" type="button" onClick={() => setView('home')}>Agora não</button>
      </section>
      {loadError ? <p className="pl-error">{loadError}</p> : null}
    </>
  );

  const GeneralRanking = () => {
    const myIndex = visibleGeneralRanking.findIndex((item) => item.userId === user?.uid);
    return (
      <>
        <Header title="RANKING GERAL" accent="POWER LIFT" subtitle={`${sexLabel} · Temporada ${season.number}`} />
        <section className="pl-hero">
          <div className="pl-eyebrow"><Crown size={14} /> Sua posição atual</div>
          <div className="pl-score">
            <strong>{myIndex >= 0 ? `#${myIndex + 1}` : '—'} · {formatNumber(effectiveStatus?.general.defendingMaster ? generalCompetitive : generalRawScore)} pts</strong>
            <small>{effectiveStatus?.general.defendingMaster ? `Power Score real ${formatNumber(generalRawScore)} · defesa Master 0,95×` : `${season.daysRemaining} dias restantes`}</small>
          </div>
        </section>
        <section className="pl-card" style={{ padding: 16, marginBottom: 14 }}>
          <div className="pl-eyebrow"><Coins size={13} /> Prêmio Master</div>
          <p style={{ marginBottom: 0 }}>👑 #1 do Ranking Geral recebe <b>{formatNumber(effectiveStatus?.rewards.master || 4000)} Invictus Coins</b>.</p>
        </section>
        <section className="pl-section">
          <div className="pl-section-head"><h2>Classificação geral</h2><span>Triplo Diamante</span></div>
          <div className="pl-leaderboard">
            {visibleGeneralRanking.length ? visibleGeneralRanking.map((item, index) => (
              <div key={item.userId} className={`pl-leader-row ${item.userId === user?.uid ? 'is-me' : ''}`}>
                <div className="pl-rank-num">#{item.rank || index + 1}</div>
                <div className="pl-athlete"><img className="pl-avatar" src={item.userPhoto || '/avatar-placeholder.png'} alt="" /><div><b>{item.userId === user?.uid ? 'Você' : item.userName || 'Atleta'}</b><small>S {formatNumber(item.scores.supino || 0)} · A {formatNumber(item.scores.agachamento || 0)} · T {formatNumber(item.scores.terra || 0)}{item.defendingMaster ? ' · 👑 defesa' : ''}</small></div></div>
                <div className="pl-leader-points"><strong>{formatNumber(item.competitiveScore)} pts</strong><small>{item.defendingMaster ? `real ${formatNumber(item.rawScore)} · 0,95×` : 'total'}</small></div>
              </div>
            )) : <div className="pl-card" style={{ padding: 18, color: '#9d9da5' }}>Ainda não há atletas Triplo Diamante participando.</div>}
          </div>
        </section>
        <div className="pl-warning"><CalendarDays size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />A cada 30 dias o competitivo recomeça. Campeões da temporada anterior defendem o título com 0,97× na modalidade e o Master com 0,95× no Geral; os fatores não se acumulam.</div>
        {!preview ? <button className="pl-secondary" type="button" disabled={optInBusy} onClick={() => void updateOptIn('general', false)}>Sair do Ranking Geral</button> : null}
        {loadError ? <p className="pl-error">{loadError}</p> : null}
      </>
    );
  };

  const Processing = () => (
    <>
      <Header title="VALIDANDO" accent="MARCA" />
      <section className="pl-message-card"><div className="pl-spinner" /><h2>Enviando sua marca</h2><p>Upload {uploadProgress}% · o vídeo será preservado mesmo se a conexão oscilar após o envio.</p></section>
    </>
  );

  const Submitted = () => (
    <>
      <Header title="MARCA" accent="REGISTRADA" />
      <section className="pl-message-card"><ShieldCheck size={42} /><h2>Registro recebido</h2><p>{submissionMessage || 'Sua marca foi recebida e está seguindo o fluxo de validação.'}</p><button className="pl-primary" type="button" onClick={() => { void loadData(); setView('modality'); }}>Voltar para {selectedMeta.short}</button></section>
    </>
  );

  return (
    <main className="pl-season">
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
    </main>
  );
}
