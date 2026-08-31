import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Bell, Camera, CheckCircle2, Clock, Dumbbell, Flame, HeartPulse, HelpCircle, Landmark, Medal, Plus, Settings, ShieldCheck, Store, Trophy, UserRound, Watch } from 'lucide-react';
import { InvictusLogo } from '../components/InvictusLogo';
import { ACHIEVEMENTS } from '../achievements';
import { useUser } from '../UserContext';
import { workoutService } from '../services/workoutService';
import { userService } from '../services/userService';
import { getXPProgress } from '../lib/levelUtils';
import type { Workout } from '../types';
import './ProfileNew.css';

export function ProfileNew() {
  const navigate = useNavigate();
  const { user, refreshUser } = useUser();
  const inputRef = useRef<HTMLInputElement>(null);
  const [activities, setActivities] = useState<Workout[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { workoutService.getUserWorkouts(500).then(setActivities).catch(reason => setError(reason.message)); }, [user?.uid]);
  const levelProgress = getXPProgress(user?.xp || 0);
  const unlockedIds = new Set([...(user?.badges || []), ...((user as any)?.achievements || [])]);
  const unlocked = ACHIEVEMENTS.filter(item => unlockedIds.has(item.id));
  const totalMinutes = activities.reduce((sum, item) => sum + (Number(item.duration) || 0), 0);
  const totalCalories = activities.reduce((sum, item) => sum + (Number(item.calories) || 0), 0);
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const monthActivities = activities.filter(item => Date.parse(item.timestamp) >= monthStart.getTime());
  const gymPosition = Number(user?.positions?.gym);
  const paid = user?.subscriptionTier === 'performance' || user?.currentPlan === 'performance' || user?.isSubscribed === true || user?.premium === true;
  const joined = (user as any)?.createdAt || (user as any)?.joinedAt || (user as any)?.activatedAt;
  const memberDate = joined && !Number.isNaN(Date.parse(String(joined))) ? new Date(joined).toLocaleDateString('pt-BR') : '—';

  const recent = useMemo(() => activities.slice(0, 4), [activities]);
  const upload = async (event: ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (!file) return; setUploading(true); setError(null); try { await userService.updateProfilePhoto(file); await refreshUser(); } catch (reason: any) { setError(reason.message); } finally { setUploading(false); event.target.value = ''; } };
  const activityName = (item: Workout) => item.type === 'cardio' ? (item.cardioTypeLabel || 'Cardio') : 'Musculação';
  const activityDetail = (item: Workout) => item.type === 'cardio' ? (item.cardioTypeLabel || item.cardioType || 'Atividade validada') : (item.muscleGroup || 'Treino validado');

  return createPortal(<main className="np-screen"><div className="np-page"><input ref={inputRef} type="file" accept="image/*" hidden onChange={upload} />
    <header className="np-header"><button onClick={() => navigate('/notifications')} aria-label="Notificações"><Bell /></button><div><InvictusLogo size={45} /><b>INVICTUS</b><small>PERFORMANCE</small></div><button className="np-head-avatar" onClick={() => inputRef.current?.click()} disabled={uploading} aria-label="Alterar foto do perfil">{user?.photoURL ? <img src={user.photoURL} alt="" /> : <UserRound />}{paid ? <em>PRO</em> : null}</button></header>
    <section className="np-title"><h1>MEU <span>PERFIL</span></h1><p>Sua jornada. Sua evolução.</p></section>
    <section className="np-identity"><button className="np-photo" onClick={() => inputRef.current?.click()} disabled={uploading}>{user?.photoURL ? <img src={user.photoURL} alt={`Foto de ${user.displayName || 'atleta'}`} /> : <UserRound />}<i><Camera /></i></button><div className="np-name"><h2>{(user?.displayName || user?.name || 'ATLETA INVICTUS').toUpperCase()} {paid ? <em>PRO</em> : null}</h2><p>Invictus desde {memberDate}</p><span><ShieldCheck /> {user?.gymName || 'Nenhuma academia vinculada'}</span></div><aside><InvictusLogo size={36} /><small>NÍVEL</small><b>{levelProgress.currentLevel}</b><span>INVICTUS</span></aside><div className="np-xp"><span>{(user?.xp || 0).toLocaleString('pt-BR')} / {levelProgress.xpCeiling.toLocaleString('pt-BR')} XP</span><i><b style={{ width: `${levelProgress.percentage}%` }} /></i><small>Próximo nível: {Math.max(0, levelProgress.xpCeiling - (user?.xp || 0)).toLocaleString('pt-BR')} XP</small></div></section>
    {error ? <p className="np-error">{error}</p> : null}
    <section className="np-stats"><article><Flame /><small>IGA ATUAL</small><b>{Number.isFinite(Number(user?.score)) ? Math.round(Number(user?.score)) : '—'}</b><span>Pontuação validada</span></article><article><Trophy /><small>RANKING</small><b>{gymPosition > 0 ? `#${gymPosition}` : '—'}</b><span>Posição na academia</span></article><article><Dumbbell /><small>TREINOS</small><b>{activities.length || '—'}</b><span>{monthActivities.length} este mês</span></article><article><Clock /><small>TEMPO TOTAL</small><b>{totalMinutes > 0 ? `${Math.floor(totalMinutes / 60)}h` : '—'}</b><span>Atividades validadas</span></article><article><HeartPulse /><small>CALORIAS</small><b>{totalCalories > 0 ? Math.round(totalCalories).toLocaleString('pt-BR') : '—'}</b><span>Total registrado</span></article></section>
    <div className="np-section-head"><h2>MINHAS CONQUISTAS</h2><button onClick={() => navigate('/achievements')}>VER TODAS <ArrowRight /></button></div><section className="np-achievements">{unlocked.slice(0,5).map(item => <article key={item.id}><Medal /><b>{item.name}</b><span>{item.description}</span></article>)}{unlocked.length === 0 ? <p>Nenhuma conquista desbloqueada ainda.</p> : null}</section>
    <div className="np-section-head"><h2>ATIVIDADE RECENTE</h2><button onClick={() => navigate('/challenges?view=history')}>VER HISTÓRICO <ArrowRight /></button></div><section className="np-recent">{recent.map(item => <article key={item.id}><span>{item.type === 'cardio' ? <Flame /> : <Dumbbell />}</span><div><b>{activityName(item)}</b><small>{activityDetail(item)}</small></div><p><Clock />{item.duration ? `${Math.round(item.duration)} min` : '—'}</p><p><Flame />{item.calories ? `${Math.round(item.calories)} kcal` : '—'}</p><time>{new Date(item.timestamp).toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'})}</time><CheckCircle2 /></article>)}{recent.length === 0 ? <p>Nenhuma atividade validada registrada.</p> : null}</section>
    <div className="np-section-head"><h2>CONFIGURAÇÕES</h2></div><section className="np-menu"><button onClick={() => navigate('/profile/preferences')}><UserRound /><span>Minha conta</span></button><button onClick={() => navigate('/profile/academy')}><Landmark /><span>Academia</span></button><button onClick={() => navigate('/profile/wearables')}><Watch /><span>Dispositivos</span></button><button onClick={() => navigate('/health')}><HeartPulse /><span>Saúde</span></button><button onClick={() => navigate('/profile/preferences')}><Settings /><span>Preferências</span></button><button onClick={() => navigate('/profile/preferences/faq')}><HelpCircle /><span>Ajuda</span></button><button onClick={() => navigate('/store')}><Store /><span>Loja Invictus</span></button></section>
  </div><nav className="np-footer"><button onClick={() => navigate('/')}><InvictusLogo size={24} /><span>Início</span></button><button onClick={() => navigate('/championships')}><Trophy /><span>Campeonatos</span></button><button className="is-plus" onClick={() => navigate('/musculacao')}><Plus /></button><button onClick={() => navigate('/challenges')}><ShieldCheck /><span>Desafios</span></button><button className="is-active"><UserRound /><span>Perfil</span></button></nav></main>, document.body);
}
