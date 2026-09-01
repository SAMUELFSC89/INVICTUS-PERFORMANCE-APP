import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Award, CheckCircle2, ChevronRight, Dumbbell, FileVideo, ShieldCheck, Trophy, Upload, Users, Video, Camera, CircleX, Filter, Minus, Plus, Check, TrendingUp, Star, UserRound } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { auth, storage } from '../firebase';
import { deleteObject, getDownloadURL, ref, uploadBytesResumable, type StorageReference } from 'firebase/storage';
import { useUser } from '../UserContext';
import { validationService } from '../services/validationService';
import { API_CONFIG } from '../config';
import { InvictusLogo } from '../components/InvictusLogo';
import './PowerLiftNew.css';

type Exercise = 'supino' | 'agachamento' | 'terra';
type RecordRow = { id: string; userId: string; userName?: string; userPhoto?: string; gymId?: string; gymName?: string; exercise: Exercise; weight: number; videoStatus?: 'approved' | 'manual_review' | 'rejected' | string; videoUrl?: string; userMessage?: string; motives?: string[]; date?: string; createdAt?: string };
const exercises: Array<{ id: Exercise; title: string; shortTitle?: string; accent: string; image: string; icon: React.ReactNode }> = [
  { id: 'supino', title: 'SUPINO RETO', shortTitle: 'SUPINO', accent: 'gold', image: '/powerlift-supino.jpg', icon: <Dumbbell /> },
  { id: 'agachamento', title: 'AGACHAMENTO LIVRE', shortTitle: 'AGACHAMENTO', accent: 'green', image: '/powerlift-agachamento.jpg', icon: <Award /> },
  { id: 'terra', title: 'LEVANTAMENTO TERRA', shortTitle: 'LEV. TERRA', accent: 'violet', image: '/powerlift-terra.jpg', icon: <Dumbbell /> },
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
    const seek = () => { video.currentTime = Math.min(duration - 0.05, Math.max(0.05, duration * ((step + 1) / (targetFrames + 1)))); };
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

export function PowerLift() {
  const navigate = useNavigate();
  const { user } = useUser();
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [myRecords, setMyRecords] = useState<RecordRow[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [modal, setModal] = useState<'rules' | 'videos' | null>(null);
  const [selected, setSelected] = useState<Exercise>('supino');
  const [view, setView] = useState<'home'|'ranking'|'register'|'record'|'processing'|'manual-review'|'approved'|'rejected'|'rules'>('home');
  const [weight, setWeight] = useState(0);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [reasons, setReasons] = useState<string[]>([]);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [playingRecord, setPlayingRecord] = useState<RecordRow | null>(null);
  const [playbackUrl, setPlaybackUrl] = useState('');
  const [playbackError, setPlaybackError] = useState('');
  const [playbackLoading, setPlaybackLoading] = useState(false);
  useEffect(() => {
    let mounted = true;
    const loadRecords = async () => {
      setLoadError(false);
      try {
        const firebaseUser = auth.currentUser;
        if (!firebaseUser) throw new Error('Usuário não autenticado.');
        const token = await firebaseUser.getIdToken();
        const headers = { Authorization: `Bearer ${token}` };
        const [rankingResponse, mineResponse] = await Promise.all([
          fetch(`${API_CONFIG.baseUrl}/api/powerlift?action=ranking&limit=100`, { headers }),
          fetch(`${API_CONFIG.baseUrl}/api/powerlift?action=me`, { headers })
        ]);
        const [rankingPayload, minePayload] = await Promise.all([
          rankingResponse.json().catch(() => ({})),
          mineResponse.json().catch(() => ({}))
        ]);
        if (!rankingResponse.ok || !mineResponse.ok) {
          throw new Error(rankingPayload.error || minePayload.error || 'Não foi possível carregar os levantamentos.');
        }
        if (!mounted) return;
        setRecords(Array.isArray(rankingPayload.records) ? rankingPayload.records as RecordRow[] : []);
        setMyRecords(Array.isArray(minePayload.records) ? minePayload.records as RecordRow[] : []);
      } catch (error) {
        console.warn('[PowerLift] Não foi possível carregar registros homologados:', error);
        if (!mounted) return;
        setRecords([]);
        setMyRecords([]);
        setLoadError(true);
      } finally {
      }
    };
    void loadRecords();
    return () => { mounted = false; };
  }, [user?.uid]);
  const byExercise = (id: Exercise) => records.filter(row => row.exercise === id).sort((a,b) => b.weight-a.weight);
  const personalBest = (id: Exercise) => byExercise(id).find(row => row.userId === user?.uid)?.weight ?? null;
  // Ranking geral por atleta: soma somente a melhor marca homologada de cada
  // modalidade. O código anterior ordenava vídeos isolados e permitia que a
  // mesma pessoa ocupasse duas ou três posições do pódio.
  const top = useMemo(() => {
    const athletes = new Map<string, { row: RecordRow; best: Partial<Record<Exercise, number>> }>();
    for (const record of records) {
      const current = athletes.get(record.userId) || { row: record, best: {} };
      current.best[record.exercise] = Math.max(current.best[record.exercise] || 0, Number(record.weight) || 0);
      athletes.set(record.userId, current);
    }
    return [...athletes.values()]
      .map(({ row, best }) => ({ ...row, weight: Object.values(best).reduce((sum, value) => sum + (value || 0), 0) }))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 3);
  }, [records]);
  const athleteCount = useMemo(() => new Set(records.map((row) => row.userId).filter(Boolean)).size, [records]);
  const approvedCount = useMemo(() => myRecords.filter(row => row.videoStatus === 'approved').length, [myRecords]);
  const approvalRate = useMemo(() => myRecords.length ? `${Math.round((approvedCount / myRecords.length) * 100)}%` : '—', [myRecords.length, approvedCount]);
  const homologatedLoad = useMemo(() => {
    const best = new Map<Exercise, number>();
    for (const row of myRecords.filter(record => record.videoStatus === 'approved')) {
      best.set(row.exercise, Math.max(best.get(row.exercise) || 0, Number(row.weight) || 0));
    }
    const totalKg = [...best.values()].reduce((sum, value) => sum + value, 0);
    return totalKg > 0 ? `${totalKg.toLocaleString('pt-BR')} kg` : '—';
  }, [myRecords]);

  const stat = (label: string, icon: React.ReactNode, value: React.ReactNode, isHighlighted = false) => (
    <article className={`power-stat ${isHighlighted ? 'is-highlighted' : ''}`}>
      <span>{icon}</span>
      <small>{label}</small>
      <b>{value}</b>
    </article>
  );

  const submitVideo = async () => {
    if (!user || !videoFile) return;
    if (!videoFile.type.startsWith('video/')) {
      setSubmissionError('Selecione um arquivo de vídeo válido.');
      return;
    }
    if (videoFile.size <= 0 || videoFile.size > 100 * 1024 * 1024) {
      setSubmissionError('O vídeo deve ter no máximo 100 MB.');
      return;
    }
    setSubmissionError(null);
    setReasons([]);
    setUploadProgress(0);
    setView('processing');

    let uploadedRef: StorageReference | null = null;
    let recordPersisted = false;
    try {
      const safeFileName = videoFile.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = ref(storage, `power_records/${user.uid}/${Date.now()}_${safeFileName}`);
      const uploadTask = uploadBytesResumable(path, videoFile, { contentType: videoFile.type });
      const uploaded = await new Promise<typeof uploadTask.snapshot>((resolve, reject) => {
        const timeout = window.setTimeout(() => {
          uploadTask.cancel();
          reject(new Error('O envio demorou demais. Verifique a conexão e tente novamente; nenhum registro foi criado.'));
        }, 15 * 60 * 1000);
        uploadTask.on('state_changed',
          (snapshot) => setUploadProgress(Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100)),
          (error) => { window.clearTimeout(timeout); reject(error); },
          () => { window.clearTimeout(timeout); resolve(uploadTask.snapshot); }
        );
      });
      uploadedRef = uploaded.ref;
      const videoUrl = await getDownloadURL(uploadedRef);

      const token = await Promise.race([
        auth.currentUser?.getIdToken(),
        new Promise<undefined>((resolve) => window.setTimeout(() => resolve(undefined), 12000))
      ]);
      if (!token) throw new Error('Sua sessão expirou. Entre novamente para enviar o vídeo.');

      const controller = new AbortController();
      const requestTimeout = window.setTimeout(() => controller.abort(), 30000);
      const response = await fetch(`${API_CONFIG.baseUrl}/api/powerlift?action=submit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          exercise: selected,
          weight,
          videoUrl
        }),
        signal: controller.signal
      });
      window.clearTimeout(requestTimeout);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.record) {
        throw new Error(payload?.error || 'Não foi possível registrar o levantamento agora.');
      }

      const pendingRecord = payload.record as RecordRow;
      recordPersisted = true;
      setMyRecords((current) => [pendingRecord, ...current.filter((item) => item.id !== pendingRecord.id)]);
      setView('manual-review');
      setVideoFile(null);
      setUploadProgress(100);

      // O atleta já pode sair desta tela: o registro está seguro e aparece
      // como "em análise". A decisão da IA é aplicada depois, sem segurar o
      // upload nem fingir uma aprovação local.
      const frames = await framesFromVideo(videoFile);
      const validation = await validationService.validatePowerVideo(frames, selected, weight);
      if (!validation.validationId) return;

      const auditResponse = await fetch(`${API_CONFIG.baseUrl}/api/powerlift?action=finalize-audit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ recordId: pendingRecord.id, validationId: validation.validationId })
      });
      const auditPayload = await auditResponse.json().catch(() => ({}));
      if (!auditResponse.ok || !auditPayload.record) return;

      const auditedRecord = auditPayload.record as RecordRow;
      const serverReasons = Array.isArray(auditedRecord.motives) && auditedRecord.motives.length
        ? auditedRecord.motives
        : auditedRecord.userMessage ? [auditedRecord.userMessage] : [];
      setReasons(serverReasons);
      setMyRecords((current) => [auditedRecord, ...current.filter((item) => item.id !== auditedRecord.id)]);
      if (auditPayload.decision === 'approved') {
        setRecords((current) => [auditedRecord, ...current.filter((item) => item.id !== auditedRecord.id)]);
        setView('approved');
      } else if (auditPayload.decision === 'rejected') {
        setView('rejected');
      }
    } catch (error: any) {
      console.warn('[PowerLift] Falha no envio seguro:', error);
      if (uploadedRef && !recordPersisted) {
        await deleteObject(uploadedRef).catch((cleanupError) => console.warn('[PowerLift] Falha ao remover upload incompleto:', cleanupError));
      }
      if (recordPersisted) {
        // A falha ocorreu só na auditoria automática. O upload permanece no
        // histórico para revisão manual; não voltamos para uma tela de erro.
        return;
      }
      const message = error?.name === 'AbortError'
        ? 'O servidor demorou demais para concluir. Tente novamente; nenhum levantamento foi registrado.'
        : error?.message;
      setSubmissionError(message || 'Não foi possível concluir o envio. Tente novamente com conexão estável.');
      setView('record');
    }
  };

  const openVideo = async (record: RecordRow) => {
    setPlayingRecord(record);
    setPlaybackUrl('');
    setPlaybackError('');
    setPlaybackLoading(true);
    try {
      const firebaseUser = auth.currentUser;
      if (!firebaseUser) throw new Error('Entre novamente para assistir ao vídeo.');
      const token = await firebaseUser.getIdToken();
      const response = await fetch(`${API_CONFIG.baseUrl}/api/powerlift?action=video&id=${encodeURIComponent(record.id)}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.url) throw new Error(payload.error || 'Não foi possível abrir este vídeo.');
      setPlaybackUrl(payload.url);
    } catch (error: any) {
      setPlaybackError(error?.message || 'Não foi possível abrir este vídeo agora.');
    } finally {
      setPlaybackLoading(false);
    }
  };

  // Close modal on Escape
  useEffect(() => {
    if (!modal) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setModal(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [modal]);

  const backFromFlow = () => {
    if (view === 'processing') return;
    if (view === 'record') {
      setView('register');
      return;
    }
    setView('home');
  };

  if (view !== 'home') return createPortal(<>
    <PowerLiftFlow view={view} exercise={selected} records={records} userId={user?.uid} userGymId={user?.gymId} weight={weight} setWeight={setWeight} videoFile={videoFile} reasons={reasons} submissionError={submissionError} uploadProgress={uploadProgress} onFile={setVideoFile} onSubmit={submitVideo} onBack={backFromFlow} onView={setView} onExercise={setSelected} onPlayVideo={openVideo} />
    {playingRecord && <VideoPlaybackOverlay record={playingRecord} url={playbackUrl} loading={playbackLoading} error={playbackError} onClose={()=>setPlayingRecord(null)} />}
  </>, document.body);

  return createPortal(<main className="power-screen">
    <header className="power-header">
      <button onClick={()=>navigate('/challenges')} aria-label="Voltar"><ArrowLeft /></button>
      <div>
        <h1>DESAFIO DE FORÇA <em>PRO</em></h1>
        <p>Supere seus limites. Prove sua força.</p>
      </div>
      <button className="power-rules" onClick={()=>setModal('rules')}><FileVideo /> REGRAS</button>
    </header>

    <section className="power-panel power-ranking">
      <div className="power-panel-title">
        <h2>RANKING GERAL</h2>
        <span><Users /> {athleteCount || '—'} atletas</span>
      </div>
      {loadError && <p className="power-load-error">Não foi possível carregar o ranking agora. Tente novamente em instantes.</p>}
      <div className="power-podium">
        {[1,0,2].map((rank, position) => {
          const row=top[rank];
          return <button key={rank} onClick={()=>{setSelected(row?.exercise || 'supino');setView('ranking')}} className={`power-podium-item pos-${position}`}>
            <span className="power-podium-avatar">{row?.userPhoto ? <img src={row.userPhoto} alt="" /> : <span className="power-avatar">{row?.userName?.slice(0,1) || '—'}</span>}<img className="power-podium-frame" src={`/ranking-frame-${rank === 0 ? 'gold' : rank === 1 ? 'silver' : 'bronze'}-reference.png`} alt="" aria-hidden="true" /></span>
            <i>{rank+1}</i>
            <b>{row?.userName || 'Sem registros'}</b>
            <strong>{row ? `${row.weight} kg` : '—'}</strong>
          </button>
        })}
        <ChevronRight className="power-next" />
      </div>
    </section>

    <section className="power-panel power-how">
      <h2>COMO FUNCIONA</h2>
      <div>
        {[[<Video/>, 'Grave seu vídeo', 'Execute o movimento com carga visível'],
          [<Upload/>, 'Envie para validação', 'Nossa IA analisará seu vídeo'],
          [<ShieldCheck/>, 'Validamos seu desafio', 'Garantimos justiça e integridade'],
          [<Trophy/>, 'Receba sua posição', 'Entre no ranking e acompanhe sua evolução']].map(([icon,title,text],i)=>(
          <article key={i}>
            <span>{icon}</span>
            <b>{title}</b>
            <small>{text}</small>
          </article>
        ))}
      </div>
    </section>

    <section className="power-panel power-modalities">
      <h2>MODALIDADES</h2>
      <div className="power-cards">
        {exercises.map(item => {
          const best=personalBest(item.id);
          const standing=byExercise(item.id).findIndex(row=>row.userId===user?.uid);
          return <article key={item.id} className={`power-card ${item.accent}`}>
            <div className="power-card-top">
              <span>{item.icon}</span>
              <div><b>{item.title}</b><small><i /> Ranking ativo</small></div>
            </div>
            <img src={item.image} alt={item.title}/>
            <div className="power-card-data">
              <div className="power-card-metrics">
                <span><small>SUA MELHOR MARCA</small><strong>{best ? `${best} kg` : '—'}</strong></span>
                <span><small>SUA POSIÇÃO</small><strong>{standing >= 0 ? `${standing+1}º` : '—'}</strong></span>
              </div>
              <button onClick={()=>{setSelected(item.id);setView('ranking')}}>VER RANKING</button>
            </div>
          </article>
        })}
      </div>
    </section>

    <section className="power-panel power-stats">
      <h2>SUAS ESTATÍSTICAS GERAIS</h2>
      <div>
        {stat('DESAFIOS ENVIADOS', <Trophy />, myRecords.length)}
        {stat('DESAFIOS APROVADOS', <ShieldCheck />, approvedCount)}
        {stat('TAXA DE APROVAÇÃO', <TrendingUp />, approvalRate, approvalRate !== '—')}
        {stat('CARGA HOMOLOGADA', <Star />, homologatedLoad, homologatedLoad !== '—')}
      </div>
    </section>

    <section className="power-actions">
      <button className="power-register" onClick={()=>setView('register')}>
        <Dumbbell />
        <span>
          REGISTRAR NOVO LEVANTAMENTO
          <small>Envie seu vídeo e desafie seus limites</small>
        </span>
      </button>
      <button className="power-my-videos" onClick={()=>setModal('videos')}>
        <FileVideo />
        <span>
          MEUS VÍDEOS
          <small>Ver envios e status</small>
        </span>
      </button>
    </section>

    <nav className="power-new-footer"><button onClick={() => navigate('/')}><InvictusLogo size={22} /><small>INÍCIO</small></button><button onClick={() => navigate('/championships')}><Trophy /><small>CAMPEONATOS</small></button><button className="is-plus" onClick={() => navigate('/musculacao')} aria-label="Abrir construção do treino"><Plus /></button><button className="is-active" onClick={() => navigate('/challenges')}><ShieldCheck /><small>DESAFIOS</small></button><button onClick={() => navigate('/profile')}><UserRound /><small>PERFIL</small></button></nav>

    {modal && <div className="power-overlay" onClick={()=>setModal(null)}>
      <section onClick={e=>e.stopPropagation()}>
        <div className="power-modal-header">
          <div className="power-modal-title">
            {modal === 'rules' ? <ShieldCheck className="power-modal-icon" /> : <FileVideo className="power-modal-icon" />}
            <div>
              <h2>{modal === 'rules' ? 'REGRAS DO DESAFIO' : 'MEUS VÍDEOS ENVIADOS'}</h2>
              <small>{modal === 'rules' ? 'Diretrizes oficiais para homologação no ranking' : `${myRecords.length} registro(s) no total`}</small>
            </div>
          </div>
          <button className="power-close" onClick={()=>setModal(null)} aria-label="Fechar modal">×</button>
        </div>

        {modal === 'rules' && <div className="power-rules-content">
          <div className="power-rule-box">
            <b>1. Gravação Contínua e Enquadramento</b>
            <p>Posicione a câmera na lateral ou em diagonal de modo que o corpo completo e a barra fiquem 100% visíveis durante toda a execução. Vídeos com cortes, acelerados ou com edição não são aceitos.</p>
          </div>

          <div className="power-rule-box">
            <b>2. Comprovação de Carga</b>
            <p>Mostre claramente as anilhas e a barra no início ou no fim da gravação, permitindo a checagem do peso total declarado.</p>
          </div>

          <div className="power-rule-box">
            <b>3. Critérios de Execução Válida</b>
            <ul>
              <li><strong>Supino Reto:</strong> A barra deve tocar o peito sem rebote e subir até a extensão completa dos cotovelos.</li>
              <li><strong>Agachamento Livre:</strong> O quadril deve quebrar a linha da paralela com os joelhos na fase mais baixa.</li>
              <li><strong>Levantamento Terra:</strong> Barra sai do chão em movimento contínuo até a extensão e bloqueio total de joelhos e quadril eretos.</li>
            </ul>
          </div>

          <div className="power-rule-box">
            <b>4. Auditoria e Validação</b>
            <p>Cada gravação é avaliada pela inteligência de visão computacional e equipe técnica antes de ser homologada no ranking oficial.</p>
          </div>

          <button className="power-modal-btn" onClick={()=>setModal(null)}>
            ENTENDI AS REGRAS
          </button>
        </div>}

        {modal === 'videos' && <div className="power-videos-content">
          {myRecords.length ? (
            <div className="power-videos-list">
              {myRecords.map(row => (
                <div key={row.id} className="power-video-item">
                  <div className="power-video-item-info">
                    <b>{row.exercise.toUpperCase()}</b>
                    <span>Carga informada: <strong>{row.weight} kg</strong></span>
                    {row.date && <small>Enviado em {new Date(row.date).toLocaleDateString('pt-BR')}</small>}
                  </div>
                  <span className={`power-video-badge ${row.videoStatus || 'manual_review'}`}>
                    {row.videoStatus === 'approved' ? 'Aprovado' : row.videoStatus === 'rejected' ? 'Recusado' : 'Em Revisão'}
                  </span>
                  <button className="power-watch-video" onClick={()=>void openVideo(row)}>ASSISTIR</button>
                </div>
              ))}
            </div>
          ) : (
            <div className="power-empty-videos">
              <p>Você ainda não enviou nenhum vídeo para auditoria.</p>
              <button className="power-modal-btn" onClick={()=>{setModal(null);setView('register')}}>
                REGISTRAR PRIMEIRO LEVANTAMENTO
              </button>
            </div>
          )}
        </div>}
      </section>
    </div>}
    {playingRecord && <VideoPlaybackOverlay record={playingRecord} url={playbackUrl} loading={playbackLoading} error={playbackError} onClose={()=>setPlayingRecord(null)} />}
  </main>, document.body);
}

function VideoPlaybackOverlay({ record, url, loading, error, onClose }: { record: RecordRow; url: string; loading: boolean; error: string; onClose: () => void }) {
  return <div className="power-overlay power-video-overlay" onClick={onClose}>
    <section onClick={(event)=>event.stopPropagation()}>
      <div className="power-modal-header">
        <div className="power-modal-title"><FileVideo className="power-modal-icon"/><div><h2>{record.exercise.toUpperCase()}</h2><small>{record.weight} kg · {record.userName || 'Atleta'}</small></div></div>
        <button className="power-close" onClick={onClose} aria-label="Fechar vídeo">×</button>
      </div>
      {loading && <p className="power-video-feedback">Preparando reprodução segura…</p>}
      {error && <p className="power-load-error">{error}</p>}
      {url && <video className="power-secure-player" src={url} controls playsInline preload="metadata" onError={(event)=>{(event.currentTarget as HTMLVideoElement).controls = true;}} />}
    </section>
  </div>;
}

function PowerLiftFlow({ view, exercise, records, userId, userGymId, weight, setWeight, videoFile, reasons, submissionError, uploadProgress, onFile, onSubmit, onBack, onView, onExercise, onPlayVideo }: { view:string; exercise:Exercise; records:RecordRow[]; userId?:string; userGymId?:string; weight:number; setWeight:(n:number)=>void; videoFile:File|null; reasons:string[]; submissionError:string|null; uploadProgress:number; onFile:(f:File|null)=>void; onSubmit:()=>void; onBack:()=>void; onView:(v:any)=>void; onExercise:(x:Exercise)=>void; onPlayVideo:(record:RecordRow)=>void }) {
  const item = exercises.find(x=>x.id===exercise)!; const rows = records.filter(r=>r.exercise===exercise).sort((a,b)=>b.weight-a.weight); const mine=rows.findIndex(r=>r.userId===userId); const [rankingTab,setRankingTab]=useState<'general'|'academy'|'mine'>('general'); const [filtersOpen, setFiltersOpen] = useState(false); const visibleRows=rankingTab==='mine'?rows.filter(row=>row.userId===userId):rankingTab==='academy'?rows.filter(row=>userGymId && row.gymId === userGymId):rows; const heading = view==='ranking' ? item.title : view==='register' ? 'REGISTRAR LEVANTAMENTO' : view==='record' ? item.title : view==='processing' ? 'PROCESSANDO VÍDEO' : view==='manual-review' ? 'EM REVISÃO MANUAL' : view==='approved' ? 'LEVANTAMENTO APROVADO!' : view==='rejected' ? 'LEVANTAMENTO RECUSADO' : 'REGRAS DO DESAFIO';
  return <main className={`power-flow ${item.accent}`}><header><button onClick={onBack} disabled={view === 'processing'} aria-label={view === 'processing' ? 'Envio em andamento' : 'Voltar'}><ArrowLeft /></button><div><h1>{heading}</h1><p>{view==='ranking'?'Ranking ativo':view==='record'?`Carga informada: ${weight || '—'} kg`:view==='rules'?'Entenda como funciona e garanta que seu vídeo seja aprovado.':''}</p></div>{view==='ranking'&&<button className="power-filter" onClick={() => setFiltersOpen(value => !value)} aria-label="Filtrar ranking" aria-expanded={filtersOpen}><Filter/></button>}</header>
  {view==='ranking'&&<>{filtersOpen && <div className="power-flow-tabs power-flow-filter-menu"><button className={rankingTab==='general'?'active':''} onClick={()=>{setRankingTab('general');setFiltersOpen(false)}}>GERAL</button><button className={rankingTab==='academy'?'active':''} onClick={()=>{setRankingTab('academy');setFiltersOpen(false)}}>MINHA ACADEMIA</button><button className={rankingTab==='mine'?'active':''} onClick={()=>{setRankingTab('mine');setFiltersOpen(false)}}>MINHAS MARCAS</button></div>}<div className="power-flow-tabs"><button className={rankingTab==='general'?'active':''} onClick={()=>setRankingTab('general')}>GERAL</button><button className={rankingTab==='academy'?'active':''} onClick={()=>setRankingTab('academy')}>ACADEMIA</button><button className={rankingTab==='mine'?'active':''} onClick={()=>setRankingTab('mine')}>MINHAS MARCAS</button></div><img className="power-flow-hero" src={item.image} alt=""/><div className="power-flow-columns"><span>POSIÇÃO</span><span>ATLETA</span><span>MELHOR MARCA</span></div><section className="power-flow-rank">{visibleRows.length?visibleRows.map((r,i)=><article key={r.id} className={r.userId===userId?'mine':''}><b>{rankingTab==='general'?i+1:'•'}</b>{r.userPhoto?<img src={r.userPhoto} alt=""/>:<span/>}<div><strong>{r.userName||'Atleta'}</strong><small>{r.gymName||'Academia não informada'}</small></div><em>{r.weight} kg</em><button className="power-rank-video" onClick={()=>void onPlayVideo(r)} aria-label={`Assistir levantamento de ${r.userName || 'atleta'}`}><Video/></button></article>):<p>{rankingTab==='mine'?'Você ainda não possui um levantamento aprovado nesta modalidade.':rankingTab==='academy'?'Não há levantamentos aprovados da sua academia nesta modalidade.':'Nenhum levantamento aprovado nesta modalidade ainda.'}</p>}</section><button className="power-flow-primary" onClick={()=>{setRankingTab('mine');window.setTimeout(()=>document.querySelector('.power-flow-rank .mine')?.scrollIntoView({behavior:'smooth',block:'center'}),0)}}>{mine>=0?`◎  VER MINHA POSIÇÃO`:'◎  SEM POSIÇÃO AINDA'}</button></>}
  {view==='register'&&<><p className="power-flow-label">ESCOLHA A MODALIDADE</p><div className="power-flow-choices">{exercises.map(x=><button className={x.id===exercise?'active':''} onClick={()=>onExercise(x.id)} key={x.id}>{x.icon}<span>{x.title}</span></button>)}</div><p className="power-flow-label">INFORME SUA MELHOR MARCA</p><section className="power-flow-weight"><button onClick={()=>setWeight(Math.max(0,weight-2.5))}><Minus/></button><b>{weight||'—'} <small>kg</small></b><button onClick={()=>setWeight(weight+2.5)}><Plus/></button></section><section className="power-flow-rules"><b>REGRAS IMPORTANTES</b><p>• Vídeo obrigatório<br/>• Mostre os pesos utilizados<br/>• Execução completa e válida<br/>• Ambiente de academia</p></section><button className="power-flow-primary" disabled={!weight} onClick={()=>onView('record')}>CONTINUAR</button></>}
  {view==='record'&&<><div className="power-flow-camera" style={{backgroundImage:`url(${item.image})`}}><span><i/> REC</span><b>00:00:00</b></div><section className="power-flow-rules"><b>ORIENTAÇÕES PARA GRAVAÇÃO</b><p>Mostre os pesos utilizados <Check/><br/>Execute o movimento completo <Check/><br/>Ambiente de academia visível <Check/><br/>Câmera fixa e sem edições <Check/></p></section><input id="power-video" className="power-video-input" type="file" accept="video/*" capture="environment" onChange={e=>onFile(e.target.files?.[0]||null)}/><label className="power-record-button" htmlFor="power-video"><Camera/></label><strong className="power-record-copy">{videoFile?'VÍDEO SELECIONADO':'GRAVAR OU SELECIONAR VÍDEO'}<small>{videoFile?.name||'Envie um take contínuo para auditoria.'}</small></strong>{submissionError&&<p className="power-load-error">{submissionError}</p>}{videoFile&&<button className="power-flow-primary" onClick={onSubmit}>ENVIAR PARA VALIDAÇÃO</button>}</>}
  {view==='processing'&&<section className="power-result"><div className="power-progress">{uploadProgress < 100 ? `${uploadProgress}%` : '✓'}</div><p>{uploadProgress < 100 ? 'Enviando vídeo com segurança…' : 'Processando auditoria…'}</p><article>O servidor verificará:<br/><Check/> Ambiente de academia<br/><Check/> Presença de pesos<br/><Check/> Execução do movimento<br/><Check/> Amplitude e técnica<br/><Check/> Integridade do vídeo</article><small>Não feche esta tela até o envio chegar a 100%.</small></section>}
  {view==='manual-review'&&<section className="power-result"><ShieldCheck/><h2>VÍDEO EM REVISÃO</h2><p>Seu envio foi registrado para auditoria manual. Ele não entra no ranking nem gera pontuação até uma aprovação real.</p><article>{item.title}<b>{weight} kg</b><small>Status: aguardando revisão</small></article><button className="power-flow-primary" onClick={onBack}>VOLTAR AO DESAFIO</button></section>}
  {view==='approved'&&<section className="power-result is-ok"><CheckCircle2/><h2>LEVANTAMENTO APROVADO!</h2><p>Apenas exibido após aprovação real.</p><article>{item.title}<b>{weight} kg</b></article><button className="power-flow-primary" onClick={()=>onView('ranking')}>IR PARA O RANKING</button></section>}
  {view==='rejected'&&<section className="power-result is-no"><CircleX/><h2>LEVANTAMENTO RECUSADO</h2><p>Seu vídeo não atendeu às regras.</p><article>{reasons.map(reason=><p key={reason}>⊗ {reason}</p>)}</article><button className="power-flow-primary" onClick={()=>onView('record')}>ENVIAR NOVO VÍDEO</button></section>}
  {view==='rules'&&<section className="power-flow-rules power-full-rules"><h2>COMO FUNCIONA</h2><p>Grave seu melhor levantamento em vídeo e conquiste sua posição no ranking. Quanto maior o peso validado, maior a posição.</p><h2>REGRAS DO VÍDEO</h2><p>Ambiente de academia, peso visível, execução completa e câmera fixa. Vídeos com cortes, edições ou informações insuficientes podem ser recusados.</p></section>}
  </main>;
}
