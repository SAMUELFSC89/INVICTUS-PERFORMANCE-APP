import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Bell, Brain, Camera, CheckCircle2, Clock, Coins, Crown, Dumbbell, Flame, HeartPulse, HelpCircle, ImagePlus, Landmark, Medal, Plus, Settings, ShieldCheck, Trash2, Trophy, UserRound, Watch, X } from 'lucide-react';
import { InvictusLogo } from '../components/InvictusLogo';
import { ACHIEVEMENTS } from '../achievements';
import { useUser } from '../UserContext';
import { missionService } from '../services/missionService';
import { workoutService } from '../services/workoutService';
import { userService } from '../services/userService';
import { getXPProgress } from '../lib/levelUtils';
import type { Workout } from '../types';
import { hasActiveProEntitlement } from '../lib/proEntitlement';
import { compressImage } from '../lib/utils';
import './ProfileNew.css';
import './ProfilePhotoMenu.css';

export function ProfileNew() {
  const navigate = useNavigate();
  const { user, refreshUser } = useUser();
  const inputRef = useRef<HTMLInputElement>(null);
  const [activities, setActivities] = useState<Workout[]>([]);
  const [coinBalance, setCoinBalance] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [photoMenuOpen, setPhotoMenuOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { workoutService.getUserWorkouts(500).then(setActivities).catch(reason => setError(reason.message)); }, [user?.uid]);
  useEffect(() => {
    let active = true;
    if (!user?.uid) {
      setCoinBalance(null);
      return () => { active = false; };
    }
    void missionService.dashboard()
      .then(data => {
        if (!active) return;
        const balance = Number(data.coinWallet?.balance);
        setCoinBalance(Number.isFinite(balance) ? Math.max(0, balance) : 0);
      })
      .catch(() => {
        if (active) setCoinBalance(null);
      });
    return () => { active = false; };
  }, [user?.uid]);

  const levelProgress = getXPProgress(user?.xp || 0);
  const unlockedIds = new Set([...(user?.badges || []), ...((user as any)?.achievements || [])]);
  const unlocked = ACHIEVEMENTS.filter(item => unlockedIds.has(item.id));
  const totalMinutes = activities.reduce((sum, item) => sum + (Number(item.duration) || 0), 0);
  const totalCalories = activities.reduce((sum, item) => sum + (Number(item.calories) || 0), 0);
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const monthActivities = activities.filter(item => Date.parse(item.timestamp) >= monthStart.getTime());
  const gymPosition = Number(user?.positions?.gym);
  const paid = hasActiveProEntitlement(user);
  const joined = (user as any)?.createdAt || (user as any)?.joinedAt || (user as any)?.activatedAt;
  const memberDate = joined && !Number.isNaN(Date.parse(String(joined))) ? new Date(joined).toLocaleDateString('pt-BR') : '—';

  const recent = useMemo(() => activities.slice(0, 4), [activities]);
  const choosePhoto = () => { setPhotoMenuOpen(false); inputRef.current?.click(); };
  const openPhotoMenu = () => user?.photoURL ? setPhotoMenuOpen(true) : choosePhoto();
  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true); setError(null); setNotice(null);
    try {
      const supportedSource = /^image\/(jpeg|jpg|png|webp)$/i.test(file.type);
      let compressed: Blob;
      try {
        compressed = await compressImage(file, 800, 0.82);
      } catch (compressionError) {
        if (!supportedSource || file.size > 5 * 1024 * 1024) throw compressionError;
        compressed = file;
      }
      await userService.updateProfilePhoto(compressed);
      await refreshUser();
      setNotice('Foto de perfil atualizada.');
    } catch (reason: any) {
      setError(reason?.message || 'Não foi possível atualizar sua foto.');
    } finally {
      setUploading(false); event.target.value = '';
    }
  };
  const removePhoto = async () => {
    if (!user?.photoURL || uploading || !window.confirm('Remover sua foto de perfil?')) return;
    setPhotoMenuOpen(false); setUploading(true); setError(null); setNotice(null);
    try {
      await userService.removeProfilePhoto();
      await refreshUser();
      setNotice('Foto de perfil removida.');
    } catch (reason: any) {
      setError(reason?.message || 'Não foi possível remover sua foto.');
    } finally {
      setUploading(false);
    }
  };
  const activityName = (item: Workout) => item.type === 'cardio' ? (item.cardioTypeLabel || 'Cardio') : 'Musculação';
  const activityDetail = (item: Workout) => item.type === 'cardio' ? (item.cardioTypeLabel || item.cardioType || 'Atividade concluída') : (item.muscleGroup || 'Treino concluído');
  const openRecentActivity = (item: Workout) => navigate(`/challenges?view=history&activity=${encodeURIComponent(item.id)}&source=workout`);

  return createPortal(<main className="np-screen"><div className="np-page"><input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={upload} />
    <header className="np-header"><button onClick={() => navigate('/notifications')} aria-label="Notificações"><Bell /></button><div><InvictusLogo size={45} /><b>INVICTUS</b><small>PERFORMANCE</small></div><button className="np-head-avatar" onClick={openPhotoMenu} disabled={uploading} aria-label={user?.photoURL ? 'Opções da foto do perfil' : 'Adicionar foto do perfil'}>{user?.photoURL ? <img src={user.photoURL} alt="" /> : <UserRound />}{paid ? <em>PRO</em> : null}</button></header>
    <section className="np-title"><h1>MEU <span>PERFIL</span></h1><p>Sua jornada. Sua evolução.</p></section>
    <section className="np-identity"><button className="np-photo" onClick={openPhotoMenu} disabled={uploading} aria-label={user?.photoURL ? 'Opções da foto do perfil' : 'Adicionar foto do perfil'}>{user?.photoURL ? <img src={user.photoURL} alt={`Foto de ${user.displayName || 'atleta'}`} /> : <UserRound />}<i><Camera /></i></button><div className="np-name"><h2>{(user?.displayName || user?.name || 'ATLETA INVICTUS').toUpperCase()} {paid ? <em>PRO</em> : null}</h2><p>Invictus desde {memberDate}</p><span><ShieldCheck /> {user?.gymName || 'Nenhuma academia vinculada'}</span></div><aside><InvictusLogo size={36} /><small>NÍVEL</small><b>{levelProgress.currentLevel}</b><span>INVICTUS</span></aside><div className="np-xp"><span>{(user?.xp || 0).toLocaleString('pt-BR')} / {levelProgress.xpCeiling.toLocaleString('pt-BR')} XP</span><i><b style={{ width: `${levelProgress.percentage}%` }} /></i><small>Próximo nível: {Math.max(0, levelProgress.xpCeiling - (user?.xp || 0)).toLocaleString('pt-BR')} XP</small></div></section>
    {uploading ? <p className="np-notice" role="status">Enviando foto…</p> : null}
    {error ? <p className="np-error" role="alert">{error}</p> : null}
    {notice ? <p className="np-notice" role="status">{notice}</p> : null}
    <section className="np-stats"><article><Flame /><small>IGA ATUAL</small><b>{Number.isFinite(Number(user?.score)) ? Math.round(Number(user?.score)) : '—'}</b><span>Pontuação competitiva validada</span></article><article className="np-coins"><Coins /><small>INVICTUS COINS</small><b>{coinBalance === null ? '—' : coinBalance.toLocaleString('pt-BR')}</b><span>Saldo de recompensas</span></article><article><Trophy /><small>RANKING</small><b>{gymPosition > 0 ? `#${gymPosition}` : '—'}</b><span>Posição na academia</span></article><article><Dumbbell /><small>TREINOS</small><b>{activities.length || '—'}</b><span>{monthActivities.length} este mês</span></article><article><Clock /><small>TEMPO TOTAL</small><b>{totalMinutes > 0 ? `${Math.floor(totalMinutes / 60)}h` : '—'}</b><span>Atividades concluídas</span></article><article><HeartPulse /><small>CALORIAS</small><b>{totalCalories > 0 ? Math.round(totalCalories).toLocaleString('pt-BR') : '—'}</b><span>Total registrado</span></article></section>
    <div className="np-section-head"><h2>MINHAS CONQUISTAS</h2><button onClick={() => navigate('/achievements')}>VER TODAS <ArrowRight /></button></div><section className="np-achievements">{unlocked.slice(0,5).map(item => <article key={item.id}><Medal /><b>{item.name}</b><span>{item.description}</span></article>)}{unlocked.length === 0 ? <p>Nenhuma conquista desbloqueada ainda.</p> : null}</section>
    <div className="np-section-head"><h2>ATIVIDADE RECENTE</h2><button onClick={() => navigate('/challenges?view=history')}>VER HISTÓRICO <ArrowRight /></button></div><section className="np-recent">{recent.map(item => <button type="button" className="np-recent-card" key={item.id} onClick={() => openRecentActivity(item)} aria-label={`Abrir detalhes de ${activityName(item)}`}><span>{item.type === 'cardio' ? <Flame /> : <Dumbbell />}</span><div><b>{activityName(item)}</b><small>{activityDetail(item)}</small></div><p><Clock />{item.duration ? `${Math.round(item.duration)} min` : '—'}</p><p><Flame />{item.calories ? `${Math.round(item.calories)} kcal` : '—'}</p><time>{new Date(item.timestamp).toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'})}</time><CheckCircle2 /></button>)}{recent.length === 0 ? <p>Nenhuma atividade concluída registrada.</p> : null}</section>
    <div className="np-section-head"><h2>CONFIGURAÇÕES</h2></div><section className="np-menu"><button className="np-menu-pro" onClick={() => navigate('/profile/preferences/subscriptions', { state: { returnTo: '/profile' } })}><Crown /><span>{paid ? 'Assinatura PRO' : 'Virar PRO'}</span></button><button onClick={() => navigate('/profile/preferences')}><UserRound /><span>Minha conta</span></button><button onClick={() => navigate('/profile/academy')}><Landmark /><span>Academia</span></button><button onClick={() => navigate('/profile/wearables')}><Watch /><span>Dispositivos</span></button><button onClick={() => navigate('/health')}><HeartPulse /><span>Saúde</span></button><button onClick={() => navigate('/ai')}><Brain /><span>Invictus IA</span></button><button onClick={() => navigate('/profile/preferences')}><Settings /><span>Preferências</span></button><button onClick={() => navigate('/profile/preferences/faq')}><HelpCircle /><span>Ajuda</span></button></section>
  </div><nav className="np-footer"><button onClick={() => navigate('/')}><InvictusLogo size={24} /><span>Início</span></button><button onClick={() => navigate('/championships')}><Trophy /><span>Campeonatos</span></button><button className="is-plus" onClick={() => navigate('/activity')} aria-label="Escolher modalidade"><Plus /></button><button onClick={() => navigate('/challenges')}><ShieldCheck /><span>Desafios</span></button><button className="is-active"><UserRound /><span>Perfil</span></button></nav>
    {photoMenuOpen ? <div className="np-photo-menu-backdrop" role="presentation" onClick={() => setPhotoMenuOpen(false)}><section className="np-photo-menu" role="dialog" aria-modal="true" aria-labelledby="np-photo-menu-title" onClick={event => event.stopPropagation()}><header><div><small>FOTO DO PERFIL</small><h2 id="np-photo-menu-title">ESCOLHA UMA AÇÃO</h2></div><button onClick={() => setPhotoMenuOpen(false)} aria-label="Fechar"><X /></button></header><button className="is-change" onClick={choosePhoto}><ImagePlus /><span><b>Trocar foto</b><small>Escolher uma imagem do dispositivo</small></span></button><button className="is-remove" onClick={removePhoto}><Trash2 /><span><b>Remover foto</b><small>Voltar para o avatar padrão</small></span></button></section></div> : null}
  </main>, document.body);
}
