import { db, app, FieldValue } from '../_lib/common.js';
import { getMessaging } from 'firebase-admin/messaging';

/**
 * UNIFIED NOTIFICATION SYSTEM
 * ---------------------------
 * Single entry point for every notification the app sends, in-app or push.
 * Before this, the codebase had 3 separate, disconnected notification paths:
 *   1) This file (barely wired, 1 call site, no push).
 *   2) A top-level "notifications" Firestore collection + client
 *      src/services/notificationService.ts (written by likes/comments/
 *      follows/achievements, but never read by any UI -> dead end).
 *   3) users/{uid}.notifications array, read by the Bell/NotificationCenter
 *      UI, but nothing ever wrote NEW entries into it -> permanently empty.
 * This service consolidates all of that into ONE write path: it appends to
 * users/{uid}.notifications (the array the Bell UI actually reads) AND sends
 * a real FCM push to every device token registered for that user.
 */

export type NotificationType = 'ranking' | 'payment' | 'system' | 'achievement' | 'social';

export interface NotificationPayload {
  userId: string;
  title: string;
  message?: string;
  body?: string; // legacy alias, kept for the old send() signature
  type?: NotificationType | string;
  actionUrl?: string;
  data?: Record<string, string>;
}

const MAX_STORED_NOTIFICATIONS = 50;

export class NotificationService {
  /**
   * Writes an in-app notification (Bell/NotificationCenter) and sends a
   * real push notification (Android/iOS notification bar) to the user's
   * registered devices, if any.
   */
  async notify(payload: NotificationPayload): Promise<void> {
    const { userId, title, actionUrl } = payload;
    const message = payload.message || payload.body || '';
    const type = payload.type || 'system';

    if (!userId || !title) {
      console.warn('[NotificationService] notify() chamado sem userId/title, ignorando.');
      return;
    }

    const notifEntry: Record<string, any> = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      title,
      message,
      type,
      read: false,
      createdAt: new Date().toISOString(),
    };
    if (actionUrl) notifEntry.actionUrl = actionUrl;

    const userRef = db.collection('users').doc(userId);
    let fcmTokens: string[] = [];

    try {
      await db.runTransaction(async (tx: any) => {
        const snap = await tx.get(userRef);
        if (!snap.exists) return;
        const data = snap.data() as any;
        fcmTokens = Array.isArray(data.fcmTokens) ? data.fcmTokens : [];
        const current = Array.isArray(data.notifications) ? data.notifications : [];
        const updated = [notifEntry, ...current].slice(0, MAX_STORED_NOTIFICATIONS);
        tx.set(userRef, { notifications: updated }, { merge: true });
      });
      console.log(`[NOTIFICATION] [${userId}] [${type}] ${title}`);
    } catch (err: any) {
      console.error(`[NotificationService] Falha ao gravar notificação in-app para ${userId}: ${err.message}`);
    }

    if (fcmTokens.length > 0) {
      await this.sendPush(userId, fcmTokens, title, message, actionUrl, payload.data);
    }
  }

  private async sendPush(
    userId: string,
    tokens: string[],
    title: string,
    body: string,
    actionUrl?: string,
    data?: Record<string, string>
  ): Promise<void> {
    try {
      const messaging = getMessaging(app);
      const response = await messaging.sendEachForMulticast({
        tokens,
        notification: { title, body },
        data: {
          ...(actionUrl ? { actionUrl } : {}),
          ...(data || {}),
        },
      });

      const deadTokens: string[] = [];
      response.responses.forEach((r: any, i: number) => {
        if (!r.success) {
          const code = String(r.error?.code || '');
          if (code.includes('registration-token-not-registered') || code.includes('invalid-argument')) {
            deadTokens.push(tokens[i]);
          }
        }
      });

      if (deadTokens.length > 0) {
        await db.collection('users').doc(userId).set(
          { fcmTokens: FieldValue.arrayRemove(...deadTokens) },
          { merge: true }
        );
        console.log(`[NotificationService] Removidos ${deadTokens.length} token(s) FCM inválidos de ${userId}`);
      }

      console.log(`[NotificationService] Push enviado para ${userId}: ${response.successCount}/${tokens.length} com sucesso`);
    } catch (err: any) {
      console.error(`[NotificationService] Falha ao enviar push FCM para ${userId}: ${err.message}`);
    }
  }

  /**
   * @deprecated Legacy alias kept for backward compatibility with
   * api/_services/activities/validate-activity-service.ts. New code should
   * call notify() directly.
   */
  async send(notification: { userId: string; title: string; body: string; type: string; data?: Record<string, any> }): Promise<void> {
    await this.notify({
      userId: notification.userId,
      title: notification.title,
      message: notification.body,
      type: notification.type,
    });
  }
}

export const notificationService = new NotificationService();
