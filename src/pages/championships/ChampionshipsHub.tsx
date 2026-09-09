import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { BarChart3, Bell, CalendarDays, Check, Dumbbell, Plus, ShieldCheck, Trophy, UserRound } from 'lucide-react';
import { InvictusLogo } from '../../components/InvictusLogo';
import { useUser } from '../../UserContext';
import { hasActiveProEntitlement } from '../../lib/proEntitlement';
import { communityChampionshipService } from '../../services/communityChampionshipService';
import {
  cardioPreviewCard,
  ChampionshipPreviewCard,
  FriendsChampionshipCard,
  FriendsRankingCard,
  strengthPreviewCard,
} from './ChampionshipCards';
import './ChampionshipsNew.css';
import './ChampionshipsRound.css';

export function ChampionshipsHub() {
  const navigate = useNavigate();
  const { user } = useUser();
  const paid = hasActiveProEntitlement(user);
  const [friendsEnrolled, setFriendsEnrolled] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    communityChampionshipService.status()
      .then((result) => { if (!cancelled) setFriendsEnrolled(result.enrolled === true); })
      .catch(() => { if (!cancelled) setFriendsEnrolled(false); });
    return () => { cancelled = true; };
  }, [user?.uid]);

  return createPortal(<main className="ch-new-screen"><div className="ch-new-page">
    <header className="ch-new-header"><button onClick={() => navigate('/notifications')} aria-label="Notificações"><Bell /></button><div><InvictusLogo size={45} /><b>INVICTUS</b><small>PERFORMANCE</small></div><button className="ch-new-avatar" onClick={() => navigate('/profile')} aria-label="Abrir perfil">{user?.photoURL ? <img src={user.photoURL} alt="" /> : <UserRound />}{paid ? <em>PRO</em> : null}</button></header>

    {friendsEnrolled === false ? <><h2 className="ch-new-title ch-new-title--first">DESTAQUE</h2><FriendsChampionshipCard onParticipate={() => navigate('/championships/community')} /></> : null}

    <div className="ch-paid-head ch-paid-head--first"><h2>CAMPEONATOS</h2><span>EM PREPARAÇÃO</span></div>
    <section className="ch-future">
      <ChampionshipPreviewCard {...strengthPreviewCard} onPreview={() => navigate('/championships/preview/musculacao')} />
      <ChampionshipPreviewCard {...cardioPreviewCard} onPreview={() => navigate('/championships/preview/cardio')} />
    </section>

    {friendsEnrolled === null ? <div className="ch-friends-status-loading" aria-label="Carregando Campeonato Entre Amigos" /> : friendsEnrolled ? <>
      <div className="ch-my-championship-head"><h2>MEU CAMPEONATO</h2><span>Acompanhe seu desempenho</span></div>
      <FriendsRankingCard onOpen={() => navigate('/championships/community/ranking')} />
    </> : null}

    <h2 className="ch-new-title">COMO FUNCIONA</h2><section className="ch-how">{[[CalendarDays,'1. ESCOLHA','Escolha o campeonato'],[Check,'2. INSCREVA-SE','Confirme sua participação'],[Dumbbell,'3. TREINE','Registre atividades reais'],[BarChart3,'4. RANKING','Acompanhe sua posição'],[Trophy,'5. EVOLUA','Supere suas marcas']].map(([Icon,title,text]:any) => <article key={title}><Icon /><b>{title}</b><span>{text}</span></article>)}</section><div className="ch-security"><ShieldCheck /><span>Validação avançada e sistema antifraude ajudam a manter competições justas.</span></div>
  </div><nav className="ch-new-footer"><button onClick={() => navigate('/')}><InvictusLogo size={24} /><span>Início</span></button><button className="is-active" onClick={() => navigate('/championships')}><Trophy /><span>Campeonatos</span></button><button className="is-plus" onClick={() => navigate('/musculacao')} aria-label="Iniciar treino"><Plus /></button><button onClick={() => navigate('/challenges')}><ShieldCheck /><span>Desafios</span></button><button onClick={() => navigate('/profile')}><UserRound /><span>Perfil</span></button></nav></main>, document.body);
}
