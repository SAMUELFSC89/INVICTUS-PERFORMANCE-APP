import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, BarChart3, Bell, CalendarCheck, Check, ChevronRight, Coins, Crown, Dumbbell, Flame, Footprints, History, Play, Plus, ShieldCheck, Target, Trophy, UserRound, Users } from 'lucide-react';
import { InvictusLogo } from './InvictusLogo';
import { useUser } from '../UserContext';
import { missionService, MissionDashboard } from '../services/missionService';
import type { Mission, UserMissionProgress } from '../types';
import './ChallengesHubNew.css';

type Filter = 'all' | 'workout' | 'cardio' | 'performance' | 'habits' | 'social';
type Props = { onCardio: () => void; onHistory: () => void };

const missionFilter = (mission: Mission): Filter => {
  if (mission.type === 'workout_count' || mission.type === 'strength_workout_count' || mission.type === 'gym_checkins') return 'workout';
  if (mission.type === 'cardio_minutes' || mission.type === 'cardio_count') return 'cardio';
  if (mission.type === 'streak_days' || mission.type === 'total_days' || mission.type === 'consistency_weeks' || mission.type === 'monthly_active_weeks') return 'habits';
  return 'performance';
};

const progressFor = (mission: Mission, list: UserMissionProgress[]) => list.find(item => item.missionId === mission.id) || {
  id: '', userId: '', missionId: mission.id, currentProgress: 0, target: mission.target, completed: false, claimed: false, updatedAt: '',
};

