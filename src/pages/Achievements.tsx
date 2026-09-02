import { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, Plus, Share2, ShieldCheck, Trophy, UserRound } from 'lucide-react';
import { toPng } from 'html-to-image';
import { ACHIEVEMENTS } from '../achievements';
import { InvictusLogo } from '../components/InvictusLogo';
import { useUser } from '../UserContext';
import type { Achievement } from '../types';
import './AchievementsNew.css';

const CATEGORIES = [
  { id: 'all', label: 'TODAS' },
  { id: 'frequency', label: 'FREQUÊNCIA' },
  { id: 'performance', label: 'PERFORMANCE' },
  { id: 'ranking', label: 'RANKING' },
  { id: 'social', label: 'SOCIAL' }
] as const;

export function Achievements() {
  const { user } = useUser();
  const navigate = useNavigate();
  const shareRef = useRef<HTMLDivElement>(null);
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]['id']>('all');
  const [selected, setSelected] = useState<Achievement | null>(null);
  const [sharing, setSharing] = useState(false);
  const [message, setMessage] = useState('');
  const unlockedIds = useMemo(() => new Set([...(user?.achievements || []), ...(user?.badges || [])]), [user?.achievements, user?.badges]);
  const list = ACHIEVEMENTS.filter(item => category === 'all' || item.category === category);
  const unlockedCount = ACHIEVEMENTS.filter(item => unlockedIds.has(item.id)).length;
  const progress = ACHIEVEMENTS.length ? Math.round(unlockedCount / ACHIEVEMENTS.length * 100) : 0;

  const share = async () => {
    if (!selected || !shareRef.current) return;
    setSharing(true); setMessage('');
    try {
      const url = await toPng(shareRef.current, { width: 1080, height: 1920, pixelRatio: 1, cacheBust: true });
      const blob = await (await fetch(url)).blob();
      const file = new File([blob], `invictus-${selected.id}.png`, { type: 'image/png' });
      if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
        await navigator.share({ title: selected.name, text: 'Conquista desbloqueada no Invictus Performance.', files: [file] });
      } else {
        const link = document.createElement('a'); link.href = url; link.download = file.name; link.click();
      }
    } catch (reason: any) {
      if (reason?.name !== 'AbortError') setMessage('Não foi possível gerar o card agora.');
    } finally { setSharing(false); }
  };

  if (!user) return null;
  return createPortal(<main className="an-screen"><div className="an-page">
    <header className="an-header"><button onClick={() => navigate(-1)} aria-label="Voltar"><ArrowLeft /></button><div><InvictusLogo size={44} /><span><b>INVICTUS</b><small>PERFORMANCE</small></span></div><button onClick={() => navigate('/profile')} aria-label="Perfil"><UserRound /></button></header>
    <section className="an-title"><small>SUA EVOLUÇÃO</small><h1>MINHAS <span>CONQUISTAS</span></h1><p>Marcos liberados apenas por atividades e resultados validados.</p></section>
    <section className="an-summary"><div><Trophy /><span><b>{unlockedCount}</b><small>DESBLOQUEADAS</small></span></div><div className="an-track"><span>{progress}% da coleção</span><i><b style={{width:`${progress}%`}} /></i></div></section>
    <nav className="an-filters">{CATEGORIES.map(item => <button key={item.id} className={category === item.id ? 'is-active' : ''} onClick={() => setCategory(item.id)}>{item.label}</button>)}</nav>
    <section className="an-grid">{list.map(item => {
      const unlocked = unlockedIds.has(item.id);
      return <article key={item.id} className={unlocked ? 'is-unlocked' : 'is-locked'}><span>{item.icon}</span><div><small>{unlocked ? 'CONQUISTA LIBERADA' : 'AINDA BLOQUEADA'}</small><h2>{item.name}</h2><p>{item.description}</p><em>{item.points.toLocaleString('pt-BR')} XP</em></div>{unlocked ? <button onClick={() => setSelected(item)} aria-label={`Compartilhar ${item.name}`}><Share2 /></button> : <i><ShieldCheck /></i>}</article>;
    })}</section>
    {message ? <p className="an-message">{message}</p> : null}
  </div>
  {selected ? <div className="an-modal" role="dialog" aria-modal="true"><section><button className="an-close" onClick={() => setSelected(null)}>×</button><div className="an-preview"><span>{selected.icon}</span><small>CONQUISTA DESBLOQUEADA</small><h2>{selected.name}</h2><p>{selected.description}</p><b><Check /> VALIDADA PELO INVICTUS</b></div><button className="an-share" onClick={share} disabled={sharing}><Share2 /> {sharing ? 'GERANDO...' : 'COMPARTILHAR CARD'}</button></section></div> : null}
  <div className="an-share-render" aria-hidden="true"><div ref={shareRef}><header><InvictusLogo size={150} /><h3>INVICTUS</h3><small>PERFORMANCE</small></header><main><span>{selected?.icon}</span><p>CONQUISTA DESBLOQUEADA</p><h1>{selected?.name}</h1><h2>{selected?.description}</h2></main><footer><ShieldCheck /> RESULTADO VALIDADO</footer></div></div>
  <nav className="an-footer"><button onClick={() => navigate('/')}><InvictusLogo size={24} /><span>Início</span></button><button onClick={() => navigate('/championships')}><Trophy /><span>Campeonatos</span></button><button className="is-plus" onClick={() => navigate('/activity')} aria-label="Escolher modalidade"><Plus /></button><button onClick={() => navigate('/challenges')}><ShieldCheck /><span>Desafios</span></button><button className="is-active" onClick={() => navigate('/profile')}><UserRound /><span>Perfil</span></button></nav>
  </main>, document.body);
}
