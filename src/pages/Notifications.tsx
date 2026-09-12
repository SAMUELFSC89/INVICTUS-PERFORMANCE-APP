import { Bell, CheckCheck, ChevronLeft, Dumbbell, Gift, Info, Medal, Plus, ShieldCheck, TrendingUp, Trophy, UserRound } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { auth } from '../firebase';
import { API_CONFIG } from '../config';
import { useUser } from '../UserContext';
import { InvictusLogo } from '../components/InvictusLogo';
import './NotificationsNew.css';

const notificationIcons = {
  ranking: TrendingUp,
  payment: Gift,
  achievement: Medal,
  social: Dumbbell,
  system: ShieldCheck,
};

function safeInternalActionUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const path = value.trim();
  if (!path.startsWith('/') || path.startsWith('//')) return null;
  return path;
}

function fallbackNotificationRoute(type: string): string | null {
  if (type === 'ranking') return '/championships';
  if (type === 'achievement') return '/achievements';
  return null;
}

async function notificationAction(expectedUid: string, body: Record<string, unknown>): Promise<void> {
  const account = auth.currentUser;
  if (!account || account.uid !== expectedUid) throw new Error('A conta mudou.');
  const token = await account.getIdToken();
  if (auth.currentUser?.uid !== expectedUid) throw new Error('A conta mudou.');
  const response = await fetch(`${API_CONFIG.baseUrl || ''}/api/notifications`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (auth.currentUser?.uid !== expectedUid) throw new Error('A conta mudou.');
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload?.error || 'Não foi possível atualizar as notificações.');
  }
}

export function Notifications() {
  const navigate = useNavigate();
  const { user, refreshUser } = useUser();
  const notifications = user?.notifications || [];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const markAsRead = async (id: string): Promise<boolean> => {
    if (!user || busy) return false;
    const expectedUid = user.uid;
    setBusy(true);
    setError(null);
    try {
      await notificationAction(expectedUid, { action: 'mark-read', notificationId: id });
      if (auth.currentUser?.uid !== expectedUid) return false;
      await refreshUser();
      return auth.currentUser?.uid === expectedUid;
    } catch (err) {
      console.warn('[Notifications] Não foi possível marcar como lida:', err);
      if (auth.currentUser?.uid === expectedUid) setError('Não foi possível atualizar esta notificação. Tente novamente.');
      return false;
    } finally {
      if (auth.currentUser?.uid === expectedUid) setBusy(false);
    }
  };

  const openNotification = async (notification: (typeof notifications)[number]) => {
    const persisted = notification.read ? true : await markAsRead(notification.id);
    if (!persisted) return;
    const actionUrl = safeInternalActionUrl((notification as any).actionUrl);
    const target = actionUrl || fallbackNotificationRoute(String(notification.type || ''));
    if (target) navigate(target);
  };

  const markAllAsRead = async () => {
    if (!user || busy) return;
    const unreadAtClick = notifications.filter((item) => !item.read).map((item) => item.id);
    if (!unreadAtClick.length) return;
    const expectedUid = user.uid;
    setBusy(true);
    setError(null);
    try {
      // O backend recebe só os IDs que estavam não lidos no clique. Se uma
      // notificação nova chegar durante a requisição, ela continua não lida.
      await notificationAction(expectedUid, { action: 'mark-all-read', notificationIds: unreadAtClick });
      if (auth.currentUser?.uid !== expectedUid) return;
      await refreshUser();
    } catch (err) {
      console.warn('[Notifications] Não foi possível marcar todas como lidas:', err);
      if (auth.currentUser?.uid === expectedUid) setError('Não foi possível atualizar as notificações. Tente novamente.');
    } finally {
      if (auth.currentUser?.uid === expectedUid) setBusy(false);
    }
  };

  return createPortal(
    <main className="notifications-screen notifications-screen-new">
      <header className="notifications-header">
        <button className="notifications-icon-button" onClick={() => navigate('/')} aria-label="Voltar para o início"><ChevronLeft /></button>
        <div><InvictusLogo size={42} /><span><b>INVICTUS</b><small>PERFORMANCE</small></span></div>
        <span />
      </header>

      <section className="notifications-title"><Bell /><div><small>CENTRAL INVICTUS</small><h1>NOTIFICAÇÕES</h1><p>Acompanhe somente atualizações reais da sua conta e das suas atividades.</p></div></section>

      {error && <p className="notifications-data-note text-rose-300" role="alert"><Info /> {error}</p>}

      {notifications.length === 0 ? (
        <section className="notifications-empty" aria-label="Nenhuma notificação">
          <Bell />
          <h2>TUDO EM DIA</h2>
          <p>Você não possui notificações no momento.</p>
          <span>Novidades sobre treinos, desafios, ranking e sistema aparecerão aqui.</span>
        </section>
      ) : (
        <section className="notifications-list" aria-label="Lista de notificações">
          {notifications.map((notification) => {
            const Icon = notificationIcons[notification.type] || ShieldCheck;
            return <button disabled={busy} className={`notification-row ${notification.read ? 'is-read' : ''}`} key={notification.id} onClick={() => void openNotification(notification)}>
              <span className="notification-row-icon"><Icon /></span>
              <span className="notification-row-copy"><b>{notification.title}</b><small>{notification.message}</small></span>
              {!notification.read && <span className="notification-unread" aria-label="Não lida" />}
            </button>;
          })}
          {notifications.some((notification) => !notification.read) && <button disabled={busy} className="notifications-read-all" onClick={markAllAsRead}><CheckCheck /> MARCAR TODAS COMO LIDAS</button>}
        </section>
      )}
      <p className="notifications-data-note"><Info /> Notificações só aparecem quando geradas por uma ação real no app.</p>
      <nav className="notifications-footer"><button onClick={() => navigate('/')}><InvictusLogo size={24} /><span>Início</span></button><button onClick={() => navigate('/championships')}><Trophy /><span>Campeonatos</span></button><button className="is-plus" onClick={() => navigate('/activity')} aria-label="Escolher modalidade"><Plus /></button><button onClick={() => navigate('/challenges')}><ShieldCheck /><span>Desafios</span></button><button onClick={() => navigate('/profile')}><UserRound /><span>Perfil</span></button></nav>
    </main>,
    document.body,
  );
}
