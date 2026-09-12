import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, BarChart3, Bell, CalendarCheck, Check, ChevronRight, Coins, Crown, Dumbbell, Flame, Footprints, History, Play, Plus, ShieldCheck, Target, Trophy, UserRound, Users } from 'lucide-react';
import { InvictusLogo } from './InvictusLogo';
import { useUser } from '../UserContext';
import { missionService, MissionDashboard } from '../services/missionService';
import type { Mission, UserMissionProgress } from '../types';
import { hasActiveProEntitlement } from '../lib/proEntitlement';
import './ChallengesHubNew.css';

type Filter = 'all' | 'workout' | 'cardio' | 'performance' | 'habits' | 'social';
type Props = {
  onCardio: () => void;
  onHistory: () => void;
  onPrivate: () => void;
  errorMessage?: string | null;
  statusMessage?: string | null;
};

const missionFilter = (mission: Mission): Filter => {
  if (mission.type === 'workout_count' || mission.type === 'strength_workout_count' || mission.type === 'gym_checkins') return 'workout';
  if (mission.type === 'cardio_minutes' || mission.type === 'cardio_count') return 'cardio';
  if (mission.type === 'streak_days' || mission.type === 'total_days' || mission.type === 'consistency_weeks' || mission.type === 'monthly_active_weeks') return 'habits';
  return 'performance';
};

const progressFor = (mission: Mission, list: UserMissionProgress[]) => list.find(item => item.missionId === mission.id) || {
  id: '', userId: '', missionId: mission.id, currentProgress: 0, target: mission.target, completed: false, claimed: false, updatedAt: '',
};

const missionForProgress = (mission: Mission, list: UserMissionProgress[]): Mission => {
  const item = list.find(progress => progress.missionId === mission.id);
  if (!item) return mission;
  return {
    ...mission,
    title: item.missionTitleSnapshot || mission.title,
    description: item.missionDescriptionSnapshot || mission.description,
    category: item.missionCategorySnapshot || mission.category,
    type: item.missionTypeSnapshot || mission.type,
    target: Number(item.targetSnapshot ?? item.target) || mission.target,
    weeklyGoal: Number(item.weeklyGoalSnapshot) || mission.weeklyGoal,
    rewardCoins: Number(item.claimRewardCoins ?? item.rewardCoinsSnapshot ?? mission.rewardCoins) || 0,
    rewardXP: Number(item.claimRewardXP ?? item.rewardXPSnapshot ?? mission.rewardXP) || 0,
    isFreeAccess: typeof item.isFreeAccessSnapshot === 'boolean'
      ? item.isFreeAccessSnapshot : mission.isFreeAccess,
  };
};

const missionActivityType = (mission: Mission): 'workout' | 'cardio' | 'other' => {
  if (['workout_count', 'strength_workout_count', 'gym_checkins'].includes(mission.type)) return 'workout';
  if (['cardio_count', 'cardio_minutes'].includes(mission.type)) return 'cardio';
  return 'other';
};

