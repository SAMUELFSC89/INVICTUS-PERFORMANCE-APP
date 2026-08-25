import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Award, CheckCircle2, ChevronRight, Dumbbell, FileVideo, ShieldCheck, Trophy, Upload, Users, Video, Camera, CircleX, Filter, Minus, Plus, Check, TrendingUp, Star } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { auth, storage } from '../firebase';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { useUser } from '../UserContext';
import { validationService } from '../services/validationService';
import { API_CONFIG } from '../config';
import './PowerLift.css';
import './PowerLiftFlow.css';
import './PowerLiftFidelity.css';
import './PowerLiftUpload.css';
import './PowerLiftMobile.css';

type Exercise = 'supino' | 'agachamento' | 'terra';
type RecordRow = { id: string; userId: string; userName?: string; userPhoto?: string; gymId?: string; gymName?: string; exercise: Exercise; weight: number; videoStatus?: 'approved' | 'manual_review' | 'rejected' | string; videoUrl?: string; userMessage?: string; motives?: string[]; date?: string; createdAt?: string };
const exercises: Array<{ id: Exercise; title: string; shortTitle?: string; accent: string; image: string; icon: React.ReactNode }> = [
  { id: 'supino', title: 'SUPINO RETO', shortTitle: 'SUPINO', accent: 'gold', image: '/powerlift-supino.jpg', icon: <Dumbbell /> },
  { id: 'agachamento', title: 'AGACHAMENTO LIVRE', shortTitle: 'AGACHAMENTO', accent: 'green', image: '/powerlift-agachamento.jpg', icon: <Award /> },
  { id: 'terra', title: 'LEVANTAMENTO TERRA', shortTitle: 'LEV. TERRA', accent: 'violet', image: '/powerlift-terra.jpg', icon: <Dumbbell /> },
];
const framesFromVideo = (file: File) => new Promise<string[]>((resolve) => { const url=URL.createObjectURL(file); const video=document.createElement('video'); const out:string[]=[]; let done=false; const finish=()=>{if(done)return;done=true;URL.revokeObjectURL(url);resolve(out)}; video.muted=true; video.playsInline=true; video.src=url; video.onloadedmetadata=()=>{const take=(time:number)=>{video.currentTime=time};let step=0;video.onseeked=()=>{const c=document.createElement('canvas');const ratio=Math.min(1,512/(video.videoWidth||512));c.width=(video.videoWidth||512)*ratio;c.height=(video.videoHeight||512)*ratio;c.getContext('2d')?.drawImage(video,0,0,c.width,c.height);out.push(c.toDataURL('image/jpeg',.65));step++;step<3?take(Math.min((video.duration||2)*step/3,Math.max(.1,(video.duration||2)-.1))):finish()};take(.1)};video.onerror=finish;setTimeout(finish,6000)});

