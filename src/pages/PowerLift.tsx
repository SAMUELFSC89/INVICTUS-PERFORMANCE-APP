import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock3,
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
  canEnterGeneralRanking,
  countedReps,
  heaviestSetWeight,
  nextPowerLiftTier,
  normalizeCompetitionSex,
  powerLiftDateKey,
  resolvePowerLiftSeason,
  setPowerVolume,
  type PowerLiftExercise,
  type PowerLiftSetInput,
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
  powerVolume?: number;
  seasonScore?: number;
  seasonTier?: PowerLiftTier;
  seasonId?: string;
  competitionSex?: PowerLiftSex;
  videoStatus?: 'approved' | 'manual_review' | 'rejected' | string;
  videoUrl?: string;
  userMessage?: string;
  motives?: string[];
  date?: string;
  createdAt?: string;
};

type ModalityMeta = {
  id: Exercise;
  title: string;
  short: string;
  image: string;
};

type SeriesDraft = { weight: string; reps: string };

const modalities: ModalityMeta[] = [
  { id: 'supino', title: 'SUPINO', short: 'Supino', image: '/powerlift-supino.jpg' },
  { id: 'agachamento', title: 'AGACHAMENTO LIVRE', short: 'Agachamento', image: '/powerlift-agachamento.jpg' },
  { id: 'terra', title: 'LEVANTAMENTO TERRA', short: 'Terra', image: '/powerlift-terra.jpg' },
];

const tierByQualifiedDays: PowerLiftTier[] = ['UNRANKED', 'FERRO', 'BRONZE', 'PRATA', 'OURO', 'PLATINA', 'DIAMANTE'];
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

/**
 * Preserva a proteção ACT-09 do fluxo anterior: se a resposta do submit se
 * perde depois da transação, reenviamos a mesma referência de vídeo. O
 * servidor continua idempotente pelo path do Storage.
 */