export function ChallengesHubNew({ onCardio, onHistory, onPrivate, errorMessage, statusMessage }: Props) {
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
  const progress = dashboard?.userProgress || [];
  const missions = useMemo(
    () => (dashboard?.missions || []).map(mission => missionForProgress(mission, dashboard?.userProgress || [])),
    [dashboard],
  );
  const filtered = useMemo(() => missions.filter(mission => filter === 'all' || missionFilter(mission) === filter), [missions, filter]);
  const featured = missions.slice(0, 3);
  const paid = hasActiveProEntitlement(user);

  const claim = async (mission: Mission, item: UserMissionProgress) => {
    setClaiming(mission.id); setError(null);
    try { await missionService.claim(mission.id, item.id || undefined); await load(); } catch (reason: any) { setError(reason.message); } finally { setClaiming(null); }
  };

  const openProChallenges = () => {
    if (!paid) {
      navigate('/profile/preferences/subscriptions');
      return;
    }
    setFilter('performance');
    requestAnimationFrame(() => availableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const openMissionActivity = (mission: Mission, locked: boolean) => {
    if (locked) { navigate('/profile/preferences/subscriptions'); return; }
    const kind = missionActivityType(mission);
    if (kind === 'workout') navigate('/musculacao');
    else if (kind === 'cardio') onCardio();
    else navigate('/activity');
  };

  const iconFor = (mission: Mission) => mission.type === 'cardio_minutes' || mission.type === 'cardio_count' ? Footprints : mission.type === 'streak_days' || mission.type === 'consistency_weeks' || mission.type === 'monthly_active_weeks' ? Flame : mission.type === 'workout_count' || mission.type === 'strength_workout_count' ? Dumbbell : CalendarCheck;
  const renderReward = (mission: Mission, item?: UserMissionProgress) => {
    const rewardXP = Number(item?.claimRewardXP ?? item?.rewardXPSnapshot ?? mission.rewardXP) || 0;
    const rewardCoins = Number(item?.claimRewardCoins ?? item?.rewardCoinsSnapshot ?? mission.rewardCoins) || 0;
    return <>{rewardXP > 0 ? <span>{rewardXP.toLocaleString('pt-BR')} XP</span> : null}<span>+ {rewardCoins.toLocaleString('pt-BR')} Invictus Coins <Coins /></span></>;
  };

  return createPortal(<main className="dc-screen"><div className="dc-page">
    <header className="dc-header"><button onClick={() => navigate('/notifications')} aria-label="Notificações"><Bell /></button><div><InvictusLogo size={45} /><b>INVICTUS</b><small>PERFORMANCE</small></div><button className="dc-avatar" onClick={() => navigate('/profile')}>{user?.photoURL ? <img src={user.photoURL} alt="" /> : <UserRound />}{paid ? <em>PRO</em> : null}</button></header>
    <section className="dc-hero"><h1>DESAFIOS</h1><p>Supere limites. Conquiste recompensas.</p><div><Coins /><b>{dashboard ? dashboard.coinWallet.balance.toLocaleString('pt-BR') : '—'}</b><span>Invictus Coins</span></div></section>
    {errorMessage ? <p className="dc-error" role="alert">{errorMessage}</p> : null}
    {statusMessage ? <div className="dc-coin-note" role="status"><ShieldCheck /><span>{statusMessage}</span></div> : null}
    <div className="dc-section-head"><h2>DESAFIOS EM DESTAQUE</h2></div>
    <section className="dc-featured">{featured.map(mission => { const item = progressFor(mission, progress); const Icon = iconFor(mission); const percentage = mission.target > 0 ? Math.min(100, item.currentProgress / mission.target * 100) : 0; const resumableClaim = item.completed && !item.claimed && (mission.isFreeAccess || paid || item.completionAccessGranted === true || item.claimState === 'pending'); const locked = !resumableClaim && !mission.isFreeAccess && !paid; return <article key={mission.id} role="button" tabIndex={0} onClick={() => openMissionActivity(mission, locked)} onKeyDown={event => { if (event.target !== event.currentTarget) return; if (event.key === 'Enter' || event.key === ' ') openMissionActivity(mission, locked); }}><small>DESAFIO {mission.category.toUpperCase()} {mission.isFreeAccess ? '· FREE + PRO' : '· PRO'}</small><Icon /><h3>{mission.title}</h3><p>{mission.description}</p><div className="dc-count"><b>{item.currentProgress}/{mission.target}</b><i><span style={{ width: `${percentage}%` }} /></i></div><div className="dc-reward"><small>RECOMPENSA</small>{renderReward(mission, item)}</div></article>; })}{!loading && featured.length === 0 ? <p className="dc-empty">Nenhum desafio em destaque foi publicado.</p> : null}</section>
    <section className="dc-powerlift-feature"><span><Crown /></span><div><small>DESTAQUE DE FORÇA</small><h2>INVICTUS POWER LIFT</h2><p>Registre seu levantamento em vídeo, passe pela validação inteligente e mostre sua força no ranking.</p><ul><li><Play /> Vídeo obrigatório</li><li><ShieldCheck /> Antifraude por IA</li><li><Trophy /> Ranking por modalidade</li></ul></div><button onClick={() => navigate('/power')}>ENTRAR NO POWER LIFT <ArrowRight /></button></section>
    <div className="dc-section-head"><h2>CATEGORIAS</h2></div><section className="dc-filters">{[
      ['all','TODOS',Target],['workout','MUSCULAÇÃO',Dumbbell],['cardio','CARDIO',Footprints],['performance','PERFORMANCE',BarChart3],['habits','HÁBITOS',Flame],['social','SOCIAIS',Users],
    ].map(([id,label,Icon]: any) => <button key={id} className={filter === id ? 'is-active' : ''} onClick={() => setFilter(id)}><Icon /><span>{label}</span></button>)}</section>
    <div ref={availableRef} className="dc-section-head"><h2>DESAFIOS DISPONÍVEIS</h2><button onClick={onHistory}><History /> HISTÓRICO</button></div>
    {error ? <p className="dc-error">{error}</p> : null}{loading ? <p className="dc-loading">Carregando desafios reais…</p> : <section className="dc-list">{filtered.map(mission => { const item = progressFor(mission, progress); const Icon = iconFor(mission); const percentage = mission.target > 0 ? Math.min(100, item.currentProgress / mission.target * 100) : 0; const resumableClaim = item.completed && !item.claimed && (mission.isFreeAccess || paid || item.completionAccessGranted === true || item.claimState === 'pending'); const locked = !resumableClaim && !mission.isFreeAccess && !paid; return <article key={mission.id} className={locked ? 'is-locked' : ''} role="button" tabIndex={0} onClick={() => openMissionActivity(mission, locked)} onKeyDown={event => { if (event.target !== event.currentTarget) return; if (event.key === 'Enter' || event.key === ' ') openMissionActivity(mission, locked); }}><span className="dc-list-icon"><Icon /></span><div><small>DESAFIO {mission.category.toUpperCase()} {mission.isFreeAccess ? '· FREE + PRO' : '· PRO'}</small><h3>{mission.title}</h3><p>{mission.description}</p></div><div className="dc-list-reward"><small>RECOMPENSA</small>{renderReward(mission, item)}</div><div className="dc-ring" style={{ '--progress': `${percentage * 3.6}deg` } as React.CSSProperties}><span>{locked ? 'PRO' : `${item.currentProgress}/${mission.target}`}</span></div>{locked ? <button onKeyDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); navigate('/profile/preferences/subscriptions'); }}>VER PRO</button> : item.completed && !item.claimed ? <button disabled={claiming === mission.id} onKeyDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); void claim(mission, item); }}>{claiming === mission.id ? '…' : 'RESGATAR'}</button> : item.claimed ? <span className="dc-claimed"><Check />RESGATADO</span> : <ChevronRight />}</article>; })}{filtered.length === 0 ? <p className="dc-empty">Nenhum desafio publicado nesta categoria.</p> : null}</section>}
    <section className="dc-activities"><button onClick={() => navigate('/musculacao')}><Dumbbell /><span><b>INICIAR MUSCULAÇÃO</b>Treino e plano de hoje</span><ArrowRight /></button><button onClick={onCardio}><Footprints /><span><b>INICIAR CARDIO</b>Escolha a modalidade</span><ArrowRight /></button><button onClick={() => navigate('/power')}><Trophy /><span><b>POWER LIFT</b>Desafios de força</span><ArrowRight /></button></section>
    <section className="dc-premium"><Users /><div><h2>DESAFIOS PRIVADOS</h2><p>Crie ou entre em uma disputa com seus parceiros de treino usando o fluxo atual de desafios privados.</p></div><button onClick={onPrivate}>ABRIR DESAFIOS PRIVADOS <ArrowRight /></button></section>
    <section className="dc-premium"><Trophy /><div><h2>DESAFIOS PREMIUM</h2><p>Desafios PRO não oferecem dinheiro: ampliam reconhecimento, XP e Invictus Coins.</p></div><button onClick={openProChallenges}>VER DESAFIOS PRO <ArrowRight /></button></section>
    <div className="dc-coin-note"><ShieldCheck /><span>Invictus Coins são pontos internos de recompensa vinculados ao seu perfil. Não têm valor monetário e não podem ser sacados ou convertidos em dinheiro.</span></div>
  </div><nav className="dc-footer"><button onClick={() => navigate('/')}><InvictusLogo size={24} /><span>Início</span></button><button onClick={() => navigate('/championships')}><Trophy /><span>Campeonatos</span></button><button className="is-plus" onClick={() => navigate('/activity')} aria-label="Escolher modalidade"><Plus /></button><button className="is-active"><ShieldCheck /><span>Desafios</span></button><button onClick={() => navigate('/profile')}><UserRound /><span>Perfil</span></button></nav></main>, document.body);
}