export function PowerLift() {
  const navigate = useNavigate();
  const { user } = useUser();
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [myRecords, setMyRecords] = useState<RecordRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [modal, setModal] = useState<'rules' | 'videos' | null>(null);
  const [selected, setSelected] = useState<Exercise>('supino');
  const [view, setView] = useState<'home'|'ranking'|'register'|'record'|'processing'|'manual-review'|'approved'|'rejected'|'rules'>('home');
  const [weight, setWeight] = useState(0);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [reasons, setReasons] = useState<string[]>([]);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  useEffect(() => {
    let mounted = true;
    const loadRecords = async () => {
      setLoading(true);
      setLoadError(false);
      try {
        const firebaseUser = auth.currentUser;
        if (!firebaseUser) throw new Error('Usuário não autenticado.');
        const token = await firebaseUser.getIdToken();
        const headers = { Authorization: `Bearer ${token}` };
        const [rankingResponse, mineResponse] = await Promise.all([
          fetch(`${API_CONFIG.baseUrl}/api/powerlift?action=ranking`, { headers }),
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
        if (mounted) setLoading(false);
      }
    };
    void loadRecords();
    return () => { mounted = false; };
  }, [user?.uid]);
  const byExercise = (id: Exercise) => records.filter(row => row.exercise === id).sort((a,b) => b.weight-a.weight);
  const personalBest = (id: Exercise) => byExercise(id).find(row => row.userId === user?.uid)?.weight ?? null;
  const top = useMemo(() => [...records].sort((a,b)=>b.weight-a.weight).slice(0,3), [records]);
  const athleteCount = useMemo(() => new Set(records.map((row) => row.userId).filter(Boolean)).size, [records]);
  const approvedCount = useMemo(() => myRecords.filter(row => row.videoStatus === 'approved').length, [myRecords]);
  const approvalRate = useMemo(() => myRecords.length ? `${Math.round((approvedCount / myRecords.length) * 100)}%` : '—', [myRecords.length, approvedCount]);
  const totalScore = useMemo(() => {
    const pts = myRecords.filter(row => row.videoStatus === 'approved').reduce((acc, row) => acc + (row.weight || 0) * 10, 0);
    return pts > 0 ? `${pts.toLocaleString('pt-BR')} pts` : '—';
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
    setSubmissionError(null);
    setReasons([]);
    setView('processing');

    try {
      // A primeira chamada cria uma sessão de validação no servidor. O
      // resultado local nunca decide aprovação, ranking ou status do vídeo.
      const frames = await framesFromVideo(videoFile);
      const validation = await validationService.validatePowerVideo(frames, selected, weight);
      if (!validation.validationId) {
        setSubmissionError('Não foi possível iniciar a auditoria segura do vídeo. Nenhum levantamento foi registrado; tente novamente.');
        setView('record');
        return;
      }

      const safeFileName = videoFile.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = ref(storage, `power_records/${user.uid}/${Date.now()}_${safeFileName}`);
      const uploaded = await uploadBytes(path, videoFile);
      const videoUrl = await getDownloadURL(uploaded.ref);
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('Sua sessão expirou. Entre novamente para enviar o vídeo.');

      const response = await fetch(`${API_CONFIG.baseUrl}/api/powerlift?action=submit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          exercise: selected,
          weight,
          videoUrl,
          validationId: validation.validationId
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.record) {
        throw new Error(payload?.error || 'Não foi possível registrar o levantamento agora.');
      }

      const record = payload.record as RecordRow;
      const serverReasons = Array.isArray(record.motives) && record.motives.length
        ? record.motives
        : record.userMessage ? [record.userMessage] : [];
      setReasons(serverReasons);
      setMyRecords((current) => [record, ...current.filter((item) => item.id !== record.id)]);

      // Somente a decisão devolvida por /api/powerlift controla a tela final.
      if (payload.decision === 'approved') {
        setRecords((current) => [record, ...current.filter((item) => item.id !== record.id)]);
        setView('approved');
      } else if (payload.decision === 'rejected') {
        setView('rejected');
      } else {
        setView('manual-review');
      }
    } catch (error: any) {
      console.warn('[PowerLift] Falha no envio seguro:', error);
      setSubmissionError(error?.message || 'Não foi possível concluir o envio. Tente novamente com conexão estável.');
      setView('record');
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

  if (view !== 'home') return <PowerLiftFlow view={view} exercise={selected} records={records} userId={user?.uid} userGymId={user?.gymId} weight={weight} setWeight={setWeight} videoFile={videoFile} reasons={reasons} submissionError={submissionError} onFile={setVideoFile} onSubmit={submitVideo} onBack={()=>setView('home')} onView={setView} onExercise={setSelected} />;

  return <main className="power-screen">
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
            {row?.userPhoto ? (
              <img
                src={row.userPhoto}
                alt=""
                referrerPolicy="no-referrer"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                }}
              />
            ) : <span className="power-avatar">{row?.userName?.slice(0,1) || '—'}</span>}
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
              <small>SUA MELHOR MARCA</small>
              <strong>{best ? `${best} kg` : '—'}</strong>
              <hr/>
              <small>SUA POSIÇÃO</small>
              <strong>{standing >= 0 ? `${standing+1}º` : '—'}</strong>
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
        {stat('PONTUAÇÃO TOTAL', <Star />, totalScore, totalScore !== '—')}
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
  </main>;
}

function PowerLiftFlow({ view, exercise, records, userId, userGymId, weight, setWeight, videoFile, reasons, submissionError, onFile, onSubmit, onBack, onView, onExercise }: { view:string; exercise:Exercise; records:RecordRow[]; userId?:string; userGymId?:string; weight:number; setWeight:(n:number)=>void; videoFile:File|null; reasons:string[]; submissionError:string|null; onFile:(f:File|null)=>void; onSubmit:()=>void; onBack:()=>void; onView:(v:any)=>void; onExercise:(x:Exercise)=>void }) {
  const item = exercises.find(x=>x.id===exercise)!; const rows = records.filter(r=>r.exercise===exercise).sort((a,b)=>b.weight-a.weight); const mine=rows.findIndex(r=>r.userId===userId); const [rankingTab,setRankingTab]=useState<'general'|'academy'|'mine'>('general'); const [filtersOpen, setFiltersOpen] = useState(false); const visibleRows=rankingTab==='mine'?rows.filter(row=>row.userId===userId):rankingTab==='academy'?rows.filter(row=>userGymId && row.gymId === userGymId):rows; const heading = view==='ranking' ? item.title : view==='register' ? 'REGISTRAR LEVANTAMENTO' : view==='record' ? item.title : view==='processing' ? 'PROCESSANDO VÍDEO' : view==='manual-review' ? 'EM REVISÃO MANUAL' : view==='approved' ? 'LEVANTAMENTO APROVADO!' : view==='rejected' ? 'LEVANTAMENTO RECUSADO' : 'REGRAS DO DESAFIO';
  return <main className={`power-flow ${item.accent}`}><header><button onClick={onBack}><ArrowLeft /></button><div><h1>{heading}</h1><p>{view==='ranking'?'Ranking ativo':view==='record'?`Carga informada: ${weight || '—'} kg`:view==='rules'?'Entenda como funciona e garanta que seu vídeo seja aprovado.':''}</p></div>{view==='ranking'&&<button className="power-filter" onClick={() => setFiltersOpen(value => !value)} aria-label="Filtrar ranking" aria-expanded={filtersOpen}><Filter/></button>}</header>
  {view==='ranking'&&<>{filtersOpen && <div className="power-flow-tabs power-flow-filter-menu"><button className={rankingTab==='general'?'active':''} onClick={()=>{setRankingTab('general');setFiltersOpen(false)}}>GERAL</button><button className={rankingTab==='academy'?'active':''} onClick={()=>{setRankingTab('academy');setFiltersOpen(false)}}>MINHA ACADEMIA</button><button className={rankingTab==='mine'?'active':''} onClick={()=>{setRankingTab('mine');setFiltersOpen(false)}}>MINHAS MARCAS</button></div>}<div className="power-flow-tabs"><button className={rankingTab==='general'?'active':''} onClick={()=>setRankingTab('general')}>GERAL</button><button className={rankingTab==='academy'?'active':''} onClick={()=>setRankingTab('academy')}>ACADEMIA</button><button className={rankingTab==='mine'?'active':''} onClick={()=>setRankingTab('mine')}>MINHAS MARCAS</button></div><img className="power-flow-hero" src={item.image} alt=""/><div className="power-flow-columns"><span>POSIÇÃO</span><span>ATLETA</span><span>MELHOR MARCA</span></div><section className="power-flow-rank">{visibleRows.length?visibleRows.map((r,i)=><article key={r.id} className={r.userId===userId?'mine':''}><b>{rankingTab==='general'?i+1:'•'}</b>{r.userPhoto?<img src={r.userPhoto} alt="" referrerPolicy="no-referrer" onError={(e)=>{e.currentTarget.style.display='none'}}/>:<span/>}<div><strong>{r.userName||'Atleta'}</strong><small>{r.gymName||'Academia não informada'}</small></div><em>{r.weight} kg</em></article>):<p>{rankingTab==='mine'?'Você ainda não possui um levantamento aprovado nesta modalidade.':rankingTab==='academy'?'Não há levantamentos aprovados da sua academia nesta modalidade.':'Nenhum levantamento aprovado nesta modalidade ainda.'}</p>}</section><button className="power-flow-primary" onClick={()=>{setRankingTab('mine');window.setTimeout(()=>document.querySelector('.power-flow-rank .mine')?.scrollIntoView({behavior:'smooth',block:'center'}),0)}}>{mine>=0?`◎  VER MINHA POSIÇÃO`:'◎  SEM POSIÇÃO AINDA'}</button></>}
  {view==='register'&&<><p className="power-flow-label">ESCOLHA A MODALIDADE</p><div className="power-flow-choices">{exercises.map(x=><button className={x.id===exercise?'active':''} onClick={()=>onExercise(x.id)} key={x.id}>{x.icon}<span>{x.title}</span></button>)}</div><p className="power-flow-label">INFORME SUA MELHOR MARCA</p><section className="power-flow-weight"><button onClick={()=>setWeight(Math.max(0,weight-2.5))}><Minus/></button><b>{weight||'—'} <small>kg</small></b><button onClick={()=>setWeight(weight+2.5)}><Plus/></button></section><section className="power-flow-rules"><b>REGRAS IMPORTANTES</b><p>• Vídeo obrigatório<br/>• Mostre os pesos utilizados<br/>• Execução completa e válida<br/>• Ambiente de academia</p></section><button className="power-flow-primary" disabled={!weight} onClick={()=>onView('record')}>CONTINUAR</button></>}
  {view==='record'&&<><div className="power-flow-camera" style={{backgroundImage:`url(${item.image})`}}><span><i/> REC</span><b>00:00:00</b></div><section className="power-flow-rules"><b>ORIENTAÇÕES PARA GRAVAÇÃO</b><p>Mostre os pesos utilizados <Check/><br/>Execute o movimento completo <Check/><br/>Ambiente de academia visível <Check/><br/>Câmera fixa e sem edições <Check/></p></section><input id="power-video" className="power-video-input" type="file" accept="video/*" capture="environment" onChange={e=>onFile(e.target.files?.[0]||null)}/><label className="power-record-button" htmlFor="power-video"><Camera/></label><strong className="power-record-copy">{videoFile?'VÍDEO SELECIONADO':'GRAVAR OU SELECIONAR VÍDEO'}<small>{videoFile?.name||'Envie um take contínuo para auditoria.'}</small></strong>{submissionError&&<p className="power-load-error">{submissionError}</p>}{videoFile&&<button className="power-flow-primary" onClick={onSubmit}>ENVIAR PARA VALIDAÇÃO</button>}</>}
  {view==='processing'&&<section className="power-result"><div className="power-progress">…</div><p>Enviando para auditoria segura…</p><article>O servidor verificará:<br/><Check/> Ambiente de academia<br/><Check/> Presença de pesos<br/><Check/> Execução do movimento<br/><Check/> Amplitude e técnica<br/><Check/> Integridade do vídeo</article><small>A decisão final será exibida somente após a validação do servidor.</small></section>}
  {view==='manual-review'&&<section className="power-result"><ShieldCheck/><h2>VÍDEO EM REVISÃO</h2><p>Seu envio foi registrado para auditoria manual. Ele não entra no ranking nem gera pontuação até uma aprovação real.</p><article>{item.title}<b>{weight} kg</b><small>Status: aguardando revisão</small></article><button className="power-flow-primary" onClick={onBack}>VOLTAR AO DESAFIO</button></section>}
  {view==='approved'&&<section className="power-result is-ok"><CheckCircle2/><h2>LEVANTAMENTO APROVADO!</h2><p>Apenas exibido após aprovação real.</p><article>{item.title}<b>{weight} kg</b></article><button className="power-flow-primary" onClick={()=>onView('ranking')}>IR PARA O RANKING</button></section>}
  {view==='rejected'&&<section className="power-result is-no"><CircleX/><h2>LEVANTAMENTO RECUSADO</h2><p>Seu vídeo não atendeu às regras.</p><article>{reasons.map(reason=><p key={reason}>⊗ {reason}</p>)}</article><button className="power-flow-primary" onClick={()=>onView('record')}>ENVIAR NOVO VÍDEO</button></section>}
  {view==='rules'&&<section className="power-flow-rules power-full-rules"><h2>COMO FUNCIONA</h2><p>Grave seu melhor levantamento em vídeo e conquiste sua posição no ranking. Quanto maior o peso validado, maior a posição.</p><h2>REGRAS DO VÍDEO</h2><p>Ambiente de academia, peso visível, execução completa e câmera fixa. Vídeos com cortes, edições ou informações insuficientes podem ser recusados.</p></section>}
  </main>;
}