export async function reconcilePowerLiftSubmission(
  uploadedRef: StorageReference,
  exercise: Exercise,
  weight: number,
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
        body: JSON.stringify({ exercise, weight, videoUrl }),
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

function recordTimestamp(row: RecordRow) {
  const raw = row.createdAt || row.date || '';
  const value = new Date(raw).getTime();
  return Number.isFinite(value) ? value : 0;
}

function isInsideSeason(row: RecordRow, startsAt: string, endsAt: string) {
  if (row.seasonId) return true;
  const time = recordTimestamp(row);
  return time >= new Date(startsAt).getTime() && time < new Date(endsAt).getTime();
}

function formatNumber(value: number, maximumFractionDigits = 0) {
  return value.toLocaleString('pt-BR', { maximumFractionDigits });
}

export function PowerLift() {
  const navigate = useNavigate();
  const { user } = useUser();
  const season = useMemo(() => resolvePowerLiftSeason(), []);
  const competitionSex = normalizeCompetitionSex(user?.sex);
  const preview = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('preview') === '1';

  const [view, setView] = useState<View>('home');
  const [selected, setSelected] = useState<Exercise>('supino');
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [myRecords, setMyRecords] = useState<RecordRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [series, setSeries] = useState<SeriesDraft[]>(emptySeries);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [submissionError, setSubmissionError] = useState('');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [submissionMessage, setSubmissionMessage] = useState('');
  const [generalOptIn, setGeneralOptIn] = useState(false);

  const loadRecords = async () => {
    setLoading(true);
    setLoadError('');
    try {
      const firebaseUser = auth.currentUser;
      if (!firebaseUser) throw new Error('Usuário não autenticado.');
      const token = await firebaseUser.getIdToken();
      const headers = { Authorization: `Bearer ${token}` };
      const [rankingResponse, mineResponse] = await Promise.all([
        fetch(`${API_CONFIG.baseUrl}/api/powerlift?action=ranking&limit=100`, { headers }),
        fetch(`${API_CONFIG.baseUrl}/api/powerlift?action=me`, { headers }),
      ]);
      const [rankingPayload, minePayload] = await Promise.all([
        rankingResponse.json().catch(() => ({})),
        mineResponse.json().catch(() => ({})),
      ]);
      if (!rankingResponse.ok || !mineResponse.ok) {
        throw new Error(rankingPayload.error || minePayload.error || 'Não foi possível carregar o Power Lift.');
      }
      setRecords(Array.isArray(rankingPayload.records) ? rankingPayload.records as RecordRow[] : []);
      setMyRecords(Array.isArray(minePayload.records) ? minePayload.records as RecordRow[] : []);
    } catch (error: any) {
      console.warn('[PowerLift] Falha ao carregar dados:', error);
      setLoadError(error?.message || 'Não foi possível carregar o Power Lift.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadRecords(); }, [user?.uid]);

  const approvedSeasonRecords = useMemo(() => myRecords
    .filter((row) => row.videoStatus === 'approved')
    .filter((row) => row.seasonId ? row.seasonId === season.id : isInsideSeason(row, season.startsAt, season.endsAt)),
  [myRecords, season]);

  const modalityStats = useMemo(() => {
    const result = {} as Record<Exercise, {
      tier: PowerLiftTier;
      bestVolume: number;
      bestWeight: number;
      score: number;
      qualifiedDays: number;
      todayUsed: boolean;
      history: RecordRow[];
    }>;

    for (const modality of modalities) {
      const rows = approvedSeasonRecords
        .filter((row) => row.exercise === modality.id)
        .sort((a, b) => recordTimestamp(b) - recordTimestamp(a));
      const distinctDays = new Set(rows.map((row) => row.date || powerLiftDateKey(new Date(row.createdAt || Date.now())))).size;
      const serverTier = rows.find((row) => row.seasonTier)?.seasonTier;
      const fallbackTier = tierByQualifiedDays[Math.min(6, distinctDays)] || 'UNRANKED';
      const bestVolume = rows.reduce((best, row) => Math.max(best, Number(row.powerVolume ?? row.weight) || 0), 0);
      const bestWeight = rows.reduce((best, row) => Math.max(best, Number(row.weight) || 0), 0);
      const serverScore = rows.reduce((best, row) => Math.max(best, Number(row.seasonScore) || 0), 0);
      result[modality.id] = {
        tier: preview ? (modality.id === 'supino' ? 'OURO' : modality.id === 'agachamento' ? 'PLATINA' : 'DIAMANTE') : (serverTier || fallbackTier),
        bestVolume: preview ? (modality.id === 'supino' ? 1420 : modality.id === 'agachamento' ? 2180 : 2460) : bestVolume,
        bestWeight: preview ? (modality.id === 'supino' ? 180 : modality.id === 'agachamento' ? 220 : 250) : bestWeight,
        score: preview ? (modality.id === 'supino' ? 2180 : modality.id === 'agachamento' ? 2410 : 2360) : (serverScore || bestVolume),
        qualifiedDays: preview ? (modality.id === 'supino' ? 4 : modality.id === 'agachamento' ? 5 : 6) : distinctDays,
        todayUsed: rows.some((row) => (row.date || '') === powerLiftDateKey()),
        history: rows,
      };
    }
    return result;
  }, [approvedSeasonRecords, preview]);

  const tiers = useMemo(() => ({
    supino: modalityStats.supino.tier,
    agachamento: modalityStats.agachamento.tier,
    terra: modalityStats.terra.tier,
  }), [modalityStats]);

  const diamondCount = Object.values(tiers).filter((tier) => tier === 'DIAMANTE').length;
  const generalEligible = canEnterGeneralRanking(tiers) || preview;
  const generalScore = Object.values(modalityStats).reduce((sum, stat) => sum + stat.score, 0);
  const selectedMeta = modalities.find((item) => item.id === selected) || modalities[0];
  const selectedStats = modalityStats[selected];
  const sexLabel = competitionSex === 'female' ? 'Categoria feminina' : competitionSex === 'male' ? 'Categoria masculina' : 'Categoria competitiva pendente';

  const publicRanking = useMemo(() => {
    const filtered = records
      .filter((row) => row.exercise === selected && row.videoStatus === 'approved')
      .filter((row) => !competitionSex || row.competitionSex === competitionSex)
      .sort((a, b) => Number(b.seasonScore ?? b.powerVolume ?? b.weight) - Number(a.seasonScore ?? a.powerVolume ?? a.weight));
    const seen = new Set<string>();
    const unique = filtered.filter((row) => {
      if (seen.has(row.userId)) return false;
      seen.add(row.userId);
      return true;
    });
    if (!preview) return unique.slice(0, 20);
    const names = ['Bruno Almeida', 'Felipe Souza', 'Lucas Carvalho', user?.displayName || 'Você', 'Rafael Mendes', 'Gabriel Pereira', 'Matheus Torres', 'Diego Santos'];
    return names.map((name, index) => ({
      id: `preview-${index}`,
      userId: index === 3 ? user?.uid || 'me' : `preview-${index}`,
      userName: name,
      exercise: selected,
      weight: 220 - index * 5,
      powerVolume: 1720 - index * 40,
      seasonScore: 2820 - index * 90,
      competitionSex: competitionSex || 'male',
      videoStatus: 'approved',
    } as RecordRow));
  }, [records, selected, competitionSex, preview, user?.uid, user?.displayName]);

  const generalRanking = useMemo(() => {
    if (!preview) {
      const athletes = new Map<string, { row: RecordRow; scores: Partial<Record<Exercise, number>> }>();
      for (const row of records.filter((item) => item.videoStatus === 'approved' && (!competitionSex || item.competitionSex === competitionSex))) {
        const current = athletes.get(row.userId) || { row, scores: {} };
        const score = Number(row.seasonScore ?? row.powerVolume ?? row.weight) || 0;
        current.scores[row.exercise] = Math.max(current.scores[row.exercise] || 0, score);
        athletes.set(row.userId, current);
      }
      return [...athletes.values()]
        .map(({ row, scores }) => ({ row, score: (scores.supino || 0) + (scores.agachamento || 0) + (scores.terra || 0), scores }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 20);
    }
    const names = ['Bruno Almeida', 'Felipe Souza', 'Lucas Carvalho', user?.displayName || 'Você', 'Rafael Mendes', 'Gabriel Pereira', 'Matheus Torres', 'Diego Santos'];
    return names.map((name, index) => ({
      row: { id: `general-${index}`, userId: index === 3 ? user?.uid || 'me' : `g-${index}`, userName: name, exercise: 'supino', weight: 0 } as RecordRow,
      score: 8420 - index * 430,
      scores: { supino: 2810 - index * 80, agachamento: 2920 - index * 110, terra: 2690 - index * 90 },
    }));
  }, [records, competitionSex, preview, user?.uid, user?.displayName]);

  const parsedSeries: PowerLiftSetInput[] = useMemo(() => series.map((item) => ({
    weight: Number(item.weight) || 0,
    reps: Number(item.reps) || 0,
  })), [series]);
  const calculatedVolume = calculatePowerVolume(parsedSeries);
  const declaredWeight = heaviestSetWeight(parsedSeries);

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
    if (declaredWeight <= 0 || calculatedVolume <= 0) {
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
          series: parsedSeries.filter((item) => item.weight > 0 && item.reps > 0).map((item) => ({ ...item, reps: countedReps(item.reps) })),
          powerVolume: calculatedVolume,
          seasonId: season.id,
          competitionSex,
          dateKey: powerLiftDateKey(),
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
            setRecords((current) => [audited, ...current.filter((item) => item.id !== audited.id)]);
            setSubmissionMessage('Marca aprovada. Seu progresso da temporada foi atualizado.');
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
        const outcome = await reconcilePowerLiftSubmission(uploadedRef, selected, declaredWeight);
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
        <div className="pl-eyebrow"><BarChart3 size={14} /> Pontuação geral da temporada</div>
        <div className="pl-score">
          <strong>{formatNumber(generalScore)} pts</strong>
          <small>Histórico permanente preservado</small>
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
                  <p>Power Volume: <b>{stat.bestVolume ? `${formatNumber(stat.bestVolume)} kg` : '—'}</b> · {formatNumber(stat.score)} pts</p>
                  <div className="pl-modality-meta">
                    <span className={`pl-tier ${stat.tier === 'DIAMANTE' ? 'pl-tier--diamond' : ''}`}><Diamond size={11} /> {tierLabel(stat.tier)}</span>
                    <div className="pl-progress" aria-label="Progresso de categoria"><span style={{ width: `${progress}%` }} /></div>
                  </div>
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
            const open = canEnterEliteRanking(modalityStats[modality.id].tier);
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
                <p>{open ? 'Disponível para participação' : 'Alcance Diamante para liberar'}</p>
              </button>
            );
          })}
        </div>
        <button
          type="button"
          className="pl-card pl-general-card"
          onClick={() => generalEligible && setView(generalOptIn ? 'general' : 'unlock')}
        >
          <Crown size={26} />
          <div>
            <h3>Ranking Geral Power Lift</h3>
            <p>{generalEligible ? 'Triplo Diamante conquistado. Seu score acumulado já está pronto.' : `${diamondCount}/3 modalidades em Diamante`}</p>
          </div>
          <ChevronRight className="pl-chevron" size={19} />
        </button>
      </section>
      {loadError ? <p className="pl-error">{loadError}</p> : null}
    </>
  );

  const Modality = () => {
    const nextTier = nextPowerLiftTier(selectedStats.tier);
    const latest = selectedStats.history.slice(0, 4);
    return (
      <>
        <Header title={selectedMeta.title} subtitle={`${sexLabel} · 1 marca oficial por dia`} />
        <section className="pl-hero">
          <div className="pl-eyebrow"><Medal size={14} /> Minha marca da temporada</div>
          <div className="pl-stat-grid">
            <div className="pl-stat"><small>Power Volume</small><strong>{selectedStats.bestVolume ? `${formatNumber(selectedStats.bestVolume)} kg` : '—'}</strong></div>
            <div className="pl-stat"><small>Pontuação</small><strong>{formatNumber(selectedStats.score)} pts</strong></div>
            <div className="pl-stat"><small>Categoria</small><strong>{tierLabel(selectedStats.tier)}</strong></div>
          </div>
          <small>Melhor carga da temporada: {selectedStats.bestWeight ? `${formatNumber(selectedStats.bestWeight)} kg` : '—'}</small>
        </section>

        <section className="pl-section">
          <div className="pl-section-head"><h2>Evolução da temporada</h2><span>máximo 1 avanço/dia</span></div>
          <div className="pl-tier-track">
            {POWER_LIFT_TIER_ORDER.slice(1).map((tier) => {
              const activeIndex = POWER_LIFT_TIER_ORDER.indexOf(selectedStats.tier);
              const currentIndex = POWER_LIFT_TIER_ORDER.indexOf(tier);
              return <div key={tier} className={`pl-tier-step ${currentIndex <= activeIndex ? 'done' : ''} ${tier === selectedStats.tier ? 'current' : ''}`}><i>{currentIndex <= activeIndex ? '✓' : '•'}</i>{tier}</div>;
            })}
          </div>
          <div className="pl-card" style={{ padding: 16 }}>
            <div className="pl-eyebrow"><Zap size={13} /> Próximo objetivo</div>
            <p style={{ marginBottom: 0 }}>{nextTier ? `Valide uma nova marca elegível em outro dia para avançar rumo a ${nextTier}.` : 'Diamante conquistado. Agora cada melhora da sua melhor marca pode mexer no ranking.'}</p>
          </div>
        </section>

        <section className="pl-section">
          <div className="pl-section-head"><h2>Resumo da regra</h2></div>
          <div className="pl-rules">
            <div className="pl-rule-card"><Dumbbell size={17} /> Até 3 séries válidas</div>
            <div className="pl-rule-card"><BarChart3 size={17} /> Até 5 reps por série</div>
            <div className="pl-rule-card"><Clock3 size={17} /> 1 marca oficial por dia</div>
            <div className="pl-rule-card"><Trophy size={17} /> Só melhora aumenta o ranking</div>
          </div>
        </section>

        <section className="pl-section">
          <div className="pl-section-head"><h2>Últimas marcas oficiais</h2><span>histórico da temporada</span></div>
          <div className="pl-history">
            {latest.length ? latest.map((row) => (
              <div className="pl-history-row" key={row.id}>
                <small>{row.date || '—'}</small>
                <b>{formatNumber(Number(row.powerVolume ?? row.weight) || 0)} kg</b>
                <small>{row.videoStatus === 'approved' ? 'Validada' : row.videoStatus}</small>
              </div>
            )) : <div className="pl-card" style={{ padding: 16, color: '#9d9da5' }}>Nenhuma marca homologada nesta temporada.</div>}
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
        <div className="pl-score"><strong>{selectedStats.bestVolume ? `${formatNumber(selectedStats.bestVolume)} kg` : '—'}</strong><small>só aumenta o score se superar sua melhor marca</small></div>
      </section>

      <section className="pl-section">
        <div className="pl-section-head"><h2>Séries válidas do Power Lift</h2><span>máximo 3</span></div>
        {series.map((item, index) => {
          const parsed = parsedSeries[index];
          return (
            <div className="pl-form-card" key={index}>
              <div className="pl-form-card-head"><b>Série {index + 1}</b><small>reps acima de 5 contam como 5</small></div>
              <div className="pl-form-grid">
                <div className="pl-field"><label>Carga (kg)</label><input inputMode="decimal" value={item.weight} onChange={(event) => setSeries((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, weight: event.target.value } : row))} placeholder="0" /></div>
                <div className="pl-field"><label>Repetições</label><input inputMode="numeric" value={item.reps} onChange={(event) => setSeries((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, reps: event.target.value } : row))} placeholder="0" /></div>
                <div className="pl-volume"><small>Volume</small><strong>{formatNumber(setPowerVolume(parsed))} kg</strong></div>
              </div>
            </div>
          );
        })}
      </section>

      <section className="pl-card" style={{ padding: 18, marginTop: 14 }}>
        <div className="pl-eyebrow"><BarChart3 size={14} /> Power Volume calculado</div>
        <div className="pl-score"><strong>{formatNumber(calculatedVolume)} kg</strong><small>maior carga: {formatNumber(declaredWeight)} kg</small></div>
      </section>

      <div className="pl-upload">
        <input id="powerlift-season-video" type="file" accept="video/*" capture="environment" onChange={(event) => setVideoFile(event.target.files?.[0] || null)} />
        <label htmlFor="powerlift-season-video"><Video size={24} /> {videoFile ? videoFile.name : 'Anexar vídeo completo da marca'}<small>obrigatório para validação</small></label>
      </div>

      <div className="pl-warning"><Info size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />Se a marca não superar sua melhor performance da temporada, ela fica no histórico, mas não aumenta o ranking.</div>
      {submissionError ? <p className="pl-error">{submissionError}</p> : null}
      <button className="pl-primary" type="button" onClick={() => void submitMark()}><Upload size={18} /> Enviar para validação</button>
    </>
  );

  const EliteRanking = () => (
    <>
      <Header title="RANKING ELITE" accent={selectedMeta.short.toUpperCase()} subtitle={`${sexLabel} · Diamante obrigatório`} />
      <section className="pl-hero">
        <div className="pl-eyebrow"><Diamond size={14} /> Status Elite</div>
        <div className="pl-score"><strong>{formatNumber(selectedStats.score)} pts</strong><small>{canEnterEliteRanking(selectedStats.tier) ? 'Você está elegível para este ranking.' : 'Alcance Diamante para participar.'}</small></div>
      </section>
      <section className="pl-section">
        <div className="pl-section-head"><h2>Ranking da temporada</h2><span>score acumulado desde o primeiro registro</span></div>
        <div className="pl-leaderboard">
          {publicRanking.length ? publicRanking.map((row, index) => {
            const score = Number(row.seasonScore ?? row.powerVolume ?? row.weight) || 0;
            return (
              <div key={row.id} className={`pl-leader-row ${row.userId === user?.uid ? 'is-me' : ''}`}>
                <div className="pl-rank-num">#{index + 1}</div>
                <div className="pl-athlete"><img className="pl-avatar" src={row.userPhoto || '/avatar-placeholder.png'} alt="" /><div><b>{row.userId === user?.uid ? 'Você' : row.userName || 'Atleta'}</b><small>{formatNumber(Number(row.powerVolume ?? row.weight) || 0)} kg Power Volume</small></div></div>
                <div className="pl-leader-points"><strong>{formatNumber(score)} pts</strong><small>temporada</small></div>
              </div>
            );
          }) : <div className="pl-card" style={{ padding: 18, color: '#9d9da5' }}>Ainda não há atletas elegíveis nesta categoria.</div>}
        </div>
      </section>
      <div className="pl-warning">A pontuação não começa no Diamante. Ela vem sendo construída desde a primeira marca válida da temporada.</div>
    </>
  );

  const Unlock = () => (
    <>
      <Header title="TRIPLO" accent="DIAMANTE" subtitle="Supino + Agachamento + Terra" />
      <section className="pl-card pl-unlock">
        <div className="pl-unlock-icon"><Crown size={42} /></div>
        <h2>Ranking Geral desbloqueado</h2>
        <p>Você não começa do zero. Toda a pontuação conquistada desde o primeiro registro válido da temporada já entra no ranking geral.</p>
        <div className="pl-score" style={{ justifyContent: 'center' }}><strong>{formatNumber(generalScore)} pts</strong></div>
        <div className="pl-breakdown">
          {modalities.map((modality) => <div key={modality.id}><small>{modality.title}</small><b>{formatNumber(modalityStats[modality.id].score)} pts</b></div>)}
        </div>
        <button className="pl-primary" type="button" onClick={() => { setGeneralOptIn(true); setView('general'); }}><Crown size={18} /> Participar do ranking geral</button>
        <button className="pl-secondary" type="button" onClick={() => setView('home')}>Agora não</button>
      </section>
    </>
  );

  const GeneralRanking = () => {
    const myIndex = generalRanking.findIndex((item) => item.row.userId === user?.uid);
    return (
      <>
        <Header title="RANKING GERAL" accent="POWER LIFT" subtitle={`${sexLabel} · Temporada ${season.number}`} />
        <section className="pl-hero">
          <div className="pl-eyebrow"><Crown size={14} /> Sua posição atual</div>
          <div className="pl-score"><strong>{myIndex >= 0 ? `#${myIndex + 1}` : '—'} · {formatNumber(generalScore)} pts</strong><small>{season.daysRemaining} dias restantes</small></div>
        </section>
        <section className="pl-section">
          <div className="pl-section-head"><h2>Classificação geral</h2><span>Triplo Diamante</span></div>
          <div className="pl-leaderboard">
            {generalRanking.map((item, index) => (
              <div key={item.row.id} className={`pl-leader-row ${item.row.userId === user?.uid ? 'is-me' : ''}`}>
                <div className="pl-rank-num">#{index + 1}</div>
                <div className="pl-athlete"><img className="pl-avatar" src={item.row.userPhoto || '/avatar-placeholder.png'} alt="" /><div><b>{item.row.userId === user?.uid ? 'Você' : item.row.userName || 'Atleta'}</b><small>S {formatNumber(item.scores.supino || 0)} · A {formatNumber(item.scores.agachamento || 0)} · T {formatNumber(item.scores.terra || 0)}</small></div></div>
                <div className="pl-leader-points"><strong>{formatNumber(item.score)} pts</strong><small>total</small></div>
              </div>
            ))}
          </div>
        </section>
        <div className="pl-warning"><CalendarDays size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />A cada 30 dias a classificação competitiva recomeça. O histórico permanente do atleta continua salvo.</div>
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
      <section className="pl-message-card"><ShieldCheck size={42} /><h2>Registro recebido</h2><p>{submissionMessage || 'Sua marca foi recebida e está seguindo o fluxo de validação.'}</p><button className="pl-primary" type="button" onClick={() => { void loadRecords(); setView('modality'); }}>Voltar para {selectedMeta.short}</button></section>
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
