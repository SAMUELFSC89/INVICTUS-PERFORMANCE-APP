import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Award, Check, Flame, Heart, MapPin, Plus, Share2, ShieldCheck, Trophy, UserRound } from 'lucide-react';
import { auth } from '../firebase';
import { ACHIEVEMENTS } from '../achievements';
import { InvictusLogo } from '../components/InvictusLogo';
import { API_CONFIG } from '../config';
import { userService } from '../services/userService';
import './PublicProfileNew.css';

interface PublicProfileData {
  uid: string;
  displayName?: string;
  photoURL?: string;
  bio?: string;
  city?: string;
  state?: string;
  streak?: number;
  score?: number;
  xp?: number;
  positions?: Partial<Record<'gym' | 'city' | 'national' | 'global', number>>;
  achievements?: string[];
  profileLikesCount?: number;
}

const rank = (value?: number) => Number(value) > 0 ? `#${Number(value)}` : '—';

export function PublicProfile() {
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<PublicProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [recognizing, setRecognizing] = useState(false);
  const [recognized, setRecognized] = useState(false);

  useEffect(() => {
    if (!userId) { navigate('/rankings', { replace: true }); return; }
    const controller = new AbortController();
    setLoading(true); setError('');
    fetch(`${API_CONFIG.baseUrl}/api/profile?id=${encodeURIComponent(userId)}`, { signal: controller.signal })
      .then(async response => {
        if (response.status === 404) throw new Error('Perfil não encontrado.');
        if (!response.ok) throw new Error('Não foi possível carregar este perfil.');
        return response.json() as Promise<PublicProfileData>;
      })
      .then(setProfile)
      .catch(reason => { if (reason?.name !== 'AbortError') setError(reason.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [navigate, userId]);

  const unlocked = useMemo(() => {
    const ids = new Set(profile?.achievements || []);
    return ACHIEVEMENTS.filter(item => ids.has(item.id));
  }, [profile?.achievements]);
  const isMe = auth.currentUser?.uid === profile?.uid;
  const location = [profile?.city, profile?.state].filter(Boolean).join(' • ');

  const recognize = async () => {
    if (!profile || recognizing || recognized) return;
    if (!auth.currentUser) { navigate('/login'); return; }
    setRecognizing(true); setError('');
    try {
      const result = await userService.likeProfile(profile.uid);
      setRecognized(true);
      setProfile(current => current ? { ...current, profileLikesCount: result.count } : current);
    } catch (reason: any) { setError(reason.message || 'Não foi possível reconhecer este atleta.'); }
    finally { setRecognizing(false); }
  };

  const share = async () => {
    if (!profile) return;
    const name = profile.displayName || 'Atleta Invictus';
    const shareData = { title: `${name} • Invictus Performance`, text: `Confira o perfil de ${name} no Invictus Performance.`, url: window.location.href };
    try {
      if (navigator.share) await navigator.share(shareData);
      else { await navigator.clipboard.writeText(window.location.href); setError('Link do perfil copiado.'); }
    } catch (reason: any) { if (reason?.name !== 'AbortError') setError('Não foi possível compartilhar o perfil.'); }
  };

  return createPortal(<main className="ppn-screen">
    <div className="ppn-page">
      <header className="ppn-header"><button onClick={() => navigate(-1)} aria-label="Voltar"><ArrowLeft /></button><div><InvictusLogo size={44} /><span><b>INVICTUS</b><small>PERFORMANCE</small></span></div><button onClick={share} aria-label="Compartilhar perfil"><Share2 /></button></header>
      {loading ? <section className="ppn-state"><i /><p>Carregando atleta...</p></section> : error && !profile ? <section className="ppn-state"><Award /><p>{error}</p><button onClick={() => navigate('/rankings')}>VOLTAR AO RANKING</button></section> : profile ? <>
        <section className="ppn-hero">
          <div className="ppn-photo">{profile.photoURL ? <img src={profile.photoURL} alt={`Foto de ${profile.displayName || 'atleta'}`} referrerPolicy="no-referrer" /> : <UserRound />}</div>
          <div className="ppn-person"><small>ATLETA INVICTUS</small><h1>{(profile.displayName || 'ATLETA').toUpperCase()}</h1>{location ? <p><MapPin /> {location}</p> : null}{profile.bio ? <blockquote>{profile.bio}</blockquote> : null}</div>
          <aside><InvictusLogo size={32} /><small>IGA</small><b>{Number.isFinite(Number(profile.score)) ? Math.round(Number(profile.score)) : '—'}</b><span>Pontuação validada</span></aside>
        </section>
        <section className="ppn-recognition"><div><Heart /><span><b>{Number(profile.profileLikesCount || 0).toLocaleString('pt-BR')}</b><small>RECONHECIMENTOS</small></span></div>{!isMe ? <button className={recognized ? 'is-done' : ''} onClick={recognize} disabled={recognizing || recognized}>{recognized ? <Check /> : <Heart />}{recognized ? 'RECONHECIDO' : recognizing ? 'ENVIANDO...' : 'RECONHECER'}</button> : null}</section>
        {error ? <p className="ppn-message">{error}</p> : null}
        <section className="ppn-stats">
          <article><Trophy /><small>RANK GERAL</small><b>{rank(profile.positions?.national || profile.positions?.global)}</b><span>Brasil</span></article>
          <article><ShieldCheck /><small>RANK LOCAL</small><b>{rank(profile.positions?.city)}</b><span>{profile.city || 'Sem localização pública'}</span></article>
          <article><Flame /><small>SEQUÊNCIA</small><b>{Number(profile.streak) > 0 ? Number(profile.streak) : '—'}</b><span>{Number(profile.streak) === 1 ? 'dia ativo' : 'dias ativos'}</span></article>
          <article><Award /><small>CONQUISTAS</small><b>{unlocked.length}</b><span>desbloqueadas</span></article>
        </section>
        <div className="ppn-title"><h2>CONQUISTAS</h2></div>
        <section className="ppn-achievements">{unlocked.length ? unlocked.map(item => <article key={item.id}><span>{item.icon}</span><div><b>{item.name}</b><small>{item.description || item.criteria}</small></div></article>) : <div className="ppn-empty"><Award /><p>Este atleta ainda não possui conquistas públicas.</p></div>}</section>
      </> : null}
    </div>
    <nav className="ppn-footer"><button onClick={() => navigate('/')}><InvictusLogo size={24} /><span>Início</span></button><button onClick={() => navigate('/championships')}><Trophy /><span>Campeonatos</span></button><button className="is-plus" onClick={() => navigate('/musculacao')}><Plus /></button><button onClick={() => navigate('/challenges')}><ShieldCheck /><span>Desafios</span></button><button onClick={() => navigate('/profile')}><UserRound /><span>Perfil</span></button></nav>
  </main>, document.body);
}
