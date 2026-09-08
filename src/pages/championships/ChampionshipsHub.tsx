import { createPortal } from 'react-dom';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { BarChart3, Bell, CalendarDays, Check, Dumbbell, Plus, ShieldCheck, Trophy, UserRound } from 'lucide-react';
import { AcademyRanking } from '../../components/ranking/AcademyRanking';
import { InvictusLogo } from '../../components/InvictusLogo';
import { useUser } from '../../UserContext';
import { hasActiveProEntitlement } from '../../lib/proEntitlement';
import { cardioPreviewCard, ChampionshipPreviewCard, FriendsChampionshipCard, strengthPreviewCard } from './ChampionshipCards';
import './ChampionshipsNew.css';

export function ChampionshipsHub() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useUser();
  const paid = hasActiveProEntitlement(user);
  const section = searchParams.get('section') === 'ranking' ? 'ranking' : 'championships';

  const selectSection = (nextSection: 'championships' | 'ranking') => {
    const next = new URLSearchParams(searchParams);
    if (nextSection === 'ranking') next.set('section', 'ranking');
    else next.delete('section');
    setSearchParams(next, { replace: false });
  };

  return createPortal(<main className="ch-new-screen"><div className="ch-new-page">
    <header className="ch-new-header"><button onClick={() => navigate('/notifications')} aria-label="Notificações"><Bell /></button><div><InvictusLogo size={45} /><b>INVICTUS</b><small>PERFORMANCE</small></div><button className="ch-new-avatar" onClick={() => navigate('/profile')} aria-label="Abrir perfil">{user?.photoURL ? <img src={user.photoURL} alt="" /> : <UserRound />}{paid ? <em>PRO</em> : null}</button></header>
    <nav className="ch-section-tabs" role="tablist" aria-label="Campeonatos e ranking da academia">
      <button type="button" role="tab" aria-selected={section === 'championships'} className={section === 'championships' ? 'is-active' : ''} onClick={() => selectSection('championships')}><Trophy /> CAMPEONATOS</button>
      <button type="button" role="tab" aria-selected={section === 'ranking'} className={section === 'ranking' ? 'is-active' : ''} onClick={() => selectSection('ranking')}><BarChart3 /> RANKING DA ACADEMIA</button>
    </nav>

    {section === 'ranking' ? <AcademyRanking /> : <>
      <section className="ch-new-hero"><h1>CAMPEONATOS</h1><p>Treine. Compita. Evolua.</p></section>
      <h2 className="ch-new-title">DESTAQUE</h2>
      <FriendsChampionshipCard onParticipate={() => navigate('/championships/community')} />
      <div className="ch-paid-head"><h2>CAMPEONATOS PAGOS</h2><span>EM PREPARAÇÃO</span></div>
      <section className="ch-future">
        <ChampionshipPreviewCard {...strengthPreviewCard} onPreview={() => navigate('/championships/preview/musculacao')} />
        <ChampionshipPreviewCard {...cardioPreviewCard} onPreview={() => navigate('/championships/preview/cardio')} />
      </section>
      <h2 className="ch-new-title">COMO FUNCIONA</h2><section className="ch-how">{[[CalendarDays,'1. ESCOLHA','Escolha o campeonato'],[Check,'2. INSCREVA-SE','Confirme sua participação'],[Dumbbell,'3. TREINE','Registre atividades reais'],[BarChart3,'4. RANKING','Acompanhe sua posição'],[Trophy,'5. EVOLUA','Supere suas marcas']].map(([Icon,title,text]:any) => <article key={title}><Icon /><b>{title}</b><span>{text}</span></article>)}</section><div className="ch-security"><ShieldCheck /><span>Validação avançada e sistema antifraude ajudam a manter competições justas.</span></div>
    </>}
  </div><nav className="ch-new-footer"><button onClick={() => navigate('/')}><InvictusLogo size={24} /><span>Início</span></button><button className="is-active" onClick={() => selectSection('championships')}><Trophy /><span>Campeonatos</span></button><button className="is-plus" onClick={() => navigate('/musculacao')} aria-label="Iniciar treino"><Plus /></button><button onClick={() => navigate('/challenges')}><ShieldCheck /><span>Desafios</span></button><button onClick={() => navigate('/profile')}><UserRound /><span>Perfil</span></button></nav></main>, document.body);
}
