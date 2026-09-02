import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, BarChart3, Bell, Brain, Dumbbell, Flame, HeartPulse, Plus, ShieldCheck, Target, Trophy, UserRound } from 'lucide-react';
import { InvictusLogo } from '../components/InvictusLogo';
import { useUser } from '../UserContext';
import { workoutService } from '../services/workoutService';
import { workoutPlanService } from '../services/workoutPlanService';
import { communityChampionshipService } from '../services/communityChampionshipService';
import type { Workout } from '../types';
import type { WorkoutPlan } from '../types/workoutPlan';
import './Home.css';

const weekStart = () => { const d = new Date(); const day = d.getDay(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (day === 0 ? 6 : day - 1)); return d.getTime(); };

export function Home() {
  const navigate = useNavigate();
  const { user } = useUser();
  const [activities, setActivities] = useState<Workout[]>([]);
  const [plan, setPlan] = useState<WorkoutPlan | null>(null);
  const [championship, setChampionship] = useState<{ rank: number | null; prizes: { 1: number } } | null>(null);

  useEffect(() => {
    let mounted = true;
    Promise.all([workoutService.getUserWorkouts(100), workoutPlanService.list(), communityChampionshipService.status().catch(() => null)]).then(([workouts, plans, championshipStatus]) => {
      if (!mounted) return;
      setActivities(workouts);
      setPlan(plans.find(item => item.status === 'active') || null);
      setChampionship(championshipStatus?.championship ? { rank: championshipStatus.championship.rank, prizes: championshipStatus.championship.prizes } : null);
    }).catch(error => console.warn('[Home] Falha ao carregar resumo real:', error));
    return () => { mounted = false; };
  }, [user?.uid]);

  const firstName = (user?.displayName || user?.name || 'Atleta').trim().split(/\s+/)[0];
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'BOM DIA' : hour < 18 ? 'BOA TARDE' : 'BOA NOITE';
  const weekActivities = useMemo(() => activities.filter(item => Date.parse(item.timestamp) >= weekStart()), [activities]);
  const weekDays = new Set(weekActivities.filter(item => item.type === 'workout').map(item => new Date(item.timestamp).getDay())).size;
  const calories = weekActivities.reduce((sum, item) => sum + (Number(item.calories) || 0), 0);
  const activeMinutes = weekActivities.reduce((sum, item) => sum + (Number(item.duration) || 0), 0);
  const target = plan?.daysPerWeek || 0;
  const targetPercent = target ? Math.min(100, Math.round((weekDays / target) * 100)) : null;
  const today = new Date().getDay();
  const nextWorkout = plan?.workouts.find(workout => workout.weekdays.includes(today)) || plan?.workouts[0] || null;
  const gymPosition = Number(user?.positions?.gym);
  const iga = Number(user?.score);
  const paid = user?.subscriptionTier === 'performance' || user?.currentPlan === 'performance' || user?.isSubscribed === true || user?.premium === true;

  return createPortal(<main className="nh-screen"><div className="nh-page">
    <header className="nh-header"><button onClick={() => navigate('/notifications')} aria-label="Notificações"><Bell />{user?.notifications?.some(item => !item.read) ? <i /> : null}</button><div><InvictusLogo size={45} /><b>INVICTUS</b><small>PERFORMANCE</small></div><button className="nh-avatar" onClick={() => navigate('/profile')} aria-label="Perfil">{user?.photoURL ? <img src={user.photoURL} alt="" /> : <UserRound />}{paid ? <em>PRO</em> : null}</button></header>
    <section className="nh-greeting"><h1>{greeting}, {firstName.toUpperCase()}!</h1><p>Cada treino te aproxima da sua melhor versão.</p></section>
    <section className="nh-season"><div><small>TEMPORADA INVICTUS</small><h2>TREINE. EVOLUA. SUPERE.</h2><p>Mostre sua força. Supere seus limites.</p><button onClick={() => navigate('/championships')}>VER MAIS <ArrowRight /></button></div></section>
    <h2 className="nh-title">O QUE VOCÊ QUER FAZER?</h2><section className="nh-actions"><article><Dumbbell /><h3>MUSCULAÇÃO</h3><p>Seu plano, cargas e evolução.</p><button onClick={() => navigate('/musculacao')}>COMEÇAR <ArrowRight /></button></article><article><Flame /><h3>CARDIO</h3><p>Corrida, bike e atividades ao ar livre.</p><button onClick={() => navigate('/challenges/cardio')}>COMEÇAR <ArrowRight /></button></article></section>
    <h2 className="nh-title">HOJE</h2><section className={`nh-next ${plan && nextWorkout ? '' : 'is-empty'}`}><span><Dumbbell /></span><div><small>SEU PRÓXIMO TREINO</small><h3>{nextWorkout?.focus || nextWorkout?.name || 'PLANO AINDA NÃO CRIADO'}</h3><p>{plan && nextWorkout ? `${nextWorkout.name} · ~${plan.durationMinutes} min · ${nextWorkout.exercises.length} exercícios` : 'Crie manualmente ou com a Invictus IA.'}</p></div><button onClick={() => navigate('/musculacao')}>{plan ? 'INICIAR TREINO' : 'CRIAR PLANO'} <ArrowRight /></button></section>
    <section className="nh-progress-grid"><article className="nh-week"><h3>SUA SEMANA</h3><div className="nh-days">{['SEG','TER','QUA','QUI','SEX','SÁB','DOM'].map((label,index) => { const jsDay = index === 6 ? 0 : index + 1; const done = weekActivities.some(item => item.type === 'workout' && new Date(item.timestamp).getDay() === jsDay); return <span key={label}><b>{label}</b><i className={done ? 'is-done' : ''}>{done ? '✓' : ''}</i></span>; })}</div><p><b>{weekDays} treino{weekDays === 1 ? '' : 's'} realizado{weekDays === 1 ? '' : 's'}</b>{target ? `Meta: ${target} treinos` : 'Defina um plano para acompanhar a meta'}</p><strong>{targetPercent !== null ? `${targetPercent}%` : '—'}</strong><div className="nh-bar"><i style={{width:`${targetPercent || 0}%`}} /></div></article><article className="nh-rank"><h3>CAMPEONATO DA ACADEMIA</h3><Trophy /><strong>{championship?.rank ? `#${championship.rank}` : Number.isFinite(gymPosition) && gymPosition > 0 ? `#${gymPosition}` : '—'}</strong><span>SUA POSIÇÃO</span><em>1º LUGAR — {(championship?.prizes[1] || 2500).toLocaleString('pt-BR')} COINS</em><small>{Number.isFinite(iga) ? `${Math.round(iga)} IGA · mesma regra FREE e PRO` : 'Entre no ranking para acompanhar'}</small><button onClick={() => navigate('/championships/community')}>VER CAMPEONATO <ArrowRight /></button></article></section>
    <section className="nh-metrics"><article><Flame /><b>{calories > 0 ? Math.round(calories).toLocaleString('pt-BR') : '—'}</b><span>KCAL GASTAS</span></article><article><HeartPulse /><b>{activeMinutes > 0 ? `${Math.floor(activeMinutes / 60)}h${String(Math.round(activeMinutes % 60)).padStart(2,'0')}` : '—'}</b><span>TEMPO ATIVO</span></article><article><Target /><b>{targetPercent !== null ? `${targetPercent}%` : '—'}</b><span>FOCO DA META</span></article></section>
    <h2 className="nh-title">ACESSOS RÁPIDOS</h2><section className="nh-quick"><button onClick={() => navigate('/championships')}><Trophy /><span>Campeonatos</span></button><button onClick={() => navigate('/challenges')}><ShieldCheck /><span>Desafios</span></button><button onClick={() => navigate('/performance')}><BarChart3 /><span>Progresso</span></button><button onClick={() => navigate('/health')}><HeartPulse /><span>Saúde</span></button><button onClick={() => navigate('/ai')}><Brain /><span>Invictus IA</span></button></section>
  </div><nav className="nh-footer"><button className="is-active"><InvictusLogo size={24} /><span>Início</span></button><button onClick={() => navigate('/championships')}><Trophy /><span>Campeonatos</span></button><button className="is-plus" onClick={() => navigate('/musculacao')} aria-label="Abrir musculação"><Plus /></button><button onClick={() => navigate('/challenges')}><ShieldCheck /><span>Desafios</span></button><button onClick={() => navigate('/profile')}><UserRound /><span>Perfil</span></button></nav></main>, document.body);
}

export default Home;