export function ChallengesHubNew({ onCardio, onHistory }: Props) {
  const navigate = useNavigate();
  const { user } = useUser();
  const [dashboard, setDashboard] = useState<MissionDashboard | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [claiming, setClaiming] = useState<string | null>(null);
  const availableRef = useRef<HTMLDivElement>(null);

  const load = async () => { setLoading(true); setError(null); try { setDashboard(await missionService.dashboard()); } catch (reason: any) { setError(reason.message); } finally { setLoading(false); } };
  useEffect(() => { void load(); }, []);
  const missions = dashboard?.missions || [];
  const progress = dashboard?.userProgress || [];
  const filtered = useMemo(() => missions.filter(mission => filter === 'all' || missionFilter(mission) === filter), [missions, filter]);
  const featured = missions.slice(0, 3);
  const paid = user?.subscriptionTier === 'performance' || user?.currentPlan === 'performance' || user?.isSubscribed === true || user?.premium === true;

  const claim = async (mission: Mission) => {
    setClaiming(mission.id); setError(null);
    try { await missionService.claim(mission.id); await load(); } catch (reason: any) { setError(reason.message); } finally { setClaiming(null); }
  };

  const openProChallenges = () => {
    if (!paid) {
      navigate('/profile/preferences/subscriptions');
      return;
    }
    setFilter('performance');
    requestAnimationFrame(() => availableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const iconFor = (mission: Mission) => mission.type === 'cardio_minutes' || mission.type === 'cardio_count' ? Footprints : mission.type === 'streak_days' || mission.type === 'consistency_weeks' || mission.type === 'monthly_active_weeks' ? Flame : mission.type === 'workout_count' || mission.type === 'strength_workout_count' ? Dumbbell : CalendarCheck;
  const renderReward = (mission: Mission) => <>{mission.rewardXP > 0 ? <span>{mission.rewardXP.toLocaleString('pt-BR')} XP</span> : null}<span>+ {mission.rewardCoins.toLocaleString('pt-BR')} Invictus Coins <Coins /></span></>;

  return createPortal(<main className="dc-screen"><div className="dc-page">
    <header className="dc-header"><button onClick={() => navigate('/notifications')} aria-label="Notificações"><Bell /></button><div><InvictusLogo size={45} /><b>INVICTUS</b><small>PERFORMANCE</small></div><button className="dc-avatar" onClick={() => navigate('/profile')}>{user?.photoURL ? <img src={user.photoURL} alt="" /> : <UserRound />}{paid ? <em>PRO</em> : null}</button></header>
    <section className="dc-hero"><h1>DESAFIOS</h1><p>Supere limites. Conquiste recompensas.</p><div><Coins /><b>{dashboard ? dashboard.coinWallet.balance.toLocaleString('pt-BR') : '—'}</b><span>Invictus Coins</span></div></section>
    <div className="dc-section-head"><h2>DESAFIOS EM DESTAQUE</h2></div>
    <section className="dc-featured">{featured.map(mission => { const item = progressFor(mission, progress); const Icon = iconFor(mission); const percentage = mission.target > 0 ? Math.min(100, item.currentProgress / mission.target * 100) : 0; return <article key={mission.id}><small>DESAFIO {mission.category.toUpperCase()} {mission.isFreeAccess ? '· FREE + PRO' : '· PRO'}</small><Icon /><h3>{mission.title}</h3><p>{mission.description}</p><div className="dc-count"><b>{item.currentProgress}/{mission.target}</b><i><span style={{ width: `${percentage}%` }} /></i></div><div className="dc-reward"><small>RECOMPENSA</small>{renderReward(mission)}</div></article>; })}{!loading && featured.length === 0 ? <p className="dc-empty">Nenhum desafio em destaque foi publicado.</p> : null}</section>
    <section className="dc-powerlift-feature"><span><Crown /></span><div><small>DESTAQUE DE FORÇA</small><h2>INVICTUS POWER LIFT</h2><p>Registre seu levantamento em vídeo, passe pela validação inteligente e mostre sua força no ranking.</p><ul><li><Play /> Vídeo obrigatório</li><li><ShieldCheck /> Antifraude por IA</li><li><Trophy /> Ranking por modalidade</li></ul></div><button onClick={() => navigate('/power')}>ENTRAR NO POWER LIFT <ArrowRight /></button></section>
    <div className="dc-section-head"><h2>CATEGORIAS</h2></div><section className="dc-filters">{[
      ['all','TODOS',Target],['workout','MUSCULAÇÃO',Dumbbell],['cardio','CARDIO',Footprints],['performance','PERFORMANCE',BarChart3],['habits','HÁBITOS',Flame],['social','SOCIAIS',Users],
    ].map(([id,label,Icon]: any) => <button key={id} className={filter === id ? 'is-active' : ''} onClick={() => setFilter(id)}><Icon /><span>{label}</span></button>)}</section>
    <div ref={availableRef} className="dc-section-head"><h2>DESAFIOS DISPONÍVEIS</h2><button onClick={onHistory}><History /> HISTÓRICO</button></div>
    {error ? <p className="dc-error">{error}</p> : null}{loading ? <p className="dc-loading">Carregando desafios reais…</p> : <section className="dc-list">{filtered.map(mission => { const item = progressFor(mission, progress); const Icon = iconFor(mission); const percentage = mission.target > 0 ? Math.min(100, item.currentProgress / mission.target * 100) : 0; const locked = !mission.isFreeAccess && !paid; return <article key={mission.id} className={locked ? 'is-locked' : ''}><span className="dc-list-icon"><Icon /></span><div><small>DESAFIO {mission.category.toUpperCase()} {mission.isFreeAccess ? '· FREE + PRO' : '· PRO'}</small><h3>{mission.title}</h3><p>{mission.description}</p></div><div className="dc-list-reward"><small>RECOMPENSA</small>{renderReward(mission)}</div><div className="dc-ring" style={{ '--progress': `${percentage * 3.6}deg` } as React.CSSProperties}><span>{locked ? 'PRO' : `${item.currentProgress}/${mission.target}`}</span></div>{locked ? <button onClick={() => navigate('/profile/preferences/subscriptions')}>VER PRO</button> : item.completed && !item.claimed ? <button disabled={claiming === mission.id} onClick={() => claim(mission)}>{claiming === mission.id ? '…' : 'RESGATAR'}</button> : item.claimed ? <span className="dc-claimed"><Check />RESGATADO</span> : <ChevronRight />}</article>; })}{filtered.length === 0 ? <p className="dc-empty">Nenhum desafio publicado nesta categoria.</p> : null}</section>}
    <section className="dc-activities"><button onClick={() => navigate('/musculacao')}><Dumbbell /><span><b>INICIAR MUSCULAÇÃO</b>Treino e plano de hoje</span><ArrowRight /></button><button onClick={onCardio}><Footprints /><span><b>INICIAR CARDIO</b>Escolha a modalidade</span><ArrowRight /></button><button onClick={() => navigate('/power')}><Trophy /><span><b>POWER LIFT</b>Desafios de força</span><ArrowRight /></button></section>
    <section className="dc-premium"><Trophy /><div><h2>DESAFIOS PREMIUM</h2><p>Desafios PRO não oferecem dinheiro: ampliam reconhecimento, XP e Invictus Coins.</p></div><button onClick={openProChallenges}>VER DESAFIOS PRO <ArrowRight /></button></section>
    <div className="dc-coin-note"><ShieldCheck /><span>Invictus Coins não têm valor monetário, não podem ser sacadas e serão usadas somente na futura Loja Invictus.</span></div>
  </div><nav className="dc-footer"><button onClick={() => navigate('/')}><InvictusLogo size={24} /><span>Início</span></button><button onClick={() => navigate('/championships')}><Trophy /><span>Campeonatos</span></button><button className="is-plus" onClick={() => navigate('/activity')} aria-label="Escolher modalidade"><Plus /></button><button className="is-active"><ShieldCheck /><span>Desafios</span></button><button onClick={() => navigate('/profile')}><UserRound /><span>Perfil</span></button></nav></main>, document.body);
}
