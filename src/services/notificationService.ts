import { auth } from '../firebase';
import { SocialNotification } from '../types';

/**
 * CONSOLIDATED NOTIFICATION CLIENT
 * ---------------------------------
 * This used to write directly into a top-level Firestore "notifications"
 * collection (recipientId/senderId shape) that NO UI component ever read -
 * a dead end. getNotifications()/listenToNotifications() existed but had
 * zero call sites anywhere in the app.
 *
 * It now calls POST /api/notifications, which is the single real pipe into
 * users/{uid}.notifications (the array actually read by the Bell icon /
 * NotificationCenter.tsx) AND sends a real push notification via FCM.
 */

const TITLES: Record<string, string> = {
  like: 'Nova curtida 🔥',
  comment: 'Novo comentário 💬',
  follow: 'Novo seguidor 👥',
  achievement: 'Conquista desbloqueada 🏆',
};

async function postNotification(body: Record<string, any>): Promise<boolean> {
  const user = auth.currentUser;
  if (!user) return false;
  if (body.recipientId && body.recipientId !== user.uid) {
    // Eventos sociais para terceiros precisam ser criados por uma função
    // confiável no servidor. O cliente autenticado não pode escolher destino.
    console.warn('[Notifications] Envio para outro usuário bloqueado no cliente.');
    return false;
  }
  try {
    const token = await user.getIdToken();
    const response = await fetch('/api/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error('Servidor recusou a notificação.');
    return true;
  } catch (error) {
    console.error('Error creating notification:', error);
    return false;
  }
}

export const notificationService = {
  /**
   * Signature kept identical to the old implementation
   * (recipientId, senderId, type, postId?, message?, senderInfo?) so every
   * existing call site (socialService.ts, achievementService.ts) works
   * unchanged - only the internals moved to the real, unified pipe.
   */
  async createNotification(
    recipientId: string,
    senderId: string,
    type: SocialNotification['type'],
    postId?: string,
    message?: string,
    senderInfo?: { name: string; photoURL?: string }
  ) {
    const senderName = senderInfo?.name || 'Alguém';
    const title = TITLES[type] || 'Nova notificação';

    let body = message || '';
    if (type === 'like') body = `${senderName} curtiu sua publicação`;
    if (type === 'follow') body = `${senderName} começou a seguir você`;
    if (type === 'comment') body = `${senderName} comentou: "${message || ''}"`;
    // 'achievement' already arrives with a fully-formatted message from achievementService.ts

    return postNotification({
      recipientId,
      type: type === 'achievement' ? 'achievement' : 'social',
      title,
      message: body,
      actionUrl: postId ? `/social?post=${postId}` : undefined,
    });
  },
};
