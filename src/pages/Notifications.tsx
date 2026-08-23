import { Bell, CheckCheck, ChevronRight, CircleInfo, Dumbbell, Gift, Medal, Settings, ShieldCheck, TrendingUp } from 'lucide-react';
import { doc, updateDoc } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { db } from '../firebase';
import { useUser } from '../UserContext';

const notificationIcons = {
  ranking: TrendingUp,
  payment: Gift,
  achievement: Medal,
  social: Dumbbell,
  system: ShieldCheck,
};

export function Notifications() {
  const navigate = useNavigate();
  const { user, refreshUser } = useUser();
  const notifications = user?.notifications || [];

  const markAsRead = async (id: string) => {
    if (!user) return;
    await updateDoc(doc(db, 'users', user.uid), { notifications: notifications.map((item) => item.id === id ? { ...item, read: true } : item) });
    await refreshUser();
  };

  const markAllAsRead = async () => {
    if (!user || !notifications.some((item) => !item.read)) return;
    await updateDoc(doc(db, 'users', user.uid), { notifications: notifications.map((item) => ({ ...item, read: true })) });
    await refreshUser();
  };

  return (
    <main className="notifications-screen">
      <header className="notifications-header">
        <button className="notifications-icon-button" onClick={() => navigate(-1)} aria-label="Voltar"><ChevronRight className="notifications-back" /></button>
        <h1>NOTIFICAÇÕES</h1>
        <button className="notifications-icon-button" onClick={() => navigate('/settings')} aria-label="Configurações"><Settings /></button>
      </header>

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
            return <button className={`notification-row ${notification.read ? 'is-read' : ''}`} key={notification.id} onClick={() => markAsRead(notification.id)}>
              <span className="notification-row-icon"><Icon /></span>
              <span className="notification-row-copy"><b>{notification.title}</b><small>{notification.message}</small></span>
              {!notification.read && <span className="notification-unread" aria-label="Não lida" />}
            </button>;
          })}
          {notifications.some((notification) => !notification.read) && <button className="notifications-read-all" onClick={markAllAsRead}><CheckCheck /> MARCAR TODAS COMO LIDAS</button>}
        </section>
      )}
      <p className="notifications-data-note"><CircleInfo /> Notificações só aparecem quando geradas por uma ação real no app.</p>
    </main>
  );
}
